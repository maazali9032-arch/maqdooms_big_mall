-- Approved Owner Production workflow revision. Preserve all existing rows and migrations.
BEGIN;
INSERT INTO public.permissions(key,label,domain) VALUES
 ('stock.transfer_finished','Transfer finished pieces from Workshop to Showroom floors','inventory') ON CONFLICT(key) DO NOTHING;
INSERT INTO public.role_permissions(role_key,permission_key) VALUES('stock_entry','stock.transfer_finished') ON CONFLICT DO NOTHING;
CREATE TABLE public.production_job_tailors(
 production_job_id uuid NOT NULL REFERENCES public.production_jobs(id),
 tailor_assignment_id uuid NOT NULL REFERENCES public.tailor_assignments(id),
 recorded_by uuid NOT NULL REFERENCES public.profiles(id),
 recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(production_job_id,tailor_assignment_id)
);
CREATE INDEX production_shared_assignment_idx ON public.production_job_tailors(tailor_assignment_id,production_job_id);
ALTER TABLE public.production_job_tailors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.production_job_tailors FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.production_job_tailors TO authenticated;
GRANT ALL ON public.production_job_tailors TO service_role;
CREATE TRIGGER production_shared_immutable BEFORE UPDATE OR DELETE ON public.production_job_tailors FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();
CREATE FUNCTION public.guard_production_shared_assignment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.production_jobs j JOIN public.tailor_assignments anchor ON anchor.id=j.tailor_assignment_id JOIN public.tailor_assignments a ON a.id=NEW.tailor_assignment_id JOIN public.tailors t ON t.id=a.tailor_id JOIN public.tailoring_factories f ON f.id=a.factory_id LEFT JOIN public.tailoring_sections sec ON sec.id=a.section_id WHERE j.id=NEW.production_job_id AND j.status='open' AND a.factory_id=anchor.factory_id AND a.section_id IS NOT DISTINCT FROM anchor.section_id AND a.valid_from<=now() AND a.valid_until IS NULL AND t.active AND f.active AND (sec.id IS NULL OR sec.active) AND (t.profile_id IS NULL OR public.has_role(t.profile_id,'tailor'))) THEN RAISE EXCEPTION 'Current same Factory and Section Tailor on an open Production Job required'; END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.guard_production_shared_assignment() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER production_shared_insert_guard BEFORE INSERT ON public.production_job_tailors FOR EACH ROW EXECUTE FUNCTION public.guard_production_shared_assignment();
CREATE FUNCTION public.owns_production_job(p_job uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.has_role(auth.uid(),'tailor') AND (
 EXISTS(SELECT 1 FROM public.production_jobs j WHERE j.id=p_job AND public.owns_tailor_assignment(j.tailor_assignment_id)) OR
 EXISTS(SELECT 1 FROM public.production_job_tailors a WHERE a.production_job_id=p_job AND public.owns_tailor_assignment(a.tailor_assignment_id)));
$$;
REVOKE ALL ON FUNCTION public.owns_production_job(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.owns_production_job(uuid) TO authenticated;
CREATE POLICY production_shared_read ON public.production_job_tailors FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'owner') OR public.owns_production_job(production_job_id));
CREATE POLICY production_shared_job_read ON public.production_jobs FOR SELECT TO authenticated USING(public.owns_production_job(id));
CREATE POLICY production_shared_event_read ON public.production_status_events FOR SELECT TO authenticated USING(public.owns_production_job(job_id));
CREATE POLICY production_shared_issue_read ON public.material_issues FOR SELECT TO authenticated USING(public.owns_production_job(production_job_id));
-- This helper is private: called only from checked operational projections.
CREATE FUNCTION public.production_tailor_names(p_job uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('assignment_id',a.id,'tailor_id',t.id,'code',t.code,'name',t.real_name) ORDER BY t.code,a.id),'[]'::jsonb)
 FROM public.tailor_assignments a JOIN public.tailors t ON t.id=a.tailor_id
 WHERE a.id IN(SELECT tailor_assignment_id FROM public.production_jobs WHERE id=p_job UNION SELECT tailor_assignment_id FROM public.production_job_tailors WHERE production_job_id=p_job);
