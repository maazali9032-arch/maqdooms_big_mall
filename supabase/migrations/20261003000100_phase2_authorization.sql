-- Phase 2 only: authorization. No inventory cutover or operational backfill.
BEGIN;

-- Financial and administration permissions cannot be delegated by overrides.
CREATE OR REPLACE FUNCTION public.has_perm(_user_id uuid, _perm text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 SELECT public.is_active_staff(_user_id) AND CASE
 WHEN _perm IN ('inventory.view_cost','tailoring.view_costs','reports.view','audit.view','access.manage','pos.override_price_or_discount','stock.adjust','stock.return_from_tailor')
 THEN public.has_role(_user_id,'owner')
 WHEN _perm IN ('inventory.receive','inventory.edit_thaan') AND NOT public.has_any_role(_user_id,ARRAY['owner','stock_entry']) THEN false
 WHEN _perm IN ('pos.sell','pos.issue_to_tailoring') AND NOT public.has_any_role(_user_id,ARRAY['owner','counter']) THEN false
 WHEN _perm='tailoring.manage_jobs' AND NOT public.has_any_role(_user_id,ARRAY['owner','counter','tailor']) THEN false
 ELSE public.has_role(_user_id,'owner') OR coalesce(
 (SELECT granted FROM public.user_permission_overrides WHERE user_id=_user_id AND permission_key=_perm),
 EXISTS(SELECT 1 FROM public.user_roles u JOIN public.role_permissions p ON p.role_key=u.role_key
 WHERE u.user_id=_user_id AND p.permission_key=_perm)) END;
$$;

CREATE OR REPLACE FUNCTION public.bootstrap_current_user(_full_name text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_role text;
  v_active boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  PERFORM pg_advisory_xact_lock(73120402);
  IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=v_uid) THEN RAISE EXCEPTION 'Auth user required'; END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  INSERT INTO public.profiles(id, full_name, email, last_login)
  VALUES (v_uid, coalesce(_full_name, split_part(coalesce(v_email,'staff'),'@',1)), v_email, now())
  ON CONFLICT (id) DO UPDATE SET last_login = now(), email = excluded.email;

  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_uid) THEN
    IF EXISTS (SELECT 1 FROM public.user_roles WHERE role_key = 'owner') THEN
      v_role := 'counter';
    ELSE
      v_role := 'owner';
    END IF;
    INSERT INTO public.user_roles(user_id, role_key) VALUES (v_uid, v_role) ON CONFLICT DO NOTHING;
  END IF;

  SELECT active INTO v_active FROM public.profiles WHERE id = v_uid;
  RETURN jsonb_build_object(
    'user_id', v_uid,
    'active', v_active,
    'roles', (
      SELECT coalesce(jsonb_agg(role_key ORDER BY role_key), '[]'::jsonb)
      FROM public.user_roles WHERE user_id = v_uid
    ),
    'permissions', CASE WHEN v_active THEN (
      SELECT coalesce(jsonb_agg(p.key ORDER BY p.key), '[]'::jsonb)
      FROM public.permissions p
      WHERE public.has_perm(v_uid, p.key)
    ) ELSE '[]'::jsonb END
  );
END;
$$;

