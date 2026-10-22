BEGIN;

-- Vendor-purchased ready-made garments are physical Finished Products, but they
-- have a purchase receipt rather than a production job. Keeping that source
-- explicit prevents purchased stock from being confused with shop production.
CREATE TABLE public.vendor_finished_product_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  supplier_name text NOT NULL CHECK (btrim(supplier_name) <> ''),
  arrival_date date NOT NULL,
  remarks text,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  payload jsonb NOT NULL
);
CREATE TABLE public.vendor_finished_product_receipt_pieces (
  finished_product_id uuid PRIMARY KEY REFERENCES public.finished_products(id),
  receipt_id uuid NOT NULL REFERENCES public.vendor_finished_product_receipts(id),
  vendor_style text,
  size text NOT NULL CHECK (btrim(size) <> ''),
  cp_paise bigint NOT NULL CHECK (cp_paise >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX vendor_finished_piece_receipt_idx ON public.vendor_finished_product_receipt_pieces(receipt_id);
ALTER TABLE public.vendor_finished_product_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_finished_product_receipt_pieces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vendor_finished_product_receipts, public.vendor_finished_product_receipt_pieces FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vendor_finished_product_receipts, public.vendor_finished_product_receipt_pieces TO authenticated;
GRANT ALL ON public.vendor_finished_product_receipts, public.vendor_finished_product_receipt_pieces TO service_role;
CREATE POLICY vendor_finished_receipts_read ON public.vendor_finished_product_receipts FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'owner') OR (public.has_role(auth.uid(),'stock_entry') AND public.has_perm(auth.uid(),'inventory.receive')));
CREATE POLICY vendor_finished_piece_receipts_read ON public.vendor_finished_product_receipt_pieces FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'owner') OR (public.has_role(auth.uid(),'stock_entry') AND public.has_perm(auth.uid(),'inventory.receive')));
CREATE TRIGGER vendor_finished_receipts_immutable BEFORE UPDATE OR DELETE ON public.vendor_finished_product_receipts FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();
CREATE TRIGGER vendor_finished_piece_receipts_immutable BEFORE UPDATE OR DELETE ON public.vendor_finished_product_receipt_pieces FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();

ALTER TABLE public.finished_products ADD COLUMN vendor_receipt_id uuid REFERENCES public.vendor_finished_product_receipts(id);
ALTER TABLE public.finished_products ALTER COLUMN production_job_id DROP NOT NULL;
ALTER TABLE public.finished_products ALTER COLUMN design_id DROP NOT NULL;
ALTER TABLE public.finished_products ADD CONSTRAINT finished_products_one_source CHECK ((production_job_id IS NULL) <> (vendor_receipt_id IS NULL));

CREATE OR REPLACE FUNCTION public.validate_finished_product() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_quantity integer;
BEGIN
  IF NEW.vendor_receipt_id IS NOT NULL THEN
    IF NEW.production_job_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.vendor_finished_product_receipts WHERE id=NEW.vendor_receipt_id) THEN
      RAISE EXCEPTION 'A vendor finished product requires one valid vendor receipt';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.locations WHERE id=NEW.current_location_id AND active AND kind='workshop') THEN
      RAISE EXCEPTION 'Vendor Finished Products must initially enter Workshop';
    END IF;
  ELSE
    SELECT quantity INTO v_quantity FROM public.production_jobs WHERE id=NEW.production_job_id FOR UPDATE;
    IF v_quantity IS NULL OR NEW.piece_number > v_quantity THEN RAISE EXCEPTION 'Piece number exceeds Production Job quantity'; END IF;
    IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM public.locations WHERE id=NEW.current_location_id AND kind='workshop') THEN RAISE EXCEPTION 'Finished Products must initially return to Workshop'; END IF;
  END IF;
  IF TG_OP='UPDATE' AND (NEW.production_job_id,NEW.vendor_receipt_id,NEW.product_id,NEW.design_id,NEW.piece_number,NEW.barcode_id)
    IS DISTINCT FROM (OLD.production_job_id,OLD.vendor_receipt_id,OLD.product_id,OLD.design_id,OLD.piece_number,OLD.barcode_id) THEN
    RAISE EXCEPTION 'Finished Product identity cannot be rewritten';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.vendor_finished_receiving_catalog() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT jsonb_build_object('products', coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name) FROM public.products WHERE active),'[]'::jsonb))
  WHERE public.has_role(auth.uid(),'owner') OR (public.has_role(auth.uid(),'stock_entry') AND public.has_perm(auth.uid(),'inventory.receive') AND public.has_perm(auth.uid(),'stock.price_finished'));