$$;
REVOKE ALL ON FUNCTION public.production_tailor_names(uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.create_owner_production_shared(p_request uuid,p_product uuid,p_design uuid,p_quantity integer,p_assignments jsonb,p_source uuid,p_items jsonb,p_notes text,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE payload_value jsonb; saved public.production_requests%rowtype; result uuid; charge uuid; p_assignment uuid; selected_assignments jsonb; candidate uuid; first_assignment public.tailor_assignments%rowtype;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
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
 PERFORM 1 FROM public.designs WHERE id=p_design AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active Design required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tailor_assignments a JOIN public.tailors t ON t.id=a.tailor_id JOIN public.tailoring_factories f ON f.id=a.factory_id
  LEFT JOIN public.tailoring_sections s ON s.id=a.section_id WHERE a.id=p_assignment AND a.valid_until IS NULL AND a.valid_from<=now() AND t.active AND f.active
  AND (s.id IS NULL OR s.active) AND (t.profile_id IS NULL OR public.has_role(t.profile_id,'tailor')))
 THEN RAISE EXCEPTION 'Current active Factory / Section / Tailor assignment required'; END IF;
 SELECT * INTO first_assignment FROM public.tailor_assignments WHERE id=p_assignment;
 FOR candidate IN SELECT value::uuid FROM jsonb_array_elements_text(selected_assignments) LOOP
  IF NOT EXISTS(SELECT 1 FROM public.tailor_assignments a JOIN public.tailors t ON t.id=a.tailor_id JOIN public.tailoring_factories f ON f.id=a.factory_id LEFT JOIN public.tailoring_sections sec ON sec.id=a.section_id
   WHERE a.id=candidate AND a.factory_id=first_assignment.factory_id AND a.section_id IS NOT DISTINCT FROM first_assignment.section_id AND a.valid_until IS NULL AND a.valid_from<=now() AND t.active AND f.active AND (sec.id IS NULL OR sec.active) AND (t.profile_id IS NULL OR public.has_role(t.profile_id,'tailor')))
  THEN RAISE EXCEPTION 'All Tailors must have current active assignments in the selected Factory and Section'; END IF;
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
END; $$;
CREATE OR REPLACE FUNCTION public.progress_owner_production(p_request uuid,p_job uuid,p_expected_status text,p_status text,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE payload_value jsonb; saved public.production_requests%rowtype; job public.production_jobs%rowtype;
BEGIN
 IF NOT (public.has_role(auth.uid(),'owner') OR (public.has_role(auth.uid(),'tailor') AND public.has_perm(auth.uid(),'tailoring.manage_jobs'))) THEN RAISE EXCEPTION 'Owner or assigned Tailor required'; END IF;
 IF p_request IS NULL OR nullif(btrim(p_reason),'') IS NULL OR p_status IS NULL OR p_status NOT IN('in_progress','completed') OR p_expected_status IS NULL
 THEN RAISE EXCEPTION 'Expected status, next status, request and reason required'; END IF;
 payload_value:=jsonb_build_object('actor',auth.uid(),'job',p_job,'expected',p_expected_status,'status',p_status,'reason',btrim(p_reason));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,10));
 SELECT * INTO saved FROM public.production_requests WHERE request_id=p_request;
 IF FOUND THEN
  IF saved.payload IS DISTINCT FROM payload_value THEN RAISE EXCEPTION 'Production request already used with different data'; END IF;
  RETURN saved.result_id;
 END IF;
 SELECT * INTO job FROM public.production_jobs WHERE id=p_job FOR UPDATE;
 IF job.id IS NULL OR NOT (public.has_role(auth.uid(),'owner') OR public.owns_production_job(job.id)) THEN RAISE EXCEPTION 'Assigned Production Job required'; END IF;
 IF job.status IS DISTINCT FROM p_expected_status THEN RAISE EXCEPTION 'Production status changed; refresh before proceeding'; END IF;
 UPDATE public.production_jobs SET status=p_status WHERE id=p_job;
 INSERT INTO public.production_requests VALUES(p_request,auth.uid(),payload_value,p_job,now());
 INSERT INTO public.production_status_events(job_id,request_id,previous_status,status,actor_id,reason) VALUES(p_job,p_request,job.status,p_status,auth.uid(),btrim(p_reason));
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,previous_value,new_value,reference)
 VALUES(auth.uid(),'progress_owner_production','production_jobs',p_job,jsonb_build_object('status',job.status),jsonb_build_object('status',p_status),'PRODUCTION:'||p_request::text);
 RETURN p_job;
