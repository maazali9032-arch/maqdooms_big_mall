import fs from "node:fs/promises";

// Each entry is an existing evidence table and its explicit relational scope.
// No operational RPCs, guessed historical balances, synthetic events or writes.
const sources = [
  [
    "barcodes",
    "id IN (SELECT barcode_id FROM selected_stocks UNION SELECT barcode_id FROM selected_pieces)",
    "created_at",
    "created_by",
    "Barcode registered",
  ],
  ["thaans", "id IN (SELECT id FROM selected_thaans)", "created_at", "created_by", "Thaan record"],
  [
    "fabric_stock",
    "id IN (SELECT id FROM selected_stocks)",
    "created_at",
    "created_by",
    "Fabric stock record",
  ],
  [
    "receiving_batches",
    "id IN (SELECT batch_id FROM selected_thaans)",
    "created_at",
    "created_by",
    "Receiving batch",
  ],
  [
    "stock_registration_variants",
    "thaan_id IN (SELECT id FROM selected_thaans)",
    "created_at",
    "created_by",
    "Physical barcode registered",
  ],
  [
    "fabric_stock_costs",
    "fabric_stock_id IN (SELECT id FROM cost_stocks)",
    "recorded_at",
    "recorded_by",
    "Fabric CP / lagat revision",
  ],
  [
    "fabric_stock_prices",
    "fabric_stock_id IN (SELECT id FROM selected_stocks)",
    "recorded_at",
    "recorded_by",
    "Fabric SP revision",
  ],
  [
    "thaan_costs",
    "thaan_id IN (SELECT id FROM selected_thaans)",
    "updated_at",
    "updated_by",
    "Legacy CP record (current saved value)",
    "thaan_id",
  ],
  [
    "material_issues",
    "id IN (SELECT id FROM selected_issues)",
    "issued_at",
    "issued_by",
    "Material issue",
  ],
  [
    "material_issue_lines",
    "material_issue_id IN (SELECT id FROM selected_issues)",
    "NULL",
    "NULL",
    "Issued material line",
  ],
  [
    "production_jobs",
    "id IN (SELECT id FROM selected_jobs)",
    "created_at",
    "created_by",
    "Linked production",
  ],
  [
    "production_status_events",
    "job_id IN (SELECT id FROM selected_jobs)",
    "recorded_at",
    "actor_id",
    "Production status recorded",
  ],
  [
    "finished_products",
    "id IN (SELECT id FROM selected_pieces)",
    "created_at",
    "NULL",
    "Finished product record",
  ],
  [
    "finished_product_receipts",
    "production_job_id IN (SELECT id FROM selected_jobs)",
    "recorded_at",
    "actor_id",
    "Workshop finished receipt",
    "request_id",
  ],
  [
    "finished_product_materials",
    "finished_product_id IN (SELECT id FROM selected_pieces)",
    "NULL",
    "NULL",
    "Recorded piece material allocation",
  ],
  [
    "production_issue_fabric_costs",
    "issue_line_id IN (SELECT id FROM material_issue_lines WHERE material_issue_id IN (SELECT id FROM selected_issues))",
    "recorded_at",
    "NULL",
    "Issue-time fabric CP snapshot",
    "issue_line_id",
  ],
  [
    "production_cost_versions",
    "production_job_id IN (SELECT id FROM selected_jobs)",
    "recorded_at",
    "recorded_by",
    "Production cost revision",
  ],
  [
    "production_cost_lines",
    "cost_version_id IN (SELECT id FROM production_cost_versions WHERE production_job_id IN (SELECT id FROM selected_jobs))",
    "recorded_at",
    "NULL",
    "Recorded production cost component",
  ],
  [
    "finished_product_cost_allocations",
    "finished_product_id IN (SELECT id FROM selected_pieces)",
    "recorded_at",
    "NULL",
    "Piece CP allocation",
  ],
  [
    "finished_product_prices",
    "finished_product_id IN (SELECT id FROM selected_pieces)",
    "recorded_at",
    "recorded_by",
    "Finished product SP revision",
  ],
  [
    "stock_transfers",
    "id IN (SELECT transfer_id FROM selected_transfer_lines)",
    "created_at",
    "created_by",
    "Transfer document",
  ],
  [
    "stock_transfer_lines",
    "id IN (SELECT id FROM selected_transfer_lines)",
    "NULL",
    "NULL",
    "Transferred item line",
  ],
  [
    "customer_tailoring_jobs",
    "id IN (SELECT id FROM selected_custom_jobs)",
    "created_at",
    "created_by",
    "Linked customer tailoring",
  ],
  [
    "customer_tailoring_prices",
    "job_id IN (SELECT id FROM selected_custom_jobs)",
    "recorded_at",
    "recorded_by",
    "Recorded tailoring cost / price revision",
  ],
  [
    "counter_tailoring_prices",
    "job_id IN (SELECT id FROM selected_custom_jobs)",
    "recorded_at",
    "recorded_by",
    "Counter tailoring price snapshot",
    "job_id",
  ],
  [
    "orders",
    "id IN (SELECT id FROM selected_orders)",
    "created_at",
    "created_by",
    "Linked order / bill",
  ],
  [
    "order_items",
    "order_id IN (SELECT id FROM selected_orders) AND (thaan_id IN (SELECT id FROM selected_thaans) OR finished_product_id IN (SELECT id FROM selected_pieces) OR customer_tailoring_job_id IN (SELECT id FROM selected_custom_jobs) OR EXISTS(SELECT 1 FROM root WHERE kind='order' AND id=order_id))",
    "NULL",
    "NULL",
    "Linked order line",
  ],
  [
    "order_item_financials",
    "order_item_id IN (SELECT id FROM order_items WHERE order_id IN (SELECT id FROM selected_orders))",
    "recorded_at",
    "NULL",
    "Sale cost snapshot",
    "order_item_id",
  ],
  [
    "finished_product_sale_snapshots",
    "order_item_id IN (SELECT id FROM order_items WHERE finished_product_id IN (SELECT id FROM selected_pieces))",
    "recorded_at",
    "NULL",
    "Finished sale snapshot",
    "order_item_id",
  ],
  [
    "ecommerce_paid_receipts",
    "order_id IN (SELECT id FROM selected_orders)",
    "recorded_at",
    "NULL",
    "E-commerce payment receipt",
    "order_id",
  ],
  [
    "sales",
    "id IN (SELECT sale_id FROM sale_items WHERE thaan_id IN (SELECT id FROM selected_thaans))",
    "created_at",
    "user_id",
    "Legacy sale",
  ],
  [
    "sale_items",
    "thaan_id IN (SELECT id FROM selected_thaans)",
    "NULL",
    "NULL",
    "Legacy sale line",
  ],
  [
    "tailoring_jobs",
    "id IN (SELECT job_id FROM tailoring_job_lines WHERE thaan_id IN (SELECT id FROM selected_thaans))",
    "created_at",
    "created_by",
    "Legacy tailoring record",
  ],
  [
    "tailoring_job_lines",
    "thaan_id IN (SELECT id FROM selected_thaans)",
    "created_at",
    "NULL",
    "Legacy tailoring material line",
  ],
];
// Optional columns are read from the recorded JSON; missing actor/time stays NULL.
const eventSql = sources
  .map(
    ([table, condition, time, actor, label, key = "id"]) => `
 SELECT '${table}:'||r.${key} AS key, '${table}'::text AS source, r.${key} AS record_id,
 ${time === "NULL" ? "NULL::timestamptz" : `(to_jsonb(r)->>'${time}')::timestamptz`} AS event_at,
 ${actor === "NULL" ? "NULL::uuid" : `(to_jsonb(r)->>'${actor}')::uuid`} AS actor_id,
 '${label}'::text AS title, to_jsonb(r) AS data
 FROM public.${table} r WHERE ${condition}`,
  )
  .join("\n UNION ALL\n");
