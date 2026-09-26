-- Complete the role, data-access and listing-storage hardening without changing
-- the existing inventory ledger, barcode flow or availability calculation.

-- Role checks, like permission checks, must stop working for inactive staff.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_active_staff(_user_id)
    AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role_key = _role);
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_active_staff(_user_id)
    AND EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = _user_id AND role_key = ANY(_roles)
    );
$$;

GRANT EXECUTE ON FUNCTION public.has_any_role(uuid,text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.log_audit(_action text, _entity text, _ref text, _detail jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_active_staff(auth.uid()) THEN RAISE EXCEPTION 'Active staff account required'; END IF;
  INSERT INTO public.audit_log(actor_id, actor_name, action, entity, entity_ref, detail)
  VALUES (
    auth.uid(),
    (SELECT full_name FROM public.profiles WHERE id = auth.uid()),
    _action,
    _entity,
    _ref,
    coalesce(_detail, '{}'::jsonb)
  );
END;
$$;

-- Return the effective permission set (including existing overrides) so the
-- sidebar/action UI and RLS evaluate the same access state.
CREATE OR REPLACE FUNCTION public.bootstrap_current_user(_full_name text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_role text;
  v_active boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
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

-- Serialize last-owner changes so two concurrent requests cannot both remove
-- the owner they each observed as non-last.
CREATE OR REPLACE FUNCTION public.protect_last_owner_role()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF old.role_key = 'owner'
     AND (tg_op = 'DELETE' OR (tg_op = 'UPDATE' AND new.role_key <> 'owner')) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('maqdooms:last-active-owner', 0));
    IF NOT EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.profiles p ON p.id = ur.user_id
      WHERE ur.role_key = 'owner' AND ur.id <> old.id AND p.active
    ) THEN
      RAISE EXCEPTION 'The last active Owner account cannot be removed or demoted';
    END IF;
  END IF;
  IF tg_op = 'DELETE' THEN RETURN old; END IF;
  RETURN new;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_last_owner_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF old.active AND NOT new.active
     AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = old.id AND role_key = 'owner') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('maqdooms:last-active-owner', 0));
    IF NOT EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.profiles p ON p.id = ur.user_id
      WHERE ur.role_key = 'owner' AND ur.user_id <> old.id AND p.active
    ) THEN
      RAISE EXCEPTION 'The last active Owner account cannot be deactivated';
    END IF;
  END IF;
  RETURN new;
END;
$$;

-- Staff may update their own non-security profile fields, but activation state
-- is exclusively managed by an active Owner through access.manage.
CREATE OR REPLACE FUNCTION public.protect_profile_activation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF old.active IS DISTINCT FROM new.active
     AND auth.uid() IS NOT NULL
     AND NOT public.has_perm(auth.uid(), 'access.manage') THEN
    RAISE EXCEPTION 'Permission denied: access.manage is required to change activation';
  END IF;
  RETURN new;
END;
$$;
DROP TRIGGER IF EXISTS trg_protect_profile_activation ON public.profiles;
CREATE TRIGGER trg_protect_profile_activation
BEFORE UPDATE OF active ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_profile_activation();