END; $$;
CREATE OR REPLACE FUNCTION public.owner_production_history(p_job uuid DEFAULT NULL,p_limit integer DEFAULT 100) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'tailor')) THEN RAISE EXCEPTION 'Owner or assigned Tailor required'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'History limit must be 1 to 100'; END IF;
 RETURN coalesce((SELECT jsonb_agg(r ORDER BY r->>'created_at' DESC,r->>'id') FROM (
 SELECT jsonb_build_object('id',j.id,'code',j.code,'product',p.name,'design',d.name,'quantity',j.quantity,'status',j.status,'notes',j.notes,'created_at',j.created_at,
 'factory',f.name,'section',s.name,'tailor',t.real_name,'assignment_id',j.tailor_assignment_id,'tailors',public.production_tailor_names(j.id),
 'requirements',coalesce((SELECT jsonb_agg(jsonb_build_object('id',req.id,'fabric_stock_id',req.fabric_stock_id,'material_id',req.material_id,'quantity',req.quantity,'unit',req.unit,'issue_line_id',req.material_issue_line_id,'name',coalesce(fab.name,mat.name),'batch',b.code,'thaan_id',line.thaan_id) ORDER BY req.id) FROM public.job_material_requirements req LEFT JOIN public.fabric_stock fs ON fs.id=req.fabric_stock_id LEFT JOIN public.fabrics fab ON fab.id=fs.fabric_id LEFT JOIN public.receiving_batches b ON b.id=fs.batch_id LEFT JOIN public.materials mat ON mat.id=req.material_id LEFT JOIN public.material_issue_lines line ON line.id=req.material_issue_line_id WHERE req.production_job_id=j.id),'[]'::jsonb),
 'events',coalesce((SELECT jsonb_agg(jsonb_build_object('status',e.status,'previous_status',e.previous_status,'actor_id',e.actor_id,'reason',e.reason,'recorded_at',e.recorded_at) ORDER BY e.recorded_at,e.id) FROM public.production_status_events e WHERE e.job_id=j.id),'[]'::jsonb)) r
 FROM public.production_jobs j JOIN public.products p ON p.id=j.product_id JOIN public.designs d ON d.id=j.design_id
 JOIN public.tailor_assignments a ON a.id=j.tailor_assignment_id JOIN public.tailoring_factories f ON f.id=a.factory_id
 LEFT JOIN public.tailoring_sections s ON s.id=a.section_id JOIN public.tailors t ON t.id=a.tailor_id
 WHERE (p_job IS NULL OR j.id=p_job) AND (public.has_role(auth.uid(),'owner') OR public.owns_production_job(j.id))
 ORDER BY j.created_at DESC,j.id LIMIT p_limit) x),'[]'::jsonb);
END; $$;
CREATE FUNCTION public.production_piece_summary(p_job uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('planned',j.quantity,'produced',(SELECT count(*) FROM public.finished_products WHERE production_job_id=j.id),'sold',(SELECT count(*) FROM public.finished_products WHERE production_job_id=j.id AND status='sold'),'remaining',(SELECT count(*) FROM public.finished_products p JOIN public.inventory_items i ON i.finished_product_id=p.id WHERE p.production_job_id=j.id AND p.status='available' AND public.inventory_balance(i.id,p.current_location_id)=1),'archived',(SELECT count(*) FROM public.finished_products WHERE production_job_id=j.id AND status='archived')) FROM public.production_jobs j WHERE j.id=p_job;
$$;
REVOKE ALL ON FUNCTION public.production_piece_summary(uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.finished_product_catalog(p_barcode text DEFAULT NULL,p_job uuid DEFAULT NULL,p_limit integer DEFAULT 100) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE owner boolean:=public.has_role(auth.uid(),'owner'); counter boolean:=public.has_role(auth.uid(),'counter');
BEGIN
 IF NOT (owner OR counter OR public.has_role(auth.uid(),'tailor')) THEN RAISE EXCEPTION 'Owner, Counter or assigned Tailor required'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Limit must be 1 to 100'; END IF;
 RETURN coalesce((SELECT jsonb_agg(row_value ORDER BY (row_value->>'piece_number')::integer,row_value->>'id') FROM (
 SELECT jsonb_build_object('id',f.id,'barcode',b.code,'piece_number',f.piece_number,'product',p.name,'product_id',p.id,'design',d.name,'design_id',d.id,
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
 JOIN public.production_jobs j ON j.id=f.production_job_id JOIN public.products p ON p.id=f.product_id JOIN public.designs d ON d.id=f.design_id
 JOIN public.tailor_assignments a ON a.id=j.tailor_assignment_id JOIN public.tailoring_factories factory ON factory.id=a.factory_id
 LEFT JOIN public.tailoring_sections s ON s.id=a.section_id JOIN public.tailors t ON t.id=a.tailor_id JOIN public.locations loc ON loc.id=f.current_location_id
 LEFT JOIN public.inventory_items inv ON inv.finished_product_id=f.id
 WHERE (p_barcode IS NULL OR b.code=btrim(p_barcode)) AND (p_job IS NULL OR j.id=p_job)
 AND (owner OR counter OR public.owns_production_job(j.id))
 ORDER BY j.created_at DESC,j.id,f.piece_number LIMIT p_limit) x),'[]'::jsonb);
END; $$;
CREATE OR REPLACE FUNCTION public.material_issue_jobs() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter','tailor']) THEN RAISE EXCEPTION 'Active job role required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC,x.id) FROM(
 SELECT j.id,j.code,j.kind,j.status,j.created_at,a.id assignment_id,f.id factory_id,f.name factory_name,
 s.id section_id,s.name section_name,t.id tailor_id,t.code tailor_code,t.real_name tailor_name,CASE WHEN j.kind='production' THEN public.production_tailor_names(j.id) ELSE '[]'::jsonb END tailors
 FROM (SELECT id,code,'customer_tailoring'::text kind,status,created_at,tailor_assignment_id FROM public.customer_tailoring_jobs
 UNION ALL SELECT id,code,'production',status,created_at,tailor_assignment_id FROM public.production_jobs) j
 JOIN public.tailor_assignments a ON a.id=j.tailor_assignment_id JOIN public.tailoring_factories f ON f.id=a.factory_id
 LEFT JOIN public.tailoring_sections s ON s.id=a.section_id JOIN public.tailors t ON t.id=a.tailor_id
 WHERE public.has_any_role(auth.uid(),ARRAY['owner','counter']) OR public.owns_tailor_assignment(a.id) OR public.owns_production_job(j.id)) x),'[]'::jsonb);