$$;

CREATE FUNCTION public.receive_vendor_finished_products(p_request uuid, p_supplier text, p_arrival_date date, p_remarks text, p_items jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE receipt_id uuid:=gen_random_uuid(); workshop uuid; item jsonb; piece_id uuid; barcode_id uuid; inventory_id uuid; price_id uuid; product_id uuid; product_name text; quantity_value integer; cp_value bigint; sp_value bigint; size_value text; style_value text; ordinal integer:=0; saved public.vendor_finished_product_receipts%rowtype; payload_value jsonb; result jsonb:='[]'::jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(),'owner') OR (public.has_role(auth.uid(),'stock_entry') AND public.has_perm(auth.uid(),'inventory.receive') AND public.has_perm(auth.uid(),'stock.price_finished'))) THEN RAISE EXCEPTION 'Authorized Stock Entry and finished-product pricing access required'; END IF;
  IF p_request IS NULL OR nullif(btrim(p_supplier),'') IS NULL OR p_arrival_date IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Supplier, arrival date and 1–100 ready-made garment groups are required'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE jsonb_typeof(x)<>'object' OR (x-ARRAY['product_name','vendor_style','size','quantity','cp_paise','sp_paise'])<>'{}'::jsonb) THEN RAISE EXCEPTION 'Each ready-made group must contain only product, style, size, count, CP and SP'; END IF;
  payload_value:=jsonb_build_object('supplier',btrim(p_supplier),'arrival_date',p_arrival_date,'remarks',nullif(btrim(p_remarks),''),'items',p_items);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,19));
  SELECT * INTO saved FROM public.vendor_finished_product_receipts WHERE request_id=p_request;
  IF FOUND THEN
    IF saved.payload IS DISTINCT FROM payload_value THEN RAISE EXCEPTION 'This receiving request was already used with different details'; END IF;
    RETURN jsonb_build_object('receipt_id',saved.id,'pieces',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'barcode',b.code,'product',product.name,'size',vp.size,'sp_paise',price.sp_paise::text) ORDER BY p.piece_number) FROM public.vendor_finished_product_receipt_pieces vp JOIN public.finished_products p ON p.id=vp.finished_product_id JOIN public.barcodes b ON b.id=p.barcode_id JOIN public.products product ON product.id=p.product_id JOIN LATERAL(SELECT sp_paise FROM public.finished_product_prices WHERE finished_product_id=p.id ORDER BY revision DESC LIMIT 1) price ON true WHERE vp.receipt_id=saved.id),'[]'::jsonb));
  END IF;
  SELECT id INTO workshop FROM public.locations WHERE active AND kind='workshop' ORDER BY id LIMIT 1 FOR UPDATE;
  IF workshop IS NULL THEN RAISE EXCEPTION 'Active Workshop / Godown location required'; END IF;
  INSERT INTO public.vendor_finished_product_receipts(id,request_id,supplier_name,arrival_date,remarks,created_by,payload) VALUES(receipt_id,p_request,btrim(p_supplier),p_arrival_date,nullif(btrim(p_remarks),''),auth.uid(),payload_value);
  FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    product_name:=nullif(btrim(item->>'product_name'),''); size_value:=nullif(btrim(item->>'size'),''); style_value:=nullif(btrim(item->>'vendor_style'),''); quantity_value:=(item->>'quantity')::integer; cp_value:=(item->>'cp_paise')::bigint; sp_value:=(item->>'sp_paise')::bigint;
    IF product_name IS NULL OR size_value IS NULL OR quantity_value NOT BETWEEN 1 AND 500 OR cp_value NOT BETWEEN 0 AND 9007199254740991 OR sp_value NOT BETWEEN 1 AND 9007199254740991 THEN RAISE EXCEPTION 'Every group needs product name, size, 1–500 pieces, valid CP and a positive SP'; END IF;
    SELECT id INTO product_id FROM public.products WHERE lower(name)=lower(product_name) AND active ORDER BY id LIMIT 1 FOR UPDATE;
    IF product_id IS NULL THEN INSERT INTO public.products(code,name,active) VALUES('VENDOR-'||upper(replace(gen_random_uuid()::text,'-','')),product_name,true) RETURNING id INTO product_id; END IF;
    FOR n IN 1..quantity_value LOOP
      ordinal:=ordinal+1;
      barcode_id:=public.new_finished_piece_barcode();
      INSERT INTO public.finished_products(production_job_id,vendor_receipt_id,product_id,design_id,piece_number,barcode_id,current_location_id,status) VALUES(NULL,receipt_id,product_id,NULL,ordinal,barcode_id,workshop,'available') RETURNING id INTO piece_id;
      INSERT INTO public.vendor_finished_product_receipt_pieces(finished_product_id,receipt_id,vendor_style,size,cp_paise) VALUES(piece_id,receipt_id,style_value,size_value,cp_value);
      INSERT INTO public.finished_product_prices(finished_product_id,revision,sp_paise,recorded_by) VALUES(piece_id,1,sp_value,auth.uid()) RETURNING id INTO price_id;
      INSERT INTO public.inventory_items(finished_product_id,unit,legacy_quantity_snapshot,reconciled_by,reason) VALUES(piece_id,'pc',0,auth.uid(),'Vendor ready-made purchase receipt') RETURNING id INTO inventory_id;
      INSERT INTO public.inventory_movements(kind,inventory_item_id,finished_product_id,quantity,unit,destination_location_id,actor_id,reason,reference) VALUES('INWARD',inventory_id,piece_id,1,'pc',workshop,auth.uid(),'Vendor ready-made purchase receipt','VENDOR:'||receipt_id::text);
      result:=result||jsonb_build_array(jsonb_build_object('id',piece_id,'barcode',(SELECT code FROM public.barcodes WHERE id=barcode_id),'product',product_name,'size',size_value,'sp_paise',sp_value::text));
    END LOOP;
  END LOOP;
  INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference) VALUES(auth.uid(),'receive_vendor_finished_products','vendor_finished_product_receipts',receipt_id,payload_value,'VENDOR:'||receipt_id::text);
  RETURN jsonb_build_object('receipt_id',receipt_id,'pieces',result);
