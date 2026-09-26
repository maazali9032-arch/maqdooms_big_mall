-- Correct an existing incomplete thaan in place, then revalidate it against
-- the same required fields used by commit_receiving_batch (length + price).
-- The row is locked so concurrent corrections cannot duplicate INWARD stock.
CREATE OR REPLACE FUNCTION public.correct_incomplete_thaan(
  p_thaan_id uuid,
  p_fabric_id uuid DEFAULT NULL,
  p_original_mm integer DEFAULT NULL,
  p_width_mm integer DEFAULT NULL,
  p_price_paise integer DEFAULT NULL,
  p_cost_paise integer DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_thaan public.thaans%rowtype;
  v_batch_id uuid;
  v_old_original_mm integer;
  v_batch_status text;
  v_batch_code text;
  v_complete boolean;
  v_has_inward boolean;
  v_inward_created boolean := false;
  v_activated boolean := false;
  v_cost_paise integer;
BEGIN
  IF NOT public.has_perm(auth.uid(), 'inventory.receive')
     OR NOT public.has_perm(auth.uid(), 'inventory.edit_thaan') THEN
    RAISE EXCEPTION 'Permission denied: stock receiving access is required';
  END IF;

  SELECT batch_id INTO v_batch_id FROM public.thaans WHERE id = p_thaan_id;
  IF NOT found THEN RAISE EXCEPTION 'Thaan not found'; END IF;

  -- commit_receiving_batch takes the same lock first, preventing a correction
  -- and commit from observing different completeness states.
  IF v_batch_id IS NOT NULL THEN
    SELECT b.status, b.code INTO v_batch_status, v_batch_code
    FROM public.receiving_batches b WHERE b.id = v_batch_id FOR UPDATE;
  END IF;

  SELECT * INTO v_thaan FROM public.thaans WHERE id = p_thaan_id FOR UPDATE;
  IF v_thaan.status NOT IN ('draft','active') THEN
    RAISE EXCEPTION 'Only draft or incomplete active thaans can be corrected';
  END IF;
  IF v_thaan.status = 'active'
     AND v_thaan.original_mm IS NOT NULL
     AND v_thaan.price_paise IS NOT NULL THEN
    RAISE EXCEPTION 'This active thaan is already complete';
  END IF;

  v_old_original_mm := v_thaan.original_mm;

  UPDATE public.thaans
  SET fabric_id = coalesce(p_fabric_id, fabric_id),
      original_mm = coalesce(p_original_mm, original_mm),
      width_mm = coalesce(p_width_mm, width_mm),
      price_paise = coalesce(p_price_paise, price_paise),
      updated_at = now()
  WHERE id = p_thaan_id
  RETURNING * INTO v_thaan;

  IF p_cost_paise IS NOT NULL THEN
    INSERT INTO public.thaan_costs(thaan_id, cost_paise, updated_by, updated_at)
    VALUES (p_thaan_id, p_cost_paise, auth.uid(), now())
    ON CONFLICT (thaan_id) DO UPDATE
      SET cost_paise = excluded.cost_paise,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at;
  END IF;

  SELECT cost_paise INTO v_cost_paise FROM public.thaan_costs WHERE thaan_id = p_thaan_id;

  SELECT EXISTS (
    SELECT 1 FROM public.stock_movements
    WHERE thaan_id = p_thaan_id AND kind = 'INWARD'
  ) INTO v_has_inward;

  -- If a legacy incomplete active record already had an inward movement and
  -- its original length is corrected, preserve history with an adjustment.
  IF v_has_inward
     AND v_old_original_mm IS NOT NULL
     AND v_thaan.original_mm IS DISTINCT FROM v_old_original_mm THEN
    INSERT INTO public.stock_movements(
      thaan_id, kind, delta_mm, purpose, reference, reason, price_snapshot_paise, user_id
    ) VALUES (
      p_thaan_id,
      'ADJUSTMENT',
      v_thaan.original_mm - v_old_original_mm,
      'incomplete_stock_correction',
      v_batch_code,
      'Original length corrected while completing stock details',
      v_thaan.price_paise,
      auth.uid()
    );
  END IF;

  v_complete := v_thaan.original_mm IS NOT NULL AND v_thaan.price_paise IS NOT NULL;

  IF v_complete AND (v_batch_status = 'committed' OR v_has_inward) THEN
    IF NOT v_has_inward THEN
      INSERT INTO public.stock_movements(
        thaan_id, kind, delta_mm, purpose, reference,
        cost_snapshot_paise, price_snapshot_paise, user_id
      ) VALUES (
        p_thaan_id,
        'INWARD',
        v_thaan.original_mm,
        'receiving_correction',
        v_batch_code,
        v_cost_paise,
        v_thaan.price_paise,
        auth.uid()
      );
      v_inward_created := true;
    END IF;

    v_activated := v_thaan.status <> 'active';
    UPDATE public.thaans SET status = 'active', updated_at = now() WHERE id = p_thaan_id;
    v_thaan.status := 'active';
  END IF;

  PERFORM public.log_audit(
    'correct_incomplete_thaan',
    'thaan',
    v_thaan.barcode,
    jsonb_build_object(
      'complete', v_complete,
      'activated', v_activated,
      'inward_created', v_inward_created,
      'length_mm', v_thaan.original_mm,
      'price_paise', v_thaan.price_paise
    )
  );

  RETURN jsonb_build_object(
    'complete', v_complete,
    'activated', v_activated,
    'inward_created', v_inward_created,
    'status', v_thaan.status
  );
END;
$$;

-- Preserve the existing commit rules while serializing against corrections
-- and refusing to add a second INWARD entry for the same physical thaan.
CREATE OR REPLACE FUNCTION public.commit_receiving_batch(p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int; v_incomplete int; v_code text;
BEGIN
  IF NOT public.has_perm(auth.uid(),'inventory.receive') THEN
    RAISE EXCEPTION 'Permission denied: inventory.receive';
  END IF;

  SELECT code INTO v_code FROM public.receiving_batches
  WHERE id = p_batch_id AND status = 'draft'
  FOR UPDATE;
  IF v_code IS NULL THEN RAISE EXCEPTION 'Batch not found or already committed'; END IF;

  SELECT count(*) FILTER (WHERE original_mm IS NULL OR price_paise IS NULL)
  INTO v_incomplete FROM public.thaans WHERE batch_id = p_batch_id;

  INSERT INTO public.stock_movements(
    thaan_id, kind, delta_mm, purpose, reference,
    cost_snapshot_paise, price_snapshot_paise, user_id
  )
  SELECT t.id, 'INWARD', t.original_mm, 'receiving', v_code,
         c.cost_paise, t.price_paise, auth.uid()
  FROM public.thaans t
  LEFT JOIN public.thaan_costs c ON c.thaan_id = t.id
  WHERE t.batch_id = p_batch_id
    AND t.status = 'draft'
    AND t.original_mm IS NOT NULL
    AND t.price_paise IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.stock_movements m
      WHERE m.thaan_id = t.id AND m.kind = 'INWARD'
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.thaans SET status = 'active', updated_at = now()
  WHERE batch_id = p_batch_id
    AND status = 'draft'
    AND original_mm IS NOT NULL
    AND price_paise IS NOT NULL;
  UPDATE public.receiving_batches SET status = 'committed', committed_at = now()
  WHERE id = p_batch_id;

  PERFORM public.log_audit(
    'commit_receiving_batch',
    'receiving_batch',
    v_code,
    jsonb_build_object('activated', v_count, 'incomplete', v_incomplete)
  );
  RETURN jsonb_build_object(
    'activated', v_count,
    'incomplete', v_incomplete,
    'code', v_code
  );
END;
$$;

REVOKE ALL ON FUNCTION public.correct_incomplete_thaan(uuid,uuid,integer,integer,integer,integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correct_incomplete_thaan(uuid,uuid,integer,integer,integer,integer)
  TO authenticated;

