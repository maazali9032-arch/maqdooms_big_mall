BEGIN;

-- Resolve an item without asking the cashier to choose a floor. The recorded
-- ledger location travels with the scanned line instead.
CREATE FUNCTION public.counter_scan_barcode_any(p_barcode text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE data jsonb; piece public.finished_products%rowtype; variants jsonb; exact jsonb; source_name text;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) THEN RAISE EXCEPTION 'Counter access required'; END IF;
 SELECT p.* INTO piece FROM public.finished_products p JOIN public.barcodes b ON b.id=p.barcode_id WHERE b.code=btrim(p_barcode);
 IF FOUND THEN
  data:=public.finished_product_sale_scan(btrim(p_barcode));
  SELECT l.name INTO source_name FROM public.locations l JOIN public.locations parent ON parent.id=l.parent_id AND parent.active AND parent.kind='showroom' WHERE l.id=piece.current_location_id AND l.active AND l.kind='showroom_sublocation';
  RETURN jsonb_build_object('kind','product','id',piece.id,'barcode',p_barcode,'name',data->>'product','design',public.production_piece_context(piece.id)->>'design','size',public.production_piece_context(piece.id)->>'size','sp_paise',data->'sp_paise','sp_version_id',data->>'sp_version_id','source_location_id',piece.current_location_id,'source_name',source_name,'available',piece.status='available' AND source_name IS NOT NULL AND coalesce((SELECT public.inventory_balance(i.id,piece.current_location_id) FROM public.inventory_items i WHERE i.finished_product_id=piece.id),0)=1);
 END IF;
 variants:=public.pos_reserve_variants(btrim(p_barcode));
 SELECT value INTO exact FROM jsonb_array_elements(variants) WHERE value->>'barcode'=btrim(p_barcode) LIMIT 1;
 IF exact IS NULL THEN SELECT value INTO exact FROM jsonb_array_elements(public.direct_fabric_sale_catalog(btrim(p_barcode))) LIMIT 1; END IF;
 IF exact IS NULL THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('kind','fabric','barcode',exact->>'barcode','name',exact->>'fabric_name','batch',exact->>'batch_code','cuts',exact->'cuts','variants',variants);
END; $$;

