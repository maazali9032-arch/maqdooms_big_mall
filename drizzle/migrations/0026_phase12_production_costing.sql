-- Phase 12 only: immutable complete cost revisions, exact allocations, Owner-reviewed SP.
BEGIN;
CREATE TABLE public.production_cost_requests(request_id uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES public.profiles(id),production_job_id uuid NOT NULL REFERENCES public.production_jobs(id),payload jsonb NOT NULL,result_id uuid NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.production_cost_inputs(cost_line_id uuid PRIMARY KEY REFERENCES public.production_cost_lines(id),quantity numeric(18,3),unit text,consumable_receipt_id uuid REFERENCES public.consumable_receipts(id),design_basis text CHECK(design_basis IN('job_total','per_piece','not_applicable')),CHECK((quantity IS NULL)=(unit IS NULL)),CHECK(quantity IS NULL OR quantity>=0));
CREATE TABLE public.finished_product_price_reviews(price_id uuid PRIMARY KEY REFERENCES public.finished_product_prices(id),cost_version_id uuid NOT NULL REFERENCES public.production_cost_versions(id),request_id uuid NOT NULL REFERENCES public.production_cost_requests(request_id) DEFERRABLE INITIALLY DEFERRED,reason text NOT NULL CHECK(btrim(reason)<>''));
CREATE INDEX phase12_request_job_time_idx ON public.production_cost_requests(production_job_id,recorded_at);
CREATE INDEX phase12_price_cost_idx ON public.finished_product_price_reviews(cost_version_id);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['production_cost_requests','production_cost_inputs','finished_product_price_reviews'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
 EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
 EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 EXECUTE format('CREATE POLICY phase12_owner_read ON public.%I FOR SELECT TO authenticated USING(public.has_role(auth.uid(),''owner''))',t);
 EXECUTE format('CREATE TRIGGER phase12_history_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite()',t);
 END LOOP;
END; $$;
CREATE FUNCTION public.finalize_production_cost(p_request uuid,p_job uuid,p_expected_version uuid,p_materials jsonb,p_tailoring bigint,p_design_basis text,p_other jsonb,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE saved public.production_cost_requests%rowtype; payload_value jsonb; job public.production_jobs%rowtype; latest uuid; revision_value integer; result uuid; row_value jsonb; issue public.material_issue_lines%rowtype; source_cost public.fabric_stock_costs%rowtype; q numeric; amount bigint; line_id uuid; category_value text; design_amount bigint; total numeric; base_amount bigint; remainder integer; material_amount bigint; receipt_unit text; receipt_material uuid; required_usage numeric;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 IF p_request IS NULL OR p_job IS NULL OR p_tailoring IS NULL OR p_tailoring NOT BETWEEN 0 AND 9007199254740991 OR nullif(btrim(p_reason),'') IS NULL OR jsonb_typeof(p_materials) IS DISTINCT FROM 'array' OR jsonb_typeof(p_other) IS DISTINCT FROM 'array' OR jsonb_array_length(p_other)>100 THEN RAISE EXCEPTION 'Explicit materials, total tailoring cost, other costs, request and reason required'; END IF;
 payload_value:=jsonb_build_object('actor',auth.uid(),'job',p_job,'expected',p_expected_version,'materials',p_materials,'tailoring',p_tailoring,'design_basis',p_design_basis,'other',p_other,'reason',btrim(p_reason));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,12));
 SELECT * INTO saved FROM public.production_cost_requests WHERE request_id=p_request;
 IF FOUND THEN IF saved.payload IS DISTINCT FROM payload_value THEN RAISE EXCEPTION 'Cost request already used with different data'; END IF; RETURN saved.result_id; END IF;
 SELECT * INTO job FROM public.production_jobs WHERE id=p_job FOR UPDATE;
 IF job.id IS NULL OR job.status<>'completed' OR (SELECT count(*) FROM public.finished_products WHERE production_job_id=p_job)<>job.quantity OR NOT EXISTS(SELECT 1 FROM public.finished_product_receipts WHERE production_job_id=p_job) THEN RAISE EXCEPTION 'Completed job with all actual Finished Products received required'; END IF;
 SELECT id,revision INTO latest,revision_value FROM public.production_cost_versions WHERE production_job_id=p_job ORDER BY revision DESC LIMIT 1;
 IF latest IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Cost version changed; review current costs'; END IF;
 IF (SELECT count(*) FROM public.material_issue_lines l JOIN public.material_issues i ON i.id=l.material_issue_id WHERE i.production_job_id=p_job)<>jsonb_array_length(p_materials)
 OR (SELECT count(DISTINCT value->>'issue_line_id') FROM jsonb_array_elements(p_materials))<>jsonb_array_length(p_materials) THEN RAISE EXCEPTION 'Explicit costing decision for every issued material line exactly once required'; END IF;
 INSERT INTO public.production_cost_versions(production_job_id,revision,quantity_snapshot,recorded_by,reason) VALUES(p_job,coalesce(revision_value,0)+1,job.quantity,auth.uid(),btrim(p_reason)) RETURNING id INTO result;
 FOR row_value IN SELECT value FROM jsonb_array_elements(p_materials) LOOP
  SELECT l.* INTO issue FROM public.material_issue_lines l JOIN public.material_issues i ON i.id=l.material_issue_id WHERE l.id=(row_value->>'issue_line_id')::uuid AND i.production_job_id=p_job FOR UPDATE OF l;
  q:=(row_value->>'quantity')::numeric;
  SELECT coalesce(sum(quantity),0) INTO required_usage FROM public.finished_product_materials WHERE material_issue_line_id=issue.id;
  IF issue.id IS NULL OR q IS NULL OR q<required_usage OR q>issue.quantity OR q<0 OR q<>round(q,3) OR (issue.unit='mm' AND q<>trunc(q)) THEN RAISE EXCEPTION 'Explicit billable quantity must cover actual piece usage and not exceed issued quantity'; END IF;
  IF issue.fabric_stock_id IS NOT NULL THEN
   SELECT * INTO source_cost FROM public.fabric_stock_costs WHERE id=(row_value->>'fabric_cost_id')::uuid AND fabric_stock_id=issue.fabric_stock_id;
   IF source_cost.id IS NULL OR row_value->>'receipt_id' IS NOT NULL OR row_value->>'amount_paise' IS NOT NULL THEN RAISE EXCEPTION 'Select the real Fabric + Batch CP version, without a manual replacement cost'; END IF;
   amount:=round(q*source_cost.cp_paise_per_m/1000); category_value:='fabric';
  ELSE
   IF row_value->>'fabric_cost_id' IS NOT NULL THEN RAISE EXCEPTION 'Consumable is not fabric'; END IF;
   category_value:=row_value->>'category';
   IF category_value IS NULL OR category_value NOT IN('buttons','thread','padding','other_consumables') THEN RAISE EXCEPTION 'Confirm consumable cost category'; END IF;
   IF row_value->>'receipt_id' IS NOT NULL THEN
    SELECT r.material_id,r.unit,c.cp_paise_per_unit INTO receipt_material,receipt_unit,material_amount FROM public.consumable_receipts r JOIN public.consumable_receipt_costs c ON c.receipt_id=r.id WHERE r.id=(row_value->>'receipt_id')::uuid;
    IF receipt_material IS DISTINCT FROM issue.material_id OR receipt_unit IS DISTINCT FROM issue.unit OR material_amount IS NULL OR row_value->>'amount_paise' IS NOT NULL THEN RAISE EXCEPTION 'Select matching consumable receipt CP in its native unit'; END IF;
    amount:=round(q*material_amount);
   ELSE
    amount:=(row_value->>'amount_paise')::bigint;
    IF amount IS NULL THEN RAISE EXCEPTION 'Explicit Owner-confirmed actual cost required when no receipt cost basis is selected'; END IF;
   END IF;
  END IF;
  IF amount NOT BETWEEN 0 AND 9007199254740991 OR (q=0 AND amount<>0) THEN RAISE EXCEPTION 'Exact supported nonnegative cost required'; END IF;
  INSERT INTO public.production_cost_lines(cost_version_id,category,amount_paise,description,fabric_cost_id,material_issue_line_id) VALUES(result,category_value,amount,'Owner-confirmed billed quantity',CASE WHEN issue.fabric_stock_id IS NOT NULL THEN source_cost.id END,issue.id) RETURNING id INTO line_id;
  INSERT INTO public.production_cost_inputs(cost_line_id,quantity,unit,consumable_receipt_id) VALUES(line_id,q,issue.unit,(row_value->>'receipt_id')::uuid);
 END LOOP;
 INSERT INTO public.production_cost_lines(cost_version_id,category,amount_paise,description) VALUES(result,'tailoring_production',p_tailoring,'Explicit total job tailoring / production charge');
 IF job.design_charge_version_id IS NULL THEN
  IF p_design_basis IS DISTINCT FROM 'not_applicable' THEN RAISE EXCEPTION 'No job Design charge snapshot; explicitly confirm not applicable'; END IF;
  design_amount:=0;
 ELSE
  IF p_design_basis IS NULL OR p_design_basis NOT IN('job_total','per_piece') THEN RAISE EXCEPTION 'Explicit Design charge basis required'; END IF;
  SELECT amount_paise*CASE WHEN p_design_basis='per_piece' THEN job.quantity ELSE 1 END INTO design_amount FROM public.design_charge_versions WHERE id=job.design_charge_version_id;
 END IF;
 IF design_amount NOT BETWEEN 0 AND 9007199254740991 THEN RAISE EXCEPTION 'Design charge exceeds supported range'; END IF;
 INSERT INTO public.production_cost_lines(cost_version_id,category,amount_paise,description,design_charge_version_id) VALUES(result,'design_embroidery',design_amount,'Explicit Design / Embroidery basis: '||p_design_basis,job.design_charge_version_id) RETURNING id INTO line_id;
 INSERT INTO public.production_cost_inputs(cost_line_id,design_basis) VALUES(line_id,p_design_basis);
 FOR row_value IN SELECT value FROM jsonb_array_elements(p_other) LOOP
  amount:=(row_value->>'amount_paise')::bigint;
  IF amount IS NULL OR amount NOT BETWEEN 0 AND 9007199254740991 OR nullif(btrim(row_value->>'description'),'') IS NULL THEN RAISE EXCEPTION 'Named explicit applicable other production cost required'; END IF;
  INSERT INTO public.production_cost_lines(cost_version_id,category,amount_paise,description) VALUES(result,'other_production',amount,btrim(row_value->>'description'));
 END LOOP;
 SELECT sum(amount_paise) INTO total FROM public.production_cost_lines WHERE cost_version_id=result;
 IF total>9007199254740991 THEN RAISE EXCEPTION 'Total exceeds supported exact money range'; END IF;
 base_amount:=floor(total/job.quantity); remainder:=(total-base_amount*job.quantity)::integer;
 INSERT INTO public.finished_product_cost_allocations(finished_product_id,production_job_id,cost_version_id,amount_paise)
 SELECT id,p_job,result,base_amount+CASE WHEN row_number() OVER(ORDER BY piece_number)<=remainder THEN 1 ELSE 0 END FROM public.finished_products WHERE production_job_id=p_job;
 INSERT INTO public.production_cost_requests VALUES(p_request,auth.uid(),p_job,payload_value,result,now());
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference) VALUES(auth.uid(),'finalize_production_cost','production_cost_versions',result,jsonb_build_object('job',p_job,'total_paise',total,'quantity',job.quantity,'request',p_request),'COST:'||p_request::text);
 RETURN result;
