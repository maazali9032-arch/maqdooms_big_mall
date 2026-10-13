-- Optional colour and user correction reason; positive measured length activates stock.
-- Existing IDs, original lengths, movements and costs preserved. No data backfill.
-- Existing saved measurement drafts activate only on a subsequent authorised save.
BEGIN;
CREATE OR REPLACE FUNCTION public.workshop_fabric_inventory()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','stock_entry','ecommerce_manager']) THEN RAISE EXCEPTION 'Authorized inventory role required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY batch_created_at DESC,batch_id,group_position NULLS FIRST,group_id,ordinal NULLS LAST,thaan_id) FROM (
 SELECT t.id thaan_id,s.id stock_id,b.id batch_id,b.code batch_code,b.created_at batch_created_at,b.received_on arrival_date,
 coalesce(rb.provider_name,sp.name,'Unknown supplier') supplier,coalesce(g.id::text,f.id::text) group_id,coalesce(g.name,f.name) type_name,g.label_position group_position,
 t.rack,f.design,v.ordinal,coalesce(v.code,t.barcode,bc.code) barcode,(v.id IS NOT NULL) registered,f.name name,coalesce(f.colour,v.draft_details->>'colour') colour,
 t.original_mm,coalesce(t.original_mm,(v.draft_details->>'length_mm')::integer) saved_length_mm,t.status,
 CASE WHEN i.id IS NOT NULL THEN public.inventory_balance(i.id,w.id) END workshop_mm,
 (i.id IS NULL AND t.original_mm IS NOT NULL) unlocated,
 (public.can_view_thaan_cp(s.created_by)) cp_visible,
 CASE WHEN public.can_view_thaan_cp(s.created_by) THEN coalesce(c.cp_paise_per_m,(v.draft_details->>'cp')::bigint) END cp_paise_per_m,
 (nullif(btrim(f.name),'') IS NULL OR nullif(btrim(coalesce(g.name,f.name)),'') IS NULL OR coalesce(t.original_mm,(v.draft_details->>'length_mm')::integer,0)<=0 OR coalesce(c.cp_paise_per_m,(v.draft_details->>'cp')::bigint,0)<=0) incomplete,
 (public.has_perm(auth.uid(),'inventory.edit_thaan') AND public.can_edit_thaan_registration(s.created_by)) can_edit,
 public.has_perm(auth.uid(),'inventory.correct_cp') can_correct_cp,public.has_perm(auth.uid(),'inventory.correct_workshop') can_correct_length,
 public.has_perm(auth.uid(),'inventory.fill_missing_cp') can_fill_cp,
 md5(concat_ws(':',t.xmin::text,f.xmin::text,g.xmin::text,v.xmin::text,coalesce(c.revision,0),CASE WHEN i.id IS NOT NULL THEN public.inventory_balance(i.id,w.id)::text END)) version
 FROM public.thaans t JOIN public.fabric_stock s ON s.id=t.fabric_stock_id JOIN public.fabrics f ON f.id=s.fabric_id
 JOIN public.receiving_batches b ON b.id=s.batch_id JOIN public.barcodes bc ON bc.id=s.barcode_id
 LEFT JOIN public.suppliers sp ON sp.id=b.supplier_id LEFT JOIN public.stock_registration_variants v ON v.thaan_id=t.id
 LEFT JOIN public.stock_registration_fabric_types g ON g.id=v.fabric_type_id LEFT JOIN public.stock_registration_batches rb ON rb.batch_id=b.id
 LEFT JOIN public.inventory_items i ON i.thaan_id=t.id
 LEFT JOIN LATERAL(SELECT revision,cp_paise_per_m FROM public.fabric_stock_costs WHERE fabric_stock_id=s.id ORDER BY revision DESC LIMIT 1)c ON true
 CROSS JOIN(SELECT id FROM public.locations WHERE kind='workshop' AND active)w
 WHERE t.status NOT IN('archived','depleted') AND (t.original_mm IS NULL OR i.id IS NULL OR public.inventory_balance(i.id,w.id)>0)
 )r),'[]'::jsonb); END; $function$