CREATE FUNCTION public.book_invoice_tailoring_multi(p_request uuid,p_items jsonb,p_final_price bigint,p_customer uuid,p_assignment uuid,p_salesperson uuid,p_garment text,p_notes text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j public.customer_tailoring_jobs%rowtype; payload jsonb; r jsonb; th public.thaans%rowtype; cp bigint; cost_id uuid; qty numeric; amount numeric; total numeric:=0; known boolean:=true; cuts jsonb:='[]'; v_job uuid:=gen_random_uuid(); v_order uuid:=gen_random_uuid(); v_issue uuid; v_line uuid; v_item uuid; contact jsonb; header_source uuid; source_row record;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) OR NOT public.has_perm(auth.uid(),'pos.issue_to_tailoring') OR NOT public.has_perm(auth.uid(),'pos.assign_salesperson') OR NOT public.has_perm(auth.uid(),'pos.enter_tailoring_total') THEN RAISE EXCEPTION 'Authorized Counter tailoring booking required'; END IF;
 IF p_request IS NULL OR nullif(btrim(p_garment),'') IS NULL OR p_final_price IS NULL OR p_final_price NOT BETWEEN 0 AND 9007199254740991 OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Request, cuts, garment and exact final total required'; END IF;
 IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE jsonb_typeof(x) IS DISTINCT FROM 'object' OR (x-ARRAY['inventory_item_id','quantity','source_location_id'])<>'{}' OR nullif(x->>'source_location_id','') IS NULL) THEN RAISE EXCEPTION 'One to fifty explicit located cuts required'; END IF;
 payload:=jsonb_build_object('items',p_items,'final_price',p_final_price,'customer',p_customer,'assignment',p_assignment,'salesperson',p_salesperson,'garment',btrim(p_garment),'notes',nullif(btrim(p_notes),''));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,7));
 SELECT * INTO j FROM public.customer_tailoring_jobs WHERE request_id=p_request;
 IF FOUND THEN IF j.request_payload IS DISTINCT FROM payload OR (j.created_by IS DISTINCT FROM auth.uid() AND NOT public.has_role(auth.uid(),'owner')) THEN RAISE EXCEPTION 'Request reused with different data or actor'; END IF; RETURN j.id; END IF;
 PERFORM public.require_salesperson(p_salesperson);
 IF p_customer IS NULL THEN contact:=jsonb_build_object('name',NULL,'phone',NULL); ELSE SELECT jsonb_build_object('id',id,'name',name,'phone',phone,'whatsapp_phone',whatsapp_phone) INTO contact FROM public.customers WHERE id=p_customer FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Customer required'; END IF; END IF;
 PERFORM 1 FROM public.tailor_assignments a JOIN public.tailors t ON t.id=a.tailor_id JOIN public.tailoring_factories f ON f.id=a.factory_id LEFT JOIN public.tailoring_sections s ON s.id=a.section_id WHERE a.id=p_assignment AND a.valid_until IS NULL AND a.valid_from<=now() AND t.active AND f.active AND (s.id IS NULL OR s.active) AND (t.profile_id IS NULL OR public.has_role(t.profile_id,'tailor')) FOR UPDATE OF a,t,f;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active Factory / Section / Tailor required'; END IF;
 PERFORM 1 FROM public.fabric_stock s WHERE s.id IN(SELECT t.fabric_stock_id FROM public.thaans t JOIN public.inventory_items i ON i.thaan_id=t.id JOIN jsonb_array_elements(p_items) x ON i.id=(x->>'inventory_item_id')::uuid) ORDER BY s.id FOR UPDATE;
 PERFORM 1 FROM public.inventory_items i JOIN jsonb_array_elements(p_items) x ON i.id=(x->>'inventory_item_id')::uuid ORDER BY i.id FOR UPDATE OF i;
 PERFORM 1 FROM public.locations l JOIN public.locations parent ON parent.id=l.parent_id AND parent.active AND parent.kind='showroom' WHERE l.id IN(SELECT (x->>'source_location_id')::uuid FROM jsonb_array_elements(p_items) x) AND l.active AND l.kind='showroom_sublocation' FOR UPDATE OF l;
 IF (SELECT count(DISTINCT x->>'source_location_id') FROM jsonb_array_elements(p_items) x)<>(SELECT count(DISTINCT l.id::text) FROM public.locations l JOIN public.locations parent ON parent.id=l.parent_id AND parent.active AND parent.kind='showroom' WHERE l.id IN(SELECT (x->>'source_location_id')::uuid FROM jsonb_array_elements(p_items) x) AND l.active AND l.kind='showroom_sublocation') THEN RAISE EXCEPTION 'Every fabric cut requires an active Showroom floor'; END IF;
 SELECT (x->>'source_location_id')::uuid INTO header_source FROM jsonb_array_elements(p_items) x LIMIT 1;
 FOR r IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY value->>'inventory_item_id',value->>'source_location_id' LOOP
  qty:=(r->>'quantity')::numeric;
  IF qty IS NULL OR qty<=0 OR qty<>trunc(qty) OR qty>2147483647 THEN RAISE EXCEPTION 'Positive exact millimetres required'; END IF;
  SELECT t.* INTO th FROM public.thaans t JOIN public.inventory_items i ON i.thaan_id=t.id JOIN public.fabric_stock s ON s.id=t.fabric_stock_id WHERE i.id=(r->>'inventory_item_id')::uuid AND i.unit='mm' AND t.status='active' AND s.entry_state IN('complete','correcting','legacy_pending');
  IF NOT FOUND OR qty>public.inventory_balance((r->>'inventory_item_id')::uuid,(r->>'source_location_id')::uuid) THEN RAISE EXCEPTION 'Insufficient active fabric at its recorded Showroom floor'; END IF;
  SELECT id,cp_paise_per_m INTO cost_id,cp FROM public.fabric_stock_costs WHERE fabric_stock_id=th.fabric_stock_id ORDER BY revision DESC LIMIT 1;
  amount:=CASE WHEN cp IS NOT NULL THEN round(qty*cp/1000) END;
  IF amount>9007199254740991 OR total+coalesce(amount,0)>9007199254740991 THEN RAISE EXCEPTION 'Internal cost exceeds supported range'; END IF;
  total:=total+coalesce(amount,0); IF cp IS NULL THEN known:=false; END IF;
  cuts:=cuts||jsonb_build_array(jsonb_build_object('inventory_item_id',r->>'inventory_item_id','source_location_id',r->>'source_location_id','fabric_stock_id',th.fabric_stock_id,'thaan_id',th.id,'quantity',qty,'cost_version_id',cost_id,'cp_paise_per_m',cp,'cp_amount_paise',amount));
 END LOOP;
 INSERT INTO public.customer_tailoring_jobs(id,code,customer_id,garment,tailor_assignment_id,status,notes,created_by,request_id,request_payload,salesperson_user_id) VALUES(v_job,'CT-'||replace(v_job::text,'-',''),p_customer,btrim(p_garment),p_assignment,'open',nullif(btrim(p_notes),''),auth.uid(),p_request,payload,p_salesperson);
 INSERT INTO public.counter_tailoring_prices(job_id,final_customer_price_paise,fabric_cp_total_paise,cuts,recorded_by) VALUES(v_job,p_final_price,CASE WHEN known THEN total END,cuts,auth.uid());
 INSERT INTO public.job_material_requirements(customer_tailoring_job_id,fabric_stock_id,quantity,unit) SELECT v_job,(x->>'fabric_stock_id')::uuid,sum((x->>'quantity')::numeric),'mm' FROM jsonb_array_elements(cuts) x GROUP BY x->>'fabric_stock_id';
 FOR source_row IN SELECT DISTINCT (x->>'source_location_id')::uuid id FROM jsonb_array_elements(cuts) x LOOP
  INSERT INTO public.material_issues(code,customer_tailoring_job_id,tailor_assignment_id,source_location_id,issue_type,reason,issued_by) VALUES('MI-'||replace(gen_random_uuid()::text,'-',''),v_job,p_assignment,source_row.id,'required','Required material for Customer Tailoring',auth.uid()) RETURNING id INTO v_issue;
  FOR r IN SELECT value FROM jsonb_array_elements(cuts) WHERE value->>'source_location_id'=source_row.id::text ORDER BY value->>'inventory_item_id' LOOP
   INSERT INTO public.material_issue_lines(material_issue_id,fabric_stock_id,thaan_id,quantity,unit) VALUES(v_issue,(r->>'fabric_stock_id')::uuid,(r->>'thaan_id')::uuid,(r->>'quantity')::numeric,'mm') RETURNING id INTO v_line;
   INSERT INTO public.inventory_movements(kind,fabric_stock_id,thaan_id,inventory_item_id,quantity,unit,source_location_id,material_issue_line_id,customer_tailoring_job_id,reason,reference,actor_id) VALUES('MATERIAL_ISSUE',(r->>'fabric_stock_id')::uuid,(r->>'thaan_id')::uuid,(r->>'inventory_item_id')::uuid,(r->>'quantity')::numeric,'mm',source_row.id,v_line,v_job,'Required material for Customer Tailoring','JOB:'||v_job::text,auth.uid());
   IF public.inventory_balance((r->>'inventory_item_id')::uuid,NULL)=0 THEN UPDATE public.thaans SET status='depleted',updated_at=now() WHERE id=(r->>'thaan_id')::uuid; END IF;
  END LOOP;
 END LOOP;
 INSERT INTO public.orders(id,code,kind,customer_id,customer_tailoring_job_id,source_location_id,status,final_customer_price_paise,created_by,customer_snapshot,completed_at,tailoring_request_id,reference,salesperson_user_id) VALUES(v_order,'CT-ORDER-'||replace(v_job::text,'-',''),'customer_tailoring',p_customer,v_job,header_source,'draft',p_final_price,auth.uid(),contact,now(),p_request,'JOB:'||v_job::text,p_salesperson);
 INSERT INTO public.order_items(order_id,customer_tailoring_job_id,quantity,unit,final_customer_price_paise) VALUES(v_order,v_job,1,'job',p_final_price) RETURNING id INTO v_item;
 INSERT INTO public.order_item_financials(order_item_id,cp_snapshot_paise) VALUES(v_item,CASE WHEN known THEN total END);
 UPDATE public.orders SET status='completed' WHERE id=v_order;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference) VALUES(auth.uid(),'book_invoice_tailoring_multi','customer_tailoring_jobs',v_job,jsonb_build_object('order_id',v_order,'final_customer_price_paise',p_final_price,'salesperson',p_salesperson),'REQUEST:'||p_request::text);
 RETURN v_job;