END; $$;
CREATE FUNCTION public.set_finished_product_sp(p_request uuid,p_job uuid,p_cost_version uuid,p_updates jsonb,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE saved public.production_cost_requests%rowtype; payload_value jsonb; latest uuid; row_value jsonb; piece public.finished_products%rowtype; price uuid; amount bigint;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 IF p_request IS NULL OR p_job IS NULL OR p_cost_version IS NULL OR nullif(btrim(p_reason),'') IS NULL OR jsonb_typeof(p_updates) IS DISTINCT FROM 'array' OR jsonb_array_length(p_updates)<1 THEN RAISE EXCEPTION 'Reviewed cost, explicit piece prices, request and reason required'; END IF;
 payload_value:=jsonb_build_object('actor',auth.uid(),'job',p_job,'cost_version',p_cost_version,'updates',p_updates,'reason',btrim(p_reason));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,12));
 SELECT * INTO saved FROM public.production_cost_requests WHERE request_id=p_request;
 IF FOUND THEN IF saved.payload IS DISTINCT FROM payload_value THEN RAISE EXCEPTION 'Price request already used with different data'; END IF; RETURN saved.result_id; END IF;
 PERFORM 1 FROM public.production_jobs WHERE id=p_job FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Production Job required'; END IF;
 SELECT id INTO latest FROM public.production_cost_versions WHERE production_job_id=p_job ORDER BY revision DESC LIMIT 1;
 IF latest IS DISTINCT FROM p_cost_version OR NOT EXISTS(SELECT 1 FROM public.production_cost_requests WHERE result_id=p_cost_version AND payload ? 'materials') THEN RAISE EXCEPTION 'Review latest complete production cost before setting SP'; END IF;
 IF (SELECT count(DISTINCT value->>'piece_id') FROM jsonb_array_elements(p_updates))<>jsonb_array_length(p_updates) THEN RAISE EXCEPTION 'Distinct Finished Products required'; END IF;
 FOR row_value IN SELECT value FROM jsonb_array_elements(p_updates) ORDER BY value->>'piece_id' LOOP
  SELECT * INTO piece FROM public.finished_products WHERE id=(row_value->>'piece_id')::uuid AND production_job_id=p_job AND status='available' FOR UPDATE;
  amount:=(row_value->>'sp_paise')::bigint;
  IF piece.id IS NULL OR amount IS NULL OR amount NOT BETWEEN 0 AND 9007199254740991 OR NOT EXISTS(SELECT 1 FROM public.finished_product_cost_allocations WHERE finished_product_id=piece.id AND cost_version_id=p_cost_version) THEN RAISE EXCEPTION 'Available job piece with reviewed cost and explicit nonnegative SP required'; END IF;
  INSERT INTO public.finished_product_prices(finished_product_id,revision,sp_paise,recorded_by) SELECT piece.id,coalesce(max(revision),0)+1,amount,auth.uid() FROM public.finished_product_prices WHERE finished_product_id=piece.id RETURNING id INTO price;
  INSERT INTO public.finished_product_price_reviews VALUES(price,p_cost_version,p_request,btrim(p_reason));
 END LOOP;
 INSERT INTO public.production_cost_requests VALUES(p_request,auth.uid(),p_job,payload_value,p_job,now());
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference) VALUES(auth.uid(),'set_finished_product_sp','production_jobs',p_job,payload_value,'PRICE:'||p_request::text);
 RETURN p_job;
