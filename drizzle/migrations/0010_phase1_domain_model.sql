-- PHASE 1 ONLY: additive domain model, conservative legacy identity backfill.
-- No operational RPCs, role rewrites, balance migration or guessed legacy locations.
-- New tables are sealed from browser roles until Phase 2 authorization is approved.
BEGIN;

-- New writes must reference real users/profiles. NOT VALID preserves unknown
-- pre-existing orphans until explicitly reconciled; no user or role is deleted.
ALTER TABLE public.profiles ADD CONSTRAINT profiles_auth_user_fkey
  FOREIGN KEY(id) REFERENCES auth.users(id) NOT VALID;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_profile_fkey
  FOREIGN KEY(user_id) REFERENCES public.profiles(id) NOT VALID;
ALTER TABLE public.user_permission_overrides ADD CONSTRAINT permission_overrides_profile_fkey
  FOREIGN KEY(user_id) REFERENCES public.profiles(id) NOT VALID;

CREATE TABLE public.locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (btrim(code) <> ''),
  name text NOT NULL CHECK (btrim(name) <> ''),
  kind text NOT NULL CHECK (kind IN ('workshop','showroom','showroom_sublocation')),
  parent_id uuid REFERENCES public.locations(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'showroom_sublocation') = (parent_id IS NOT NULL)),
  CHECK (parent_id IS DISTINCT FROM id)
);
CREATE UNIQUE INDEX locations_single_workshop ON public.locations(kind) WHERE kind = 'workshop';
CREATE UNIQUE INDEX locations_single_showroom ON public.locations(kind) WHERE kind = 'showroom';
CREATE INDEX locations_parent_idx ON public.locations(parent_id);
CREATE FUNCTION public.validate_showroom_parent() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.kind,NEW.parent_id) IS DISTINCT FROM (OLD.kind,OLD.parent_id) THEN
    RAISE EXCEPTION 'Location hierarchy identity cannot be rewritten';
  END IF;
  IF NEW.parent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.locations WHERE id = NEW.parent_id AND kind = 'showroom'
  ) THEN RAISE EXCEPTION 'Showroom sublocations must belong to the Showroom'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER locations_validate_parent BEFORE INSERT OR UPDATE ON public.locations
FOR EACH ROW EXECUTE FUNCTION public.validate_showroom_parent();
-- Only the two explicitly specified business locations; no invented floor count.
INSERT INTO public.locations(code,name,kind) VALUES
  ('WORKSHOP','Workshop','workshop'), ('SHOWROOM','Showroom','showroom');

CREATE TABLE public.tailoring_factories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (btrim(code) <> ''),
  name text NOT NULL CHECK (btrim(name) <> ''),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.tailoring_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.tailoring_factories(id),
  code text NOT NULL CHECK (btrim(code) <> ''),
  name text NOT NULL CHECK (btrim(name) <> ''),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(factory_id,code), UNIQUE(id,factory_id)
);
CREATE TABLE public.tailors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (btrim(code) <> ''),
  real_name text NOT NULL CHECK (btrim(real_name) <> ''),
  profile_id uuid UNIQUE REFERENCES public.profiles(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Assignment history prevents moving a person from rewriting old job genealogy.
-- A business Tailor may exist before receiving a login; no Factory login role.
CREATE TABLE public.tailor_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tailor_id uuid NOT NULL REFERENCES public.tailors(id),
  factory_id uuid NOT NULL REFERENCES public.tailoring_factories(id),
  section_id uuid,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  FOREIGN KEY(section_id,factory_id) REFERENCES public.tailoring_sections(id,factory_id),
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);
CREATE UNIQUE INDEX tailor_current_assignment_idx ON public.tailor_assignments(tailor_id)
  WHERE valid_until IS NULL;
CREATE INDEX tailor_assignments_factory_idx ON public.tailor_assignments(factory_id,section_id);

CREATE TABLE public.barcodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (btrim(code) <> ''),
  kind text NOT NULL CHECK (kind IN ('fabric','product')),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,kind)
);
CREATE TABLE public.fabric_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fabric_id uuid NOT NULL REFERENCES public.fabrics(id),
  batch_id uuid NOT NULL REFERENCES public.receiving_batches(id),
  barcode_id uuid NOT NULL UNIQUE,
  barcode_kind text NOT NULL DEFAULT 'fabric' CHECK (barcode_kind = 'fabric'),
  entry_state text NOT NULL DEFAULT 'draft'
    CHECK (entry_state IN ('draft','correcting','complete','legacy_pending')),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(fabric_id,batch_id), UNIQUE(id,fabric_id,batch_id),
  FOREIGN KEY(barcode_id,barcode_kind) REFERENCES public.barcodes(id,kind)
);
CREATE INDEX fabric_stock_batch_idx ON public.fabric_stock(batch_id);
ALTER TABLE public.thaans ADD COLUMN fabric_stock_id uuid;
ALTER TABLE public.thaans ALTER COLUMN barcode DROP NOT NULL;
ALTER TABLE public.thaans ADD CONSTRAINT thaans_identity_present
  CHECK (barcode IS NOT NULL OR fabric_stock_id IS NOT NULL);
ALTER TABLE public.thaans ADD CONSTRAINT thaans_parent_identity_complete
  CHECK (fabric_stock_id IS NULL OR (fabric_id IS NOT NULL AND batch_id IS NOT NULL));
