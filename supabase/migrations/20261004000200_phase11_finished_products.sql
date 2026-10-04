-- Phase 11 only: explicit per-piece genealogy and actual completed-job Workshop receipt.
-- No existing rows/backfill; no costing, prices or Finished Product transfer/sale workflow.
BEGIN;
CREATE TABLE public.finished_product_receipts (
 request_id uuid PRIMARY KEY, production_job_id uuid NOT NULL UNIQUE REFERENCES public.production_jobs(id),
 actor_id uuid NOT NULL REFERENCES public.profiles(id), workshop_id uuid NOT NULL REFERENCES public.locations(id),
 payload jsonb NOT NULL, reason text NOT NULL CHECK(btrim(reason)<>''), recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.finished_product_receipt_pieces (
 finished_product_id uuid PRIMARY KEY REFERENCES public.finished_products(id),
 request_id uuid NOT NULL REFERENCES public.finished_product_receipts(request_id)
);
CREATE INDEX phase11_receipt_actor_time_idx ON public.finished_product_receipts(actor_id,recorded_at);
CREATE INDEX phase11_receipt_pieces_request_idx ON public.finished_product_receipt_pieces(request_id);
CREATE UNIQUE INDEX phase11_piece_production_event_idx ON public.inventory_movements(finished_product_id) WHERE kind='PRODUCTION';
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['finished_product_receipts','finished_product_receipt_pieces'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
  EXECUTE format('CREATE POLICY phase11_owner_read ON public.%I FOR SELECT TO authenticated USING(public.has_role(auth.uid(),''owner''))',t);
  EXECUTE format('CREATE TRIGGER phase11_history_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite()',t);
 END LOOP;
END; $$;

CREATE FUNCTION public.guard_phase11_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF TG_TABLE_NAME='barcodes' THEN
  IF OLD.kind='product' THEN
   IF TG_OP='DELETE' OR NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Product Barcode identity/history is permanent'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='finished_products' THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Finished Product history is permanent'; END IF;
  IF (NEW.production_job_id,NEW.product_id,NEW.design_id,NEW.piece_number,NEW.barcode_id,NEW.barcode_kind,NEW.created_at)
   IS DISTINCT FROM (OLD.production_job_id,OLD.product_id,OLD.design_id,OLD.piece_number,OLD.barcode_id,OLD.barcode_kind,OLD.created_at)
  THEN RAISE EXCEPTION 'Finished Product identity and genealogy are permanent'; END IF;
 ELSE
  IF NEW.kind='PRODUCTION' THEN
   IF NEW.finished_product_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.finished_product_receipt_pieces p
    JOIN public.finished_product_receipts r ON r.request_id=p.request_id JOIN public.finished_products f ON f.id=p.finished_product_id
    JOIN public.production_jobs j ON j.id=r.production_job_id WHERE f.id=NEW.finished_product_id AND j.status='completed'
    AND f.production_job_id=r.production_job_id AND NEW.production_job_id=r.production_job_id AND NEW.actor_id=r.actor_id
    AND NEW.destination_location_id=r.workshop_id AND NEW.source_location_id IS NULL AND NEW.quantity=1 AND NEW.unit='pc'
    AND NEW.reference='PRODUCTION:'||r.request_id::text)
   THEN RAISE EXCEPTION 'Production movement must match the completed-job Workshop receipt'; END IF;
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER phase11_barcode_history BEFORE UPDATE OR DELETE ON public.barcodes FOR EACH ROW EXECUTE FUNCTION public.guard_phase11_identity();
CREATE TRIGGER phase11_piece_history BEFORE UPDATE OR DELETE ON public.finished_products FOR EACH ROW EXECUTE FUNCTION public.guard_phase11_identity();
CREATE TRIGGER phase11_production_receipt_guard BEFORE INSERT ON public.inventory_movements FOR EACH ROW EXECUTE FUNCTION public.guard_phase11_identity();

CREATE FUNCTION public.receive_finished_products(p_request uuid,p_job uuid,p_pieces jsonb,p_reason text) RETURNS uuid
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
  INSERT INTO public.barcodes(code,kind,created_by) VALUES('PRD-'||replace(gen_random_uuid()::text,'-',''),'product',auth.uid()) RETURNING id INTO barcode;
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

CREATE FUNCTION public.finished_product_catalog(p_barcode text DEFAULT NULL,p_job uuid DEFAULT NULL,p_limit integer DEFAULT 100) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE owner boolean:=public.has_role(auth.uid(),'owner'); counter boolean:=public.has_role(auth.uid(),'counter');
BEGIN
 IF NOT (owner OR counter OR public.has_role(auth.uid(),'tailor')) THEN RAISE EXCEPTION 'Owner, Counter or assigned Tailor required'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Limit must be 1 to 100'; END IF;
 RETURN coalesce((SELECT jsonb_agg(row_value ORDER BY (row_value->>'piece_number')::integer,row_value->>'id') FROM (
 SELECT jsonb_build_object('id',f.id,'barcode',b.code,'piece_number',f.piece_number,'product',p.name,'product_id',p.id,'design',d.name,'design_id',d.id,
 'production_job_id',j.id,'production_job',j.code,'job_quantity',j.quantity,'job_status',j.status,'status',f.status,'created_at',f.created_at,
 'factory',factory.name,'section',s.name,'tailor',t.real_name,'assignment_id',j.tailor_assignment_id,
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
 'pricing_status','Phase 12 pending') row_value
 FROM public.finished_products f JOIN public.barcodes b ON b.id=f.barcode_id AND b.kind='product'
 JOIN public.production_jobs j ON j.id=f.production_job_id JOIN public.products p ON p.id=f.product_id JOIN public.designs d ON d.id=f.design_id
 JOIN public.tailor_assignments a ON a.id=j.tailor_assignment_id JOIN public.tailoring_factories factory ON factory.id=a.factory_id
 LEFT JOIN public.tailoring_sections s ON s.id=a.section_id JOIN public.tailors t ON t.id=a.tailor_id JOIN public.locations loc ON loc.id=f.current_location_id
 LEFT JOIN public.inventory_items inv ON inv.finished_product_id=f.id
 WHERE (p_barcode IS NULL OR b.code=btrim(p_barcode)) AND (p_job IS NULL OR j.id=p_job)
 AND (owner OR counter OR public.owns_tailor_assignment(j.tailor_assignment_id))
 ORDER BY j.created_at DESC,j.id,f.piece_number LIMIT p_limit) x),'[]'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.guard_phase11_identity() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.receive_finished_products(uuid,uuid,jsonb,text),public.finished_product_catalog(text,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.receive_finished_products(uuid,uuid,jsonb,text),public.finished_product_catalog(text,uuid,integer) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