END; $$;
CREATE OR REPLACE FUNCTION public.material_issue_history(p_job uuid DEFAULT NULL,p_limit integer DEFAULT 100) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter','tailor']) THEN RAISE EXCEPTION 'Active job role required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.issued_at DESC,x.id) FROM(
 SELECT mi.id,mi.code,mi.customer_tailoring_job_id,mi.production_job_id,coalesce(cj.code,pj.code) job_code,
 mi.issue_type,mi.reason,mi.issued_by,pr.full_name issuer_name,mi.issued_at,mi.source_location_id,l.name source_name,
 mi.tailor_assignment_id,a.factory_id,f.name factory_name,a.section_id,s.name section_name,a.tailor_id,t.code tailor_code,t.real_name tailor_name,public.production_tailor_names(mi.production_job_id) tailors,
 (SELECT jsonb_agg(jsonb_build_object('id',ml.id,'material_id',ml.material_id,'name',coalesce(mat.name,fab.name),'category',mat.category,
 'fabric_stock_id',ml.fabric_stock_id,'thaan_id',ml.thaan_id,'batch_code',b.code,'barcode',bc.code,'quantity',ml.quantity,'unit',ml.unit,'movement_id',mov.id) ORDER BY ml.id)
 FROM public.material_issue_lines ml LEFT JOIN public.materials mat ON mat.id=ml.material_id
 LEFT JOIN public.fabric_stock fs ON fs.id=ml.fabric_stock_id LEFT JOIN public.fabrics fab ON fab.id=fs.fabric_id
 LEFT JOIN public.receiving_batches b ON b.id=fs.batch_id LEFT JOIN public.barcodes bc ON bc.id=fs.barcode_id
 LEFT JOIN public.inventory_movements mov ON mov.material_issue_line_id=ml.id WHERE ml.material_issue_id=mi.id) lines
 FROM public.material_issues mi JOIN public.tailor_assignments a ON a.id=mi.tailor_assignment_id
 JOIN public.tailoring_factories f ON f.id=a.factory_id LEFT JOIN public.tailoring_sections s ON s.id=a.section_id
 JOIN public.tailors t ON t.id=a.tailor_id JOIN public.locations l ON l.id=mi.source_location_id LEFT JOIN public.profiles pr ON pr.id=mi.issued_by
 LEFT JOIN public.customer_tailoring_jobs cj ON cj.id=mi.customer_tailoring_job_id LEFT JOIN public.production_jobs pj ON pj.id=mi.production_job_id
 WHERE (p_job IS NULL OR p_job IN(mi.customer_tailoring_job_id,mi.production_job_id))
 AND (public.has_any_role(auth.uid(),ARRAY['owner','counter']) OR public.owns_tailor_assignment(a.id) OR public.owns_production_job(mi.production_job_id))
 ORDER BY mi.issued_at DESC,mi.id LIMIT greatest(1,least(coalesce(p_limit,100),200))) x),'[]'::jsonb);