END; $$;

CREATE FUNCTION public.complete_counter_bill_multi(p_request uuid,p_items jsonb,p_tailoring jsonb,p_paid boolean,p_salesperson uuid,p_customer uuid DEFAULT NULL,p_name text DEFAULT NULL,p_contact text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result uuid:=gen_random_uuid(); saved public.counter_bills%rowtype; payload_value jsonb; customer_id uuid; contact jsonb; row_value jsonb; booked_job uuid; item_id uuid; inv uuid; th public.thaans%rowtype; piece public.finished_products%rowtype; price public.finished_product_prices%rowtype; qty numeric; sp bigint; amount bigint; cp bigint; total numeric:=0; cost_id uuid; reviewed_id uuid; cost_amount bigint; evidence jsonb; group_price bigint; fabric_amount numeric; stitching bigint; priced_cuts jsonb; plain_cuts jsonb; priced_cut jsonb; row_source uuid; header_source uuid; terminal uuid;
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) OR NOT public.has_perm(auth.uid(),'pos.sell') THEN RAISE EXCEPTION 'Counter billing permission required'; END IF;
 IF p_request IS NULL OR p_paid IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_typeof(p_tailoring) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items)+jsonb_array_length(p_tailoring) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Request, payment state and 1–100 bill entries required'; END IF;
 IF NOT p_paid AND jsonb_array_length(p_tailoring)=0 THEN RAISE EXCEPTION 'Unpaid is available only on bills containing Customer Tailoring'; END IF;
 IF NOT public.has_role(auth.uid(),'owner') THEN SELECT id INTO terminal FROM public.pos_terminals WHERE assigned_user_id=auth.uid() AND active; IF terminal IS NULL THEN RAISE EXCEPTION 'This Counter account has no active POS terminal code. Ask the Owner to assign one in Administration.'; END IF; END IF;
 payload_value:=jsonb_build_object('actor',auth.uid(),'items',p_items,'tailoring',p_tailoring,'paid',p_paid,'salesperson',p_salesperson,'customer',p_customer,'name',nullif(btrim(p_name),''),'contact',nullif(btrim(p_contact),''));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,6));
 SELECT * INTO saved FROM public.counter_bills WHERE request_id=p_request;
 IF FOUND THEN IF saved.payload IS DISTINCT FROM payload_value THEN RAISE EXCEPTION 'Bill retry requires identical data'; END IF; RETURN saved.order_id; END IF;
 PERFORM public.require_salesperson(p_salesperson);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE jsonb_typeof(x) IS DISTINCT FROM 'object' OR coalesce(x->>'kind','') NOT IN('fabric','product') OR nullif(x->>'source_location_id','') IS NULL OR (x->>'kind'='fabric' AND (x-ARRAY['kind','inventory_item_id','quantity','sp_paise_per_m','source_location_id'])<>'{}') OR (x->>'kind'='product' AND (x-ARRAY['kind','piece_id','sp_version_id','source_location_id'])<>'{}')) THEN RAISE EXCEPTION 'Only explicit located fabric cuts or saved-price pieces accepted'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_tailoring) g CROSS JOIN LATERAL jsonb_array_elements(g->'items') x WHERE nullif(x->>'source_location_id','') IS NULL) THEN RAISE EXCEPTION 'Every tailoring fabric requires its recorded Showroom floor'; END IF;
 SELECT source_id INTO header_source FROM (SELECT (x->>'source_location_id')::uuid source_id FROM jsonb_array_elements(p_items) x UNION ALL SELECT (x->>'source_location_id')::uuid FROM jsonb_array_elements(p_tailoring) g CROSS JOIN LATERAL jsonb_array_elements(g->'items') x) sources LIMIT 1;
 IF header_source IS NULL OR EXISTS(SELECT 1 FROM (SELECT (x->>'source_location_id')::uuid id FROM jsonb_array_elements(p_items) x UNION SELECT (x->>'source_location_id')::uuid FROM jsonb_array_elements(p_tailoring) g CROSS JOIN LATERAL jsonb_array_elements(g->'items') x) sources WHERE NOT EXISTS(SELECT 1 FROM public.locations l JOIN public.locations parent ON parent.id=l.parent_id AND parent.active AND parent.kind='showroom' WHERE l.id=sources.id AND l.active AND l.kind='showroom_sublocation')) THEN RAISE EXCEPTION 'Every item requires an active Showroom floor'; END IF;
 IF p_customer IS NOT NULL THEN SELECT id INTO customer_id FROM public.customers WHERE id=p_customer FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Selected customer does not exist'; END IF; ELSE customer_id:=public.find_or_create_customer(p_name,p_contact,NULL,NULL); END IF;
 IF customer_id IS NOT NULL THEN SELECT jsonb_build_object('id',id,'name',name,'phone',phone,'whatsapp_phone',whatsapp_phone) INTO contact FROM public.customers WHERE id=customer_id; ELSE contact:=jsonb_build_object('name',NULL,'phone',NULL); END IF;
 PERFORM 1 FROM public.inventory_items WHERE id IN(SELECT (x->>'inventory_item_id')::uuid FROM jsonb_array_elements(p_items) x WHERE x->>'kind'='fabric' UNION SELECT (x->>'inventory_item_id')::uuid FROM jsonb_array_elements(p_tailoring) g CROSS JOIN LATERAL jsonb_array_elements(g->'items') x) OR finished_product_id IN(SELECT (x->>'piece_id')::uuid FROM jsonb_array_elements(p_items) x WHERE x->>'kind'='product') ORDER BY id FOR UPDATE;
 INSERT INTO public.counter_bills(order_id,request_id,actor_id,payload,pos_terminal_id) VALUES(result,p_request,auth.uid(),payload_value,terminal);
 INSERT INTO public.orders(id,code,kind,customer_id,source_location_id,created_by,salesperson_user_id,reference,sale_request_id,sale_request_payload,customer_snapshot,payment_confirmed_at) VALUES(result,'BILL-'||replace(result::text,'-',''),'counter_bill',customer_id,header_source,auth.uid(),p_salesperson,'Counter bill',p_request,payload_value,contact,CASE WHEN p_paid THEN clock_timestamp() END);
 FOR row_value IN SELECT value FROM jsonb_array_elements(p_tailoring) LOOP
  IF jsonb_typeof(row_value) IS DISTINCT FROM 'object' OR (row_value-ARRAY['items','garment','delivery_date','assignment_id','stitching_paise','notes','design_id','custom_design'])<>'{}' OR jsonb_typeof(row_value->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(row_value->'items') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Complete tailoring details and priced fabric cuts required'; END IF;
  fabric_amount:=0; priced_cuts:='[]'; plain_cuts:='[]'; stitching:=(row_value->>'stitching_paise')::bigint;
  FOR priced_cut IN SELECT value FROM jsonb_array_elements(row_value->'items') LOOP
   IF (priced_cut-ARRAY['inventory_item_id','quantity','sp_paise_per_m','source_location_id'])<>'{}' OR (priced_cut->>'quantity')::numeric NOT BETWEEN 1 AND 2147483647 OR (priced_cut->>'sp_paise_per_m')::numeric NOT BETWEEN 0 AND 9007199254740991 THEN RAISE EXCEPTION 'Explicit located fabric, exact millimetres and per-metre price required'; END IF;
   amount:=round((priced_cut->>'quantity')::numeric*(priced_cut->>'sp_paise_per_m')::numeric/1000); fabric_amount:=fabric_amount+amount; priced_cuts:=priced_cuts||jsonb_build_array(priced_cut||jsonb_build_object('amount_paise',amount)); plain_cuts:=plain_cuts||jsonb_build_array(priced_cut-'sp_paise_per_m');
  END LOOP;
  group_price:=(fabric_amount+stitching)::bigint;
  booked_job:=public.book_invoice_tailoring_multi(gen_random_uuid(),plain_cuts,group_price,customer_id,(row_value->>'assignment_id')::uuid,p_salesperson,row_value->>'garment',row_value->>'notes');
  INSERT INTO public.counter_tailoring_details(job_id,bill_id,delivery_date,design_id,custom_design,design_name_snapshot,design_code_snapshot) VALUES(booked_job,result,(row_value->>'delivery_date')::date,(row_value->>'design_id')::uuid,nullif(btrim(row_value->>'custom_design'),''),coalesce((SELECT name FROM public.designs WHERE id=(row_value->>'design_id')::uuid),nullif(btrim(row_value->>'custom_design'),'')),(SELECT code FROM public.designs WHERE id=(row_value->>'design_id')::uuid));
  INSERT INTO public.counter_tailoring_sale_prices(job_id,fabric_lines,fabric_amount_paise,stitching_paise,total_paise,recorded_by) VALUES(booked_job,priced_cuts,fabric_amount::bigint,stitching,group_price,auth.uid());
  INSERT INTO public.order_items(order_id,customer_tailoring_job_id,quantity,unit,final_customer_price_paise) VALUES(result,booked_job,1,'job',group_price) RETURNING id INTO item_id;
  INSERT INTO public.order_item_financials(order_item_id,cp_snapshot_paise) SELECT item_id,fabric_cp_total_paise FROM public.counter_tailoring_prices WHERE job_id=booked_job;
  total:=total+group_price;
 END LOOP;
 FOR row_value IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY coalesce(value->>'inventory_item_id',value->>'piece_id'),value->>'source_location_id' LOOP
  row_source:=(row_value->>'source_location_id')::uuid;
  IF row_value->>'kind'='fabric' THEN
   qty:=(row_value->>'quantity')::numeric; sp:=(row_value->>'sp_paise_per_m')::bigint; inv:=(row_value->>'inventory_item_id')::uuid;
   IF qty IS NULL OR qty<=0 OR qty<>trunc(qty) OR qty>2147483647 OR sp<0 THEN RAISE EXCEPTION 'Positive exact millimetres and valid fabric price required'; END IF;
   SELECT t.* INTO th FROM public.thaans t JOIN public.inventory_items i ON i.thaan_id=t.id JOIN public.fabric_stock s ON s.id=t.fabric_stock_id WHERE i.id=inv AND i.unit='mm' AND t.status='active' AND s.entry_state IN('complete','correcting','legacy_pending');
   IF NOT FOUND OR qty>public.inventory_balance(inv,row_source) THEN RAISE EXCEPTION 'Insufficient active fabric at its recorded Showroom floor'; END IF;
   SELECT cp_paise_per_m INTO cp FROM public.fabric_stock_costs WHERE fabric_stock_id=th.fabric_stock_id ORDER BY revision DESC LIMIT 1; IF cp IS NULL OR cp<=0 THEN RAISE EXCEPTION 'Positive recorded Thaan CP required'; END IF;
   amount:=round(qty*sp/1000);
   INSERT INTO public.order_items(order_id,fabric_stock_id,thaan_id,quantity,unit,sp_snapshot_paise,final_customer_price_paise) VALUES(result,th.fabric_stock_id,th.id,qty,'mm',sp,amount) RETURNING id INTO item_id;
   INSERT INTO public.order_item_financials(order_item_id,cp_snapshot_paise) VALUES(item_id,cp);
   INSERT INTO public.inventory_movements(kind,inventory_item_id,fabric_stock_id,thaan_id,quantity,unit,source_location_id,order_item_id,actor_id,reason,reference) VALUES('SALE',inv,th.fabric_stock_id,th.id,qty,'mm',row_source,item_id,auth.uid(),'Counter fabric sale','ORDER:'||result::text);
   IF public.inventory_balance(inv,NULL)=0 THEN UPDATE public.thaans SET status='depleted',updated_at=now() WHERE id=th.id; END IF;
  ELSE
   SELECT * INTO piece FROM public.finished_products WHERE id=(row_value->>'piece_id')::uuid AND status='available' AND current_location_id=row_source FOR UPDATE;
   SELECT id INTO inv FROM public.inventory_items WHERE finished_product_id=piece.id AND unit='pc';
   IF piece.id IS NULL OR inv IS NULL OR public.inventory_balance(inv,row_source)<>1 THEN RAISE EXCEPTION 'Available physical piece on its recorded Showroom floor required'; END IF;
   SELECT * INTO price FROM public.finished_product_prices WHERE finished_product_id=piece.id ORDER BY revision DESC LIMIT 1;
   IF price.id IS NULL OR price.id IS DISTINCT FROM (row_value->>'sp_version_id')::uuid THEN RAISE EXCEPTION 'Saved product SP changed; refresh'; END IF;
   SELECT cost_version_id INTO reviewed_id FROM public.finished_product_price_reviews WHERE price_id=price.id; SELECT id INTO cost_id FROM public.production_cost_versions WHERE production_job_id=piece.production_job_id ORDER BY revision DESC LIMIT 1; SELECT amount_paise INTO cost_amount FROM public.finished_product_cost_allocations WHERE finished_product_id=piece.id AND cost_version_id=cost_id;
   IF reviewed_id IS DISTINCT FROM cost_id OR cost_amount IS NULL OR NOT EXISTS(SELECT 1 FROM public.production_cost_requests WHERE result_id=cost_id AND payload ? 'materials') THEN RAISE EXCEPTION 'Recorded piece CP and reviewed saved SP required'; END IF;
   SELECT jsonb_build_object('quantity_snapshot',v.quantity_snapshot,'lines',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM public.production_cost_lines l WHERE l.cost_version_id=v.id),'[]')) INTO evidence FROM public.production_cost_versions v WHERE v.id=cost_id;
   amount:=price.sp_paise;
   INSERT INTO public.order_items(order_id,finished_product_id,quantity,unit,sp_snapshot_paise,final_customer_price_paise) VALUES(result,piece.id,1,'pc',amount,amount) RETURNING id INTO item_id;
   INSERT INTO public.order_item_financials(order_item_id,production_cost_snapshot_paise) VALUES(item_id,cost_amount);
   INSERT INTO public.finished_product_sale_snapshots(order_item_id,price_version_id,cost_version_id,reviewed_cost_version_id,cost_evidence,item_snapshot) VALUES(item_id,price.id,cost_id,reviewed_id,evidence,(SELECT jsonb_build_object('barcode',b.code,'product',product.name,'design',ctx->>'design','size',ctx->>'size','job_code',j.code,'piece_number',piece.piece_number,'source',loc.name,'actor',actor.full_name) FROM public.barcodes b JOIN public.products product ON product.id=piece.product_id JOIN public.production_jobs j ON j.id=piece.production_job_id JOIN public.locations loc ON loc.id=row_source LEFT JOIN public.profiles actor ON actor.id=auth.uid() CROSS JOIN LATERAL public.production_piece_context(piece.id) ctx WHERE b.id=piece.barcode_id));
   INSERT INTO public.inventory_movements(inventory_item_id,kind,finished_product_id,quantity,unit,source_location_id,order_item_id,actor_id,reason,reference) VALUES(inv,'SALE',piece.id,1,'pc',row_source,item_id,auth.uid(),'Counter finished-product sale','ORDER:'||result::text); UPDATE public.finished_products SET status='sold' WHERE id=piece.id;
  END IF;
  total:=total+amount;
 END LOOP;
 IF total NOT BETWEEN 0 AND 9007199254740991 THEN RAISE EXCEPTION 'Bill exceeds supported exact money range'; END IF;
 UPDATE public.orders SET status='completed',final_customer_price_paise=total::bigint,completed_at=clock_timestamp() WHERE id=result;
 PERFORM public.capture_counter_print_record(result);
 INSERT INTO public.counter_bill_terminal_records(bill_id,terminal_id) VALUES(result,terminal) ON CONFLICT (bill_id) DO NOTHING;
 IF p_paid THEN INSERT INTO public.counter_bill_payments(bill_id,request_id,amount_paise,actor_id) VALUES(result,p_request,total::bigint,auth.uid()); END IF;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference) VALUES(auth.uid(),'complete_counter_bill_multi','orders',result,jsonb_build_object('paid',p_paid,'total_paise',total),'BILL:'||p_request::text);
 RETURN result;
