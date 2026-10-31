-- Tailor Staff shares, no damaged returns of custom stitching, cost correction after a reversal (31 Oct 2026).
-- 1. A Master Tailor's work submission can credit several Tailor Staff; he sets each one's share (total 100%).
--    Existing submissions become one staff at 100%. The lead (largest share) is kept in the old column.
-- 2. Custom stitched outfits (customer tailoring lines on a bill) cannot be taken as damaged returns.
-- 3. Only when a material submission was reversed and the Master Tailor resubmits:
--    the job's final CP is recalculated (labels/barcodes and SP stay the same).
--    Customer orders: the saved completion cost is updated; each C label's CP is its equal share.
--    Owner production: a new cost version is created and split across pieces; unsold pieces keep their SP.
--    The job's stage never moves back.
BEGIN;

-- 1. Staff shares per submission.
CREATE TABLE public.job_material_consumption_staff (
  consumption_id uuid NOT NULL REFERENCES public.job_material_consumptions(id),
  staff_assignment_id uuid NOT NULL REFERENCES public.tailor_staff_assignments(id),
  share_pct numeric(5,2) NOT NULL CHECK (share_pct > 0 AND share_pct <= 100),
  PRIMARY KEY (consumption_id, staff_assignment_id)
);
ALTER TABLE public.job_material_consumption_staff ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_material_consumption_staff FROM PUBLIC, anon, authenticated;
CREATE TRIGGER job_material_consumption_staff_immutable BEFORE UPDATE OR DELETE ON public.job_material_consumption_staff
  FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();
INSERT INTO public.job_material_consumption_staff(consumption_id, staff_assignment_id, share_pct)
SELECT id, tailor_staff_assignment_id, 100 FROM public.job_material_consumptions;

