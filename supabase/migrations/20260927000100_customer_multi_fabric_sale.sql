-- Complete one customer sale with multiple thaan cuts. Every row is validated
-- and locked inside this transaction, so a failed item rolls back the bill,
-- sale items and all stock movements together.
CREATE OR REPLACE FUNCTION public.complete_fabric_sale(
  p_items jsonb,
  p_customer_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item jsonb;
  v_barcode text;
  v_length_mm integer;
  v_thaan public.thaans%rowtype;
  v_available_mm integer;
  v_held_mm integer;
  v_cost_paise integer;
  v_amount_paise integer;
  v_total_paise integer := 0;
  v_total_length_mm integer := 0;
  v_sale_id uuid;
  v_bill_prefix text;
  v_bill_sequence integer;
  v_bill_no text;
  v_results jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.has_perm(auth.uid(), 'pos.sell') THEN
    RAISE EXCEPTION 'Permission denied: pos.sell';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Sale items must be supplied as a list';
  END IF;
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Add at least one fabric cut to the sale';
  END IF;
  IF jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION 'A maximum of 50 fabric cuts can be sold together';
  END IF;
  IF p_customer_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id) THEN
    RAISE EXCEPTION 'Selected customer no longer exists';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) item
    GROUP BY lower(btrim(item->>'barcode'))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'The same thaan cannot be added more than once';
  END IF;

  -- Serialize invoice number allocation for the current business day.
  v_bill_prefix := 'INV-' || to_char(current_date, 'YYMMDD') || '-';
  PERFORM pg_advisory_xact_lock(hashtextextended('maqdooms:invoice:' || current_date::text, 0));
  SELECT coalesce(max(substring(s.bill_no from '[0-9]+$')::integer), 0) + 1
  INTO v_bill_sequence
  FROM public.sales s
  WHERE s.bill_no LIKE v_bill_prefix || '%';
  v_bill_no := v_bill_prefix || lpad(v_bill_sequence::text, 4, '0');

  INSERT INTO public.sales(bill_no, customer_id, user_id, total_paise)
  VALUES (v_bill_no, p_customer_id, auth.uid(), 0)
  RETURNING id INTO v_sale_id;

  -- Barcode ordering prevents two concurrent multi-item sales from locking
  -- the same thaans in opposite orders.
  FOR v_item IN
    SELECT item
    FROM jsonb_array_elements(p_items) item
    ORDER BY lower(btrim(item->>'barcode'))
  LOOP
    v_barcode := nullif(btrim(v_item->>'barcode'), '');
    IF v_barcode IS NULL THEN
      RAISE EXCEPTION 'Every sale item requires a barcode';
    END IF;
    IF coalesce(v_item->>'length_mm', '') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Invalid cut length for thaan %', v_barcode;
    END IF;
    v_length_mm := (v_item->>'length_mm')::integer;
    IF v_length_mm <= 0 THEN
      RAISE EXCEPTION 'Cut length for thaan % must be greater than zero', v_barcode;
    END IF;

    SELECT * INTO v_thaan
    FROM public.thaans
    WHERE barcode = v_barcode
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Unknown barcode %', v_barcode;
    END IF;
    IF v_thaan.status <> 'active' THEN
      RAISE EXCEPTION 'Thaan % is not active (status: %)', v_barcode, v_thaan.status;
    END IF;
    IF v_thaan.price_paise IS NULL OR v_thaan.original_mm IS NULL THEN
      RAISE EXCEPTION 'Thaan % is incomplete and cannot be sold', v_barcode;
    END IF;

    SELECT coalesce(sum(delta_mm), 0)::integer INTO v_available_mm
    FROM public.stock_movements
    WHERE thaan_id = v_thaan.id;
    SELECT coalesce(sum(length_mm), 0)::integer INTO v_held_mm
    FROM public.holds
    WHERE thaan_id = v_thaan.id
      AND status = 'active'
      AND expires_at > now();

    IF v_length_mm > (v_available_mm - v_held_mm) THEN
      RAISE EXCEPTION 'Insufficient stock: % has % m available (% m held)',
        v_barcode,
        round(v_available_mm / 1000.0, 2),
        round(v_held_mm / 1000.0, 2);
    END IF;

    SELECT cost_paise INTO v_cost_paise
    FROM public.thaan_costs
    WHERE thaan_id = v_thaan.id;
    v_amount_paise := round(v_length_mm::numeric / 1000 * v_thaan.price_paise)::integer;

    INSERT INTO public.sale_items(
      sale_id, thaan_id, length_mm, price_paise_per_m, amount_paise
    ) VALUES (
      v_sale_id, v_thaan.id, v_length_mm, v_thaan.price_paise, v_amount_paise
    );
    INSERT INTO public.stock_movements(
      thaan_id, kind, delta_mm, purpose, reference, sale_id,
      cost_snapshot_paise, price_snapshot_paise, reason, user_id
    ) VALUES (
      v_thaan.id, 'SALE', -v_length_mm, 'sale', v_bill_no, v_sale_id,
      v_cost_paise, v_thaan.price_paise, p_reason, auth.uid()
    );

    IF (v_available_mm - v_length_mm) <= 0 THEN
      UPDATE public.thaans
      SET status = 'depleted', updated_at = now()
      WHERE id = v_thaan.id;
    END IF;

    v_total_paise := v_total_paise + v_amount_paise;
    v_total_length_mm := v_total_length_mm + v_length_mm;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'thaan_id', v_thaan.id,
      'barcode', v_thaan.barcode,
      'length_mm', v_length_mm,
      'remaining_mm', v_available_mm - v_length_mm,
      'amount_paise', v_amount_paise,
      'bill_no', v_bill_no,
      'sale_id', v_sale_id
    ));

    PERFORM public.log_audit(
      'cut_thaan',
      'thaan',
      v_thaan.barcode,
      jsonb_build_object(
        'length_mm', v_length_mm,
        'purpose', 'sale',
        'amount_paise', v_amount_paise,
        'sale_id', v_sale_id
      )
    );
  END LOOP;

  UPDATE public.sales
  SET total_paise = v_total_paise
  WHERE id = v_sale_id;

  PERFORM public.log_audit(
    'complete_fabric_sale',
    'sale',
    v_sale_id::text,
    jsonb_build_object(
      'bill_no', v_bill_no,
      'item_count', jsonb_array_length(p_items),
      'total_length_mm', v_total_length_mm,
      'total_paise', v_total_paise
    )
  );

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'bill_no', v_bill_no,
    'item_count', jsonb_array_length(p_items),
    'total_length_mm', v_total_length_mm,
    'total_paise', v_total_paise,
    'cuts', v_results
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_fabric_sale(jsonb,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_fabric_sale(jsonb,uuid,text) TO authenticated;
