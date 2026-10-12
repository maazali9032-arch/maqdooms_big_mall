-- Approved labels-first Stock Entry. No historical rows or applied migrations changed.
BEGIN;
INSERT INTO public.permissions(key,label,domain) VALUES('stock.generate_labels','Generate fabric barcode labels','inventory'),('stock.measure_thaan','Record actual Thaan measurements','inventory') ON CONFLICT(key) DO NOTHING;
INSERT INTO public.role_permissions(role_key,permission_key) VALUES('stock_entry','stock.generate_labels'),('stock_entry','stock.measure_thaan') ON CONFLICT DO NOTHING;
INSERT INTO public.permissions(key,label,domain) VALUES('inventory.view_registered_cp','View CP on own registered Thaans','inventory') ON CONFLICT(key) DO NOTHING;
INSERT INTO public.role_permissions(role_key,permission_key) VALUES('stock_entry','inventory.view_registered_cp') ON CONFLICT DO NOTHING;
ALTER TABLE public.stock_registration_fabric_types ADD COLUMN label_position integer CHECK(label_position IS NULL OR label_position>0);
ALTER TABLE public.stock_registration_variants ADD COLUMN details_recorded_at timestamptz;
CREATE FUNCTION public.guard_label_variant_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Registered barcode history is permanent'; END IF;
 IF (to_jsonb(NEW)-'details_recorded_at') IS DISTINCT FROM (to_jsonb(OLD)-'details_recorded_at') OR OLD.details_recorded_at IS NOT NULL OR NEW.details_recorded_at IS NULL THEN RAISE EXCEPTION 'Only first actual colour recording is allowed; barcode identity is permanent'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.thaans WHERE id=NEW.thaan_id AND original_mm>0 AND status IN('active','depleted','archived')) THEN RAISE EXCEPTION 'Measured physical Than required'; END IF;
 RETURN NEW; END; $$;
