BEGIN;
-- One Production ID, explicit immutable per-piece descriptors; whole-batch receipt.
CREATE TABLE public.production_piece_specs (
 production_job_id uuid NOT NULL REFERENCES public.production_jobs(id),piece_number integer NOT NULL CHECK(piece_number>0),
 product_id uuid NOT NULL REFERENCES public.products(id),design_id uuid REFERENCES public.designs(id),custom_design text,size text NOT NULL CHECK(length(btrim(size)) BETWEEN 1 AND 40),
 recorded_by uuid NOT NULL REFERENCES public.profiles(id),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(production_job_id,piece_number),CHECK((design_id IS NULL)<>(custom_design IS NULL)),CHECK(custom_design IS NULL OR length(btrim(custom_design)) BETWEEN 1 AND 120)
);
CREATE TABLE public.mixed_production_requests (
 request_id uuid PRIMARY KEY REFERENCES public.production_batch_requests(request_id),production_job_id uuid NOT NULL UNIQUE REFERENCES public.production_jobs(id),actor_id uuid NOT NULL REFERENCES public.profiles(id),payload jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.production_piece_specs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mixed_production_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.production_piece_specs,public.mixed_production_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.production_piece_specs,public.mixed_production_requests TO authenticated;
GRANT ALL ON public.production_piece_specs,public.mixed_production_requests TO service_role;
CREATE POLICY production_specs_read ON public.production_piece_specs FOR SELECT TO authenticated USING(public.has_perm(auth.uid(),'production.view') OR public.has_perm(auth.uid(),'production.receive') OR (public.has_role(auth.uid(),'tailor') AND public.owns_production_job(production_job_id)));
CREATE POLICY mixed_production_request_read ON public.mixed_production_requests FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'owner'));
CREATE TRIGGER production_piece_specs_immutable BEFORE UPDATE OR DELETE ON public.production_piece_specs FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();
CREATE TRIGGER mixed_production_request_immutable BEFORE UPDATE OR DELETE ON public.mixed_production_requests FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();
DO $$ DECLARE constraint_name text;
BEGIN
 FOR constraint_name IN SELECT conname FROM pg_constraint WHERE conrelid='public.finished_products'::regclass AND confrelid='public.production_jobs'::regclass AND contype='f' LOOP
  EXECUTE format('ALTER TABLE public.finished_products DROP CONSTRAINT %I',constraint_name);
 END LOOP;
END; $$;
CREATE TRIGGER production_piece_update_descriptor BEFORE UPDATE OF product_id,design_id ON public.finished_products FOR EACH ROW EXECUTE FUNCTION public.guard_production_descriptor();
ALTER TABLE public.finished_products ADD CONSTRAINT piece_production_job_fkey FOREIGN KEY(production_job_id) REFERENCES public.production_jobs(id);
ALTER TABLE public.finished_products ADD CONSTRAINT piece_product_fkey FOREIGN KEY(product_id) REFERENCES public.products(id);
ALTER TABLE public.finished_products ADD CONSTRAINT piece_design_fkey FOREIGN KEY(design_id) REFERENCES public.designs(id);

CREATE OR REPLACE FUNCTION public.guard_production_descriptor() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_TABLE_NAME='finished_products' THEN
  IF EXISTS(SELECT 1 FROM public.production_piece_specs WHERE production_job_id=NEW.production_job_id) THEN
   IF NOT EXISTS(SELECT 1 FROM public.production_piece_specs WHERE production_job_id=NEW.production_job_id AND piece_number=NEW.piece_number AND product_id=NEW.product_id AND design_id IS NOT DISTINCT FROM NEW.design_id) THEN RAISE EXCEPTION 'Piece must match its recorded production specification'; END IF;
  ELSIF NOT EXISTS(SELECT 1 FROM public.production_jobs WHERE id=NEW.production_job_id AND product_id=NEW.product_id AND design_id IS NOT DISTINCT FROM NEW.design_id) THEN RAISE EXCEPTION 'Piece must match its recorded production'; END IF;
 ELSE
  IF (NEW.size,NEW.custom_design) IS DISTINCT FROM(OLD.size,OLD.custom_design) AND NOT(OLD.size IS NULL AND OLD.custom_design IS NULL AND OLD.status='open' AND OLD.created_by=auth.uid() AND NOT EXISTS(SELECT 1 FROM public.production_batch_requests WHERE production_job_id=OLD.id)) THEN RAISE EXCEPTION 'Issued production descriptors are permanent'; END IF;
 END IF;
 RETURN NEW;
END; $$;

CREATE FUNCTION public.create_mixed_production(p_request uuid,p_source uuid,p_items jsonb,p_specs jsonb,p_assignments jsonb,p_notes text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE saved public.mixed_production_requests%rowtype;payload_value jsonb;spec jsonb;first_spec jsonb;job_id uuid;n integer:=0;
BEGIN
 IF NOT public.has_perm(auth.uid(),'production.create') THEN RAISE EXCEPTION 'Production creation permission required'; END IF;
 IF p_request IS NULL OR jsonb_typeof(p_specs) IS DISTINCT FROM 'array' OR jsonb_array_length(p_specs) NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Request and 1–10,000 explicit finished-piece specifications required'; END IF;
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x LEFT JOIN public.inventory_items i ON i.id=(x->>'inventory_item_id')::uuid WHERE i.id IS NULL OR i.thaan_id IS NULL) THEN RAISE EXCEPTION 'Explicit scanned fabric cuts required'; END IF;
 payload_value:=jsonb_build_object('actor',auth.uid(),'source',p_source,'items',p_items,'specs',p_specs,'assignments',p_assignments,'notes',nullif(btrim(p_notes),''));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,10));
 SELECT * INTO saved FROM public.mixed_production_requests WHERE request_id=p_request;
 IF FOUND THEN IF saved.payload IS DISTINCT FROM payload_value THEN RAISE EXCEPTION 'Production retry requires unchanged specifications'; END IF;RETURN saved.production_job_id;END IF;
 IF EXISTS(SELECT 1 FROM public.production_requests WHERE request_id=p_request) THEN RAISE EXCEPTION 'Request already used by another production'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('phase10-catalog',10));
 FOR spec IN SELECT value FROM jsonb_array_elements(p_specs) LOOP
  IF jsonb_typeof(spec) IS DISTINCT FROM 'object' OR (spec-ARRAY['product_id','design_id','custom_design','size'])<>'{}' THEN RAISE EXCEPTION 'Only explicit product, design and size specifications accepted'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.products WHERE id=(spec->>'product_id')::uuid AND active) THEN RAISE EXCEPTION 'Active product required for each piece'; END IF;
  IF nullif(btrim(spec->>'size'),'') IS NULL OR length(btrim(spec->>'size'))>40 THEN RAISE EXCEPTION 'Size required for every piece'; END IF;
  IF (nullif(spec->>'design_id','') IS NULL)=(nullif(btrim(spec->>'custom_design'),'') IS NULL) THEN RAISE EXCEPTION 'Choose a defined design or enter a custom design for each piece'; END IF;
  IF nullif(spec->>'design_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.designs WHERE id=(spec->>'design_id')::uuid AND active) THEN RAISE EXCEPTION 'Active design required'; END IF;
  IF length(btrim(spec->>'custom_design'))>120 THEN RAISE EXCEPTION 'Custom design exceeds 120 characters'; END IF;
 END LOOP;
 first_spec:=p_specs->0;
 job_id:=public.create_production_batch(p_request,(first_spec->>'product_id')::uuid,(first_spec->>'design_id')::uuid,first_spec->>'custom_design',first_spec->>'size',jsonb_array_length(p_specs),p_assignments,p_source,p_items,p_notes,'Production fabric issued for recorded piece specifications');
 FOR spec IN SELECT value FROM jsonb_array_elements(p_specs) LOOP
  n:=n+1;
  INSERT INTO public.production_piece_specs VALUES(job_id,n,(spec->>'product_id')::uuid,(spec->>'design_id')::uuid,nullif(btrim(spec->>'custom_design'),''),btrim(spec->>'size'),auth.uid(),clock_timestamp());
 END LOOP;
 INSERT INTO public.mixed_production_requests VALUES(p_request,job_id,auth.uid(),payload_value,clock_timestamp());
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference) VALUES(auth.uid(),'create_mixed_production','production_jobs',job_id,payload_value,'PRODUCTION:'||p_request::text);
 RETURN job_id;