END; $$;
CREATE OR REPLACE FUNCTION public.post_inventory_transfer(p_request_id uuid,p_source uuid,p_destination uuid,p_items jsonb,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid; v_existing public.stock_transfers%rowtype; v_payload jsonb; r jsonb; i public.inventory_items%rowtype; v_line uuid; v_q numeric; v_stock uuid; v_location uuid;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','stock_entry']) OR NOT (public.has_perm(auth.uid(),'stock.transfer') OR public.has_perm(auth.uid(),'stock.transfer_finished')) THEN RAISE EXCEPTION 'Authorized stock transfer required'; END IF;
 IF NOT public.has_role(auth.uid(),'owner') AND (
 NOT EXISTS(SELECT 1 FROM public.locations WHERE id=p_source AND active AND kind='workshop') OR
 NOT EXISTS(SELECT 1 FROM public.locations WHERE id=p_destination AND active AND kind='showroom_sublocation') OR
 jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x LEFT JOIN public.inventory_items authority ON authority.id=(x->>'inventory_item_id')::uuid LEFT JOIN public.thaans t ON t.id=authority.thaan_id WHERE authority.id IS NULL OR NOT ((authority.unit='mm' AND t.status='active' AND public.has_perm(auth.uid(),'stock.transfer')) OR (authority.unit='pc' AND authority.finished_product_id IS NOT NULL AND public.has_perm(auth.uid(),'stock.transfer_finished'))))) THEN RAISE EXCEPTION 'Workshop fabric to active Showroom floor required'; END IF;
 IF p_request_id IS NULL OR p_source IS NULL OR p_destination IS NULL OR p_source=p_destination OR p_reason IS NULL OR btrim(p_reason)='' OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'Distinct locations, items, request ID and reason required'; END IF;
 v_payload:=jsonb_build_object('source',p_source,'destination',p_destination,'items',p_items,'reason',btrim(p_reason));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,3));
 SELECT * INTO v_existing FROM public.stock_transfers WHERE request_id=p_request_id;
 IF FOUND THEN
  IF v_existing.request_payload IS DISTINCT FROM v_payload OR v_existing.status<>'posted' OR (v_existing.created_by IS DISTINCT FROM auth.uid() AND NOT public.has_role(auth.uid(),'owner')) THEN RAISE EXCEPTION 'Transfer request ID already used with different data'; END IF;
  RETURN v_existing.id;
 END IF;
 IF (SELECT count(DISTINCT value->>'inventory_item_id') FROM jsonb_array_elements(p_items))<>jsonb_array_length(p_items) THEN RAISE EXCEPTION 'Duplicate/missing transfer item'; END IF;
 PERFORM 1 FROM public.inventory_items WHERE id IN (SELECT (value->>'inventory_item_id')::uuid FROM jsonb_array_elements(p_items)) ORDER BY id FOR UPDATE;
 FOR v_location IN SELECT id FROM public.locations WHERE id IN (p_source,p_destination) ORDER BY id FOR UPDATE LOOP
  IF NOT EXISTS(SELECT 1 FROM public.locations WHERE id=v_location AND active) THEN RAISE EXCEPTION 'Active transfer locations required'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM public.locations WHERE id IN (p_source,p_destination) AND active)<>2 THEN RAISE EXCEPTION 'Active transfer locations required'; END IF;
 INSERT INTO public.stock_transfers(code,source_location_id,destination_location_id,status,reason,created_by,request_id,request_payload)
 VALUES('TRF-'||p_request_id::text,p_source,p_destination,'draft',btrim(p_reason),auth.uid(),p_request_id,v_payload) RETURNING id INTO v_id;
 FOR r IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY value->>'inventory_item_id' LOOP
  SELECT * INTO i FROM public.inventory_items WHERE id=(r->>'inventory_item_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reconciled item required'; END IF;
  v_q:=(r->>'quantity')::numeric;
  IF v_q IS NULL OR v_q<=0 OR v_q<>round(v_q,3) THEN RAISE EXCEPTION 'Positive exact-unit transfer quantity required'; END IF;
  SELECT fabric_stock_id INTO v_stock FROM public.thaans WHERE id=i.thaan_id;
  INSERT INTO public.stock_transfer_lines(transfer_id,thaan_id,fabric_stock_id,material_id,finished_product_id,quantity,unit)
  VALUES(v_id,i.thaan_id,v_stock,i.material_id,i.finished_product_id,v_q,i.unit) RETURNING id INTO v_line;
  INSERT INTO public.inventory_movements(inventory_item_id,kind,thaan_id,fabric_stock_id,material_id,finished_product_id,quantity,unit,source_location_id,destination_location_id,stock_transfer_line_id,reference,reason,actor_id)
  VALUES(i.id,'TRANSFER',i.thaan_id,v_stock,i.material_id,i.finished_product_id,v_q,i.unit,p_source,p_destination,v_line,'TRF-'||p_request_id::text,btrim(p_reason),auth.uid());
  IF i.finished_product_id IS NOT NULL THEN UPDATE public.finished_products SET current_location_id=p_destination WHERE id=i.finished_product_id AND status='available'; IF NOT FOUND THEN RAISE EXCEPTION 'Finished Product not available'; END IF; END IF;
 END LOOP;
 UPDATE public.stock_transfers SET status='posted',posted_at=now() WHERE id=v_id;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference)
 VALUES(auth.uid(),'post_inventory_transfer','stock_transfers',v_id,v_payload,'TRF-'||p_request_id::text);
 RETURN v_id;