-- 3a. Customer order: refresh the saved final cost after a corrected resubmission.
CREATE FUNCTION public.recalc_customer_tailoring_cost_after_correction(p_job uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE before_row public.customer_tailoring_completion_costs%rowtype; after_row public.customer_tailoring_completion_costs%rowtype;
BEGIN
  SELECT * INTO before_row FROM public.customer_tailoring_completion_costs WHERE job_id = p_job FOR UPDATE;
  IF before_row.job_id IS NULL THEN RETURN; END IF; -- not costed yet: the godown will cost it normally
  UPDATE public.customer_tailoring_completion_costs
     SET fabric_cp_paise = public.customer_tailoring_fabric_cp(p_job),
         consumables_cp_paise = public.customer_tailoring_consumables_cp(p_job),
         recorded_by = auth.uid(), recorded_at = clock_timestamp()
   WHERE job_id = p_job RETURNING * INTO after_row;
  INSERT INTO public.erp_audit_records(actor_id, action, entity_table, entity_id, previous_value, new_value, reference)
  VALUES (auth.uid(), 'recalc_customer_tailoring_cost_after_correction', 'customer_tailoring_completion_costs', p_job,
    to_jsonb(before_row), to_jsonb(after_row), 'COST-CORRECTION:' || p_job::text);
END $$;

-- 3b. Owner production: new cost version with the corrected materials; unsold pieces keep their SP.
CREATE FUNCTION public.recalc_production_cost_after_correction(p_job uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v public.production_cost_versions%rowtype; new_id uuid; consumables bigint; total bigint; base bigint; remainder integer;
  req uuid := gen_random_uuid(); payload_value jsonb; p record; new_price uuid;
BEGIN
  SELECT * INTO v FROM public.production_cost_versions WHERE production_job_id = p_job ORDER BY revision DESC LIMIT 1 FOR UPDATE;
  -- only once the workshop receipt has finalised the cost; before that the normal receipt includes the corrected materials
  IF v.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.production_cost_lines WHERE cost_version_id = v.id
       AND category = 'tailoring_production' AND description = 'Whole-job stitching CP entered at Workshop receipt') THEN RETURN; END IF;
  SELECT coalesce(sum(l.amount_paise), 0) INTO consumables
    FROM public.job_material_consumptions c JOIN public.job_material_consumption_lines l ON l.consumption_id = c.id
   WHERE c.production_job_id = p_job AND c.reversed_at IS NULL;
  INSERT INTO public.production_cost_versions(production_job_id, revision, quantity_snapshot, recorded_by, reason)
  VALUES (p_job, v.revision + 1, v.quantity_snapshot, auth.uid(), 'Material correction after a reversed submission')
  RETURNING id INTO new_id;
  INSERT INTO public.production_cost_lines(cost_version_id, category, amount_paise, description, fabric_cost_id, design_charge_version_id, material_issue_line_id)
  SELECT new_id, category, amount_paise, description, fabric_cost_id, design_charge_version_id, material_issue_line_id
    FROM public.production_cost_lines
   WHERE cost_version_id = v.id
     AND NOT (category = 'other_consumables' AND description = 'Actual barcode-scanned consumables used by Master Tailor');
  IF consumables > 0 THEN
    INSERT INTO public.production_cost_lines(cost_version_id, category, amount_paise, description)
    VALUES (new_id, 'other_consumables', consumables, 'Actual barcode-scanned consumables used by Master Tailor');
  END IF;
  SELECT payload INTO payload_value FROM public.production_cost_requests WHERE result_id = v.id ORDER BY recorded_at DESC LIMIT 1;
  payload_value := coalesce(payload_value, '{}'::jsonb)
    || jsonb_build_object('correction_of', v.id, 'actual_material_units', true, 'consumables_paise', consumables, 'corrected_by', auth.uid());
  IF NOT payload_value ? 'materials' THEN payload_value := payload_value || jsonb_build_object('materials', '[]'::jsonb); END IF;
  INSERT INTO public.production_cost_requests VALUES (req, auth.uid(), p_job, payload_value, new_id, now());
  SELECT coalesce(sum(amount_paise), 0) INTO total FROM public.production_cost_lines WHERE cost_version_id = new_id;
  base := floor(total::numeric / v.quantity_snapshot);
  remainder := (total - base * v.quantity_snapshot)::integer;
  INSERT INTO public.finished_product_cost_allocations(finished_product_id, production_job_id, cost_version_id, amount_paise)
  SELECT id, p_job, new_id, base + CASE WHEN row_number() OVER (ORDER BY piece_number) <= remainder THEN 1 ELSE 0 END
    FROM public.finished_products WHERE production_job_id = p_job;
  -- the same SP is carried onto the corrected cost, so pieces stay sellable at their price
  FOR p IN
    SELECT DISTINCT ON (fp.id) fp.id piece_id, pr.sp_paise, pr.revision
      FROM public.finished_products fp JOIN public.finished_product_prices pr ON pr.finished_product_id = fp.id
     WHERE fp.production_job_id = p_job AND fp.status <> 'sold'
     ORDER BY fp.id, pr.revision DESC
  LOOP
    INSERT INTO public.finished_product_prices(finished_product_id, revision, sp_paise, recorded_by)
    VALUES (p.piece_id, p.revision + 1, p.sp_paise, auth.uid()) RETURNING id INTO new_price;
    INSERT INTO public.finished_product_price_reviews VALUES (new_price, new_id, req, 'Same SP carried to the corrected cost');
  END LOOP;
  INSERT INTO public.erp_audit_records(actor_id, action, entity_table, entity_id, previous_value, new_value, reference)
  VALUES (auth.uid(), 'recalc_production_cost_after_correction', 'production_cost_versions', new_id,
    jsonb_build_object('cost_version', v.id, 'revision', v.revision),
    jsonb_build_object('cost_version', new_id, 'revision', v.revision + 1, 'total_paise', total, 'consumables_paise', consumables),
    'COST-CORRECTION:' || req::text);
END $$;

REVOKE ALL ON FUNCTION public.recalc_customer_tailoring_cost_after_correction(uuid), public.recalc_production_cost_after_correction(uuid)
  FROM PUBLIC, anon, authenticated;

-- 1. Submission with several Tailor Staff and their shares.
CREATE FUNCTION public.submit_job_material_consumption(p_request uuid, p_job_kind text, p_job uuid, p_staff jsonb, p_lines jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE master public.tailors%rowtype; job_assignment uuid; job_status text; job_factory uuid; payload jsonb; result uuid;
  row_value jsonb; u public.material_units%rowtype; qty numeric; amount bigint; lead uuid; correction boolean; total numeric;
BEGIN
  IF NOT public.has_perm(auth.uid(), 'materials.record_consumption') THEN RAISE EXCEPTION 'Material consumption permission required'; END IF;
  SELECT * INTO master FROM public.tailors WHERE profile_id = auth.uid() AND active;
  IF master.id IS NULL THEN RAISE EXCEPTION 'Master Tailor login required'; END IF;
  IF p_job_kind = 'production' THEN
    SELECT tailor_assignment_id, status INTO job_assignment, job_status FROM public.production_jobs WHERE id = p_job FOR UPDATE;
  ELSIF p_job_kind = 'customer_tailoring' THEN
    SELECT tailor_assignment_id, status INTO job_assignment, job_status FROM public.customer_tailoring_jobs WHERE id = p_job FOR UPDATE;
  ELSE RAISE EXCEPTION 'Production or customer-tailoring job required'; END IF;
  -- a correction: the job's earlier submission was reversed and nothing active replaces it yet
  correction := EXISTS(SELECT 1 FROM public.job_material_consumptions c WHERE c.reversed_at IS NOT NULL
                  AND (c.production_job_id = p_job OR c.customer_tailoring_job_id = p_job))
            AND NOT EXISTS(SELECT 1 FROM public.job_material_consumptions c WHERE c.reversed_at IS NULL
                  AND (c.production_job_id = p_job OR c.customer_tailoring_job_id = p_job));
  IF job_assignment IS NULL
     OR (p_job_kind = 'production' AND job_status NOT IN ('issued', 'in_progress', 'completed'))
     OR (p_job_kind = 'customer_tailoring' AND NOT (job_status IN ('open', 'in_progress', 'completed')
           OR (correction AND job_status IN ('ready', 'delivered')))) THEN
    RAISE EXCEPTION 'This job is not open for a work submission';
  END IF;
  SELECT factory_id INTO job_factory FROM public.tailor_assignments WHERE id = job_assignment AND tailor_id = master.id;
  IF job_factory IS NULL THEN RAISE EXCEPTION 'Job belongs to another Master Tailor'; END IF;

  IF jsonb_typeof(p_staff) IS DISTINCT FROM 'array' OR jsonb_array_length(p_staff) NOT BETWEEN 1 AND 20
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_staff) x WHERE jsonb_typeof(x) IS DISTINCT FROM 'object'
                 OR (x - ARRAY['assignment_id', 'share']) <> '{}' OR nullif(x->>'assignment_id', '') IS NULL
                 OR jsonb_typeof(x->'share') IS DISTINCT FROM 'number')
     OR (SELECT count(DISTINCT x->>'assignment_id') FROM jsonb_array_elements(p_staff) x) <> jsonb_array_length(p_staff) THEN
    RAISE EXCEPTION 'Choose 1 to 20 different Tailor Staff, each with a share';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_staff) x WHERE (x->>'share')::numeric <= 0 OR (x->>'share')::numeric > 100
              OR (x->>'share')::numeric <> round((x->>'share')::numeric, 2)) THEN
    RAISE EXCEPTION 'Each share must be more than 0%% and at most 100%%, with up to 2 decimals';
  END IF;
  SELECT sum((x->>'share')::numeric) INTO total FROM jsonb_array_elements(p_staff) x;
  IF total <> 100 THEN RAISE EXCEPTION 'Tailor Staff shares must add up to 100%% (now % percent)', total; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_staff) x WHERE NOT EXISTS(
              SELECT 1 FROM public.tailor_staff_assignments s WHERE s.id = (x->>'assignment_id')::uuid
                 AND s.tailor_id = master.id AND s.factory_id = job_factory AND s.valid_until IS NULL)) THEN
    RAISE EXCEPTION 'Every Tailor Staff must be active under this Master Tailor in this factory';
  END IF;
  SELECT (x->>'assignment_id')::uuid INTO lead FROM jsonb_array_elements(p_staff) WITH ORDINALITY t(x, n)
   ORDER BY (x->>'share')::numeric DESC, n LIMIT 1;

  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 0 AND 100
     OR (SELECT count(DISTINCT upper(value->>'barcode')) FROM jsonb_array_elements(p_lines)) <> jsonb_array_length(p_lines) THEN
    RAISE EXCEPTION 'Up to 100 distinct material-unit scans allowed (none if nothing was used)';
  END IF;
  payload := jsonb_build_object('actor', auth.uid(), 'job_kind', p_job_kind, 'job', p_job, 'staff', p_staff, 'lines', p_lines);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text, 73));
  IF EXISTS(SELECT 1 FROM public.job_material_consumptions WHERE request_id = p_request) THEN
    RETURN (SELECT id FROM public.job_material_consumptions WHERE request_id = p_request AND request_payload = payload);
  END IF;
  INSERT INTO public.job_material_consumptions(request_id, request_payload, customer_tailoring_job_id, production_job_id, tailor_assignment_id, tailor_staff_assignment_id, submitted_by)
  VALUES (p_request, payload, CASE WHEN p_job_kind = 'customer_tailoring' THEN p_job END, CASE WHEN p_job_kind = 'production' THEN p_job END,
          job_assignment, lead, auth.uid())
  RETURNING id INTO result;
  INSERT INTO public.job_material_consumption_staff(consumption_id, staff_assignment_id, share_pct)
  SELECT result, (x->>'assignment_id')::uuid, (x->>'share')::numeric FROM jsonb_array_elements(p_staff) x;
  FOR row_value IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    SELECT * INTO u FROM public.material_units WHERE barcode = upper(btrim(row_value->>'barcode')) FOR UPDATE;
    qty := (row_value->>'quantity')::numeric;
    IF u.id IS NULL OR u.assigned_tailor_id <> master.id OR u.assigned_factory_id <> job_factory THEN
      RAISE EXCEPTION 'Every M unit must be assigned to this Master Tailor and factory';
    END IF;
    IF qty <= 0 OR qty <> round(qty, 3) OR qty > u.remaining_quantity THEN
      RAISE EXCEPTION 'Consumption must be positive and cannot exceed the unit balance';
    END IF;
    amount := round(qty * u.cp_per_quantity_paise);
    INSERT INTO public.job_material_consumption_lines(consumption_id, material_unit_id, quantity, unit, cp_per_quantity_paise, amount_paise)
    VALUES (result, u.id, qty, u.unit, u.cp_per_quantity_paise, amount);
    UPDATE public.material_units SET remaining_quantity = remaining_quantity - qty,
      exhausted_at = CASE WHEN remaining_quantity - qty = 0 THEN clock_timestamp() END WHERE id = u.id;
  END LOOP;
  IF p_job_kind = 'customer_tailoring' THEN
    UPDATE public.customer_tailoring_jobs SET status = 'completed' WHERE id = p_job AND status IN ('open', 'in_progress');
  END IF;
  -- only after a reversal: refresh a cost that was already finalised (stage and labels stay as they are)
  IF correction THEN
    IF p_job_kind = 'customer_tailoring' THEN PERFORM public.recalc_customer_tailoring_cost_after_correction(p_job);
    ELSE PERFORM public.recalc_production_cost_after_correction(p_job); END IF;
  END IF;
  INSERT INTO public.erp_audit_records(actor_id, action, entity_table, entity_id, new_value, reference)
  VALUES (auth.uid(), 'submit_job_material_consumption', 'job_material_consumptions', result, payload || jsonb_build_object('correction', correction),
          'MATERIAL-CONSUME:' || p_request);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.submit_job_material_consumption(uuid, text, uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_job_material_consumption(uuid, text, uuid, jsonb, jsonb) TO authenticated;

-- The older one-staff call keeps working: that staff gets 100%.
CREATE OR REPLACE FUNCTION public.submit_job_material_consumption(p_request uuid, p_job_kind text, p_job uuid, p_staff_assignment uuid, p_lines jsonb)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.submit_job_material_consumption(p_request, p_job_kind, p_job,
    jsonb_build_array(jsonb_build_object('assignment_id', p_staff_assignment, 'share', 100)), p_lines)
$$;

-- Tailor Staff see every job they were credited on, with their share.
CREATE OR REPLACE FUNCTION public.tailor_staff_work_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF NOT public.has_role(auth.uid(),'tailor_staff') THEN RAISE EXCEPTION 'Tailor Staff login required'; END IF;
 RETURN jsonb_build_object('month_count',(SELECT count(*) FROM public.job_material_consumptions c JOIN public.job_material_consumption_staff cs ON cs.consumption_id=c.id JOIN public.tailor_staff_assignments s ON s.id=cs.staff_assignment_id WHERE s.staff_profile_id=auth.uid() AND c.reversed_at IS NULL AND c.submitted_at>=date_trunc('month',now())),
  'work',coalesce((SELECT jsonb_agg(jsonb_build_object('submitted_at',c.submitted_at,'share_pct',cs.share_pct,'job_code',coalesce(p.code,j.code),'kind',CASE WHEN c.production_job_id IS NOT NULL THEN 'production' ELSE 'customer_tailoring' END,'materials',(SELECT jsonb_agg(jsonb_build_object('barcode',u.barcode,'material',m.name,'quantity',l.quantity,'unit',l.unit)) FROM public.job_material_consumption_lines l JOIN public.material_units u ON u.id=l.material_unit_id JOIN public.materials m ON m.id=u.material_id WHERE l.consumption_id=c.id)) ORDER BY c.submitted_at DESC) FROM public.job_material_consumptions c JOIN public.job_material_consumption_staff cs ON cs.consumption_id=c.id JOIN public.tailor_staff_assignments s ON s.id=cs.staff_assignment_id LEFT JOIN public.production_jobs p ON p.id=c.production_job_id LEFT JOIN public.customer_tailoring_jobs j ON j.id=c.customer_tailoring_job_id WHERE s.staff_profile_id=auth.uid() AND c.reversed_at IS NULL),'[]'::jsonb));
END; $function$;

-- The Owner's correction list names every credited staff member with their share.
CREATE OR REPLACE FUNCTION public.material_consumption_history(p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') AND NOT public.has_perm(auth.uid(),'materials.correct_consumption') THEN RAISE EXCEPTION 'Consumption correction permission required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'job_code',coalesce(p.code,j.code),'kind',CASE WHEN c.production_job_id IS NOT NULL THEN 'production' ELSE 'customer_tailoring' END,'staff_name',coalesce((SELECT string_agg(sp.full_name||' '||trim_scale(cs.share_pct)::text||'%',', ' ORDER BY cs.share_pct DESC,sp.full_name) FROM public.job_material_consumption_staff cs JOIN public.tailor_staff_assignments ss ON ss.id=cs.staff_assignment_id JOIN public.profiles sp ON sp.id=ss.staff_profile_id WHERE cs.consumption_id=c.id),profile.full_name),'submitted_at',c.submitted_at,'reversed_at',c.reversed_at,'reversal_reason',c.reversal_reason,'lines',(SELECT jsonb_agg(jsonb_build_object('barcode',u.barcode,'material',m.name,'quantity',l.quantity,'unit',l.unit,'amount_paise',l.amount_paise) ORDER BY m.name,u.barcode) FROM public.job_material_consumption_lines l JOIN public.material_units u ON u.id=l.material_unit_id JOIN public.materials m ON m.id=u.material_id WHERE l.consumption_id=c.id)) ORDER BY c.submitted_at DESC) FROM (SELECT * FROM public.job_material_consumptions ORDER BY submitted_at DESC LIMIT greatest(1,least(coalesce(p_limit,100),200))) c JOIN public.tailor_staff_assignments s ON s.id=c.tailor_staff_assignment_id JOIN public.profiles profile ON profile.id=s.staff_profile_id LEFT JOIN public.production_jobs p ON p.id=c.production_job_id LEFT JOIN public.customer_tailoring_jobs j ON j.id=c.customer_tailoring_job_id),'[]'::jsonb);
END; $function$;

