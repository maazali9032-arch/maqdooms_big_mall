-- Owner explicitly declared reviewed legacy stock to be TEST DATA.
-- Deliberate test distributions are not assertions of historical physical location.
-- Preserve original IDs, rows, CP/SP, recorded quantities and legacy ledger history.
BEGIN;
LOCK TABLE public.thaans,public.materials,public.stock_movements,public.holds,
 public.inventory_items,public.inventory_movements,public.domain_reconciliation,
 public.locations IN SHARE ROW EXCLUSIVE MODE;
-- Existing user-operated RPCs continue to require an Owner profile. This narrow
-- exception permits only this immutable, version-tracked automated fixture migration.
ALTER TABLE public.inventory_items ALTER COLUMN reconciled_by DROP NOT NULL;
ALTER TABLE public.inventory_items ADD COLUMN fixture_migration_version text
 REFERENCES supabase_migrations.schema_migrations(version) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.inventory_items ADD CONSTRAINT inventory_reconciliation_provenance CHECK (
 (reconciled_by IS NOT NULL AND fixture_migration_version IS NULL) OR
 (reconciled_by IS NULL AND fixture_migration_version IS NOT NULL AND fixture_migration_version='20261003001000')
);
CREATE TABLE supabase_migrations.erp_test_stock_fixtures (
 legacy_id uuid PRIMARY KEY,
 legacy_table text NOT NULL CHECK(legacy_table IN ('thaans','materials')),
 label text NOT NULL,
 scenario text NOT NULL,
 recorded_quantity numeric(18,3) NOT NULL CHECK(recorded_quantity>=0),
 unit text NOT NULL,
 allocations jsonb NOT NULL CHECK(jsonb_typeof(allocations)='array'),
 inventory_item_id uuid UNIQUE REFERENCES public.inventory_items(id),
 migration_version text NOT NULL REFERENCES supabase_migrations.schema_migrations(version) DEFERRABLE INITIALLY DEFERRED,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((scenario IN ('unreceived_draft','unreceived_missing_cp_sp'))=(inventory_item_id IS NULL))
);
REVOKE ALL ON supabase_migrations.erp_test_stock_fixtures FROM PUBLIC,anon,authenticated;
CREATE TRIGGER test_stock_fixture_immutable BEFORE UPDATE OR DELETE
 ON supabase_migrations.erp_test_stock_fixtures FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite();