END; $$;
CREATE FUNCTION public.owner_production_costs(p_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE job public.production_jobs%rowtype;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 SELECT * INTO job FROM public.production_jobs WHERE id=p_job;
 IF job.id IS NULL THEN RAISE EXCEPTION 'Production Job required'; END IF;
 RETURN jsonb_build_object('job_id',job.id,'quantity',job.quantity,'design_charge_version_id',job.design_charge_version_id,
 'design_charge_paise',(SELECT amount_paise FROM public.design_charge_versions WHERE id=job.design_charge_version_id),
 'materials',coalesce((SELECT jsonb_agg(jsonb_build_object('issue_line_id',l.id,'name',coalesce(f.name,m.name),'quantity',l.quantity,'unit',l.unit,'fabric',l.fabric_stock_id IS NOT NULL,
 'category',CASE m.category WHEN 'other' THEN 'other_consumables' ELSE m.category END,
 'actual_piece_usage',(SELECT coalesce(sum(quantity),0) FROM public.finished_product_materials WHERE material_issue_line_id=l.id),
 'fabric_costs',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'revision',c.revision,'cp_paise_per_m',c.cp_paise_per_m) ORDER BY c.revision) FROM public.fabric_stock_costs c WHERE c.fabric_stock_id=l.fabric_stock_id),'[]'::jsonb),
 'receipts',coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'received_at',r.received_at,'quantity',r.quantity,'cp_paise_per_unit',c.cp_paise_per_unit) ORDER BY r.received_at,r.id) FROM public.consumable_receipts r JOIN public.consumable_receipt_costs c ON c.receipt_id=r.id WHERE r.material_id=l.material_id AND r.unit=l.unit),'[]'::jsonb)) ORDER BY l.id)
 FROM public.material_issue_lines l JOIN public.material_issues i ON i.id=l.material_issue_id LEFT JOIN public.materials m ON m.id=l.material_id LEFT JOIN public.fabric_stock s ON s.id=l.fabric_stock_id LEFT JOIN public.fabrics f ON f.id=s.fabric_id WHERE i.production_job_id=p_job),'[]'::jsonb),
 'versions',coalesce((SELECT jsonb_agg(jsonb_build_object('id',v.id,'revision',v.revision,'quantity',v.quantity_snapshot,'reason',v.reason,'recorded_at',v.recorded_at,
 'total_paise',(SELECT sum(amount_paise) FROM public.production_cost_lines WHERE cost_version_id=v.id),
 'mean_piece_paise',(SELECT sum(amount_paise)::numeric/v.quantity_snapshot FROM public.production_cost_lines WHERE cost_version_id=v.id),
 'lines',coalesce((SELECT jsonb_agg(to_jsonb(l)||coalesce(to_jsonb(inputs)-'cost_line_id','{}'::jsonb) ORDER BY l.category,l.id) FROM public.production_cost_lines l LEFT JOIN public.production_cost_inputs inputs ON inputs.cost_line_id=l.id WHERE l.cost_version_id=v.id),'[]'::jsonb),
 'allocations',coalesce((SELECT jsonb_agg(jsonb_build_object('piece_id',f.id,'piece_number',f.piece_number,'barcode',b.code,'amount_paise',a.amount_paise,'sp_paise',price.sp_paise,'price_cost_version_id',review.cost_version_id,'status',f.status) ORDER BY f.piece_number) FROM public.finished_product_cost_allocations a JOIN public.finished_products f ON f.id=a.finished_product_id JOIN public.barcodes b ON b.id=f.barcode_id LEFT JOIN LATERAL(SELECT id,sp_paise FROM public.finished_product_prices WHERE finished_product_id=f.id ORDER BY revision DESC LIMIT 1) price ON true LEFT JOIN public.finished_product_price_reviews review ON review.price_id=price.id WHERE a.cost_version_id=v.id),'[]'::jsonb)) ORDER BY v.revision DESC) FROM public.production_cost_versions v WHERE v.production_job_id=p_job),'[]'::jsonb));