ALTER TABLE public.thaans ADD CONSTRAINT thaans_fabric_stock_fkey
  FOREIGN KEY(fabric_stock_id,fabric_id,batch_id)
  REFERENCES public.fabric_stock(id,fabric_id,batch_id);
ALTER TABLE public.thaans ADD CONSTRAINT thaans_stock_pair_unique UNIQUE(id,fabric_stock_id);
CREATE INDEX thaans_fabric_stock_idx ON public.thaans(fabric_stock_id);
COMMENT ON COLUMN public.thaans.barcode IS
  'Legacy per-roll label retained for compatibility/history; new internal Thans need no roll barcode.';

-- Financial values are separate version records; SP is optional and not an
-- activation requirement in this new model. Actual workflows belong to Phase 4.
CREATE TABLE public.fabric_stock_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fabric_stock_id uuid NOT NULL REFERENCES public.fabric_stock(id),
  revision integer NOT NULL CHECK (revision > 0),
  cp_paise_per_m bigint NOT NULL CHECK (cp_paise_per_m >= 0),
  recorded_by uuid REFERENCES public.profiles(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  reason text,
  UNIQUE(fabric_stock_id,revision)
);
CREATE TABLE public.fabric_stock_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fabric_stock_id uuid NOT NULL REFERENCES public.fabric_stock(id),
  revision integer NOT NULL CHECK (revision > 0),
  sp_paise_per_m bigint NOT NULL CHECK (sp_paise_per_m >= 0),
  recorded_by uuid REFERENCES public.profiles(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  reason text,
  UNIQUE(fabric_stock_id,revision)
);
CREATE TABLE public.domain_reconciliation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_table text NOT NULL,
  legacy_id uuid NOT NULL,
  issue text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.profiles(id),
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(legacy_table,legacy_id,issue)
);

CREATE TABLE public.tailoring_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (btrim(code) <> ''),
  name text NOT NULL CHECK (btrim(name) <> ''),
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.tailoring_charge_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id uuid NOT NULL REFERENCES public.tailoring_charges(id),
  revision integer NOT NULL CHECK (revision > 0),
  amount_paise bigint NOT NULL CHECK (amount_paise >= 0),
  recorded_by uuid REFERENCES public.profiles(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(charge_id,revision)
);
CREATE TABLE public.designs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (btrim(code) <> ''),
  name text NOT NULL CHECK (btrim(name) <> ''),
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.design_charge_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  design_id uuid NOT NULL REFERENCES public.designs(id),
  revision integer NOT NULL CHECK (revision > 0),
  amount_paise bigint NOT NULL CHECK (amount_paise >= 0),
  recorded_by uuid REFERENCES public.profiles(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(design_id,revision), UNIQUE(id,design_id)
);
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (btrim(code) <> ''),
  name text NOT NULL CHECK (btrim(name) <> ''),
  active boolean NOT NULL DEFAULT true
);
-- Reuse materials as the Consumables catalogue, including original units/costs.
ALTER TABLE public.materials ADD COLUMN active boolean NOT NULL DEFAULT true;
COMMENT ON TABLE public.materials IS
  'Consumables catalogue. Legacy qty_on_hand is preserved; new stock will use inventory_movements in Phase 3/8.';

CREATE TABLE public.customer_tailoring_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (btrim(code) <> ''),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  garment text NOT NULL CHECK (btrim(garment) <> ''),
  tailor_assignment_id uuid NOT NULL REFERENCES public.tailor_assignments(id),
  tailoring_charge_version_id uuid REFERENCES public.tailoring_charge_versions(id),
  legacy_job_id uuid UNIQUE REFERENCES public.tailoring_jobs(id),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','open','in_progress','ready','delivered','cancelled')),
  notes text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_tailoring_customer_idx ON public.customer_tailoring_jobs(customer_id);
