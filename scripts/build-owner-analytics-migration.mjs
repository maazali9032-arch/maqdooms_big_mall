import fs from "node:fs/promises";
import assert from "node:assert/strict";
const previous = (
  await fs.readFile("supabase/migrations/20261011000200_salesperson_tailoring_pricing.sql", "utf8")
).replaceAll("\r\n", "\n");
let definition = previous.match(
  /CREATE OR REPLACE FUNCTION public\.owner_erp_report\([\s\S]*?END; \$\$;/,
)?.[0];
assert(definition, "Canonical Owner evidence function not found");
definition = definition
  .replaceAll(" JOIN public.designs ", " LEFT JOIN public.designs ")
  .replaceAll("'design',d.name", "'design',coalesce(d.name,j.custom_design)");
definition = definition.replace(
  " WHEN 'legacy_sales'",
  () =>
    " WHEN 'sales_lines' THEN source_sql:=$q$ SELECT row_key,event_at,data FROM public.business_sale_facts($1,$2) $q$;\n WHEN 'legacy_sales'",
);
assert(definition.includes("WHEN 'sales_lines'"));
const ledger = (
  await fs.readFile("supabase/migrations/20261003000200_phase3_locations_ledger.sql", "utf8")
).replaceAll("\r\n", "\n");
let guard = ledger.match(
  /CREATE FUNCTION public\.guard_inventory_movement\(\)[\s\S]*?END; \$\$;/,
)?.[0];
assert(guard, "Canonical stock ledger guard");
guard = guard.replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION");
const oldSource =
  "o.kind IN ('direct_fabric_sale','finished_product_sale') AND o.source_location_id=NEW.source_location_id";
assert(guard.includes(oldSource));
guard = guard.replace(
  oldSource,
  "((o.kind IN ('direct_fabric_sale','finished_product_sale') AND o.source_location_id=NEW.source_location_id) OR (o.kind='ecommerce_sale' AND EXISTS(SELECT 1 FROM public.ecommerce_sale_sources s JOIN public.ecommerce_paid_receipts receipt ON receipt.order_id=o.id WHERE s.order_item_id=l.id AND s.source_location_id=NEW.source_location_id AND receipt.recorded_by=NEW.actor_id)))",
);
definition = definition.replace(
  "'source',l.name,'final_customer_price_paise'",
  "'source',CASE WHEN (SELECT count(DISTINCT source_location_id) FROM public.ecommerce_sale_sources s JOIN public.order_items i ON i.id=s.order_item_id WHERE i.order_id=o.id)>1 THEN 'Multiple Showroom floors' ELSE l.name END,'source_names',(SELECT jsonb_agg(DISTINCT loc.name) FROM public.ecommerce_sale_sources s JOIN public.order_items i ON i.id=s.order_item_id JOIN public.locations loc ON loc.id=s.source_location_id WHERE i.order_id=o.id),'channel',(SELECT channel FROM public.sale_analysis_channels WHERE order_id=o.id),'final_customer_price_paise'",
);
definition = definition.replace(
  "SELECT o.id::text row_key,o.created_at event_at",
  "SELECT o.id::text row_key,CASE WHEN o.status='completed' AND o.payment_confirmed_at IS NOT NULL AND o.kind IN('direct_fabric_sale','finished_product_sale','ecommerce_sale') THEN o.completed_at ELSE o.created_at END event_at",
);
const overviewSource = (
  await fs.readFile("supabase/migrations/20261004000600_phase15_owner_reporting_audit.sql", "utf8")
).replaceAll("\r\n", "\n");
let overview = overviewSource.match(
  /CREATE FUNCTION public\.owner_erp_overview\([\s\S]*?END; \$\$;/,
)?.[0];
assert(overview);
overview = overview.replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION");
overview = overview.replace(
  "SELECT kind,count(*)::text orders,sum(final_customer_price_paise)::text total_paise FROM public.orders WHERE status='completed' AND payment_confirmed_at IS NOT NULL AND kind IN('direct_fabric_sale','finished_product_sale') AND (p_from IS NULL OR completed_at>=p_from) AND (p_to IS NULL OR completed_at<p_to) GROUP BY kind",
  "SELECT data->>'kind' kind,count(DISTINCT data->>'order_id')::text orders,sum((data->>'revenue_paise')::numeric)::text total_paise FROM public.business_sale_facts(p_from,p_to) GROUP BY data->>'kind'",
);
const sql =
  "BEGIN;\n" +
  (await fs.readFile("scripts/ecommerce-paid-schema.sql", "utf8")) +
  "\n" +
  guard +
  "\n" +
  (await fs.readFile("scripts/owner-analytics-schema.sql", "utf8")) +
  "\n" +
  definition +
  "\n" +
  overview +
  "\nNOTIFY pgrst,'reload schema';\nCOMMIT;\n";
await fs.writeFile("supabase/migrations/20261014000100_owner_business_analytics.sql", sql);
await fs.writeFile("drizzle/migrations/0041_owner_business_analytics.sql", sql);
console.log("Generated matching forward Owner analytics migrations");
