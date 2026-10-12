-- Always-open Workshop inventory hierarchy and audited corrections. Preserve all identities/history.
BEGIN;
INSERT INTO public.permissions(key,label,domain) VALUES
 ('inventory.correct_cp','Correct registered fabric CP','inventory'),
 ('inventory.correct_workshop','Correct Workshop fabric balance','inventory') ON CONFLICT(key) DO NOTHING;
CREATE FUNCTION public.workshop_fabric_inventory() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','stock_entry','ecommerce_manager']) THEN RAISE EXCEPTION 'Authorized inventory role required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY batch_created_at DESC,batch_id,group_position NULLS FIRST,group_id,ordinal NULLS LAST,thaan_id) FROM (
 SELECT t.id thaan_id,s.id stock_id,b.id batch_id,b.code batch_code,b.created_at batch_created_at,b.received_on arrival_date,
 coalesce(rb.provider_name,sp.name,'Unknown supplier') supplier,coalesce(g.id::text,f.id::text) group_id,coalesce(g.name,f.name) type_name,g.label_position group_position,
 t.rack,f.design,v.ordinal,coalesce(v.code,t.barcode,bc.code) barcode,(v.id IS NOT NULL) registered,f.name name,coalesce(f.colour,v.draft_details->>'colour') colour,
 t.original_mm,coalesce(t.original_mm,(v.draft_details->>'length_mm')::integer) saved_length_mm,t.status,
 CASE WHEN i.id IS NOT NULL THEN public.inventory_balance(i.id,w.id) END workshop_mm,
 (i.id IS NULL AND t.original_mm IS NOT NULL) unlocated,
 (public.has_role(auth.uid(),'owner') OR public.has_perm(auth.uid(),'inventory.view_cost') OR (s.created_by=auth.uid() AND public.has_perm(auth.uid(),'inventory.view_registered_cp'))) cp_visible,
 CASE WHEN public.has_role(auth.uid(),'owner') OR public.has_perm(auth.uid(),'inventory.view_cost') OR (s.created_by=auth.uid() AND public.has_perm(auth.uid(),'inventory.view_registered_cp')) THEN coalesce(c.cp_paise_per_m,(v.draft_details->>'cp')::bigint) END cp_paise_per_m,
 (nullif(btrim(f.name),'') IS NULL OR nullif(btrim(coalesce(g.name,f.name)),'') IS NULL OR nullif(btrim(coalesce(f.colour,v.draft_details->>'colour')),'') IS NULL OR coalesce(t.original_mm,(v.draft_details->>'length_mm')::integer,0)<=0 OR coalesce(c.cp_paise_per_m,(v.draft_details->>'cp')::bigint,0)<=0) incomplete,
 (public.has_perm(auth.uid(),'inventory.edit_thaan') AND (public.has_role(auth.uid(),'owner') OR s.created_by=auth.uid())) can_edit,
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
 )r),'[]'::jsonb); END; $$;
CREATE OR REPLACE FUNCTION public.registration_group_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Fabric Type history is permanent'; END IF;
 IF (to_jsonb(NEW)-'next_ordinal'-'name') IS DISTINCT FROM(to_jsonb(OLD)-'next_ordinal'-'name') OR NEW.next_ordinal<OLD.next_ordinal THEN RAISE EXCEPTION 'Fabric Type identity is permanent'; END IF;
 IF NEW.name IS DISTINCT FROM OLD.name AND NOT EXISTS(SELECT 1 FROM public.stock_registration_requests r WHERE r.actor_id=auth.uid() AND r.action='inventory_detail_edit' AND r.payload->>'group_id'=OLD.id::text AND r.payload->>'type_name'=NEW.name) THEN RAISE EXCEPTION 'Audited Fabric Type name correction required'; END IF;
 RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION public.guard_label_variant_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Registered barcode history is permanent'; END IF;
 IF (to_jsonb(NEW)-'details_recorded_at'-'draft_details') IS DISTINCT FROM (to_jsonb(OLD)-'details_recorded_at'-'draft_details') THEN RAISE EXCEPTION 'Registered barcode identity is permanent'; END IF;
 IF NEW.draft_details IS DISTINCT FROM OLD.draft_details THEN
  IF NOT EXISTS(SELECT 1 FROM public.stock_registration_requests r WHERE r.action IN('thaan_partial_details','inventory_detail_edit') AND r.actor_id=auth.uid() AND r.result_id=OLD.thaan_id AND r.payload->'details'=NEW.draft_details AND (r.action='inventory_detail_edit' OR NEW.draft_details @> OLD.draft_details)) THEN RAISE EXCEPTION 'Only authenticated missing-details completion allowed'; END IF;
 END IF;
 IF NEW.details_recorded_at IS DISTINCT FROM OLD.details_recorded_at AND (OLD.details_recorded_at IS NOT NULL OR NEW.details_recorded_at IS NULL OR NOT EXISTS(SELECT 1 FROM public.thaans WHERE id=NEW.thaan_id AND original_mm>0 AND status IN('active','depleted','archived'))) THEN RAISE EXCEPTION 'Only first actual measurement timestamp allowed'; END IF;
 RETURN NEW; END; $$;
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
  IF registered AND NEW.colour IS DISTINCT FROM OLD.colour AND NOT (EXISTS(SELECT 1 FROM public.stock_registration_requests r JOIN public.stock_registration_variants v ON v.thaan_id=r.result_id JOIN public.fabric_stock fs ON fs.id=v.fabric_stock_id WHERE fs.fabric_id=OLD.id AND r.action='inventory_detail_edit' AND r.actor_id=auth.uid() AND r.payload->>'colour'=NEW.colour) OR OLD.colour IS NULL AND nullif(btrim(NEW.colour),'') IS NOT NULL AND EXISTS(SELECT 1 FROM public.stock_registration_requests r JOIN public.stock_registration_variants v ON v.thaan_id=r.result_id JOIN public.fabric_stock fs ON fs.id=v.fabric_stock_id WHERE fs.fabric_id=OLD.id AND r.action='measure_thaan' AND r.actor_id=auth.uid() AND r.payload->>'barcode'=v.code AND r.payload->>'colour'=btrim(NEW.colour))) THEN RAISE EXCEPTION 'Actual registered colour can be recorded once by barcode measurement'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