END; $$;
REVOKE ALL ON FUNCTION public.create_mixed_production(uuid,uuid,jsonb,jsonb,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_mixed_production(uuid,uuid,jsonb,jsonb,jsonb,text) TO authenticated;

CREATE FUNCTION public.production_specifications(p_job uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('piece_number',s.piece_number,'product_id',s.product_id,'product',p.name,'design_id',s.design_id,'design',coalesce(d.name,s.custom_design),'design_code',d.code,'custom_design',s.custom_design,'size',s.size) ORDER BY s.piece_number),'[]') FROM public.production_piece_specs s JOIN public.products p ON p.id=s.product_id LEFT JOIN public.designs d ON d.id=s.design_id WHERE s.production_job_id=p_job;
$$;
REVOKE ALL ON FUNCTION public.production_specifications(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.create_owner_production_shared(p_request uuid, p_product uuid, p_design uuid, p_quantity integer, p_assignments jsonb, p_source uuid, p_items jsonb, p_notes text, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE payload_value jsonb; saved public.production_requests%rowtype; result uuid; charge uuid; p_assignment uuid; selected_assignments jsonb; candidate uuid; first_assignment public.tailor_assignments%rowtype;
BEGIN
 IF NOT public.has_perm(auth.uid(),'production.create') THEN RAISE EXCEPTION 'Production creation permission required'; END IF;
 IF p_request IS NULL OR p_quantity IS NULL OR p_quantity<=0 OR nullif(btrim(p_reason),'') IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'Production quantity, explicit materials, request and reason required'; END IF;
 IF jsonb_typeof(p_assignments) IS DISTINCT FROM 'array' OR jsonb_array_length(p_assignments) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Select one to 100 Tailors'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_assignments) x WHERE jsonb_typeof(x)<>'string') OR (SELECT count(DISTINCT value::uuid) FROM jsonb_array_elements_text(p_assignments))<>jsonb_array_length(p_assignments) THEN RAISE EXCEPTION 'Distinct Tailor assignments required'; END IF;
 SELECT jsonb_agg(value::uuid ORDER BY value::uuid) INTO selected_assignments FROM jsonb_array_elements_text(p_assignments);
 p_assignment:=(selected_assignments->>0)::uuid;
 payload_value:=jsonb_build_object('actor',auth.uid(),'product',p_product,'design',p_design,'quantity',p_quantity,'assignments',selected_assignments,'source',p_source,'items',p_items,'notes',p_notes,'reason',btrim(p_reason));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,10));
 SELECT * INTO saved FROM public.production_requests WHERE request_id=p_request;
 IF FOUND THEN
  IF saved.payload IS DISTINCT FROM payload_value THEN RAISE EXCEPTION 'Production request already used with different data'; END IF;
  RETURN saved.result_id;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('phase7-assignment',7));
 -- Shared catalogue lock prevents charge/configuration changes between validation and snapshot.
 PERFORM pg_advisory_xact_lock(hashtextextended('phase10-catalog',10));
 PERFORM 1 FROM public.products WHERE id=p_product AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active Product required'; END IF;
 IF p_design IS NOT NULL THEN PERFORM 1 FROM public.designs WHERE id=p_design AND active FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'Active Design required'; END IF; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tailor_assignments a JOIN public.tailors t ON t.id=a.tailor_id JOIN public.tailoring_factories f ON f.id=a.factory_id
  LEFT JOIN public.tailoring_sections s ON s.id=a.section_id WHERE a.id=p_assignment AND a.valid_until IS NULL AND a.valid_from<=now() AND t.active AND f.active
  AND (s.id IS NULL OR s.active) AND (t.profile_id IS NULL OR public.has_role(t.profile_id,'tailor')))
 THEN RAISE EXCEPTION 'Current active Factory / Section / Tailor assignment required'; END IF;
 SELECT * INTO first_assignment FROM public.tailor_assignments WHERE id=p_assignment;
 FOR candidate IN SELECT value::uuid FROM jsonb_array_elements_text(selected_assignments) LOOP
  IF NOT EXISTS(SELECT 1 FROM public.tailor_assignments a JOIN public.tailors t ON t.id=a.tailor_id JOIN public.tailoring_factories f ON f.id=a.factory_id LEFT JOIN public.tailoring_sections sec ON sec.id=a.section_id
   WHERE a.id=candidate AND a.factory_id=first_assignment.factory_id AND a.valid_until IS NULL AND a.valid_from<=now() AND t.active AND f.active AND (sec.id IS NULL OR sec.active) AND (t.profile_id IS NULL OR public.has_role(t.profile_id,'tailor')))
  THEN RAISE EXCEPTION 'All Tailors must have current active assignments in the selected Factory'; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x JOIN public.inventory_items i ON i.id=(x->>'inventory_item_id')::uuid WHERE i.thaan_id IS NOT NULL)
 THEN RAISE EXCEPTION 'Explicit required fabric is mandatory'; END IF;
 SELECT id INTO charge FROM public.design_charge_versions WHERE design_id=p_design ORDER BY revision DESC LIMIT 1;
 INSERT INTO public.production_jobs(code,product_id,design_id,design_charge_version_id,quantity,tailor_assignment_id,status,notes,created_by)
 VALUES('PJ-'||p_request::text,p_product,p_design,charge,p_quantity,p_assignment,'open',p_notes,auth.uid()) RETURNING id INTO result;
 INSERT INTO public.production_job_tailors(production_job_id,tailor_assignment_id,recorded_by) SELECT result,value::uuid,auth.uid() FROM jsonb_array_elements_text(selected_assignments);
 -- Quantities are the explicit total for the job, never multiplied by piece count or padded.
 PERFORM public.post_material_issue(p_request,'production',result,p_source,'required',p_items,p_reason);
 INSERT INTO public.production_requests VALUES(p_request,auth.uid(),payload_value,result,now());
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference)
 VALUES(auth.uid(),'create_owner_production','production_jobs',result,payload_value,'PJ-'||p_request::text);
 RETURN result;
