BEGIN;
CREATE OR REPLACE FUNCTION public.production_fabric_projection(p_barcode text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN

 RETURN coalesce((SELECT jsonb_agg(r ORDER BY r->>'fabric_name',r->>'barcode') FROM (
 SELECT jsonb_build_object('id',s.id,'fabric_name',coalesce(g.name,f.name),'batch_code',b.code,
 'colour',f.colour,'barcode',coalesce(v.code,t.barcode,bc.code),
 'cuts',jsonb_build_array(jsonb_build_object('inventory_item_id',i.id,'thaan_id',t.id,
 'locations',coalesce((SELECT jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'kind',l.kind,'parent_id',l.parent_id,'quantity_mm',public.inventory_balance(i.id,l.id)) ORDER BY l.name)
 FROM public.locations l WHERE l.active AND (l.kind='workshop' OR public.is_showroom_location(l.id)) AND public.inventory_balance(i.id,l.id)>0),'[]'::jsonb)))) r
 FROM public.thaans t JOIN public.fabric_stock s ON s.id=t.fabric_stock_id JOIN public.fabrics f ON f.id=s.fabric_id
 JOIN public.receiving_batches b ON b.id=s.batch_id JOIN public.barcodes bc ON bc.id=s.barcode_id JOIN public.inventory_items i ON i.thaan_id=t.id
 LEFT JOIN public.stock_registration_variants v ON v.thaan_id=t.id LEFT JOIN public.stock_registration_fabric_types g ON g.id=v.fabric_type_id
 WHERE t.status='active' AND t.original_mm>0 AND coalesce((SELECT cp_paise_per_m FROM public.fabric_stock_costs WHERE fabric_stock_id=s.id ORDER BY revision DESC LIMIT 1),0)>0 AND (p_barcode IS NULL OR btrim(p_barcode) IN(v.code,t.barcode,bc.code))
 AND EXISTS(SELECT 1 FROM public.locations l WHERE l.active AND (l.kind='workshop' OR public.is_showroom_location(l.id)) AND public.inventory_balance(i.id,l.id)>0)
 )q),'[]'::jsonb);
END; $$;
CREATE OR REPLACE FUNCTION public.salesperson_work(p_salesperson uuid DEFAULT NULL,p_after timestamptz DEFAULT NULL,p_after_id uuid DEFAULT NULL,p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE owner boolean:=public.has_role(auth.uid(),'owner');
BEGIN
 IF NOT owner AND (NOT public.has_role(auth.uid(),'salesperson') OR NOT public.has_perm(auth.uid(),'salesperson.view_work')) THEN RAISE EXCEPTION 'Salesperson work permission required'; END IF;
 IF NOT owner AND p_salesperson IS NOT NULL AND p_salesperson<>auth.uid() THEN RAISE EXCEPTION 'Only own Salesperson work is available'; END IF;
 IF (p_after IS NULL)<>(p_after_id IS NULL) THEN RAISE EXCEPTION 'Complete history cursor required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC,x.id DESC) FROM(
 SELECT o.id,o.code,o.kind,o.created_at,o.created_by,o.source_location_id,l.name source_name,o.salesperson_user_id,p.full_name salesperson_name,o.customer_snapshot,o.final_customer_price_paise::text final_customer_price_paise,
 CASE WHEN o.kind='counter_bill' THEN EXISTS(SELECT 1 FROM public.counter_bill_payments WHERE bill_id=o.id) END paid,
 (SELECT jsonb_agg(jsonb_build_object('code',job.code,'garment',job.garment,'status',job.status,'delivery_date',detail.delivery_date,'factory',factory.name,'tailor',tailor.real_name) ORDER BY job.code) FROM public.counter_tailoring_details detail JOIN public.customer_tailoring_jobs job ON job.id=detail.job_id JOIN public.tailor_assignments assignment ON assignment.id=job.tailor_assignment_id JOIN public.tailoring_factories factory ON factory.id=assignment.factory_id JOIN public.tailors tailor ON tailor.id=assignment.tailor_id WHERE detail.bill_id=o.id) tailoring_jobs,
 j.id job_id,j.code job_code,j.garment,j.status job_status,f.name factory_name,s.name section_name,t.code tailor_code,t.real_name tailor_name,
 CASE WHEN j.id IS NOT NULL THEN (SELECT sum(quantity)::text FROM public.job_material_requirements WHERE customer_tailoring_job_id=j.id AND fabric_stock_id IS NOT NULL) ELSE (SELECT sum(quantity)::text FROM public.order_items WHERE order_id=o.id AND fabric_stock_id IS NOT NULL) END fabric_mm,
 coalesce((SELECT jsonb_agg(jsonb_build_object('barcode',bc.code,'fabric',fab.name,'batch',b.code,'quantity_mm',ml.quantity::text) ORDER BY ml.id) FROM public.material_issues mi JOIN public.material_issue_lines ml ON ml.material_issue_id=mi.id JOIN public.fabric_stock fs ON fs.id=ml.fabric_stock_id JOIN public.fabrics fab ON fab.id=fs.fabric_id JOIN public.receiving_batches b ON b.id=fs.batch_id JOIN public.barcodes bc ON bc.id=fs.barcode_id WHERE mi.customer_tailoring_job_id=j.id),
 (SELECT jsonb_agg(jsonb_build_object('barcode',bc.code,'fabric',fab.name,'batch',b.code,'quantity_mm',it.quantity::text) ORDER BY it.id) FROM public.order_items it JOIN public.fabric_stock fs ON fs.id=it.fabric_stock_id JOIN public.fabrics fab ON fab.id=fs.fabric_id JOIN public.receiving_batches b ON b.id=fs.batch_id JOIN public.barcodes bc ON bc.id=fs.barcode_id WHERE it.order_id=o.id),'[]'::jsonb) fabrics
 FROM public.orders o JOIN public.profiles p ON p.id=o.salesperson_user_id JOIN public.locations l ON l.id=o.source_location_id LEFT JOIN public.customer_tailoring_jobs j ON j.id=o.customer_tailoring_job_id LEFT JOIN public.tailor_assignments a ON a.id=j.tailor_assignment_id LEFT JOIN public.tailoring_factories f ON f.id=a.factory_id LEFT JOIN public.tailoring_sections s ON s.id=a.section_id LEFT JOIN public.tailors t ON t.id=a.tailor_id
 WHERE o.status='completed' AND NOT(o.kind='customer_tailoring' AND EXISTS(SELECT 1 FROM public.counter_tailoring_details WHERE job_id=o.customer_tailoring_job_id)) AND (owner OR o.salesperson_user_id=auth.uid()) AND (p_salesperson IS NULL OR o.salesperson_user_id=p_salesperson) AND (p_after IS NULL OR (o.created_at,o.id)<(p_after,p_after_id)) ORDER BY o.created_at DESC,o.id DESC LIMIT greatest(1,least(coalesce(p_limit,50),200))) x),'[]'::jsonb);
