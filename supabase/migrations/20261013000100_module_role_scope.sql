-- Module/action scope replaces creator-based stock access. Preserve all IDs, authors and history.
BEGIN;
CREATE OR REPLACE FUNCTION public.permission_role_restriction(p_user uuid,p_permission text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT CASE WHEN public.has_role(p_user,'owner') THEN NULL
 WHEN p_permission IN('inventory.view_cost','tailoring.view_costs','reports.view','audit.view','access.manage','pos.override_price_or_discount','stock.adjust','stock.return_from_tailor') THEN 'Owner-only: personal overrides cannot grant this action'
 WHEN p_permission IN('inventory.edit_others_thaans','inventory.view_others_cp','inventory.correct_others_cp') THEN 'Superseded: stock access now follows module/action permissions, not record creator'
 WHEN p_permission LIKE 'inventory.%' OR p_permission LIKE 'stock.%' THEN CASE WHEN NOT public.has_role(p_user,'stock_entry') THEN 'Stock Entry role required' END
 WHEN p_permission LIKE 'ecommerce.%' THEN CASE WHEN NOT public.has_role(p_user,'ecommerce_manager') THEN 'E-commerce role required' END
 WHEN p_permission LIKE 'pos.%' THEN CASE WHEN NOT public.has_role(p_user,'counter') THEN 'Counter role required' END
 WHEN p_permission='salesperson.view_work' AND NOT public.has_role(p_user,'salesperson') THEN 'Salesperson role required'
 WHEN p_permission='tailoring.manage_jobs' AND NOT public.has_any_role(p_user,ARRAY['counter','tailor']) THEN 'Counter or Tailor role required'
 ELSE NULL END;
$$;
CREATE OR REPLACE FUNCTION public.can_edit_thaan_registration(p_creator uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.can_receive_fabric() AND public.has_perm(auth.uid(),'inventory.edit_thaan');
$$;
CREATE OR REPLACE FUNCTION public.can_view_thaan_cp(p_creator uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.is_active_staff(auth.uid()) AND (public.has_role(auth.uid(),'owner') OR public.has_perm(auth.uid(),'inventory.view_registered_cp'));
$$;
CREATE OR REPLACE FUNCTION public.can_change_others_thaan_cp(p_creator uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.can_edit_thaan_registration(p_creator) AND public.can_view_thaan_cp(p_creator) AND public.has_perm(auth.uid(),'inventory.correct_cp');
$$;
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
 (nullif(btrim(f.name),'') IS NULL OR nullif(btrim(coalesce(g.name,f.name)),'') IS NULL OR nullif(btrim(coalesce(f.colour,v.draft_details->>'colour')),'') IS NULL OR coalesce(t.original_mm,(v.draft_details->>'length_mm')::integer,0)<=0 OR coalesce(c.cp_paise_per_m,(v.draft_details->>'cp')::bigint,0)<=0) incomplete,
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
 payload:=jsonb_build_object('barcode',btrim(p_barcode),'colour',btrim(p_colour),'length_mm',p_length_mm,'cp',p_cp);
 IF NOT public.has_perm(auth.uid(),'stock.measure_thaan') THEN RAISE EXCEPTION 'Actual measurement permission required'; END IF;
 result:=public.registration_request_result(p_request,'measure_thaan',payload); IF result IS NOT NULL THEN RETURN result; END IF;
 IF nullif(btrim(p_colour),'') IS NULL OR p_length_mm IS NULL OR p_length_mm<=0 OR (p_cp IS NOT NULL AND (p_cp<0 OR p_cp>9007199254740991)) THEN RAISE EXCEPTION 'Actual colour, positive millimetres and optional nonnegative CP required'; END IF;
 SELECT * INTO v FROM public.stock_registration_variants WHERE code=btrim(p_barcode) FOR UPDATE;
 IF NOT FOUND OR NOT public.can_edit_thaan_registration(v.created_by) THEN RAISE EXCEPTION 'Authorised registered barcode required to complete details'; END IF;
 IF (v.draft_details ? 'colour' AND v.draft_details->>'colour'<>btrim(p_colour)) OR (v.draft_details ? 'length_mm' AND (v.draft_details->>'length_mm')::integer<>p_length_mm) OR (p_cp IS NOT NULL AND v.draft_details ? 'cp' AND (v.draft_details->>'cp')::bigint<>p_cp) THEN RAISE EXCEPTION 'Saved partial details cannot be overwritten'; END IF;
 
 IF p_cp IS NOT NULL AND NOT public.can_view_thaan_cp(v.created_by) THEN RAISE EXCEPTION 'Fabric CP entry/view permission required'; END IF;
 SELECT * INTO th FROM public.thaans WHERE id=v.thaan_id FOR UPDATE;
 p_cp:=coalesce(p_cp,(v.draft_details->>'cp')::bigint);
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
 IF actual_length IS NOT NULL AND actual_colour IS NOT NULL THEN
  PERFORM public.complete_barcode_thaan(gen_random_uuid(),v.code,actual_colour,actual_length,p_cp);
 END IF;
 RETURN th.id; END; $function$
;
CREATE OR REPLACE FUNCTION public.registered_thaan_details(p_barcode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF NOT public.can_receive_fabric() THEN RAISE EXCEPTION 'Authorized Stock Entry required'; END IF;
 RETURN (SELECT jsonb_build_object('code',v.code,'thaan_id',th.id,'stock_id',fs.id,'batch_id',b.id,'batch_code',b.code,'supplier',rb.provider_name,'arrival_date',b.received_on,'remarks',b.notes,'fabric_type_id',g.id,'fabric_type',g.name,'colour',coalesce((SELECT colour FROM public.fabrics WHERE id=th.fabric_id),v.draft_details->>'colour'),'saved_length_mm',coalesce(th.original_mm,(v.draft_details->>'length_mm')::integer),'original_mm',th.original_mm,'status',th.status,'measured',th.original_mm IS NOT NULL,'can_complete',public.has_perm(auth.uid(),'stock.measure_thaan') AND public.can_edit_thaan_registration(v.created_by),'can_set_cp',public.can_view_thaan_cp(v.created_by),'cp_visible',public.can_view_thaan_cp(v.created_by),'cp_missing',NOT EXISTS(SELECT 1 FROM public.fabric_stock_costs WHERE fabric_stock_id=fs.id) AND NOT(v.draft_details ? 'cp'),'cp_paise_per_m',CASE WHEN public.can_view_thaan_cp(v.created_by) THEN coalesce((SELECT cp_paise_per_m FROM public.fabric_stock_costs WHERE fabric_stock_id=fs.id ORDER BY revision DESC LIMIT 1),(v.draft_details->>'cp')::bigint) END,'available_mm',CASE WHEN i.id IS NOT NULL THEN public.inventory_balance(i.id,NULL) END,'locations',coalesce((SELECT jsonb_agg(jsonb_build_object('id',loc.id,'name',loc.name,'quantity_mm',public.inventory_balance(i.id,loc.id)) ORDER BY loc.name,loc.id) FROM public.locations loc WHERE i.id IS NOT NULL AND public.inventory_balance(i.id,loc.id)>0),'[]'::jsonb))
 FROM public.stock_registration_variants v JOIN public.stock_registration_fabric_types g ON g.id=v.fabric_type_id JOIN public.stock_registration_batches rb ON rb.batch_id=g.batch_id JOIN public.receiving_batches b ON b.id=rb.batch_id JOIN public.thaans th ON th.id=v.thaan_id JOIN public.fabric_stock fs ON fs.id=v.fabric_stock_id LEFT JOIN public.inventory_items i ON i.thaan_id=th.id WHERE v.code=btrim(p_barcode));
END; $function$
;
CREATE OR REPLACE FUNCTION public.fill_registered_thaan_cp(p_request uuid, p_barcode text, p_cp bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ DECLARE result uuid; s uuid; draft_cp bigint; payload jsonb; BEGIN
 payload:=jsonb_build_object('barcode',btrim(p_barcode),'cp',p_cp);
 result:=public.registration_request_result(p_request,'fill_cp',payload); IF result IS NOT NULL THEN RETURN result; END IF;
 IF NOT public.has_perm(auth.uid(),'inventory.fill_missing_cp') THEN RAISE EXCEPTION 'Missing CP entry permission required'; END IF;
 IF p_cp IS NULL OR p_cp<0 OR p_cp>9007199254740991 THEN RAISE EXCEPTION 'Nonnegative exact CP required'; END IF;
 SELECT v.fabric_stock_id,(v.draft_details->>'cp')::bigint INTO s,draft_cp FROM public.stock_registration_variants v WHERE v.code=btrim(p_barcode) AND (public.can_edit_thaan_registration(v.created_by) AND public.can_view_thaan_cp(v.created_by)) FOR UPDATE;
 IF draft_cp IS NOT NULL AND draft_cp<>p_cp THEN RAISE EXCEPTION 'Saved partial CP cannot be overwritten'; END IF;
 IF s IS NULL THEN RAISE EXCEPTION 'Authorised registered Than barcode required'; END IF;
 PERFORM 1 FROM public.fabric_stock WHERE id=s FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.fabric_stock_costs WHERE fabric_stock_id=s) THEN RAISE EXCEPTION 'CP already recorded; use Owner correction workflow'; END IF;
 INSERT INTO public.fabric_stock_costs(fabric_stock_id,revision,cp_paise_per_m,recorded_by,reason) VALUES(s,1,p_cp,auth.uid(),'Missing CP entered by scanning registered Than');
 INSERT INTO public.stock_registration_requests VALUES(p_request,'fill_cp',payload,s,auth.uid(),now());
 RETURN s; END; $function$
;
CREATE OR REPLACE FUNCTION public.stock_registration_catalog(p_batch uuid DEFAULT NULL::uuid, p_barcode text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ BEGIN
 IF NOT public.can_receive_fabric() THEN RAISE EXCEPTION 'Authorized Stock Entry required'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(to_jsonb(batch) ORDER BY created_at DESC,id),'[]') FROM(
 SELECT rb.batch_id id,b.code,rb.provider_name,rb.provider_prefix,rb.created_at,b.received_on arrival_date,b.notes remarks,
 (SELECT coalesce(jsonb_agg(to_jsonb(group_data) ORDER BY label_position NULLS FIRST,created_at,id),'[]') FROM(
 SELECT g.id,g.code,g.name,g.created_at,g.label_position,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('id',v.id,'code',v.code,'ordinal',v.ordinal,'thaan_id',v.thaan_id,'stock_id',v.fabric_stock_id,'original_mm',th.original_mm,'saved_length_mm',coalesce(th.original_mm,(v.draft_details->>'length_mm')::integer),'colour',coalesce((SELECT colour FROM public.fabrics WHERE id=th.fabric_id),v.draft_details->>'colour'),'status',th.status,'available_mm',CASE WHEN i.id IS NOT NULL THEN public.inventory_balance(i.id,NULL)::text END,'can_fill_cp',public.has_perm(auth.uid(),'inventory.fill_missing_cp'),'cp_missing',NOT EXISTS(SELECT 1 FROM public.fabric_stock_costs WHERE fabric_stock_id=v.fabric_stock_id),'cp_paise_per_m',CASE WHEN public.can_view_thaan_cp(v.created_by) THEN (SELECT cp_paise_per_m::text FROM public.fabric_stock_costs WHERE fabric_stock_id=v.fabric_stock_id ORDER BY revision DESC LIMIT 1) END) ORDER BY v.ordinal),'[]') FROM public.stock_registration_variants v JOIN public.thaans th ON th.id=v.thaan_id LEFT JOIN public.inventory_items i ON i.thaan_id=th.id WHERE v.fabric_type_id=g.id) variants
 FROM public.stock_registration_fabric_types g WHERE g.batch_id=rb.batch_id) group_data) fabric_types
 FROM public.stock_registration_batches rb JOIN public.receiving_batches b ON b.id=rb.batch_id
 WHERE (p_batch IS NULL OR rb.batch_id=p_batch)
 AND(p_barcode IS NULL OR EXISTS(SELECT 1 FROM public.stock_registration_variants v JOIN public.stock_registration_fabric_types g ON g.id=v.fabric_type_id WHERE g.batch_id=rb.batch_id AND v.code=btrim(p_barcode)))
 ) batch); END; $function$
;
CREATE OR REPLACE FUNCTION public.registration_insert_thans(p_group uuid, p_rows jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE g public.stock_registration_fabric_types%rowtype; row jsonb; code text; f uuid; b uuid; s uuid; th uuid; item uuid; workshop uuid; length_mm numeric; cp bigint; BEGIN
 SELECT * INTO g FROM public.stock_registration_fabric_types WHERE id=p_group FOR UPDATE;
 IF NOT FOUND OR NOT public.can_receive_fabric() OR NOT public.has_perm(auth.uid(),'stock.generate_labels') THEN RAISE EXCEPTION 'Authorised registered Fabric Type required'; END IF;
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
END; $function$
;
CREATE OR REPLACE FUNCTION public.register_fabric_type(p_request uuid, p_batch uuid, p_name text, p_rows jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE result uuid; prefix text; candidate text; payload jsonb; attempt integer:=0; BEGIN
 payload:=jsonb_build_object('batch',p_batch,'name',btrim(p_name),'rows',p_rows);
 result:=public.registration_request_result(p_request,'fabric',payload); IF result IS NOT NULL THEN RETURN result; END IF;
 IF NOT public.can_receive_fabric() OR NOT public.has_perm(auth.uid(),'stock.generate_labels') THEN RAISE EXCEPTION 'Stock label generation permission required'; END IF;
 IF p_name IS NULL OR btrim(p_name)='' THEN RAISE EXCEPTION 'Fabric Type name required'; END IF;
 SELECT provider_prefix INTO prefix FROM public.stock_registration_batches WHERE batch_id=p_batch FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Registered batch required'; END IF;
 LOOP
  attempt:=attempt+1; IF attempt>100 THEN RAISE EXCEPTION 'Could not allocate unique fabric code; retry'; END IF;
  candidate:=prefix||'-'||(10000000+floor(random()*90000000)::bigint)::text;
  IF EXISTS(SELECT 1 FROM public.barcodes WHERE code LIKE candidate||'%') OR EXISTS(SELECT 1 FROM public.fabrics WHERE code LIKE candidate||'%') THEN CONTINUE; END IF;
  INSERT INTO public.stock_registration_fabric_types(batch_id,code,name,created_by,label_position) VALUES(p_batch,candidate,btrim(p_name),auth.uid(),(SELECT coalesce(max(label_position),0)+1 FROM public.stock_registration_fabric_types WHERE batch_id=p_batch)) ON CONFLICT(code) DO NOTHING RETURNING id INTO result;
  EXIT WHEN result IS NOT NULL;
 END LOOP;
 PERFORM public.registration_insert_thans(result,p_rows);
 INSERT INTO public.stock_registration_requests VALUES(p_request,'fabric',payload,result,auth.uid(),now());
 RETURN result; END; $function$
;
CREATE OR REPLACE FUNCTION public.stock_transfer_history(p_stock uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','stock_entry']) OR NOT public.has_perm(auth.uid(),'stock.transfer') THEN RAISE EXCEPTION 'Transfer permission required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.posted_at DESC,x.id DESC) FROM (
 SELECT t.id,t.code,t.status,t.request_id,t.source_location_id,s.name source_name,
 t.destination_location_id,d.name destination_name,t.reason,t.created_by,t.created_at,t.posted_at,
 coalesce((SELECT jsonb_agg(jsonb_build_object('id',l.id,'fabric_stock_id',l.fabric_stock_id,
 'thaan_id',l.thaan_id,'material_id',l.material_id,'finished_product_id',l.finished_product_id,
 'quantity',l.quantity,'unit',l.unit,'barcode',bc.code,'fabric_name',f.name,'batch_code',b.code,
 'movement_id',m.id,'actor_id',m.actor_id,'occurred_at',m.occurred_at) ORDER BY l.id)
 FROM public.stock_transfer_lines l
 LEFT JOIN public.fabric_stock fs ON fs.id=l.fabric_stock_id
 LEFT JOIN public.barcodes bc ON bc.id=fs.barcode_id
 LEFT JOIN public.fabrics f ON f.id=fs.fabric_id
 LEFT JOIN public.receiving_batches b ON b.id=fs.batch_id
 LEFT JOIN public.inventory_movements m ON m.stock_transfer_line_id=l.id
 WHERE l.transfer_id=t.id),'[]'::jsonb) lines
 FROM public.stock_transfers t JOIN public.locations s ON s.id=t.source_location_id
 JOIN public.locations d ON d.id=t.destination_location_id
 WHERE t.status='posted' AND (p_stock IS NULL OR EXISTS(
 SELECT 1 FROM public.stock_transfer_lines l WHERE l.transfer_id=t.id AND l.fabric_stock_id=p_stock))
 ORDER BY t.posted_at DESC,t.id DESC LIMIT greatest(1,least(coalesce(p_limit,50),200))) x),'[]'::jsonb);
END; $function$
;
CREATE OR REPLACE FUNCTION public.can_enter_legacy_cp(p_thaan uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 SELECT public.has_role(auth.uid(),'owner') OR (
 public.has_role(auth.uid(),'stock_entry') AND public.has_perm(auth.uid(),'inventory.receive') AND EXISTS(
 SELECT 1 FROM public.thaans t JOIN public.receiving_batches b ON b.id=t.batch_id
 WHERE t.id=p_thaan AND b.status='draft' AND t.status='draft'));
$function$
;
CREATE OR REPLACE FUNCTION public.guard_receiving_authorization()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF auth.uid() IS NULL THEN
   IF current_setting('role') IN ('anon','authenticated') THEN RAISE EXCEPTION 'Authentication required'; END IF;
   RETURN NEW; -- migration/service maintenance; no browser bypass
 END IF;
 IF public.has_role(auth.uid(),'owner') THEN RETURN NEW; END IF;
 -- Only receipt-marked first measurement can pass another registrant's legacy guard.
 IF TG_TABLE_NAME='thaans' AND TG_OP='UPDATE' THEN
 IF OLD.original_mm IS NULL AND OLD.status='draft'
 AND NEW.original_mm>0 AND NEW.status='active'
 AND (to_jsonb(NEW)-'original_mm'-'status'-'updated_at')=(to_jsonb(OLD)-'original_mm'-'status'-'updated_at')
 AND public.can_edit_thaan_registration(OLD.created_by) AND public.has_perm(auth.uid(),'stock.measure_thaan')
 AND EXISTS(SELECT 1 FROM public.stock_registration_requests r JOIN public.stock_registration_variants v ON v.thaan_id=OLD.id
 WHERE r.action='measure_thaan' AND r.actor_id=auth.uid() AND r.result_id=OLD.id
 AND r.payload->>'barcode'=v.code AND (r.payload->>'length_mm')::integer=NEW.original_mm)
 AND NOT EXISTS(SELECT 1 FROM public.inventory_items WHERE thaan_id=OLD.id) THEN RETURN NEW; END IF;
 END IF;

 -- Existing sale/issue RPCs may mark exhausted stock depleted. No other
 -- inventory field may change through this authorization exception.
 IF TG_TABLE_NAME='thaans' AND TG_OP='UPDATE' AND OLD.status='active' AND NEW.status='depleted'
 AND public.has_any_role(auth.uid(),ARRAY['counter','tailor'])
 AND (to_jsonb(NEW)-'status'-'updated_at')=(to_jsonb(OLD)-'status'-'updated_at') THEN RETURN NEW; END IF;
 IF NOT public.has_role(auth.uid(),'stock_entry') OR NOT public.has_perm(auth.uid(),'inventory.receive') THEN
   RAISE EXCEPTION 'Stock Entry role required';
 END IF;
 IF TG_TABLE_NAME='receiving_batches' THEN
   IF TG_OP='INSERT' THEN NEW.created_by:=auth.uid();
   ELSIF OLD.status<>'draft'
      OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN RAISE EXCEPTION 'Authorised open receiving workflow required'; END IF;
 ELSE
   IF TG_OP='INSERT' THEN
     NEW.created_by:=auth.uid();
     IF NEW.price_paise IS NOT NULL OR NEW.status<>'draft' THEN RAISE EXCEPTION 'Only Owner controls SP and activation'; END IF;
   ELSE
     IF NOT public.can_enter_legacy_cp(OLD.id) OR NEW.created_by IS DISTINCT FROM OLD.created_by
        OR NEW.batch_id IS DISTINCT FROM OLD.batch_id THEN RAISE EXCEPTION 'Authorised open receiving workflow required'; END IF;
     IF NEW.price_paise IS DISTINCT FROM OLD.price_paise THEN RAISE EXCEPTION 'Only Owner controls SP'; END IF;
   END IF;
   IF NOT EXISTS(SELECT 1 FROM public.receiving_batches WHERE id=NEW.batch_id AND status='draft') THEN
     RAISE EXCEPTION 'Authorised open receiving workflow required'; END IF;
 END IF;
 RETURN NEW;
END; $function$
;
CREATE OR REPLACE FUNCTION public.guard_phase4_fabric_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF TG_TABLE_NAME='fabric_stock' THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Fabric Stock identity is permanent'; END IF;
  IF EXISTS(SELECT 1 FROM public.fabric_entry_requests WHERE fabric_stock_id=OLD.id)
  AND NEW.created_by IS DISTINCT FROM OLD.created_by THEN RAISE EXCEPTION 'Stock entry ownership is permanent'; END IF;
 ELSE
  IF TG_OP='INSERT' AND auth.uid() IS NOT NULL AND NEW.barcode IS NOT NULL THEN
   RAISE EXCEPTION 'New stock uses one Fabric + Batch barcode, not per-Than labels'; END IF;
  IF EXISTS(SELECT 1 FROM public.fabric_entry_requests WHERE fabric_stock_id=coalesce(NEW.fabric_stock_id,OLD.fabric_stock_id)) THEN
   IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Internal Than history is permanent'; END IF;
   IF NEW.barcode IS NOT NULL OR NEW.price_paise IS NOT NULL THEN RAISE EXCEPTION 'Use one Fabric Barcode and Owner Fabric Stock SP'; END IF;
   IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(),'owner') AND NOT EXISTS(
    SELECT 1 FROM public.fabric_stock WHERE id=NEW.fabric_stock_id AND public.can_receive_fabric() AND public.has_perm(auth.uid(),'inventory.edit_thaan') AND entry_state='draft') THEN
    IF NOT (TG_OP='UPDATE' AND public.has_role(auth.uid(),'counter') AND OLD.status='active' AND NEW.status='depleted'
     AND (to_jsonb(NEW)-'status'-'updated_at')=(to_jsonb(OLD)-'status'-'updated_at')
     AND EXISTS(SELECT 1 FROM public.inventory_items i WHERE i.thaan_id=NEW.id AND public.inventory_balance(i.id,NULL)=0))
    THEN RAISE EXCEPTION 'Owned open Fabric Stock draft required for internal Than edits'; END IF;
   END IF;
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $function$
;
CREATE OR REPLACE FUNCTION public.domain_stock_entry_cp(p_stock_id uuid, p_cp bigint DEFAULT NULL::bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE s public.fabric_stock%rowtype; v_revision integer; v_cp bigint;
BEGIN
 SELECT * INTO s FROM public.fabric_stock WHERE id=p_stock_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Stock record not found'; END IF;
 IF p_cp IS NULL THEN
 IF NOT public.can_view_thaan_cp(NULL) THEN RAISE EXCEPTION 'Fabric CP viewing permission required'; END IF;
 ELSIF NOT public.has_role(auth.uid(),'owner') AND NOT (
 public.has_role(auth.uid(),'stock_entry') AND public.has_perm(auth.uid(),'inventory.receive')
 AND public.has_perm(auth.uid(),'inventory.edit_thaan') AND public.has_perm(auth.uid(),'inventory.view_registered_cp') AND s.entry_state IN ('draft','correcting')) THEN
 RAISE EXCEPTION 'Authorised open stock-entry workflow required'; END IF;
 SELECT revision,cp_paise_per_m INTO v_revision,v_cp FROM public.fabric_stock_costs
 WHERE fabric_stock_id=s.id ORDER BY revision DESC LIMIT 1;
 IF p_cp IS NOT NULL THEN
   IF p_cp<0 THEN RAISE EXCEPTION 'Nonnegative CP required'; END IF;
   INSERT INTO public.fabric_stock_costs(fabric_stock_id,revision,cp_paise_per_m,recorded_by,reason)
   VALUES(s.id,coalesce(v_revision,0)+1,p_cp,auth.uid(),'Stock-entry workflow CP edit');
   v_cp:=p_cp;
 END IF;
 RETURN v_cp;
END; $function$
;
CREATE OR REPLACE FUNCTION public.create_fabric_entry(p_request_id uuid, p_fabric uuid, p_batch uuid, p_lengths jsonb, p_cp bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_stock uuid; v_barcode uuid; v_payload jsonb; v_existing public.fabric_entry_requests%rowtype; r jsonb; v_length numeric;
BEGIN
 IF NOT public.can_receive_fabric() THEN RAISE EXCEPTION 'Stock Entry or Owner required'; END IF;
 IF p_request_id IS NULL OR p_cp IS NULL OR p_cp<0 OR p_cp>9007199254740991 OR
 jsonb_typeof(p_lengths) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Request ID, CP and Than lengths required'; END IF;
 IF jsonb_array_length(p_lengths) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Enter 1 to 500 internal Thans'; END IF;
 v_payload:=jsonb_build_object('fabric',p_fabric,'batch',p_batch,'lengths',p_lengths,'cp',p_cp);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,4));
 SELECT * INTO v_existing FROM public.fabric_entry_requests WHERE request_id=p_request_id;
 IF FOUND THEN
  IF NOT public.has_role(auth.uid(),'owner') AND v_existing.created_by<>auth.uid() THEN RAISE EXCEPTION 'Request belongs to another workflow'; END IF;
  IF v_existing.payload IS DISTINCT FROM v_payload THEN RAISE EXCEPTION 'Request ID reused with different entry data'; END IF;
  RETURN v_existing.fabric_stock_id;
 END IF;
 PERFORM 1 FROM public.receiving_batches WHERE id=p_batch AND status='draft'
 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Open receiving batch required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.fabrics WHERE id=p_fabric) THEN RAISE EXCEPTION 'Fabric required'; END IF;
 IF EXISTS(SELECT 1 FROM public.fabric_stock WHERE fabric_id=p_fabric AND batch_id=p_batch) THEN RAISE EXCEPTION 'Fabric + Batch already exists; edit its existing stock record'; END IF;
 -- UUID identity avoids resetting a sequence and remains stable across SP edits.
 v_stock:=gen_random_uuid();
 INSERT INTO public.barcodes(code,kind,created_by) VALUES('FAB-'||replace(v_stock::text,'-',''),'fabric',auth.uid()) RETURNING id INTO v_barcode;
 INSERT INTO public.fabric_stock(id,fabric_id,batch_id,barcode_id,entry_state,created_by)
 VALUES(v_stock,p_fabric,p_batch,v_barcode,'draft',auth.uid());
 FOR r IN SELECT value FROM jsonb_array_elements(p_lengths) LOOP
  v_length:=(r#>>'{}')::numeric;
  IF v_length IS NULL OR v_length<=0 OR v_length<>trunc(v_length) OR v_length>2147483647 THEN RAISE EXCEPTION 'Each Than needs a positive integer millimetre length'; END IF;
  INSERT INTO public.thaans(fabric_id,batch_id,fabric_stock_id,original_mm,status,created_by)
  VALUES(p_fabric,p_batch,v_stock,v_length::integer,'draft',auth.uid());
 END LOOP;
 PERFORM public.domain_stock_entry_cp(v_stock,p_cp);
 INSERT INTO public.fabric_entry_requests(request_id,fabric_stock_id,created_by,payload) VALUES(p_request_id,v_stock,auth.uid(),v_payload);
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference)
 VALUES(auth.uid(),'create_fabric_entry','fabric_stock',v_stock,v_payload,'ENTRY:'||p_request_id::text);
 RETURN v_stock;