END; $$;
CREATE OR REPLACE FUNCTION public.guard_finished_product_transfer_path() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE source public.locations%rowtype; destination public.locations%rowtype; piece public.finished_products%rowtype;
BEGIN
 IF NEW.kind<>'TRANSFER' OR NEW.finished_product_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO source FROM public.locations WHERE id=NEW.source_location_id;
 SELECT * INTO destination FROM public.locations WHERE id=NEW.destination_location_id;
 IF NOT source.active OR NOT destination.active OR NOT (
  (source.kind='workshop' AND destination.kind='showroom') OR
  (source.kind='workshop' AND destination.kind='showroom_sublocation' AND EXISTS(SELECT 1 FROM public.locations parent WHERE parent.id=destination.parent_id AND parent.kind='showroom' AND parent.active)) OR
  (source.kind='showroom' AND destination.kind='workshop') OR
  (source.kind='showroom' AND destination.kind='showroom_sublocation' AND destination.parent_id=source.id) OR
  (source.kind='showroom_sublocation' AND destination.kind='showroom' AND source.parent_id=destination.id)
 ) THEN RAISE EXCEPTION 'Finished Product transfer must follow Workshop / Showroom / its Sublocation hierarchy'; END IF;
 SELECT * INTO piece FROM public.finished_products WHERE id=NEW.finished_product_id;
 IF piece.id IS NULL OR piece.status<>'available' OR piece.current_location_id IS DISTINCT FROM NEW.source_location_id OR NEW.quantity<>1 OR NEW.unit<>'pc' THEN RAISE EXCEPTION 'Available whole Finished Product at the selected source required'; END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION public.transfer_finished_products(p_request uuid,p_source uuid,p_destination uuid,p_pieces jsonb,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE saved public.finished_product_transfer_requests%rowtype; payload_value jsonb; items jsonb; result uuid;
BEGIN
 IF NOT (public.has_role(auth.uid(),'owner') OR (public.has_role(auth.uid(),'stock_entry') AND public.has_perm(auth.uid(),'stock.transfer_finished'))) THEN RAISE EXCEPTION 'Authorized finished-product transfer staff required'; END IF;
 IF p_request IS NULL OR p_source IS NULL OR p_destination IS NULL OR p_source=p_destination OR nullif(btrim(p_reason),'') IS NULL OR jsonb_typeof(p_pieces) IS DISTINCT FROM 'array' OR jsonb_array_length(p_pieces) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Request, distinct locations, 1–200 explicit pieces and reason required'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_pieces) v WHERE jsonb_typeof(v)<>'string') OR (SELECT count(DISTINCT value::uuid) FROM jsonb_array_elements_text(p_pieces))<>jsonb_array_length(p_pieces) THEN RAISE EXCEPTION 'Distinct Finished Product IDs required'; END IF;
 IF NOT public.has_role(auth.uid(),'owner') AND (NOT EXISTS(SELECT 1 FROM public.locations WHERE id=p_source AND active AND kind='workshop') OR NOT EXISTS(SELECT 1 FROM public.locations floor JOIN public.locations parent ON parent.id=floor.parent_id AND parent.active AND parent.kind='showroom' WHERE floor.id=p_destination AND floor.active AND floor.kind='showroom_sublocation')) THEN RAISE EXCEPTION 'Workshop to active Showroom floor required'; END IF;
 SELECT jsonb_build_object('actor',auth.uid(),'source',p_source,'destination',p_destination,'pieces',jsonb_agg(value::uuid ORDER BY value::uuid),'reason',btrim(p_reason)) INTO payload_value FROM jsonb_array_elements_text(p_pieces);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,3));
 SELECT * INTO saved FROM public.finished_product_transfer_requests WHERE request_id=p_request;
 IF FOUND THEN IF saved.payload IS DISTINCT FROM payload_value THEN RAISE EXCEPTION 'Finished Product transfer request already used with different data'; END IF; RETURN saved.transfer_id; END IF;
 IF EXISTS(SELECT 1 FROM public.stock_transfers WHERE request_id=p_request) THEN RAISE EXCEPTION 'Request already used by another transfer'; END IF;
 -- Same stable item lock order as the existing posting function; balances are
 -- checked under these locks and again by the canonical movement guard.
 PERFORM 1 FROM public.inventory_items WHERE finished_product_id IN(SELECT value::uuid FROM jsonb_array_elements_text(p_pieces)) ORDER BY id FOR UPDATE;
 SELECT jsonb_agg(jsonb_build_object('inventory_item_id',i.id,'quantity',1) ORDER BY i.id) INTO items FROM public.inventory_items i JOIN public.finished_products p ON p.id=i.finished_product_id WHERE p.id IN(SELECT value::uuid FROM jsonb_array_elements_text(p_pieces)) AND p.status='available' AND p.current_location_id=p_source AND i.unit='pc';
 IF coalesce(jsonb_array_length(items),0)<>jsonb_array_length(p_pieces) THEN RAISE EXCEPTION 'Every selected piece must be available at the selected source'; END IF;
 result:=public.post_inventory_transfer(p_request,p_source,p_destination,items,btrim(p_reason));
 INSERT INTO public.finished_product_transfer_requests(request_id,actor_id,transfer_id,payload) VALUES(p_request,auth.uid(),result,payload_value);
 RETURN result;
