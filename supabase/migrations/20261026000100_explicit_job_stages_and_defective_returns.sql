BEGIN;

-- The operational status columns remain useful for permissions and work queues,
-- but these immutable events are the business authority for the three visible
-- stages shared by production and customer-stitching work.
CREATE TABLE public.job_workflow_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_kind text NOT NULL CHECK (job_kind IN ('production','customer_tailoring')),
  production_job_id uuid REFERENCES public.production_jobs(id),
  customer_tailoring_job_id uuid REFERENCES public.customer_tailoring_jobs(id),
  stage text NOT NULL CHECK (stage IN ('issued','work_recorded','finished_ready')),
  source_table text NOT NULL CHECK (btrim(source_table) <> ''),
  source_id uuid NOT NULL,
  actor_id uuid REFERENCES public.profiles(id),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK ((job_kind='production') = (production_job_id IS NOT NULL)),
  CHECK ((job_kind='customer_tailoring') = (customer_tailoring_job_id IS NOT NULL)),
  UNIQUE(source_table,source_id,stage)
);
CREATE UNIQUE INDEX job_workflow_production_stage_once
  ON public.job_workflow_events(production_job_id,stage) WHERE production_job_id IS NOT NULL;
CREATE UNIQUE INDEX job_workflow_customer_stage_once
  ON public.job_workflow_events(customer_tailoring_job_id,stage) WHERE customer_tailoring_job_id IS NOT NULL;
CREATE INDEX job_workflow_event_time ON public.job_workflow_events(occurred_at DESC,id DESC);

ALTER TABLE public.job_workflow_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_workflow_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.job_workflow_events TO authenticated;
GRANT ALL ON public.job_workflow_events TO service_role;
CREATE POLICY job_workflow_events_read ON public.job_workflow_events FOR SELECT TO authenticated
USING (
  public.has_any_role(auth.uid(),ARRAY['owner','stock_entry','production','tailor','tailor_staff','counter'])
  OR public.has_perm(auth.uid(),'inventory.view')
);
CREATE TRIGGER job_workflow_events_immutable BEFORE UPDATE OR DELETE ON public.job_workflow_events
FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();

CREATE FUNCTION public.capture_job_workflow_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p_job uuid; c_job uuid; event_stage text; event_time timestamptz; event_actor uuid; source uuid;
BEGIN
  IF TG_TABLE_NAME='material_issues' THEN
    p_job:=NEW.production_job_id; c_job:=NEW.customer_tailoring_job_id; event_stage:='issued';
    event_time:=NEW.issued_at; event_actor:=NEW.issued_by; source:=NEW.id;
  ELSIF TG_TABLE_NAME='job_material_consumptions' THEN
    IF NEW.reversed_at IS NOT NULL THEN RETURN NEW; END IF;
    p_job:=NEW.production_job_id; c_job:=NEW.customer_tailoring_job_id; event_stage:='work_recorded';
    event_time:=NEW.submitted_at; event_actor:=NEW.submitted_by; source:=NEW.id;
  ELSIF TG_TABLE_NAME='finished_product_receipts' THEN
    p_job:=NEW.production_job_id; event_stage:='finished_ready';
    event_time:=NEW.recorded_at; event_actor:=NEW.actor_id; source:=NEW.request_id;
  ELSIF TG_TABLE_NAME='customer_tailoring_finished_items' THEN
    c_job:=NEW.job_id; event_stage:='finished_ready';
    event_time:=NEW.created_at; event_actor:=NEW.created_by; source:=NEW.id;
  ELSE
    RETURN NEW;
  END IF;
  IF event_stage='work_recorded' AND NOT EXISTS(
    SELECT 1 FROM public.job_workflow_events e WHERE e.stage='issued'
      AND (e.production_job_id=p_job OR e.customer_tailoring_job_id=c_job)
  ) THEN RAISE EXCEPTION 'Issue the job before recording work'; END IF;
  IF event_stage='finished_ready' AND NOT EXISTS(
    SELECT 1 FROM public.job_workflow_events e WHERE e.stage='work_recorded'
      AND (e.production_job_id=p_job OR e.customer_tailoring_job_id=c_job)
  ) THEN RAISE EXCEPTION 'Master Tailor must record completed work before Workshop receipt'; END IF;
  INSERT INTO public.job_workflow_events(
    job_kind,production_job_id,customer_tailoring_job_id,stage,source_table,source_id,actor_id,occurred_at
  ) VALUES (
    CASE WHEN p_job IS NOT NULL THEN 'production' ELSE 'customer_tailoring' END,
    p_job,c_job,event_stage,TG_TABLE_NAME,source,event_actor,event_time
  ) ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.capture_job_workflow_event() FROM PUBLIC,anon,authenticated;

