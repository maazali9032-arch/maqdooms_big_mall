/** Generate forward-only SQL from reviewed current function definitions. */
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const source = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
// Read the last published definitions for functions not in the read-only snapshot.
for (const file of [
  "20261012000200_workshop_inventory_hierarchy.sql",
  "20261013000100_module_role_scope.sql",
  "20261013000200_thaan_optional_colour_reason.sql",
]) {
  const body = await fs.readFile("supabase/migrations/" + file, "utf8");
  for (const match of body.matchAll(
    /CREATE (?:OR REPLACE )?FUNCTION public\.(\w+)\([\s\S]*?(?:\$function\$|\$\$)\s*;/g,
  )) {
    const name = match[1];
    source.definitions = source.definitions.filter((x) => x.name !== name);
    source.definitions.push({
      name,
      definition: match[0].slice(0, -1).replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION"),
    });
  }
}
let sql = `-- Approved seven-role workspaces. No business-data backfill or consumption inference.
BEGIN;
ALTER TABLE public.production_jobs ADD COLUMN size text CHECK(size IS NULL OR (btrim(size)<>'' AND length(size)<=40));
ALTER TABLE public.production_jobs ADD COLUMN custom_design text CHECK(custom_design IS NULL OR (btrim(custom_design)<>'' AND length(custom_design)<=120));
ALTER TABLE public.production_jobs ALTER COLUMN design_id DROP NOT NULL;
ALTER TABLE public.finished_products ALTER COLUMN design_id DROP NOT NULL;
INSERT INTO public.roles(key,label,description) VALUES('production','Production','Issue fabric and manage production batches') ON CONFLICT(key) DO NOTHING;
INSERT INTO public.permissions(key,label,domain) VALUES
 ('production.view','View production work','production'),
 ('production.create','Issue fabric and create production','production'),
 ('production.progress','Update production progress','production'),
 ('production.receive','Receive whole production batch and generate piece barcodes','production'),
 ('stock.price_finished','Set finished-product SP in Workshop','stock') ON CONFLICT(key) DO NOTHING;
INSERT INTO public.role_permissions(role_key,permission_key) VALUES
 ('production','production.view'),('production','production.create'),('production','production.progress'),
 ('stock_entry','production.receive'),('stock_entry','stock.price_finished'),
 ('counter','production.view'),('counter','production.create') ON CONFLICT DO NOTHING;
`;
const add = (name, changes = [], selector = () => true) => {
  let definition = source.definitions.find(
    (x) => x.name === name && selector(x.definition),
  )?.definition;
  assert(definition, "Missing function " + name);
  definition = definition.replaceAll("\r\n", "\n");
  for (const [from, to] of changes) {
    assert(definition.includes(from), "Missing replacement in " + name + ": " + from);
    definition = definition.replace(from, to);
  }
  if (
    [
      "owner_production_history",
      "finished_product_catalog",
      "finished_product_inventory",
      "finished_product_transfer_scan",
      "finished_product_order_history",
      "complete_finished_product_sale",
    ].includes(name)
  ) {
    definition = definition
      .replaceAll(" JOIN public.designs ", " LEFT JOIN public.designs ")
      .replaceAll("'design',d.name", "'design',coalesce(d.name,j.custom_design)")
      .replaceAll("'design',design.name", "'design',coalesce(design.name,j.custom_design)")
      .replaceAll(
        "snapshot.item_snapshot->>'design',design.name",
        "snapshot.item_snapshot->>'design',design.name,j.custom_design",
      );
    if (name === "owner_production_history")
      definition = definition.replace("'notes',j.notes", "'size',j.size,'notes',j.notes");
    if (["finished_product_inventory", "finished_product_transfer_scan"].includes(name))
      definition = definition.replace(
        "'created_at',p.created_at) row_value",
        "'created_at',p.created_at)||public.production_piece_context(p.id) row_value",
      );
    if (name === "finished_product_catalog")
      definition = definition.replace(
        "'id',f.id,",
        "'size',j.size,'production_quantity',j.quantity,'issued_at',(SELECT min(issued_at) FROM public.material_issues WHERE production_job_id=j.id),'finished_at',(SELECT max(recorded_at) FROM public.production_status_events WHERE job_id=j.id AND status='completed'),'id',f.id,",
      );
  }
  definition = definition
    .replaceAll("Current Owner SP changed or missing", "Saved Workshop SP changed or missing")
    .replaceAll(
      "Owner-reviewed price and finalized production cost required",
      "Reviewed price and recorded production fabric CP required",
    );
  sql += definition + ";\n";
};
add("permission_role_restriction", [
  [
    "WHEN p_permission LIKE 'pos.%'",
    "WHEN p_permission='production.receive' THEN CASE WHEN NOT public.has_any_role(p_user,ARRAY['stock_entry','production','counter']) THEN 'Stock Entry or Production workflow role required' END\n WHEN p_permission LIKE 'production.%' THEN CASE WHEN NOT public.has_any_role(p_user,ARRAY['production','counter']) THEN 'Production or Counter role required' END\n WHEN p_permission LIKE 'pos.%'",
  ],
]);
add("bootstrap_current_user", [
  ["v_role := 'counter';", "v_role := NULL; -- New staff wait for an Owner to assign their roles."],
  [
    "INSERT INTO public.user_roles(user_id, role_key) VALUES (v_uid, v_role) ON CONFLICT DO NOTHING;",
    "IF v_role IS NOT NULL THEN INSERT INTO public.user_roles(user_id, role_key) VALUES (v_uid, v_role) ON CONFLICT DO NOTHING; END IF;",
  ],
]);
add("create_owner_production_shared", [
  [
    "IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;",
    "IF NOT public.has_perm(auth.uid(),'production.create') THEN RAISE EXCEPTION 'Production creation permission required'; END IF;",
  ],
  [
    "PERFORM 1 FROM public.designs WHERE id=p_design AND active FOR SHARE;\n IF NOT FOUND THEN RAISE EXCEPTION 'Active Design required'; END IF;",
    "IF p_design IS NOT NULL THEN PERFORM 1 FROM public.designs WHERE id=p_design AND active FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION 'Active Design required'; END IF; END IF;",
  ],
]);
add("post_material_issue", [
  [
    "IF NOT public.has_role(auth.uid(),'owner') AND NOT (public.has_role(auth.uid(),'counter') AND public.has_perm(auth.uid(),'pos.issue_to_tailoring'))",
    "IF NOT public.has_role(auth.uid(),'owner') AND NOT (public.has_role(auth.uid(),'counter') AND public.has_perm(auth.uid(),'pos.issue_to_tailoring')) AND NOT (p_job_kind='production' AND public.has_perm(auth.uid(),'production.create'))",
  ],
  [
    "IF NOT FOUND THEN RAISE EXCEPTION 'Active issue source required'; END IF;",
    "IF NOT FOUND THEN RAISE EXCEPTION 'Active issue source required'; END IF;\n IF p_job_kind='production' AND NOT EXISTS(SELECT 1 FROM public.locations l LEFT JOIN public.locations parent ON parent.id=l.parent_id WHERE l.id=p_source AND l.active AND (l.kind IN('workshop','showroom') OR (l.kind='showroom_sublocation' AND parent.active AND parent.kind='showroom'))) THEN RAISE EXCEPTION 'Workshop or Showroom production source required'; END IF;",
  ],
]);
add("progress_owner_production", [
  [
    "public.has_role(auth.uid(),'owner') OR (public.has_role(auth.uid(),'tailor')",
    "public.has_perm(auth.uid(),'production.progress') OR (public.has_role(auth.uid(),'tailor')",
  ],
  [
    "public.has_role(auth.uid(),'owner') OR public.owns_production_job(job.id)",
    "public.has_perm(auth.uid(),'production.progress') OR public.owns_production_job(job.id)",
  ],
]);
add("owner_production_history", [
  [
    "public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'tailor')",
    "public.has_perm(auth.uid(),'production.view') OR public.has_role(auth.uid(),'tailor')",
  ],
  [
    "public.has_role(auth.uid(),'owner') OR public.owns_production_job(j.id)",
    "public.has_perm(auth.uid(),'production.view') OR public.owns_production_job(j.id)",
  ],
  [
    "'notes',j.notes,'created_at'",
    "'notes',j.notes,'received',EXISTS(SELECT 1 FROM public.finished_product_receipts WHERE production_job_id=j.id),'created_at'",
  ],
]);
add("owner_production_catalog", [
  [
    "IF NOT public.has_role(auth.uid(),'owner') THEN RAISE EXCEPTION 'Owner required'; END IF;",
    "IF NOT public.has_perm(auth.uid(),'production.view') THEN RAISE EXCEPTION 'Production access required'; END IF;\n IF NOT public.has_role(auth.uid(),'owner') THEN RETURN jsonb_build_object('products',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,'active',active) ORDER BY code) FROM public.products),'[]'::jsonb),'designs',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,'active',active) ORDER BY code) FROM public.designs),'[]'::jsonb)); END IF;",
  ],
]);
add("tailoring_assignment_options", [
  ["ARRAY['owner','counter','tailor']", "ARRAY['owner','counter','tailor','production']"],
  ["ARRAY['owner','counter']", "ARRAY['owner','counter','production']"],
]);
add("guard_receiving_authorization", [
  ["ARRAY['counter','tailor']", "ARRAY['counter','tailor','production']"],
]);
add("complete_direct_fabric_sale", [
  [
    "IF p_request_id IS NULL OR p_source IS NULL",
    "IF NOT EXISTS(SELECT 1 FROM public.locations l LEFT JOIN public.locations parent ON parent.id=l.parent_id WHERE l.id=p_source AND l.active AND (l.kind='showroom' OR (l.kind='showroom_sublocation' AND parent.active AND parent.kind='showroom'))) THEN RAISE EXCEPTION 'Fabric sales require an active Showroom source'; END IF;\n IF p_request_id IS NULL OR p_source IS NULL",
  ],
]);
for (const attributed of [false, true]) {
  add(
    "complete_counter_fabric_sale",
    [
      [
        "IF p_request_id IS NULL OR p_source IS NULL",
        "IF NOT EXISTS(SELECT 1 FROM public.locations l LEFT JOIN public.locations parent ON parent.id=l.parent_id WHERE l.id=p_source AND l.active AND (l.kind='showroom' OR (l.kind='showroom_sublocation' AND parent.active AND parent.kind='showroom'))) THEN RAISE EXCEPTION 'Fabric sales require an active Showroom source'; END IF;\n IF p_request_id IS NULL OR p_source IS NULL",
      ],
    ],
    (d) => d.includes("p_salesperson uuid") === attributed,
  );
  add(
    "complete_finished_product_sale",
    [
      [
        "IF p_request IS NULL OR p_source IS NULL",
        "IF NOT EXISTS(SELECT 1 FROM public.locations l LEFT JOIN public.locations parent ON parent.id=l.parent_id WHERE l.id=p_source AND l.active AND (l.kind='showroom' OR (l.kind='showroom_sublocation' AND parent.active AND parent.kind='showroom'))) THEN RAISE EXCEPTION 'Finished Product sales require an active Showroom source'; END IF;\n IF p_request IS NULL OR p_source IS NULL",
      ],
    ],
    (d) => d.includes("p_salesperson uuid") === attributed,
  );
}
for (const name of [
  "fabric_stock_catalog",
  "consumable_catalog",
  "inventory_catalog",
  "material_available_qty",
]) {
  const d = source.definitions.find((x) => x.name === name).definition;
  const from = d.includes(",'ecommerce_manager'")
    ? ",'ecommerce_manager'"
    : ", 'ecommerce_manager'";
  add(name, [[from, ""]]);
}
// The Workshop RPC is exclusively stock/Owner. E-commerce uses safe projections.
const previous = await fs.readFile(
  "supabase/migrations/20261013000200_thaan_optional_colour_reason.sql",
  "utf8",
);
sql += previous
  .slice(
    previous.indexOf("CREATE OR REPLACE FUNCTION public.workshop_fabric_inventory()"),
    previous.indexOf("CREATE OR REPLACE FUNCTION public.complete_barcode_thaan"),
  )
  .replace(",'ecommerce_manager'", "");
for (const policy of source.policies.filter(
  (p) =>
    p.cmd === "SELECT" &&
    p.qual?.includes("'ecommerce_manager'::text") &&
    p.tablename !== "locations",
)) {
  const qual = policy.qual.replace(/,\s*'ecommerce_manager'::text/g, "");
  sql += `ALTER POLICY "${policy.policyname}" ON public.${policy.tablename} USING(${qual});\n`;
}
sql += `DROP POLICY phase3_ecommerce_locations ON public.locations;
CREATE POLICY production_locations ON public.locations FOR SELECT TO authenticated USING(public.has_perm(auth.uid(),'production.view') AND active AND kind IN('workshop','showroom','showroom_sublocation'));
ALTER POLICY "read holds" ON public.holds USING(public.has_any_perm(auth.uid(),ARRAY['inventory.receive','pos.sell','pos.issue_to_tailoring','reports.view']));
`;
sql += await fs.readFile("scripts/role-workspaces-additions.sql", "utf8");
sql += await fs.readFile("scripts/production-workshop-additions.sql", "utf8");
for (const name of [
  "finished_product_catalog",
  "finished_product_inventory",
  "finished_product_transfer_scan",
  "finished_product_order_history",
])
  add(name);
add("finished_product_sale_scan", [
  [
    "'location_active',(SELECT active FROM public.locations WHERE id=piece.current_location_id)",
    "'saleable_source',public.is_showroom_location(piece.current_location_id),'location_active',(SELECT active FROM public.locations WHERE id=piece.current_location_id)",
  ],
]);
// Fixed issue-time costs must be written in the same transaction as the deduction.
add("post_material_issue", [
  [
    "IF NOT public.has_role(auth.uid(),'owner') AND NOT (public.has_role(auth.uid(),'counter') AND public.has_perm(auth.uid(),'pos.issue_to_tailoring'))",
    "IF NOT public.has_role(auth.uid(),'owner') AND NOT (public.has_role(auth.uid(),'counter') AND public.has_perm(auth.uid(),'pos.issue_to_tailoring')) AND NOT (p_job_kind='production' AND public.has_perm(auth.uid(),'production.create'))",
  ],
  [
    "-- Same stable item/location lock order",
    "PERFORM 1 FROM public.fabric_stock WHERE id IN(SELECT t.fabric_stock_id FROM public.inventory_items inv JOIN public.thaans t ON t.id=inv.thaan_id JOIN jsonb_array_elements(p_items) x ON inv.id=(x->>'inventory_item_id')::uuid) ORDER BY id FOR UPDATE;\n -- Same stable item/location lock order",
  ],
  [
    "IF NOT FOUND THEN RAISE EXCEPTION 'Active issue source required'; END IF;",
    "IF NOT FOUND THEN RAISE EXCEPTION 'Active issue source required'; END IF;\n IF p_job_kind='production' AND NOT EXISTS(SELECT 1 FROM public.locations WHERE id=p_source AND active AND (kind='workshop' OR public.is_showroom_location(id))) THEN RAISE EXCEPTION 'Workshop or Showroom source required'; END IF;",
  ],
  [
    "RETURNING id INTO v_line;",
    "RETURNING id INTO v_line;\n  IF p_job_kind='production' AND i.thaan_id IS NOT NULL THEN PERFORM public.capture_production_fabric_cost(v_line,v_stock,v_quantity); END IF;",
  ],
]);
add("registration_insert_thans", [
  ["OR (length_mm IS NULL AND cp IS NOT NULL)", ""],
  [
    "s,length_mm::integer,'draft'",
    "s,CASE WHEN length_mm>0 AND cp>0 THEN length_mm::integer END,'draft'",
  ],
  ["IF cp IS NOT NULL THEN", "IF cp>0 THEN"],
  ["IF length_mm IS NOT NULL THEN\n  UPDATE", "IF length_mm>0 AND cp>0 THEN\n  UPDATE"],
  [
    "thaan_id,created_by) VALUES(g.id,g.next_ordinal,code,s,th,auth.uid())",
    "thaan_id,created_by,draft_details) VALUES(g.id,g.next_ordinal,code,s,th,auth.uid(),jsonb_strip_nulls(jsonb_build_object('length_mm',length_mm,'cp',cp)))",
  ],
]);
add("complete_barcode_thaan", [
  [
    "AND (v.draft_details->>'cp')::bigint<>p_cp",
    "AND (v.draft_details->>'cp')::bigint>0 AND (v.draft_details->>'cp')::bigint<>p_cp",
  ],
  [
    "IF p_cp IS NOT NULL AND existing_cp IS NOT NULL AND existing_cp<>p_cp",
    "IF coalesce(p_cp,existing_cp,0)<=0 THEN RAISE EXCEPTION 'Positive CP and length required before stock becomes active'; END IF;\n IF p_cp IS NOT NULL AND existing_cp IS NOT NULL AND existing_cp<>p_cp",
  ],
]);
add("save_registered_thaan_details", [
  [
    "IF saved ? key AND saved->key IS DISTINCT FROM input->key",
    "IF saved ? key AND NOT(key='cp' AND coalesce((saved->>'cp')::bigint,0)=0 AND p_cp>0) AND saved->key IS DISTINCT FROM input->key",
  ],
  [
    "IF actual_length IS NOT NULL THEN",
    "IF actual_length>0 AND coalesce(actual_cp,(saved->>'cp')::bigint,0)>0 THEN",
  ],
]);
add("edit_workshop_thaan", [
  [
    "IF details ? 'length_mm' THEN PERFORM",
    "IF details ? 'length_mm' AND coalesce((details->>'cp')::bigint,oldcp,0)>0 THEN PERFORM",
  ],
  ["IF cp IS NULL OR cp<0", "IF cp IS NULL OR (t.original_mm IS NOT NULL AND cp<=0) OR cp<0"],
]);
add("guard_label_variant_history", [
  [
    "NEW.draft_details @> OLD.draft_details",
    "NEW.draft_details @> CASE WHEN coalesce((OLD.draft_details->>'cp')::bigint,0)=0 THEN OLD.draft_details-'cp' ELSE OLD.draft_details END",
  ],
]);
add("registered_thaan_details", [
  [
    "NOT EXISTS(SELECT 1 FROM public.fabric_stock_costs WHERE fabric_stock_id=fs.id) AND NOT(v.draft_details ? 'cp')",
    "coalesce((SELECT cp_paise_per_m FROM public.fabric_stock_costs WHERE fabric_stock_id=fs.id ORDER BY revision DESC LIMIT 1),(v.draft_details->>'cp')::bigint,0)<=0",
  ],
]);
sql += await fs.readFile("scripts/role-stock-eligibility.sql", "utf8");
sql += "\nNOTIFY pgrst,'reload schema';\nCOMMIT;\n";
await fs.writeFile("supabase/migrations/20261014000000_role_workspaces.sql", sql);
await fs.writeFile("drizzle/migrations/0040_role_workspaces.sql", sql);
console.log("Generated identical forward-only role workspace migrations");