DROP TRIGGER registration_variants_immutable ON public.stock_registration_variants;
CREATE TRIGGER registration_variants_immutable BEFORE UPDATE OR DELETE ON public.stock_registration_variants FOR EACH ROW EXECUTE FUNCTION public.guard_label_variant_history();
CREATE OR REPLACE FUNCTION public.registration_operational_identity_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE registered boolean; BEGIN
 IF TG_TABLE_NAME='thaans' THEN
  IF TG_OP='INSERT' THEN
   IF EXISTS(SELECT 1 FROM public.stock_registration_variants WHERE fabric_stock_id=NEW.fabric_stock_id) THEN RAISE EXCEPTION 'Registered barcode already identifies its physical Than'; END IF;
   RETURN NEW;
  END IF;
  registered:=EXISTS(SELECT 1 FROM public.stock_registration_variants WHERE thaan_id=OLD.id);
  IF registered AND TG_OP='DELETE' THEN RAISE EXCEPTION 'Registered Than history is permanent'; END IF;
  IF registered AND (NEW.barcode IS NOT NULL OR NEW.price_paise IS NOT NULL OR (NEW.id,NEW.fabric_id,NEW.batch_id,NEW.fabric_stock_id,NEW.created_by) IS DISTINCT FROM(OLD.id,OLD.fabric_id,OLD.batch_id,OLD.fabric_stock_id,OLD.created_by)) THEN RAISE EXCEPTION 'Registered Than identity/length is permanent; use ledger corrections'; END IF;
  IF registered AND NEW.original_mm IS DISTINCT FROM OLD.original_mm AND NOT (OLD.original_mm IS NULL AND OLD.status='draft' AND NEW.original_mm>0 AND NEW.status='active' AND EXISTS(SELECT 1 FROM public.stock_registration_requests r JOIN public.stock_registration_variants v ON v.thaan_id=OLD.id WHERE r.action='measure_thaan' AND r.actor_id=auth.uid() AND r.result_id=OLD.id AND r.payload->>'barcode'=v.code AND (r.payload->>'length_mm')::integer=NEW.original_mm) AND NOT EXISTS(SELECT 1 FROM public.inventory_items WHERE thaan_id=OLD.id)) THEN RAISE EXCEPTION 'Original length can be measured once, before inventory receipt'; END IF;
  IF registered AND OLD.original_mm IS NULL AND NEW.original_mm IS NULL AND NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'Unmeasured registered stock must remain draft'; END IF;
 ELSIF TG_TABLE_NAME='fabric_stock' THEN
  registered:=EXISTS(SELECT 1 FROM public.stock_registration_variants WHERE fabric_stock_id=OLD.id);
  IF registered AND TG_OP='DELETE' THEN RAISE EXCEPTION 'Registered barcode stock is permanent'; END IF;
  IF registered AND (NEW.id,NEW.fabric_id,NEW.batch_id,NEW.barcode_id,NEW.created_by) IS DISTINCT FROM(OLD.id,OLD.fabric_id,OLD.batch_id,OLD.barcode_id,OLD.created_by) THEN RAISE EXCEPTION 'Registered barcode ownership and identity are permanent'; END IF;
 ELSE
  registered:=EXISTS(SELECT 1 FROM public.stock_registration_variants v JOIN public.fabric_stock s ON s.id=v.fabric_stock_id WHERE s.fabric_id=OLD.id);
  IF registered AND TG_OP='DELETE' THEN RAISE EXCEPTION 'Registered Fabric identity is permanent'; END IF;
  IF registered AND NEW.code IS DISTINCT FROM OLD.code THEN RAISE EXCEPTION 'Registered Fabric code is permanent'; END IF;
  IF registered AND NEW.colour IS DISTINCT FROM OLD.colour AND NOT (OLD.colour IS NULL AND nullif(btrim(NEW.colour),'') IS NOT NULL AND EXISTS(SELECT 1 FROM public.stock_registration_requests r JOIN public.stock_registration_variants v ON v.thaan_id=r.result_id JOIN public.fabric_stock fs ON fs.id=v.fabric_stock_id WHERE fs.fabric_id=OLD.id AND r.action='measure_thaan' AND r.actor_id=auth.uid() AND r.payload->>'barcode'=v.code AND r.payload->>'colour'=btrim(NEW.colour))) THEN RAISE EXCEPTION 'Actual registered colour can be recorded once by barcode measurement'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION public.registration_insert_thans(p_group uuid,p_rows jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g public.stock_registration_fabric_types%rowtype; row jsonb; code text; f uuid; b uuid; s uuid; th uuid; item uuid; workshop uuid; length_mm numeric; cp bigint; BEGIN
 SELECT * INTO g FROM public.stock_registration_fabric_types WHERE id=p_group FOR UPDATE;
 IF NOT FOUND OR NOT public.can_receive_fabric() OR NOT public.has_perm(auth.uid(),'stock.generate_labels') OR NOT(public.has_role(auth.uid(),'owner') OR g.created_by=auth.uid()) THEN RAISE EXCEPTION 'Owned registered Fabric Type required'; END IF;
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Add 1–500 Thans per submission; more can be added later'; END IF;
 SELECT id INTO workshop FROM public.locations WHERE kind='workshop' AND active;
 IF workshop IS NULL THEN RAISE EXCEPTION 'Active Workshop required'; END IF;
 FOR row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  IF jsonb_typeof(row) IS DISTINCT FROM 'object' OR (row-'length_mm'-'cp_paise_per_m')<>'{}'::jsonb THEN RAISE EXCEPTION 'Only length and optional CP allowed'; END IF;
  length_mm:=(row->>'length_mm')::numeric; cp:=(row->>'cp_paise_per_m')::bigint;
  IF (length_mm IS NOT NULL AND (length_mm<=0 OR length_mm<>trunc(length_mm) OR length_mm>2147483647)) OR (length_mm IS NULL AND cp IS NOT NULL) OR (cp IS NOT NULL AND (cp<0 OR cp>9007199254740991)) THEN RAISE EXCEPTION 'Positive exact millimetres and optional nonnegative CP required'; END IF;
  IF length_mm IS NOT NULL AND NOT public.has_perm(auth.uid(),'stock.measure_thaan') THEN RAISE EXCEPTION 'Actual measurement permission required'; END IF;
  code:=g.code||public.registration_variant_suffix(g.next_ordinal);
  INSERT INTO public.fabrics(code,name) VALUES(code,g.name) RETURNING id INTO f;
  INSERT INTO public.barcodes(code,kind,created_by) VALUES(code,'fabric',auth.uid()) RETURNING id INTO b;
  INSERT INTO public.fabric_stock(fabric_id,batch_id,barcode_id,created_by) VALUES(f,g.batch_id,b,auth.uid()) RETURNING id INTO s;
  INSERT INTO public.thaans(fabric_id,batch_id,fabric_stock_id,original_mm,status,created_by) VALUES(f,g.batch_id,s,length_mm::integer,'draft',auth.uid()) RETURNING id INTO th;
  IF cp IS NOT NULL THEN
   INSERT INTO public.fabric_stock_costs(fabric_stock_id,revision,cp_paise_per_m,recorded_by,reason) VALUES(s,1,cp,auth.uid(),'CP recorded during Than registration');
  END IF;
  IF length_mm IS NOT NULL THEN
  UPDATE public.thaans SET status='active',updated_at=now() WHERE id=th;
  INSERT INTO public.inventory_items(thaan_id,unit,legacy_quantity_snapshot,reconciled_by,reason) VALUES(th,'mm',0,auth.uid(),'Registered physical Than') RETURNING id INTO item;
  INSERT INTO public.inventory_movements(inventory_item_id,thaan_id,fabric_stock_id,kind,quantity,unit,destination_location_id,reason,reference,actor_id) VALUES(item,th,s,'INWARD',length_mm,'mm',workshop,'Registered physical Than received','REGISTRATION:'||code,auth.uid());
  UPDATE public.fabric_stock SET entry_state='complete' WHERE id=s;
  END IF;
  INSERT INTO public.stock_registration_variants(fabric_type_id,ordinal,code,fabric_stock_id,thaan_id,created_by) VALUES(g.id,g.next_ordinal,code,s,th,auth.uid());
  g.next_ordinal:=g.next_ordinal+1;
 END LOOP;
 UPDATE public.stock_registration_fabric_types SET next_ordinal=g.next_ordinal WHERE id=g.id;
END; $$;
CREATE OR REPLACE FUNCTION public.register_fabric_type(p_request uuid,p_batch uuid,p_name text,p_rows jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result uuid; prefix text; candidate text; payload jsonb; attempt integer:=0; BEGIN
 payload:=jsonb_build_object('batch',p_batch,'name',btrim(p_name),'rows',p_rows);
 result:=public.registration_request_result(p_request,'fabric',payload); IF result IS NOT NULL THEN RETURN result; END IF;
 IF p_name IS NULL OR btrim(p_name)='' THEN RAISE EXCEPTION 'Fabric Type name required'; END IF;
 SELECT provider_prefix INTO prefix FROM public.stock_registration_batches WHERE batch_id=p_batch AND (public.has_role(auth.uid(),'owner') OR created_by=auth.uid()) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Owned registered batch required'; END IF;
 LOOP
  attempt:=attempt+1; IF attempt>100 THEN RAISE EXCEPTION 'Could not allocate unique fabric code; retry'; END IF;
  candidate:=prefix||'-'||(10000000+floor(random()*90000000)::bigint)::text;
  IF EXISTS(SELECT 1 FROM public.barcodes WHERE code LIKE candidate||'%') OR EXISTS(SELECT 1 FROM public.fabrics WHERE code LIKE candidate||'%') THEN CONTINUE; END IF;
  INSERT INTO public.stock_registration_fabric_types(batch_id,code,name,created_by,label_position) VALUES(p_batch,candidate,btrim(p_name),auth.uid(),(SELECT coalesce(max(label_position),0)+1 FROM public.stock_registration_fabric_types WHERE batch_id=p_batch)) ON CONFLICT(code) DO NOTHING RETURNING id INTO result;
  EXIT WHEN result IS NOT NULL;
 END LOOP;
 PERFORM public.registration_insert_thans(result,p_rows);
 INSERT INTO public.stock_registration_requests VALUES(p_request,'fabric',payload,result,auth.uid(),now());
 RETURN result; END; $$;
CREATE FUNCTION public.create_barcode_batch(p_request uuid,p_provider text,p_arrival_date date,p_remarks text,p_fabrics jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE payload jsonb; result uuid; row jsonb; qty numeric; total numeric:=0; BEGIN
 payload:=jsonb_build_object('provider',btrim(p_provider),'arrival_date',p_arrival_date,'remarks',nullif(btrim(p_remarks),''),'fabrics',p_fabrics);
 IF NOT public.has_perm(auth.uid(),'stock.generate_labels') THEN RAISE EXCEPTION 'Label generation permission required'; END IF;
 result:=public.registration_request_result(p_request,'label_batch',payload); IF result IS NOT NULL THEN RETURN result; END IF;
 IF p_arrival_date IS NULL OR jsonb_typeof(p_fabrics) IS DISTINCT FROM 'array' OR jsonb_array_length(p_fabrics) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Arrival date and 1–100 Fabric Types required'; END IF;
 FOR row IN SELECT value FROM jsonb_array_elements(p_fabrics) LOOP
  qty:=(row->>'quantity')::numeric;
  IF jsonb_typeof(row) IS DISTINCT FROM 'object' OR (row-'name'-'quantity')<>'{}'::jsonb OR nullif(btrim(row->>'name'),'') IS NULL OR qty IS NULL OR qty<>trunc(qty) OR qty NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Each Fabric Type needs a name and 1–500 whole Thans'; END IF;
  total:=total+qty;
 END LOOP;
 IF total>5000 THEN RAISE EXCEPTION 'Generate up to 5000 labels per batch submission'; END IF;
 IF (SELECT count(DISTINCT lower(btrim(value->>'name'))) FROM jsonb_array_elements(p_fabrics))<>jsonb_array_length(p_fabrics) THEN RAISE EXCEPTION 'Combine repeated Fabric Type names into one quantity'; END IF;
 result:=public.register_delivery_batch(gen_random_uuid(),p_provider);
 UPDATE public.receiving_batches SET received_on=p_arrival_date,notes=nullif(btrim(p_remarks),'') WHERE id=result;
 FOR row IN SELECT value FROM jsonb_array_elements(p_fabrics) LOOP
  PERFORM public.register_fabric_type(gen_random_uuid(),result,btrim(row->>'name'),(SELECT jsonb_agg(jsonb_build_object('length_mm',NULL,'cp_paise_per_m',NULL)) FROM generate_series(1,(row->>'quantity')::integer)));
 END LOOP;
 INSERT INTO public.stock_registration_requests VALUES(p_request,'label_batch',payload,result,auth.uid(),now());
 RETURN result; END; $$;
CREATE FUNCTION public.complete_barcode_thaan(p_request uuid,p_barcode text,p_colour text,p_length_mm integer,p_cp bigint DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE payload jsonb; result uuid; v public.stock_registration_variants%rowtype; th public.thaans%rowtype; item uuid; workshop uuid; existing_cp bigint; existing_colour text; BEGIN
 payload:=jsonb_build_object('barcode',btrim(p_barcode),'colour',btrim(p_colour),'length_mm',p_length_mm,'cp',p_cp);
 IF NOT public.has_perm(auth.uid(),'stock.measure_thaan') THEN RAISE EXCEPTION 'Actual measurement permission required'; END IF;
 result:=public.registration_request_result(p_request,'measure_thaan',payload); IF result IS NOT NULL THEN RETURN result; END IF;
 IF nullif(btrim(p_colour),'') IS NULL OR p_length_mm IS NULL OR p_length_mm<=0 OR (p_cp IS NOT NULL AND (p_cp<0 OR p_cp>9007199254740991)) THEN RAISE EXCEPTION 'Actual colour, positive millimetres and optional nonnegative CP required'; END IF;
 SELECT * INTO v FROM public.stock_registration_variants WHERE code=btrim(p_barcode) FOR UPDATE;
 IF NOT FOUND OR NOT(public.has_role(auth.uid(),'owner') OR v.created_by=auth.uid()) THEN RAISE EXCEPTION 'Owned registered barcode required to complete details'; END IF;
 SELECT * INTO th FROM public.thaans WHERE id=v.thaan_id FOR UPDATE;
 PERFORM 1 FROM public.fabric_stock WHERE id=v.fabric_stock_id FOR UPDATE;
 IF th.original_mm IS NOT NULL AND th.original_mm IS DISTINCT FROM p_length_mm THEN RAISE EXCEPTION 'Recorded original length cannot be overwritten'; END IF;
 SELECT colour INTO existing_colour FROM public.fabrics WHERE id=th.fabric_id;
 IF existing_colour IS NOT NULL AND existing_colour<>btrim(p_colour) THEN RAISE EXCEPTION 'Recorded colour cannot be overwritten'; END IF;
 SELECT cp_paise_per_m INTO existing_cp FROM public.fabric_stock_costs WHERE fabric_stock_id=v.fabric_stock_id ORDER BY revision DESC LIMIT 1;
 IF p_cp IS NOT NULL AND existing_cp IS NOT NULL AND existing_cp<>p_cp THEN RAISE EXCEPTION 'Recorded CP cannot be overwritten'; END IF;
 IF p_cp IS NOT NULL AND existing_cp IS NULL AND th.original_mm IS NOT NULL AND NOT public.has_perm(auth.uid(),'inventory.fill_missing_cp') THEN RAISE EXCEPTION 'Missing CP permission required'; END IF;
 INSERT INTO public.stock_registration_requests VALUES(p_request,'measure_thaan',payload,v.thaan_id,auth.uid(),now());
 IF th.original_mm IS NULL THEN
  IF th.status<>'draft' OR EXISTS(SELECT 1 FROM public.inventory_items WHERE thaan_id=th.id) THEN RAISE EXCEPTION 'Unmeasured draft Than required'; END IF;
  SELECT id INTO workshop FROM public.locations WHERE kind='workshop' AND active FOR UPDATE;
  IF workshop IS NULL THEN RAISE EXCEPTION 'Active Workshop required'; END IF;
  UPDATE public.thaans SET original_mm=p_length_mm,status='active',updated_at=now() WHERE id=th.id;
  INSERT INTO public.inventory_items(thaan_id,unit,legacy_quantity_snapshot,reconciled_by,reason) VALUES(th.id,'mm',0,auth.uid(),'Barcode Than actual measurement') RETURNING id INTO item;
  INSERT INTO public.inventory_movements(inventory_item_id,thaan_id,fabric_stock_id,kind,quantity,unit,destination_location_id,reason,reference,actor_id) VALUES(item,th.id,v.fabric_stock_id,'INWARD',p_length_mm,'mm',workshop,'Actual measured Than received','MEASURED:'||v.code,auth.uid());
  UPDATE public.fabric_stock SET entry_state='complete' WHERE id=v.fabric_stock_id;
 END IF;
 IF existing_colour IS NULL THEN UPDATE public.fabrics SET colour=btrim(p_colour) WHERE id=th.fabric_id; END IF;
 IF v.details_recorded_at IS NULL THEN UPDATE public.stock_registration_variants SET details_recorded_at=now() WHERE id=v.id; END IF;
 IF p_cp IS NOT NULL AND existing_cp IS NULL THEN INSERT INTO public.fabric_stock_costs(fabric_stock_id,revision,cp_paise_per_m,recorded_by,reason) VALUES(v.fabric_stock_id,1,p_cp,auth.uid(),'Actual CP recorded by barcode scan'); END IF;
 RETURN v.thaan_id; END; $$;
CREATE FUNCTION public.registered_thaan_details(p_barcode text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.can_receive_fabric() THEN RAISE EXCEPTION 'Authorized Stock Entry required'; END IF;
 RETURN (SELECT jsonb_build_object('code',v.code,'thaan_id',th.id,'stock_id',fs.id,'batch_id',b.id,'batch_code',b.code,'supplier',rb.provider_name,'arrival_date',b.received_on,'remarks',b.notes,'fabric_type_id',g.id,'fabric_type',g.name,'colour',(SELECT colour FROM public.fabrics WHERE id=th.fabric_id),'original_mm',th.original_mm,'status',th.status,'measured',th.original_mm IS NOT NULL,'can_complete',public.has_perm(auth.uid(),'stock.measure_thaan') AND (public.has_role(auth.uid(),'owner') OR v.created_by=auth.uid()),'cp_visible',public.has_role(auth.uid(),'owner') OR (v.created_by=auth.uid() AND public.has_perm(auth.uid(),'inventory.view_registered_cp')),'cp_missing',NOT EXISTS(SELECT 1 FROM public.fabric_stock_costs WHERE fabric_stock_id=fs.id),'cp_paise_per_m',CASE WHEN public.has_role(auth.uid(),'owner') OR (v.created_by=auth.uid() AND public.has_perm(auth.uid(),'inventory.view_registered_cp')) THEN (SELECT cp_paise_per_m FROM public.fabric_stock_costs WHERE fabric_stock_id=fs.id ORDER BY revision DESC LIMIT 1) END,'available_mm',CASE WHEN i.id IS NOT NULL THEN public.inventory_balance(i.id,NULL) END,'locations',coalesce((SELECT jsonb_agg(jsonb_build_object('id',loc.id,'name',loc.name,'quantity_mm',public.inventory_balance(i.id,loc.id)) ORDER BY loc.name,loc.id) FROM public.locations loc WHERE i.id IS NOT NULL AND public.inventory_balance(i.id,loc.id)>0),'[]'::jsonb))
 FROM public.stock_registration_variants v JOIN public.stock_registration_fabric_types g ON g.id=v.fabric_type_id JOIN public.stock_registration_batches rb ON rb.batch_id=g.batch_id JOIN public.receiving_batches b ON b.id=rb.batch_id JOIN public.thaans th ON th.id=v.thaan_id JOIN public.fabric_stock fs ON fs.id=v.fabric_stock_id LEFT JOIN public.inventory_items i ON i.thaan_id=th.id WHERE v.code=btrim(p_barcode));
END; $$;
CREATE OR REPLACE FUNCTION public.stock_registration_catalog(p_batch uuid DEFAULT NULL,p_barcode text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF NOT public.can_receive_fabric() THEN RAISE EXCEPTION 'Authorized Stock Entry required'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(batch) ORDER BY created_at DESC,id),'[]') FROM(
 SELECT rb.batch_id id,b.code,rb.provider_name,rb.provider_prefix,rb.created_at,b.received_on arrival_date,b.notes remarks,
 (SELECT coalesce(jsonb_agg(to_jsonb(group_data) ORDER BY label_position NULLS FIRST,created_at,id),'[]') FROM(
 SELECT g.id,g.code,g.name,g.created_at,g.label_position,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('id',v.id,'code',v.code,'ordinal',v.ordinal,'thaan_id',v.thaan_id,'stock_id',v.fabric_stock_id,'original_mm',th.original_mm,'colour',(SELECT colour FROM public.fabrics WHERE id=th.fabric_id),'status',th.status,'available_mm',CASE WHEN i.id IS NOT NULL THEN public.inventory_balance(i.id,NULL)::text END,'can_fill_cp',(public.has_role(auth.uid(),'owner') OR v.created_by=auth.uid()),'cp_missing',NOT EXISTS(SELECT 1 FROM public.fabric_stock_costs WHERE fabric_stock_id=v.fabric_stock_id),'cp_paise_per_m',CASE WHEN public.has_role(auth.uid(),'owner') THEN (SELECT cp_paise_per_m::text FROM public.fabric_stock_costs WHERE fabric_stock_id=v.fabric_stock_id ORDER BY revision DESC LIMIT 1) END) ORDER BY v.ordinal),'[]') FROM public.stock_registration_variants v JOIN public.thaans th ON th.id=v.thaan_id LEFT JOIN public.inventory_items i ON i.thaan_id=th.id WHERE v.fabric_type_id=g.id) variants
 FROM public.stock_registration_fabric_types g WHERE g.batch_id=rb.batch_id) group_data) fabric_types
 FROM public.stock_registration_batches rb JOIN public.receiving_batches b ON b.id=rb.batch_id
 WHERE (public.has_role(auth.uid(),'owner') OR rb.created_by=auth.uid()) AND (p_batch IS NULL OR rb.batch_id=p_batch)
 AND(p_barcode IS NULL OR EXISTS(SELECT 1 FROM public.stock_registration_variants v JOIN public.stock_registration_fabric_types g ON g.id=v.fabric_type_id WHERE g.batch_id=rb.batch_id AND v.code=btrim(p_barcode)))
 ) batch); END; $$;