CREATE INDEX customer_tailoring_assignment_idx ON public.customer_tailoring_jobs(tailor_assignment_id);
-- Internal CP/charge snapshots never live in the customer-facing job row.
CREATE TABLE public.customer_tailoring_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.customer_tailoring_jobs(id),
  revision integer NOT NULL CHECK (revision > 0),
  fabric_cp_total_paise bigint NOT NULL CHECK (fabric_cp_total_paise >= 0),
  tailoring_charge_paise bigint NOT NULL CHECK (tailoring_charge_paise >= 0),
  final_customer_price_paise bigint GENERATED ALWAYS AS
    (fabric_cp_total_paise + tailoring_charge_paise) STORED,
  charge_version_id uuid NOT NULL REFERENCES public.tailoring_charge_versions(id),
  recorded_by uuid REFERENCES public.profiles(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id,revision)
);
CREATE TABLE public.production_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (btrim(code) <> ''),
  product_id uuid NOT NULL REFERENCES public.products(id),
  design_id uuid NOT NULL REFERENCES public.designs(id),
  design_charge_version_id uuid,
  quantity integer NOT NULL CHECK (quantity > 0),
  tailor_assignment_id uuid NOT NULL REFERENCES public.tailor_assignments(id),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','open','in_progress','completed','cancelled')),
  notes text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,product_id,design_id),
  FOREIGN KEY(design_charge_version_id,design_id) REFERENCES public.design_charge_versions(id,design_id)
);
CREATE INDEX production_jobs_assignment_idx ON public.production_jobs(tailor_assignment_id);
CREATE TABLE public.finished_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_job_id uuid NOT NULL,
  product_id uuid NOT NULL,
  design_id uuid NOT NULL,
  piece_number integer NOT NULL CHECK (piece_number > 0),
  barcode_id uuid NOT NULL UNIQUE,
  barcode_kind text NOT NULL DEFAULT 'product' CHECK (barcode_kind = 'product'),
  current_location_id uuid NOT NULL REFERENCES public.locations(id),
  status text NOT NULL DEFAULT 'available'
    CHECK (status IN ('available','sold','archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(production_job_id,piece_number), UNIQUE(id,production_job_id),
  FOREIGN KEY(production_job_id,product_id,design_id)
    REFERENCES public.production_jobs(id,product_id,design_id),
  FOREIGN KEY(barcode_id,barcode_kind) REFERENCES public.barcodes(id,kind)
);
CREATE INDEX finished_products_location_idx ON public.finished_products(current_location_id,status);
CREATE TABLE public.finished_product_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finished_product_id uuid NOT NULL REFERENCES public.finished_products(id),
  revision integer NOT NULL CHECK (revision > 0),
  sp_paise bigint NOT NULL CHECK (sp_paise >= 0),
  recorded_by uuid REFERENCES public.profiles(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(finished_product_id,revision)
);
CREATE FUNCTION public.validate_finished_product() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_quantity integer;
BEGIN
  SELECT quantity INTO v_quantity FROM public.production_jobs
    WHERE id = NEW.production_job_id FOR UPDATE;
  IF NEW.piece_number > v_quantity THEN
    RAISE EXCEPTION 'Piece number exceeds Production Job quantity';
  END IF;
  IF TG_OP = 'INSERT' AND NOT EXISTS (
    SELECT 1 FROM public.locations WHERE id = NEW.current_location_id AND kind = 'workshop'
  ) THEN RAISE EXCEPTION 'Finished Products must initially return to Workshop'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.production_job_id,NEW.piece_number,NEW.barcode_id)
    IS DISTINCT FROM (OLD.production_job_id,OLD.piece_number,OLD.barcode_id) THEN
    RAISE EXCEPTION 'Finished Product identity cannot be rewritten';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER finished_product_identity BEFORE INSERT OR UPDATE ON public.finished_products
FOR EACH ROW EXECUTE FUNCTION public.validate_finished_product();
CREATE FUNCTION public.validate_production_quantity() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.finished_products
    WHERE production_job_id = NEW.id AND piece_number > NEW.quantity) THEN
    RAISE EXCEPTION 'Quantity cannot exclude existing Finished Products';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER production_quantity_guard BEFORE UPDATE OF quantity ON public.production_jobs
FOR EACH ROW EXECUTE FUNCTION public.validate_production_quantity();

CREATE TABLE public.job_material_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_tailoring_job_id uuid REFERENCES public.customer_tailoring_jobs(id),
  production_job_id uuid REFERENCES public.production_jobs(id),
  fabric_stock_id uuid REFERENCES public.fabric_stock(id),
  material_id uuid REFERENCES public.materials(id),
  quantity numeric(18,3) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL CHECK (btrim(unit) <> ''),
  CHECK (num_nonnulls(customer_tailoring_job_id,production_job_id) = 1),
  CHECK (num_nonnulls(fabric_stock_id,material_id) = 1),
  CHECK (fabric_stock_id IS NULL OR (unit = 'mm' AND quantity = trunc(quantity)))
);
CREATE INDEX job_requirements_customer_idx ON public.job_material_requirements(customer_tailoring_job_id);
CREATE INDEX job_requirements_production_idx ON public.job_material_requirements(production_job_id);
CREATE TABLE public.material_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (btrim(code) <> ''),
  customer_tailoring_job_id uuid REFERENCES public.customer_tailoring_jobs(id),
  production_job_id uuid REFERENCES public.production_jobs(id),
  tailor_assignment_id uuid NOT NULL REFERENCES public.tailor_assignments(id),
  source_location_id uuid NOT NULL REFERENCES public.locations(id),
  issue_type text NOT NULL DEFAULT 'required' CHECK (issue_type IN ('required','additional')),
  reason text,
  issued_by uuid REFERENCES public.profiles(id),
  issued_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(customer_tailoring_job_id,production_job_id) = 1)
);
CREATE INDEX material_issues_customer_idx ON public.material_issues(customer_tailoring_job_id);
CREATE INDEX material_issues_production_idx ON public.material_issues(production_job_id);
CREATE TABLE public.material_issue_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_issue_id uuid NOT NULL REFERENCES public.material_issues(id),
  fabric_stock_id uuid REFERENCES public.fabric_stock(id),
  thaan_id uuid,
  material_id uuid REFERENCES public.materials(id),
  quantity numeric(18,3) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL CHECK (btrim(unit) <> ''),
  UNIQUE(id,material_issue_id),
  CHECK (num_nonnulls(thaan_id,material_id) = 1),
  CHECK ((thaan_id IS NOT NULL) = (fabric_stock_id IS NOT NULL)),
  CHECK (thaan_id IS NULL OR (unit = 'mm' AND quantity = trunc(quantity))),
  FOREIGN KEY(thaan_id,fabric_stock_id) REFERENCES public.thaans(id,fabric_stock_id)
);
CREATE INDEX material_issue_lines_issue_idx ON public.material_issue_lines(material_issue_id);

