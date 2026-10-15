import fs from 'node:fs/promises';import assert from 'node:assert/strict';
const source=(await fs.readFile('supabase/migrations/20261011000300_owner_production_workflow.sql','utf8')).replaceAll('\r\n','\n');
const definitions=['post_inventory_transfer','transfer_finished_products'].map(name=>{const d=source.match(new RegExp('CREATE OR REPLACE FUNCTION public\\.'+name+'\\([\\s\\S]*?END; \\$\\$;'))?.[0];assert(d);return d.replace('BEGIN\n',"BEGIN\n p_reason:=coalesce(nullif(btrim(p_reason),''),'Stock transfer (no optional note recorded)');\n");});
const sql='BEGIN;\n'+definitions.join('\n')+'\n'+await fs.readFile('scripts/workspace-cleanup-schema.sql','utf8')+"\nNOTIFY pgrst,'reload schema';\nCOMMIT;\n";
await fs.writeFile('supabase/migrations/20261015000300_workspace_cleanup.sql',sql);await fs.writeFile('drizzle/migrations/0045_workspace_cleanup.sql',sql);