END; $function$
;
CREATE OR REPLACE FUNCTION public.update_fabric_entry(p_stock uuid, p_lengths jsonb, p_cp bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE s public.fabric_stock%rowtype; r jsonb; v_q numeric;
BEGIN
 IF NOT public.can_receive_fabric() THEN RAISE EXCEPTION 'Stock Entry or Owner required'; END IF;
 SELECT * INTO s FROM public.fabric_stock WHERE id=p_stock FOR UPDATE;
 IF NOT FOUND OR s.entry_state<>'draft' OR NOT EXISTS(SELECT 1 FROM public.fabric_entry_requests WHERE fabric_stock_id=s.id)
 THEN RAISE EXCEPTION 'Authorised new-model draft required'; END IF;
 PERFORM 1 FROM public.receiving_batches WHERE id=s.batch_id AND status='draft' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Open receiving batch required'; END IF;
 IF jsonb_typeof(p_lengths) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Internal Than rows required'; END IF;
 IF jsonb_array_length(p_lengths)<>(SELECT count(*) FROM public.thaans WHERE fabric_stock_id=s.id)
 OR (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_lengths))<>jsonb_array_length(p_lengths) THEN RAISE EXCEPTION 'Supply each existing Than exactly once'; END IF;
 PERFORM 1 FROM public.thaans WHERE fabric_stock_id=s.id ORDER BY id FOR UPDATE;
 FOR r IN SELECT value FROM jsonb_array_elements(p_lengths) LOOP
  v_q:=(r->>'length_mm')::numeric;
  IF v_q IS NULL OR v_q<=0 OR v_q<>trunc(v_q) OR v_q>2147483647 THEN RAISE EXCEPTION 'Positive integer Than length required'; END IF;
  UPDATE public.thaans SET original_mm=v_q::integer,updated_at=now() WHERE id=(r->>'id')::uuid AND fabric_stock_id=s.id AND status='draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'Draft Than must belong to this stock'; END IF;
 END LOOP;
 IF p_cp IS NULL OR p_cp>9007199254740991 THEN RAISE EXCEPTION 'CP required within supported money range'; END IF;
 PERFORM public.domain_stock_entry_cp(s.id,p_cp);
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value)
 VALUES(auth.uid(),'update_fabric_entry','fabric_stock',s.id,jsonb_build_object('lengths',p_lengths,'cp',p_cp));
