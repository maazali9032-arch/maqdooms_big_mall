-- Optional per-Thaan details before barcode printing; preserve historical identities/data.
BEGIN;
ALTER TABLE public.stock_registration_variants ADD COLUMN draft_details jsonb NOT NULL DEFAULT '{}'::jsonb
 CHECK (jsonb_typeof(draft_details)='object' AND (draft_details-'colour'-'length_mm'-'cp')='{}'::jsonb);
CREATE OR REPLACE FUNCTION public.guard_label_variant_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Registered barcode history is permanent'; END IF;
 IF (to_jsonb(NEW)-'details_recorded_at'-'draft_details') IS DISTINCT FROM (to_jsonb(OLD)-'details_recorded_at'-'draft_details') THEN RAISE EXCEPTION 'Registered barcode identity is permanent'; END IF;
 IF NEW.draft_details IS DISTINCT FROM OLD.draft_details THEN
  IF NOT NEW.draft_details @> OLD.draft_details OR NOT EXISTS(SELECT 1 FROM public.stock_registration_requests r WHERE r.action='thaan_partial_details' AND r.actor_id=auth.uid() AND r.result_id=OLD.thaan_id AND r.payload->'details'=NEW.draft_details) THEN RAISE EXCEPTION 'Only authenticated missing-details completion allowed'; END IF;
 END IF;
 IF NEW.details_recorded_at IS DISTINCT FROM OLD.details_recorded_at AND (OLD.details_recorded_at IS NOT NULL OR NEW.details_recorded_at IS NULL OR NOT EXISTS(SELECT 1 FROM public.thaans WHERE id=NEW.thaan_id AND original_mm>0 AND status IN('active','depleted','archived'))) THEN RAISE EXCEPTION 'Only first actual measurement timestamp allowed'; END IF;
 RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION public.complete_barcode_thaan(p_request uuid,p_barcode text,p_colour text,p_length_mm integer,p_cp bigint DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE payload jsonb; result uuid; v public.stock_registration_variants%rowtype; th public.thaans%rowtype; item uuid; workshop uuid; existing_cp bigint; existing_colour text; BEGIN
 payload:=jsonb_build_object('barcode',btrim(p_barcode),'colour',btrim(p_colour),'length_mm',p_length_mm,'cp',p_cp);
 IF NOT public.has_perm(auth.uid(),'stock.measure_thaan') THEN RAISE EXCEPTION 'Actual measurement permission required'; END IF;
 result:=public.registration_request_result(p_request,'measure_thaan',payload); IF result IS NOT NULL THEN RETURN result; END IF;
 IF nullif(btrim(p_colour),'') IS NULL OR p_length_mm IS NULL OR p_length_mm<=0 OR (p_cp IS NOT NULL AND (p_cp<0 OR p_cp>9007199254740991)) THEN RAISE EXCEPTION 'Actual colour, positive millimetres and optional nonnegative CP required'; END IF;
 SELECT * INTO v FROM public.stock_registration_variants WHERE code=btrim(p_barcode) FOR UPDATE;
 IF NOT FOUND OR NOT(public.has_role(auth.uid(),'owner') OR v.created_by=auth.uid()) THEN RAISE EXCEPTION 'Owned registered barcode required to complete details'; END IF;
 IF (v.draft_details ? 'colour' AND v.draft_details->>'colour'<>btrim(p_colour)) OR (v.draft_details ? 'length_mm' AND (v.draft_details->>'length_mm')::integer<>p_length_mm) OR (p_cp IS NOT NULL AND v.draft_details ? 'cp' AND (v.draft_details->>'cp')::bigint<>p_cp) THEN RAISE EXCEPTION 'Saved partial details cannot be overwritten'; END IF;
 p_cp:=coalesce(p_cp,(v.draft_details->>'cp')::bigint);
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
CREATE FUNCTION public.save_registered_thaan_details(p_request uuid,p_barcode text,p_colour text DEFAULT NULL,p_length_mm integer DEFAULT NULL,p_cp bigint DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE payload jsonb; result uuid; v public.stock_registration_variants%rowtype; th public.thaans%rowtype; saved jsonb; input jsonb; key text; actual_colour text; actual_cp bigint; actual_length integer; BEGIN
 IF NOT public.has_perm(auth.uid(),'stock.measure_thaan') THEN RAISE EXCEPTION 'Actual measurement permission required'; END IF;
 input:=jsonb_strip_nulls(jsonb_build_object('colour',nullif(btrim(p_colour),''),'length_mm',p_length_mm,'cp',p_cp));
 IF input='{}'::jsonb OR (p_length_mm IS NOT NULL AND p_length_mm<=0) OR (p_cp IS NOT NULL AND (p_cp<0 OR p_cp>9007199254740991)) THEN RAISE EXCEPTION 'Enter actual colour, positive millimetres or nonnegative CP'; END IF;
 payload:=jsonb_build_object('barcode',btrim(p_barcode),'input',input);
 IF NOT public.can_receive_fabric() OR p_request IS NULL THEN RAISE EXCEPTION 'Authorized Stock Entry and request required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,11));
 IF EXISTS(SELECT 1 FROM public.stock_registration_requests WHERE request_id=p_request) THEN
  SELECT r.result_id INTO result FROM public.stock_registration_requests r WHERE r.request_id=p_request AND r.actor_id=auth.uid() AND r.action='thaan_partial_details' AND r.payload->'barcode'=to_jsonb(btrim(p_barcode)) AND r.payload->'input'=input;
  IF result IS NULL THEN RAISE EXCEPTION 'Request already used by different actor/action/data'; END IF;
  RETURN result;
 END IF;
 SELECT * INTO v FROM public.stock_registration_variants WHERE code=btrim(p_barcode) FOR UPDATE;
 IF NOT FOUND OR NOT(public.has_role(auth.uid(),'owner') OR v.created_by=auth.uid()) THEN RAISE EXCEPTION 'Owned registered barcode required'; END IF;
 SELECT * INTO th FROM public.thaans WHERE id=v.thaan_id FOR UPDATE;
 PERFORM 1 FROM public.fabric_stock WHERE id=v.fabric_stock_id FOR UPDATE;
 SELECT colour INTO actual_colour FROM public.fabrics WHERE id=th.fabric_id;
 SELECT cp_paise_per_m INTO actual_cp FROM public.fabric_stock_costs WHERE fabric_stock_id=v.fabric_stock_id ORDER BY revision DESC LIMIT 1;
 IF (p_length_mm IS NOT NULL AND th.original_mm IS NOT NULL AND p_length_mm<>th.original_mm) OR (nullif(btrim(p_colour),'') IS NOT NULL AND actual_colour IS NOT NULL AND btrim(p_colour)<>actual_colour) OR (p_cp IS NOT NULL AND actual_cp IS NOT NULL AND p_cp<>actual_cp) THEN RAISE EXCEPTION 'Saved actual details cannot be overwritten'; END IF;
 saved:=v.draft_details;
 FOREACH key IN ARRAY ARRAY['colour','length_mm','cp'] LOOP
  IF input ? key THEN
   IF saved ? key AND saved->key IS DISTINCT FROM input->key THEN RAISE EXCEPTION 'Saved detail cannot be overwritten: %',key; END IF;
   saved:=saved||jsonb_build_object(key,input->key);
  END IF;
 END LOOP;
 IF p_cp IS NOT NULL AND actual_cp IS NULL AND th.original_mm IS NOT NULL AND NOT public.has_perm(auth.uid(),'inventory.fill_missing_cp') THEN RAISE EXCEPTION 'Missing CP permission required'; END IF;
 INSERT INTO public.stock_registration_requests VALUES(p_request,'thaan_partial_details',payload||jsonb_build_object('details',saved),th.id,auth.uid(),now());
 UPDATE public.stock_registration_variants SET draft_details=saved WHERE id=v.id AND draft_details IS DISTINCT FROM saved;
 actual_length:=coalesce(th.original_mm,(saved->>'length_mm')::integer);
 actual_colour:=coalesce(actual_colour,saved->>'colour');
 IF actual_length IS NOT NULL AND actual_colour IS NOT NULL THEN
  PERFORM public.complete_barcode_thaan(gen_random_uuid(),v.code,actual_colour,actual_length,coalesce(actual_cp,(saved->>'cp')::bigint));
 END IF;
 RETURN th.id; END; $$;

CREATE FUNCTION public.create_barcode_batch_with_details(p_request uuid,p_provider text,p_arrival_date date,p_remarks text,p_fabrics jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE payload jsonb; result uuid; counts jsonb; row jsonb; detail jsonb; group_id uuid; barcode text; pos integer:=0; n integer; BEGIN
 IF NOT public.has_perm(auth.uid(),'stock.generate_labels') THEN RAISE EXCEPTION 'Label generation permission required'; END IF;
 payload:=jsonb_build_object('provider',btrim(p_provider),'arrival_date',p_arrival_date,'remarks',nullif(btrim(p_remarks),''),'fabrics',p_fabrics);
 result:=public.registration_request_result(p_request,'detailed_label_batch',payload); IF result IS NOT NULL THEN RETURN result; END IF;
 IF jsonb_typeof(p_fabrics) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Fabric array required'; END IF;
 FOR row IN SELECT value FROM jsonb_array_elements(p_fabrics) LOOP
  IF jsonb_typeof(row) IS DISTINCT FROM 'object' OR (row-'name'-'quantity'-'rows')<>'{}'::jsonb THEN RAISE EXCEPTION 'Fabric name/count/optional rows required'; END IF;
  IF row ? 'rows' AND (jsonb_typeof(row->'rows') IS DISTINCT FROM 'array' OR jsonb_array_length(row->'rows')<>(row->>'quantity')::integer) THEN RAISE EXCEPTION 'Details row count must match Thaan count'; END IF;
 END LOOP;
 SELECT jsonb_agg(value-'rows' ORDER BY ord) INTO counts FROM jsonb_array_elements(p_fabrics) WITH ORDINALITY e(value,ord);
 result:=public.create_barcode_batch(gen_random_uuid(),p_provider,p_arrival_date,p_remarks,counts);
 FOR row IN SELECT value FROM jsonb_array_elements(p_fabrics) LOOP
  pos:=pos+1;
  SELECT id INTO group_id FROM public.stock_registration_fabric_types WHERE batch_id=result AND label_position=pos;
  n:=0;
  FOR detail IN SELECT value FROM jsonb_array_elements(coalesce(row->'rows','[]'::jsonb)) LOOP
   n:=n+1;
   IF jsonb_typeof(detail) IS DISTINCT FROM 'object' OR (detail-'colour'-'length_mm'-'cp_paise_per_m')<>'{}'::jsonb THEN RAISE EXCEPTION 'Only actual colour/length/CP allowed'; END IF;
   IF nullif(btrim(detail->>'colour'),'') IS NOT NULL OR detail->>'length_mm' IS NOT NULL OR detail->>'cp_paise_per_m' IS NOT NULL THEN
    SELECT code INTO barcode FROM public.stock_registration_variants WHERE fabric_type_id=group_id AND ordinal=n;
    PERFORM public.save_registered_thaan_details(gen_random_uuid(),barcode,detail->>'colour',(detail->>'length_mm')::integer,(detail->>'cp_paise_per_m')::bigint);
   END IF;
  END LOOP;
 END LOOP;
 INSERT INTO public.stock_registration_requests VALUES(p_request,'detailed_label_batch',payload,result,auth.uid(),now());
 RETURN result; END; $$;
CREATE OR REPLACE FUNCTION public.registered_thaan_details(p_barcode text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.can_receive_fabric() THEN RAISE EXCEPTION 'Authorized Stock Entry required'; END IF;
 RETURN (SELECT jsonb_build_object('code',v.code,'thaan_id',th.id,'stock_id',fs.id,'batch_id',b.id,'batch_code',b.code,'supplier',rb.provider_name,'arrival_date',b.received_on,'remarks',b.notes,'fabric_type_id',g.id,'fabric_type',g.name,'colour',coalesce((SELECT colour FROM public.fabrics WHERE id=th.fabric_id),v.draft_details->>'colour'),'saved_length_mm',coalesce(th.original_mm,(v.draft_details->>'length_mm')::integer),'original_mm',th.original_mm,'status',th.status,'measured',th.original_mm IS NOT NULL,'can_complete',public.has_perm(auth.uid(),'stock.measure_thaan') AND (public.has_role(auth.uid(),'owner') OR v.created_by=auth.uid()),'cp_visible',public.has_role(auth.uid(),'owner') OR (v.created_by=auth.uid() AND public.has_perm(auth.uid(),'inventory.view_registered_cp')),'cp_missing',NOT EXISTS(SELECT 1 FROM public.fabric_stock_costs WHERE fabric_stock_id=fs.id) AND NOT(v.draft_details ? 'cp'),'cp_paise_per_m',CASE WHEN public.has_role(auth.uid(),'owner') OR (v.created_by=auth.uid() AND public.has_perm(auth.uid(),'inventory.view_registered_cp')) THEN coalesce((SELECT cp_paise_per_m FROM public.fabric_stock_costs WHERE fabric_stock_id=fs.id ORDER BY revision DESC LIMIT 1),(v.draft_details->>'cp')::bigint) END,'available_mm',CASE WHEN i.id IS NOT NULL THEN public.inventory_balance(i.id,NULL) END,'locations',coalesce((SELECT jsonb_agg(jsonb_build_object('id',loc.id,'name',loc.name,'quantity_mm',public.inventory_balance(i.id,loc.id)) ORDER BY loc.name,loc.id) FROM public.locations loc WHERE i.id IS NOT NULL AND public.inventory_balance(i.id,loc.id)>0),'[]'::jsonb))
 FROM public.stock_registration_variants v JOIN public.stock_registration_fabric_types g ON g.id=v.fabric_type_id JOIN public.stock_registration_batches rb ON rb.batch_id=g.batch_id JOIN public.receiving_batches b ON b.id=rb.batch_id JOIN public.thaans th ON th.id=v.thaan_id JOIN public.fabric_stock fs ON fs.id=v.fabric_stock_id LEFT JOIN public.inventory_items i ON i.thaan_id=th.id WHERE v.code=btrim(p_barcode));
END; $$;
CREATE OR REPLACE FUNCTION public.stock_registration_catalog(p_batch uuid DEFAULT NULL,p_barcode text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF NOT public.can_receive_fabric() THEN RAISE EXCEPTION 'Authorized Stock Entry required'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(batch) ORDER BY created_at DESC,id),'[]') FROM(
 SELECT rb.batch_id id,b.code,rb.provider_name,rb.provider_prefix,rb.created_at,b.received_on arrival_date,b.notes remarks,
 (SELECT coalesce(jsonb_agg(to_jsonb(group_data) ORDER BY label_position NULLS FIRST,created_at,id),'[]') FROM(
 SELECT g.id,g.code,g.name,g.created_at,g.label_position,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('id',v.id,'code',v.code,'ordinal',v.ordinal,'thaan_id',v.thaan_id,'stock_id',v.fabric_stock_id,'original_mm',th.original_mm,'saved_length_mm',coalesce(th.original_mm,(v.draft_details->>'length_mm')::integer),'colour',coalesce((SELECT colour FROM public.fabrics WHERE id=th.fabric_id),v.draft_details->>'colour'),'status',th.status,'available_mm',CASE WHEN i.id IS NOT NULL THEN public.inventory_balance(i.id,NULL)::text END,'can_fill_cp',(public.has_role(auth.uid(),'owner') OR v.created_by=auth.uid()),'cp_missing',NOT EXISTS(SELECT 1 FROM public.fabric_stock_costs WHERE fabric_stock_id=v.fabric_stock_id),'cp_paise_per_m',CASE WHEN public.has_role(auth.uid(),'owner') THEN (SELECT cp_paise_per_m::text FROM public.fabric_stock_costs WHERE fabric_stock_id=v.fabric_stock_id ORDER BY revision DESC LIMIT 1) END) ORDER BY v.ordinal),'[]') FROM public.stock_registration_variants v JOIN public.thaans th ON th.id=v.thaan_id LEFT JOIN public.inventory_items i ON i.thaan_id=th.id WHERE v.fabric_type_id=g.id) variants
 FROM public.stock_registration_fabric_types g WHERE g.batch_id=rb.batch_id) group_data) fabric_types
 FROM public.stock_registration_batches rb JOIN public.receiving_batches b ON b.id=rb.batch_id
 WHERE (public.has_role(auth.uid(),'owner') OR rb.created_by=auth.uid()) AND (p_batch IS NULL OR rb.batch_id=p_batch)
 AND(p_barcode IS NULL OR EXISTS(SELECT 1 FROM public.stock_registration_variants v JOIN public.stock_registration_fabric_types g ON g.id=v.fabric_type_id WHERE g.batch_id=rb.batch_id AND v.code=btrim(p_barcode)))
 ) batch); END; $$;