END; $$;
CREATE OR REPLACE FUNCTION public.customer_tailoring_work(p_code text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE owner boolean:=public.has_role(auth.uid(),'owner');counter boolean:=public.has_role(auth.uid(),'counter');
BEGIN
 IF NOT owner AND NOT counter AND NOT (public.has_role(auth.uid(),'tailor') AND public.has_perm(auth.uid(),'tailoring.manage_jobs')) THEN RAISE EXCEPTION 'Customer Tailoring access required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',j.id,'code',j.code,'bill_id',d.bill_id,'bill_code',o.code,'garment',j.garment,'status',j.status,'created_at',j.created_at,'created_by',j.created_by,'creator',person.full_name,'delivery_date',d.delivery_date,'design',d.design_name_snapshot,'customer',c.name,'contact',c.phone,'factory',f.name,'tailor',t.real_name,'notes',j.notes,'source',loc.name,
 'paid',CASE WHEN d.bill_id IS NOT NULL THEN EXISTS(SELECT 1 FROM public.counter_bill_payments WHERE bill_id=d.bill_id) END,
 'total_paise',CASE WHEN owner OR counter THEN coalesce(price.final_customer_price_paise,old_price.final_customer_price_paise)::text END,
 'cp_paise',CASE WHEN owner THEN public.customer_job_fabric_cp(j.id)::text END,
 'fabrics',coalesce((SELECT jsonb_agg(jsonb_build_object('barcode',coalesce(v.code,th.barcode,b.code),'name',fab.name,'quantity_mm',line.quantity::text,'source',source.name,'issue_type',issue.issue_type,'issued_at',issue.issued_at,'issued_by',actor.full_name,'issue',issue.code) ORDER BY issue.issued_at,line.id) FROM public.material_issue_lines line JOIN public.material_issues issue ON issue.id=line.material_issue_id JOIN public.thaans th ON th.id=line.thaan_id JOIN public.fabrics fab ON fab.id=th.fabric_id JOIN public.fabric_stock stock ON stock.id=th.fabric_stock_id LEFT JOIN public.barcodes b ON b.id=stock.barcode_id LEFT JOIN public.stock_registration_variants v ON v.thaan_id=th.id JOIN public.locations source ON source.id=issue.source_location_id LEFT JOIN public.profiles actor ON actor.id=issue.issued_by WHERE issue.customer_tailoring_job_id=j.id),'[]'))
 ORDER BY j.created_at DESC,j.id) FROM public.customer_tailoring_jobs j LEFT JOIN public.customers c ON c.id=j.customer_id JOIN public.tailor_assignments a ON a.id=j.tailor_assignment_id JOIN public.tailoring_factories f ON f.id=a.factory_id JOIN public.tailors t ON t.id=a.tailor_id LEFT JOIN LATERAL(SELECT source_location_id FROM public.material_issues WHERE customer_tailoring_job_id=j.id ORDER BY issued_at,id LIMIT 1) initial_source ON true LEFT JOIN public.locations loc ON loc.id=initial_source.source_location_id LEFT JOIN public.profiles person ON person.id=j.created_by LEFT JOIN public.counter_tailoring_details d ON d.job_id=j.id LEFT JOIN public.orders o ON o.id=d.bill_id LEFT JOIN public.counter_tailoring_prices price ON price.job_id=j.id LEFT JOIN LATERAL(SELECT * FROM public.customer_tailoring_prices WHERE job_id=j.id ORDER BY revision DESC LIMIT 1) old_price ON true
 WHERE (owner OR counter OR public.owns_tailor_assignment(j.tailor_assignment_id)) AND (nullif(btrim(p_code),'') IS NULL OR j.code=btrim(p_code) OR j.id::text=btrim(p_code) OR o.code=btrim(p_code) OR o.id::text=btrim(p_code))),'[]');