END; $function$
;
CREATE OR REPLACE FUNCTION public.complete_production_batch(p_request uuid,p_job uuid,p_expected_status text,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE job public.production_jobs%rowtype; saved public.finished_product_receipts%rowtype; payload_value jsonb;
 workshop uuid; piece uuid; barcode uuid; inv uuid; n integer; known boolean; total numeric; base_amount bigint; remainder integer; cost_version uuid; material_payload jsonb;
BEGIN
 IF NOT public.has_perm(auth.uid(),'production.receive') THEN RAISE EXCEPTION 'Production receipt permission required'; END IF;
 IF p_request IS NULL OR p_job IS NULL OR p_expected_status IS DISTINCT FROM 'completed' OR nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Completed job and whole-batch receipt confirmation required'; END IF;
 payload_value:=jsonb_build_object('actor',auth.uid(),'job',p_job,'expected_status',p_expected_status,'reason',btrim(p_reason),'cost_basis','issued_fabric','material_consumption','not_recorded');
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,11));
 SELECT * INTO saved FROM public.finished_product_receipts WHERE request_id=p_request;
 IF FOUND THEN IF saved.payload IS DISTINCT FROM payload_value THEN RAISE EXCEPTION 'Receipt request reused with different data or actor'; END IF;RETURN saved.production_job_id; END IF;
 SELECT * INTO job FROM public.production_jobs WHERE id=p_job FOR UPDATE;
 IF job.id IS NULL OR job.status<>'completed' THEN RAISE EXCEPTION 'Completed production job required'; END IF;
 IF EXISTS(SELECT 1 FROM public.finished_product_receipts WHERE production_job_id=p_job) OR EXISTS(SELECT 1 FROM public.finished_products WHERE production_job_id=p_job) THEN RAISE EXCEPTION 'Whole production batch already received'; END IF;
 SELECT count(*)>0 AND count(c.issue_line_id)=count(*),sum(c.amount_paise),jsonb_agg(jsonb_build_object('issue_line_id',l.id,'quantity',l.quantity,'amount_paise',c.amount_paise)) INTO known,total,material_payload FROM public.material_issue_lines l JOIN public.material_issues i ON i.id=l.material_issue_id LEFT JOIN public.production_issue_fabric_costs c ON c.issue_line_id=l.id WHERE i.production_job_id=job.id AND l.thaan_id IS NOT NULL;
 IF NOT known OR total IS NULL THEN RAISE EXCEPTION 'Issue-time fabric CP is not recorded; Owner reconciliation is required'; END IF;
 IF total>9007199254740991 THEN RAISE EXCEPTION 'Production CP exceeds supported money range'; END IF;
 SELECT id INTO workshop FROM public.locations WHERE active AND kind='workshop' FOR UPDATE;
 IF workshop IS NULL THEN RAISE EXCEPTION 'Active Workshop required'; END IF;
 INSERT INTO public.finished_product_receipts VALUES(p_request,p_job,auth.uid(),workshop,payload_value,btrim(p_reason),clock_timestamp());
 FOR n IN 1..job.quantity LOOP
  INSERT INTO public.barcodes(code,kind,created_by) VALUES('PRD-'||replace(gen_random_uuid()::text,'-',''),'product',auth.uid()) RETURNING id INTO barcode;
  INSERT INTO public.finished_products(production_job_id,product_id,design_id,piece_number,barcode_id,current_location_id,status) VALUES(p_job,coalesce((SELECT product_id FROM public.production_piece_specs WHERE production_job_id=p_job AND piece_number=n),job.product_id),CASE WHEN EXISTS(SELECT 1 FROM public.production_piece_specs WHERE production_job_id=p_job) THEN (SELECT design_id FROM public.production_piece_specs WHERE production_job_id=p_job AND piece_number=n) ELSE job.design_id END,n,barcode,workshop,'available') RETURNING id INTO piece;
  INSERT INTO public.finished_product_receipt_pieces VALUES(piece,p_request);
  INSERT INTO public.inventory_items(finished_product_id,unit,legacy_quantity_snapshot,reconciled_by,reason) VALUES(piece,'pc',0,auth.uid(),btrim(p_reason)) RETURNING id INTO inv;
  INSERT INTO public.inventory_movements(kind,inventory_item_id,finished_product_id,quantity,unit,destination_location_id,production_job_id,actor_id,reason,reference) VALUES('PRODUCTION',inv,piece,1,'pc',workshop,p_job,auth.uid(),btrim(p_reason),'PRODUCTION:'||p_request::text);
 END LOOP;
 INSERT INTO public.production_cost_versions(production_job_id,revision,quantity_snapshot,recorded_by,reason) SELECT p_job,coalesce(max(revision),0)+1,job.quantity,auth.uid(),'Recorded issued fabric CP including additional issues; actual consumption is not inferred' FROM public.production_cost_versions WHERE production_job_id=p_job RETURNING id INTO cost_version;
 INSERT INTO public.production_cost_lines(cost_version_id,category,amount_paise,description,fabric_cost_id,material_issue_line_id)
 SELECT cost_version,'fabric',c.amount_paise,'Issued fabric CP captured at issue time',c.fabric_cost_id,l.id FROM public.material_issue_lines l JOIN public.material_issues i ON i.id=l.material_issue_id JOIN public.production_issue_fabric_costs c ON c.issue_line_id=l.id WHERE i.production_job_id=p_job AND l.thaan_id IS NOT NULL;
 base_amount:=floor(total/job.quantity);remainder:=(total-base_amount*job.quantity)::integer;
 INSERT INTO public.finished_product_cost_allocations(finished_product_id,production_job_id,cost_version_id,amount_paise)
 SELECT id,p_job,cost_version,base_amount+CASE WHEN row_number() OVER(ORDER BY piece_number)<=remainder THEN 1 ELSE 0 END FROM public.finished_products WHERE production_job_id=p_job;
 INSERT INTO public.production_cost_requests VALUES(p_request,auth.uid(),p_job,jsonb_build_object('materials',material_payload,'basis','issued_fabric','actual_consumption','not_recorded'),cost_version,now());
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference) VALUES(auth.uid(),'receive_production_batch','production_jobs',p_job,payload_value||jsonb_build_object('received_pieces',job.quantity,'cost_version',cost_version),'PRODUCTION:'||p_request::text);
 RETURN p_job;