-- An open receiving workflow belongs to its creator. Unattributed legacy work
-- is Owner-only; never infer ownership or silently assign historical records.
CREATE FUNCTION public.can_enter_legacy_cp(p_thaan uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 SELECT public.has_role(auth.uid(),'owner') OR (
 public.has_role(auth.uid(),'stock_entry') AND public.has_perm(auth.uid(),'inventory.receive') AND EXISTS(
 SELECT 1 FROM public.thaans t JOIN public.receiving_batches b ON b.id=t.batch_id
 WHERE t.id=p_thaan AND t.created_by=auth.uid() AND b.created_by=auth.uid()
 AND b.status='draft' AND t.status='draft'));
$$;
DROP POLICY "read costs with permission" ON public.thaan_costs;
DROP POLICY "write costs with permission" ON public.thaan_costs;
CREATE POLICY owner_costs ON public.thaan_costs FOR ALL TO authenticated
 USING(public.has_role(auth.uid(),'owner')) WITH CHECK(public.has_role(auth.uid(),'owner'));

CREATE FUNCTION public.stock_entry_cp(p_thaan_id uuid) RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF NOT public.can_enter_legacy_cp(p_thaan_id) THEN RAISE EXCEPTION 'Open owned receiving workflow required'; END IF;
 RETURN (SELECT cost_paise FROM public.thaan_costs WHERE thaan_id=p_thaan_id);
END; $$;
CREATE FUNCTION public.stock_entry_set_cp(p_thaan_id uuid,p_cost_paise integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_batch uuid;
BEGIN
 SELECT batch_id INTO v_batch FROM public.thaans WHERE id=p_thaan_id;
 PERFORM 1 FROM public.receiving_batches WHERE id=v_batch FOR UPDATE;
 PERFORM 1 FROM public.thaans WHERE id=p_thaan_id FOR UPDATE;
 IF NOT public.can_enter_legacy_cp(p_thaan_id) THEN RAISE EXCEPTION 'Open owned receiving workflow required'; END IF;
 IF p_cost_paise IS NULL OR p_cost_paise<0 THEN RAISE EXCEPTION 'Nonnegative CP required'; END IF;
 INSERT INTO public.thaan_costs(thaan_id,cost_paise,updated_by,updated_at)
 VALUES(p_thaan_id,p_cost_paise,auth.uid(),now()) ON CONFLICT(thaan_id) DO UPDATE
 SET cost_paise=excluded.cost_paise,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
END; $$;

-- These guards also run inside SECURITY DEFINER correction/commit RPCs.
CREATE FUNCTION public.guard_receiving_authorization() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF auth.uid() IS NULL THEN
   IF current_setting('role') IN ('anon','authenticated') THEN RAISE EXCEPTION 'Authentication required'; END IF;
   RETURN NEW; -- migration/service maintenance; no browser bypass
 END IF;
 IF public.has_role(auth.uid(),'owner') THEN RETURN NEW; END IF;
 -- Existing sale/issue RPCs may mark exhausted stock depleted. No other
 -- inventory field may change through this authorization exception.
 IF TG_TABLE_NAME='thaans' AND TG_OP='UPDATE' AND OLD.status='active' AND NEW.status='depleted'
 AND public.has_any_role(auth.uid(),ARRAY['counter','tailor'])
 AND (to_jsonb(NEW)-'status'-'updated_at')=(to_jsonb(OLD)-'status'-'updated_at') THEN RETURN NEW; END IF;
 IF NOT public.has_role(auth.uid(),'stock_entry') OR NOT public.has_perm(auth.uid(),'inventory.receive') THEN
   RAISE EXCEPTION 'Stock Entry role required';
 END IF;
 IF TG_TABLE_NAME='receiving_batches' THEN
   IF TG_OP='INSERT' THEN NEW.created_by:=auth.uid();
   ELSIF OLD.created_by IS DISTINCT FROM auth.uid() OR OLD.status<>'draft'
      OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN RAISE EXCEPTION 'Open owned receiving workflow required'; END IF;
 ELSE
   IF TG_OP='INSERT' THEN
     NEW.created_by:=auth.uid();
     IF NEW.price_paise IS NOT NULL OR NEW.status<>'draft' THEN RAISE EXCEPTION 'Only Owner controls SP and activation'; END IF;
   ELSE
     IF NOT public.can_enter_legacy_cp(OLD.id) OR NEW.created_by IS DISTINCT FROM OLD.created_by
        OR NEW.batch_id IS DISTINCT FROM OLD.batch_id THEN RAISE EXCEPTION 'Open owned receiving workflow required'; END IF;
     IF NEW.price_paise IS DISTINCT FROM OLD.price_paise THEN RAISE EXCEPTION 'Only Owner controls SP'; END IF;
   END IF;
   IF NOT EXISTS(SELECT 1 FROM public.receiving_batches WHERE id=NEW.batch_id AND created_by=auth.uid() AND status='draft') THEN
     RAISE EXCEPTION 'Open owned receiving workflow required'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER phase2_receiving_auth BEFORE INSERT OR UPDATE ON public.receiving_batches
FOR EACH ROW EXECUTE FUNCTION public.guard_receiving_authorization();
CREATE TRIGGER phase2_thaan_auth BEFORE INSERT OR UPDATE ON public.thaans
FOR EACH ROW EXECUTE FUNCTION public.guard_receiving_authorization();
CREATE FUNCTION public.guard_legacy_cost_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.cost_paise<0 THEN RAISE EXCEPTION 'Nonnegative CP required'; END IF;
 IF auth.uid() IS NOT NULL AND NOT public.can_enter_legacy_cp(NEW.thaan_id) THEN
 RAISE EXCEPTION 'Open owned receiving workflow required'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER phase2_cost_auth BEFORE INSERT OR UPDATE ON public.thaan_costs
FOR EACH ROW EXECUTE FUNCTION public.guard_legacy_cost_write();
DROP POLICY "receive batches" ON public.receiving_batches;
CREATE POLICY phase2_owner_batches ON public.receiving_batches FOR ALL TO authenticated USING(public.has_role(auth.uid(),'owner')) WITH CHECK(public.has_role(auth.uid(),'owner'));
CREATE POLICY phase2_entry_batch_create ON public.receiving_batches FOR INSERT TO authenticated WITH CHECK(public.has_role(auth.uid(),'stock_entry') AND public.has_perm(auth.uid(),'inventory.receive') AND created_by=auth.uid() AND status='draft');
CREATE POLICY phase2_entry_batch_update ON public.receiving_batches FOR UPDATE TO authenticated USING(public.has_role(auth.uid(),'stock_entry') AND public.has_perm(auth.uid(),'inventory.receive') AND created_by=auth.uid() AND status='draft') WITH CHECK(public.has_role(auth.uid(),'stock_entry') AND created_by=auth.uid());

-- Active assignment is required even for direct SQL, not just job-selection RPCs.
CREATE OR REPLACE FUNCTION public.thaan_available_mm(p_thaan uuid) RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter','stock_entry','ecommerce_manager'])
 AND NOT (public.has_role(auth.uid(),'tailor') AND EXISTS(SELECT 1 FROM public.tailoring_job_lines l
 JOIN public.tailoring_jobs j ON j.id=l.job_id WHERE l.thaan_id=p_thaan AND j.tailor_id=auth.uid())) THEN
 RAISE EXCEPTION 'Active operational role or assigned material required'; END IF;
 RETURN coalesce((SELECT sum(delta_mm) FROM public.stock_movements WHERE thaan_id=p_thaan),0)::integer;
END; $$;
DROP POLICY "read tailoring_jobs" ON public.tailoring_jobs;
CREATE POLICY "read tailoring_jobs" ON public.tailoring_jobs FOR SELECT TO authenticated USING(
 public.has_any_role(auth.uid(),ARRAY['owner','counter']) OR
 (public.has_role(auth.uid(),'tailor') AND tailor_id=auth.uid()));
DROP POLICY "read tailoring_job_lines" ON public.tailoring_job_lines;
CREATE POLICY "read tailoring_job_lines" ON public.tailoring_job_lines FOR SELECT TO authenticated USING(
 EXISTS(SELECT 1 FROM public.tailoring_jobs j WHERE j.id=job_id));
REVOKE SELECT(price_snapshot_paise) ON public.tailoring_job_lines FROM authenticated;
CREATE FUNCTION public.owner_tailoring_line_prices()
RETURNS TABLE(line_id uuid,price_snapshot_paise integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT id,price_snapshot_paise FROM public.tailoring_job_lines WHERE public.has_role(auth.uid(),'owner');
$$;
DROP POLICY "read thaans" ON public.thaans;
CREATE POLICY "read thaans" ON public.thaans FOR SELECT TO authenticated USING(
 public.has_any_role(auth.uid(),ARRAY['owner','counter','stock_entry','ecommerce_manager']) OR
 (public.has_role(auth.uid(),'tailor') AND EXISTS(SELECT 1 FROM public.tailoring_job_lines l JOIN public.tailoring_jobs j ON j.id=l.job_id WHERE l.thaan_id=thaans.id AND j.tailor_id=auth.uid())));
DROP POLICY "read stock_movements" ON public.stock_movements;
CREATE POLICY "read stock_movements" ON public.stock_movements FOR SELECT TO authenticated USING(
 public.has_any_role(auth.uid(),ARRAY['owner','counter','stock_entry','ecommerce_manager']) OR
 (public.has_role(auth.uid(),'tailor') AND EXISTS(SELECT 1 FROM public.tailoring_jobs j WHERE j.id=job_id AND j.tailor_id=auth.uid())));
CREATE OR REPLACE FUNCTION public.tailoring_job_totals()
RETURNS TABLE(job_id uuid,fabric_cost_paise bigint,selling_value_paise bigint,lines bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT l.job_id,
 CASE WHEN public.has_role(auth.uid(),'owner') THEN coalesce(sum(coalesce(l.cost_snapshot_paise,0)*coalesce(l.length_mm,(coalesce(l.qty,0)*1000)::int)/1000),0)::bigint END,
 CASE WHEN public.has_role(auth.uid(),'owner') THEN coalesce(sum(coalesce(l.price_snapshot_paise,0)*coalesce(l.length_mm,(coalesce(l.qty,0)*1000)::int)/1000),0)::bigint END,
 count(*) FROM public.tailoring_job_lines l JOIN public.tailoring_jobs j ON j.id=l.job_id
 WHERE public.has_any_role(auth.uid(),ARRAY['owner','counter']) OR (public.has_role(auth.uid(),'tailor') AND j.tailor_id=auth.uid()) GROUP BY l.job_id;
$$;

-- Phase 1 domain: Owner reads all data; future mutation workflows stay sealed.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['locations','tailoring_factories','tailoring_sections','tailors','tailor_assignments',
 'barcodes','fabric_stock','fabric_stock_costs','fabric_stock_prices','domain_reconciliation',
 'tailoring_charges','tailoring_charge_versions','designs','design_charge_versions','products',
 'customer_tailoring_jobs','customer_tailoring_prices','production_jobs','finished_products','finished_product_prices',
 'job_material_requirements','material_issues','material_issue_lines','stock_transfers','stock_transfer_lines',
 'orders','order_items','order_item_financials','inventory_movements','production_cost_versions',
 'production_cost_lines','finished_product_materials','finished_product_cost_allocations','erp_audit_records'] LOOP
 EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
 EXECUTE format('CREATE POLICY phase2_owner_read ON public.%I FOR SELECT TO authenticated USING(public.has_role(auth.uid(),''owner''))',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['locations','barcodes','fabric_stock','fabric_stock_prices','products','designs','finished_products','finished_product_prices','tailoring_factories','tailoring_sections','tailors','tailor_assignments'] LOOP
 EXECUTE format('CREATE POLICY phase2_counter_stock ON public.%I FOR SELECT TO authenticated USING(public.has_role(auth.uid(),''counter''))',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['locations','fabric_stock','barcodes'] LOOP
 EXECUTE format('CREATE POLICY phase2_entry_stock ON public.%I FOR SELECT TO authenticated USING(public.has_role(auth.uid(),''stock_entry''))',t);
 END LOOP;
END $$;
CREATE FUNCTION public.owns_tailor_assignment(p_assignment uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.has_role(auth.uid(),'tailor') AND EXISTS(SELECT 1 FROM public.tailor_assignments a
 JOIN public.tailors t ON t.id=a.tailor_id WHERE a.id=p_assignment AND t.profile_id=auth.uid() AND t.active);
$$;
CREATE POLICY phase2_tailor_self ON public.tailors FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'tailor') AND active AND profile_id=auth.uid());
CREATE POLICY phase2_tailor_assignment ON public.tailor_assignments FOR SELECT TO authenticated USING(public.owns_tailor_assignment(id));
CREATE POLICY phase2_tailor_factory ON public.tailoring_factories FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.tailor_assignments a WHERE a.factory_id=tailoring_factories.id AND public.owns_tailor_assignment(a.id)));
CREATE POLICY phase2_tailor_section ON public.tailoring_sections FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.tailor_assignments a WHERE a.section_id=tailoring_sections.id AND public.owns_tailor_assignment(a.id)));
CREATE POLICY phase2_customer_jobs ON public.customer_tailoring_jobs FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'counter') OR public.owns_tailor_assignment(tailor_assignment_id));
CREATE POLICY phase2_production_jobs ON public.production_jobs FOR SELECT TO authenticated USING(public.owns_tailor_assignment(tailor_assignment_id));
CREATE POLICY phase2_job_requirements ON public.job_material_requirements FOR SELECT TO authenticated USING(
 EXISTS(SELECT 1 FROM public.customer_tailoring_jobs j WHERE j.id=customer_tailoring_job_id)
 OR EXISTS(SELECT 1 FROM public.production_jobs j WHERE j.id=production_job_id));
