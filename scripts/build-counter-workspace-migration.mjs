import fs from "node:fs/promises";
import { functionSQL, mirrorMigration } from "./workflow-sql.mjs";
const pricing='supabase/migrations/20261011000200_salesperson_tailoring_pricing.sql';
const analytics='supabase/migrations/20261014000100_owner_business_analytics.sql';
let booking=await functionSQL(pricing,'book_counter_tailoring');
booking=booking.replace('public.book_counter_tailoring(', 'public.book_invoice_tailoring(')
 .replace(" SELECT jsonb_build_object('id',id,'name',name,'phone',phone,'whatsapp_phone',whatsapp_phone) INTO contact FROM public.customers WHERE id=p_customer FOR UPDATE;\n IF NOT FOUND THEN RAISE EXCEPTION 'Customer required'; END IF;", " IF p_customer IS NULL THEN contact:=jsonb_build_object('name',NULL,'phone',NULL);\n ELSE SELECT jsonb_build_object('id',id,'name',name,'phone',phone,'whatsapp_phone',whatsapp_phone) INTO contact FROM public.customers WHERE id=p_customer FOR UPDATE;\n IF NOT FOUND THEN RAISE EXCEPTION 'Customer required'; END IF; END IF;")
 .replace("'book_counter_tailoring'","'book_invoice_tailoring'");
booking+='\nREVOKE ALL ON FUNCTION public.book_invoice_tailoring(uuid,uuid,jsonb,bigint,uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;\n';
let movement=await functionSQL(analytics,'guard_inventory_movement');
movement=movement.replace("o.kind IN ('direct_fabric_sale','finished_product_sale')", "o.kind IN ('direct_fabric_sale','finished_product_sale','counter_bill') AND (o.kind<>'counter_bill' OR EXISTS(SELECT 1 FROM public.counter_bills cb WHERE cb.order_id=o.id AND cb.actor_id=NEW.actor_id))");
let dimensions=await functionSQL(analytics,'capture_sale_analysis_dimensions');
dimensions=dimensions.replace("NEW.payment_confirmed_at IS NOT NULL AND NEW.kind IN('direct_fabric_sale','finished_product_sale','ecommerce_sale')", "(NEW.payment_confirmed_at IS NOT NULL OR NEW.kind='counter_bill') AND NEW.kind IN('direct_fabric_sale','finished_product_sale','ecommerce_sale','counter_bill')");
let facts=await functionSQL(analytics,'business_sale_facts');
facts=facts.replace('o.completed_at',"CASE WHEN o.kind='counter_bill' THEN payment.paid_at ELSE o.completed_at END")
 .replace("'kind',CASE WHEN it.fabric_stock_id IS NOT NULL THEN 'direct_fabric_sale' ELSE 'finished_product_sale' END", "'kind',CASE WHEN it.fabric_stock_id IS NOT NULL THEN 'direct_fabric_sale' WHEN it.customer_tailoring_job_id IS NOT NULL THEN 'customer_tailoring' ELSE 'finished_product_sale' END,'payment_basis',CASE WHEN o.kind='counter_bill' THEN 'immutable_counter_receipt' ELSE 'completed_paid_sale' END")
 .replace("'payment_confirmed_at',o.payment_confirmed_at", "'payment_confirmed_at',coalesce(payment.paid_at,o.payment_confirmed_at)")
 .replace("ELSE 'sale_time_recorded_piece_CP' END", "WHEN it.customer_tailoring_job_id IS NOT NULL THEN 'current_recorded_job_fabric_CP_including_additional_issues' ELSE 'sale_time_recorded_piece_CP' END")
 .replace("WHEN it.finished_product_id IS NOT NULL THEN fi.production_cost_snapshot_paise::text END", "WHEN it.finished_product_id IS NOT NULL THEN fi.production_cost_snapshot_paise::text WHEN it.customer_tailoring_job_id IS NOT NULL THEN public.customer_job_fabric_cp(it.customer_tailoring_job_id)::text END")
 .replace("(it.final_customer_price_paise-fi.production_cost_snapshot_paise)::text END", "(it.final_customer_price_paise-fi.production_cost_snapshot_paise)::text WHEN it.customer_tailoring_job_id IS NOT NULL AND public.customer_job_fabric_cp(it.customer_tailoring_job_id) IS NOT NULL THEN (it.final_customer_price_paise-public.customer_job_fabric_cp(it.customer_tailoring_job_id))::text END")
 .replace('LEFT JOIN public.ecommerce_sale_sources actual_source', 'LEFT JOIN public.counter_bill_payments payment ON payment.bill_id=o.id LEFT JOIN public.ecommerce_sale_sources actual_source')
 .replace("o.payment_confirmed_at IS NOT NULL AND o.kind IN('direct_fabric_sale','finished_product_sale','ecommerce_sale')", "((o.kind='counter_bill' AND payment.bill_id IS NOT NULL) OR (o.kind<>'counter_bill' AND o.payment_confirmed_at IS NOT NULL)) AND o.kind IN('direct_fabric_sale','finished_product_sale','ecommerce_sale','counter_bill')");
let summary=await functionSQL(analytics,'business_sales_summary');
summary=summary.replace("'known_margin_paise',", "'tailoring_revenue_paise',coalesce(sum((data->>'revenue_paise')::numeric) FILTER(WHERE data->>'kind'='customer_tailoring'),0)::text,\n 'known_margin_paise',");
let report=await functionSQL(analytics,'owner_erp_report');
// Paid orders use immutable payment time; tailoring bookings remain separate.
const orderStart=report.indexOf("SELECT o.id::text row_key,");
const orderEnd=report.indexOf("$q$;",orderStart);
let order=report.slice(orderStart,orderEnd);
order=order.replaceAll('o.payment_confirmed_at IS NOT NULL',"coalesce(payment.paid_at,o.payment_confirmed_at) IS NOT NULL")
 .replaceAll("'finished_product_sale','ecommerce_sale'", "'finished_product_sale','ecommerce_sale','counter_bill'")
 .replace('THEN o.completed_at ELSE o.created_at END event_at', "THEN coalesce(payment.paid_at,o.completed_at) ELSE o.created_at END event_at")
 .replace("'channel',(SELECT channel", "'payment_confirmed_at',coalesce(payment.paid_at,o.payment_confirmed_at),'completed_at',CASE WHEN payment.bill_id IS NOT NULL THEN payment.paid_at ELSE o.completed_at END,'channel',(SELECT channel")
 .replace('FROM public.orders o JOIN public.locations', 'FROM public.orders o LEFT JOIN public.counter_bill_payments payment ON payment.bill_id=o.id JOIN public.locations');
report=report.slice(0,orderStart)+order+report.slice(orderEnd);
report=report.replace('JOIN public.customers c ON c.id=j.customer_id','LEFT JOIN public.customers c ON c.id=j.customer_id');
const domain=(await functionSQL('supabase/migrations/20261003000000_phase1_domain_model.sql','validate_domain_links')).replace('customer_id = NEW.customer_id','customer_id IS NOT DISTINCT FROM NEW.customer_id');
const sources=await fs.readFile('scripts/counter-workspace-schema.sql','utf8');
const reads=await fs.readFile('scripts/counter-workspace-read.sql','utf8');
const sql='BEGIN;\n'+sources+'\n'+domain+'\n'+booking+'\n'+reads+'\n'+[movement,dimensions,facts,summary,report].join('\n')+"\nNOTIFY pgrst,'reload schema';\nCOMMIT;\n";
await mirrorMigration('20261015000400','0046','counter_workspace',sql);