CREATE TABLE public.stock_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (btrim(code) <> ''),
  source_location_id uuid NOT NULL REFERENCES public.locations(id),
  destination_location_id uuid NOT NULL REFERENCES public.locations(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','cancelled')),
  reason text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_location_id <> destination_location_id)
);
CREATE TABLE public.stock_transfer_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES public.stock_transfers(id),
  fabric_stock_id uuid REFERENCES public.fabric_stock(id),
  thaan_id uuid,
  material_id uuid REFERENCES public.materials(id),
  finished_product_id uuid REFERENCES public.finished_products(id),
  quantity numeric(18,3) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL CHECK (btrim(unit) <> ''),
  UNIQUE(id,transfer_id),
  CHECK (num_nonnulls(thaan_id,material_id,finished_product_id) = 1),
  CHECK ((thaan_id IS NOT NULL) = (fabric_stock_id IS NOT NULL)),
  CHECK (thaan_id IS NULL OR (unit = 'mm' AND quantity = trunc(quantity))),
  CHECK (finished_product_id IS NULL OR (unit = 'pc' AND quantity = 1)),
  FOREIGN KEY(thaan_id,fabric_stock_id) REFERENCES public.thaans(id,fabric_stock_id)
);
CREATE INDEX transfer_lines_transfer_idx ON public.stock_transfer_lines(transfer_id);

CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (btrim(code) <> ''),
  kind text NOT NULL CHECK (kind IN ('direct_fabric_sale','customer_tailoring','finished_product_sale')),
  customer_id uuid REFERENCES public.customers(id),
  customer_tailoring_job_id uuid REFERENCES public.customer_tailoring_jobs(id),
  legacy_sale_id uuid UNIQUE REFERENCES public.sales(id),
  source_location_id uuid NOT NULL REFERENCES public.locations(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','completed','cancelled')),
  final_customer_price_paise bigint CHECK (final_customer_price_paise >= 0),
  reference text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'customer_tailoring') = (customer_tailoring_job_id IS NOT NULL)),
  CHECK (kind <> 'customer_tailoring' OR customer_id IS NOT NULL)
);
CREATE INDEX orders_customer_idx ON public.orders(customer_id,created_at);
CREATE TABLE public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id),
  fabric_stock_id uuid REFERENCES public.fabric_stock(id),
  thaan_id uuid,
  finished_product_id uuid REFERENCES public.finished_products(id),
  customer_tailoring_job_id uuid REFERENCES public.customer_tailoring_jobs(id),
  quantity numeric(18,3) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL CHECK (btrim(unit) <> ''),
  sp_snapshot_paise bigint CHECK (sp_snapshot_paise >= 0),
  final_customer_price_paise bigint NOT NULL CHECK (final_customer_price_paise >= 0),
  UNIQUE(id,order_id),
  CHECK (num_nonnulls(thaan_id,finished_product_id,customer_tailoring_job_id) = 1),
  CHECK ((thaan_id IS NOT NULL) = (fabric_stock_id IS NOT NULL)),
  CHECK (thaan_id IS NULL OR (unit = 'mm' AND quantity = trunc(quantity))),
  CHECK (finished_product_id IS NULL OR (unit = 'pc' AND quantity = 1)),
  CHECK (customer_tailoring_job_id IS NULL OR (unit = 'job' AND quantity = 1 AND sp_snapshot_paise IS NULL)),
  FOREIGN KEY(thaan_id,fabric_stock_id) REFERENCES public.thaans(id,fabric_stock_id)
);
CREATE INDEX order_items_order_idx ON public.order_items(order_id);
CREATE TABLE public.order_item_financials (
  order_item_id uuid PRIMARY KEY REFERENCES public.order_items(id),
  cp_snapshot_paise bigint CHECK (cp_snapshot_paise >= 0),
  production_cost_snapshot_paise bigint CHECK (production_cost_snapshot_paise >= 0),
  tailoring_charge_snapshot_paise bigint CHECK (tailoring_charge_snapshot_paise >= 0),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

-- New general ledger shape; old stock_movements remains unchanged and remains
-- the current application's authority until an approved ledger cutover.
CREATE TABLE public.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN
    ('INWARD','SALE','TRANSFER','MATERIAL_ISSUE','PRODUCTION','TAILORING','WASTAGE','ADJUSTMENT','RETURN')),
  fabric_stock_id uuid REFERENCES public.fabric_stock(id),
  thaan_id uuid,
  material_id uuid REFERENCES public.materials(id),
  finished_product_id uuid REFERENCES public.finished_products(id),
  quantity numeric(18,3) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL CHECK (btrim(unit) <> ''),
  source_location_id uuid REFERENCES public.locations(id),
  destination_location_id uuid REFERENCES public.locations(id),
  customer_tailoring_job_id uuid REFERENCES public.customer_tailoring_jobs(id),
  production_job_id uuid REFERENCES public.production_jobs(id),
  order_item_id uuid REFERENCES public.order_items(id),
  material_issue_line_id uuid REFERENCES public.material_issue_lines(id),
  stock_transfer_line_id uuid REFERENCES public.stock_transfer_lines(id),
  legacy_stock_movement_id uuid UNIQUE REFERENCES public.stock_movements(id),
  reference text,
  reason text,
  actor_id uuid REFERENCES public.profiles(id),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(thaan_id,material_id,finished_product_id) = 1),
  CHECK ((thaan_id IS NOT NULL) = (fabric_stock_id IS NOT NULL)),
  CHECK (thaan_id IS NULL OR (unit = 'mm' AND quantity = trunc(quantity))),
  CHECK (finished_product_id IS NULL OR (unit = 'pc' AND quantity = 1)),
  CHECK (num_nonnulls(source_location_id,destination_location_id) > 0),
  CHECK (source_location_id IS DISTINCT FROM destination_location_id),
  CHECK (num_nonnulls(customer_tailoring_job_id,production_job_id) <= 1),
  CHECK (num_nonnulls(order_item_id,material_issue_line_id,stock_transfer_line_id) <= 1),
  CHECK (kind <> 'TRANSFER' OR (source_location_id IS NOT NULL AND destination_location_id IS NOT NULL
    AND stock_transfer_line_id IS NOT NULL)),
  CHECK (kind <> 'MATERIAL_ISSUE' OR (source_location_id IS NOT NULL AND material_issue_line_id IS NOT NULL)),
  FOREIGN KEY(thaan_id,fabric_stock_id) REFERENCES public.thaans(id,fabric_stock_id)
);
CREATE INDEX inventory_movements_thaan_idx ON public.inventory_movements(thaan_id,occurred_at);
CREATE INDEX inventory_movements_material_idx ON public.inventory_movements(material_id,occurred_at);
CREATE INDEX inventory_movements_product_idx ON public.inventory_movements(finished_product_id,occurred_at);
CREATE INDEX inventory_movements_source_idx ON public.inventory_movements(source_location_id,occurred_at);
CREATE INDEX inventory_movements_destination_idx ON public.inventory_movements(destination_location_id,occurred_at);
CREATE UNIQUE INDEX inventory_transfer_event_idx ON public.inventory_movements(stock_transfer_line_id)
  WHERE kind = 'TRANSFER';