-- Replace broad active-user reads with role/permission-scoped reads. Shared
-- stock primitives remain available to the roles whose POS/inventory screens
-- derive availability from them; cost columns remain separately revoked.
DROP POLICY IF EXISTS "read fabrics" ON public.fabrics;
CREATE POLICY "read fabrics" ON public.fabrics FOR SELECT TO authenticated USING (
  public.has_any_role(auth.uid(), ARRAY['owner','stock_entry','counter','ecommerce_manager','tailor'])
);
DROP POLICY IF EXISTS "read thaans" ON public.thaans;
CREATE POLICY "read thaans" ON public.thaans FOR SELECT TO authenticated USING (
  public.has_any_perm(auth.uid(), ARRAY['inventory.receive','reports.view'])
  OR (
    status <> 'draft'
    AND public.has_any_perm(auth.uid(), ARRAY['pos.sell','pos.issue_to_tailoring','ecommerce.link_stock'])
  )
);
DROP POLICY IF EXISTS "read holds" ON public.holds;
CREATE POLICY "read holds" ON public.holds FOR SELECT TO authenticated USING (
  public.has_any_perm(auth.uid(), ARRAY['inventory.receive','pos.sell','pos.issue_to_tailoring','ecommerce.manage_listings','reports.view'])
);
DROP POLICY IF EXISTS "read stock_movements" ON public.stock_movements;
CREATE POLICY "read stock_movements" ON public.stock_movements FOR SELECT TO authenticated USING (
  public.has_any_perm(auth.uid(), ARRAY['inventory.receive','pos.sell','pos.issue_to_tailoring','ecommerce.link_stock','reports.view'])
);

DROP POLICY IF EXISTS "read listings" ON public.listings;
CREATE POLICY "read listings" ON public.listings FOR SELECT TO authenticated USING (
  public.has_any_perm(auth.uid(), ARRAY['ecommerce.manage_listings','reports.view'])
);
DROP POLICY IF EXISTS "read listing_variants" ON public.listing_variants;
CREATE POLICY "read listing_variants" ON public.listing_variants FOR SELECT TO authenticated USING (
  public.has_any_perm(auth.uid(), ARRAY['ecommerce.manage_listings','reports.view'])
);
DROP POLICY IF EXISTS "read listing_thaan_links" ON public.listing_thaan_links;
CREATE POLICY "read listing_thaan_links" ON public.listing_thaan_links FOR SELECT TO authenticated USING (
  public.has_any_perm(auth.uid(), ARRAY['ecommerce.link_stock','reports.view'])
);

DROP POLICY IF EXISTS "read profiles" ON public.profiles;
CREATE POLICY "read profiles" ON public.profiles FOR SELECT TO authenticated USING (
  id = auth.uid() OR public.has_perm(auth.uid(), 'access.manage')
);
DROP POLICY IF EXISTS "read roles" ON public.roles;
CREATE POLICY "read roles" ON public.roles FOR SELECT TO authenticated USING (
  public.has_perm(auth.uid(), 'access.manage')
);
DROP POLICY IF EXISTS "read permissions" ON public.permissions;
CREATE POLICY "read permissions" ON public.permissions FOR SELECT TO authenticated USING (
  public.has_perm(auth.uid(), 'access.manage')
);
DROP POLICY IF EXISTS "read role_permissions" ON public.role_permissions;
CREATE POLICY "read role_permissions" ON public.role_permissions FOR SELECT TO authenticated USING (
  public.has_perm(auth.uid(), 'access.manage')
);

DROP POLICY IF EXISTS "read materials" ON public.materials;
CREATE POLICY "read materials" ON public.materials FOR SELECT TO authenticated USING (
  public.has_any_perm(auth.uid(), ARRAY['tailoring.manage_jobs','pos.issue_to_tailoring','reports.view'])
);

DROP POLICY IF EXISTS "read customers" ON public.customers;
CREATE POLICY "read customers" ON public.customers FOR SELECT TO authenticated USING (
  public.has_any_perm(auth.uid(), ARRAY['pos.sell','reports.view'])
  OR (
    public.has_any_perm(auth.uid(), ARRAY['pos.issue_to_tailoring','tailoring.manage_jobs'])
    AND EXISTS (SELECT 1 FROM public.tailoring_jobs j WHERE j.customer_id = customers.id)
  )
);