CREATE FUNCTION public.edit_workshop_thaan(p_request uuid,p_thaan uuid,p_version text,p_changes jsonb,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.thaans%rowtype; v public.stock_registration_variants%rowtype; current_row jsonb; v_payload jsonb; result uuid; details jsonb; item uuid; workshop uuid; qty integer; balance numeric; cp bigint; oldcp bigint; rev integer; BEGIN
 IF NOT public.can_receive_fabric() OR NOT public.has_perm(auth.uid(),'inventory.edit_thaan') THEN RAISE EXCEPTION 'Inventory editing permission required'; END IF;
 IF p_reason IS NULL OR btrim(p_reason)='' OR jsonb_typeof(p_changes) IS DISTINCT FROM 'object' OR p_changes='{}'::jsonb OR (p_changes-'name'-'type_name'-'colour'-'length_mm'-'cp_paise_per_m')<>'{}'::jsonb THEN RAISE EXCEPTION 'Explicit allowed changes and correction reason required'; END IF;
 v_payload:=jsonb_build_object('thaan',p_thaan,'version',p_version,'changes',p_changes,'reason',btrim(p_reason));
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
 IF current_row IS NULL OR NOT(current_row->>'can_edit')::boolean THEN RAISE EXCEPTION 'Owned Workshop Thaan required'; END IF;
 IF p_version IS DISTINCT FROM current_row->>'version' THEN RAISE EXCEPTION 'Stock changed; refresh and review before saving'; END IF;
 IF p_changes ? 'name' AND nullif(btrim(p_changes->>'name'),'') IS NULL OR p_changes ? 'type_name' AND nullif(btrim(p_changes->>'type_name'),'') IS NULL OR p_changes ? 'colour' AND nullif(btrim(p_changes->>'colour'),'') IS NULL THEN RAISE EXCEPTION 'Entered names/colour cannot be empty'; END IF;
 IF p_changes ? 'type_name' AND v.id IS NULL THEN RAISE EXCEPTION 'Legacy Fabric Type grouping cannot be reassigned'; END IF;
 details:=coalesce(v.draft_details,'{}'::jsonb);
 IF p_changes ? 'cp_paise_per_m' THEN
  cp:=(p_changes->>'cp_paise_per_m')::bigint;
  IF cp IS NULL OR cp<0 OR cp>9007199254740991 OR NOT(current_row->>'cp_visible')::boolean THEN RAISE EXCEPTION 'Visible exact CP required'; END IF;
  oldcp:=(current_row->>'cp_paise_per_m')::bigint;
  IF NOT public.has_perm(auth.uid(),'inventory.correct_cp') AND NOT(coalesce(oldcp,0)=0 AND public.has_perm(auth.uid(),'inventory.fill_missing_cp')) THEN RAISE EXCEPTION 'CP correction permission required'; END IF;
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
  IF details ? 'length_mm' AND details ? 'colour' THEN PERFORM public.complete_barcode_thaan(gen_random_uuid(),v.code,details->>'colour',(details->>'length_mm')::integer,(details->>'cp')::bigint); END IF;
 ELSE
  IF p_changes ? 'colour' THEN UPDATE public.fabrics SET colour=btrim(p_changes->>'colour') WHERE id=t.fabric_id; END IF;
  IF p_changes ? 'cp_paise_per_m' AND cp IS DISTINCT FROM oldcp THEN
   SELECT coalesce(max(revision),0)+1 INTO rev FROM public.fabric_stock_costs WHERE fabric_stock_id=t.fabric_stock_id;
   INSERT INTO public.fabric_stock_costs(fabric_stock_id,revision,cp_paise_per_m,recorded_by,reason) VALUES(t.fabric_stock_id,rev,cp,auth.uid(),btrim(p_reason));
  END IF;
  IF p_changes ? 'length_mm' THEN
   SELECT id INTO workshop FROM public.locations WHERE kind='workshop' AND active;
   balance:=public.inventory_balance(item,workshop);
   IF qty<>balance THEN
    INSERT INTO public.inventory_movements(inventory_item_id,thaan_id,fabric_stock_id,kind,quantity,unit,source_location_id,destination_location_id,reason,reference,actor_id)
    VALUES(item,t.id,t.fabric_stock_id,'ADJUSTMENT',abs(qty-balance),'mm',CASE WHEN qty<balance THEN workshop END,CASE WHEN qty>balance THEN workshop END,btrim(p_reason),'INVEDIT:'||p_request::text,auth.uid());
   END IF;
  END IF;
 END IF;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,previous_value,new_value,reference) VALUES(auth.uid(),'edit_workshop_thaan','thaans',t.id,current_row-'cp_paise_per_m',v_payload,'INVEDIT:'||p_request::text);
 RETURN t.id; END; $$;
REVOKE ALL ON FUNCTION public.workshop_fabric_inventory(),public.edit_workshop_thaan(uuid,uuid,text,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.workshop_fabric_inventory(),public.edit_workshop_thaan(uuid,uuid,text,jsonb,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