CREATE UNIQUE INDEX inventory_issue_event_idx ON public.inventory_movements(material_issue_line_id)
  WHERE kind = 'MATERIAL_ISSUE';

CREATE TABLE public.production_cost_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_job_id uuid NOT NULL REFERENCES public.production_jobs(id),
  revision integer NOT NULL CHECK (revision > 0),
  quantity_snapshot integer NOT NULL CHECK (quantity_snapshot > 0),
  recorded_by uuid REFERENCES public.profiles(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  reason text,
  UNIQUE(production_job_id,revision), UNIQUE(id,production_job_id)
);
-- Component rows are the cost authority; no redundant editable aggregate.
-- Cost calculation, finalization and allocation operations belong to Phase 12.
CREATE TABLE public.production_cost_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cost_version_id uuid NOT NULL REFERENCES public.production_cost_versions(id),
  category text NOT NULL CHECK (category IN
    ('fabric','tailoring_production','design_embroidery','buttons','thread','padding','other_consumables','other_production')),
  amount_paise bigint NOT NULL CHECK (amount_paise >= 0),
  description text,
  fabric_cost_id uuid REFERENCES public.fabric_stock_costs(id),
  design_charge_version_id uuid REFERENCES public.design_charge_versions(id),
  material_issue_line_id uuid REFERENCES public.material_issue_lines(id),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX production_cost_lines_version_idx ON public.production_cost_lines(cost_version_id);
CREATE TABLE public.finished_product_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finished_product_id uuid NOT NULL,
  production_job_id uuid NOT NULL,
  material_issue_line_id uuid NOT NULL REFERENCES public.material_issue_lines(id),
  quantity numeric(18,3) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL CHECK (btrim(unit) <> ''),
  FOREIGN KEY(finished_product_id,production_job_id) REFERENCES public.finished_products(id,production_job_id),
  UNIQUE(finished_product_id,material_issue_line_id),
  CHECK (unit <> 'mm' OR quantity = trunc(quantity))
);
CREATE INDEX finished_product_materials_job_idx ON public.finished_product_materials(production_job_id);
CREATE TABLE public.finished_product_cost_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finished_product_id uuid NOT NULL,
  production_job_id uuid NOT NULL,
  cost_version_id uuid NOT NULL,
  amount_paise bigint NOT NULL CHECK (amount_paise >= 0),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(finished_product_id,production_job_id) REFERENCES public.finished_products(id,production_job_id),
  FOREIGN KEY(cost_version_id,production_job_id) REFERENCES public.production_cost_versions(id,production_job_id),
  UNIQUE(finished_product_id,cost_version_id)
);
CREATE TABLE public.erp_audit_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES public.profiles(id),
  action text NOT NULL CHECK (btrim(action) <> ''),
  entity_table text NOT NULL CHECK (btrim(entity_table) <> ''),
  entity_id uuid NOT NULL,
  previous_value jsonb,
  new_value jsonb,
  reference text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX erp_audit_entity_idx ON public.erp_audit_records(entity_table,entity_id,occurred_at);