-- 2. No damaged returns of custom stitched outfits.
CREATE OR REPLACE FUNCTION public.record_defective_return(p_request uuid, p_original_bill uuid, p_order_item uuid, p_quantity numeric, p_resolution text, p_disposition text, p_reason text, p_replacement_barcode text DEFAULT NULL::text, p_salesperson uuid DEFAULT NULL::uuid, p_payment_method text DEFAULT 'cash'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE original public.orders%rowtype; line public.order_items%rowtype; returned public.finished_products%rowtype;
 replacement public.finished_products%rowtype; saved public.defective_returns%rowtype; result_id uuid:=gen_random_uuid();
 request_qty numeric; credit bigint; return_code text; credit_code text; exchange_code text; exchange_id uuid;
 inventory_id uuid; waste_location uuid;
BEGIN
  IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) OR NOT public.has_perm(auth.uid(),'pos.sell') THEN
    RAISE EXCEPTION 'Counter return permission required';
  END IF;
  IF p_request IS NULL OR p_original_bill IS NULL OR p_order_item IS NULL OR p_quantity IS NULL OR p_quantity<=0
     OR p_resolution NOT IN ('refund','exchange','repair') OR p_disposition NOT IN ('quarantine','depleted','repair','fabric_remnant')
     OR nullif(btrim(p_reason),'') IS NULL OR p_payment_method NOT IN ('cash','card','upi','bank_transfer','mixed') THEN
    RAISE EXCEPTION 'Bill line, positive quantity, resolution, disposition, reason and payment method are required';
  END IF;
  IF (p_resolution='repair')<>(p_disposition='repair') THEN RAISE EXCEPTION 'Repair resolution must use repair disposition'; END IF;
  IF p_resolution<>'repair' AND p_disposition='repair' THEN RAISE EXCEPTION 'Repair disposition is only for repair resolution'; END IF;
  IF p_disposition='fabric_remnant' AND NOT EXISTS(SELECT 1 FROM public.order_items WHERE id=p_order_item AND thaan_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Fabric remnant disposition is only available for returned fabric';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,81));
  SELECT * INTO saved FROM public.defective_returns WHERE request_id=p_request;
  IF FOUND THEN RETURN jsonb_build_object('return_id',saved.id,'code',saved.code,'status',saved.status); END IF;
  SELECT * INTO original FROM public.orders WHERE id=p_original_bill FOR UPDATE;
  IF original.id IS NULL OR original.status<>'completed' THEN RAISE EXCEPTION 'A completed original customer bill is required'; END IF;
  IF original.kind='counter_bill' AND NOT EXISTS(
    SELECT 1 FROM public.counter_bill_payments payment WHERE payment.bill_id=original.id
    GROUP BY payment.bill_id HAVING sum(payment.amount_paise)>=original.final_customer_price_paise
  ) THEN RAISE EXCEPTION 'Only a fully paid original bill can be returned'; END IF;
  SELECT * INTO line FROM public.order_items WHERE id=p_order_item AND order_id=original.id FOR UPDATE;
  IF line.id IS NULL THEN RAISE EXCEPTION 'Selected item does not belong to this bill'; END IF;
  IF line.customer_tailoring_job_id IS NOT NULL THEN RAISE EXCEPTION 'Custom stitched outfits cannot be returned as damaged'; END IF;
  request_qty:=CASE WHEN line.unit='mm' THEN round(p_quantity*1000,0) ELSE p_quantity END;
  IF request_qty>line.quantity OR (line.finished_product_id IS NOT NULL AND request_qty<>1) THEN
    RAISE EXCEPTION 'Returned quantity exceeds the sold quantity';
  END IF;
  IF line.thaan_id IS NULL AND EXISTS(SELECT 1 FROM public.defective_return_lines WHERE original_order_item_id=line.id) THEN
    RAISE EXCEPTION 'This bill item already has a defective-return case';
  END IF;
  IF line.thaan_id IS NOT NULL AND
     coalesce((SELECT sum(quantity) FROM public.defective_return_lines WHERE original_order_item_id=line.id),0)+p_quantity>line.quantity/1000 THEN
    RAISE EXCEPTION 'Total returned fabric exceeds the quantity on the original bill';
  END IF;
  credit:=round(line.final_customer_price_paise*(request_qty/line.quantity));
  return_code:='RET-'||upper(substr(replace(result_id::text,'-',''),1,10));

  IF p_resolution='exchange' THEN
    IF line.finished_product_id IS NULL OR nullif(btrim(p_replacement_barcode),'') IS NULL OR p_salesperson IS NULL THEN
      RAISE EXCEPTION 'Defective exchange requires a sold garment, replacement barcode and Salesperson';
    END IF;
    SELECT * INTO returned FROM public.finished_products WHERE id=line.finished_product_id FOR UPDATE;
    SELECT p.* INTO replacement FROM public.finished_products p JOIN public.barcodes b ON b.id=p.barcode_id
      WHERE b.code=upper(btrim(p_replacement_barcode)) FOR UPDATE OF p;
    IF replacement.id IS NULL THEN RAISE EXCEPTION 'Replacement barcode was not found'; END IF;
    exchange_code:=public.complete_finished_product_exchange(
      gen_random_uuid(),original.id,jsonb_build_array((SELECT code FROM public.barcodes WHERE id=returned.barcode_id)),
      jsonb_build_array(upper(btrim(p_replacement_barcode))),p_salesperson,p_payment_method
    );
    SELECT id INTO exchange_id FROM public.orders WHERE code=exchange_code OR scan_code=exchange_code;
    SELECT id INTO inventory_id FROM public.inventory_items WHERE finished_product_id=returned.id FOR UPDATE;
    SELECT current_location_id INTO waste_location FROM public.finished_products WHERE id=returned.id;
    INSERT INTO public.inventory_movements(inventory_item_id,kind,finished_product_id,quantity,unit,source_location_id,actor_id,reason,reference)
    VALUES(inventory_id,'WASTAGE',returned.id,1,'pc',waste_location,auth.uid(),'Defective exchange quarantine/depletion',return_code);
    UPDATE public.finished_products SET status='archived' WHERE id=returned.id;
  ELSIF line.finished_product_id IS NOT NULL AND p_resolution='refund' THEN
    SELECT * INTO returned FROM public.finished_products WHERE id=line.finished_product_id FOR UPDATE;
    IF returned.status<>'sold' THEN RAISE EXCEPTION 'The returned garment is no longer recorded as sold'; END IF;
    SELECT id INTO inventory_id FROM public.inventory_items WHERE finished_product_id=returned.id AND unit='pc' FOR UPDATE;
    SELECT coalesce(m.source_location_id,original.source_location_id) INTO waste_location
    FROM public.inventory_movements m
    WHERE m.order_item_id=line.id AND m.kind='SALE'
    ORDER BY m.occurred_at DESC LIMIT 1;
    IF inventory_id IS NULL OR waste_location IS NULL OR NOT public.is_showroom_location(waste_location) THEN
      RAISE EXCEPTION 'The original physical stock record and Showroom floor are required for this return';
    END IF;
    INSERT INTO public.inventory_movements(inventory_item_id,kind,finished_product_id,quantity,unit,destination_location_id,actor_id,reason,reference)
    VALUES(inventory_id,'RETURN',returned.id,1,'pc',waste_location,auth.uid(),'Defective customer return',return_code);
    INSERT INTO public.inventory_movements(inventory_item_id,kind,finished_product_id,quantity,unit,source_location_id,actor_id,reason,reference)
    VALUES(inventory_id,'WASTAGE',returned.id,1,'pc',waste_location,auth.uid(),
      CASE WHEN p_disposition='depleted' THEN 'Defective return discarded' ELSE 'Defective return removed to quarantine' END,return_code);
    UPDATE public.finished_products SET status='archived',current_location_id=waste_location WHERE id=returned.id;
  END IF;

  INSERT INTO public.defective_returns(id,code,request_id,original_order_id,resolution,status,reason,payment_method,exchange_order_id,created_by)
  VALUES(result_id,return_code,p_request,original.id,p_resolution,
    CASE p_resolution WHEN 'refund' THEN 'refunded' WHEN 'exchange' THEN 'exchanged' ELSE 'repair_pending' END,
    btrim(p_reason),p_payment_method,exchange_id,auth.uid());
  INSERT INTO public.defective_return_lines(return_id,original_order_item_id,finished_product_id,thaan_id,customer_tailoring_job_id,replacement_finished_product_id,quantity,unit,credit_paise,disposition,condition_note)
  VALUES(result_id,line.id,line.finished_product_id,line.thaan_id,line.customer_tailoring_job_id,replacement.id,p_quantity,
    CASE WHEN line.unit='mm' THEN 'm' WHEN line.customer_tailoring_job_id IS NOT NULL THEN 'job' ELSE 'pc' END,
    CASE WHEN p_resolution='repair' THEN 0 ELSE credit END,p_disposition,btrim(p_reason));
  IF p_resolution='refund' AND credit>0 THEN
    credit_code:='CN-'||upper(substr(replace(result_id::text,'-',''),1,10));
    INSERT INTO public.return_credit_notes(return_id,code,amount_paise,payment_method,created_by)
    VALUES(result_id,credit_code,credit,p_payment_method,auth.uid());
  END IF;
  INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference)
  VALUES(auth.uid(),'record_defective_return','defective_returns',result_id,
    jsonb_build_object('original_bill',original.id,'order_item',line.id,'quantity',p_quantity,'resolution',p_resolution,'disposition',p_disposition,'credit_paise',credit),return_code);
  RETURN jsonb_build_object('return_id',result_id,'code',return_code,'status',CASE p_resolution WHEN 'refund' THEN 'refunded' WHEN 'exchange' THEN 'exchanged' ELSE 'repair_pending' END,
    'credit_note',credit_code,'credit_paise',CASE WHEN p_resolution='refund' THEN credit ELSE 0 END,'exchange_bill',exchange_code);
