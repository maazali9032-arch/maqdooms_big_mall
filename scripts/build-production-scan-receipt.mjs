import assert from 'node:assert/strict';
import {functionSQL,mirrorMigration} from './workflow-sql.mjs';
const source='supabase/migrations/20261015000500_mixed_production.sql';
let batch=await functionSQL(source,'complete_production_batch');
const old="INSERT INTO public.barcodes(code,kind,created_by) VALUES('PRD-'||replace(gen_random_uuid()::text,'-',''),'product',auth.uid()) RETURNING id INTO barcode;";
assert(batch.includes(old));batch=batch.replace(old,'barcode:=public.new_finished_piece_barcode();');
let legacy=await functionSQL('supabase/migrations/20261004000200_phase11_finished_products.sql','receive_finished_products');
assert(legacy.includes(old));legacy=legacy.replace(old,'barcode:=public.new_finished_piece_barcode();');
let guard=await functionSQL('supabase/migrations/20261004000100_phase10_owner_production.sql','guard_phase10_production');
const transition="(OLD.status='in_progress' AND NEW.status='completed'))";
assert(guard.includes(transition));guard=guard.replace(transition,"(OLD.status='in_progress' AND NEW.status='completed') OR (OLD.status='open' AND NEW.status='completed' AND public.has_perm(auth.uid(),'production.receive') AND EXISTS(SELECT 1 FROM public.production_requests r WHERE r.result_id=OLD.id AND r.payload->>'actor'=auth.uid()::text AND r.payload->>'action'='scan_workshop_receipt')))" );
const sql=`BEGIN;
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
${batch}
${legacy}
${guard}
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
`;
await mirrorMigration('20261015001300','0055','production_scan_receipt',sql);