-- Model-level relationship guards only; these do not perform an issue, sale,
-- transfer, production completion, pricing action or balance calculation.
CREATE FUNCTION public.validate_domain_links() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_row record; v_parent record; v_unit text; v_used numeric;
BEGIN
  IF TG_TABLE_NAME IN ('job_material_requirements','material_issue_lines','stock_transfer_lines','inventory_movements') THEN
    IF NEW.material_id IS NOT NULL THEN
      SELECT unit INTO v_unit FROM public.materials WHERE id = NEW.material_id;
      IF NEW.unit IS DISTINCT FROM v_unit THEN RAISE EXCEPTION 'Consumable unit must match catalogue'; END IF;
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'material_issues' THEN
    IF NEW.customer_tailoring_job_id IS NOT NULL THEN
      SELECT tailor_assignment_id INTO v_row FROM public.customer_tailoring_jobs WHERE id = NEW.customer_tailoring_job_id;
    ELSE
      SELECT tailor_assignment_id INTO v_row FROM public.production_jobs WHERE id = NEW.production_job_id;
    END IF;
    IF NEW.tailor_assignment_id IS DISTINCT FROM v_row.tailor_assignment_id THEN
      RAISE EXCEPTION 'Material Issue must snapshot the job assignment';
    END IF;
  ELSIF TG_TABLE_NAME = 'orders' THEN
    IF NEW.customer_tailoring_job_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.customer_tailoring_jobs
        WHERE id = NEW.customer_tailoring_job_id AND customer_id = NEW.customer_id) THEN
        RAISE EXCEPTION 'Order customer must match Customer Tailoring Job';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'order_items' THEN
    SELECT * INTO v_parent FROM public.orders WHERE id = NEW.order_id;
    IF (v_parent.kind = 'direct_fabric_sale' AND NEW.thaan_id IS NULL)
      OR (v_parent.kind = 'finished_product_sale' AND NEW.finished_product_id IS NULL)
      OR (v_parent.kind = 'customer_tailoring' AND NEW.customer_tailoring_job_id IS DISTINCT FROM v_parent.customer_tailoring_job_id) THEN
      RAISE EXCEPTION 'Order item type/job must match order';
    END IF;
  ELSIF TG_TABLE_NAME = 'finished_product_materials' THEN
    SELECT l.unit, l.quantity, i.production_job_id INTO v_row FROM public.material_issue_lines l
      JOIN public.material_issues i ON i.id = l.material_issue_id WHERE l.id = NEW.material_issue_line_id FOR UPDATE OF l;
    IF NEW.production_job_id IS DISTINCT FROM v_row.production_job_id OR NEW.unit IS DISTINCT FROM v_row.unit THEN
      RAISE EXCEPTION 'Finished Product material must originate from its Production Job in the same unit';
    END IF;
    SELECT coalesce(sum(quantity),0) INTO v_used FROM public.finished_product_materials
      WHERE material_issue_line_id = NEW.material_issue_line_id AND id <> NEW.id;
    IF v_used + NEW.quantity > v_row.quantity THEN RAISE EXCEPTION 'Piece allocations exceed issued material'; END IF;
  ELSIF TG_TABLE_NAME = 'inventory_movements' THEN
    IF NEW.stock_transfer_line_id IS NOT NULL THEN
      SELECT l.*, t.source_location_id, t.destination_location_id INTO v_row
        FROM public.stock_transfer_lines l JOIN public.stock_transfers t ON t.id = l.transfer_id
        WHERE l.id = NEW.stock_transfer_line_id;
      IF NEW.kind <> 'TRANSFER' OR
        (NEW.thaan_id,NEW.material_id,NEW.finished_product_id,NEW.fabric_stock_id,NEW.quantity,NEW.unit,NEW.source_location_id,NEW.destination_location_id)
        IS DISTINCT FROM
        (v_row.thaan_id,v_row.material_id,v_row.finished_product_id,v_row.fabric_stock_id,v_row.quantity,v_row.unit,v_row.source_location_id,v_row.destination_location_id) THEN
        RAISE EXCEPTION 'Transfer movement must match its transfer line and locations';
      END IF;
    END IF;
    IF NEW.material_issue_line_id IS NOT NULL THEN
      SELECT l.*, i.source_location_id,i.customer_tailoring_job_id,i.production_job_id INTO v_row
        FROM public.material_issue_lines l JOIN public.material_issues i ON i.id = l.material_issue_id
        WHERE l.id = NEW.material_issue_line_id;
      IF NEW.kind <> 'MATERIAL_ISSUE' OR NEW.finished_product_id IS NOT NULL OR
        (NEW.thaan_id,NEW.material_id,NEW.fabric_stock_id,NEW.quantity,NEW.unit,NEW.source_location_id,NEW.customer_tailoring_job_id,NEW.production_job_id)
        IS DISTINCT FROM
        (v_row.thaan_id,v_row.material_id,v_row.fabric_stock_id,v_row.quantity,v_row.unit,v_row.source_location_id,v_row.customer_tailoring_job_id,v_row.production_job_id) THEN
        RAISE EXCEPTION 'Issue movement must match its material line, job and source';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'customer_tailoring_prices' THEN
    IF NOT EXISTS (SELECT 1 FROM public.tailoring_charge_versions
      WHERE id = NEW.charge_version_id AND amount_paise = NEW.tailoring_charge_paise) THEN
      RAISE EXCEPTION 'Tailoring price must snapshot the selected charge amount';
    END IF;
  ELSIF TG_TABLE_NAME = 'production_cost_versions' THEN
    IF NOT EXISTS (SELECT 1 FROM public.production_jobs
      WHERE id = NEW.production_job_id AND quantity = NEW.quantity_snapshot) THEN
      RAISE EXCEPTION 'Cost quantity must snapshot the Production Job';
    END IF;
  ELSIF TG_TABLE_NAME = 'production_cost_lines' THEN
    SELECT v.production_job_id, j.design_id INTO v_parent FROM public.production_cost_versions v
      JOIN public.production_jobs j ON j.id = v.production_job_id WHERE v.id = NEW.cost_version_id;
    IF NEW.design_charge_version_id IS NOT NULL THEN
      IF NEW.category <> 'design_embroidery' OR NOT EXISTS (
        SELECT 1 FROM public.design_charge_versions d
        WHERE d.id = NEW.design_charge_version_id AND d.design_id = v_parent.design_id
      ) THEN RAISE EXCEPTION 'Design cost must reference the Production Job design'; END IF;
    END IF;
    IF NEW.material_issue_line_id IS NOT NULL THEN
      SELECT l.fabric_stock_id,i.production_job_id INTO v_row FROM public.material_issue_lines l
        JOIN public.material_issues i ON i.id = l.material_issue_id WHERE l.id = NEW.material_issue_line_id;
      IF v_row.production_job_id IS DISTINCT FROM v_parent.production_job_id THEN
        RAISE EXCEPTION 'Material cost must originate from the same Production Job';
      END IF;
      IF NEW.fabric_cost_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.fabric_stock_costs c WHERE c.id = NEW.fabric_cost_id AND c.fabric_stock_id = v_row.fabric_stock_id
      ) THEN RAISE EXCEPTION 'Fabric cost must match the issued Fabric + Batch'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DO $$ DECLARE v_table text; BEGIN
  FOREACH v_table IN ARRAY ARRAY['job_material_requirements','material_issue_lines','stock_transfer_lines',
    'inventory_movements','material_issues','orders','order_items','finished_product_materials',
    'customer_tailoring_prices','production_cost_versions','production_cost_lines'] LOOP
    EXECUTE format('CREATE TRIGGER domain_links_guard BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.validate_domain_links()',v_table);
  END LOOP;