END; $$;
CREATE OR REPLACE FUNCTION public.finished_product_inventory(p_after uuid DEFAULT NULL,p_limit integer DEFAULT 100) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 IF NOT (public.has_role(auth.uid(),'owner') OR (public.has_role(auth.uid(),'stock_entry') AND public.has_perm(auth.uid(),'stock.transfer_finished'))) THEN RAISE EXCEPTION 'Authorized finished-product transfer staff required'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Limit must be 1–200'; END IF;
 SELECT coalesce(jsonb_agg(row_value ORDER BY id),'[]') INTO result FROM (
 SELECT p.id,jsonb_build_object('id',p.id,'barcode',b.code,'piece_number',p.piece_number,'product',product.name,'design',design.name,'job_id',j.id,'job_code',j.code,'status',p.status,'location_id',p.current_location_id,'location',location.name,'location_kind',location.kind,'location_active',location.active,'inventory_item_id',i.id,'quantity',coalesce(balance.quantity,0),'available',p.status='available' AND coalesce(balance.quantity,0)=1,'created_at',p.created_at) row_value
 FROM public.finished_products p JOIN public.barcodes b ON b.id=p.barcode_id JOIN public.products product ON product.id=p.product_id JOIN public.designs design ON design.id=p.design_id JOIN public.production_jobs j ON j.id=p.production_job_id JOIN public.locations location ON location.id=p.current_location_id LEFT JOIN public.inventory_items i ON i.finished_product_id=p.id LEFT JOIN public.v_inventory_location_balances balance ON balance.inventory_item_id=i.id AND balance.location_id=p.current_location_id
 WHERE p_after IS NULL OR p.id>p_after ORDER BY p.id LIMIT p_limit
 ) rows;
 RETURN result;
END; $$;
CREATE OR REPLACE FUNCTION public.finished_product_movement_history(p_piece uuid DEFAULT NULL,p_limit integer DEFAULT 100) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 IF NOT (public.has_role(auth.uid(),'owner') OR (public.has_role(auth.uid(),'stock_entry') AND public.has_perm(auth.uid(),'stock.transfer_finished'))) THEN RAISE EXCEPTION 'Authorized finished-product transfer staff required'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Limit must be 1–200'; END IF;
 SELECT coalesce(jsonb_agg(row_value ORDER BY occurred_at DESC,id DESC),'[]') INTO result FROM (
 SELECT m.id,m.occurred_at,jsonb_build_object('id',m.id,'piece_id',p.id,'barcode',b.code,'piece_number',p.piece_number,'product',product.name,'design',design.name,'job_code',j.code,'kind',m.kind,'quantity',m.quantity,'unit',m.unit,'source',source.name,'destination',destination.name,'actor_id',m.actor_id,'actor',actor.full_name,'occurred_at',m.occurred_at,'reason',m.reason,'reference',m.reference,'transfer_id',transfer.id,'transfer_code',transfer.code,'transfer_line_id',m.stock_transfer_line_id,'request_id',transfer.request_id) row_value
 FROM public.inventory_movements m JOIN public.finished_products p ON p.id=m.finished_product_id JOIN public.barcodes b ON b.id=p.barcode_id JOIN public.products product ON product.id=p.product_id JOIN public.designs design ON design.id=p.design_id JOIN public.production_jobs j ON j.id=p.production_job_id LEFT JOIN public.locations source ON source.id=m.source_location_id LEFT JOIN public.locations destination ON destination.id=m.destination_location_id LEFT JOIN public.profiles actor ON actor.id=m.actor_id LEFT JOIN public.stock_transfer_lines line ON line.id=m.stock_transfer_line_id LEFT JOIN public.stock_transfers transfer ON transfer.id=line.transfer_id
 WHERE p_piece IS NULL OR p.id=p_piece ORDER BY m.occurred_at DESC,m.id DESC LIMIT p_limit
 ) rows;
 RETURN result;