CREATE OR REPLACE FUNCTION public.fabric_stock_catalog(p_barcode text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter','stock_entry','ecommerce_manager']) THEN RAISE EXCEPTION 'Active operational role required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(x ORDER BY x->>'fabric_name',x->>'batch_code') FROM (
 SELECT jsonb_build_object('id',s.id,'fabric_id',f.id,'fabric_code',f.code,'fabric_name',f.name,'colour',f.colour,
 'batch_id',b.id,'batch_code',b.code,'barcode',bc.code,'entry_state',s.entry_state,'created_by',s.created_by,
 'sp_paise_per_m',(SELECT sp_paise_per_m FROM public.fabric_stock_prices WHERE fabric_stock_id=s.id ORDER BY revision DESC LIMIT 1),
 'original_mm',coalesce((SELECT sum(original_mm) FROM public.thaans WHERE fabric_stock_id=s.id),0),
 'available_mm',coalesce((SELECT sum(CASE WHEN i.id IS NOT NULL THEN public.inventory_balance(i.id,NULL)
 ELSE coalesce((SELECT sum(delta_mm) FROM public.stock_movements WHERE thaan_id=t.id),0) END)
 FROM public.thaans t LEFT JOIN public.inventory_items i ON i.thaan_id=t.id WHERE t.fabric_stock_id=s.id),0),
 'unlocated_thans',(SELECT count(*) FROM public.thaans t WHERE fabric_stock_id=s.id AND status IN ('active','depleted') AND NOT EXISTS(SELECT 1 FROM public.inventory_items WHERE thaan_id=t.id)),
 'thans',coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.id,'original_mm',t.original_mm,'status',t.status) ORDER BY t.created_at,t.id) FROM public.thaans t WHERE t.fabric_stock_id=s.id),'[]'::jsonb),
 'locations',coalesce((SELECT jsonb_agg(jsonb_build_object('id',z.id,'name',z.name,'quantity_mm',z.qty)) FROM (
 SELECT l.id,l.name,sum(CASE WHEN m.destination_location_id=l.id THEN m.quantity ELSE -m.quantity END) qty
 FROM public.inventory_movements m JOIN public.locations l ON l.id IN (m.source_location_id,m.destination_location_id)
 WHERE m.fabric_stock_id=s.id AND m.inventory_item_id IS NOT NULL GROUP BY l.id,l.name
 HAVING sum(CASE WHEN m.destination_location_id=l.id THEN m.quantity ELSE -m.quantity END)<>0) z),'[]'::jsonb)) x
 FROM public.fabric_stock s JOIN public.fabrics f ON f.id=s.fabric_id JOIN public.receiving_batches b ON b.id=s.batch_id JOIN public.barcodes bc ON bc.id=s.barcode_id
 WHERE p_barcode IS NULL OR bc.code=btrim(p_barcode)) q),'[]'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.guard_label_variant_history() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.create_barcode_batch(uuid,text,date,text,jsonb),public.complete_barcode_thaan(uuid,text,text,integer,bigint),public.registered_thaan_details(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_barcode_batch(uuid,text,date,text,jsonb),public.complete_barcode_thaan(uuid,text,text,integer,bigint),public.registered_thaan_details(text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