CREATE TRIGGER material_issue_workflow_stage AFTER INSERT ON public.material_issues
FOR EACH ROW EXECUTE FUNCTION public.capture_job_workflow_event();
CREATE TRIGGER material_consumption_workflow_stage AFTER INSERT ON public.job_material_consumptions
FOR EACH ROW EXECUTE FUNCTION public.capture_job_workflow_event();
CREATE TRIGGER production_receipt_workflow_stage AFTER INSERT ON public.finished_product_receipts
FOR EACH ROW EXECUTE FUNCTION public.capture_job_workflow_event();
CREATE TRIGGER customer_receipt_workflow_stage AFTER INSERT ON public.customer_tailoring_finished_items
FOR EACH ROW EXECUTE FUNCTION public.capture_job_workflow_event();

-- Backfill the same immutable evidence so old and new jobs use one definition.
INSERT INTO public.job_workflow_events(job_kind,production_job_id,customer_tailoring_job_id,stage,source_table,source_id,actor_id,occurred_at)
SELECT job_kind,production_job_id,customer_tailoring_job_id,'issued','material_issues',id,issued_by,issued_at FROM (
  SELECT DISTINCT ON (coalesce(production_job_id,customer_tailoring_job_id))
    CASE WHEN production_job_id IS NOT NULL THEN 'production' ELSE 'customer_tailoring' END job_kind,
    production_job_id,customer_tailoring_job_id,id,issued_by,issued_at
  FROM public.material_issues ORDER BY coalesce(production_job_id,customer_tailoring_job_id),issued_at,id
) first_issue ON CONFLICT DO NOTHING;
INSERT INTO public.job_workflow_events(job_kind,production_job_id,customer_tailoring_job_id,stage,source_table,source_id,actor_id,occurred_at)
SELECT job_kind,production_job_id,customer_tailoring_job_id,'work_recorded','job_material_consumptions',id,submitted_by,submitted_at FROM (
  SELECT DISTINCT ON (coalesce(production_job_id,customer_tailoring_job_id))
    CASE WHEN production_job_id IS NOT NULL THEN 'production' ELSE 'customer_tailoring' END job_kind,
    production_job_id,customer_tailoring_job_id,id,submitted_by,submitted_at
  FROM public.job_material_consumptions WHERE reversed_at IS NULL
  ORDER BY coalesce(production_job_id,customer_tailoring_job_id),submitted_at,id
) first_work ON CONFLICT DO NOTHING;
INSERT INTO public.job_workflow_events(job_kind,production_job_id,stage,source_table,source_id,actor_id,occurred_at)
SELECT 'production',production_job_id,'finished_ready','finished_product_receipts',request_id,actor_id,recorded_at
FROM public.finished_product_receipts ON CONFLICT DO NOTHING;
INSERT INTO public.job_workflow_events(job_kind,customer_tailoring_job_id,stage,source_table,source_id,actor_id,occurred_at)
SELECT 'customer_tailoring',job_id,'finished_ready','customer_tailoring_finished_items',id,created_by,created_at
FROM public.customer_tailoring_finished_items ON CONFLICT DO NOTHING;