END; $$;

-- Vendor pieces have an SP at receipt, so no production-cost review exists to
-- gate their transfer. Manufactured pieces retain the existing review rule.
CREATE OR REPLACE FUNCTION public.guard_finished_workshop_price() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.kind='TRANSFER' AND NEW.finished_product_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.locations WHERE id=NEW.source_location_id AND kind='workshop') AND public.is_showroom_location(NEW.destination_location_id)
     AND NOT EXISTS(SELECT 1 FROM public.finished_products p WHERE p.id=NEW.finished_product_id AND p.vendor_receipt_id IS NOT NULL)
     AND NOT EXISTS(SELECT 1 FROM public.finished_product_prices price JOIN public.finished_product_price_reviews review ON review.price_id=price.id WHERE price.finished_product_id=NEW.finished_product_id) THEN
    RAISE EXCEPTION 'Set finished-product SP in Workshop before transfer to Showroom';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.production_piece_context(p_piece uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object(
   'size',coalesce(spec.size,j.size,vp.size),
   'design',coalesce(d.name,spec.custom_design,j.custom_design,vp.vendor_style),
   'design_code',d.code,'production_job_id',j.id,'production_quantity',j.quantity,
   'vendor_receipt_id',vp.receipt_id,'source_kind',CASE WHEN vp.finished_product_id IS NULL THEN 'shop_production' ELSE 'vendor_purchase' END,
   'issued_at',(SELECT min(issued_at) FROM public.material_issues WHERE production_job_id=j.id),
   'finished_at',(SELECT max(recorded_at) FROM public.production_status_events WHERE job_id=j.id AND status='completed'),
   'received_at',coalesce((SELECT recorded_at FROM public.finished_product_receipts WHERE production_job_id=j.id),(SELECT created_at FROM public.vendor_finished_product_receipts WHERE id=vp.receipt_id)),
   'sp_paise',(SELECT sp_paise FROM public.finished_product_prices WHERE finished_product_id=p.id ORDER BY revision DESC LIMIT 1),
   'cp_visible',public.can_view_thaan_cp(NULL),'cp_paise',CASE WHEN public.can_view_thaan_cp(NULL) THEN coalesce(vp.cp_paise,(SELECT a.amount_paise FROM public.finished_product_cost_allocations a JOIN public.production_cost_versions v ON v.id=a.cost_version_id WHERE a.finished_product_id=p.id ORDER BY v.revision DESC LIMIT 1)) END)
 FROM public.finished_products p LEFT JOIN public.production_piece_specs spec ON spec.production_job_id=p.production_job_id AND spec.piece_number=p.piece_number
 LEFT JOIN public.production_jobs j ON j.id=p.production_job_id LEFT JOIN public.designs d ON d.id=p.design_id
 LEFT JOIN public.vendor_finished_product_receipt_pieces vp ON vp.finished_product_id=p.id WHERE p.id=p_piece;
$$;

-- Existing reader APIs must treat vendor pieces like any other priced finished
-- product. The production fields remain null and source_kind identifies them.
DO $$ DECLARE original text; updated text; BEGIN
  original:=pg_get_functiondef('public.finished_product_inventory(uuid,integer)'::regprocedure);
  updated:=replace(original,'LEFT JOIN public.designs design ON design.id=p.design_id JOIN public.production_jobs j ON j.id=p.production_job_id JOIN public.locations','LEFT JOIN public.designs design ON design.id=p.design_id LEFT JOIN public.production_jobs j ON j.id=p.production_job_id JOIN public.locations');
  updated:=replace(updated,'''design'',coalesce(design.name,j.custom_design),''job_id'',j.id,''job_code'',j.code','''design'',public.production_piece_context(p.id)->>''design'',''job_id'',j.id,''job_code'',j.code,''source_kind'',public.production_piece_context(p.id)->>''source_kind''');
  IF updated=original THEN RAISE EXCEPTION 'Finished inventory integration point missing'; END IF; EXECUTE updated;
  original:=pg_get_functiondef('public.finished_product_transfer_scan(text)'::regprocedure);
  updated:=replace(original,'LEFT JOIN public.designs design ON design.id=p.design_id JOIN public.production_jobs j ON j.id=p.production_job_id JOIN public.locations','LEFT JOIN public.designs design ON design.id=p.design_id LEFT JOIN public.production_jobs j ON j.id=p.production_job_id JOIN public.locations');
  updated:=replace(updated,'''design'',coalesce(design.name,j.custom_design),''job_id'',j.id,''job_code'',j.code','''design'',public.production_piece_context(p.id)->>''design'',''job_id'',j.id,''job_code'',j.code,''source_kind'',public.production_piece_context(p.id)->>''source_kind''');
  IF updated=original THEN RAISE EXCEPTION 'Finished transfer integration point missing'; END IF; EXECUTE updated;
  original:=pg_get_functiondef('public.showroom_stock_projection(text)'::regprocedure);
  updated:=replace(original,'JOIN public.production_jobs j ON j.id=p.production_job_id','LEFT JOIN public.production_jobs j ON j.id=p.production_job_id');
  updated:=replace(updated,'''design'',coalesce(d.name,j.custom_design),''size'',j.size','''design'',public.production_piece_context(p.id)->>''design'',''size'',public.production_piece_context(p.id)->>''size''');
  IF updated=original THEN RAISE EXCEPTION 'Showroom projection integration point missing'; END IF; EXECUTE updated;
END $$;

-- The Point of Sale scan obtains the product description through the shared
-- catalog. For vendor pieces, its identical-stock scope is the receipt group.
CREATE OR REPLACE FUNCTION public.finished_product_catalog(p_barcode text DEFAULT NULL,p_job uuid DEFAULT NULL,p_limit integer DEFAULT 100) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE owner boolean:=public.has_role(auth.uid(),'owner'); counter boolean:=public.has_role(auth.uid(),'counter');
BEGIN
 IF NOT(owner OR counter OR public.has_role(auth.uid(),'tailor')) THEN RAISE EXCEPTION 'Owner, Counter or assigned Tailor required'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Limit must be 1 to 100'; END IF;
 RETURN coalesce((SELECT jsonb_agg(row_value ORDER BY row_value->>'created_at',row_value->>'id') FROM (
  SELECT jsonb_build_object('id',f.id,'barcode',b.code,'piece_number',f.piece_number,'product',product.name,'product_id',product.id,
   'design',public.production_piece_context(f.id)->>'design','design_id',f.design_id,'production_job_id',j.id,'production_job',j.code,'job_quantity',j.quantity,'job_status',j.status,
   'vendor_receipt_id',f.vendor_receipt_id,'source_kind',public.production_piece_context(f.id)->>'source_kind','status',f.status,'created_at',f.created_at,
   'location_id',f.current_location_id,'location',loc.name,'inventory_item_id',inv.id,'size',public.production_piece_context(f.id)->>'size',
   'quantity_at_location',CASE WHEN inv.id IS NOT NULL THEN public.inventory_balance(inv.id,f.current_location_id) END,
   'available',f.status='available' AND inv.id IS NOT NULL AND public.inventory_balance(inv.id,f.current_location_id)=1,
   'materials','[]'::jsonb,'production_history','[]'::jsonb,
   'receipt',CASE WHEN f.vendor_receipt_id IS NOT NULL THEN (SELECT jsonb_build_object('supplier',r.supplier_name,'arrival_date',r.arrival_date,'remarks',r.remarks,'vendor_style',vp.vendor_style) FROM public.vendor_finished_product_receipts r JOIN public.vendor_finished_product_receipt_pieces vp ON vp.receipt_id=r.id WHERE vp.finished_product_id=f.id) ELSE (SELECT jsonb_build_object('reason',r.reason,'actor_id',r.actor_id,'recorded_at',r.recorded_at,'workshop_id',r.workshop_id) FROM public.finished_product_receipts r WHERE r.production_job_id=j.id) END,
   'sp_paise',CASE WHEN owner OR counter THEN (SELECT sp_paise FROM public.finished_product_prices WHERE finished_product_id=f.id ORDER BY revision DESC LIMIT 1) END,
   'pricing_status',CASE WHEN EXISTS(SELECT 1 FROM public.finished_product_prices WHERE finished_product_id=f.id) THEN 'priced' ELSE 'not_set' END)
   || CASE WHEN owner AND f.vendor_receipt_id IS NOT NULL THEN jsonb_build_object('vendor_cp_paise',(SELECT cp_paise FROM public.vendor_finished_product_receipt_pieces WHERE finished_product_id=f.id)) ELSE '{}'::jsonb END row_value
  FROM public.finished_products f JOIN public.barcodes b ON b.id=f.barcode_id AND b.kind='product' JOIN public.products product ON product.id=f.product_id
  LEFT JOIN public.production_jobs j ON j.id=f.production_job_id JOIN public.locations loc ON loc.id=f.current_location_id LEFT JOIN public.inventory_items inv ON inv.finished_product_id=f.id
  WHERE (p_barcode IS NULL OR b.code=btrim(p_barcode)) AND (p_job IS NULL OR j.id=p_job) AND (owner OR counter OR (f.production_job_id IS NOT NULL AND public.owns_production_job(f.production_job_id)))
  ORDER BY f.created_at DESC,f.id LIMIT p_limit) x),'[]'::jsonb);
END; $$;

DO $$ DECLARE original text; updated text; BEGIN
  original:=pg_get_functiondef('public.finished_product_sale_scan(text)'::regprocedure);
  updated:=replace(original,'p.current_location_id=l.id AND p.production_job_id=piece.production_job_id','p.current_location_id=l.id AND p.production_job_id IS NOT DISTINCT FROM piece.production_job_id AND p.vendor_receipt_id IS NOT DISTINCT FROM piece.vendor_receipt_id');
  updated:=replace(updated,'''identical_scope'',''production_job''','''identical_scope'',CASE WHEN piece.vendor_receipt_id IS NULL THEN ''production_job'' ELSE ''vendor_receipt'' END');
  IF updated=original THEN RAISE EXCEPTION 'Finished sale scan integration point missing'; END IF; EXECUTE updated;
  original:=pg_get_functiondef('public.complete_counter_bill_multi(uuid,jsonb,jsonb,boolean,uuid,uuid,text,text)'::regprocedure);
  updated:=replace(original,'JOIN public.production_jobs j ON j.id=piece.production_job_id','LEFT JOIN public.production_jobs j ON j.id=piece.production_job_id');
  IF updated=original THEN RAISE EXCEPTION 'Counter bill snapshot integration point missing'; END IF; EXECUTE updated;
END $$;

REVOKE ALL ON FUNCTION public.vendor_finished_receiving_catalog(), public.receive_vendor_finished_products(uuid,text,date,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vendor_finished_receiving_catalog(), public.receive_vendor_finished_products(uuid,text,date,text,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