END; $$;
CREATE OR REPLACE FUNCTION public.production_piece_context(p_piece uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('size',coalesce(spec.size,j.size),'design',coalesce(d.name,spec.custom_design,j.custom_design),'design_code',d.code,'production_job_id',j.id,'production_quantity',j.quantity,
 'issued_at',(SELECT min(issued_at) FROM public.material_issues WHERE production_job_id=j.id),
 'finished_at',(SELECT max(recorded_at) FROM public.production_status_events WHERE job_id=j.id AND status='completed'),
 'received_at',(SELECT recorded_at FROM public.finished_product_receipts WHERE production_job_id=j.id),
 'sp_paise',(SELECT sp_paise FROM public.finished_product_prices WHERE finished_product_id=p.id ORDER BY revision DESC LIMIT 1),
 'cp_visible',public.can_view_thaan_cp(NULL),'cp_paise',CASE WHEN public.can_view_thaan_cp(NULL) THEN (SELECT a.amount_paise FROM public.finished_product_cost_allocations a JOIN public.production_cost_versions v ON v.id=a.cost_version_id WHERE a.finished_product_id=p.id ORDER BY v.revision DESC LIMIT 1) END)
 FROM public.finished_products p LEFT JOIN public.production_piece_specs spec ON spec.production_job_id=p.production_job_id AND spec.piece_number=p.piece_number JOIN public.production_jobs j ON j.id=p.production_job_id LEFT JOIN public.designs d ON d.id=p.design_id WHERE p.id=p_piece;
$$;
CREATE OR REPLACE FUNCTION public.finished_product_catalog(p_barcode text DEFAULT NULL::text, p_job uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE owner boolean:=public.has_role(auth.uid(),'owner'); counter boolean:=public.has_role(auth.uid(),'counter');
BEGIN
 IF NOT (owner OR counter OR public.has_role(auth.uid(),'tailor')) THEN RAISE EXCEPTION 'Owner, Counter or assigned Tailor required'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Limit must be 1 to 100'; END IF;
 RETURN coalesce((SELECT jsonb_agg(row_value ORDER BY (row_value->>'piece_number')::integer,row_value->>'id') FROM (
 SELECT jsonb_build_object('size',public.production_piece_context(f.id)->>'size','production_quantity',j.quantity,'issued_at',(SELECT min(issued_at) FROM public.material_issues WHERE production_job_id=j.id),'finished_at',(SELECT max(recorded_at) FROM public.production_status_events WHERE job_id=j.id AND status='completed'),'id',f.id,'barcode',b.code,'piece_number',f.piece_number,'product',p.name,'product_id',p.id,'design',public.production_piece_context(f.id)->>'design','design_id',d.id,
 'production_job_id',j.id,'production_job',j.code,'job_quantity',j.quantity,'job_status',j.status,'status',f.status,'created_at',f.created_at,
 'factory',factory.name,'section',s.name,'tailor',t.real_name,'assignment_id',j.tailor_assignment_id,'tailors',public.production_tailor_names(j.id),
 'location_id',f.current_location_id,'location',loc.name,'inventory_item_id',inv.id,
 'quantity_at_location',CASE WHEN inv.id IS NOT NULL THEN public.inventory_balance(inv.id,f.current_location_id) ELSE NULL END,
 'available',f.status='available' AND inv.id IS NOT NULL AND public.inventory_balance(inv.id,f.current_location_id)=1,
 'materials',coalesce((SELECT jsonb_agg(jsonb_build_object('issue_line_id',fm.material_issue_line_id,'quantity',fm.quantity,'unit',fm.unit,
 'name',coalesce(fab.name,mat.name),'fabric_stock_id',fs.id,'fabric_barcode',fb.code,'batch',batch.code,'thaan_id',l.thaan_id,'material_id',l.material_id)
 ORDER BY fm.id) FROM public.finished_product_materials fm JOIN public.material_issue_lines l ON l.id=fm.material_issue_line_id
 LEFT JOIN public.fabric_stock fs ON fs.id=l.fabric_stock_id LEFT JOIN public.fabrics fab ON fab.id=fs.fabric_id LEFT JOIN public.barcodes fb ON fb.id=fs.barcode_id
 LEFT JOIN public.receiving_batches batch ON batch.id=fs.batch_id LEFT JOIN public.materials mat ON mat.id=l.material_id WHERE fm.finished_product_id=f.id),'[]'::jsonb),
 'production_history',coalesce((SELECT jsonb_agg(jsonb_build_object('previous_status',e.previous_status,'status',e.status,'reason',e.reason,'actor_id',e.actor_id,'recorded_at',e.recorded_at) ORDER BY e.recorded_at,e.id) FROM public.production_status_events e WHERE e.job_id=j.id),'[]'::jsonb),
 'receipt', (SELECT jsonb_build_object('reason',r.reason,'actor_id',r.actor_id,'recorded_at',r.recorded_at,'workshop_id',r.workshop_id) FROM public.finished_product_receipts r WHERE r.production_job_id=j.id),
 'sp_paise',CASE WHEN owner OR counter THEN (SELECT sp_paise FROM public.finished_product_prices WHERE finished_product_id=f.id ORDER BY revision DESC LIMIT 1) END,
 'pricing_status',CASE WHEN EXISTS(SELECT 1 FROM public.finished_product_prices WHERE finished_product_id=f.id) THEN 'priced' ELSE 'not_set' END)
 || CASE WHEN owner THEN jsonb_build_object('production_summary',public.production_piece_summary(j.id),'production_cost_paise',(SELECT a.amount_paise FROM public.finished_product_cost_allocations a JOIN public.production_cost_versions v ON v.id=a.cost_version_id WHERE a.finished_product_id=f.id ORDER BY v.revision DESC LIMIT 1),'cost_version_id',(SELECT v.id FROM public.production_cost_versions v WHERE v.production_job_id=j.id ORDER BY v.revision DESC LIMIT 1)) ELSE '{}'::jsonb END row_value
 FROM public.finished_products f JOIN public.barcodes b ON b.id=f.barcode_id AND b.kind='product'
 JOIN public.production_jobs j ON j.id=f.production_job_id JOIN public.products p ON p.id=f.product_id LEFT JOIN public.designs d ON d.id=f.design_id
 JOIN public.tailor_assignments a ON a.id=j.tailor_assignment_id JOIN public.tailoring_factories factory ON factory.id=a.factory_id
 LEFT JOIN public.tailoring_sections s ON s.id=a.section_id JOIN public.tailors t ON t.id=a.tailor_id JOIN public.locations loc ON loc.id=f.current_location_id
 LEFT JOIN public.inventory_items inv ON inv.finished_product_id=f.id
 WHERE (p_barcode IS NULL OR b.code=btrim(p_barcode)) AND (p_job IS NULL OR j.id=p_job)
 AND (owner OR counter OR public.owns_production_job(j.id))
 ORDER BY j.created_at DESC,j.id,f.piece_number LIMIT p_limit) x),'[]'::jsonb);
END; $function$
;
CREATE OR REPLACE FUNCTION public.production_job_document(p_code text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE job public.production_jobs%rowtype; result jsonb; known boolean; total bigint; fabric_count integer;
BEGIN
 SELECT * INTO job FROM public.production_jobs WHERE code=btrim(p_code) OR id::text=btrim(p_code);
 IF job.id IS NULL THEN RETURN NULL; END IF;
 IF NOT(public.has_perm(auth.uid(),'production.view') OR public.has_perm(auth.uid(),'production.receive') OR (public.has_role(auth.uid(),'tailor') AND public.owns_production_job(job.id))) THEN RAISE EXCEPTION 'Production workflow access required'; END IF;
 SELECT count(*)::integer,count(c.issue_line_id)=count(*),sum(c.amount_paise)::bigint INTO fabric_count,known,total
 FROM public.material_issue_lines l JOIN public.material_issues i ON i.id=l.material_issue_id LEFT JOIN public.production_issue_fabric_costs c ON c.issue_line_id=l.id WHERE i.production_job_id=job.id AND l.thaan_id IS NOT NULL;
 result:=jsonb_build_object('id',job.id,'code',job.code,'size',job.size,'quantity',job.quantity,'status',job.status,
 'product',(SELECT name FROM public.products WHERE id=job.product_id),'design',coalesce((SELECT name FROM public.designs WHERE id=job.design_id),job.custom_design),'design_code',(SELECT code FROM public.designs WHERE id=job.design_id),
 'tailors',public.production_tailor_names(job.id),'created_at',job.created_at,
 'issued_at',(SELECT min(issued_at) FROM public.material_issues WHERE production_job_id=job.id),
 'finished_at',(SELECT max(recorded_at) FROM public.production_status_events WHERE job_id=job.id AND status='completed'),
 'received_at',(SELECT recorded_at FROM public.finished_product_receipts WHERE production_job_id=job.id),
 'fabrics',coalesce((SELECT jsonb_agg(jsonb_build_object('barcode',coalesce(v.code,t.barcode,bc.code),'name',f.name,'quantity_mm',l.quantity,'source',loc.name,'issued_at',i.issued_at,'issue_type',i.issue_type) ORDER BY i.issued_at,l.id) FROM public.material_issue_lines l JOIN public.material_issues i ON i.id=l.material_issue_id JOIN public.thaans t ON t.id=l.thaan_id JOIN public.fabric_stock s ON s.id=l.fabric_stock_id JOIN public.fabrics f ON f.id=s.fabric_id JOIN public.barcodes bc ON bc.id=s.barcode_id JOIN public.locations loc ON loc.id=i.source_location_id LEFT JOIN public.stock_registration_variants v ON v.thaan_id=t.id WHERE i.production_job_id=job.id),'[]'::jsonb));
 IF public.can_view_thaan_cp(NULL) THEN result:=result||jsonb_build_object('cp_total_paise',CASE WHEN known AND fabric_count>0 THEN total END,'cp_basis','All issued fabric, including additional issues','cost_known',known AND fabric_count>0); END IF;
 result:=result||jsonb_build_object('pieces',public.production_specifications(job.id),'mixed',EXISTS(SELECT 1 FROM public.production_piece_specs s WHERE s.production_job_id=job.id AND (s.product_id,s.design_id,s.custom_design,s.size) IS DISTINCT FROM (job.product_id,job.design_id,job.custom_design,job.size)));
 IF result->>'mixed'='true' THEN result:=result||jsonb_build_object('product','Mixed products / sizes','design','Per-piece specifications','size',NULL); END IF;
 RETURN result;
END; $$;
CREATE OR REPLACE FUNCTION public.production_history_base(p_job uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF NOT (public.has_perm(auth.uid(),'production.view') OR public.has_role(auth.uid(),'tailor')) THEN RAISE EXCEPTION 'Owner or assigned Tailor required'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'History limit must be 1 to 100'; END IF;
 RETURN coalesce((SELECT jsonb_agg(r ORDER BY r->>'created_at' DESC,r->>'id') FROM (
 SELECT jsonb_build_object('id',j.id,'code',j.code,'product',p.name,'design',coalesce(d.name,j.custom_design),'quantity',j.quantity,'status',j.status,'size',j.size,'notes',j.notes,'received',EXISTS(SELECT 1 FROM public.finished_product_receipts WHERE production_job_id=j.id),'created_at',j.created_at,
 'factory',f.name,'section',s.name,'tailor',t.real_name,'assignment_id',j.tailor_assignment_id,'tailors',public.production_tailor_names(j.id),
 'requirements',coalesce((SELECT jsonb_agg(jsonb_build_object('id',req.id,'fabric_stock_id',req.fabric_stock_id,'material_id',req.material_id,'quantity',req.quantity,'unit',req.unit,'issue_line_id',req.material_issue_line_id,'name',coalesce(fab.name,mat.name),'batch',b.code,'thaan_id',line.thaan_id) ORDER BY req.id) FROM public.job_material_requirements req LEFT JOIN public.fabric_stock fs ON fs.id=req.fabric_stock_id LEFT JOIN public.fabrics fab ON fab.id=fs.fabric_id LEFT JOIN public.receiving_batches b ON b.id=fs.batch_id LEFT JOIN public.materials mat ON mat.id=req.material_id LEFT JOIN public.material_issue_lines line ON line.id=req.material_issue_line_id WHERE req.production_job_id=j.id),'[]'::jsonb),
 'events',coalesce((SELECT jsonb_agg(jsonb_build_object('status',e.status,'previous_status',e.previous_status,'actor_id',e.actor_id,'reason',e.reason,'recorded_at',e.recorded_at) ORDER BY e.recorded_at,e.id) FROM public.production_status_events e WHERE e.job_id=j.id),'[]'::jsonb)) r
 FROM public.production_jobs j JOIN public.products p ON p.id=j.product_id LEFT JOIN public.designs d ON d.id=j.design_id
 JOIN public.tailor_assignments a ON a.id=j.tailor_assignment_id JOIN public.tailoring_factories f ON f.id=a.factory_id
 LEFT JOIN public.tailoring_sections s ON s.id=a.section_id JOIN public.tailors t ON t.id=a.tailor_id
 WHERE (p_job IS NULL OR j.id=p_job) AND (public.has_perm(auth.uid(),'production.view') OR public.owns_production_job(j.id))
 ORDER BY j.created_at DESC,j.id LIMIT p_limit) x),'[]'::jsonb);
END; $function$
;
REVOKE ALL ON FUNCTION public.production_history_base(uuid,integer) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.owner_production_history(p_job uuid DEFAULT NULL,p_limit integer DEFAULT 100) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(row_value || public.production_job_document(row_value->>'id')), '[]') FROM jsonb_array_elements(public.production_history_base(p_job,p_limit)) row_value;
$$;
CREATE OR REPLACE FUNCTION public.capture_sale_analysis_dimensions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.status='completed' AND (NEW.payment_confirmed_at IS NOT NULL OR NEW.kind='counter_bill') AND NEW.kind IN('direct_fabric_sale','finished_product_sale','ecommerce_sale','counter_bill') AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'completed' OR OLD.payment_confirmed_at IS NULL) THEN
  INSERT INTO public.sale_analysis_channels(order_id,channel) VALUES(NEW.id,CASE WHEN NEW.kind='ecommerce_sale' THEN 'ecommerce' ELSE 'counter' END) ON CONFLICT DO NOTHING;
  INSERT INTO public.sale_analysis_dimensions(order_item_id,fabric_type,vendor_id,vendor_name,product_name,design_name,size,salesperson_name)
  SELECT it.id,coalesce(g.name,f.name),batch.supplier_id,coalesce(rb.provider_name,supplier.name),product.name,coalesce(public.production_piece_context(piece.id)->>'design',design.name,job.custom_design),public.production_piece_context(piece.id)->>'size',person.full_name
  FROM public.order_items it LEFT JOIN public.fabric_stock fs ON fs.id=it.fabric_stock_id LEFT JOIN public.fabrics f ON f.id=fs.fabric_id
  LEFT JOIN public.receiving_batches batch ON batch.id=fs.batch_id LEFT JOIN public.suppliers supplier ON supplier.id=batch.supplier_id
  LEFT JOIN public.stock_registration_batches rb ON rb.batch_id=batch.id LEFT JOIN public.stock_registration_variants variant ON variant.thaan_id=it.thaan_id
  LEFT JOIN public.stock_registration_fabric_types g ON g.id=variant.fabric_type_id LEFT JOIN public.finished_products piece ON piece.id=it.finished_product_id
  LEFT JOIN public.products product ON product.id=piece.product_id LEFT JOIN public.designs design ON design.id=piece.design_id
  LEFT JOIN public.production_jobs job ON job.id=piece.production_job_id LEFT JOIN public.profiles person ON person.id=NEW.salesperson_user_id WHERE it.order_id=NEW.id ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION public.submit_paid_ecommerce_order(p_request uuid,p_external_order text,p_payment_reference text,p_paid_at timestamptz,p_paid_total_paise bigint,p_recorded_by uuid,p_items jsonb,p_customer uuid DEFAULT NULL,p_salesperson uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result uuid:=gen_random_uuid(); saved public.ecommerce_paid_receipts%rowtype; payload_value jsonb; r jsonb; source_id uuid;
 customer_value jsonb; th public.thaans%rowtype; piece public.finished_products%rowtype; price public.finished_product_prices%rowtype;
 inv uuid; item_id uuid; qty numeric; sp bigint; cp bigint; amount bigint; total numeric:=0;
 cost_id uuid; reviewed_id uuid; evidence jsonb; cost_amount bigint;
BEGIN
 -- Service-role grant is the authorization boundary. Reject end-user sessions,
 -- even if a trusted server accidentally attaches one to its admin client.
 IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'Use an isolated server service client'; END IF;
 IF p_request IS NULL OR nullif(btrim(p_external_order),'') IS NULL OR nullif(btrim(p_payment_reference),'') IS NULL OR length(p_external_order)>200 OR length(p_payment_reference)>200 OR p_paid_at IS NULL OR p_paid_at>clock_timestamp()+interval '5 minutes' OR p_paid_total_paise NOT BETWEEN 1 AND 9007199254740991 OR p_paid_total_paise IS NULL THEN RAISE EXCEPTION 'Verified paid order, reference, timestamp and exact positive total required'; END IF;
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Supply 1 to 100 explicit Showroom items'; END IF;
 payload_value:=jsonb_build_object('external_order',btrim(p_external_order),'payment_reference',btrim(p_payment_reference),'paid_at',p_paid_at,'paid_total_paise',p_paid_total_paise,'recorded_by',p_recorded_by,'items',p_items,'customer',p_customer,'salesperson',p_salesperson);
 -- Serialize request IDs and provider references across webhook retries.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,6));
 PERFORM pg_advisory_xact_lock(hashtextextended(btrim(p_external_order),42));
 PERFORM pg_advisory_xact_lock(hashtextextended(btrim(p_payment_reference),43));
 SELECT * INTO saved FROM public.ecommerce_paid_receipts WHERE request_id=p_request OR external_order=btrim(p_external_order) OR payment_reference=btrim(p_payment_reference);
 IF FOUND THEN
  IF saved.payload IS DISTINCT FROM payload_value OR NOT EXISTS(SELECT 1 FROM public.orders WHERE id=saved.order_id AND status='completed') THEN RAISE EXCEPTION 'Online order or payment reference reused with different data'; END IF;
  RETURN saved.order_id;
 END IF;
 IF EXISTS(SELECT 1 FROM public.orders WHERE sale_request_id=p_request) THEN RAISE EXCEPTION 'Request already used by another sale'; END IF;
 PERFORM 1 FROM public.profiles WHERE id=p_recorded_by AND active FOR SHARE;
 IF NOT FOUND OR NOT public.has_any_role(p_recorded_by,ARRAY['owner','ecommerce_manager']) THEN RAISE EXCEPTION 'Active configured Owner or E-commerce integration account required'; END IF;
 IF p_salesperson IS NOT NULL THEN
  PERFORM 1 FROM public.profiles WHERE id=p_salesperson AND active FOR SHARE;
  IF NOT FOUND OR NOT public.has_role(p_salesperson,'salesperson') THEN RAISE EXCEPTION 'Active credited Salesperson required'; END IF;
  PERFORM 1 FROM public.user_roles WHERE user_id=p_salesperson AND role_key='salesperson' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Salesperson role required'; END IF;
 END IF;
 IF p_customer IS NULL THEN customer_value:=jsonb_build_object('name','Online self-service customer');
 ELSE SELECT jsonb_build_object('id',id,'name',name,'phone',phone) INTO customer_value FROM public.customers WHERE id=p_customer;
  IF NOT FOUND THEN RAISE EXCEPTION 'Existing customer required'; END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) WHERE jsonb_typeof(value) IS DISTINCT FROM 'object' OR nullif(value->>'source_id','') IS NULL OR
  (value->>'kind'='fabric' AND (value-ARRAY['kind','source_id','inventory_item_id','quantity_mm','sp_paise_per_m'])<>'{}') OR
  (value->>'kind'='product' AND (value-ARRAY['kind','source_id','piece_id','sp_version_id'])<>'{}') OR coalesce(value->>'kind','') NOT IN('fabric','product')) THEN RAISE EXCEPTION 'Explicit fabric cut or saved-price physical piece required'; END IF;
 IF (SELECT count(DISTINCT (value->>'inventory_item_id',value->>'source_id')) FROM jsonb_array_elements(p_items) WHERE value->>'kind'='fabric')<>(SELECT count(*) FROM jsonb_array_elements(p_items) WHERE value->>'kind'='fabric') OR
  (SELECT count(DISTINCT value->>'piece_id') FROM jsonb_array_elements(p_items) WHERE value->>'kind'='product')<>(SELECT count(*) FROM jsonb_array_elements(p_items) WHERE value->>'kind'='product') THEN RAISE EXCEPTION 'Duplicate cart lines are not accepted'; END IF;
 -- Keep the same parent → item → location → physical piece lock order as POS.
 PERFORM 1 FROM public.fabric_stock WHERE id IN(SELECT t.fabric_stock_id FROM public.thaans t JOIN public.inventory_items i ON i.thaan_id=t.id JOIN jsonb_array_elements(p_items) x ON i.id=(x->>'inventory_item_id')::uuid) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.production_jobs WHERE id IN(SELECT p.production_job_id FROM public.finished_products p JOIN jsonb_array_elements(p_items) x ON p.id=(x->>'piece_id')::uuid) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.inventory_items i WHERE i.id IN(SELECT (value->>'inventory_item_id')::uuid FROM jsonb_array_elements(p_items)) OR i.finished_product_id IN(SELECT (value->>'piece_id')::uuid FROM jsonb_array_elements(p_items)) ORDER BY i.id FOR UPDATE;
 PERFORM 1 FROM public.locations WHERE id IN(SELECT (value->>'source_id')::uuid FROM jsonb_array_elements(p_items)) OR id IN(SELECT parent_id FROM public.locations WHERE id IN(SELECT (value->>'source_id')::uuid FROM jsonb_array_elements(p_items))) ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE NOT EXISTS(SELECT 1 FROM public.locations l LEFT JOIN public.locations parent ON parent.id=l.parent_id WHERE l.id=(x->>'source_id')::uuid AND l.active AND (l.kind='showroom' OR (l.kind='showroom_sublocation' AND parent.active AND parent.kind='showroom')))) THEN RAISE EXCEPTION 'Online sales require active Showroom floors only'; END IF;
 INSERT INTO public.ecommerce_paid_receipts(request_id,order_id,external_order,payment_reference,paid_at,paid_total_paise,recorded_by,payload) VALUES(p_request,result,btrim(p_external_order),btrim(p_payment_reference),p_paid_at,p_paid_total_paise,p_recorded_by,payload_value);
 INSERT INTO public.orders(id,code,kind,customer_id,source_location_id,created_by,salesperson_user_id,reference,sale_request_id,sale_request_payload,customer_snapshot,payment_confirmed_at)
 VALUES(result,'WEB-'||replace(result::text,'-',''),'ecommerce_sale',p_customer,(p_items->0->>'source_id')::uuid,p_recorded_by,p_salesperson,btrim(p_external_order),p_request,payload_value,customer_value,p_paid_at);
 INSERT INTO public.sale_analysis_channels(order_id,channel,external_reference) VALUES(result,'ecommerce',btrim(p_external_order));
 FOR r IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY coalesce(value->>'inventory_item_id',value->>'piece_id'),value->>'source_id' LOOP
  source_id:=(r->>'source_id')::uuid;
  IF r->>'kind'='fabric' THEN
   qty:=(r->>'quantity_mm')::numeric;
   IF qty IS NULL OR qty<=0 OR qty<>trunc(qty) OR qty>2147483647 OR jsonb_typeof(r->'quantity_mm') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Exact positive integer millimetres required'; END IF;
   IF jsonb_typeof(r->'sp_paise_per_m') IS DISTINCT FROM 'number' OR (r->>'sp_paise_per_m')::numeric<>trunc((r->>'sp_paise_per_m')::numeric) OR (r->>'sp_paise_per_m')::numeric NOT BETWEEN 0 AND 9007199254740991 THEN RAISE EXCEPTION 'Exact nonnegative online per-metre price required'; END IF;
   inv:=(r->>'inventory_item_id')::uuid;
   SELECT t.* INTO th FROM public.thaans t JOIN public.inventory_items i ON i.thaan_id=t.id JOIN public.fabric_stock s ON s.id=t.fabric_stock_id WHERE i.id=inv AND i.unit='mm' AND t.status='active' AND s.entry_state IN('complete','correcting','legacy_pending');
   IF NOT FOUND THEN RAISE EXCEPTION 'Located active Thaan required'; END IF;
   SELECT cp_paise_per_m INTO cp FROM public.fabric_stock_costs WHERE fabric_stock_id=th.fabric_stock_id ORDER BY revision DESC LIMIT 1;
   IF cp IS NULL OR cp<=0 THEN RAISE EXCEPTION 'Recorded positive Thaan CP required'; END IF;
   sp:=(r->>'sp_paise_per_m')::bigint;amount:=round(qty*sp/1000);
   INSERT INTO public.order_items(order_id,fabric_stock_id,thaan_id,quantity,unit,sp_snapshot_paise,final_customer_price_paise) VALUES(result,th.fabric_stock_id,th.id,qty,'mm',sp,amount) RETURNING id INTO item_id;
   INSERT INTO public.order_item_financials(order_item_id,cp_snapshot_paise) VALUES(item_id,cp);
   INSERT INTO public.ecommerce_sale_sources VALUES(item_id,source_id);
   INSERT INTO public.inventory_movements(kind,inventory_item_id,fabric_stock_id,thaan_id,quantity,unit,source_location_id,order_item_id,actor_id,reason,reference) VALUES('SALE',inv,th.fabric_stock_id,th.id,qty,'mm',source_id,item_id,p_recorded_by,'Verified paid E-commerce order; server integration','ORDER:'||result::text);
   IF public.inventory_balance(inv,NULL)=0 THEN UPDATE public.thaans SET status='depleted',updated_at=now() WHERE id=th.id; END IF;
  ELSE
   SELECT * INTO piece FROM public.finished_products WHERE id=(r->>'piece_id')::uuid AND status='available' AND current_location_id=source_id FOR UPDATE;
   SELECT id INTO inv FROM public.inventory_items WHERE finished_product_id=piece.id AND unit='pc';
   IF piece.id IS NULL OR inv IS NULL OR public.inventory_balance(inv,source_id)<>1 THEN RAISE EXCEPTION 'Available physical piece on its Showroom floor required'; END IF;
   SELECT * INTO price FROM public.finished_product_prices WHERE finished_product_id=piece.id ORDER BY revision DESC LIMIT 1;
   IF price.id IS NULL OR price.id IS DISTINCT FROM (r->>'sp_version_id')::uuid OR price.sp_paise NOT BETWEEN 0 AND 9007199254740991 THEN RAISE EXCEPTION 'Saved Workshop SP changed or missing; refresh'; END IF;
   SELECT cost_version_id INTO reviewed_id FROM public.finished_product_price_reviews WHERE price_id=price.id;
   SELECT id INTO cost_id FROM public.production_cost_versions WHERE production_job_id=piece.production_job_id ORDER BY revision DESC LIMIT 1;
   SELECT amount_paise INTO cost_amount FROM public.finished_product_cost_allocations WHERE finished_product_id=piece.id AND cost_version_id=cost_id;
   IF reviewed_id IS NULL OR cost_amount IS NULL OR NOT EXISTS(SELECT 1 FROM public.production_cost_requests WHERE result_id=cost_id AND payload ? 'materials') THEN RAISE EXCEPTION 'Reviewed saved price and recorded piece CP required'; END IF;
   SELECT jsonb_build_object('quantity_snapshot',v.quantity_snapshot,'lines',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM public.production_cost_lines l WHERE l.cost_version_id=v.id),'[]')) INTO evidence FROM public.production_cost_versions v WHERE v.id=cost_id;
   amount:=price.sp_paise;
   INSERT INTO public.order_items(order_id,finished_product_id,quantity,unit,sp_snapshot_paise,final_customer_price_paise) VALUES(result,piece.id,1,'pc',amount,amount) RETURNING id INTO item_id;
   INSERT INTO public.order_item_financials(order_item_id,production_cost_snapshot_paise) VALUES(item_id,cost_amount);
   INSERT INTO public.finished_product_sale_snapshots(order_item_id,price_version_id,cost_version_id,reviewed_cost_version_id,cost_evidence,item_snapshot)
   VALUES(item_id,price.id,cost_id,reviewed_id,evidence,(SELECT jsonb_build_object('barcode',b.code,'product',product.name,'design',public.production_piece_context(piece.id)->>'design','size',public.production_piece_context(piece.id)->>'size','job_code',j.code,'piece_number',piece.piece_number,'source',loc.name,'recording_basis','service_integration','recorded_by',p_recorded_by) FROM public.barcodes b JOIN public.products product ON product.id=piece.product_id LEFT JOIN public.designs design ON design.id=piece.design_id JOIN public.production_jobs j ON j.id=piece.production_job_id JOIN public.locations loc ON loc.id=source_id WHERE b.id=piece.barcode_id));
   INSERT INTO public.ecommerce_sale_sources VALUES(item_id,source_id);
   INSERT INTO public.inventory_movements(inventory_item_id,kind,finished_product_id,quantity,unit,source_location_id,order_item_id,actor_id,reason,reference) VALUES(inv,'SALE',piece.id,1,'pc',source_id,item_id,p_recorded_by,'Verified paid E-commerce order; server integration','ORDER:'||result::text);
   UPDATE public.finished_products SET status='sold' WHERE id=piece.id;
  END IF;
  total:=total+amount;
  IF total>9007199254740991 THEN RAISE EXCEPTION 'Exact supported paid total exceeded'; END IF;
 END LOOP;
 IF total<>p_paid_total_paise THEN RAISE EXCEPTION 'Verified settled payment must equal all sale lines'; END IF;
 UPDATE public.orders SET status='completed',final_customer_price_paise=total::bigint,completed_at=p_paid_at WHERE id=result;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference) VALUES(p_recorded_by,'submit_paid_ecommerce_order','orders',result,jsonb_build_object('channel','ecommerce','recording_basis','service_integration','external_order',btrim(p_external_order),'payment_reference',btrim(p_payment_reference),'paid_total_paise',p_paid_total_paise,'paid_at',p_paid_at),'WEB:'||p_request::text);
 RETURN result;