END; $function$
;
CREATE OR REPLACE FUNCTION public.complete_fabric_entry(p_stock uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE s public.fabric_stock%rowtype; t public.thaans%rowtype; v_item uuid; v_workshop uuid;
BEGIN
 IF NOT public.can_receive_fabric() THEN RAISE EXCEPTION 'Stock Entry or Owner required'; END IF;
 SELECT * INTO s FROM public.fabric_stock WHERE id=p_stock FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Authorised workflow required'; END IF;
 IF s.entry_state='complete' THEN RETURN s.id; END IF;
 IF s.entry_state='legacy_pending' THEN RAISE EXCEPTION 'Legacy stock requires explicit reconciliation, not new receipt'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.fabric_stock_costs WHERE fabric_stock_id=s.id) THEN RAISE EXCEPTION 'CP required before completion'; END IF;
 IF s.entry_state='draft' THEN
  IF NOT EXISTS(SELECT 1 FROM public.fabric_entry_requests WHERE fabric_stock_id=s.id) THEN RAISE EXCEPTION 'New-model entry required'; END IF;
  PERFORM 1 FROM public.receiving_batches WHERE id=s.batch_id AND status='draft' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Open receiving batch required'; END IF;
  SELECT id INTO v_workshop FROM public.locations WHERE kind='workshop' AND active;
  IF v_workshop IS NULL THEN RAISE EXCEPTION 'Active Workshop required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.thaans WHERE fabric_stock_id=s.id) THEN RAISE EXCEPTION 'Internal Thans required'; END IF;
  FOR t IN SELECT * FROM public.thaans WHERE fabric_stock_id=s.id ORDER BY id FOR UPDATE LOOP
   IF t.status<>'draft' OR t.original_mm IS NULL OR t.original_mm<=0 OR t.barcode IS NOT NULL
   OR EXISTS(SELECT 1 FROM public.stock_movements WHERE thaan_id=t.id)
   OR EXISTS(SELECT 1 FROM public.inventory_items WHERE thaan_id=t.id) THEN RAISE EXCEPTION 'Clean internal draft Than required'; END IF;
   UPDATE public.thaans SET status='active',updated_at=now() WHERE id=t.id;
   INSERT INTO public.inventory_items(thaan_id,unit,legacy_quantity_snapshot,reconciled_by,reason)
   VALUES(t.id,'mm',0,auth.uid(),'New fabric received into Workshop') RETURNING id INTO v_item;
   INSERT INTO public.inventory_movements(inventory_item_id,kind,thaan_id,fabric_stock_id,quantity,unit,destination_location_id,reference,reason,actor_id)
   VALUES(v_item,'INWARD',t.id,s.id,t.original_mm,'mm',v_workshop,'RECEIPT:'||s.id::text,'New fabric received into Workshop',auth.uid());
  END LOOP;
 END IF;
 UPDATE public.fabric_stock SET entry_state='complete' WHERE id=s.id;
 -- A batch may contain several fabrics; do not close unrelated draft work.
 IF NOT EXISTS(SELECT 1 FROM public.fabric_stock WHERE batch_id=s.batch_id AND entry_state IN ('draft','legacy_pending'))
 AND NOT EXISTS(SELECT 1 FROM public.thaans WHERE batch_id=s.batch_id AND status='draft') THEN
  UPDATE public.receiving_batches SET status='committed',committed_at=coalesce(committed_at,now()) WHERE id=s.batch_id AND status='draft';
 END IF;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value)
 VALUES(auth.uid(),'complete_fabric_entry','fabric_stock',s.id,jsonb_build_object('previous_state',s.entry_state,'state','complete'));
 RETURN s.id;