;
CREATE OR REPLACE FUNCTION public.complete_barcode_thaan(p_request uuid, p_barcode text, p_colour text, p_length_mm integer, p_cp bigint DEFAULT NULL::bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE payload jsonb; result uuid; v public.stock_registration_variants%rowtype; th public.thaans%rowtype; item uuid; workshop uuid; existing_cp bigint; existing_colour text; BEGIN
 p_colour:=nullif(btrim(p_colour),'');
 payload:=jsonb_build_object('barcode',btrim(p_barcode),'colour',btrim(p_colour),'length_mm',p_length_mm,'cp',p_cp);
 IF NOT public.has_perm(auth.uid(),'stock.measure_thaan') THEN RAISE EXCEPTION 'Actual measurement permission required'; END IF;
 result:=public.registration_request_result(p_request,'measure_thaan',payload); IF result IS NOT NULL THEN RETURN result; END IF;
 IF p_length_mm IS NULL OR p_length_mm<=0 OR (p_cp IS NOT NULL AND (p_cp<0 OR p_cp>9007199254740991)) THEN RAISE EXCEPTION 'Positive millimetres and optional colour/nonnegative CP required'; END IF;
 SELECT * INTO v FROM public.stock_registration_variants WHERE code=btrim(p_barcode) FOR UPDATE;
 IF NOT FOUND OR NOT public.can_edit_thaan_registration(v.created_by) THEN RAISE EXCEPTION 'Authorised registered barcode required to complete details'; END IF;
 IF (p_colour IS NOT NULL AND v.draft_details ? 'colour' AND v.draft_details->>'colour'<>p_colour) OR (v.draft_details ? 'length_mm' AND (v.draft_details->>'length_mm')::integer<>p_length_mm) OR (p_cp IS NOT NULL AND v.draft_details ? 'cp' AND (v.draft_details->>'cp')::bigint<>p_cp) THEN RAISE EXCEPTION 'Saved partial details cannot be overwritten'; END IF;
 
 IF p_cp IS NOT NULL AND NOT public.can_view_thaan_cp(v.created_by) THEN RAISE EXCEPTION 'Fabric CP entry/view permission required'; END IF;
 SELECT * INTO th FROM public.thaans WHERE id=v.thaan_id FOR UPDATE;
 p_cp:=coalesce(p_cp,(v.draft_details->>'cp')::bigint);
 PERFORM 1 FROM public.fabric_stock WHERE id=v.fabric_stock_id FOR UPDATE;
 IF th.original_mm IS NOT NULL AND th.original_mm IS DISTINCT FROM p_length_mm THEN RAISE EXCEPTION 'Recorded original length cannot be overwritten'; END IF;
 SELECT colour INTO existing_colour FROM public.fabrics WHERE id=th.fabric_id;
 IF p_colour IS NOT NULL AND existing_colour IS NOT NULL AND existing_colour<>p_colour THEN RAISE EXCEPTION 'Recorded colour cannot be overwritten'; END IF;
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
 IF existing_colour IS NULL AND p_colour IS NOT NULL THEN UPDATE public.fabrics SET colour=btrim(p_colour) WHERE id=th.fabric_id; END IF;
 IF v.details_recorded_at IS NULL THEN UPDATE public.stock_registration_variants SET details_recorded_at=now() WHERE id=v.id; END IF;
 IF p_cp IS NOT NULL AND existing_cp IS NULL THEN INSERT INTO public.fabric_stock_costs(fabric_stock_id,revision,cp_paise_per_m,recorded_by,reason) VALUES(v.fabric_stock_id,1,p_cp,auth.uid(),'Actual CP recorded by barcode scan'); END IF;
 RETURN v.thaan_id; END; $function$
;
CREATE OR REPLACE FUNCTION public.save_registered_thaan_details(p_request uuid, p_barcode text, p_colour text DEFAULT NULL::text, p_length_mm integer DEFAULT NULL::integer, p_cp bigint DEFAULT NULL::bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
 IF NOT FOUND OR NOT public.can_edit_thaan_registration(v.created_by) THEN RAISE EXCEPTION 'Authorised registered barcode required'; END IF;
 IF p_cp IS NOT NULL AND NOT public.can_view_thaan_cp(v.created_by) THEN RAISE EXCEPTION 'Fabric CP entry/view permission required'; END IF;
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
 IF actual_length IS NOT NULL THEN
  PERFORM public.complete_barcode_thaan(gen_random_uuid(),v.code,actual_colour,actual_length,p_cp);
 END IF;
 RETURN th.id; END; $function$
;
CREATE OR REPLACE FUNCTION public.edit_workshop_thaan(p_request uuid,p_thaan uuid,p_version text,p_changes jsonb,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.thaans%rowtype; v public.stock_registration_variants%rowtype; current_row jsonb; v_payload jsonb; result uuid; details jsonb; item uuid; workshop uuid; qty integer; balance numeric; cp bigint; oldcp bigint; rev integer; BEGIN
 IF NOT public.can_receive_fabric() OR NOT public.has_perm(auth.uid(),'inventory.edit_thaan') THEN RAISE EXCEPTION 'Inventory editing permission required'; END IF;
 IF jsonb_typeof(p_changes) IS DISTINCT FROM 'object' OR p_changes='{}'::jsonb OR (p_changes-'name'-'type_name'-'colour'-'length_mm'-'cp_paise_per_m')<>'{}'::jsonb THEN RAISE EXCEPTION 'Explicit allowed changes required'; END IF;
 v_payload:=jsonb_build_object('thaan',p_thaan,'version',p_version,'changes',p_changes,'reason',nullif(btrim(p_reason),''));
 IF p_request IS NULL THEN RAISE EXCEPTION 'Request required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,11));
 IF EXISTS(SELECT 1 FROM public.stock_registration_requests WHERE request_id=p_request) THEN
  SELECT r.result_id INTO result FROM public.stock_registration_requests r WHERE r.request_id=p_request AND r.actor_id=auth.uid() AND r.action='inventory_detail_edit' AND r.payload-'details'-'group_id'-'type_name'-'colour'=v_payload;
  IF result IS NULL THEN RAISE EXCEPTION 'Request already used by different actor/action/data'; END IF; RETURN result;
 END IF;
 SELECT * INTO v FROM public.stock_registration_variants WHERE thaan_id=p_thaan FOR UPDATE;
 SELECT * INTO t FROM public.thaans WHERE id=p_thaan FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Thaan required'; END IF;
 IF v.fabric_type_id IS NOT NULL THEN PERFORM 1 FROM public.stock_registration_fabric_types WHERE id=v.fabric_type_id FOR UPDATE; END IF;
 PERFORM 1 FROM public.fabric_stock WHERE id=t.fabric_stock_id FOR UPDATE;
 SELECT id INTO item FROM public.inventory_items WHERE thaan_id=t.id FOR UPDATE;
 SELECT value INTO current_row FROM jsonb_array_elements(public.workshop_fabric_inventory()) WHERE value->>'thaan_id'=p_thaan::text;
 IF current_row IS NULL OR NOT(current_row->>'can_edit')::boolean THEN RAISE EXCEPTION 'Authorized Workshop Thaan required'; END IF;
 IF p_version IS DISTINCT FROM current_row->>'version' THEN RAISE EXCEPTION 'Stock changed; refresh and review before saving'; END IF;
 IF p_changes ? 'name' AND nullif(btrim(p_changes->>'name'),'') IS NULL OR p_changes ? 'type_name' AND nullif(btrim(p_changes->>'type_name'),'') IS NULL OR p_changes ? 'colour' AND nullif(btrim(p_changes->>'colour'),'') IS NULL THEN RAISE EXCEPTION 'Entered names/colour cannot be empty'; END IF;
 IF p_changes ? 'type_name' AND v.id IS NULL THEN RAISE EXCEPTION 'Legacy Fabric Type grouping cannot be reassigned'; END IF;
 details:=coalesce(v.draft_details,'{}'::jsonb);
 IF p_changes ? 'cp_paise_per_m' THEN
  cp:=(p_changes->>'cp_paise_per_m')::bigint;
  IF cp IS NULL OR cp<0 OR cp>9007199254740991 OR NOT(current_row->>'cp_visible')::boolean THEN RAISE EXCEPTION 'Visible exact CP required'; END IF;
  oldcp:=(current_row->>'cp_paise_per_m')::bigint;
  IF NOT(current_row->>'can_correct_cp')::boolean AND NOT(coalesce(oldcp,0)=0 AND (current_row->>'can_fill_cp')::boolean) THEN RAISE EXCEPTION 'CP correction permission required'; END IF;
  details:=details||jsonb_build_object('cp',cp);
 END IF;
 IF p_changes ? 'length_mm' THEN
  qty:=(p_changes->>'length_mm')::integer;
  IF qty IS NULL OR qty<0 OR (t.original_mm IS NULL AND qty=0) THEN RAISE EXCEPTION 'Exact nonnegative Workshop length / positive first measurement required'; END IF;
  IF t.original_mm IS NULL THEN
   IF v.id IS NULL OR NOT public.has_perm(auth.uid(),'stock.measure_thaan') THEN RAISE EXCEPTION 'Registered draft measurement permission required'; END IF;
   details:=details||jsonb_build_object('length_mm',qty);
  ELSIF item IS NULL OR NOT public.has_perm(auth.uid(),'inventory.correct_workshop') THEN RAISE EXCEPTION 'Reconciled Workshop quantity correction permission required'; END IF;
 END IF;
 IF p_changes ? 'colour' THEN details:=details||jsonb_build_object('colour',btrim(p_changes->>'colour')); END IF;
 v_payload:=v_payload||jsonb_build_object('details',details,'group_id',v.fabric_type_id,'type_name',btrim(p_changes->>'type_name'),'colour',btrim(p_changes->>'colour'));
 INSERT INTO public.stock_registration_requests VALUES(p_request,'inventory_detail_edit',v_payload,t.id,auth.uid(),now());
 IF v.id IS NOT NULL THEN UPDATE public.stock_registration_variants SET draft_details=details WHERE id=v.id; END IF;
 IF p_changes ? 'name' THEN UPDATE public.fabrics SET name=btrim(p_changes->>'name') WHERE id=t.fabric_id; END IF;
 IF p_changes ? 'type_name' THEN UPDATE public.stock_registration_fabric_types SET name=btrim(p_changes->>'type_name') WHERE id=v.fabric_type_id; END IF;
 IF t.original_mm IS NULL AND v.id IS NOT NULL THEN
  IF details ? 'length_mm' THEN PERFORM public.complete_barcode_thaan(gen_random_uuid(),v.code,details->>'colour',(details->>'length_mm')::integer,CASE WHEN p_changes ? 'cp_paise_per_m' THEN (details->>'cp')::bigint END); END IF;
 ELSE
  IF p_changes ? 'colour' THEN UPDATE public.fabrics SET colour=btrim(p_changes->>'colour') WHERE id=t.fabric_id; END IF;
  IF p_changes ? 'cp_paise_per_m' AND cp IS DISTINCT FROM oldcp THEN
   SELECT coalesce(max(revision),0)+1 INTO rev FROM public.fabric_stock_costs WHERE fabric_stock_id=t.fabric_stock_id;
   INSERT INTO public.fabric_stock_costs(fabric_stock_id,revision,cp_paise_per_m,recorded_by,reason) VALUES(t.fabric_stock_id,rev,cp,auth.uid(),nullif(btrim(p_reason),''));
  END IF;
  IF p_changes ? 'length_mm' THEN
   SELECT id INTO workshop FROM public.locations WHERE kind='workshop' AND active;
   balance:=public.inventory_balance(item,workshop);
   IF qty<>balance THEN
    INSERT INTO public.inventory_movements(inventory_item_id,thaan_id,fabric_stock_id,kind,quantity,unit,source_location_id,destination_location_id,reason,reference,actor_id)
    VALUES(item,t.id,t.fabric_stock_id,'ADJUSTMENT',abs(qty-balance),'mm',CASE WHEN qty<balance THEN workshop END,CASE WHEN qty>balance THEN workshop END,coalesce(nullif(btrim(p_reason),''),'Workshop balance correction; user reason not recorded'),'INVEDIT:'||p_request::text,auth.uid());
   END IF;
  END IF;
 END IF;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,previous_value,new_value,reference) VALUES(auth.uid(),'edit_workshop_thaan','thaans',t.id,current_row-'cp_paise_per_m',v_payload,'INVEDIT:'||p_request::text);
 RETURN t.id; END; $$;
REVOKE ALL ON FUNCTION public.workshop_fabric_inventory(),public.complete_barcode_thaan(uuid,text,text,integer,bigint),public.save_registered_thaan_details(uuid,text,text,integer,bigint),public.edit_workshop_thaan(uuid,uuid,text,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.workshop_fabric_inventory(),public.complete_barcode_thaan(uuid,text,text,integer,bigint),public.save_registered_thaan_details(uuid,text,text,integer,bigint),public.edit_workshop_thaan(uuid,uuid,text,jsonb,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