CREATE OR REPLACE FUNCTION public.fill_registered_thaan_cp(p_request uuid,p_barcode text,p_cp bigint) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE result uuid; s uuid; draft_cp bigint; payload jsonb; BEGIN
 payload:=jsonb_build_object('barcode',btrim(p_barcode),'cp',p_cp);
 result:=public.registration_request_result(p_request,'fill_cp',payload); IF result IS NOT NULL THEN RETURN result; END IF;
 IF p_cp IS NULL OR p_cp<0 OR p_cp>9007199254740991 THEN RAISE EXCEPTION 'Nonnegative exact CP required'; END IF;
 SELECT v.fabric_stock_id,(v.draft_details->>'cp')::bigint INTO s,draft_cp FROM public.stock_registration_variants v WHERE v.code=btrim(p_barcode) AND (public.has_role(auth.uid(),'owner') OR v.created_by=auth.uid()) FOR UPDATE;
 IF draft_cp IS NOT NULL AND draft_cp<>p_cp THEN RAISE EXCEPTION 'Saved partial CP cannot be overwritten'; END IF;
 IF s IS NULL THEN RAISE EXCEPTION 'Owned registered Than barcode required'; END IF;
 PERFORM 1 FROM public.fabric_stock WHERE id=s FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.fabric_stock_costs WHERE fabric_stock_id=s) THEN RAISE EXCEPTION 'CP already recorded; use Owner correction workflow'; END IF;
 INSERT INTO public.fabric_stock_costs(fabric_stock_id,revision,cp_paise_per_m,recorded_by,reason) VALUES(s,1,p_cp,auth.uid(),'Missing CP entered by scanning registered Than');
 INSERT INTO public.stock_registration_requests VALUES(p_request,'fill_cp',payload,s,auth.uid(),now());
 RETURN s; END; $$;
REVOKE ALL ON FUNCTION public.save_registered_thaan_details(uuid,text,text,integer,bigint),public.create_barcode_batch_with_details(uuid,text,date,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_registered_thaan_details(uuid,text,text,integer,bigint),public.create_barcode_batch_with_details(uuid,text,date,text,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
