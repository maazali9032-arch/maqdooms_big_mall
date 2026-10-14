-- Production issuance, fixed issue-time CP, size/custom design, Workshop receipt/SP.
-- These are prospective records. No historical CP, size or consumption is inferred.
CREATE TABLE public.production_issue_fabric_costs (
 issue_line_id uuid PRIMARY KEY REFERENCES public.material_issue_lines(id),
 fabric_cost_id uuid NOT NULL REFERENCES public.fabric_stock_costs(id),
 cp_paise_per_m bigint NOT NULL CHECK(cp_paise_per_m>0),
 amount_paise bigint NOT NULL CHECK(amount_paise BETWEEN 0 AND 9007199254740991),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.production_issue_fabric_costs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.production_issue_fabric_costs FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.production_issue_fabric_costs TO authenticated;
GRANT ALL ON public.production_issue_fabric_costs TO service_role;
CREATE POLICY production_issue_cost_read ON public.production_issue_fabric_costs FOR SELECT TO authenticated USING(public.has_perm(auth.uid(),'inventory.view_registered_cp'));
CREATE TRIGGER production_issue_cost_immutable BEFORE UPDATE OR DELETE ON public.production_issue_fabric_costs FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();

CREATE TABLE public.production_batch_requests (
 request_id uuid PRIMARY KEY REFERENCES public.production_requests(request_id),
 production_job_id uuid NOT NULL UNIQUE REFERENCES public.production_jobs(id),
 actor_id uuid NOT NULL REFERENCES public.profiles(id),payload jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.production_batch_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.production_batch_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.production_batch_requests TO authenticated;
GRANT ALL ON public.production_batch_requests TO service_role;
CREATE POLICY production_batch_request_read ON public.production_batch_requests FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'owner'));
CREATE TRIGGER production_batch_request_immutable BEFORE UPDATE OR DELETE ON public.production_batch_requests FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();

CREATE FUNCTION public.capture_production_fabric_cost(p_line uuid,p_stock uuid,p_quantity numeric) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cost public.fabric_stock_costs%rowtype; amount numeric;
BEGIN
 PERFORM 1 FROM public.fabric_stock WHERE id=p_stock FOR UPDATE;
 SELECT * INTO cost FROM public.fabric_stock_costs WHERE fabric_stock_id=p_stock ORDER BY revision DESC LIMIT 1;
 IF cost.id IS NULL OR cost.cp_paise_per_m<=0 THEN RAISE EXCEPTION 'Record positive Thaan CP before issuing production fabric'; END IF;
 amount:=round(p_quantity*cost.cp_paise_per_m/1000);
 IF amount NOT BETWEEN 0 AND 9007199254740991 THEN RAISE EXCEPTION 'Issued fabric cost exceeds supported money range'; END IF;
 INSERT INTO public.production_issue_fabric_costs VALUES(p_line,cost.id,cost.cp_paise_per_m,amount,clock_timestamp());
END; $$;
REVOKE ALL ON FUNCTION public.capture_production_fabric_cost(uuid,uuid,numeric) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.guard_production_descriptor() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_TABLE_NAME='finished_products' THEN
  IF NOT EXISTS(SELECT 1 FROM public.production_jobs WHERE id=NEW.production_job_id AND product_id=NEW.product_id AND design_id IS NOT DISTINCT FROM NEW.design_id) THEN RAISE EXCEPTION 'Piece product/design must match production'; END IF;
 ELSE
  IF (NEW.size,NEW.custom_design) IS DISTINCT FROM(OLD.size,OLD.custom_design) AND NOT(OLD.size IS NULL AND OLD.custom_design IS NULL AND OLD.status='open' AND OLD.created_by=auth.uid() AND NOT EXISTS(SELECT 1 FROM public.production_batch_requests WHERE production_job_id=OLD.id)) THEN RAISE EXCEPTION 'Issued production size and custom design are permanent'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER production_descriptor_immutable BEFORE UPDATE ON public.production_jobs FOR EACH ROW EXECUTE FUNCTION public.guard_production_descriptor();