END; $$;
CREATE OR REPLACE FUNCTION public.finished_product_sale_scan(p_barcode text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE piece public.finished_products%rowtype; result jsonb; counts jsonb; price_id uuid;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) THEN RAISE EXCEPTION 'Owner or Counter required'; END IF;
 IF nullif(btrim(p_barcode),'') IS NULL THEN RAISE EXCEPTION 'Product Barcode required'; END IF;
 SELECT p.* INTO piece FROM public.finished_products p JOIN public.barcodes b ON b.id=p.barcode_id WHERE b.code=btrim(p_barcode) AND b.kind='product';
 IF piece.id IS NULL THEN RETURN NULL; END IF;
 result:=public.finished_product_catalog(btrim(p_barcode),NULL,1)->0;
 SELECT id INTO price_id FROM public.finished_product_prices WHERE finished_product_id=piece.id ORDER BY revision DESC LIMIT 1;
 SELECT coalesce(jsonb_agg(jsonb_build_object('location_id',id,'name',name,'kind',kind,'parent_id',parent_id,'active',active,'quantity',quantity) ORDER BY kind,id),'[]') INTO counts FROM (
 SELECT l.id,l.name,l.kind,l.parent_id,l.active,count(p.id) FILTER(WHERE p.status='available' AND public.inventory_balance(i.id,l.id)=1) quantity
 FROM public.locations l LEFT JOIN public.finished_products p ON p.current_location_id=l.id AND p.production_job_id=piece.production_job_id LEFT JOIN public.inventory_items i ON i.finished_product_id=p.id GROUP BY l.id
 ) x;
 SELECT jsonb_agg(c||jsonb_build_object('subtree_quantity',(c->>'quantity')::integer+(SELECT coalesce(sum((child->>'quantity')::integer),0) FROM jsonb_array_elements(counts) child WHERE child->>'parent_id'=c->>'location_id')) ORDER BY c->>'kind',c->>'location_id') INTO counts FROM jsonb_array_elements(counts) c;
 result:=result||jsonb_build_object('sp_version_id',price_id,'location_active',(SELECT active FROM public.locations WHERE id=piece.current_location_id),'identical_scope','production_job','identical_available',(SELECT coalesce(sum((value->>'quantity')::integer),0) FROM jsonb_array_elements(counts)),'locations',counts);
 IF public.has_role(auth.uid(),'owner') THEN
  result:=result||jsonb_build_object('production_summary',public.production_piece_summary(piece.production_job_id),'production_cost',public.owner_production_costs(piece.production_job_id));
 END IF;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.create_owner_production_shared(uuid,uuid,uuid,integer,jsonb,uuid,jsonb,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_owner_production_shared(uuid,uuid,uuid,integer,jsonb,uuid,jsonb,text,text) TO authenticated,service_role;
CREATE FUNCTION public.finished_product_transfer_scan(p_barcode text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 IF NOT (public.has_role(auth.uid(),'owner') OR (public.has_role(auth.uid(),'stock_entry') AND public.has_perm(auth.uid(),'stock.transfer_finished'))) THEN RAISE EXCEPTION 'Authorized finished-product transfer staff required'; END IF;
 IF nullif(btrim(p_barcode),'') IS NULL THEN RAISE EXCEPTION 'Product Barcode required'; END IF;
 SELECT coalesce(jsonb_agg(row_value ORDER BY id),'[]') INTO result FROM (
 SELECT p.id,jsonb_build_object('id',p.id,'barcode',b.code,'piece_number',p.piece_number,'product',product.name,'design',design.name,'job_id',j.id,'job_code',j.code,'status',p.status,'location_id',p.current_location_id,'location',location.name,'location_kind',location.kind,'location_active',location.active,'inventory_item_id',i.id,'quantity',coalesce(balance.quantity,0),'available',p.status='available' AND coalesce(balance.quantity,0)=1,'created_at',p.created_at) row_value
 FROM public.finished_products p JOIN public.barcodes b ON b.id=p.barcode_id JOIN public.products product ON product.id=p.product_id JOIN public.designs design ON design.id=p.design_id JOIN public.production_jobs j ON j.id=p.production_job_id JOIN public.locations location ON location.id=p.current_location_id LEFT JOIN public.inventory_items i ON i.finished_product_id=p.id LEFT JOIN public.v_inventory_location_balances balance ON balance.inventory_item_id=i.id AND balance.location_id=p.current_location_id
 WHERE b.code=btrim(p_barcode) ORDER BY p.id LIMIT 1
 ) rows;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.finished_product_transfer_scan(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.finished_product_transfer_scan(text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
