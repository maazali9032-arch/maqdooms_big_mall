BEGIN;
CREATE SEQUENCE public.finished_piece_barcode_number MINVALUE 1 MAXVALUE 9999999999 START 1 NO CYCLE;
REVOKE ALL ON SEQUENCE public.finished_piece_barcode_number FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.new_finished_piece_barcode() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE code_value text; result uuid;
BEGIN
 LOOP
  code_value:='80'||lpad(nextval('public.finished_piece_barcode_number')::text,10,'0');
  IF EXISTS(SELECT 1 FROM public.stock_registration_variants WHERE code=code_value) OR EXISTS(SELECT 1 FROM public.thaans WHERE barcode=code_value) OR EXISTS(SELECT 1 FROM public.production_jobs WHERE code=code_value) OR EXISTS(SELECT 1 FROM public.orders WHERE code=code_value) THEN CONTINUE; END IF;
  INSERT INTO public.barcodes(code,kind,created_by) VALUES(code_value,'product',auth.uid()) ON CONFLICT(code) DO NOTHING RETURNING id INTO result;
  IF result IS NOT NULL THEN RETURN result; END IF;
 END LOOP;
END; $$;
REVOKE ALL ON FUNCTION public.new_finished_piece_barcode() FROM PUBLIC,anon,authenticated;
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
  barcode:=public.new_finished_piece_barcode();
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
CREATE OR REPLACE FUNCTION public.receive_finished_products(p_request uuid,p_job uuid,p_pieces jsonb,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE payload_value jsonb; saved public.finished_product_receipts%rowtype; job public.production_jobs%rowtype;
 workshop uuid; piece jsonb; allocation jsonb; result uuid; barcode uuid; inv uuid; line public.material_issue_lines%rowtype; amount numeric; n integer;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 IF p_request IS NULL OR p_job IS NULL OR nullif(btrim(p_reason),'') IS NULL OR jsonb_typeof(p_pieces) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Job, explicit pieces/material usage, request and reason required'; END IF;
 payload_value:=jsonb_build_object('actor',auth.uid(),'job',p_job,'pieces',p_pieces,'reason',btrim(p_reason));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,11));
 SELECT * INTO saved FROM public.finished_product_receipts WHERE request_id=p_request;
 IF FOUND THEN
  IF saved.payload IS DISTINCT FROM payload_value THEN RAISE EXCEPTION 'Receipt request already used with different data'; END IF;
  RETURN saved.production_job_id;
 END IF;
 SELECT * INTO job FROM public.production_jobs WHERE id=p_job FOR UPDATE;
 IF job.id IS NULL OR job.status<>'completed' THEN RAISE EXCEPTION 'Completed Production Job required'; END IF;
 IF EXISTS(SELECT 1 FROM public.finished_products WHERE production_job_id=p_job) OR EXISTS(SELECT 1 FROM public.finished_product_receipts WHERE production_job_id=p_job) THEN RAISE EXCEPTION 'Job already has Finished Products; never recreate/overwrite pieces'; END IF;
 IF jsonb_array_length(p_pieces)<>job.quantity THEN RAISE EXCEPTION 'Confirm every piece of this job exactly once'; END IF;
 SELECT id INTO workshop FROM public.locations WHERE kind='workshop' AND active FOR UPDATE;
 IF workshop IS NULL THEN RAISE EXCEPTION 'Active Workshop required'; END IF;
 IF (SELECT count(DISTINCT (value->>'piece_number')::integer) FROM jsonb_array_elements(p_pieces))<>job.quantity THEN RAISE EXCEPTION 'Unique whole piece numbers required'; END IF;
 -- Stable issued-line locks also serialize aggregate material allocation guards.
 PERFORM 1 FROM public.material_issue_lines l JOIN public.material_issues i ON i.id=l.material_issue_id WHERE i.production_job_id=p_job ORDER BY l.id FOR UPDATE OF l;
 INSERT INTO public.finished_product_receipts(request_id,production_job_id,actor_id,workshop_id,payload,reason) VALUES(p_request,p_job,auth.uid(),workshop,payload_value,btrim(p_reason));
 FOR piece IN SELECT value FROM jsonb_array_elements(p_pieces) ORDER BY (value->>'piece_number')::integer LOOP
  n:=(piece->>'piece_number')::integer;
  IF n IS NULL OR n NOT BETWEEN 1 AND job.quantity OR jsonb_typeof(piece->'materials') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Piece number and explicit material usage required'; END IF;
  IF jsonb_array_length(piece->'materials') NOT BETWEEN 1 AND 100 OR
   (SELECT count(DISTINCT value->>'issue_line_id') FROM jsonb_array_elements(piece->'materials'))<>jsonb_array_length(piece->'materials') THEN RAISE EXCEPTION 'One to 100 distinct issued-material allocations per piece required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(piece->'materials') a JOIN public.material_issue_lines l ON l.id=(a->>'issue_line_id')::uuid JOIN public.material_issues i ON i.id=l.material_issue_id WHERE i.production_job_id=p_job AND l.fabric_stock_id IS NOT NULL) THEN RAISE EXCEPTION 'Actual fabric usage per physical piece required'; END IF;
  barcode:=public.new_finished_piece_barcode();
  INSERT INTO public.finished_products(production_job_id,product_id,design_id,piece_number,barcode_id,current_location_id,status)
  VALUES(p_job,job.product_id,job.design_id,n,barcode,workshop,'available') RETURNING id INTO result;
  INSERT INTO public.finished_product_receipt_pieces VALUES(result,p_request);
  FOR allocation IN SELECT value FROM jsonb_array_elements(piece->'materials') LOOP
   SELECT l.* INTO line FROM public.material_issue_lines l JOIN public.material_issues i ON i.id=l.material_issue_id
    WHERE l.id=(allocation->>'issue_line_id')::uuid AND i.production_job_id=p_job;
   amount:=(allocation->>'quantity')::numeric;
   IF line.id IS NULL OR amount IS NULL OR amount<=0 OR amount>=1000000000000000 OR amount<>round(amount,3) OR (line.unit='mm' AND amount<>trunc(amount))
    OR NOT EXISTS(SELECT 1 FROM public.inventory_movements WHERE material_issue_line_id=line.id AND kind='MATERIAL_ISSUE') THEN RAISE EXCEPTION 'Exact positive usage from actually issued job material required'; END IF;
   INSERT INTO public.finished_product_materials(finished_product_id,production_job_id,material_issue_line_id,quantity,unit) VALUES(result,p_job,line.id,amount,line.unit);
  END LOOP;
  -- New manufactured item begins at zero; the actual production receipt is the stock authority.
  INSERT INTO public.inventory_items(finished_product_id,unit,legacy_quantity_snapshot,reconciled_by,reason) VALUES(result,'pc',0,auth.uid(),btrim(p_reason)) RETURNING id INTO inv;
  INSERT INTO public.inventory_movements(kind,inventory_item_id,finished_product_id,quantity,unit,destination_location_id,production_job_id,actor_id,reason,reference)
  VALUES('PRODUCTION',inv,result,1,'pc',workshop,p_job,auth.uid(),btrim(p_reason),'PRODUCTION:'||p_request::text);
 END LOOP;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference)
 VALUES(auth.uid(),'receive_finished_products','production_jobs',p_job,payload_value,'PRODUCTION:'||p_request::text);
 RETURN p_job;