CREATE OR REPLACE FUNCTION public.guard_inventory_movement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE i public.inventory_items%rowtype; v_balance numeric; v_total numeric; v_location uuid;
BEGIN
 SELECT * INTO i FROM public.inventory_items WHERE id=NEW.inventory_item_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Reconciled inventory item required'; END IF;
 IF (NEW.thaan_id,NEW.material_id,NEW.finished_product_id,NEW.unit) IS DISTINCT FROM (i.thaan_id,i.material_id,i.finished_product_id,i.unit) THEN RAISE EXCEPTION 'Movement identity/unit must match inventory authority'; END IF;
 IF auth.uid() IS NOT NULL AND NEW.actor_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Movement actor must be caller'; END IF;
 -- Narrow, temporary ledger-gated exception for this authorized automated seed.
 IF NEW.actor_id IS NULL AND (
  auth.uid() IS NULL AND session_user='postgres'
  AND i.fixture_migration_version='20261003001000'
  AND NEW.kind='ADJUSTMENT' AND NEW.source_location_id IS NULL AND NEW.destination_location_id IS NOT NULL
  AND NEW.reference='OPENING:'||i.id::text
  AND public.inventory_balance(i.id,NULL)+NEW.quantity<=i.legacy_quantity_snapshot
  AND NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261003001000')
 ) IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Movement actor required'; END IF;
 IF NEW.reason IS NULL OR btrim(NEW.reason)='' THEN RAISE EXCEPTION 'Movement reason required'; END IF;
 IF NEW.kind IN ('INWARD','PRODUCTION','RETURN') AND (NEW.source_location_id IS NOT NULL OR NEW.destination_location_id IS NULL) THEN RAISE EXCEPTION 'Incoming movement requires destination only'; END IF;
 IF NEW.kind IN ('SALE','MATERIAL_ISSUE','TAILORING','WASTAGE') AND (NEW.source_location_id IS NULL OR NEW.destination_location_id IS NOT NULL) THEN RAISE EXCEPTION 'Outgoing movement requires source only'; END IF;
 IF NEW.kind='ADJUSTMENT' AND num_nonnulls(NEW.source_location_id,NEW.destination_location_id)<>1 THEN RAISE EXCEPTION 'Adjustment requires one direction'; END IF;
 IF NEW.kind='TRANSFER' AND NOT EXISTS(SELECT 1 FROM public.stock_transfer_lines l JOIN public.stock_transfers t ON t.id=l.transfer_id WHERE l.id=NEW.stock_transfer_line_id AND t.status='draft') THEN RAISE EXCEPTION 'Transfer movement requires an open posting transaction'; END IF;
 IF NEW.kind='SALE' AND NOT EXISTS(SELECT 1 FROM public.order_items l JOIN public.orders o ON o.id=l.order_id
 WHERE l.id=NEW.order_item_id AND o.kind IN ('direct_fabric_sale','finished_product_sale') AND o.source_location_id=NEW.source_location_id
 AND (l.thaan_id,l.fabric_stock_id,l.finished_product_id,l.quantity,l.unit) IS NOT DISTINCT FROM (NEW.thaan_id,NEW.fabric_stock_id,NEW.finished_product_id,NEW.quantity,NEW.unit)) THEN RAISE EXCEPTION 'Sale movement must match its Order item and source'; END IF;
 -- Lock locations in stable order, preventing a simultaneous deactivation.
 FOR v_location IN SELECT id FROM public.locations WHERE id IN (NEW.source_location_id,NEW.destination_location_id) ORDER BY id FOR UPDATE LOOP
  IF NOT EXISTS(SELECT 1 FROM public.locations WHERE id=v_location AND active) THEN RAISE EXCEPTION 'Active location required'; END IF;
 END LOOP;
 IF NEW.source_location_id IS NOT NULL THEN
  v_balance:=public.inventory_balance(i.id,NEW.source_location_id);
  IF v_balance<NEW.quantity THEN RAISE EXCEPTION 'Insufficient stock at source location'; END IF;
 END IF;
 v_total:=public.inventory_balance(i.id,NULL)+CASE WHEN NEW.source_location_id IS NULL THEN NEW.quantity WHEN NEW.destination_location_id IS NULL THEN -NEW.quantity ELSE 0 END;
 IF i.finished_product_id IS NOT NULL AND v_total NOT IN (0,1) THEN RAISE EXCEPTION 'A physical Finished Product has at most one piece'; END IF;
 IF i.thaan_id IS NOT NULL AND v_total>2147483647 THEN RAISE EXCEPTION 'Than balance exceeds supported millimetre range'; END IF;
 IF i.finished_product_id IS NOT NULL AND NEW.source_location_id IS NULL AND NEW.reference IS DISTINCT FROM 'OPENING:'||i.id::text
 AND NOT EXISTS(SELECT 1 FROM public.locations WHERE id=NEW.destination_location_id AND kind='workshop') THEN RAISE EXCEPTION 'Finished Products enter Workshop before transfer'; END IF;
 RETURN NEW;
