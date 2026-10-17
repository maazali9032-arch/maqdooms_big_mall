BEGIN;

-- Each floor row carries its current positive Thaan balances so the inventory
-- tree can expand without a second, differently authorised query.
CREATE OR REPLACE FUNCTION public.showroom_floor_distribution()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['owner', 'stock_entry']) THEN
    RAISE EXCEPTION 'Authorized inventory role required';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', floor.id,
        'code', floor.code,
        'name', floor.name,
        'available_mm', coalesce((
          SELECT sum(public.inventory_balance(i.id, floor.id))
          FROM public.inventory_items i
          JOIN public.thaans t ON t.id = i.thaan_id
          WHERE t.status = 'active'
        ), 0)::text,
        'thaans', coalesce((
          SELECT count(*)
          FROM public.inventory_items i
          JOIN public.thaans t ON t.id = i.thaan_id
          WHERE t.status = 'active'
            AND public.inventory_balance(i.id, floor.id) > 0
        ), 0),
        'items', coalesce((
          SELECT jsonb_agg(
            jsonb_build_object(
              'inventory_item_id', i.id,
              'thaan_id', t.id,
              'barcode', coalesce(v.code, t.barcode, barcode.code),
              'fabric', fabric.name,
              'batch', batch.code,
              'colour', coalesce(fabric.colour, v.draft_details->>'colour'),
              'rack', t.rack,
              'available_mm', public.inventory_balance(i.id, floor.id)::text
            )
            ORDER BY fabric.name, batch.code, coalesce(v.code, t.barcode, barcode.code)
          )
          FROM public.inventory_items i
          JOIN public.thaans t ON t.id = i.thaan_id
          JOIN public.fabric_stock stock ON stock.id = t.fabric_stock_id
          JOIN public.fabrics fabric ON fabric.id = stock.fabric_id
          JOIN public.receiving_batches batch ON batch.id = stock.batch_id
          LEFT JOIN public.barcodes barcode ON barcode.id = stock.barcode_id
          LEFT JOIN public.stock_registration_variants v ON v.thaan_id = t.id
          WHERE t.status = 'active'
            AND public.inventory_balance(i.id, floor.id) > 0
        ), '[]'::jsonb)
      )
      ORDER BY floor.name
    )
    FROM public.locations floor
    JOIN public.locations parent
      ON parent.id = floor.parent_id
      AND parent.active
      AND parent.kind = 'showroom'
    WHERE floor.active
      AND floor.kind = 'showroom_sublocation'
  ), '[]'::jsonb);
END;
$$;