END; $function$
;
CREATE OR REPLACE FUNCTION public.create_customer_tailoring(p_request uuid, p_quote uuid, p_customer uuid, p_assignment uuid, p_garment text, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE qt public.customer_tailoring_quotes%rowtype; j public.customer_tailoring_jobs%rowtype;
 payload jsonb; r jsonb; v_job uuid:=gen_random_uuid(); v_order uuid:=gen_random_uuid(); v_issue uuid; v_line uuid; v_item uuid; contact jsonb;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) OR NOT public.has_perm(auth.uid(),'pos.issue_to_tailoring') THEN RAISE EXCEPTION 'Authorized Owner or Counter required'; END IF;
 IF p_request IS NULL OR nullif(btrim(p_garment),'') IS NULL THEN RAISE EXCEPTION 'Request and garment required'; END IF;
 payload:=jsonb_build_object('quote',p_quote,'customer',p_customer,'assignment',p_assignment,'garment',btrim(p_garment),'notes',nullif(btrim(p_notes),''));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,7));
 SELECT * INTO j FROM public.customer_tailoring_jobs WHERE request_id=p_request;
 IF FOUND THEN
  IF j.request_payload IS DISTINCT FROM payload OR (j.created_by IS DISTINCT FROM auth.uid() AND NOT public.has_role(auth.uid(),'owner')) THEN RAISE EXCEPTION 'Request reused with different data or actor'; END IF;
  RETURN j.id;
 END IF;
 SELECT * INTO qt FROM public.customer_tailoring_quotes WHERE id=p_quote FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Tailoring quote required'; END IF;
 IF EXISTS(SELECT 1 FROM public.customer_tailoring_jobs WHERE quote_id=p_quote) THEN RAISE EXCEPTION 'Quote already booked; inspect existing job'; END IF;
 SELECT jsonb_build_object('id',id,'name',name,'phone',phone,'whatsapp_phone',whatsapp_phone) INTO contact FROM public.customers WHERE id=p_customer FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Customer required'; END IF;
 PERFORM 1 FROM public.tailor_assignments a JOIN public.tailors t ON t.id=a.tailor_id JOIN public.tailoring_factories f ON f.id=a.factory_id
 LEFT JOIN public.tailoring_sections s ON s.id=a.section_id WHERE a.id=p_assignment AND a.valid_until IS NULL AND a.valid_from<=now() AND t.active AND f.active
 AND (s.id IS NULL OR s.active) AND (t.profile_id IS NULL OR public.has_role(t.profile_id,'tailor')) FOR UPDATE OF a,t,f;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active Factory / Section / Tailor assignment required'; END IF;
 -- Section activity is locked too, while allowing no-section assignments.
 PERFORM 1 FROM public.tailoring_sections WHERE id=(SELECT section_id FROM public.tailor_assignments WHERE id=p_assignment) FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.tailoring_sections WHERE id=(SELECT section_id FROM public.tailor_assignments WHERE id=p_assignment) AND NOT active) THEN RAISE EXCEPTION 'Active Section required'; END IF;
 PERFORM 1 FROM public.tailoring_charges WHERE id=(SELECT charge_id FROM public.tailoring_charge_versions WHERE id=qt.charge_version_id) AND active FOR UPDATE;
 IF NOT FOUND OR qt.charge_version_id IS DISTINCT FROM (SELECT id FROM public.tailoring_charge_versions WHERE charge_id=(SELECT charge_id FROM public.tailoring_charge_versions WHERE id=qt.charge_version_id) ORDER BY revision DESC LIMIT 1) THEN RAISE EXCEPTION 'Charge changed; calculate a new quote'; END IF;
 PERFORM 1 FROM public.fabric_stock WHERE id IN(SELECT (x->>'fabric_stock_id')::uuid FROM jsonb_array_elements(qt.cuts) x) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.inventory_items WHERE id IN(SELECT (x->>'inventory_item_id')::uuid FROM jsonb_array_elements(qt.cuts) x) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.locations WHERE id=qt.source_location_id AND active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Source inactive'; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(qt.cuts) LOOP
  IF (r->>'cost_version_id')::uuid IS DISTINCT FROM (SELECT id FROM public.fabric_stock_costs WHERE fabric_stock_id=(r->>'fabric_stock_id')::uuid ORDER BY revision DESC LIMIT 1) THEN RAISE EXCEPTION 'Fabric cost changed; calculate a new quote'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.thaans WHERE id=(r->>'thaan_id')::uuid AND status='active') OR
   NOT EXISTS(SELECT 1 FROM public.fabric_stock WHERE id=(r->>'fabric_stock_id')::uuid AND entry_state IN('complete','correcting','legacy_pending')) THEN RAISE EXCEPTION 'Active stock required'; END IF;
 END LOOP;
 INSERT INTO public.customer_tailoring_jobs(id,code,customer_id,garment,tailor_assignment_id,tailoring_charge_version_id,status,notes,created_by,request_id,request_payload,quote_id)
 VALUES(v_job,'CT-'||replace(v_job::text,'-',''),p_customer,btrim(p_garment),p_assignment,qt.charge_version_id,'open',nullif(btrim(p_notes),''),auth.uid(),p_request,payload,qt.id);
 INSERT INTO public.customer_tailoring_prices(job_id,revision,fabric_cp_total_paise,tailoring_charge_paise,charge_version_id,recorded_by)
 VALUES(v_job,1,qt.fabric_cp_total_paise,qt.tailoring_charge_paise,qt.charge_version_id,auth.uid());
 INSERT INTO public.job_material_requirements(customer_tailoring_job_id,fabric_stock_id,quantity,unit)
 SELECT v_job,(x->>'fabric_stock_id')::uuid,sum((x->>'quantity')::numeric),'mm' FROM jsonb_array_elements(qt.cuts) x GROUP BY x->>'fabric_stock_id';
 INSERT INTO public.material_issues(code,customer_tailoring_job_id,tailor_assignment_id,source_location_id,issue_type,reason,issued_by)
 VALUES('MI-'||replace(v_job::text,'-',''),v_job,p_assignment,qt.source_location_id,'required','Required material for Customer Tailoring',auth.uid()) RETURNING id INTO v_issue;
 FOR r IN SELECT value FROM jsonb_array_elements(qt.cuts) ORDER BY value->>'inventory_item_id' LOOP
  INSERT INTO public.material_issue_lines(material_issue_id,fabric_stock_id,thaan_id,quantity,unit)
  VALUES(v_issue,(r->>'fabric_stock_id')::uuid,(r->>'thaan_id')::uuid,(r->>'quantity')::numeric,'mm') RETURNING id INTO v_line;
  INSERT INTO public.inventory_movements(kind,fabric_stock_id,thaan_id,inventory_item_id,quantity,unit,source_location_id,material_issue_line_id,customer_tailoring_job_id,reason,reference,actor_id)
  VALUES('MATERIAL_ISSUE',(r->>'fabric_stock_id')::uuid,(r->>'thaan_id')::uuid,(r->>'inventory_item_id')::uuid,(r->>'quantity')::numeric,'mm',qt.source_location_id,v_line,v_job,'Required material for Customer Tailoring','JOB:'||v_job::text,auth.uid());
  IF public.inventory_balance((r->>'inventory_item_id')::uuid,NULL)=0 THEN UPDATE public.thaans SET status='depleted',updated_at=now() WHERE id=(r->>'thaan_id')::uuid; END IF;
 END LOOP;
 INSERT INTO public.orders(id,code,kind,customer_id,customer_tailoring_job_id,source_location_id,status,final_customer_price_paise,created_by,customer_snapshot,completed_at,tailoring_request_id,reference)
 VALUES(v_order,'CT-ORDER-'||replace(v_job::text,'-',''),'customer_tailoring',p_customer,v_job,qt.source_location_id,'draft',qt.final_customer_price_paise,auth.uid(),contact,now(),p_request,'JOB:'||v_job::text);
 INSERT INTO public.order_items(order_id,customer_tailoring_job_id,quantity,unit,final_customer_price_paise)
 VALUES(v_order,v_job,1,'job',qt.final_customer_price_paise) RETURNING id INTO v_item;
 INSERT INTO public.order_item_financials(order_item_id,cp_snapshot_paise,tailoring_charge_snapshot_paise)
 VALUES(v_item,qt.fabric_cp_total_paise,qt.tailoring_charge_paise);
 UPDATE public.orders SET status='completed' WHERE id=v_order;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference)
 VALUES(auth.uid(),'create_customer_tailoring','customer_tailoring_jobs',v_job,jsonb_build_object('order_id',v_order,'issue_id',v_issue,'final_customer_price_paise',qt.final_customer_price_paise),'REQUEST:'||p_request::text);
 RETURN v_job;
