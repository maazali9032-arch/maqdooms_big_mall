/** Additional integration checks run by the full cumulative Workshop replay. */
import { randomUUID } from "node:crypto";
export async function verifyDelegation({ q, one, denied, login, users, check }) {
  await login(users.owner);
  const batch = await one("select create_barcode_batch($1,'Arvind','2026-10-13',null,$2::jsonb)", [
    randomUUID(),
    JSON.stringify([{ name: "Cotton", quantity: 3 }]),
  ]);
  const variants = (await one("select stock_registration_catalog($1)", [batch]))[0].fabric_types[0]
    .variants;
  const original = await q(
    "select s.id,s.created_by,t.id thaan_id,t.created_by thaan_creator from fabric_stock s join thaans t on t.fabric_stock_id=s.id where s.batch_id=$1 order by s.id",
    [batch],
  );
  await one("select save_registered_thaan_details($1,$2,null,null,98765)", [
    randomUUID(),
    variants[0].code,
  ]);
  const read = async (v) =>
    (await one("select workshop_fabric_inventory()")).find((r) => r.thaan_id === v.thaan_id);
  const edit = async (v, changes) => {
    const row = await read(v);
    return one("select edit_workshop_thaan($1,$2,$3,$4::jsonb,'Verified actual details')", [
      randomUUID(),
      v.thaan_id,
      row.version,
      JSON.stringify(changes),
    ]);
  };
  const grant = async (permission, value = true, user = users.other_stock) => {
    await login(users.owner);
    await one("select owner_set_user_permission($1,$2,$3)", [user, permission, value]);
    await login(user);
  };
  await login(users.other_stock);
  let row = await read(variants[0]);
  check(
    !row.can_edit && !row.cp_visible && row.cp_paise_per_m === null,
    "Other-created draft remains read-only and CP hidden by default",
  );
  await denied("select save_registered_thaan_details($1,$2,'Blue',12000,null)", [
    randomUUID(),
    variants[0].code,
  ]);
  await grant("inventory.edit_others_thaans");
  row = await read(variants[0]);
  check(row.can_edit && !row.cp_visible, "Cross-registrant editing does not grant CP visibility");
  await denied("select save_registered_thaan_details($1,$2,null,null,1)", [
    randomUUID(),
    variants[0].code,
  ]);
  await edit(variants[0], { colour: "Blue", length_mm: 12000 });
  row = await read(variants[0]);
  check(
    row.original_mm === 12000 && Number(row.workshop_mm) === 12000 && !row.cp_visible,
    "Inventory completion posts one real receipt while preserving hidden saved CP",
  );
  await one("select save_registered_thaan_details($1,$2,'Red',5000,null)", [
    randomUUID(),
    variants[1].code,
  ]);
  const scan = await one("select registered_thaan_details($1)", [variants[1].code]);
  check(
    scan.can_complete && scan.original_mm === 5000 && !scan.can_set_cp,
    "Scanner supports authorised completion but hides unauthorised CP entry",
  );
  await grant("inventory.view_others_cp");
  row = await read(variants[0]);
  check(
    row.cp_visible && Number(row.cp_paise_per_m) === 98765 && !row.can_correct_cp,
    "CP viewing does not grant CP correction",
  );
  await denied("select edit_workshop_thaan($1,$2,$3,$4::jsonb,'Not authorised')", [
    randomUUID(),
    row.thaan_id,
    row.version,
    JSON.stringify({ cp_paise_per_m: 20000 }),
  ]);
  await grant("inventory.correct_others_cp");
  await edit(variants[0], { cp_paise_per_m: 100000 });
  row = await read(variants[0]);
  check(
    row.can_correct_cp && Number(row.cp_paise_per_m) === 100000,
    "Independent CP-changing grant appends correction",
  );
  await edit(variants[1], { cp_paise_per_m: 23456 });
  check(
    Number((await read(variants[1])).cp_paise_per_m) === 23456,
    "Authorised other-registrant missing CP filled through audited Inventory",
  );
  await one("select save_registered_thaan_details($1,$2,null,null,30000)", [
    randomUUID(),
    variants[2].code,
  ]);
  await one("select save_registered_thaan_details($1,$2,'Green',9000,null)", [
    randomUUID(),
    variants[2].code,
  ]);
  check(
    Number((await read(variants[2])).workshop_mm) === 9000,
    "Scanner partial CP then measurement retains authorised values",
  );
  await grant("inventory.view_others_cp", false);
  row = await read(variants[0]);
  check(
    !row.cp_visible && row.cp_paise_per_m === null && !row.can_correct_cp,
    "Revoked visibility also blocks CP-changing capability",
  );
  await grant("inventory.edit_others_thaans", false);
  check(!(await read(variants[0])).can_edit, "Revoked editing restores read-only state");
  await denied("select save_registered_thaan_details($1,$2,'Blue',12000,null)", [
    randomUUID(),
    variants[0].code,
  ]);
  await login(users.owner);
  const after = await q(
    "select s.id,s.created_by,t.id thaan_id,t.created_by thaan_creator from fabric_stock s join thaans t on t.fabric_stock_id=s.id where s.batch_id=$1 order by s.id",
    [batch],
  );
  check(
    JSON.stringify(original) === JSON.stringify(after),
    "Creator IDs and original business IDs unchanged",
  );
  check(
    (await one(
      "select count(*)::int from inventory_movements where thaan_id=$1 and kind='INWARD'",
      [variants[0].thaan_id],
    )) === 1,
    "Exactly one first-measurement receipt",
  );
  check(
    (await one("select count(*)::int from fabric_stock_costs where fabric_stock_id=$1", [
      variants[0].stock_id,
    ])) === 2,
    "Original CP version retained alongside correction",
  );
  check(
    (await one(
      "select count(*)::int from erp_audit_records where actor_id=$1 and action='edit_workshop_thaan'",
      [users.other_stock],
    )) >= 3,
    "Cross-registrant actions attributed to actual editor",
  );
  await denied("select owner_set_user_permission($1,'inventory.edit_others_thaans',true)", [
    users.counter,
  ]);
  await denied("select owner_set_user_permission($1,'inventory.view_cost',true)", [
    users.other_stock,
  ]);
  await denied("select owner_set_user_permission($1,'stock.adjust',true)", [users.other_stock]);
  const state = await one("select owner_user_permission_state($1)", [users.other_stock]);
  const cpState = state.find((s) => s.key === "inventory.view_cost");
  check(
    cpState.restriction.startsWith("Owner-only") &&
      !cpState.role_default &&
      !cpState.effective_allowed,
    "Stored role CP default does not masquerade as usable access",
  );
  await login(users.counter);
  await denied("select owner_user_permission_state($1)", [users.other_stock]);
  await login(users.other_stock);
  await denied("select owner_user_permission_state($1)", [users.other_stock]);
  await login(null);
  for (const sig of [
    "public.permission_role_restriction(uuid,text)",
    "public.can_view_thaan_cp(uuid)",
    "public.can_edit_thaan_registration(uuid)",
    "public.can_change_others_thaan_cp(uuid)",
  ]) {
    check(
      !(await one("select has_function_privilege('authenticated',$1,'EXECUTE')", [sig])),
      "Private helper not directly callable: " + sig,
    );
  }
}