-- Return the POS operator's display name while retaining the immutable user ID
-- for evidence and authorization.
CREATE OR REPLACE FUNCTION public.salesperson_work(
  p_salesperson uuid DEFAULT NULL,
  p_after timestamptz DEFAULT NULL,
  p_after_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE owner boolean := public.has_role(auth.uid(), 'owner');
BEGIN
  IF NOT owner AND (
    NOT public.has_role(auth.uid(), 'salesperson')
    OR NOT public.has_perm(auth.uid(), 'salesperson.view_work')
  ) THEN
    RAISE EXCEPTION 'Salesperson work permission required';
  END IF;
  IF NOT owner AND p_salesperson IS NOT NULL AND p_salesperson <> auth.uid() THEN
    RAISE EXCEPTION 'Only own Salesperson work is available';
  END IF;
  IF (p_after IS NULL) <> (p_after_id IS NULL) THEN
    RAISE EXCEPTION 'Complete history cursor required';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC, x.id DESC)
    FROM (
      SELECT
        o.id,
        o.code,
        o.kind,
        o.created_at,
        o.created_by,
        pos_user.full_name operator_name,
        o.source_location_id,
        l.name source_name,
        o.salesperson_user_id,
        salesperson.full_name salesperson_name,
        o.customer_snapshot,
        o.final_customer_price_paise::text final_customer_price_paise,
        CASE WHEN o.kind = 'counter_bill' THEN
          EXISTS(SELECT 1 FROM public.counter_bill_payments WHERE bill_id = o.id)
        END paid,
        (
          SELECT jsonb_agg(jsonb_build_object(
            'code', job.code,
            'garment', job.garment,
            'status', job.status,
            'delivery_date', detail.delivery_date,
            'factory', factory.name,
            'tailor', tailor.real_name
          ) ORDER BY job.code)
          FROM public.counter_tailoring_details detail
          JOIN public.customer_tailoring_jobs job ON job.id = detail.job_id
          JOIN public.tailor_assignments assignment ON assignment.id = job.tailor_assignment_id
          JOIN public.tailoring_factories factory ON factory.id = assignment.factory_id
          JOIN public.tailors tailor ON tailor.id = assignment.tailor_id
          WHERE detail.bill_id = o.id
        ) tailoring_jobs,
        j.id job_id,
        j.code job_code,
        j.garment,
        j.status job_status,
        f.name factory_name,
        s.name section_name,
        t.code tailor_code,
        t.real_name tailor_name,
        CASE WHEN j.id IS NOT NULL THEN (
          SELECT sum(quantity)::text
          FROM public.job_material_requirements
          WHERE customer_tailoring_job_id = j.id AND fabric_stock_id IS NOT NULL
        ) ELSE (
          SELECT sum(quantity)::text
          FROM public.order_items
          WHERE order_id = o.id AND fabric_stock_id IS NOT NULL
        ) END fabric_mm,
        coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'barcode', bc.code,
            'fabric', fab.name,
            'batch', b.code,
            'quantity_mm', ml.quantity::text
          ) ORDER BY ml.id)
          FROM public.material_issues mi
          JOIN public.material_issue_lines ml ON ml.material_issue_id = mi.id
          JOIN public.fabric_stock fs ON fs.id = ml.fabric_stock_id
          JOIN public.fabrics fab ON fab.id = fs.fabric_id
          JOIN public.receiving_batches b ON b.id = fs.batch_id
          JOIN public.barcodes bc ON bc.id = fs.barcode_id
          WHERE mi.customer_tailoring_job_id = j.id
        ), (
          SELECT jsonb_agg(jsonb_build_object(
            'barcode', bc.code,
            'fabric', fab.name,
            'batch', b.code,
            'quantity_mm', it.quantity::text
          ) ORDER BY it.id)
          FROM public.order_items it
          JOIN public.fabric_stock fs ON fs.id = it.fabric_stock_id
          JOIN public.fabrics fab ON fab.id = fs.fabric_id
          JOIN public.receiving_batches b ON b.id = fs.batch_id
          JOIN public.barcodes bc ON bc.id = fs.barcode_id
          WHERE it.order_id = o.id
        ), '[]'::jsonb) fabrics
      FROM public.orders o
      JOIN public.profiles salesperson ON salesperson.id = o.salesperson_user_id
      LEFT JOIN public.profiles pos_user ON pos_user.id = o.created_by
      JOIN public.locations l ON l.id = o.source_location_id
      LEFT JOIN public.customer_tailoring_jobs j ON j.id = o.customer_tailoring_job_id
      LEFT JOIN public.tailor_assignments a ON a.id = j.tailor_assignment_id
      LEFT JOIN public.tailoring_factories f ON f.id = a.factory_id
      LEFT JOIN public.tailoring_sections s ON s.id = a.section_id
      LEFT JOIN public.tailors t ON t.id = a.tailor_id
      WHERE o.status = 'completed'
        AND NOT (
          o.kind = 'customer_tailoring'
          AND EXISTS(
            SELECT 1 FROM public.counter_tailoring_details
            WHERE job_id = o.customer_tailoring_job_id
          )
        )
        AND (owner OR o.salesperson_user_id = auth.uid())
        AND (p_salesperson IS NULL OR o.salesperson_user_id = p_salesperson)
        AND (p_after IS NULL OR (o.created_at, o.id) < (p_after, p_after_id))
      ORDER BY o.created_at DESC, o.id DESC
      LIMIT greatest(1, least(coalesce(p_limit, 50), 200))
    ) x
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.showroom_floor_distribution() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.salesperson_work(uuid, timestamptz, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.showroom_floor_distribution() TO authenticated;
GRANT EXECUTE ON FUNCTION public.salesperson_work(uuid, timestamptz, uuid, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