END; $function$
;
CREATE OR REPLACE FUNCTION public.stock_entry_cp(p_thaan_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF NOT public.can_view_thaan_cp(NULL) THEN RAISE EXCEPTION 'Open owned receiving workflow required'; END IF;
 RETURN (SELECT cost_paise FROM public.thaan_costs WHERE thaan_id=p_thaan_id);
END; $function$
;
CREATE OR REPLACE FUNCTION public.guard_legacy_cost_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF NEW.cost_paise<0 THEN RAISE EXCEPTION 'Nonnegative CP required'; END IF;
 IF auth.uid() IS NOT NULL AND (NOT public.can_view_thaan_cp(NULL) OR NOT public.can_enter_legacy_cp(NEW.thaan_id)) THEN
 RAISE EXCEPTION 'Open owned receiving workflow required'; END IF;
 RETURN NEW;
END; $function$
;
-- All creator IDs remain permanent; inserts still attribute the caller.
ALTER POLICY phase2_entry_batch_update ON public.receiving_batches TO authenticated
 USING(public.has_role(auth.uid(),'stock_entry') AND public.has_perm(auth.uid(),'inventory.receive') AND status='draft')
 WITH CHECK(public.has_role(auth.uid(),'stock_entry') AND public.has_perm(auth.uid(),'inventory.receive'));
CREATE POLICY module_stock_legacy_cp_read ON public.thaan_costs FOR SELECT TO authenticated
 USING(public.has_perm(auth.uid(),'inventory.view_registered_cp'));
CREATE POLICY module_stock_fabric_cp_read ON public.fabric_stock_costs FOR SELECT TO authenticated
 USING(public.has_perm(auth.uid(),'inventory.view_registered_cp'));
ALTER POLICY "manage orders" ON public.online_orders TO authenticated
 USING(public.has_perm(auth.uid(),'ecommerce.manage_listings')) WITH CHECK(public.has_perm(auth.uid(),'ecommerce.manage_listings'));
ALTER POLICY "read online_orders" ON public.online_orders TO authenticated
 USING(public.has_any_perm(auth.uid(),ARRAY['ecommerce.manage_listings','reports.view']));
NOTIFY pgrst,'reload schema';
COMMIT;