CREATE POLICY phase2_job_issues ON public.material_issues FOR SELECT TO authenticated USING(public.owns_tailor_assignment(tailor_assignment_id) OR (public.has_role(auth.uid(),'counter') AND customer_tailoring_job_id IS NOT NULL));
CREATE POLICY phase2_issue_lines ON public.material_issue_lines FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.material_issues i WHERE i.id=material_issue_id));
CREATE POLICY phase2_tailor_fabric ON public.fabric_stock FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'tailor') AND EXISTS(SELECT 1 FROM public.material_issue_lines l WHERE l.fabric_stock_id=fabric_stock.id));
CREATE POLICY phase2_tailor_barcode ON public.barcodes FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'tailor') AND EXISTS(SELECT 1 FROM public.fabric_stock s WHERE s.barcode_id=barcodes.id));

-- Minimal CP authorization endpoint for the Phase 1 domain. Receiving UI,
-- barcode creation, activation and ledger writes are deferred to later phases.
CREATE FUNCTION public.domain_stock_entry_cp(p_stock_id uuid,p_cp bigint DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.fabric_stock%rowtype; v_revision integer; v_cp bigint;
BEGIN
 SELECT * INTO s FROM public.fabric_stock WHERE id=p_stock_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Stock record not found'; END IF;
 IF NOT public.has_role(auth.uid(),'owner') AND NOT (
 public.has_role(auth.uid(),'stock_entry') AND public.has_perm(auth.uid(),'inventory.receive')
 AND s.created_by=auth.uid() AND s.entry_state IN ('draft','correcting')) THEN
 RAISE EXCEPTION 'Open owned stock-entry workflow required'; END IF;
 SELECT revision,cp_paise_per_m INTO v_revision,v_cp FROM public.fabric_stock_costs
 WHERE fabric_stock_id=s.id ORDER BY revision DESC LIMIT 1;
 IF p_cp IS NOT NULL THEN
   IF p_cp<0 THEN RAISE EXCEPTION 'Nonnegative CP required'; END IF;
   INSERT INTO public.fabric_stock_costs(fabric_stock_id,revision,cp_paise_per_m,recorded_by,reason)
   VALUES(s.id,coalesce(v_revision,0)+1,p_cp,auth.uid(),'Stock-entry workflow CP edit');
   v_cp:=p_cp;
 END IF;
 RETURN v_cp;
END; $$;

-- Final customer price is the sole financial result available to Counter.
CREATE FUNCTION public.customer_tailoring_final_price(p_job_id uuid) RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.has_any_role(auth.uid(),ARRAY['owner','counter']) THEN RAISE EXCEPTION 'Counter or Owner required'; END IF;
 RETURN (SELECT final_customer_price_paise FROM public.customer_tailoring_prices WHERE job_id=p_job_id ORDER BY revision DESC LIMIT 1);
END; $$;

CREATE OR REPLACE FUNCTION public.issue_tailoring_fabrics(
  p_job_id uuid,
  p_items jsonb,
  p_reason text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item jsonb;
  v_barcode text;
  v_length_mm integer;
  v_result jsonb;
  v_price_paise integer;
  v_selling_value integer;
  v_results jsonb := '[]'::jsonb;
  v_total_length integer := 0;
  v_total_value integer := 0;
BEGIN
  IF NOT public.has_perm(auth.uid(), 'pos.issue_to_tailoring') THEN
    RAISE EXCEPTION 'Permission denied: pos.issue_to_tailoring';
  END IF;
  IF p_job_id IS NULL THEN
    RAISE EXCEPTION 'A tailoring job is required';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Fabric cuts must be supplied as a list';
  END IF;
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Add at least one fabric cut';
  END IF;
  IF jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION 'A maximum of 50 fabric cuts can be issued together';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) item
    GROUP BY lower(btrim(item->>'barcode'))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'The same thaan cannot be added more than once';
  END IF;

  FOR v_item IN
    SELECT item
    FROM jsonb_array_elements(p_items) item
    ORDER BY lower(btrim(item->>'barcode'))
  LOOP
    v_barcode := nullif(btrim(v_item->>'barcode'), '');
    IF v_barcode IS NULL THEN
      RAISE EXCEPTION 'Every fabric cut requires a barcode';
    END IF;
    IF coalesce(v_item->>'length_mm', '') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Invalid cut length for thaan %', v_barcode;
    END IF;
    v_length_mm := (v_item->>'length_mm')::integer;

    v_result := public.cut_thaan(
      p_barcode => v_barcode,
      p_length_mm => v_length_mm,
      p_purpose => 'tailoring',
      p_job_id => p_job_id,
      p_category => coalesce(nullif(btrim(v_item->>'category'), ''), 'outer fabric'),
      p_reason => p_reason
    );

    SELECT t.price_paise INTO v_price_paise
    FROM public.thaans t
    WHERE t.id = (v_result->>'thaan_id')::uuid;
    v_selling_value := round(v_length_mm::numeric / 1000 * v_price_paise)::integer;
    v_total_length := v_total_length + v_length_mm;
    v_total_value := v_total_value + v_selling_value;
    v_results := v_results || jsonb_build_array(
      v_result
    );
  END LOOP;

  PERFORM public.log_audit(
    'issue_tailoring_fabrics',
    'tailoring_job',
    p_job_id::text,
    jsonb_build_object(
      'cut_count', jsonb_array_length(p_items),
      'total_length_mm', v_total_length,
      'total_selling_value_paise', v_total_value
    )
  );

  RETURN jsonb_build_object(
    'job_id', p_job_id,
    'cut_count', jsonb_array_length(p_items),
    'total_length_mm', v_total_length,

    'cuts', v_results
  );
END;
$$;

-- Restrict public/anonymous execution of every existing application function.
-- Invoker trigger functions already sealed by Phase 1 remain sealed.
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.prosecdef LOOP
 EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC,anon',f.signature);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.guard_receiving_authorization(),public.guard_legacy_cost_write() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.can_enter_legacy_cp(uuid),public.stock_entry_cp(uuid),public.stock_entry_set_cp(uuid,integer),public.owns_tailor_assignment(uuid),public.customer_tailoring_final_price(uuid),public.domain_stock_entry_cp(uuid,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_staff(uuid),public.has_any_perm(uuid,text[]),public.log_audit(text,text,text,jsonb),public.thaan_available_mm(uuid),public.owner_tailoring_line_prices() TO authenticated;
ALTER VIEW public.v_thaan_stock SET(security_invoker=true);
COMMIT;