-- Material laagat is protected at column level, matching thaan and tailoring
-- cost snapshots. Cost-authorized screens retrieve it through the gated RPC.
REVOKE SELECT ON public.materials FROM authenticated;
GRANT SELECT (id, name, unit, qty_on_hand, price_paise) ON public.materials TO authenticated;
CREATE OR REPLACE FUNCTION public.material_costs()
RETURNS TABLE(material_id uuid, cost_paise integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, cost_paise FROM public.materials
  WHERE public.has_any_perm(auth.uid(), ARRAY['tailoring.view_costs','inventory.view_cost']);
$$;
GRANT EXECUTE ON FUNCTION public.material_costs() TO authenticated;

DROP POLICY IF EXISTS "whatsapp preview" ON public.whatsapp_messages;
CREATE POLICY "whatsapp preview" ON public.whatsapp_messages FOR INSERT TO authenticated WITH CHECK (
  public.has_any_perm(auth.uid(), ARRAY['ecommerce.manage_listings','pos.sell'])
);

-- Security-definer reporting returns only the domains the caller may read.
CREATE OR REPLACE FUNCTION public.dashboard_metrics()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN NOT public.is_active_staff(auth.uid()) THEN '{}'::jsonb ELSE jsonb_build_object(
    'active_thaans', CASE WHEN public.has_any_perm(auth.uid(), ARRAY['inventory.receive','ecommerce.link_stock','reports.view'])
      THEN (SELECT count(*) FROM public.thaans WHERE status='active') END,
    'depleted_thaans', CASE WHEN public.has_any_perm(auth.uid(), ARRAY['inventory.receive','ecommerce.link_stock','reports.view'])
      THEN (SELECT count(*) FROM public.thaans WHERE status='depleted') END,
    'draft_thaans', CASE WHEN public.has_any_perm(auth.uid(), ARRAY['inventory.receive','reports.view'])
      THEN (SELECT count(*) FROM public.thaans WHERE status='draft') END,
    'incomplete_thaans', CASE WHEN public.has_any_perm(auth.uid(), ARRAY['inventory.receive','reports.view'])
      THEN (SELECT count(*) FROM public.thaans WHERE status IN ('draft','active') AND (original_mm IS NULL OR price_paise IS NULL)) END,
    'available_mm', CASE WHEN public.has_any_perm(auth.uid(), ARRAY['inventory.receive','ecommerce.link_stock','reports.view'])
      THEN (SELECT coalesce(sum(o.available_mm),0) FROM public.v_thaan_overview o WHERE o.status='active') END,
    'low_stock', CASE WHEN public.has_any_perm(auth.uid(), ARRAY['inventory.receive','ecommerce.link_stock','reports.view'])
      THEN (SELECT count(*) FROM public.v_thaan_overview WHERE status='active' AND available_mm < 3000) END,
    'sales_today_paise', CASE WHEN public.has_any_perm(auth.uid(), ARRAY['pos.sell','reports.view'])
      THEN (SELECT coalesce(sum(total_paise),0) FROM public.sales WHERE created_at >= date_trunc('day', now())) END,
    'sales_today_count', CASE WHEN public.has_any_perm(auth.uid(), ARRAY['pos.sell','reports.view'])
      THEN (SELECT count(*) FROM public.sales WHERE created_at >= date_trunc('day', now())) END,
    'sales_week_paise', CASE WHEN public.has_any_perm(auth.uid(), ARRAY['pos.sell','reports.view'])
      THEN (SELECT coalesce(sum(total_paise),0) FROM public.sales WHERE created_at >= now() - interval '7 days') END,
    'sales_month_paise', CASE WHEN public.has_any_perm(auth.uid(), ARRAY['pos.sell','reports.view'])
      THEN (SELECT coalesce(sum(total_paise),0) FROM public.sales WHERE created_at >= now() - interval '30 days') END,
    'open_jobs', CASE WHEN public.has_any_perm(auth.uid(), ARRAY['tailoring.manage_jobs','pos.issue_to_tailoring','reports.view'])
      THEN (SELECT count(*) FROM public.tailoring_jobs WHERE status IN ('open','in_progress')) END,
    'online_orders', CASE WHEN public.has_any_perm(auth.uid(), ARRAY['ecommerce.manage_listings','reports.view'])
      THEN (SELECT count(*) FROM public.online_orders WHERE status IN ('new','picking')) END,
    'active_listings', CASE WHEN public.has_any_perm(auth.uid(), ARRAY['ecommerce.manage_listings','reports.view'])
      THEN (SELECT count(*) FROM public.listings WHERE published) END,
    'active_holds', CASE WHEN public.has_any_perm(auth.uid(), ARRAY['ecommerce.manage_listings','reports.view'])
      THEN (SELECT count(*) FROM public.holds WHERE status='active' AND expires_at > now()) END
  ) END;
$$;

-- Online hold functions previously bypassed RLS without checking the caller.
CREATE OR REPLACE FUNCTION public.place_hold(
  p_thaan_id uuid,
  p_length_mm integer,
  p_minutes integer DEFAULT 30,
  p_reference text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_avail int; v_held int;
BEGIN
  IF NOT public.has_perm(auth.uid(), 'ecommerce.manage_listings') THEN
    RAISE EXCEPTION 'Permission denied: ecommerce.manage_listings';
  END IF;
  IF p_length_mm IS NULL OR p_length_mm <= 0 THEN RAISE EXCEPTION 'Hold length must be greater than zero'; END IF;
  SELECT coalesce(sum(delta_mm),0)::int INTO v_avail FROM public.stock_movements WHERE thaan_id=p_thaan_id;
  SELECT coalesce(sum(length_mm),0)::int INTO v_held FROM public.holds
    WHERE thaan_id=p_thaan_id AND status='active' AND expires_at>now();
  IF p_length_mm > v_avail - v_held THEN RAISE EXCEPTION 'Insufficient stock for hold'; END IF;
  INSERT INTO public.holds(thaan_id, length_mm, reference, expires_at)
  VALUES (p_thaan_id, p_length_mm, p_reference, now() + make_interval(mins => p_minutes)) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_hold(p_hold_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_perm(auth.uid(), 'ecommerce.manage_listings') THEN
    RAISE EXCEPTION 'Permission denied: ecommerce.manage_listings';
  END IF;
  UPDATE public.holds SET status='released' WHERE id=p_hold_id;
END;
$$;

-- Keep online-only listings structurally separate from physical inventory.
CREATE OR REPLACE FUNCTION public.require_linked_listing_for_thaan_link()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.listings WHERE id = new.listing_id AND stock_mode = 'linked'
  ) THEN
    RAISE EXCEPTION 'Only inventory-linked listings may link physical thaans';
  END IF;
  RETURN new;
END;
$$;
DROP TRIGGER IF EXISTS trg_require_linked_listing_for_thaan_link ON public.listing_thaan_links;
CREATE TRIGGER trg_require_linked_listing_for_thaan_link
BEFORE INSERT OR UPDATE ON public.listing_thaan_links
FOR EACH ROW EXECUTE FUNCTION public.require_linked_listing_for_thaan_link();

-- Private listing-image storage. The listing row stores paths, never image data.
INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES ('listing-images', 'listing-images', false, 10485760, ARRAY['image/jpeg','image/png','image/webp','image/gif'])
ON CONFLICT (id) DO UPDATE SET
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

DROP POLICY IF EXISTS "staff read listing images" ON storage.objects;
CREATE POLICY "staff read listing images" ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'listing-images'
  AND public.has_any_perm(auth.uid(), ARRAY['ecommerce.manage_listings','reports.view'])
);

-- Prevent anonymous/public execution of the security-definer entry points.
REVOKE ALL ON FUNCTION public.dashboard_metrics() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.place_hold(uuid,integer,integer,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.release_hold(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_metrics() TO authenticated;
GRANT EXECUTE ON FUNCTION public.place_hold(uuid,integer,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_hold(uuid) TO authenticated;