END; $$;

CREATE OR REPLACE FUNCTION public.finished_product_catalog(p_barcode text DEFAULT NULL,p_job uuid DEFAULT NULL,p_limit integer DEFAULT 100) RETURNS jsonb
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
 'pricing_status',CASE WHEN EXISTS(SELECT 1 FROM public.finished_product_prices WHERE finished_product_id=f.id) THEN 'priced' ELSE 'not_set' END)
 || CASE WHEN owner THEN jsonb_build_object('production_cost_paise',(SELECT a.amount_paise FROM public.finished_product_cost_allocations a JOIN public.production_cost_versions v ON v.id=a.cost_version_id WHERE a.finished_product_id=f.id ORDER BY v.revision DESC LIMIT 1),'cost_version_id',(SELECT v.id FROM public.production_cost_versions v WHERE v.production_job_id=j.id ORDER BY v.revision DESC LIMIT 1)) ELSE '{}'::jsonb END row_value
 FROM public.finished_products f JOIN public.barcodes b ON b.id=f.barcode_id AND b.kind='product'
 JOIN public.production_jobs j ON j.id=f.production_job_id JOIN public.products p ON p.id=f.product_id JOIN public.designs d ON d.id=f.design_id
 JOIN public.tailor_assignments a ON a.id=j.tailor_assignment_id JOIN public.tailoring_factories factory ON factory.id=a.factory_id
 LEFT JOIN public.tailoring_sections s ON s.id=a.section_id JOIN public.tailors t ON t.id=a.tailor_id JOIN public.locations loc ON loc.id=f.current_location_id
 LEFT JOIN public.inventory_items inv ON inv.finished_product_id=f.id
 WHERE (p_barcode IS NULL OR b.code=btrim(p_barcode)) AND (p_job IS NULL OR j.id=p_job)
 AND (owner OR counter OR public.owns_tailor_assignment(j.tailor_assignment_id))
 ORDER BY j.created_at DESC,j.id,f.piece_number LIMIT p_limit) x),'[]'::jsonb);
END; $$;

REVOKE ALL ON FUNCTION public.finalize_production_cost(uuid,uuid,uuid,jsonb,bigint,text,jsonb,text),public.set_finished_product_sp(uuid,uuid,uuid,jsonb,text),public.owner_production_costs(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_production_cost(uuid,uuid,uuid,jsonb,bigint,text,jsonb,text),public.set_finished_product_sp(uuid,uuid,uuid,jsonb,text),public.owner_production_costs(uuid) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