END; $$;

CREATE FUNCTION public.complete_counter_bill_multi_with_advance(p_request uuid,p_items jsonb,p_tailoring jsonb,p_advance_paise bigint,p_salesperson uuid,p_name text DEFAULT NULL,p_contact text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE bill uuid;
BEGIN
 IF p_advance_paise IS NULL OR p_advance_paise<0 THEN RAISE EXCEPTION 'Advance must be zero or a positive exact amount'; END IF;
 bill:=public.complete_counter_bill_multi(p_request,p_items,p_tailoring,false,p_salesperson,NULL,p_name,p_contact);
 IF p_advance_paise>0 THEN PERFORM public.record_counter_bill_payment(p_request,bill,p_advance_paise); END IF;
 RETURN bill;
END; $$;

CREATE OR REPLACE FUNCTION public.capture_counter_print_record(p_bill uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 INSERT INTO public.counter_bill_print_records(bill_id,document)
 SELECT o.id,jsonb_build_object('id',o.id,'code',o.code,'created_at',o.completed_at,'total_paise',o.final_customer_price_paise::text,'customer',o.customer_snapshot,'source',coalesce(sources.names,loc.name),'salesperson',person.full_name,
 'lines',(SELECT jsonb_agg(jsonb_build_object('id',it.id,'kind',CASE WHEN it.customer_tailoring_job_id IS NOT NULL THEN 'tailoring' WHEN it.thaan_id IS NOT NULL THEN 'fabric' ELSE 'product' END,
 'barcode',coalesce(v.code,t.barcode,fb.code,pb.code),'name',coalesce(g.name,f.name,product.name,job.garment),'size',context->>'size','design',coalesce(context->>'design',detail.design_name_snapshot),
 'source',coalesce((SELECT source_location.name FROM public.inventory_movements movement JOIN public.locations source_location ON source_location.id=movement.source_location_id WHERE movement.order_item_id=it.id LIMIT 1),(SELECT string_agg(DISTINCT source_location.name,', ' ORDER BY source_location.name) FROM public.counter_tailoring_prices quote CROSS JOIN LATERAL jsonb_array_elements(quote.cuts) cut JOIN public.locations source_location ON source_location.id=(cut->>'source_location_id')::uuid WHERE quote.job_id=job.id)),
 'quantity',it.quantity::text,'unit',it.unit,'price_paise',it.sp_snapshot_paise::text,'amount_paise',it.final_customer_price_paise::text,'job_id',job.id,'job_code',job.code,'delivery_date',detail.delivery_date,
 'fabric_amount_paise',(SELECT fabric_amount_paise::text FROM public.counter_tailoring_sale_prices WHERE job_id=job.id),'stitching_paise',(SELECT stitching_paise::text FROM public.counter_tailoring_sale_prices WHERE job_id=job.id),
 'fabrics',(SELECT jsonb_agg(jsonb_build_object('barcode',coalesce(rv.code,tt.barcode,bc.code),'name',ff.name,'quantity_mm',cut->>'quantity','source',source_location.name)) FROM public.counter_tailoring_prices quote CROSS JOIN LATERAL jsonb_array_elements(quote.cuts) cut JOIN public.thaans tt ON tt.id=(cut->>'thaan_id')::uuid JOIN public.fabric_stock s ON s.id=tt.fabric_stock_id JOIN public.fabrics ff ON ff.id=tt.fabric_id LEFT JOIN public.locations source_location ON source_location.id=(cut->>'source_location_id')::uuid LEFT JOIN public.stock_registration_variants rv ON rv.thaan_id=tt.id LEFT JOIN public.barcodes bc ON bc.id=s.barcode_id WHERE quote.job_id=job.id)) ORDER BY it.id)
 FROM public.order_items it LEFT JOIN public.thaans t ON t.id=it.thaan_id LEFT JOIN public.stock_registration_variants v ON v.thaan_id=t.id LEFT JOIN public.stock_registration_fabric_types g ON g.id=v.fabric_type_id LEFT JOIN public.fabric_stock fs ON fs.id=it.fabric_stock_id LEFT JOIN public.barcodes fb ON fb.id=fs.barcode_id LEFT JOIN public.fabrics f ON f.id=t.fabric_id LEFT JOIN public.finished_products piece ON piece.id=it.finished_product_id LEFT JOIN public.products product ON product.id=piece.product_id LEFT JOIN public.barcodes pb ON pb.id=piece.barcode_id LEFT JOIN LATERAL public.production_piece_context(piece.id) context ON piece.id IS NOT NULL LEFT JOIN public.customer_tailoring_jobs job ON job.id=it.customer_tailoring_job_id LEFT JOIN public.counter_tailoring_details detail ON detail.job_id=job.id WHERE it.order_id=o.id))
 FROM public.orders o JOIN public.locations loc ON loc.id=o.source_location_id JOIN public.counter_bills cb ON cb.order_id=o.id LEFT JOIN public.profiles person ON person.id=o.salesperson_user_id
 LEFT JOIN LATERAL(SELECT string_agg(DISTINCT l.name,', ' ORDER BY l.name) names FROM public.locations l WHERE l.id IN(SELECT (x->>'source_location_id')::uuid FROM jsonb_array_elements(cb.payload->'items') x UNION SELECT (x->>'source_location_id')::uuid FROM jsonb_array_elements(cb.payload->'tailoring') g CROSS JOIN LATERAL jsonb_array_elements(g->'items') x)) sources ON true
 WHERE o.id=p_bill;
$$;

CREATE OR REPLACE FUNCTION public.business_sale_facts(p_from timestamptz DEFAULT NULL,p_to timestamptz DEFAULT NULL,p_location text DEFAULT NULL) RETURNS TABLE(row_key text,event_at timestamptz,data jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT it.id::text,CASE WHEN o.kind='counter_bill' THEN payment.paid_at ELSE o.completed_at END,jsonb_build_object(
 'id',it.id,'order_id',o.id,'code',o.code,'completed_at',o.completed_at,'status',o.status,'payment_confirmed_at',coalesce(payment.paid_at,o.payment_confirmed_at),'kind',CASE WHEN it.fabric_stock_id IS NOT NULL THEN 'direct_fabric_sale' WHEN it.customer_tailoring_job_id IS NOT NULL THEN 'customer_tailoring' ELSE 'finished_product_sale' END,'payment_basis',CASE WHEN o.kind='counter_bill' THEN 'immutable_counter_receipt' ELSE 'completed_paid_sale' END,'channel',coalesce(channel.channel,'counter'),
 'channel_basis',CASE WHEN channel.order_id IS NULL THEN 'existing_counter_bill_workflow' ELSE 'recorded_at_sale' END,
 'source',coalesce(recorded_source.names,loc.name),'source_id',loc.id,'source_names',recorded_source.names_json,'pos_code',terminal.code,'salesperson_id',o.salesperson_user_id,'salesperson',coalesce(dim.salesperson_name,person.full_name),
 'customer_id',o.customer_id,'customer',o.customer_snapshot->>'name',
 'fabric',CASE WHEN it.fabric_stock_id IS NOT NULL THEN coalesce(dim.fabric_type,g.name,f.name) END,
 'vendor_id',CASE WHEN dim.order_item_id IS NOT NULL THEN dim.vendor_id ELSE batch.supplier_id END,'vendor',CASE WHEN dim.order_item_id IS NOT NULL THEN dim.vendor_name ELSE coalesce(rb.provider_name,supplier.name) END,
 'product',CASE WHEN it.finished_product_id IS NOT NULL THEN coalesce(dim.product_name,snap.item_snapshot->>'product',product.name) END,
 'design',coalesce(dim.design_name,snap.item_snapshot->>'design',design.name,job.custom_design),'size',coalesce(dim.size,job.size),
 'barcode',coalesce(snap.item_snapshot->>'barcode',variant.code,t.barcode,fb.code,pb.code),'batch',batch.code,
 'quantity',trunc(it.quantity)::text,'unit',it.unit,'revenue_paise',it.final_customer_price_paise::text,
 'cost_paise',CASE WHEN it.fabric_stock_id IS NOT NULL AND fi.cp_snapshot_paise IS NOT NULL THEN round(it.quantity*fi.cp_snapshot_paise/1000)::text WHEN it.finished_product_id IS NOT NULL THEN fi.production_cost_snapshot_paise::text WHEN it.customer_tailoring_job_id IS NOT NULL THEN public.customer_job_fabric_cp(it.customer_tailoring_job_id)::text END,
 'margin_paise',CASE WHEN it.fabric_stock_id IS NOT NULL AND fi.cp_snapshot_paise IS NOT NULL THEN (it.final_customer_price_paise-round(it.quantity*fi.cp_snapshot_paise/1000))::text WHEN it.finished_product_id IS NOT NULL AND fi.production_cost_snapshot_paise IS NOT NULL THEN (it.final_customer_price_paise-fi.production_cost_snapshot_paise)::text WHEN it.customer_tailoring_job_id IS NOT NULL AND public.customer_job_fabric_cp(it.customer_tailoring_job_id) IS NOT NULL THEN (it.final_customer_price_paise-public.customer_job_fabric_cp(it.customer_tailoring_job_id))::text END,
 'cost_basis',CASE WHEN it.fabric_stock_id IS NOT NULL THEN 'sale_time_fabric_CP' WHEN it.customer_tailoring_job_id IS NOT NULL THEN 'current_recorded_job_fabric_CP_including_additional_issues' ELSE 'sale_time_recorded_piece_CP' END,
 'dimension_basis',CASE WHEN dim.order_item_id IS NOT NULL THEN 'sale_time_snapshot' ELSE 'historical_bill_snapshot_or_current_catalogue' END,
 'item_evidence',to_jsonb(it),'financial_evidence',to_jsonb(fi),'finished_sale_evidence',to_jsonb(snap))
 FROM public.orders o JOIN public.order_items it ON it.order_id=o.id
 LEFT JOIN LATERAL(SELECT max(p.paid_at) paid_at,sum(p.amount_paise) collected,count(*) bill_count FROM public.counter_bill_payments p WHERE p.bill_id=o.id) payment ON true
 LEFT JOIN public.ecommerce_sale_sources actual_source ON actual_source.order_item_id=it.id
 LEFT JOIN LATERAL(SELECT (array_agg(m.source_location_id ORDER BY m.source_location_id))[1] first_id,string_agg(DISTINCT ml.name,', ' ORDER BY ml.name) names,jsonb_agg(DISTINCT ml.name) names_json FROM public.inventory_movements m JOIN public.locations ml ON ml.id=m.source_location_id WHERE m.order_item_id=it.id OR (it.customer_tailoring_job_id IS NOT NULL AND m.customer_tailoring_job_id=it.customer_tailoring_job_id)) recorded_source ON true
 JOIN public.locations loc ON loc.id=coalesce(recorded_source.first_id,actual_source.source_location_id,o.source_location_id)
 LEFT JOIN public.counter_bill_terminal_records terminal_record ON terminal_record.bill_id=o.id LEFT JOIN public.pos_terminals terminal ON terminal.id=terminal_record.terminal_id
 LEFT JOIN public.sale_analysis_channels channel ON channel.order_id=o.id LEFT JOIN public.sale_analysis_dimensions dim ON dim.order_item_id=it.id
 LEFT JOIN public.order_item_financials fi ON fi.order_item_id=it.id LEFT JOIN public.finished_product_sale_snapshots snap ON snap.order_item_id=it.id
 LEFT JOIN public.profiles person ON person.id=o.salesperson_user_id LEFT JOIN public.fabric_stock fs ON fs.id=it.fabric_stock_id LEFT JOIN public.fabrics f ON f.id=fs.fabric_id
 LEFT JOIN public.thaans t ON t.id=it.thaan_id LEFT JOIN public.barcodes fb ON fb.id=fs.barcode_id LEFT JOIN public.stock_registration_variants variant ON variant.thaan_id=t.id
 LEFT JOIN public.stock_registration_fabric_types g ON g.id=variant.fabric_type_id LEFT JOIN public.receiving_batches batch ON batch.id=fs.batch_id
 LEFT JOIN public.suppliers supplier ON supplier.id=batch.supplier_id LEFT JOIN public.stock_registration_batches rb ON rb.batch_id=batch.id
 LEFT JOIN public.finished_products piece ON piece.id=it.finished_product_id LEFT JOIN public.barcodes pb ON pb.id=piece.barcode_id
 LEFT JOIN public.products product ON product.id=piece.product_id LEFT JOIN public.designs design ON design.id=piece.design_id LEFT JOIN public.production_jobs job ON job.id=piece.production_job_id
 WHERE o.status='completed' AND ((o.kind='counter_bill' AND payment.bill_count>0) OR (o.kind<>'counter_bill' AND o.payment_confirmed_at IS NOT NULL)) AND o.kind IN('direct_fabric_sale','finished_product_sale','ecommerce_sale','counter_bill')
 AND (p_from IS NULL OR o.completed_at>=p_from) AND (p_to IS NULL OR o.completed_at<p_to) AND (nullif(p_location,'') IS NULL OR loc.name=p_location OR loc.id::text=p_location);
$$;

REVOKE ALL ON FUNCTION public.counter_scan_barcode_any(text),public.book_invoice_tailoring_multi(uuid,jsonb,bigint,uuid,uuid,uuid,text,text),public.complete_counter_bill_multi(uuid,jsonb,jsonb,boolean,uuid,uuid,text,text),public.complete_counter_bill_multi_with_advance(uuid,jsonb,jsonb,bigint,uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.counter_scan_barcode_any(text),public.complete_counter_bill_multi(uuid,jsonb,jsonb,boolean,uuid,uuid,text,text),public.complete_counter_bill_multi_with_advance(uuid,jsonb,jsonb,bigint,uuid,text,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