END; $$;
CREATE OR REPLACE FUNCTION public.complete_finished_product_sale(p_request uuid,p_source uuid,p_items jsonb,p_customer uuid,p_payment_confirmed boolean,p_reference text,p_salesperson uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE saved public.orders%rowtype; payload_value jsonb; customer_value jsonb; result uuid:=gen_random_uuid(); row_value jsonb; piece public.finished_products%rowtype; price public.finished_product_prices%rowtype; inv uuid; line_id uuid; total numeric:=0; cost_id uuid; reviewed_id uuid; cost_amount bigint; evidence jsonb;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) OR NOT public.has_perm(auth.uid(),'pos.sell') THEN RAISE EXCEPTION 'Authorized Owner or Counter required'; END IF;
 IF p_request IS NULL OR p_source IS NULL OR p_payment_confirmed IS DISTINCT FROM true OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Request, source, 1–50 pieces and confirmed received payment required'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) WHERE jsonb_typeof(value)<>'object' OR (value-ARRAY['piece_id','sp_version_id'])<>'{}'::jsonb) THEN RAISE EXCEPTION 'Only explicit piece ID and expected SP version are accepted'; END IF;
 IF (SELECT count(DISTINCT value->>'piece_id') FROM jsonb_array_elements(p_items))<>jsonb_array_length(p_items) THEN RAISE EXCEPTION 'Distinct explicit physical pieces required'; END IF;
 payload_value:=jsonb_build_object('salesperson',p_salesperson,'actor',auth.uid(),'source',p_source,'items',p_items,'customer',p_customer,'payment_confirmed',true,'reference',nullif(btrim(p_reference),''));
 -- Shared with Phase 6: sale request IDs are unique across sale kinds.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,6));
 SELECT * INTO saved FROM public.orders WHERE sale_request_id=p_request;
 IF FOUND THEN
  IF saved.kind<>'finished_product_sale' OR saved.created_by IS DISTINCT FROM auth.uid() OR saved.sale_request_payload IS DISTINCT FROM payload_value OR saved.status<>'completed' THEN RAISE EXCEPTION 'Sale request already used with different data or actor'; END IF;
  RETURN saved.id;
 END IF;
 IF p_customer IS NULL THEN customer_value:=jsonb_build_object('name','Walk-in customer');
 ELSE SELECT jsonb_build_object('id',id,'name',name,'phone',phone,'whatsapp_phone',whatsapp_phone) INTO customer_value FROM public.customers WHERE id=p_customer;
  IF NOT FOUND THEN RAISE EXCEPTION 'Existing customer required'; END IF;
 END IF;
 -- Job locks serialize Phase 12 SP/cost revisions. Then take the same stable
 -- inventory/location lock order used by transfers before locking piece rows.
 PERFORM 1 FROM public.production_jobs WHERE id IN(SELECT p.production_job_id FROM public.finished_products p JOIN jsonb_array_elements(p_items) x ON p.id=(x->>'piece_id')::uuid) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.inventory_items WHERE finished_product_id IN(SELECT (value->>'piece_id')::uuid FROM jsonb_array_elements(p_items)) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.locations WHERE id=p_source AND active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active sale location required'; END IF;
 INSERT INTO public.orders(id,code,kind,customer_id,source_location_id,created_by,salesperson_user_id,reference,sale_request_id,sale_request_payload,customer_snapshot,payment_confirmed_at)
 VALUES(result,'PRODUCT-SALE-'||replace(result::text,'-',''),'finished_product_sale',p_customer,p_source,auth.uid(),p_salesperson,nullif(btrim(p_reference),''),p_request,payload_value,customer_value,now());
 FOR row_value IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY value->>'piece_id' LOOP
  SELECT * INTO piece FROM public.finished_products WHERE id=(row_value->>'piece_id')::uuid AND status='available' AND current_location_id=p_source FOR UPDATE;
  SELECT id INTO inv FROM public.inventory_items WHERE finished_product_id=piece.id AND unit='pc';
  IF piece.id IS NULL OR inv IS NULL OR public.inventory_balance(inv,p_source)<>1 THEN RAISE EXCEPTION 'Available physical piece at selected source required'; END IF;
  SELECT * INTO price FROM public.finished_product_prices WHERE finished_product_id=piece.id ORDER BY revision DESC LIMIT 1;
  IF price.id IS NULL OR price.id IS DISTINCT FROM (row_value->>'sp_version_id')::uuid OR price.sp_paise NOT BETWEEN 0 AND 9007199254740991 THEN RAISE EXCEPTION 'Current Owner SP changed or missing; refresh and review'; END IF;
  SELECT cost_version_id INTO reviewed_id FROM public.finished_product_price_reviews WHERE price_id=price.id;
  SELECT id INTO cost_id FROM public.production_cost_versions WHERE production_job_id=piece.production_job_id ORDER BY revision DESC LIMIT 1;
  SELECT amount_paise INTO cost_amount FROM public.finished_product_cost_allocations WHERE finished_product_id=piece.id AND cost_version_id=cost_id;
  IF reviewed_id IS NULL OR cost_amount IS NULL OR NOT EXISTS(SELECT 1 FROM public.production_cost_requests WHERE result_id=cost_id AND payload ? 'materials') THEN RAISE EXCEPTION 'Owner-reviewed price and finalized production cost required'; END IF;
  SELECT jsonb_build_object('quantity_snapshot',v.quantity_snapshot,'total_paise',(SELECT coalesce(sum(amount_paise),0) FROM public.production_cost_lines WHERE cost_version_id=v.id),'lines',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM public.production_cost_lines l WHERE l.cost_version_id=v.id),'[]')) INTO evidence FROM public.production_cost_versions v WHERE v.id=cost_id;
  total:=total+price.sp_paise;
  IF total>9007199254740991 THEN RAISE EXCEPTION 'Total exceeds supported exact money range'; END IF;
  INSERT INTO public.order_items(order_id,finished_product_id,quantity,unit,sp_snapshot_paise,final_customer_price_paise) VALUES(result,piece.id,1,'pc',price.sp_paise,price.sp_paise) RETURNING id INTO line_id;
  INSERT INTO public.order_item_financials(order_item_id,production_cost_snapshot_paise) VALUES(line_id,cost_amount);
  INSERT INTO public.finished_product_sale_snapshots(order_item_id,price_version_id,cost_version_id,reviewed_cost_version_id,cost_evidence,item_snapshot) VALUES(line_id,price.id,cost_id,reviewed_id,evidence,(SELECT jsonb_build_object('barcode',b.code,'product',product.name,'design',design.name,'job_code',j.code,'piece_number',piece.piece_number,'source',loc.name,'actor',actor.full_name) FROM public.barcodes b JOIN public.products product ON product.id=piece.product_id JOIN public.designs design ON design.id=piece.design_id JOIN public.production_jobs j ON j.id=piece.production_job_id JOIN public.locations loc ON loc.id=p_source LEFT JOIN public.profiles actor ON actor.id=auth.uid() WHERE b.id=piece.barcode_id));
  INSERT INTO public.inventory_movements(inventory_item_id,kind,finished_product_id,quantity,unit,source_location_id,order_item_id,actor_id,reason,reference) VALUES(inv,'SALE',piece.id,1,'pc',p_source,line_id,auth.uid(),'Finished Product Sale','ORDER:'||result::text);
  UPDATE public.finished_products SET status='sold' WHERE id=piece.id;
 END LOOP;
 UPDATE public.orders SET status='completed',final_customer_price_paise=total::bigint,completed_at=now() WHERE id=result;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference) VALUES(auth.uid(),'complete_finished_product_sale','orders',result,jsonb_build_object('source',p_source,'total_paise',total,'items',p_items),'PRODUCT-SALE:'||p_request::text);
 RETURN result;
END; $$;
NOTIFY pgrst,'reload schema';
COMMIT;