END; $$;
CREATE OR REPLACE FUNCTION public.guard_phase10_production() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Production history is retained'; END IF;
 IF TG_TABLE_NAME IN('products','designs') THEN
  IF NEW.code IS DISTINCT FROM OLD.code THEN RAISE EXCEPTION 'Catalogue code is permanent'; END IF;
 ELSE
  IF (NEW.code,NEW.product_id,NEW.design_id,NEW.quantity,NEW.tailor_assignment_id,NEW.design_charge_version_id,NEW.notes,NEW.created_by,NEW.created_at)
   IS DISTINCT FROM (OLD.code,OLD.product_id,OLD.design_id,OLD.quantity,OLD.tailor_assignment_id,OLD.design_charge_version_id,OLD.notes,OLD.created_by,OLD.created_at)
  THEN RAISE EXCEPTION 'Issued Production Job identity, quantity, assignment and snapshots are permanent'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
   IF NOT ((OLD.status='open' AND NEW.status='in_progress') OR (OLD.status='in_progress' AND NEW.status='completed') OR (OLD.status='open' AND NEW.status='completed' AND public.has_perm(auth.uid(),'production.receive') AND EXISTS(SELECT 1 FROM public.production_requests r WHERE r.result_id=OLD.id AND r.payload->>'actor'=auth.uid()::text AND r.payload->>'action'='scan_workshop_receipt')))
   THEN RAISE EXCEPTION 'Production must progress open to in_progress to completed'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.job_material_requirements r JOIN public.inventory_movements m ON m.material_issue_line_id=r.material_issue_line_id
    WHERE r.production_job_id=OLD.id AND r.fabric_stock_id IS NOT NULL AND m.kind='MATERIAL_ISSUE')
   THEN RAISE EXCEPTION 'Actual required fabric issue is required before production'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE FUNCTION public.receive_production_barcode(p_request uuid,p_code text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE job public.production_jobs%rowtype; saved public.production_requests%rowtype; payload_value jsonb; reason_value text:='Whole production batch received at Workshop by Production ID scan';
BEGIN
 IF NOT public.has_perm(auth.uid(),'production.receive') THEN RAISE EXCEPTION 'Production receipt permission required'; END IF;
 IF p_request IS NULL OR nullif(btrim(p_code),'') IS NULL THEN RAISE EXCEPTION 'Request and exact Production ID required'; END IF;
 payload_value:=jsonb_build_object('actor',auth.uid(),'code',btrim(p_code),'action','scan_workshop_receipt');
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,10));
 SELECT * INTO saved FROM public.production_requests WHERE request_id=p_request;
 IF FOUND THEN IF saved.payload IS DISTINCT FROM payload_value THEN RAISE EXCEPTION 'Receipt retry requires the same barcode and user'; END IF;RETURN saved.result_id; END IF;
 IF (SELECT count(*) FROM public.production_jobs WHERE code=btrim(p_code) OR id::text=btrim(p_code))>1 THEN RAISE EXCEPTION 'Ambiguous Production ID; contact Owner'; END IF;
 SELECT * INTO job FROM public.production_jobs WHERE code=btrim(p_code) OR id::text=btrim(p_code) FOR UPDATE;
 IF job.id IS NULL THEN RAISE EXCEPTION 'No production matches this ID'; END IF;
 IF job.status NOT IN('open','in_progress','completed') THEN RAISE EXCEPTION 'Only active or completed production can be received'; END IF;
 IF EXISTS(SELECT 1 FROM public.finished_product_receipts WHERE production_job_id=job.id) THEN
  IF (SELECT count(*) FROM public.finished_products WHERE production_job_id=job.id)<>job.quantity THEN RAISE EXCEPTION 'Recorded receipt is incomplete; Owner reconciliation required'; END IF;
  RETURN job.id;
 END IF;
 INSERT INTO public.production_requests VALUES(p_request,auth.uid(),payload_value,job.id,now());
 IF job.status<>'completed' THEN
  UPDATE public.production_jobs SET status='completed' WHERE id=job.id;
  INSERT INTO public.production_status_events(job_id,request_id,previous_status,status,actor_id,reason) VALUES(job.id,p_request,job.status,'completed',auth.uid(),reason_value);
  INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,previous_value,new_value,reference) VALUES(auth.uid(),'complete_production_at_receipt','production_jobs',job.id,jsonb_build_object('status',job.status),jsonb_build_object('status','completed'),'PRODUCTION:'||p_request::text);
 END IF;
 PERFORM public.complete_production_batch(p_request,job.id,'completed',reason_value);
 RETURN job.id;
END; $$;
REVOKE ALL ON FUNCTION public.receive_production_barcode(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.receive_production_barcode(uuid,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
