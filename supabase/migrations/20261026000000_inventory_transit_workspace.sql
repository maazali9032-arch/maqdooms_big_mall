BEGIN;

-- Keep the showroom drill-down operationally useful: most recently received
-- physical Thaans appear first within each floor.
CREATE OR REPLACE FUNCTION public.showroom_floor_distribution()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['owner','stock_entry']) THEN
    RAISE EXCEPTION 'Authorized inventory role required';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id',floor.id,'code',floor.code,'name',floor.name,
      'available_mm',coalesce((SELECT sum(public.inventory_balance(i.id,floor.id)) FROM public.inventory_items i JOIN public.thaans t ON t.id=i.thaan_id WHERE t.status='active'),0)::text,
      'thaans',coalesce((SELECT count(*) FROM public.inventory_items i JOIN public.thaans t ON t.id=i.thaan_id WHERE t.status='active' AND public.inventory_balance(i.id,floor.id)>0),0),
      'items',coalesce((SELECT jsonb_agg(jsonb_build_object(
        'inventory_item_id',i.id,'thaan_id',t.id,'barcode',coalesce(v.code,t.barcode,barcode.code),
        'fabric',fabric.name,'batch',batch.code,'colour',coalesce(fabric.colour,v.draft_details->>'colour'),
        'rack',t.rack,'available_mm',public.inventory_balance(i.id,floor.id)::text,'created_at',t.created_at
      ) ORDER BY t.created_at DESC,t.id DESC)
      FROM public.inventory_items i
      JOIN public.thaans t ON t.id=i.thaan_id
      JOIN public.fabric_stock stock ON stock.id=t.fabric_stock_id
      JOIN public.fabrics fabric ON fabric.id=stock.fabric_id
      JOIN public.receiving_batches batch ON batch.id=stock.batch_id
      LEFT JOIN public.barcodes barcode ON barcode.id=stock.barcode_id
      LEFT JOIN public.stock_registration_variants v ON v.thaan_id=t.id
      WHERE t.status='active' AND public.inventory_balance(i.id,floor.id)>0),'[]'::jsonb)
    ) ORDER BY floor.name)
    FROM public.locations floor
    JOIN public.locations parent ON parent.id=floor.parent_id AND parent.active AND parent.kind='showroom'
    WHERE floor.active AND floor.kind='showroom_sublocation'
  ),'[]'::jsonb);
END; $$;

