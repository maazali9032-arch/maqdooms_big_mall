BEGIN;

-- Stock Audit is personally granted by the Owner. It is no longer inherited by
-- every non-owner role, so it can safely control both sidebar visibility and
-- who can be assigned an audit.
UPDATE public.permissions
SET label = 'Access Stock Audit and perform assigned scans', domain = 'audit'
WHERE key = 'stock_count.perform';
DELETE FROM public.role_permissions WHERE permission_key = 'stock_count.perform';

CREATE OR REPLACE FUNCTION public.stock_count_setup_catalog() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object(
  'staff', coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.full_name) ORDER BY p.full_name)
    FROM public.profiles p
    WHERE p.active AND NOT public.has_role(p.id,'owner') AND public.has_perm(p.id,'stock_count.perform')), '[]'::jsonb),
  'locations', coalesce((SELECT jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'kind',l.kind) ORDER BY l.name)
    FROM public.locations l WHERE l.active), '[]'::jsonb),
  'categories', coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'label',label,'kind',kind) ORDER BY kind,label)
    FROM (
      SELECT 'fabric_name:' || lower(btrim(f.name)) AS id, min(f.name) AS label, 'Fabric / Thaan' AS kind
      FROM public.inventory_items i
      JOIN public.thaans t ON t.id=i.thaan_id
      JOIN public.fabric_stock fs ON fs.id=t.fabric_stock_id
      JOIN public.fabrics f ON f.id=fs.fabric_id
      WHERE i.unit='mm' AND EXISTS (
        SELECT 1 FROM public.locations l
        WHERE l.active AND public.inventory_balance(i.id,l.id)>0
      )
      GROUP BY lower(btrim(f.name))
      UNION
      SELECT 'product_name:' || lower(btrim(product.name)) AS id, min(product.name) AS label, 'Finished garment' AS kind
      FROM public.finished_products piece
      JOIN public.inventory_items i ON i.finished_product_id=piece.id
      JOIN public.products product ON product.id=piece.product_id
      WHERE piece.status='available' AND public.inventory_balance(i.id,piece.current_location_id)=1
      GROUP BY lower(btrim(product.name))
    ) categories), '[]'::jsonb)
 ) WHERE public.has_role(auth.uid(),'owner');
$$;

DROP FUNCTION public.create_stock_count_audit(uuid,text,text[],uuid[],uuid,text[]);
CREATE FUNCTION public.create_stock_count_audit(
  p_request uuid, p_name text, p_kinds text[], p_locations uuid[], p_staff uuid,
  p_category_refs text[] DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result uuid:=gen_random_uuid(); item_count integer;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner access required'; END IF;
 IF p_request IS NULL OR nullif(btrim(p_name),'') IS NULL OR p_kinds IS NULL OR cardinality(p_kinds) NOT BETWEEN 1 AND 4
   OR p_kinds <@ ARRAY['fabric','finished_product','production_finished','vendor_finished'] IS NOT TRUE
   OR p_locations IS NULL OR cardinality(p_locations)<1 OR p_staff IS NULL THEN
  RAISE EXCEPTION 'Name, at least one item type, location and assigned staff member are required';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_staff AND active AND public.has_perm(id,'stock_count.perform'))
   OR (SELECT count(*) FROM public.locations WHERE id=ANY(p_locations) AND active)<>cardinality(p_locations) THEN
  RAISE EXCEPTION 'Assign an active staff member with Stock Audit access and select active locations';
 END IF;
 INSERT INTO public.stock_count_audits(id,request_id,name,item_kinds,location_ids,assigned_to,created_by) VALUES(result,p_request,btrim(p_name),p_kinds,p_locations,p_staff,auth.uid());
 IF 'fabric'=ANY(p_kinds) THEN
  INSERT INTO public.stock_count_items(audit_id,item_kind,barcode,location_id,details)
  SELECT result,'fabric',coalesce(v.code,t.barcode,b.code),l.id,jsonb_build_object('name',coalesce(g.name,f.name),'batch',rb.code,'location',l.name,'category','Fabric / Thaan','quantity_mm',public.inventory_balance(i.id,l.id)::text)
  FROM public.inventory_items i JOIN public.thaans t ON t.id=i.thaan_id JOIN public.fabric_stock fs ON fs.id=t.fabric_stock_id JOIN public.fabrics f ON f.id=fs.fabric_id JOIN public.locations l ON l.id=ANY(p_locations) LEFT JOIN public.stock_registration_variants v ON v.thaan_id=t.id LEFT JOIN public.stock_registration_fabric_types g ON g.id=v.fabric_type_id LEFT JOIN public.receiving_batches rb ON rb.id=fs.batch_id LEFT JOIN public.barcodes b ON b.id=fs.barcode_id
  WHERE i.unit='mm' AND public.inventory_balance(i.id,l.id)>0 AND (coalesce(cardinality(p_category_refs),0)=0 OR ('fabric_name:'||lower(btrim(f.name)))=ANY(p_category_refs));
 END IF;
 IF p_kinds && ARRAY['finished_product','production_finished','vendor_finished'] THEN
  INSERT INTO public.stock_count_items(audit_id,item_kind,barcode,location_id,details)
  SELECT result,CASE WHEN p.vendor_receipt_id IS NULL THEN 'production_finished' ELSE 'vendor_finished' END,b.code,p.current_location_id,
    jsonb_strip_nulls(jsonb_build_object('name',product.name,'design',public.production_piece_context(p.id)->>'design','size',public.production_piece_context(p.id)->>'size','location',l.name,'category',CASE WHEN p.vendor_receipt_id IS NULL THEN 'Shop-produced garment' ELSE 'Vendor-purchased garment' END,'batch',coalesce(vendor_receipt.code,production.code)))
  FROM public.finished_products p JOIN public.inventory_items i ON i.finished_product_id=p.id JOIN public.barcodes b ON b.id=p.barcode_id JOIN public.products product ON product.id=p.product_id JOIN public.locations l ON l.id=p.current_location_id LEFT JOIN public.production_jobs production ON production.id=p.production_job_id LEFT JOIN public.vendor_finished_product_receipts vendor_receipt ON vendor_receipt.id=p.vendor_receipt_id
  WHERE p.status='available' AND p.current_location_id=ANY(p_locations) AND public.inventory_balance(i.id,p.current_location_id)=1
    AND (coalesce(cardinality(p_category_refs),0)=0 OR ('product_name:'||lower(btrim(product.name)))=ANY(p_category_refs))
    AND ('finished_product'=ANY(p_kinds) OR (p.vendor_receipt_id IS NULL AND 'production_finished'=ANY(p_kinds)) OR (p.vendor_receipt_id IS NOT NULL AND 'vendor_finished'=ANY(p_kinds)));
 END IF;
 SELECT count(*) INTO item_count FROM public.stock_count_items WHERE audit_id=result;
 IF item_count=0 THEN RAISE EXCEPTION 'No tracked items match the selected categories and locations'; END IF;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value) VALUES(auth.uid(),'create_stock_count_audit','stock_count_audits',result,jsonb_build_object('items',item_count,'kinds',p_kinds,'categories',coalesce(p_category_refs,'{}'::text[]),'locations',p_locations,'assigned_to',p_staff));
 RETURN result;
END; $$;

GRANT EXECUTE ON FUNCTION public.stock_count_setup_catalog(), public.create_stock_count_audit(uuid,text,text[],uuid[],uuid,text[]) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