CREATE FUNCTION public.job_workflow_stage(p_kind text,p_job uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
  IF p_kind NOT IN ('production','customer_tailoring') OR p_job IS NULL THEN
    RAISE EXCEPTION 'Production or customer-tailoring job required';
  END IF;
  SELECT jsonb_build_object(
    'job_kind',p_kind,'job_id',p_job,
    'current_stage',coalesce((array_agg(stage ORDER BY CASE stage WHEN 'issued' THEN 1 WHEN 'work_recorded' THEN 2 ELSE 3 END DESC))[1],'not_issued'),
    'stages',coalesce(jsonb_agg(jsonb_build_object('stage',stage,'occurred_at',occurred_at,'actor_id',actor_id,'source',source_table)
      ORDER BY occurred_at,id),'[]'::jsonb)
  ) INTO result
  FROM public.job_workflow_events
  WHERE (p_kind='production' AND production_job_id=p_job)
     OR (p_kind='customer_tailoring' AND customer_tailoring_job_id=p_job);
  RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.job_workflow_stage(text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.job_workflow_stage(text,uuid) TO authenticated;

-- Defects are kept separate from the permanent original sale. A credit note is
-- a new accounting record; it never rewrites the paid amount or original bill.
CREATE TABLE public.defective_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  request_id uuid NOT NULL UNIQUE,
  original_order_id uuid NOT NULL REFERENCES public.orders(id),
  resolution text NOT NULL CHECK (resolution IN ('refund','exchange','repair')),
  status text NOT NULL CHECK (status IN ('refunded','exchanged','repair_pending')),
  reason text NOT NULL CHECK (btrim(reason)<>''),
  payment_method text CHECK (payment_method IN ('cash','card','upi','bank_transfer','mixed')),
  exchange_order_id uuid REFERENCES public.orders(id),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.defective_return_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL REFERENCES public.defective_returns(id),
  original_order_item_id uuid NOT NULL REFERENCES public.order_items(id),
  finished_product_id uuid REFERENCES public.finished_products(id),
  thaan_id uuid REFERENCES public.thaans(id),
  customer_tailoring_job_id uuid REFERENCES public.customer_tailoring_jobs(id),
  replacement_finished_product_id uuid REFERENCES public.finished_products(id),
  quantity numeric(18,3) NOT NULL CHECK(quantity>0),
  unit text NOT NULL CHECK(unit IN ('pc','m','job')),
  credit_paise bigint NOT NULL CHECK(credit_paise>=0),
  disposition text NOT NULL CHECK(disposition IN ('quarantine','depleted','repair','fabric_remnant')),
  condition_note text,
  CHECK(num_nonnulls(finished_product_id,thaan_id,customer_tailoring_job_id)=1),
  CHECK((finished_product_id IS NULL) OR (unit='pc' AND quantity=1)),
  CHECK((thaan_id IS NULL) OR unit='m'),
  CHECK((customer_tailoring_job_id IS NULL) OR (unit='job' AND quantity=1)),
  UNIQUE(return_id,original_order_item_id)
);
CREATE UNIQUE INDEX defective_finished_return_once ON public.defective_return_lines(finished_product_id)
WHERE finished_product_id IS NOT NULL;
CREATE TABLE public.return_credit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL UNIQUE REFERENCES public.defective_returns(id),
  code text NOT NULL UNIQUE,
  amount_paise bigint NOT NULL CHECK(amount_paise>0),
  payment_method text NOT NULL CHECK(payment_method IN ('cash','card','upi','bank_transfer','mixed')),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.defective_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.defective_return_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.return_credit_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.defective_returns,public.defective_return_lines,public.return_credit_notes FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.defective_returns,public.defective_return_lines,public.return_credit_notes TO authenticated;
GRANT ALL ON public.defective_returns,public.defective_return_lines,public.return_credit_notes TO service_role;
CREATE POLICY defective_returns_read ON public.defective_returns FOR SELECT TO authenticated USING(public.has_any_role(auth.uid(),ARRAY['owner','counter','stock_entry']));
CREATE POLICY defective_return_lines_read ON public.defective_return_lines FOR SELECT TO authenticated USING(public.has_any_role(auth.uid(),ARRAY['owner','counter','stock_entry']));
CREATE POLICY return_credit_notes_read ON public.return_credit_notes FOR SELECT TO authenticated USING(public.has_any_role(auth.uid(),ARRAY['owner','counter']));
CREATE TRIGGER defective_returns_immutable BEFORE UPDATE OR DELETE ON public.defective_returns FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();
CREATE TRIGGER defective_return_lines_immutable BEFORE UPDATE OR DELETE ON public.defective_return_lines FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();
CREATE TRIGGER return_credit_notes_immutable BEFORE UPDATE OR DELETE ON public.return_credit_notes FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();

CREATE FUNCTION public.record_defective_return(
  p_request uuid,p_original_bill uuid,p_order_item uuid,p_quantity numeric,
  p_resolution text,p_disposition text,p_reason text,p_replacement_barcode text DEFAULT NULL,
  p_salesperson uuid DEFAULT NULL,p_payment_method text DEFAULT 'cash'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
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
END; $$;
REVOKE ALL ON FUNCTION public.record_defective_return(uuid,uuid,uuid,numeric,text,text,text,text,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_defective_return(uuid,uuid,uuid,numeric,text,text,text,text,uuid,text) TO authenticated;

-- Transit now reads the explicit event authority rather than inferring stage
-- directly from the existence of consumption rows.
CREATE OR REPLACE FUNCTION public.factory_transit_inventory()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.has_any_role(auth.uid(),ARRAY['owner','stock_entry'])
     AND NOT public.has_perm(auth.uid(),'inventory.view') THEN
    RAISE EXCEPTION 'Authorized inventory role required';
  END IF;
  WITH fabric_rows AS (
    SELECT f.id factory_id,f.code factory_code,f.name factory_name,
      line.id row_id,'fabric'::text item_type,coalesce(v.code,t.barcode,b.code) barcode,
      fb.name item_name,rb.code batch_code,line.quantity::text quantity,line.unit,
      CASE WHEN issue.production_job_id IS NOT NULL THEN 'production' ELSE 'customer_order' END purpose,
      coalesce(p.code,c.code) reference,issue.issued_at,
      coalesce((SELECT e.stage FROM public.job_workflow_events e
        WHERE e.production_job_id=issue.production_job_id OR e.customer_tailoring_job_id=issue.customer_tailoring_job_id
        ORDER BY CASE e.stage WHEN 'issued' THEN 1 WHEN 'work_recorded' THEN 2 ELSE 3 END DESC LIMIT 1),'issued') stage,
      issue.production_job_id,issue.customer_tailoring_job_id,tailor.real_name tailor_name
    FROM public.material_issue_lines line
    JOIN public.material_issues issue ON issue.id=line.material_issue_id
    JOIN public.tailor_assignments assignment ON assignment.id=issue.tailor_assignment_id
    JOIN public.tailoring_factories f ON f.id=assignment.factory_id
    JOIN public.tailors tailor ON tailor.id=assignment.tailor_id
    JOIN public.thaans t ON t.id=line.thaan_id
    JOIN public.fabric_stock fs ON fs.id=t.fabric_stock_id
    JOIN public.fabrics fb ON fb.id=fs.fabric_id
    JOIN public.receiving_batches rb ON rb.id=fs.batch_id
    LEFT JOIN public.barcodes b ON b.id=fs.barcode_id
    LEFT JOIN public.stock_registration_variants v ON v.thaan_id=t.id
    LEFT JOIN public.production_jobs p ON p.id=issue.production_job_id
    LEFT JOIN public.customer_tailoring_jobs c ON c.id=issue.customer_tailoring_job_id
    WHERE line.thaan_id IS NOT NULL
      AND (p.id IS NULL OR (p.status<>'cancelled' AND NOT EXISTS(SELECT 1 FROM public.finished_product_receipts receipt WHERE receipt.production_job_id=p.id)))
      AND (c.id IS NULL OR (c.status NOT IN ('delivered','cancelled') AND NOT EXISTS(SELECT 1 FROM public.customer_tailoring_finished_items finished WHERE finished.job_id=c.id)))
  ), unit_rows AS (
    SELECT f.id factory_id,f.code factory_code,f.name factory_name,u.id row_id,'material'::text item_type,
      u.barcode,m.name item_name,mb.code batch_code,u.remaining_quantity::text quantity,u.unit,'custody'::text purpose,
      tailor.code reference,u.received_at issued_at,'master_tailor_stock'::text stage,
      NULL::uuid production_job_id,NULL::uuid customer_tailoring_job_id,tailor.real_name tailor_name
    FROM public.material_units u
    JOIN public.materials m ON m.id=u.material_id
    JOIN public.material_batches mb ON mb.id=u.batch_id
    JOIN public.tailoring_factories f ON f.id=u.assigned_factory_id
    JOIN public.tailors tailor ON tailor.id=u.assigned_tailor_id
    WHERE u.remaining_quantity>0
  ), rows AS (
    SELECT * FROM fabric_rows UNION ALL SELECT * FROM unit_rows
  ), factories AS (
    SELECT r.factory_id,r.factory_code,r.factory_name,
      coalesce(sum(CASE WHEN r.item_type='fabric' AND lower(r.unit)='mm' THEN r.quantity::numeric ELSE 0 END),0) fabric_mm,
      count(*) FILTER(WHERE r.item_type='fabric') fabric_lines,
      count(*) FILTER(WHERE r.item_type='material') material_units,
      count(DISTINCT r.production_job_id) production_jobs,
      count(DISTINCT r.customer_tailoring_job_id) customer_orders,
      jsonb_agg(jsonb_build_object('id',r.row_id,'item_type',r.item_type,'barcode',r.barcode,'item',r.item_name,
        'batch',r.batch_code,'quantity',r.quantity,'unit',r.unit,'purpose',r.purpose,'reference',r.reference,
        'issued_at',r.issued_at,'stage',r.stage,'tailor',r.tailor_name) ORDER BY r.issued_at DESC,r.row_id DESC) items
    FROM rows r GROUP BY r.factory_id,r.factory_code,r.factory_name
  )
  SELECT jsonb_build_object(
    'total_fabric_mm',coalesce((SELECT sum(fabric_mm) FROM factories),0)::text,
    'factories_count',(SELECT count(*) FROM factories),
    'fabric_lines',coalesce((SELECT sum(fabric_lines) FROM factories),0),
    'material_units',coalesce((SELECT sum(material_units) FROM factories),0),
    'production_jobs',coalesce((SELECT sum(production_jobs) FROM factories),0),
    'customer_orders',coalesce((SELECT sum(customer_orders) FROM factories),0),
    'factories',coalesce((SELECT jsonb_agg(jsonb_build_object('id',factory_id,'code',factory_code,'name',factory_name,
      'fabric_mm',fabric_mm::text,'fabric_lines',fabric_lines,'material_units',material_units,
      'production_jobs',production_jobs,'customer_orders',customer_orders,'items',items) ORDER BY factory_name)
      FROM factories),'[]'::jsonb)
  ) INTO result;
  RETURN result;
END; $$;

NOTIFY pgrst,'reload schema';
COMMIT;