END $$;

CREATE FUNCTION public.protect_domain_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'fabric_stock' THEN
    IF (NEW.fabric_id,NEW.batch_id,NEW.barcode_id) IS DISTINCT FROM (OLD.fabric_id,OLD.batch_id,OLD.barcode_id) THEN
      RAISE EXCEPTION 'Fabric + Batch barcode identity cannot be rewritten';
    END IF;
  ELSIF TG_TABLE_NAME = 'tailor_assignments' THEN
    IF (NEW.tailor_id,NEW.factory_id,NEW.section_id,NEW.valid_from)
      IS DISTINCT FROM (OLD.tailor_id,OLD.factory_id,OLD.section_id,OLD.valid_from) THEN
      RAISE EXCEPTION 'Create a new assignment to preserve Factory/Section/Tailor history';
    END IF;
  ELSIF TG_TABLE_NAME = 'production_jobs' THEN
    IF (NEW.product_id,NEW.design_id) IS DISTINCT FROM (OLD.product_id,OLD.design_id) THEN
      RAISE EXCEPTION 'Different product or design requires a different Production Job';
    END IF;
  ELSIF TG_TABLE_NAME = 'orders' THEN
    IF (NEW.kind,NEW.customer_id,NEW.customer_tailoring_job_id,NEW.source_location_id)
      IS DISTINCT FROM (OLD.kind,OLD.customer_id,OLD.customer_tailoring_job_id,OLD.source_location_id) THEN
      RAISE EXCEPTION 'Order identity cannot be rewritten';
    END IF;
  ELSIF TG_TABLE_NAME = 'customer_tailoring_jobs' THEN
    IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN RAISE EXCEPTION 'Job customer identity cannot be rewritten'; END IF;
  END IF;
  RETURN NEW;
END $$;
DO $$ DECLARE v_table text; BEGIN
  FOREACH v_table IN ARRAY ARRAY['fabric_stock','tailor_assignments','production_jobs','orders','customer_tailoring_jobs'] LOOP
    EXECUTE format('CREATE TRIGGER domain_identity_immutable BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.protect_domain_identity()',v_table);
  END LOOP;
END $$;

CREATE FUNCTION public.reject_domain_history_rewrite() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION '% is append-only; create a new version or explicit correction event', TG_TABLE_NAME; END $$;
DO $$ DECLARE v_table text; BEGIN
  FOREACH v_table IN ARRAY ARRAY['barcodes','fabric_stock_costs','fabric_stock_prices','tailoring_charge_versions',
    'design_charge_versions','customer_tailoring_prices','finished_product_prices','order_item_financials',
    'inventory_movements','production_cost_versions','production_cost_lines','finished_product_materials',
    'finished_product_cost_allocations','erp_audit_records','material_issues','material_issue_lines'] LOOP
    EXECUTE format('CREATE TRIGGER domain_history_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.reject_domain_history_rewrite()',v_table);
  END LOOP;
END $$;

-- Group known Fabric + Batch identities only. Preserve every old label, cost,
-- price, movement and job. Missing identities/location/assignment stay unresolved.
CREATE TEMP TABLE phase1_stock_map ON COMMIT DROP AS
  SELECT fabric_id,batch_id,gen_random_uuid() AS stock_id,gen_random_uuid() AS barcode_id
  FROM public.thaans WHERE fabric_id IS NOT NULL AND batch_id IS NOT NULL GROUP BY fabric_id,batch_id;
INSERT INTO public.barcodes(id,code,kind)
  SELECT barcode_id,'FAB-' || upper(replace(stock_id::text,'-','')),'fabric' FROM phase1_stock_map;
INSERT INTO public.fabric_stock(id,fabric_id,batch_id,barcode_id,entry_state)
  SELECT stock_id,fabric_id,batch_id,barcode_id,'legacy_pending' FROM phase1_stock_map;
UPDATE public.thaans t SET fabric_stock_id = m.stock_id FROM phase1_stock_map m
  WHERE t.fabric_id = m.fabric_id AND t.batch_id = m.batch_id;

