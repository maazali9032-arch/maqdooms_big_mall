import {functionSQL,mirrorMigration} from './workflow-sql.mjs';
// Keep the latest role/source guards for callers still using the earlier billing API.
let fn=await functionSQL('supabase/migrations/20261014000000_role_workspaces.sql','complete_finished_product_sale');
fn=fn.replace("'design',coalesce(design.name,j.custom_design)","'design',public.production_piece_context(piece.id)->>'design','size',public.production_piece_context(piece.id)->>'size'");
fn=fn.replace('reviewed_id IS NULL OR cost_amount IS NULL','reviewed_id IS DISTINCT FROM cost_id OR cost_amount IS NULL');
await mirrorMigration('20261015000800','0050','finished_sale_compatibility','BEGIN;\n'+fn+"\nNOTIFY pgrst,'reload schema';\nCOMMIT;\n");