CREATE TRIGGER production_piece_descriptor BEFORE INSERT ON public.finished_products FOR EACH ROW EXECUTE FUNCTION public.guard_production_descriptor();
CREATE FUNCTION public.check_production_design() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE job public.production_jobs%rowtype;
BEGIN
 SELECT * INTO job FROM public.production_jobs WHERE id=NEW.id;
 IF TG_OP='INSERT' AND nullif(btrim(job.size),'') IS NULL THEN RAISE EXCEPTION 'Production size required'; END IF;
 IF (job.design_id IS NULL AND nullif(btrim(job.custom_design),'') IS NULL) OR (job.design_id IS NOT NULL AND job.custom_design IS NOT NULL) THEN RAISE EXCEPTION 'Select a predefined design or enter a custom design'; END IF;
 RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER production_design_complete AFTER INSERT OR UPDATE ON public.production_jobs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_production_design();
REVOKE ALL ON FUNCTION public.guard_production_descriptor(),public.check_production_design() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.create_production_batch(p_request uuid,p_product uuid,p_design uuid,p_custom_design text,p_size text,p_quantity integer,p_assignments jsonb,p_source uuid,p_items jsonb,p_notes text,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE payload_value jsonb; saved public.production_batch_requests%rowtype; result uuid;
BEGIN
 IF NOT public.has_perm(auth.uid(),'production.create') THEN RAISE EXCEPTION 'Production creation permission required'; END IF;
 p_custom_design:=nullif(btrim(p_custom_design),'');p_size:=nullif(btrim(p_size),'');
 IF p_size IS NULL OR length(p_size)>40 OR (p_design IS NULL)=(p_custom_design IS NULL) OR length(p_custom_design)>120 THEN RAISE EXCEPTION 'Size and either predefined or custom design required'; END IF;
 payload_value:=jsonb_build_object('actor',auth.uid(),'product',p_product,'design',p_design,'custom_design',p_custom_design,'size',p_size,'quantity',p_quantity,'assignments',p_assignments,'source',p_source,'items',p_items,'notes',p_notes,'reason',p_reason);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,10));
 SELECT * INTO saved FROM public.production_batch_requests WHERE request_id=p_request;
 IF FOUND THEN IF saved.payload IS DISTINCT FROM payload_value THEN RAISE EXCEPTION 'Production request reused with different details'; END IF;RETURN saved.production_job_id; END IF;
 IF EXISTS(SELECT 1 FROM public.production_requests WHERE request_id=p_request) THEN RAISE EXCEPTION 'Request belongs to another production workflow'; END IF;
 result:=public.create_owner_production_shared(p_request,p_product,p_design,p_quantity,p_assignments,p_source,p_items,p_notes,p_reason);
 UPDATE public.production_jobs SET size=p_size,custom_design=p_custom_design WHERE id=result;
 INSERT INTO public.production_batch_requests VALUES(p_request,result,auth.uid(),payload_value,clock_timestamp());
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.create_production_batch(uuid,uuid,uuid,text,text,integer,jsonb,uuid,jsonb,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_production_batch(uuid,uuid,uuid,text,text,integer,jsonb,uuid,jsonb,text,text) TO authenticated;

CREATE FUNCTION public.production_job_document(p_code text) RETURNS jsonb
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
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.production_job_document(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.production_job_document(text) TO authenticated;

CREATE FUNCTION public.issue_additional_production_fabric(p_request uuid,p_code text,p_barcode text,p_source uuid,p_quantity_mm integer,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE job uuid; item uuid;
BEGIN
 IF NOT(public.has_role(auth.uid(),'owner') OR (public.has_role(auth.uid(),'counter') AND public.has_perm(auth.uid(),'pos.issue_to_tailoring'))) THEN RAISE EXCEPTION 'Counter production issue permission required'; END IF;
 SELECT id INTO job FROM public.production_jobs WHERE code=btrim(p_code) OR id::text=btrim(p_code);
 SELECT i.id INTO item FROM public.thaans t JOIN public.inventory_items i ON i.thaan_id=t.id JOIN public.fabric_stock s ON s.id=t.fabric_stock_id JOIN public.barcodes b ON b.id=s.barcode_id LEFT JOIN public.stock_registration_variants v ON v.thaan_id=t.id WHERE t.status='active' AND btrim(p_barcode) IN(v.code,t.barcode,b.code);
 IF (SELECT count(*) FROM public.thaans t JOIN public.fabric_stock s ON s.id=t.fabric_stock_id JOIN public.barcodes b ON b.id=s.barcode_id LEFT JOIN public.stock_registration_variants v ON v.thaan_id=t.id WHERE t.status='active' AND btrim(p_barcode) IN(v.code,t.barcode,b.code))<>1 THEN RAISE EXCEPTION 'Scan a unique physical Thaan barcode'; END IF;
 IF job IS NULL OR item IS NULL OR p_quantity_mm IS NULL OR p_quantity_mm<=0 THEN RAISE EXCEPTION 'Production ID, active Thaan barcode and positive metres required'; END IF;
 RETURN public.post_material_issue(p_request,'production',job,p_source,'additional',jsonb_build_array(jsonb_build_object('inventory_item_id',item,'quantity',p_quantity_mm)),p_reason);
END; $$;
REVOKE ALL ON FUNCTION public.issue_additional_production_fabric(uuid,text,text,uuid,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_additional_production_fabric(uuid,text,text,uuid,integer,text) TO authenticated;

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
  INSERT INTO public.finished_products(production_job_id,product_id,design_id,piece_number,barcode_id,current_location_id,status) VALUES(p_job,job.product_id,job.design_id,n,barcode,workshop,'available') RETURNING id INTO piece;
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

CREATE FUNCTION public.set_workshop_product_sp(p_request uuid,p_job uuid,p_updates jsonb,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE saved public.production_cost_requests%rowtype; payload_value jsonb; version uuid; row_value jsonb; piece public.finished_products%rowtype; price uuid; amount bigint;
BEGIN
 IF NOT public.has_perm(auth.uid(),'stock.price_finished') THEN RAISE EXCEPTION 'Workshop finished-product price permission required'; END IF;
 IF p_request IS NULL OR p_job IS NULL OR nullif(btrim(p_reason),'') IS NULL OR jsonb_typeof(p_updates) IS DISTINCT FROM 'array' OR jsonb_array_length(p_updates) NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION 'Production job, explicit prices and confirmation required'; END IF;
 payload_value:=jsonb_build_object('actor',auth.uid(),'job',p_job,'updates',p_updates,'reason',btrim(p_reason));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,12));
 SELECT * INTO saved FROM public.production_cost_requests WHERE request_id=p_request;
 IF FOUND THEN IF saved.payload IS DISTINCT FROM payload_value THEN RAISE EXCEPTION 'Price request reused with different values'; END IF;RETURN saved.result_id; END IF;
 PERFORM 1 FROM public.production_jobs WHERE id=p_job FOR UPDATE;
 SELECT id INTO version FROM public.production_cost_versions WHERE production_job_id=p_job ORDER BY revision DESC LIMIT 1;
 IF version IS NULL OR NOT EXISTS(SELECT 1 FROM public.production_cost_requests WHERE result_id=version AND payload ? 'materials') THEN RAISE EXCEPTION 'Recorded production CP required'; END IF;
 IF (SELECT count(DISTINCT value->>'piece_id') FROM jsonb_array_elements(p_updates))<>jsonb_array_length(p_updates) THEN RAISE EXCEPTION 'Distinct pieces required'; END IF;
 FOR row_value IN SELECT value FROM jsonb_array_elements(p_updates) ORDER BY value->>'piece_id' LOOP
  IF jsonb_typeof(row_value)<>'object' OR (row_value-ARRAY['piece_id','sp_paise'])<>'{}'::jsonb THEN RAISE EXCEPTION 'Only piece ID and SP accepted'; END IF;
  SELECT * INTO piece FROM public.finished_products WHERE id=(row_value->>'piece_id')::uuid AND production_job_id=p_job AND status='available' FOR UPDATE;
  amount:=(row_value->>'sp_paise')::bigint;
  IF piece.id IS NULL OR amount IS NULL OR amount NOT BETWEEN 0 AND 9007199254740991 OR NOT EXISTS(SELECT 1 FROM public.locations WHERE id=piece.current_location_id AND active AND kind='workshop') OR NOT EXISTS(SELECT 1 FROM public.finished_product_cost_allocations WHERE finished_product_id=piece.id AND cost_version_id=version) THEN RAISE EXCEPTION 'Available Workshop piece and recorded CP required'; END IF;
  INSERT INTO public.finished_product_prices(finished_product_id,revision,sp_paise,recorded_by) SELECT piece.id,coalesce(max(revision),0)+1,amount,auth.uid() FROM public.finished_product_prices WHERE finished_product_id=piece.id RETURNING id INTO price;
  INSERT INTO public.finished_product_price_reviews VALUES(price,version,p_request,btrim(p_reason));
 END LOOP;
 INSERT INTO public.production_cost_requests VALUES(p_request,auth.uid(),p_job,payload_value,p_job,now());
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference) VALUES(auth.uid(),'set_workshop_product_sp','production_jobs',p_job,payload_value,'PRICE:'||p_request::text);
 RETURN p_job;
END; $$;
REVOKE ALL ON FUNCTION public.set_workshop_product_sp(uuid,uuid,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_workshop_product_sp(uuid,uuid,jsonb,text) TO authenticated;

CREATE FUNCTION public.production_piece_context(p_piece uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('size',j.size,'design',coalesce(d.name,j.custom_design),'design_code',d.code,'production_job_id',j.id,'production_quantity',j.quantity,
 'issued_at',(SELECT min(issued_at) FROM public.material_issues WHERE production_job_id=j.id),
 'finished_at',(SELECT max(recorded_at) FROM public.production_status_events WHERE job_id=j.id AND status='completed'),
 'received_at',(SELECT recorded_at FROM public.finished_product_receipts WHERE production_job_id=j.id),
 'sp_paise',(SELECT sp_paise FROM public.finished_product_prices WHERE finished_product_id=p.id ORDER BY revision DESC LIMIT 1),
 'cp_visible',public.can_view_thaan_cp(NULL),'cp_paise',CASE WHEN public.can_view_thaan_cp(NULL) THEN (SELECT a.amount_paise FROM public.finished_product_cost_allocations a JOIN public.production_cost_versions v ON v.id=a.cost_version_id WHERE a.finished_product_id=p.id ORDER BY v.revision DESC LIMIT 1) END)
 FROM public.finished_products p JOIN public.production_jobs j ON j.id=p.production_job_id LEFT JOIN public.designs d ON d.id=j.design_id WHERE p.id=p_piece;
$$;
REVOKE ALL ON FUNCTION public.production_piece_context(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.workshop_production_pieces(p_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT(public.has_perm(auth.uid(),'production.receive') OR public.has_perm(auth.uid(),'stock.price_finished')) THEN RAISE EXCEPTION 'Workshop production access required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'job_id',p.production_job_id,'barcode',b.code,'product',product.name,'piece_number',p.piece_number,'status',p.status,'location_kind',loc.kind)||public.production_piece_context(p.id) ORDER BY p.piece_number) FROM public.finished_products p JOIN public.barcodes b ON b.id=p.barcode_id JOIN public.products product ON product.id=p.product_id JOIN public.locations loc ON loc.id=p.current_location_id WHERE p.production_job_id=p_job),'[]'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.workshop_production_pieces(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.workshop_production_pieces(uuid) TO authenticated;

CREATE FUNCTION public.guard_finished_workshop_price() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.kind='TRANSFER' AND NEW.finished_product_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.locations WHERE id=NEW.source_location_id AND kind='workshop') AND public.is_showroom_location(NEW.destination_location_id) AND NOT EXISTS(SELECT 1 FROM public.finished_product_prices price JOIN public.finished_product_price_reviews review ON review.price_id=price.id WHERE price.finished_product_id=NEW.finished_product_id) THEN RAISE EXCEPTION 'Set finished-product SP in Workshop before transfer to Showroom'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER finished_workshop_price_guard BEFORE INSERT ON public.inventory_movements FOR EACH ROW EXECUTE FUNCTION public.guard_finished_workshop_price();
REVOKE ALL ON FUNCTION public.guard_finished_workshop_price() FROM PUBLIC,anon,authenticated;