END; $function$;

-- 3. The Owner's barcode scan shows each customer garment's CP (its share of the order's final cost).
CREATE OR REPLACE FUNCTION public.owner_barcode_inspect(p_barcode text, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_key text DEFAULT NULL::text, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE result jsonb;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501'; END IF;
 IF p_barcode IS NULL OR length(btrim(p_barcode)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Enter a barcode up to 200 characters'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR (p_before IS NULL)<>(p_before_key IS NULL) OR length(p_before_key)>300 THEN RAISE EXCEPTION 'Invalid history cursor or limit'; END IF;
 WITH root AS MATERIALIZED (
  SELECT 'fabric'::text kind, s.id FROM public.fabric_stock s JOIN public.barcodes b ON b.id=s.barcode_id WHERE b.code=btrim(p_barcode)
  UNION ALL SELECT 'legacy_thaan',id FROM public.thaans WHERE barcode=btrim(p_barcode)
  UNION ALL SELECT 'piece',p.id FROM public.finished_products p JOIN public.barcodes b ON b.id=p.barcode_id WHERE b.code=btrim(p_barcode)
  UNION ALL SELECT 'production',id FROM public.production_jobs WHERE code=public.resolve_document_scan_code(btrim(p_barcode)) OR id::text=btrim(p_barcode)
  UNION ALL SELECT 'order',id FROM public.orders WHERE code=public.resolve_document_scan_code(btrim(p_barcode)) OR id::text=btrim(p_barcode)
 UNION ALL SELECT 'customer_job',id FROM public.customer_tailoring_jobs WHERE code=public.resolve_document_scan_code(btrim(p_barcode)) OR id::text=btrim(p_barcode)
   UNION ALL SELECT 'customer_piece',c.id FROM public.customer_tailoring_finished_items c JOIN public.barcodes b ON b.id=c.barcode_id WHERE b.code=btrim(p_barcode)
 ), selected_thaans AS MATERIALIZED (
  SELECT DISTINCT t.* FROM public.thaans t WHERE
   EXISTS(SELECT 1 FROM root WHERE (kind='fabric' AND id=t.fabric_stock_id) OR (kind='legacy_thaan' AND id=t.id))
   OR t.id IN(SELECT l.thaan_id FROM public.material_issue_lines l JOIN public.material_issues i ON i.id=l.material_issue_id WHERE i.production_job_id IN(SELECT id FROM root WHERE kind='production') OR i.customer_tailoring_job_id IN(SELECT o.customer_tailoring_job_id FROM public.orders o WHERE o.id IN(SELECT id FROM root WHERE kind='order') UNION SELECT customer_tailoring_job_id FROM public.order_items WHERE order_id IN(SELECT id FROM root WHERE kind='order')))
   OR t.id IN(SELECT thaan_id FROM public.order_items WHERE order_id IN(SELECT id FROM root WHERE kind='order'))
 ), selected_stocks AS MATERIALIZED (
  SELECT s.* FROM public.fabric_stock s WHERE s.id IN(SELECT fabric_stock_id FROM selected_thaans) OR s.id IN(SELECT id FROM root WHERE kind='fabric')
 ), selected_pieces AS MATERIALIZED (
  SELECT p.* FROM public.finished_products p WHERE p.id IN(SELECT id FROM root WHERE kind='piece') OR p.production_job_id IN(SELECT id FROM root WHERE kind='production') OR p.id IN(SELECT finished_product_id FROM public.order_items WHERE order_id IN(SELECT id FROM root WHERE kind='order'))
 ), selected_jobs AS MATERIALIZED (
  SELECT j.* FROM public.production_jobs j WHERE j.id IN(SELECT id FROM root WHERE kind='production' UNION SELECT production_job_id FROM selected_pieces UNION SELECT i.production_job_id FROM public.material_issues i JOIN public.material_issue_lines l ON l.material_issue_id=i.id WHERE l.thaan_id IN(SELECT id FROM selected_thaans))
 ), selected_custom_jobs AS MATERIALIZED (
  SELECT j.* FROM public.customer_tailoring_jobs j WHERE j.id IN(SELECT id FROM root WHERE kind='customer_job' UNION SELECT job_id FROM public.customer_tailoring_finished_items WHERE id IN(SELECT id FROM root WHERE kind='customer_piece') UNION SELECT o.customer_tailoring_job_id FROM public.orders o WHERE o.id IN(SELECT id FROM root WHERE kind='order') UNION SELECT customer_tailoring_job_id FROM public.order_items WHERE order_id IN(SELECT id FROM root WHERE kind='order') UNION SELECT i.customer_tailoring_job_id FROM public.material_issues i JOIN public.material_issue_lines l ON l.material_issue_id=i.id WHERE l.thaan_id IN(SELECT id FROM selected_thaans) UNION SELECT customer_tailoring_job_id FROM public.inventory_movements WHERE thaan_id IN(SELECT id FROM selected_thaans))
 ), selected_issues AS MATERIALIZED (
  SELECT i.* FROM public.material_issues i WHERE i.production_job_id IN(SELECT id FROM selected_jobs) OR i.customer_tailoring_job_id IN(SELECT id FROM selected_custom_jobs)
 ), cost_stocks AS MATERIALIZED (
  SELECT s.* FROM public.fabric_stock s WHERE s.id IN(SELECT id FROM selected_stocks UNION SELECT fabric_stock_id FROM public.material_issue_lines WHERE material_issue_id IN(SELECT id FROM selected_issues))
 ), selected_orders AS MATERIALIZED (
  SELECT o.* FROM public.orders o WHERE o.id IN(SELECT id FROM root WHERE kind='order') OR o.id IN(SELECT order_id FROM public.order_items WHERE thaan_id IN(SELECT id FROM selected_thaans) OR finished_product_id IN(SELECT id FROM selected_pieces)) OR o.customer_tailoring_job_id IN(SELECT id FROM selected_custom_jobs) OR o.id IN(SELECT order_id FROM public.order_items WHERE customer_tailoring_job_id IN(SELECT id FROM selected_custom_jobs))
 ), selected_transfer_lines AS MATERIALIZED (
  SELECT l.* FROM public.stock_transfer_lines l WHERE l.thaan_id IN(SELECT id FROM selected_thaans) OR l.finished_product_id IN(SELECT id FROM selected_pieces)
 ), records AS MATERIALIZED (
 SELECT 'counter_bills:'||r.order_id AS key,'counter_bills'::text AS source,r.order_id AS record_id,(to_jsonb(r)->>'created_at')::timestamptz AS event_at,r.actor_id AS actor_id,'Counter bill recorded'::text AS title,to_jsonb(r)-'payload' AS data FROM public.counter_bills r WHERE order_id IN(SELECT id FROM selected_orders) UNION ALL
 SELECT 'counter_bill_payments:'||r.bill_id AS key,'counter_bill_payments'::text AS source,r.bill_id AS record_id,(to_jsonb(r)->>'paid_at')::timestamptz AS event_at,r.actor_id AS actor_id,'Counter payment collected'::text AS title,to_jsonb(r) AS data FROM public.counter_bill_payments r WHERE bill_id IN(SELECT id FROM selected_orders) UNION ALL
 SELECT 'counter_tailoring_details:'||r.job_id AS key,'counter_tailoring_details'::text AS source,r.job_id AS record_id,(to_jsonb(r)->>'recorded_at')::timestamptz AS event_at,NULL::uuid AS actor_id,'Customer tailoring delivery and design'::text AS title,to_jsonb(r) AS data FROM public.counter_tailoring_details r WHERE job_id IN(SELECT id FROM selected_custom_jobs) UNION ALL
 SELECT 'customer_issue_fabric_costs:'||r.issue_line_id AS key,'customer_issue_fabric_costs'::text AS source,r.issue_line_id AS record_id,(to_jsonb(r)->>'recorded_at')::timestamptz AS event_at,NULL::uuid AS actor_id,'Issue-time customer fabric CP'::text AS title,to_jsonb(r) AS data FROM public.customer_issue_fabric_costs r WHERE issue_line_id IN(SELECT id FROM public.material_issue_lines WHERE material_issue_id IN(SELECT id FROM selected_issues)) UNION ALL
 SELECT 'production_piece_specs:'||r.production_job_id||':'||r.piece_number AS key,'production_piece_specs'::text AS source,r.production_job_id AS record_id,(to_jsonb(r)->>'recorded_at')::timestamptz AS event_at,r.recorded_by AS actor_id,'Finished piece specification'::text AS title,to_jsonb(r) AS data FROM public.production_piece_specs r WHERE production_job_id IN(SELECT id FROM selected_jobs) UNION ALL


 SELECT 'barcodes:'||r.id AS key, 'barcodes'::text AS source, r.id AS record_id,
 (to_jsonb(r)->>'created_at')::timestamptz AS event_at,
 (to_jsonb(r)->>'created_by')::uuid AS actor_id,
 'Barcode registered'::text AS title, to_jsonb(r) AS data
 FROM public.barcodes r WHERE id IN (SELECT barcode_id FROM selected_stocks UNION SELECT barcode_id FROM selected_pieces)
 UNION ALL

 SELECT 'thaans:'||r.id AS key, 'thaans'::text AS source, r.id AS record_id,
 (to_jsonb(r)->>'created_at')::timestamptz AS event_at,
 (to_jsonb(r)->>'created_by')::uuid AS actor_id,
 'Thaan record'::text AS title, to_jsonb(r) AS data
 FROM public.thaans r WHERE id IN (SELECT id FROM selected_thaans)
 UNION ALL

 SELECT 'fabric_stock:'||r.id AS key, 'fabric_stock'::text AS source, r.id AS record_id,
 (to_jsonb(r)->>'created_at')::timestamptz AS event_at,
 (to_jsonb(r)->>'created_by')::uuid AS actor_id,
 'Fabric stock record'::text AS title, to_jsonb(r) AS data
 FROM public.fabric_stock r WHERE id IN (SELECT id FROM selected_stocks)
 UNION ALL

 SELECT 'receiving_batches:'||r.id AS key, 'receiving_batches'::text AS source, r.id AS record_id,
 (to_jsonb(r)->>'created_at')::timestamptz AS event_at,
 (to_jsonb(r)->>'created_by')::uuid AS actor_id,
 'Receiving batch'::text AS title, to_jsonb(r) AS data
 FROM public.receiving_batches r WHERE id IN (SELECT batch_id FROM selected_thaans)
 UNION ALL

 SELECT 'stock_registration_variants:'||r.id AS key, 'stock_registration_variants'::text AS source, r.id AS record_id,
 (to_jsonb(r)->>'created_at')::timestamptz AS event_at,
 (to_jsonb(r)->>'created_by')::uuid AS actor_id,
 'Physical barcode registered'::text AS title, to_jsonb(r) AS data
 FROM public.stock_registration_variants r WHERE thaan_id IN (SELECT id FROM selected_thaans)
 UNION ALL

 SELECT 'fabric_stock_costs:'||r.id AS key, 'fabric_stock_costs'::text AS source, r.id AS record_id,
 (to_jsonb(r)->>'recorded_at')::timestamptz AS event_at,
 (to_jsonb(r)->>'recorded_by')::uuid AS actor_id,
 'Fabric CP / lagat revision'::text AS title, to_jsonb(r) AS data
 FROM public.fabric_stock_costs r WHERE fabric_stock_id IN (SELECT id FROM cost_stocks)
 UNION ALL

 SELECT 'fabric_stock_prices:'||r.id AS key, 'fabric_stock_prices'::text AS source, r.id AS record_id,
 (to_jsonb(r)->>'recorded_at')::timestamptz AS event_at,
 (to_jsonb(r)->>'recorded_by')::uuid AS actor_id,
 'Fabric SP revision'::text AS title, to_jsonb(r) AS data
 FROM public.fabric_stock_prices r WHERE fabric_stock_id IN (SELECT id FROM selected_stocks)
 UNION ALL

 SELECT 'thaan_costs:'||r.thaan_id AS key, 'thaan_costs'::text AS source, r.thaan_id AS record_id,
 (to_jsonb(r)->>'updated_at')::timestamptz AS event_at,
 (to_jsonb(r)->>'updated_by')::uuid AS actor_id,
 'Legacy CP record (current saved value)'::text AS title, to_jsonb(r) AS data
 FROM public.thaan_costs r WHERE thaan_id IN (SELECT id FROM selected_thaans)
 UNION ALL

 SELECT 'material_issues:'||r.id AS key, 'material_issues'::text AS source, r.id AS record_id,
 (to_jsonb(r)->>'issued_at')::timestamptz AS event_at,
 (to_jsonb(r)->>'issued_by')::uuid AS actor_id,
 'Material issue'::text AS title, to_jsonb(r) AS data
 FROM public.material_issues r WHERE id IN (SELECT id FROM selected_issues)
 UNION ALL

 SELECT 'material_issue_lines:'||r.id AS key, 'material_issue_lines'::text AS source, r.id AS record_id,
 NULL::timestamptz AS event_at,
 NULL::uuid AS actor_id,
 'Issued material line'::text AS title, to_jsonb(r) AS data
 FROM public.material_issue_lines r WHERE material_issue_id IN (SELECT id FROM selected_issues)
 UNION ALL

 SELECT 'production_jobs:'||r.id AS key, 'production_jobs'::text AS source, r.id AS record_id,
 (to_jsonb(r)->>'created_at')::timestamptz AS event_at,
 (to_jsonb(r)->>'created_by')::uuid AS actor_id,
 'Linked production'::text AS title, to_jsonb(r) AS data
 FROM public.production_jobs r WHERE id IN (SELECT id FROM selected_jobs)
 UNION ALL

 SELECT 'production_status_events:'||r.id AS key, 'production_status_events'::text AS source, r.id AS record_id,
 (to_jsonb(r)->>'recorded_at')::timestamptz AS event_at,
 (to_jsonb(r)->>'actor_id')::uuid AS actor_id,
 'Production status recorded'::text AS title, to_jsonb(r) AS data
 FROM public.production_status_events r WHERE job_id IN (SELECT id FROM selected_jobs)
 UNION ALL

 SELECT 'finished_products:'||r.id AS key, 'finished_products'::text AS source, r.id AS record_id,
 (to_jsonb(r)->>'created_at')::timestamptz AS event_at,
 NULL::uuid AS actor_id,
 'Finished product record'::text AS title, to_jsonb(r) AS data
 FROM public.finished_products r WHERE id IN (SELECT id FROM selected_pieces)
 UNION ALL

 SELECT 'vendor_finished_product_receipts:'||r.id AS key, 'vendor_finished_product_receipts'::text AS source, r.id AS record_id,
 (to_jsonb(r)->>'created_at')::timestamptz AS event_at,
 (to_jsonb(r)->>'created_by')::uuid AS actor_id,
 'Vendor ready-made receipt'::text AS title, to_jsonb(r) AS data
 FROM public.vendor_finished_product_receipts r WHERE r.id IN(SELECT vendor_receipt_id FROM selected_pieces WHERE vendor_receipt_id IS NOT NULL)
 UNION ALL

 SELECT 'vendor_finished_product_receipt_pieces:'||r.finished_product_id AS key, 'vendor_finished_product_receipt_pieces'::text AS source, r.finished_product_id AS record_id,
 (to_jsonb(r)->>'created_at')::timestamptz AS event_at,
 NULL::uuid AS actor_id,
 'Vendor ready-made piece details'::text AS title, to_jsonb(r) AS data
 FROM public.vendor_finished_product_receipt_pieces r WHERE r.finished_product_id IN(SELECT id FROM selected_pieces)
 UNION ALL

 SELECT 'finished_product_receipts:'||r.request_id AS key, 'finished_product_receipts'::text AS source, r.request_id AS record_id,
 (to_jsonb(r)->>'recorded_at')::timestamptz AS event_at,
 (to_jsonb(r)->>'actor_id')::uuid AS actor_id,
 'Workshop finished receipt'::text AS title, to_jsonb(r) AS data
 FROM public.finished_product_receipts r WHERE production_job_id IN (SELECT id FROM selected_jobs)
 UNION ALL

 SELECT 'finished_product_materials:'||r.id AS key, 'finished_product_materials'::text AS source, r.id AS record_id,
 NULL::timestamptz AS event_at,
 NULL::uuid AS actor_id,
 'Recorded piece material allocation'::text AS title, to_jsonb(r) AS data
 FROM public.finished_product_materials r WHERE finished_product_id IN (SELECT id FROM selected_pieces)
 UNION ALL

 SELECT 'production_issue_fabric_costs:'||r.issue_line_id AS key, 'production_issue_fabric_costs'::text AS source, r.issue_line_id AS record_id,
 (to_jsonb(r)->>'recorded_at')::timestamptz AS event_at,
 NULL::uuid AS actor_id,
 'Issue-time fabric CP snapshot'::text AS title, to_jsonb(r) AS data
 FROM public.production_issue_fabric_costs r WHERE issue_line_id IN (SELECT id FROM material_issue_lines WHERE material_issue_id IN (SELECT id FROM selected_issues))
 UNION ALL

 SELECT 'production_cost_versions:'||r.id AS key, 'production_cost_versions'::text AS source, r.id AS record_id,
 (to_jsonb(r)->>'recorded_at')::timestamptz AS event_at,
 (to_jsonb(r)->>'recorded_by')::uuid AS actor_id,
 'Production cost revision'::text AS title, to_jsonb(r) AS data
 FROM public.production_cost_versions r WHERE production_job_id IN (SELECT id FROM selected_jobs)
 UNION ALL

 SELECT 'production_cost_lines:'||r.id AS key, 'production_cost_lines'::text AS source, r.id AS record_id,
 (to_jsonb(r)->>'recorded_at')::timestamptz AS event_at,
 NULL::uuid AS actor_id,
 'Recorded production cost component'::text AS title, to_jsonb(r) AS data
 FROM public.production_cost_lines r WHERE cost_version_id IN (SELECT id FROM production_cost_versions WHERE production_job_id IN (SELECT id FROM selected_jobs))
 UNION ALL

 SELECT 'finished_product_cost_allocations:'||r.id AS key, 'finished_product_cost_allocations'::text AS source, r.id AS record_id,
 (to_jsonb(r)->>'recorded_at')::timestamptz AS event_at,
 NULL::uuid AS actor_id,
 'Piece CP allocation'::text AS title, to_jsonb(r) AS data
 FROM public.finished_product_cost_allocations r WHERE finished_product_id IN (SELECT id FROM selected_pieces)
 UNION ALL

 SELECT 'finished_product_prices:'||r.id AS key, 'finished_product_prices'::text AS source, r.id AS record_id,
 (to_jsonb(r)->>'recorded_at')::timestamptz AS event_at,
 (to_jsonb(r)->>'recorded_by')::uuid AS actor_id,
 'Finished product SP revision'::text AS title, to_jsonb(r) AS data
 FROM public.finished_product_prices r WHERE finished_product_id IN (SELECT id FROM selected_pieces)
 UNION ALL

 SELECT 'stock_transfers:'||r.id AS key, 'stock_transfers'::text AS source, r.id AS record_id,
 (to_jsonb(r)->>'created_at')::timestamptz AS event_at,
 (to_jsonb(r)->>'created_by')::uuid AS actor_id,
 'Transfer document'::text AS title, to_jsonb(r) AS data
 FROM public.stock_transfers r WHERE id IN (SELECT transfer_id FROM selected_transfer_lines)
 UNION ALL

 SELECT 'stock_transfer_lines:'||r.id AS key, 'stock_transfer_lines'::text AS source, r.id AS record_id,
 NULL::timestamptz AS event_at,
 NULL::uuid AS actor_id,
 'Transferred item line'::text AS title, to_jsonb(r) AS data
 FROM public.stock_transfer_lines r WHERE id IN (SELECT id FROM selected_transfer_lines)
 UNION ALL

 SELECT 'customer_tailoring_jobs:'||r.id AS key, 'customer_tailoring_jobs'::text AS source, r.id AS record_id,
 (to_jsonb(r)->>'created_at')::timestamptz AS event_at,
 (to_jsonb(r)->>'created_by')::uuid AS actor_id,
 'Linked customer tailoring'::text AS title, to_jsonb(r) AS data
 FROM public.customer_tailoring_jobs r WHERE id IN (SELECT id FROM selected_custom_jobs)
 UNION ALL

 SELECT 'customer_tailoring_prices:'||r.id AS key, 'customer_tailoring_prices'::text AS source, r.id AS record_id,
 (to_jsonb(r)->>'recorded_at')::timestamptz AS event_at,
 (to_jsonb(r)->>'recorded_by')::uuid AS actor_id,
 'Recorded tailoring cost / price revision'::text AS title, to_jsonb(r) AS data
 FROM public.customer_tailoring_prices r WHERE job_id IN (SELECT id FROM selected_custom_jobs)
 UNION ALL

 SELECT 'counter_tailoring_prices:'||r.job_id AS key, 'counter_tailoring_prices'::text AS source, r.job_id AS record_id,
 (to_jsonb(r)->>'recorded_at')::timestamptz AS event_at,
 (to_jsonb(r)->>'recorded_by')::uuid AS actor_id,
 'Counter tailoring price snapshot'::text AS title, to_jsonb(r) AS data
 FROM public.counter_tailoring_prices r WHERE job_id IN (SELECT id FROM selected_custom_jobs)
 UNION ALL

 SELECT 'orders:'||r.id AS key, 'orders'::text AS source, r.id AS record_id,
 (to_jsonb(r)->>'created_at')::timestamptz AS event_at,
 (to_jsonb(r)->>'created_by')::uuid AS actor_id,
 'Linked order / bill'::text AS title, to_jsonb(r) AS data
 FROM public.orders r WHERE id IN (SELECT id FROM selected_orders)
 UNION ALL

 SELECT 'order_items:'||r.id AS key, 'order_items'::text AS source, r.id AS record_id,
 NULL::timestamptz AS event_at,
 NULL::uuid AS actor_id,
 'Linked order line'::text AS title, to_jsonb(r) AS data
 FROM public.order_items r WHERE order_id IN (SELECT id FROM selected_orders) AND (thaan_id IN (SELECT id FROM selected_thaans) OR finished_product_id IN (SELECT id FROM selected_pieces) OR customer_tailoring_job_id IN (SELECT id FROM selected_custom_jobs) OR EXISTS(SELECT 1 FROM root WHERE kind='order' AND id=order_id))
 UNION ALL

 SELECT 'order_item_financials:'||r.order_item_id AS key, 'order_item_financials'::text AS source, r.order_item_id AS record_id,
 (to_jsonb(r)->>'recorded_at')::timestamptz AS event_at,
 NULL::uuid AS actor_id,
 'Sale cost snapshot'::text AS title, to_jsonb(r) AS data
 FROM public.order_item_financials r WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id IN (SELECT id FROM selected_orders))
 UNION ALL

 SELECT 'finished_product_sale_snapshots:'||r.order_item_id AS key, 'finished_product_sale_snapshots'::text AS source, r.order_item_id AS record_id,
 (to_jsonb(r)->>'recorded_at')::timestamptz AS event_at,
 NULL::uuid AS actor_id,
 'Finished sale snapshot'::text AS title, to_jsonb(r) AS data
 FROM public.finished_product_sale_snapshots r WHERE order_item_id IN (SELECT id FROM order_items WHERE finished_product_id IN (SELECT id FROM selected_pieces))
 UNION ALL

 SELECT 'ecommerce_paid_receipts:'||r.order_id AS key, 'ecommerce_paid_receipts'::text AS source, r.order_id AS record_id,
 (to_jsonb(r)->>'recorded_at')::timestamptz AS event_at,
 NULL::uuid AS actor_id,
 'E-commerce payment receipt'::text AS title, to_jsonb(r) AS data
 FROM public.ecommerce_paid_receipts r WHERE order_id IN (SELECT id FROM selected_orders)
 UNION ALL

 SELECT 'sales:'||r.id AS key, 'sales'::text AS source, r.id AS record_id,
 (to_jsonb(r)->>'created_at')::timestamptz AS event_at,
 (to_jsonb(r)->>'user_id')::uuid AS actor_id,
 'Legacy sale'::text AS title, to_jsonb(r) AS data
 FROM public.sales r WHERE id IN (SELECT sale_id FROM sale_items WHERE thaan_id IN (SELECT id FROM selected_thaans))
 UNION ALL

 SELECT 'sale_items:'||r.id AS key, 'sale_items'::text AS source, r.id AS record_id,
 NULL::timestamptz AS event_at,
 NULL::uuid AS actor_id,
 'Legacy sale line'::text AS title, to_jsonb(r) AS data
 FROM public.sale_items r WHERE thaan_id IN (SELECT id FROM selected_thaans)
 UNION ALL

 SELECT 'tailoring_jobs:'||r.id AS key, 'tailoring_jobs'::text AS source, r.id AS record_id,
 (to_jsonb(r)->>'created_at')::timestamptz AS event_at,
 (to_jsonb(r)->>'created_by')::uuid AS actor_id,
 'Legacy tailoring record'::text AS title, to_jsonb(r) AS data
 FROM public.tailoring_jobs r WHERE id IN (SELECT job_id FROM tailoring_job_lines WHERE thaan_id IN (SELECT id FROM selected_thaans))
 UNION ALL

 SELECT 'tailoring_job_lines:'||r.id AS key, 'tailoring_job_lines'::text AS source, r.id AS record_id,
 (to_jsonb(r)->>'created_at')::timestamptz AS event_at,
 NULL::uuid AS actor_id,
 'Legacy tailoring material line'::text AS title, to_jsonb(r) AS data
 FROM public.tailoring_job_lines r WHERE thaan_id IN (SELECT id FROM selected_thaans)
 UNION ALL
 SELECT 'inventory_movements:'||m.id,'inventory_movements',m.id,m.occurred_at,m.actor_id,
 m.kind, to_jsonb(m)||jsonb_build_object('source_location',s.name,'destination_location',d.name,'transfer_code',tr.code,'order_code',o.code,'material_issue_code',i.code)
 FROM public.inventory_movements m LEFT JOIN public.locations s ON s.id=m.source_location_id LEFT JOIN public.locations d ON d.id=m.destination_location_id
 LEFT JOIN public.stock_transfer_lines tl ON tl.id=m.stock_transfer_line_id LEFT JOIN public.stock_transfers tr ON tr.id=tl.transfer_id
 LEFT JOIN public.order_items oi ON oi.id=m.order_item_id LEFT JOIN public.orders o ON o.id=oi.order_id
 LEFT JOIN public.material_issue_lines il ON il.id=m.material_issue_line_id LEFT JOIN public.material_issues i ON i.id=il.material_issue_id
 WHERE m.thaan_id IN(SELECT id FROM selected_thaans) OR m.finished_product_id IN(SELECT id FROM selected_pieces)
 UNION ALL
 SELECT 'stock_movements:'||m.id,'stock_movements',m.id,m.created_at,m.user_id,'Legacy '||m.kind,to_jsonb(m)
 FROM public.stock_movements m WHERE m.thaan_id IN(SELECT id FROM selected_thaans) AND NOT EXISTS(SELECT 1 FROM public.inventory_movements n WHERE n.legacy_stock_movement_id=m.id)
 UNION ALL SELECT 'customer_tailoring_finished_items:'||c.id,'customer_tailoring_finished_items',c.id,c.created_at,c.created_by,'Customer garment received',to_jsonb(c) FROM public.customer_tailoring_finished_items c WHERE c.job_id IN(SELECT id FROM selected_custom_jobs)
 ), evidence AS MATERIALIZED (
 SELECT * FROM records
 UNION ALL
 SELECT 'erp_audit_records:'||a.id,'erp_audit_records',a.id,a.occurred_at,a.actor_id,'Audit: '||a.action,to_jsonb(a)
 FROM public.erp_audit_records a WHERE EXISTS(SELECT 1 FROM records r WHERE r.source=a.entity_table AND r.record_id=a.entity_id)
 UNION ALL
 SELECT 'audit_log:'||a.id,'audit_log',a.id,a.created_at,a.actor_id,'Legacy audit: '||a.action,to_jsonb(a)
 FROM public.audit_log a WHERE a.entity_ref=btrim(p_barcode) OR EXISTS(SELECT 1 FROM records r WHERE
 (r.source=a.entity OR r.source=CASE a.entity WHEN 'thaan' THEN 'thaans' WHEN 'receiving_batch' THEN 'receiving_batches' WHEN 'sale' THEN 'sales' WHEN 'tailoring_job' THEN 'tailoring_jobs' WHEN 'order' THEN 'orders' WHEN 'production_job' THEN 'production_jobs' WHEN 'finished_product' THEN 'finished_products' WHEN 'material_issue' THEN 'material_issues' WHEN 'stock_transfer' THEN 'stock_transfers' ELSE a.entity END)
 AND a.entity_ref IN(r.record_id::text,r.data->>'code',r.data->>'barcode',r.data->>'bill_no'))
 ), dated AS MATERIALIZED (
 SELECT * FROM evidence WHERE event_at IS NOT NULL
 ), page AS MATERIALIZED (
 SELECT * FROM dated WHERE p_before IS NULL OR (event_at,key)<(p_before,p_before_key)
 ORDER BY event_at DESC,key DESC LIMIT p_limit
 ), current_stock AS (
 SELECT i.id inventory_item_id,i.thaan_id,i.finished_product_id,i.unit,
 coalesce((SELECT jsonb_agg(jsonb_build_object('location_id',b.location_id,'location',l.name,'location_kind',l.kind,'quantity',b.quantity::text,'unit',b.unit) ORDER BY l.code) FROM public.v_inventory_location_balances b JOIN public.locations l ON l.id=b.location_id WHERE b.inventory_item_id=i.id),'[]'::jsonb) locations
 FROM public.inventory_items i WHERE i.thaan_id IN(SELECT id FROM selected_thaans) OR i.finished_product_id IN(SELECT id FROM selected_pieces)
 ), item_details AS (
 SELECT jsonb_build_object('kind','fabric','id',t.id,'name',f.name,'barcode',coalesce(v.code,t.barcode,b.code),'batch',rb.code,'supplier',sp.name,'fabric_stock',to_jsonb(s),'thaan',to_jsonb(t),'legacy_cp_record',(SELECT to_jsonb(c) FROM public.thaan_costs c WHERE c.thaan_id=t.id),'unlocated_legacy_quantity_mm',CASE WHEN NOT EXISTS(SELECT 1 FROM public.inventory_items WHERE thaan_id=t.id) THEN (SELECT sum(delta_mm)::text FROM public.stock_movements WHERE thaan_id=t.id) END,'latest_cp_paise_per_m',(SELECT cp_paise_per_m::text FROM public.fabric_stock_costs WHERE fabric_stock_id=s.id ORDER BY revision DESC LIMIT 1)) data
 FROM selected_thaans t LEFT JOIN public.fabric_stock s ON s.id=t.fabric_stock_id LEFT JOIN public.barcodes b ON b.id=s.barcode_id LEFT JOIN public.stock_registration_variants v ON v.thaan_id=t.id LEFT JOIN public.fabrics f ON f.id=t.fabric_id LEFT JOIN public.receiving_batches rb ON rb.id=t.batch_id LEFT JOIN public.suppliers sp ON sp.id=rb.supplier_id
 UNION ALL SELECT jsonb_build_object('kind','finished_product','id',p.id,'name',product.name,'barcode',b.code,'design',public.production_piece_context(p.id)->>'design','size',public.production_piece_context(p.id)->>'size','production_code',j.code,'piece',to_jsonb(p),'latest_cp_paise',(SELECT a.amount_paise::text FROM public.finished_product_cost_allocations a JOIN public.production_cost_versions v ON v.id=a.cost_version_id WHERE a.finished_product_id=p.id ORDER BY v.revision DESC LIMIT 1),'latest_sp_paise',(SELECT sp_paise::text FROM public.finished_product_prices WHERE finished_product_id=p.id ORDER BY revision DESC LIMIT 1))
 FROM selected_pieces p JOIN public.barcodes b ON b.id=p.barcode_id JOIN public.products product ON product.id=p.product_id LEFT JOIN public.designs d ON d.id=p.design_id JOIN public.production_jobs j ON j.id=p.production_job_id
 UNION ALL SELECT jsonb_build_object('kind','customer_finished_garment','id',c.id,'name',c.name,'barcode',b.code,'size',c.size,'latest_sp_paise',c.sp_paise::text,'status',c.status,'job_id',c.job_id,'latest_cp_paise',(SELECT (CASE WHEN g.line_no<n.cnt THEN cc.total_cp_paise/n.cnt ELSE cc.total_cp_paise-(cc.total_cp_paise/n.cnt)*(n.cnt-1) END)::text FROM public.customer_tailoring_completion_costs cc JOIN public.customer_tailoring_garments g ON g.job_id=cc.job_id AND g.finished_item_id=c.id CROSS JOIN LATERAL (SELECT count(*)::int cnt FROM public.customer_tailoring_garments g2 WHERE g2.job_id=c.job_id) n WHERE cc.job_id=c.job_id)) FROM public.customer_tailoring_finished_items c JOIN public.barcodes b ON b.id=c.barcode_id WHERE c.id IN(SELECT id FROM root WHERE kind='customer_piece')
 )
 SELECT jsonb_build_object('barcode',btrim(p_barcode),'status',CASE WHEN (SELECT count(*) FROM root)=0 THEN 'unknown' WHEN (SELECT count(*) FROM root)>1 THEN 'ambiguous' ELSE 'found' END,
 'matches',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM root r),'[]'::jsonb),
 'items',coalesce((SELECT jsonb_agg(public.barcode_inspector_json(data) ORDER BY data->>'id') FROM item_details),'[]'::jsonb),
 'current_stock',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.inventory_item_id) FROM current_stock c),'[]'::jsonb),
 'linked_records',coalesce((SELECT jsonb_agg(jsonb_build_object('key',r.key,'source',r.source,'title',r.title,'event_at',r.event_at,'actor_id',r.actor_id,'actor',p.full_name,'data',public.barcode_inspector_json(r.data)) ORDER BY r.source,r.key) FROM records r LEFT JOIN public.profiles p ON p.id=r.actor_id WHERE r.source IN('production_jobs','customer_tailoring_jobs','orders','material_issues')),'[]'::jsonb),
 'undated_records',coalesce((SELECT jsonb_agg(jsonb_build_object('key',key,'source',source,'title',title,'data',public.barcode_inspector_json(data)) ORDER BY key) FROM evidence WHERE event_at IS NULL),'[]'::jsonb),
 'events',coalesce((SELECT jsonb_agg(jsonb_build_object('key',p.key,'source',p.source,'title',p.title,'event_at',p.event_at,'actor_id',p.actor_id,'actor',coalesce(p.data->>'actor_name',pr.full_name),'data',public.barcode_inspector_json(p.data)) ORDER BY p.event_at DESC,p.key DESC) FROM page p LEFT JOIN public.profiles pr ON pr.id=p.actor_id),'[]'::jsonb),
 'next_cursor',CASE WHEN EXISTS(SELECT 1 FROM dated d WHERE (d.event_at,d.key)<(SELECT event_at,key FROM page ORDER BY event_at,key LIMIT 1)) THEN (SELECT jsonb_build_object('before',event_at,'key',key) FROM page ORDER BY event_at,key LIMIT 1) ELSE NULL END,
 'total_events',(SELECT count(*) FROM dated),'inspected_at',statement_timestamp(),
 'history_note','Only recorded evidence is shown. Catalogue names and stock balances are current. Related job documents can cover other materials or pieces; they are not additional stock for this barcode. Missing previous values, costs, timestamps or users are not reconstructed.') INTO result;
 IF result->>'status'<>'found' THEN RETURN jsonb_build_object('barcode',btrim(p_barcode),'status',result->>'status','matches',result->'matches'); END IF;
 RETURN result;
END; $function$;

COMMIT;