END; $$;

-- Active work must not disappear behind the historical feed's latest-100 limit.
CREATE FUNCTION public.ongoing_production_work() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT(public.has_perm(auth.uid(),'production.view') OR public.has_role(auth.uid(),'tailor')) THEN RAISE EXCEPTION 'Production work access required'; END IF;
 RETURN coalesce((SELECT jsonb_agg(public.production_job_document(j.id::text) ORDER BY j.created_at DESC,j.id) FROM public.production_jobs j WHERE j.status IN('open','in_progress') AND (public.has_perm(auth.uid(),'production.view') OR public.owns_production_job(j.id))),'[]');
END; $$;
REVOKE ALL ON FUNCTION public.ongoing_production_work() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ongoing_production_work() TO authenticated;

CREATE OR REPLACE FUNCTION public.owner_erp_report(p_dataset text,p_from timestamptz DEFAULT NULL,p_to timestamptz DEFAULT NULL,p_after text DEFAULT NULL,p_limit integer DEFAULT 100,p_search text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE source_sql text; rows_value jsonb; total_value bigint; last_key text; order_sql text; cursor_operator text; last_aggregate text; snapshot_dataset boolean;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 OR (p_from IS NOT NULL AND p_to IS NOT NULL AND p_from>=p_to) OR length(coalesce(p_after,''))>256 OR length(coalesce(p_search,''))>200 THEN RAISE EXCEPTION 'Valid half-open date range, cursor, search and 1–200 limit required'; END IF;
 CASE p_dataset
 WHEN 'stock' THEN source_sql:=$q$
 SELECT i.id::text||':'||l.id::text row_key,NULL::timestamptz event_at,jsonb_build_object('item_id',i.id,'kind',CASE WHEN i.thaan_id IS NOT NULL THEN 'fabric' WHEN i.material_id IS NOT NULL THEN 'consumable' ELSE 'finished_product' END,'item',coalesce(f.name,m.name,product.name),'batch',batch.code,'barcode',coalesce(fbc.code,pbc.code),'than_id',i.thaan_id,'piece_number',p.piece_number,'location',l.name,'location_id',l.id,'parent_id',l.parent_id,'location_active',l.active,'quantity',b.quantity::text,'unit',i.unit,'piece_status',p.status) data
 FROM public.v_inventory_location_balances b JOIN public.inventory_items i ON i.id=b.inventory_item_id JOIN public.locations l ON l.id=b.location_id LEFT JOIN public.thaans th ON th.id=i.thaan_id LEFT JOIN public.fabric_stock fs ON fs.id=th.fabric_stock_id LEFT JOIN public.fabrics f ON f.id=fs.fabric_id LEFT JOIN public.receiving_batches batch ON batch.id=fs.batch_id LEFT JOIN public.barcodes fbc ON fbc.id=fs.barcode_id LEFT JOIN public.materials m ON m.id=i.material_id LEFT JOIN public.finished_products p ON p.id=i.finished_product_id LEFT JOIN public.products product ON product.id=p.product_id LEFT JOIN public.barcodes pbc ON pbc.id=p.barcode_id
 $q$;
 WHEN 'fabric_stock' THEN source_sql:=$q$
 SELECT s.id::text row_key,s.created_at event_at,jsonb_build_object('id',s.id,'fabric',f.name,'batch',b.code,'barcode',bc.code,'entry_state',s.entry_state,'than_count',(SELECT count(*) FROM public.thaans WHERE fabric_stock_id=s.id),'unreconciled_thans',(SELECT count(*) FROM public.thaans th WHERE th.fabric_stock_id=s.id AND NOT EXISTS(SELECT 1 FROM public.inventory_items WHERE thaan_id=th.id)),'located_quantity_mm',(SELECT coalesce(sum(public.inventory_balance(i.id,NULL)),0)::text FROM public.inventory_items i JOIN public.thaans th ON th.id=i.thaan_id WHERE th.fabric_stock_id=s.id),'cp_paise_per_m',cp.cp_paise_per_m::text,'sp_paise_per_m',sp.sp_paise_per_m::text,'cp_version_id',cp.id,'sp_version_id',sp.id) data
 FROM public.fabric_stock s JOIN public.fabrics f ON f.id=s.fabric_id JOIN public.receiving_batches b ON b.id=s.batch_id JOIN public.barcodes bc ON bc.id=s.barcode_id LEFT JOIN LATERAL(SELECT * FROM public.fabric_stock_costs WHERE fabric_stock_id=s.id ORDER BY revision DESC LIMIT 1) cp ON true LEFT JOIN LATERAL(SELECT * FROM public.fabric_stock_prices WHERE fabric_stock_id=s.id ORDER BY revision DESC LIMIT 1) sp ON true
 $q$;
 WHEN 'batches' THEN source_sql:=$q$ SELECT b.id::text row_key,NULL::timestamptz event_at,to_jsonb(b)||jsonb_build_object('supplier',s.name,'fabric_stock_count',(SELECT count(*) FROM public.fabric_stock WHERE batch_id=b.id),'than_count',(SELECT count(*) FROM public.thaans WHERE batch_id=b.id)) data FROM public.receiving_batches b LEFT JOIN public.suppliers s ON s.id=b.supplier_id $q$;
 WHEN 'thans' THEN source_sql:=$q$
 SELECT th.id::text row_key,th.created_at event_at,jsonb_build_object('id',th.id,'fabric',f.name,'batch',b.code,'fabric_barcode',bc.code,'legacy_barcode',th.barcode,'status',th.status,'original_mm',th.original_mm::text,'located_quantity_mm',CASE WHEN i.id IS NOT NULL THEN public.inventory_balance(i.id,NULL)::text END,'reconciled',i.id IS NOT NULL,'fabric_stock_id',th.fabric_stock_id) data FROM public.thaans th LEFT JOIN public.inventory_items i ON i.thaan_id=th.id LEFT JOIN public.fabric_stock fs ON fs.id=th.fabric_stock_id LEFT JOIN public.barcodes bc ON bc.id=fs.barcode_id LEFT JOIN public.fabrics f ON f.id=th.fabric_id LEFT JOIN public.receiving_batches b ON b.id=th.batch_id
 $q$;
 WHEN 'consumables' THEN source_sql:=$q$ SELECT m.id::text row_key,NULL::timestamptz event_at,to_jsonb(m)-'qty_on_hand'||jsonb_build_object('legacy_quantity_snapshot',m.qty_on_hand::text,'located_quantity',CASE WHEN i.id IS NOT NULL THEN public.inventory_balance(i.id,NULL)::text END,'reconciled',i.id IS NOT NULL) data FROM public.materials m LEFT JOIN public.inventory_items i ON i.material_id=m.id $q$;
 WHEN 'consumable_receipts' THEN source_sql:=$q$ SELECT r.id::text row_key,r.received_at event_at,jsonb_build_object('id',r.id,'material',m.name,'location',l.name,'quantity',r.quantity::text,'unit',r.unit,'cp_paise_per_unit',c.cp_paise_per_unit::text,'actor_id',r.received_by,'received_at',r.received_at,'reason',r.reason) data FROM public.consumable_receipts r JOIN public.materials m ON m.id=r.material_id JOIN public.locations l ON l.id=r.destination_location_id LEFT JOIN public.consumable_receipt_costs c ON c.receipt_id=r.id $q$;
 WHEN 'customer_tailoring' THEN source_sql:=$q$
 SELECT d->>'id' row_key,(d->>'created_at')::timestamptz event_at,d||jsonb_build_object('fabric_cp_total_paise',d->>'cp_paise','final_customer_price_paise',d->>'total_paise','margin_paise',CASE WHEN d->>'cp_paise' IS NOT NULL AND d->>'total_paise' IS NOT NULL THEN ((d->>'total_paise')::bigint-(d->>'cp_paise')::bigint)::text END,'cost_basis','all_recorded_job_fabric_issues; excludes unrecorded labour') data FROM jsonb_array_elements(public.customer_tailoring_work()) d
 $q$;
 WHEN 'configuration' THEN source_sql:=$q$
 SELECT 'factory:'||id::text row_key,created_at event_at,to_jsonb(t)||jsonb_build_object('kind','factory') data FROM public.tailoring_factories t UNION ALL SELECT 'section:'||id::text,created_at,to_jsonb(t)||jsonb_build_object('kind','section') FROM public.tailoring_sections t UNION ALL SELECT 'tailor:'||id::text,created_at,to_jsonb(t)||jsonb_build_object('kind','tailor') FROM public.tailors t UNION ALL SELECT 'assignment:'||id::text,valid_from,to_jsonb(t)||jsonb_build_object('kind','assignment') FROM public.tailor_assignments t UNION ALL SELECT 'charge:'||id::text,NULL::timestamptz,to_jsonb(t)||jsonb_build_object('kind','tailoring_charge') FROM public.tailoring_charges t UNION ALL SELECT 'charge_version:'||id::text,recorded_at,to_jsonb(t)||jsonb_build_object('kind','tailoring_charge_version','amount_paise',amount_paise::text) FROM public.tailoring_charge_versions t UNION ALL SELECT 'design:'||id::text,NULL::timestamptz,to_jsonb(t)||jsonb_build_object('kind','design') FROM public.designs t UNION ALL SELECT 'design_version:'||id::text,recorded_at,to_jsonb(t)||jsonb_build_object('kind','design_charge_version','amount_paise',amount_paise::text) FROM public.design_charge_versions t UNION ALL SELECT 'product:'||id::text,NULL::timestamptz,to_jsonb(t)||jsonb_build_object('kind','product') FROM public.products t
 $q$;
 WHEN 'material_issues','tailor_usage' THEN source_sql:=$q$
 SELECT line.id::text row_key,mi.issued_at event_at,jsonb_build_object('id',line.id,'issue',mi.code,'issue_type',mi.issue_type,'job',coalesce(pj.code,cj.code),'job_kind',CASE WHEN pj.id IS NOT NULL THEN 'owner_production' ELSE 'customer_tailoring' END,'factory',f.name,'section',s.name,'tailor',t.real_name,'assignment_id',a.id,'source',loc.name,'item',coalesce(fabric.name,material.name),'fabric_stock_id',line.fabric_stock_id,'than_id',line.thaan_id,'material_id',line.material_id,'quantity_issued',line.quantity::text,'unit',line.unit,'actual_piece_usage',CASE WHEN pj.id IS NOT NULL THEN (SELECT coalesce(sum(quantity),0)::text FROM public.finished_product_materials WHERE material_issue_line_id=line.id) END,'actual_usage_scope',CASE WHEN pj.id IS NOT NULL THEN 'recorded_finished_piece_allocations' ELSE 'not_recorded_for_customer_tailoring' END,'actor_id',mi.issued_by,'issued_at',mi.issued_at,'reason',mi.reason) data
 FROM public.material_issue_lines line JOIN public.material_issues mi ON mi.id=line.material_issue_id JOIN public.tailor_assignments a ON a.id=mi.tailor_assignment_id JOIN public.tailoring_factories f ON f.id=a.factory_id LEFT JOIN public.tailoring_sections s ON s.id=a.section_id JOIN public.tailors t ON t.id=a.tailor_id JOIN public.locations loc ON loc.id=mi.source_location_id LEFT JOIN public.production_jobs pj ON pj.id=mi.production_job_id LEFT JOIN public.customer_tailoring_jobs cj ON cj.id=mi.customer_tailoring_job_id LEFT JOIN public.fabric_stock fs ON fs.id=line.fabric_stock_id LEFT JOIN public.fabrics fabric ON fabric.id=fs.fabric_id LEFT JOIN public.materials material ON material.id=line.material_id
 $q$;
 WHEN 'production_jobs' THEN source_sql:=$q$ SELECT j.id::text row_key,j.created_at event_at,to_jsonb(j)||jsonb_build_object('product',public.production_job_document(j.id)->>'product','pieces',public.production_specifications(j.id),'design',public.production_job_document(j.id)->>'design','factory',f.name,'section',s.name,'tailor',t.real_name,'received_pieces',(SELECT count(*) FROM public.finished_products WHERE production_job_id=j.id),'latest_cost_version_id',(SELECT id FROM public.production_cost_versions WHERE production_job_id=j.id ORDER BY revision DESC LIMIT 1)) data FROM public.production_jobs j JOIN public.products p ON p.id=j.product_id LEFT JOIN public.designs d ON d.id=j.design_id JOIN public.tailor_assignments a ON a.id=j.tailor_assignment_id JOIN public.tailoring_factories f ON f.id=a.factory_id LEFT JOIN public.tailoring_sections s ON s.id=a.section_id JOIN public.tailors t ON t.id=a.tailor_id $q$;
 WHEN 'production_costs' THEN source_sql:=$q$ SELECT v.id::text row_key,v.recorded_at event_at,to_jsonb(v)||jsonb_build_object('job',j.code,'finalized',EXISTS(SELECT 1 FROM public.production_cost_requests WHERE result_id=v.id AND payload ? 'materials'),'total_paise',(SELECT coalesce(sum(amount_paise),0)::text FROM public.production_cost_lines WHERE cost_version_id=v.id),'components',(SELECT jsonb_agg(to_jsonb(l)||jsonb_build_object('input',to_jsonb(input)) ORDER BY l.id) FROM public.production_cost_lines l LEFT JOIN public.production_cost_inputs input ON input.cost_line_id=l.id WHERE l.cost_version_id=v.id),'allocations',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.finished_product_id) FROM public.finished_product_cost_allocations a WHERE a.cost_version_id=v.id)) data FROM public.production_cost_versions v JOIN public.production_jobs j ON j.id=v.production_job_id $q$;
 WHEN 'finished_products' THEN source_sql:=$q$ SELECT p.id::text row_key,p.created_at event_at,jsonb_build_object('id',p.id,'barcode',b.code,'product',product.name,'design',public.production_piece_context(p.id)->>'design','size',public.production_piece_context(p.id)->>'size','job',j.code,'piece_number',p.piece_number,'status',p.status,'location',l.name,'location_id',l.id,'quantity',CASE WHEN i.id IS NOT NULL THEN public.inventory_balance(i.id,p.current_location_id)::text END,'sp_paise',price.sp_paise::text,'production_cost_paise',(SELECT a.amount_paise::text FROM public.finished_product_cost_allocations a JOIN public.production_cost_versions v ON v.id=a.cost_version_id WHERE a.finished_product_id=p.id ORDER BY v.revision DESC LIMIT 1)) data FROM public.finished_products p JOIN public.barcodes b ON b.id=p.barcode_id JOIN public.products product ON product.id=p.product_id LEFT JOIN public.designs d ON d.id=p.design_id JOIN public.production_jobs j ON j.id=p.production_job_id JOIN public.locations l ON l.id=p.current_location_id LEFT JOIN public.inventory_items i ON i.finished_product_id=p.id LEFT JOIN LATERAL(SELECT * FROM public.finished_product_prices WHERE finished_product_id=p.id ORDER BY revision DESC LIMIT 1) price ON true $q$;
 WHEN 'transfers' THEN source_sql:=$q$ SELECT line.id::text row_key,t.posted_at event_at,to_jsonb(line)||jsonb_build_object('transfer',t.code,'status',t.status,'source',source.name,'destination',destination.name,'reason',t.reason,'actor_id',t.created_by,'posted_at',t.posted_at,'quantity',line.quantity::text) data FROM public.stock_transfer_lines line JOIN public.stock_transfers t ON t.id=line.transfer_id JOIN public.locations source ON source.id=t.source_location_id JOIN public.locations destination ON destination.id=t.destination_location_id $q$;
 WHEN 'movements' THEN source_sql:=$q$ SELECT m.id::text row_key,m.occurred_at event_at,to_jsonb(m)||jsonb_build_object('source',source.name,'destination',destination.name,'actor',p.full_name,'quantity',m.quantity::text) data FROM public.inventory_movements m LEFT JOIN public.locations source ON source.id=m.source_location_id LEFT JOIN public.locations destination ON destination.id=m.destination_location_id LEFT JOIN public.profiles p ON p.id=m.actor_id $q$;
 WHEN 'orders' THEN source_sql:=$q$
 SELECT o.id::text row_key,CASE WHEN o.status='completed' AND coalesce(payment.paid_at,o.payment_confirmed_at) IS NOT NULL AND o.kind IN('direct_fabric_sale','finished_product_sale','ecommerce_sale','counter_bill') THEN coalesce(payment.paid_at,o.completed_at) ELSE o.created_at END event_at,to_jsonb(o)-'sale_request_payload'-'tailoring_request_payload'||jsonb_build_object('source',CASE WHEN (SELECT count(DISTINCT source_location_id) FROM public.ecommerce_sale_sources s JOIN public.order_items i ON i.id=s.order_item_id WHERE i.order_id=o.id)>1 THEN 'Multiple Showroom floors' ELSE l.name END,'source_names',(SELECT jsonb_agg(DISTINCT loc.name) FROM public.ecommerce_sale_sources s JOIN public.order_items i ON i.id=s.order_item_id JOIN public.locations loc ON loc.id=s.source_location_id WHERE i.order_id=o.id),'payment_confirmed_at',coalesce(payment.paid_at,o.payment_confirmed_at),'completed_at',CASE WHEN payment.bill_id IS NOT NULL THEN payment.paid_at ELSE o.completed_at END,'channel',(SELECT channel FROM public.sale_analysis_channels WHERE order_id=o.id),'final_customer_price_paise',o.final_customer_price_paise::text,'revenue_state',CASE WHEN o.status='completed' AND coalesce(payment.paid_at,o.payment_confirmed_at) IS NOT NULL THEN 'payment_confirmed' WHEN o.kind='customer_tailoring' THEN 'customer_tailoring_booking' ELSE 'not_payment_confirmed' END,'items',(SELECT jsonb_agg(to_jsonb(it)||jsonb_build_object('quantity',it.quantity::text,'sp_snapshot_paise',it.sp_snapshot_paise::text,'final_customer_price_paise',it.final_customer_price_paise::text,'financial_snapshot',to_jsonb(fi),'finished_sale_snapshot',to_jsonb(snapshot)) ORDER BY it.id) FROM public.order_items it LEFT JOIN public.order_item_financials fi ON fi.order_item_id=it.id LEFT JOIN public.finished_product_sale_snapshots snapshot ON snapshot.order_item_id=it.id WHERE it.order_id=o.id)) data FROM public.orders o LEFT JOIN public.counter_bill_payments payment ON payment.bill_id=o.id JOIN public.locations l ON l.id=o.source_location_id
 $q$;
 WHEN 'production_history' THEN source_sql:=$q$ SELECT 'status:'||e.id::text row_key,e.recorded_at event_at,to_jsonb(e)||jsonb_build_object('kind','status','job',j.code) data FROM public.production_status_events e JOIN public.production_jobs j ON j.id=e.job_id UNION ALL SELECT 'receipt:'||p.finished_product_id::text,r.recorded_at,to_jsonb(r)-'payload'||jsonb_build_object('kind','workshop_receipt','piece_id',p.finished_product_id,'job',j.code) FROM public.finished_product_receipt_pieces p JOIN public.finished_product_receipts r ON r.request_id=p.request_id JOIN public.production_jobs j ON j.id=r.production_job_id $q$;
 WHEN 'reconciliation' THEN source_sql:=$q$ SELECT id::text row_key,created_at event_at,to_jsonb(t) data FROM public.domain_reconciliation t $q$;
 WHEN 'controls' THEN source_sql:=$q$
 SELECT 'legacy:'||id::text row_key,NULL::timestamptz event_at,to_jsonb(t)||jsonb_build_object('control','unresolved_legacy') data FROM public.domain_reconciliation t WHERE resolved_at IS NULL
 UNION ALL SELECT 'than:'||th.id::text,NULL::timestamptz,jsonb_build_object('control','unreconciled_than','id',th.id,'fabric_stock_id',th.fabric_stock_id,'status',th.status) FROM public.thaans th WHERE th.status<>'draft' AND NOT EXISTS(SELECT 1 FROM public.inventory_items WHERE thaan_id=th.id)
 UNION ALL SELECT 'piece:'||p.id::text,NULL::timestamptz,jsonb_build_object('control','finished_stock_mismatch','id',p.id,'status',p.status,'location_id',p.current_location_id) FROM public.finished_products p LEFT JOIN public.inventory_items i ON i.finished_product_id=p.id WHERE i.id IS NULL OR (p.status='available' AND (public.inventory_balance(i.id,NULL)<>1 OR public.inventory_balance(i.id,p.current_location_id)<>1)) OR (p.status<>'available' AND public.inventory_balance(i.id,NULL)<>0)
 UNION ALL SELECT 'price:'||p.id::text,NULL::timestamptz,jsonb_build_object('control','available_piece_without_sp','id',p.id,'job_id',p.production_job_id) FROM public.finished_products p WHERE status='available' AND NOT EXISTS(SELECT 1 FROM public.finished_product_prices WHERE finished_product_id=p.id)
 UNION ALL SELECT 'receipt:'||j.id::text,NULL::timestamptz,jsonb_build_object('control','completed_job_not_received','id',j.id,'code',j.code) FROM public.production_jobs j WHERE status='completed' AND NOT EXISTS(SELECT 1 FROM public.finished_product_receipts WHERE production_job_id=j.id)
 UNION ALL SELECT 'cost:'||r.production_job_id::text,NULL::timestamptz,jsonb_build_object('control','received_job_without_final_cost','id',r.production_job_id) FROM public.finished_product_receipts r WHERE NOT EXISTS(SELECT 1 FROM public.production_cost_versions v JOIN public.production_cost_requests request ON request.result_id=v.id AND request.payload ? 'materials' WHERE v.production_job_id=r.production_job_id)
 UNION ALL SELECT 'negative:'||inventory_item_id::text||':'||location_id::text,NULL::timestamptz,to_jsonb(b)||jsonb_build_object('control','negative_location_balance') FROM public.v_inventory_location_balances b WHERE quantity<0
 $q$;
 WHEN 'access' THEN source_sql:=$q$ SELECT p.id::text row_key,NULL::timestamptz event_at,to_jsonb(p)||jsonb_build_object('roles',(SELECT jsonb_agg(role_key ORDER BY role_key) FROM public.user_roles WHERE user_id=p.id),'permission_overrides',(SELECT jsonb_agg(to_jsonb(o) ORDER BY permission_key) FROM public.user_permission_overrides o WHERE user_id=p.id)) data FROM public.profiles p $q$;
 WHEN 'audit' THEN source_sql:=$q$ SELECT to_char(a.occurred_at AT TIME ZONE 'UTC','YYYYMMDDHH24MISSUS')||':erp:'||a.id::text row_key,a.occurred_at event_at,to_jsonb(a)||jsonb_build_object('source','canonical','actor',p.full_name) data FROM public.erp_audit_records a LEFT JOIN public.profiles p ON p.id=a.actor_id UNION ALL SELECT to_char(created_at AT TIME ZONE 'UTC','YYYYMMDDHH24MISSUS')||':legacy:'||id::text,created_at,to_jsonb(a)||jsonb_build_object('source','legacy','previous_value',NULL,'new_value',detail) FROM public.audit_log a $q$;
 WHEN 'sales_lines' THEN source_sql:=$q$ SELECT row_key,event_at,data FROM public.business_sale_facts($1,$2) $q$;
 WHEN 'legacy_sales' THEN source_sql:=$q$ SELECT s.id::text row_key,s.created_at event_at,to_jsonb(s)||jsonb_build_object('source','legacy_only','items',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.sale_items i WHERE i.sale_id=s.id)) data FROM public.sales s $q$;
 WHEN 'legacy_tailoring' THEN source_sql:=$q$ SELECT j.id::text row_key,j.created_at event_at,to_jsonb(j)||jsonb_build_object('source','legacy_only','lines',(SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM public.tailoring_job_lines l WHERE l.job_id=j.id)) data FROM public.tailoring_jobs j $q$;
 WHEN 'legacy_movements' THEN source_sql:=$q$ SELECT m.id::text row_key,m.created_at event_at,to_jsonb(m)||jsonb_build_object('source','legacy_only') data FROM public.stock_movements m $q$;
 ELSE RAISE EXCEPTION 'Unknown Owner report dataset';
 END CASE;
 -- Stock/configuration rows without a meaningful event date are explicitly
 -- current snapshots and remain visible regardless of the transaction window.
 snapshot_dataset:=p_dataset IN('stock','fabric_stock','batches','thans','consumables','configuration','finished_products','access','controls');
 source_sql:='SELECT * FROM ('||source_sql||') report WHERE ('||snapshot_dataset::text||' OR event_at IS NULL OR (($1 IS NULL OR event_at>=$1) AND ($2 IS NULL OR event_at<$2))) AND ($4 IS NULL OR position(lower($4) in lower(data::text))>0)';
 EXECUTE 'SELECT count(*) FROM ('||source_sql||') report' INTO total_value USING p_from,p_to,p_after,nullif(btrim(p_search),'');
 order_sql:=CASE WHEN p_dataset='audit' THEN ' DESC' ELSE ' ASC' END; cursor_operator:=CASE WHEN p_dataset='audit' THEN '<' ELSE '>' END; last_aggregate:=CASE WHEN p_dataset='audit' THEN 'min' ELSE 'max' END;
 EXECUTE 'SELECT coalesce(jsonb_agg(jsonb_build_object(''key'',row_key,''event_at'',event_at,''data'',data) ORDER BY row_key'||order_sql||'),''[]''),'||last_aggregate||'(row_key) FROM (SELECT * FROM ('||source_sql||') filtered WHERE ($3 IS NULL OR row_key'||cursor_operator||'$3) ORDER BY row_key'||order_sql||' LIMIT $5) page' INTO rows_value,last_key USING p_from,p_to,p_after,nullif(btrim(p_search),''),p_limit;
 RETURN jsonb_build_object('dataset',p_dataset,'rows',rows_value,'total_rows',total_value::text,'next_cursor',CASE WHEN jsonb_array_length(rows_value)=p_limit THEN last_key END,'from',p_from,'to_exclusive',p_to,'stock_basis','current_canonical_ledger','date_basis',CASE WHEN snapshot_dataset THEN 'current_snapshot' ELSE 'event_range' END);