-- Current factory custody and work-in-progress. Fabric rows are tied to the job
-- they were issued for. Material units remain master-tailor custody until their
-- remaining quantity reaches zero, and are intentionally not assigned to a job
-- until the master records actual consumption.
CREATE OR REPLACE FUNCTION public.factory_transit_inventory()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.has_any_role(auth.uid(),ARRAY['owner','stock_entry'])
     AND NOT public.has_perm(auth.uid(),'inventory.view') THEN
    RAISE EXCEPTION 'Authorized inventory role required';
  END IF;

  WITH fabric_rows AS (
    SELECT
      f.id factory_id,f.code factory_code,f.name factory_name,
      line.id row_id,'fabric'::text item_type,
      coalesce(v.code,t.barcode,b.code) barcode,fb.name item_name,rb.code batch_code,
      line.quantity::text quantity,line.unit,
      CASE WHEN issue.production_job_id IS NOT NULL THEN 'production' ELSE 'customer_order' END purpose,
      coalesce(p.code,c.code) reference,issue.issued_at,
      CASE WHEN consumption.id IS NULL THEN 'issued_to_factory' ELSE 'work_recorded' END stage,
      issue.production_job_id,issue.customer_tailoring_job_id,
      tailor.real_name tailor_name
    FROM public.material_issue_lines line
    JOIN public.material_issues issue ON issue.id=line.material_issue_id
    JOIN public.tailor_assignments assignment ON assignment.id=issue.tailor_assignment_id
    JOIN public.tailoring_factories f ON f.id=assignment.factory_id
    JOIN public.tailors tailor ON tailor.id=assignment.tailor_id
    JOIN public.thaans t ON t.id=line.thaan_id
    JOIN public.fabric_stock fs ON fs.id=t.fabric_stock_id
    JOIN public.fabrics fb ON fb.id=fs.fabric_id
    JOIN public.receiving_batches rb ON rb.id=fs.batch_id
    LEFT JOIN public.barcodes b ON b.id=fs.barcode_id
    LEFT JOIN public.stock_registration_variants v ON v.thaan_id=t.id
    LEFT JOIN public.production_jobs p ON p.id=issue.production_job_id
    LEFT JOIN public.customer_tailoring_jobs c ON c.id=issue.customer_tailoring_job_id
    LEFT JOIN public.job_material_consumptions consumption
      ON consumption.reversed_at IS NULL AND
         (consumption.production_job_id=issue.production_job_id OR consumption.customer_tailoring_job_id=issue.customer_tailoring_job_id)
    WHERE line.thaan_id IS NOT NULL
      AND (p.id IS NULL OR (p.status<>'cancelled' AND NOT EXISTS(SELECT 1 FROM public.finished_product_receipts receipt WHERE receipt.production_job_id=p.id)))
      AND (c.id IS NULL OR (c.status NOT IN ('delivered','cancelled') AND NOT EXISTS(SELECT 1 FROM public.customer_tailoring_finished_items finished WHERE finished.job_id=c.id)))
  ), unit_rows AS (
    SELECT
      f.id factory_id,f.code factory_code,f.name factory_name,
      u.id row_id,'material'::text item_type,u.barcode,m.name item_name,mb.code batch_code,
      u.remaining_quantity::text quantity,u.unit,'custody'::text purpose,
      tailor.code reference,u.received_at issued_at,'master_tailor_stock'::text stage,
      NULL::uuid production_job_id,NULL::uuid customer_tailoring_job_id,tailor.real_name tailor_name
    FROM public.material_units u
    JOIN public.materials m ON m.id=u.material_id
    JOIN public.material_batches mb ON mb.id=u.batch_id
    JOIN public.tailoring_factories f ON f.id=u.assigned_factory_id
    JOIN public.tailors tailor ON tailor.id=u.assigned_tailor_id
    WHERE u.remaining_quantity>0
  ), rows AS (SELECT * FROM fabric_rows UNION ALL SELECT * FROM unit_rows), factories AS (
    SELECT r.factory_id,r.factory_code,r.factory_name,
      coalesce(sum(CASE WHEN r.item_type='fabric' AND lower(r.unit)='mm' THEN r.quantity::numeric ELSE 0 END),0) fabric_mm,
      count(*) FILTER(WHERE r.item_type='fabric') fabric_lines,
      count(*) FILTER(WHERE r.item_type='material') material_units,
      count(DISTINCT r.production_job_id) production_jobs,
      count(DISTINCT r.customer_tailoring_job_id) customer_orders,
      jsonb_agg(jsonb_build_object(
        'id',r.row_id,'item_type',r.item_type,'barcode',r.barcode,'item',r.item_name,'batch',r.batch_code,
        'quantity',r.quantity,'unit',r.unit,'purpose',r.purpose,'reference',r.reference,
        'issued_at',r.issued_at,'stage',r.stage,'tailor',r.tailor_name
      ) ORDER BY r.issued_at DESC,r.row_id DESC) items
    FROM rows r GROUP BY r.factory_id,r.factory_code,r.factory_name
  )
  SELECT jsonb_build_object(
    'total_fabric_mm',coalesce((SELECT sum(fabric_mm) FROM factories),0)::text,
    'factories_count',(SELECT count(*) FROM factories),
    'fabric_lines',coalesce((SELECT sum(fabric_lines) FROM factories),0),
    'material_units',coalesce((SELECT sum(material_units) FROM factories),0),
    'production_jobs',coalesce((SELECT sum(production_jobs) FROM factories),0),
    'customer_orders',coalesce((SELECT sum(customer_orders) FROM factories),0),
    'factories',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',factory_id,'code',factory_code,'name',factory_name,'fabric_mm',fabric_mm::text,
      'fabric_lines',fabric_lines,'material_units',material_units,'production_jobs',production_jobs,
      'customer_orders',customer_orders,'items',items
    ) ORDER BY factory_name) FROM factories),'[]'::jsonb)
  ) INTO result;
  RETURN result;
END; $$;

REVOKE ALL ON FUNCTION public.factory_transit_inventory() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.factory_transit_inventory() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