const sql = `-- Owner-only read-only inspection of recorded barcode evidence. No data changes.
BEGIN;
-- Preserve exact numeric evidence (including nested historical cost snapshots).
CREATE FUNCTION public.barcode_inspector_json(p_value jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $exact$
DECLARE result jsonb;
BEGIN
 CASE jsonb_typeof(p_value)
 WHEN 'object' THEN SELECT coalesce(jsonb_object_agg(key,public.barcode_inspector_json(value)),'{}'::jsonb) INTO result FROM jsonb_each(p_value);
 WHEN 'array' THEN SELECT coalesce(jsonb_agg(public.barcode_inspector_json(value) ORDER BY ord),'[]'::jsonb) INTO result FROM jsonb_array_elements(p_value) WITH ORDINALITY e(value,ord);
 WHEN 'number' THEN result:=to_jsonb(p_value#>>'{}');
 ELSE result:=p_value;
 END CASE;
 RETURN result;
END; $exact$;
REVOKE ALL ON FUNCTION public.barcode_inspector_json(jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.owner_barcode_inspect(p_barcode text, p_before timestamptz DEFAULT NULL,
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
   OR t.id IN(SELECT l.thaan_id FROM public.material_issue_lines l JOIN public.material_issues i ON i.id=l.material_issue_id WHERE i.production_job_id IN(SELECT id FROM root WHERE kind='production') OR i.customer_tailoring_job_id IN(SELECT o.customer_tailoring_job_id FROM public.orders o WHERE o.id IN(SELECT id FROM root WHERE kind='order')))
   OR t.id IN(SELECT thaan_id FROM public.order_items WHERE order_id IN(SELECT id FROM root WHERE kind='order'))
 ), selected_stocks AS MATERIALIZED (
  SELECT s.* FROM public.fabric_stock s WHERE s.id IN(SELECT fabric_stock_id FROM selected_thaans) OR s.id IN(SELECT id FROM root WHERE kind='fabric')
 ), selected_pieces AS MATERIALIZED (
  SELECT p.* FROM public.finished_products p WHERE p.id IN(SELECT id FROM root WHERE kind='piece') OR p.production_job_id IN(SELECT id FROM root WHERE kind='production') OR p.id IN(SELECT finished_product_id FROM public.order_items WHERE order_id IN(SELECT id FROM root WHERE kind='order'))
 ), selected_jobs AS MATERIALIZED (
  SELECT j.* FROM public.production_jobs j WHERE j.id IN(SELECT id FROM root WHERE kind='production' UNION SELECT production_job_id FROM selected_pieces UNION SELECT i.production_job_id FROM public.material_issues i JOIN public.material_issue_lines l ON l.material_issue_id=i.id WHERE l.thaan_id IN(SELECT id FROM selected_thaans))
 ), selected_custom_jobs AS MATERIALIZED (
  SELECT j.* FROM public.customer_tailoring_jobs j WHERE j.id IN(SELECT o.customer_tailoring_job_id FROM public.orders o WHERE o.id IN(SELECT id FROM root WHERE kind='order') UNION SELECT i.customer_tailoring_job_id FROM public.material_issues i JOIN public.material_issue_lines l ON l.material_issue_id=i.id WHERE l.thaan_id IN(SELECT id FROM selected_thaans) UNION SELECT customer_tailoring_job_id FROM public.inventory_movements WHERE thaan_id IN(SELECT id FROM selected_thaans))
 ), selected_issues AS MATERIALIZED (
  SELECT i.* FROM public.material_issues i WHERE i.production_job_id IN(SELECT id FROM selected_jobs) OR i.customer_tailoring_job_id IN(SELECT id FROM selected_custom_jobs)
 ), cost_stocks AS MATERIALIZED (
  SELECT s.* FROM public.fabric_stock s WHERE s.id IN(SELECT id FROM selected_stocks UNION SELECT fabric_stock_id FROM public.material_issue_lines WHERE material_issue_id IN(SELECT id FROM selected_issues))
 ), selected_orders AS MATERIALIZED (
  SELECT o.* FROM public.orders o WHERE o.id IN(SELECT id FROM root WHERE kind='order') OR o.id IN(SELECT order_id FROM public.order_items WHERE thaan_id IN(SELECT id FROM selected_thaans) OR finished_product_id IN(SELECT id FROM selected_pieces)) OR o.customer_tailoring_job_id IN(SELECT id FROM selected_custom_jobs)
 ), selected_transfer_lines AS MATERIALIZED (
  SELECT l.* FROM public.stock_transfer_lines l WHERE l.thaan_id IN(SELECT id FROM selected_thaans) OR l.finished_product_id IN(SELECT id FROM selected_pieces)
 ), records AS MATERIALIZED (
 ${eventSql}
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
 FROM public.audit_log a WHERE a.entity_ref=btrim(p_barcode) OR EXISTS(SELECT 1 FROM records r WHERE r.source=a.entity AND r.record_id::text=a.entity_ref)
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
 UNION ALL SELECT jsonb_build_object('kind','finished_product','id',p.id,'name',product.name,'barcode',b.code,'design',coalesce(d.name,j.custom_design),'size',j.size,'production_code',j.code,'piece',to_jsonb(p),'latest_cp_paise',(SELECT a.amount_paise::text FROM public.finished_product_cost_allocations a JOIN public.production_cost_versions v ON v.id=a.cost_version_id WHERE a.finished_product_id=p.id ORDER BY v.revision DESC LIMIT 1),'latest_sp_paise',(SELECT sp_paise::text FROM public.finished_product_prices WHERE finished_product_id=p.id ORDER BY revision DESC LIMIT 1))
 FROM selected_pieces p JOIN public.barcodes b ON b.id=p.barcode_id JOIN public.products product ON product.id=p.product_id LEFT JOIN public.designs d ON d.id=p.design_id JOIN public.production_jobs j ON j.id=p.production_job_id
 )
 SELECT jsonb_build_object('barcode',btrim(p_barcode),'status',CASE WHEN (SELECT count(*) FROM root)=0 THEN 'unknown' WHEN (SELECT count(*) FROM root)>1 THEN 'ambiguous' ELSE 'found' END,
 'matches',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM root r),'[]'::jsonb),
 'items',coalesce((SELECT jsonb_agg(public.barcode_inspector_json(data) ORDER BY data->>'id') FROM item_details),'[]'::jsonb),
 'current_stock',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.inventory_item_id) FROM current_stock c),'[]'::jsonb),
 'linked_records',coalesce((SELECT jsonb_agg(jsonb_build_object('key',r.key,'source',r.source,'title',r.title,'event_at',r.event_at,'actor_id',r.actor_id,'actor',p.full_name,'data',public.barcode_inspector_json(r.data)) ORDER BY r.source,r.key) FROM records r LEFT JOIN public.profiles p ON p.id=r.actor_id WHERE r.source IN('production_jobs','customer_tailoring_jobs','orders','material_issues')),'[]'::jsonb),
 'undated_records',coalesce((SELECT jsonb_agg(jsonb_build_object('key',key,'source',source,'title',title,'data',public.barcode_inspector_json(data)) ORDER BY key) FROM evidence WHERE event_at IS NULL),'[]'::jsonb),
 'events',coalesce((SELECT jsonb_agg(jsonb_build_object('key',p.key,'source',p.source,'title',p.title,'event_at',p.event_at,'actor_id',p.actor_id,'actor',pr.full_name,'data',public.barcode_inspector_json(p.data)) ORDER BY p.event_at DESC,p.key DESC) FROM page p LEFT JOIN public.profiles pr ON pr.id=p.actor_id),'[]'::jsonb),
 'next_cursor',CASE WHEN EXISTS(SELECT 1 FROM dated d WHERE (d.event_at,d.key)<(SELECT event_at,key FROM page ORDER BY event_at,key LIMIT 1)) THEN (SELECT jsonb_build_object('before',event_at,'key',key) FROM page ORDER BY event_at,key LIMIT 1) ELSE NULL END,
 'total_events',(SELECT count(*) FROM dated),'inspected_at',statement_timestamp(),
 'history_note','Only recorded evidence is shown. Catalogue names and stock balances are current. Related job documents can cover other materials or pieces; they are not additional stock for this barcode. Missing previous values, costs, timestamps or users are not reconstructed.') INTO result;
 IF result->>'status'<>'found' THEN RETURN jsonb_build_object('barcode',btrim(p_barcode),'status',result->>'status','matches',result->'matches'); END IF;
 RETURN result;
END; $inspect$;
REVOKE ALL ON FUNCTION public.owner_barcode_inspect(text,timestamptz,text,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.owner_barcode_inspect(text,timestamptz,text,integer) TO authenticated;
COMMIT;
`;
await fs.writeFile("supabase/migrations/20261015000100_owner_barcode_inspector.sql", sql);
await fs.writeFile("drizzle/migrations/0043_owner_barcode_inspector.sql", sql);