END; $$;
CREATE OR REPLACE FUNCTION public.owner_barcode_inspect(p_barcode text, p_before timestamptz DEFAULT NULL,
 p_before_key text DEFAULT NULL, p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $inspect$
DECLARE result jsonb;
BEGIN
 IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501'; END IF;
 IF p_barcode IS NULL OR length(btrim(p_barcode)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Enter a barcode up to 200 characters'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR (p_before IS NULL)<>(p_before_key IS NULL) OR length(p_before_key)>300 THEN RAISE EXCEPTION 'Invalid history cursor or limit'; END IF;
 WITH root AS MATERIALIZED (
  SELECT 'fabric'::text kind, s.id FROM public.fabric_stock s JOIN public.barcodes b ON b.id=s.barcode_id WHERE b.code=btrim(p_barcode)
  UNION ALL SELECT 'legacy_thaan',id FROM public.thaans WHERE barcode=btrim(p_barcode)
  UNION ALL SELECT 'piece',p.id FROM public.finished_products p JOIN public.barcodes b ON b.id=p.barcode_id WHERE b.code=btrim(p_barcode)
  UNION ALL SELECT 'production',id FROM public.production_jobs WHERE code=btrim(p_barcode) OR id::text=btrim(p_barcode)
  UNION ALL SELECT 'order',id FROM public.orders WHERE code=btrim(p_barcode) OR id::text=btrim(p_barcode)
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
  SELECT j.* FROM public.customer_tailoring_jobs j WHERE j.id IN(SELECT o.customer_tailoring_job_id FROM public.orders o WHERE o.id IN(SELECT id FROM root WHERE kind='order') UNION SELECT customer_tailoring_job_id FROM public.order_items WHERE order_id IN(SELECT id FROM root WHERE kind='order') UNION SELECT i.customer_tailoring_job_id FROM public.material_issues i JOIN public.material_issue_lines l ON l.material_issue_id=i.id WHERE l.thaan_id IN(SELECT id FROM selected_thaans) UNION SELECT customer_tailoring_job_id FROM public.inventory_movements WHERE thaan_id IN(SELECT id FROM selected_thaans))
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
END; $inspect$;
NOTIFY pgrst,'reload schema';
COMMIT;