-- Copy only unanimous, nonnegative values where EVERY member has that value.
-- Mixed/null/invalid values remain in old rows; never average or pick one roll.
INSERT INTO public.fabric_stock_costs(fabric_stock_id,revision,cp_paise_per_m,reason)
  SELECT t.fabric_stock_id,1,min(c.cost_paise),'Unanimous legacy CP snapshot'
  FROM public.thaans t LEFT JOIN public.thaan_costs c ON c.thaan_id = t.id
  WHERE t.fabric_stock_id IS NOT NULL GROUP BY t.fabric_stock_id
  HAVING count(c.cost_paise) = count(*) AND count(DISTINCT c.cost_paise) = 1 AND min(c.cost_paise) >= 0;
INSERT INTO public.fabric_stock_prices(fabric_stock_id,revision,sp_paise_per_m,reason)
  SELECT fabric_stock_id,1,min(price_paise),'Unanimous legacy SP snapshot'
  FROM public.thaans WHERE fabric_stock_id IS NOT NULL GROUP BY fabric_stock_id
  HAVING count(price_paise) = count(*) AND count(DISTINCT price_paise) = 1 AND min(price_paise) >= 0;
INSERT INTO public.domain_reconciliation(legacy_table,legacy_id,issue,details)
  SELECT 'thaans',id,'missing_fabric_or_batch',jsonb_build_object('fabric_id',fabric_id,'batch_id',batch_id)
  FROM public.thaans WHERE fabric_stock_id IS NULL;
INSERT INTO public.domain_reconciliation(legacy_table,legacy_id,issue,details)
  SELECT 'fabric_stock',t.fabric_stock_id,'cp_requires_reconciliation',
    jsonb_build_object('legacy_cp_values',jsonb_agg(DISTINCT c.cost_paise))
  FROM public.thaans t LEFT JOIN public.thaan_costs c ON c.thaan_id = t.id
  WHERE t.fabric_stock_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.fabric_stock_costs c2 WHERE c2.fabric_stock_id = t.fabric_stock_id)
  GROUP BY t.fabric_stock_id;
INSERT INTO public.domain_reconciliation(legacy_table,legacy_id,issue,details)
  SELECT 'fabric_stock',fabric_stock_id,'sp_requires_reconciliation',
    jsonb_build_object('legacy_sp_values',jsonb_agg(DISTINCT price_paise))
  FROM public.thaans WHERE fabric_stock_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.fabric_stock_prices p WHERE p.fabric_stock_id = thaans.fabric_stock_id)
  GROUP BY fabric_stock_id HAVING count(price_paise) > 0;
INSERT INTO public.domain_reconciliation(legacy_table,legacy_id,issue,details)
  SELECT 'thaans',id,'location_unverified',jsonb_build_object('legacy_rack',rack)
  FROM public.thaans;
INSERT INTO public.domain_reconciliation(legacy_table,legacy_id,issue,details)
  SELECT 'tailoring_jobs',id,'job_domain_and_assignment_unverified',
    jsonb_build_object('has_customer',customer_id IS NOT NULL,'legacy_tailor_id',tailor_id)
  FROM public.tailoring_jobs;
INSERT INTO public.domain_reconciliation(legacy_table,legacy_id,issue,details)
  SELECT 'materials',id,'opening_stock_location_unverified',jsonb_build_object('legacy_qty_on_hand',qty_on_hand,'unit',unit)
  FROM public.materials;
INSERT INTO public.domain_reconciliation(legacy_table,legacy_id,issue)
  SELECT 'profiles',id,'auth_user_reference_unverified' FROM public.profiles p
  WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id);
INSERT INTO public.domain_reconciliation(legacy_table,legacy_id,issue)
  SELECT 'user_roles',id,'profile_reference_unverified' FROM public.user_roles r
  WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = r.user_id);
INSERT INTO public.domain_reconciliation(legacy_table,legacy_id,issue)
  SELECT 'user_permission_overrides',user_id,'profile_reference_unverified' FROM public.user_permission_overrides o
  WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = o.user_id)
  GROUP BY user_id;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id=p.id)) THEN
    ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_auth_user_fkey;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=r.user_id)) THEN
    ALTER TABLE public.user_roles VALIDATE CONSTRAINT user_roles_profile_fkey;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_permission_overrides o WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=o.user_id)) THEN
    ALTER TABLE public.user_permission_overrides VALIDATE CONSTRAINT permission_overrides_profile_fkey;
  END IF;
END $$;

-- Seal every new table, including financial reconciliation details. No Owner,
-- Counter, Tailor or Stock Entry policies are introduced in Phase 1.
DO $$ DECLARE v_table text; BEGIN
  FOREACH v_table IN ARRAY ARRAY['locations','tailoring_factories','tailoring_sections','tailors','tailor_assignments',
    'barcodes','fabric_stock','fabric_stock_costs','fabric_stock_prices','domain_reconciliation',
    'tailoring_charges','tailoring_charge_versions','designs','design_charge_versions','products',
    'customer_tailoring_jobs','customer_tailoring_prices','production_jobs','finished_products','finished_product_prices',
    'job_material_requirements','material_issues','material_issue_lines','stock_transfers','stock_transfer_lines',
    'orders','order_items','order_item_financials','inventory_movements','production_cost_versions',
    'production_cost_lines','finished_product_materials','finished_product_cost_allocations','erp_audit_records'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',v_table);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated',v_table);
    EXECUTE format('GRANT ALL ON public.%I TO service_role',v_table);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.validate_showroom_parent() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.validate_finished_product() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.validate_production_quantity() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.validate_domain_links() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.reject_domain_history_rewrite() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.protect_domain_identity() FROM PUBLIC,anon,authenticated;
COMMIT;