END; $$;
CREATE TEMP TABLE test_stock_plan(legacy_id uuid PRIMARY KEY,legacy_table text,label text,status text,quantity numeric,unit text,allocations jsonb,scenario text) ON COMMIT DROP;
INSERT INTO test_stock_plan VALUES('02d9bec3-eaaa-46d6-97c8-31f33573f828'::uuid,'thaans','TH-0006','active',16500,'mm','[{"code":"WORKSHOP","quantity":16500}]'::jsonb,'single_location_stock');
INSERT INTO test_stock_plan VALUES('0934b643-0dbd-4a57-a566-8105c8b6a4c7'::uuid,'thaans','TH-0012','active',26600,'mm','[{"code":"TEST-DISPLAY-B","quantity":26600}]'::jsonb,'single_location_stock');
INSERT INTO test_stock_plan VALUES('1eaffab4-4aa7-4fa6-a10c-bb54650e66f9'::uuid,'thaans','TH-0014','active',30500,'mm','[{"code":"WORKSHOP","quantity":30500}]'::jsonb,'single_location_stock');
INSERT INTO test_stock_plan VALUES('242d349e-01cd-4d2e-8c69-d534a03fb729'::uuid,'thaans','TH-0013','active',27000,'mm','[{"code":"WORKSHOP","quantity":17000},{"code":"TEST-DISPLAY-A","quantity":10000}]'::jsonb,'split_than_locations');
INSERT INTO test_stock_plan VALUES('4133c2d2-6d02-49b9-b9a1-83823fe51b2e'::uuid,'thaans','TH-0011','active',18500,'mm','[{"code":"WORKSHOP","quantity":18500}]'::jsonb,'single_location_stock');
INSERT INTO test_stock_plan VALUES('442fe81d-12c2-4bb5-b983-f53e2ad7411d'::uuid,'thaans','TH-0001','active',23500,'mm','[{"code":"WORKSHOP","quantity":23500}]'::jsonb,'single_location_stock');
INSERT INTO test_stock_plan VALUES('57a2dd59-95fe-4e33-9fc3-134bc7d4816d'::uuid,'thaans','TH-0010','active',16500,'mm','[{"code":"TEST-DISPLAY-A","quantity":16500}]'::jsonb,'single_location_stock');
INSERT INTO test_stock_plan VALUES('989fd388-42fd-4e9d-929e-e76b8e8f3148'::uuid,'thaans','TH-0017','draft',0,'mm','[]'::jsonb,'unreceived_missing_cp_sp');
INSERT INTO test_stock_plan VALUES('ae30649f-bdce-4aeb-a6ae-02b0f32b46fb'::uuid,'thaans','TH-0016','draft',0,'mm','[]'::jsonb,'unreceived_draft');
INSERT INTO test_stock_plan VALUES('d7bc14e3-a672-4277-8b88-be1d751b767b'::uuid,'thaans','TH-0003','depleted',0,'mm','[]'::jsonb,'fully_depleted');
INSERT INTO test_stock_plan VALUES('d8ddd5f7-7b1b-4f4f-bcd4-770dfcb4e10e'::uuid,'thaans','TH-0007','active',25800,'mm','[{"code":"WORKSHOP","quantity":15800},{"code":"SHOWROOM","quantity":10000}]'::jsonb,'split_than_locations');
INSERT INTO test_stock_plan VALUES('dae8dfd0-8087-4924-aab8-113670b4cf22'::uuid,'thaans','TH-0015','draft',0,'mm','[]'::jsonb,'unreceived_draft');
INSERT INTO test_stock_plan VALUES('e5d97da7-8c0e-45ca-8546-8ff75bc82635'::uuid,'thaans','TH-0009','active',18000,'mm','[{"code":"SHOWROOM","quantity":18000}]'::jsonb,'single_location_stock');
INSERT INTO test_stock_plan VALUES('eaf4197f-c4fd-4109-a8af-dbac9a4cb6ba'::uuid,'thaans','TH-0008','active',36000,'mm','[{"code":"WORKSHOP","quantity":16000},{"code":"SHOWROOM","quantity":10000},{"code":"TEST-DISPLAY-B","quantity":10000}]'::jsonb,'split_than_locations');
INSERT INTO test_stock_plan VALUES('f2ef011e-a4fc-4d05-978c-4a68c35fee30'::uuid,'thaans','TH-0002','active',25750,'mm','[{"code":"SHOWROOM","quantity":25750}]'::jsonb,'single_location_stock');
INSERT INTO test_stock_plan VALUES('f9416b8e-0547-4e1d-af27-affdc2c01f1f'::uuid,'thaans','TH-0005','active',29250,'mm','[{"code":"TEST-DISPLAY-A","quantity":29250}]'::jsonb,'single_location_stock');
INSERT INTO test_stock_plan VALUES('fd27265b-755c-4672-a353-180332c8b863'::uuid,'thaans','TH-0004','active',21500,'mm','[{"code":"WORKSHOP","quantity":11500},{"code":"SHOWROOM","quantity":10000}]'::jsonb,'split_than_locations');
INSERT INTO test_stock_plan VALUES('000c3b67-1b95-4b22-bd46-8878f71f3c17'::uuid,'materials','Canvas Padding','active',42,'m','[{"code":"WORKSHOP","quantity":30},{"code":"SHOWROOM","quantity":12}]'::jsonb,'material_unit_split');
INSERT INTO test_stock_plan VALUES('038c4ca5-5670-476f-84cc-fcd458419ba1'::uuid,'materials','Horn Buttons (set)','active',60,'set','[{"code":"WORKSHOP","quantity":40},{"code":"TEST-DISPLAY-A","quantity":20}]'::jsonb,'material_unit_split');
INSERT INTO test_stock_plan VALUES('529710b8-3cca-49d3-b741-7cb139622e18'::uuid,'materials','Shoulder Pads','active',35,'pair','[{"code":"WORKSHOP","quantity":20},{"code":"SHOWROOM","quantity":10},{"code":"TEST-DISPLAY-B","quantity":5}]'::jsonb,'material_unit_split');
INSERT INTO test_stock_plan VALUES('bcfcb3ea-c497-4dcd-8c2d-5f1898a67fe4'::uuid,'materials','Suit Lining Silk','active',80,'m','[{"code":"WORKSHOP","quantity":50},{"code":"TEST-DISPLAY-B","quantity":30}]'::jsonb,'material_unit_split');
DO $$ DECLARE p record; t public.thaans%rowtype; m public.materials%rowtype; allocation jsonb; loc uuid; item uuid; workshop uuid; showroom uuid; r public.domain_reconciliation%rowtype; n public.domain_reconciliation%rowtype; closed integer:=0; BEGIN
 IF (SELECT count(*) FROM test_stock_plan)<>21 OR EXISTS(SELECT 1 FROM public.inventory_items) OR EXISTS(SELECT 1 FROM public.inventory_movements) THEN
  RAISE EXCEPTION 'Reviewed fixture baseline changed; stop instead of overwriting stock';
 END IF;
 SELECT id INTO workshop FROM public.locations WHERE kind='workshop' AND active;
 SELECT id INTO showroom FROM public.locations WHERE kind='showroom' AND active;
 IF workshop IS NULL OR showroom IS NULL OR EXISTS(SELECT 1 FROM public.locations WHERE code IN ('TEST-DISPLAY-A','TEST-DISPLAY-B')) THEN
  RAISE EXCEPTION 'Canonical/test location baseline changed';
 END IF;
 INSERT INTO public.locations(id,code,name,kind,parent_id) VALUES
 ('f07cab29-a811-4ef9-b78c-9e93cf351001','TEST-DISPLAY-A','Test Display A','showroom_sublocation',showroom),
 ('f07cab29-a811-4ef9-b78c-9e93cf351002','TEST-DISPLAY-B','Test Display B','showroom_sublocation',showroom);
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference)
 SELECT NULL,'migration_test_location','locations',id,to_jsonb(l),'20261003001000_live_test_stock_scenarios.sql' FROM public.locations l WHERE code IN ('TEST-DISPLAY-A','TEST-DISPLAY-B');
 FOR p IN SELECT * FROM test_stock_plan ORDER BY legacy_table,legacy_id LOOP
  item:=NULL;
  IF p.legacy_table='thaans' THEN
   SELECT * INTO t FROM public.thaans WHERE id=p.legacy_id FOR UPDATE;
   IF NOT FOUND OR t.barcode IS DISTINCT FROM p.label OR t.status IS DISTINCT FROM p.status OR t.fabric_stock_id IS NULL
   OR coalesce((SELECT sum(delta_mm) FROM public.stock_movements WHERE thaan_id=t.id),0)<>p.quantity
   OR EXISTS(SELECT 1 FROM public.holds WHERE thaan_id=t.id AND status='active' AND expires_at>now()) THEN
    RAISE EXCEPTION 'Than fixture evidence changed: %',p.label;
   END IF;
  ELSE
   SELECT * INTO m FROM public.materials WHERE id=p.legacy_id FOR UPDATE;
   IF NOT FOUND OR NOT m.active OR m.name IS DISTINCT FROM p.label OR m.unit IS DISTINCT FROM p.unit OR m.qty_on_hand<>p.quantity THEN
    RAISE EXCEPTION 'Material fixture evidence changed: %',p.label;
   END IF;
  END IF;
  IF p.quantity<>(SELECT coalesce(sum((value->>'quantity')::numeric),0) FROM jsonb_array_elements(p.allocations)) THEN
   RAISE EXCEPTION 'Test allocations do not conserve recorded quantity: %',p.label;
  END IF;
  IF p.status<>'draft' THEN
   INSERT INTO public.inventory_items(thaan_id,material_id,unit,legacy_quantity_snapshot,reconciled_by,fixture_migration_version,reason)
   VALUES(CASE WHEN p.legacy_table='thaans' THEN p.legacy_id END,CASE WHEN p.legacy_table='materials' THEN p.legacy_id END,p.unit,p.quantity,NULL,'20261003001000','Explicitly authorized TEST fixture distribution; recorded legacy quantities preserved; 20261003001000_live_test_stock_scenarios.sql') RETURNING id INTO item;
   FOR allocation IN SELECT value FROM jsonb_array_elements(p.allocations) LOOP
    SELECT id INTO loc FROM public.locations WHERE code=allocation->>'code' AND active;
    IF loc IS NULL OR (allocation->>'quantity')::numeric<=0 OR (p.unit='mm' AND (allocation->>'quantity')::numeric<>trunc((allocation->>'quantity')::numeric)) THEN
     RAISE EXCEPTION 'Invalid test location/quantity';
    END IF;
    INSERT INTO public.inventory_movements(inventory_item_id,kind,thaan_id,fabric_stock_id,material_id,quantity,unit,destination_location_id,actor_id,reference,reason)
    VALUES(item,'ADJUSTMENT',CASE WHEN p.legacy_table='thaans' THEN p.legacy_id END,CASE WHEN p.legacy_table='thaans' THEN t.fabric_stock_id END,CASE WHEN p.legacy_table='materials' THEN p.legacy_id END,(allocation->>'quantity')::numeric,p.unit,loc,NULL,'OPENING:'||item::text,'TEST fixture opening allocation, not historical location inference; 20261003001000_live_test_stock_scenarios.sql');
   END LOOP;
   IF public.inventory_balance(item,NULL)<>p.quantity THEN RAISE EXCEPTION 'Fixture quantity conservation failed'; END IF;
   INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference)
   VALUES(NULL,'migration_test_stock_opening','inventory_items',item,jsonb_build_object('test_fixture',true,'legacy_id',p.legacy_id,'quantity',p.quantity,'unit',p.unit,'allocations',p.allocations),'20261003001000_live_test_stock_scenarios.sql');
  END IF;
  INSERT INTO supabase_migrations.erp_test_stock_fixtures(legacy_id,legacy_table,label,scenario,recorded_quantity,unit,allocations,inventory_item_id,migration_version)
  VALUES(p.legacy_id,p.legacy_table,p.label,p.scenario,p.quantity,p.unit,p.allocations,item,'20261003001000');
 END LOOP;
 -- Preserve intentionally incomplete receiving cases; do not fabricate CP or SP.
 IF EXISTS(SELECT 1 FROM public.fabric_stock_costs WHERE fabric_stock_id='a1919ba4-31d9-4091-b249-c6545a82ffaf') THEN
  RAISE EXCEPTION 'Missing-CP validation fixture baseline changed';
 END IF;
 FOR r IN SELECT * FROM public.domain_reconciliation d WHERE resolved_at IS NULL AND (
 EXISTS(SELECT 1 FROM test_stock_plan source_plan WHERE source_plan.legacy_table=d.legacy_table AND source_plan.legacy_id=d.legacy_id) OR
 (d.legacy_table='fabric_stock' AND d.legacy_id='a1919ba4-31d9-4091-b249-c6545a82ffaf' AND d.issue='cp_requires_reconciliation')) ORDER BY id FOR UPDATE LOOP
  UPDATE public.domain_reconciliation SET resolved_at=now(),resolved_by=NULL,
   resolution=CASE WHEN r.issue='cp_requires_reconciliation' THEN
    'Owner declared this stock TEST DATA. TH-0017 deliberately retains missing CP/SP as an unreceived negative validation fixture; no price was supplied. Test scenario is defined, not a production pricing reconciliation.'
    ELSE 'Owner declared this stock TEST DATA. Explicit location allocations or deliberately unreceived/depleted scenario recorded in supabase_migrations.erp_test_stock_fixtures by 20261003001000_live_test_stock_scenarios.sql. Original quantities and historical locations/data preserved; synthetic allocations are not historical assertions.' END
   WHERE id=r.id RETURNING * INTO n;
  INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,previous_value,new_value,reference)
  VALUES(NULL,'migration_test_fixture_disposition','domain_reconciliation',r.id,to_jsonb(r),to_jsonb(n),'20261003001000_live_test_stock_scenarios.sql');
  closed:=closed+1;
 END LOOP;
 IF closed<>21 OR (SELECT count(*) FROM public.domain_reconciliation WHERE resolved_at IS NULL)<>4
 OR (SELECT count(*) FROM public.inventory_items)<>18 OR (SELECT count(*) FROM public.inventory_movements)<>27
 OR (SELECT count(*) FROM supabase_migrations.erp_test_stock_fixtures)<>21 THEN
  RAISE EXCEPTION 'Unexpected test fixture totals/dispositions';
 END IF;
 INSERT INTO public.erp_audit_records(actor_id,action,entity_table,entity_id,new_value,reference)
 VALUES(NULL,'migration_test_stock_scenarios','domain_reconciliation','5b35b172-0d1a-4ca3-834a-c3f61279b4fe',jsonb_build_object('stock_is_test_data',true,'unique_stock_records',21,'canonical_items',18,'opening_allocations',27,'draft_fixtures',3,'stock_issues_closed',21,'jobs_unchanged',true),'20261003001000_live_test_stock_scenarios.sql');
END $$;
COMMIT;
