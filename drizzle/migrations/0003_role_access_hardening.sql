-- 1. Active-staff helper; inactive users lose every permission immediately
CREATE OR REPLACE FUNCTION public.is_active_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select coalesce((select active from public.profiles where id = _user_id), false);
$$;

CREATE OR REPLACE FUNCTION public.has_perm(_user_id uuid, _perm text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select public.is_active_staff(_user_id) and coalesce(
    (select granted from public.user_permission_overrides o where o.user_id=_user_id and o.permission_key=_perm),
    exists (select 1 from public.user_roles ur join public.role_permissions rp on rp.role_key = ur.role_key
            where ur.user_id=_user_id and rp.permission_key=_perm));
$$;

CREATE OR REPLACE FUNCTION public.has_any_perm(_user_id uuid, _perms text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select exists (select 1 from unnest(_perms) p where public.has_perm(_user_id, p));
$$;

-- bootstrap now reports active flag (never reactivates)
CREATE OR REPLACE FUNCTION public.bootstrap_current_user(_full_name text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare v_uid uuid := auth.uid(); v_email text; v_role text; v_active boolean;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select email into v_email from auth.users where id = v_uid;
  insert into public.profiles(id, full_name, email, last_login)
  values (v_uid, coalesce(_full_name, split_part(coalesce(v_email,'staff'),'@',1)), v_email, now())
  on conflict (id) do update set last_login = now(), email = excluded.email;
  if not exists (select 1 from public.user_roles where user_id = v_uid) then
    if exists (select 1 from public.user_roles where role_key='owner') then v_role := 'counter'; else v_role := 'owner'; end if;
    insert into public.user_roles(user_id, role_key) values (v_uid, v_role) on conflict do nothing;
  end if;
  select active into v_active from public.profiles where id = v_uid;
  return jsonb_build_object('user_id', v_uid, 'active', v_active,
    'roles', (select coalesce(jsonb_agg(role_key),'[]'::jsonb) from public.user_roles where user_id=v_uid),
    'permissions', case when v_active then (select coalesce(jsonb_agg(distinct rp.permission_key),'[]'::jsonb)
                    from public.user_roles ur join public.role_permissions rp on rp.role_key=ur.role_key where ur.user_id=v_uid) else '[]'::jsonb end);
end; $$;

-- 2. Tailor needs to issue fabric to jobs from the counter screen
INSERT INTO public.role_permissions(role_key, permission_key) VALUES ('tailor','pos.issue_to_tailoring') ON CONFLICT DO NOTHING;

-- 3. Last-owner protection at database level
CREATE OR REPLACE FUNCTION public.protect_last_owner_role()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
begin
  if old.role_key = 'owner' and (tg_op = 'DELETE' or new.role_key <> 'owner') then
    if not exists (select 1 from public.user_roles ur join public.profiles p on p.id = ur.user_id
                   where ur.role_key='owner' and ur.id <> old.id and p.active) then
      raise exception 'The last active Owner account cannot be removed or demoted';
    end if;
  end if;
  return coalesce(new, old);
end; $$;
DROP TRIGGER IF EXISTS trg_protect_last_owner_role ON public.user_roles;
CREATE TRIGGER trg_protect_last_owner_role BEFORE DELETE OR UPDATE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.protect_last_owner_role();

CREATE OR REPLACE FUNCTION public.protect_last_owner_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
begin
  if old.active and not new.active and exists (select 1 from public.user_roles where user_id=old.id and role_key='owner') then
    if not exists (select 1 from public.user_roles ur join public.profiles p on p.id = ur.user_id
                   where ur.role_key='owner' and ur.user_id <> old.id and p.active) then
      raise exception 'The last active Owner account cannot be deactivated';
    end if;
  end if;
  return new;
end; $$;
DROP TRIGGER IF EXISTS trg_protect_last_owner_profile ON public.profiles;
CREATE TRIGGER trg_protect_last_owner_profile BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_last_owner_profile();

-- 4. Suppliers can be created by stock receivers
GRANT SELECT, INSERT ON public.suppliers TO authenticated;
CREATE POLICY "create suppliers" ON public.suppliers FOR INSERT TO authenticated
  WITH CHECK (public.has_perm(auth.uid(), 'inventory.receive'));

-- 5. Tighten read access
DO $$ declare r record; begin
  for r in select * from (values
    ('customers','read customers'),('fabrics','read fabrics'),('holds','read holds'),
    ('listing_thaan_links','read listing_thaan_links'),('listing_variants','read listing_variants'),
    ('listings','read listings'),('materials','read materials'),('online_orders','read online_orders'),
    ('permissions','read permissions'),('profiles','read profiles'),('receiving_batches','read receiving_batches'),
    ('role_permissions','read role_permissions'),('roles','read roles'),('sale_items','read sale_items'),
    ('sales','read sales'),('stock_movements','read stock_movements'),('suppliers','read suppliers'),
    ('tailoring_job_lines','read tailoring_job_lines'),('tailoring_jobs','read tailoring_jobs'),
    ('thaans','read thaans'),('user_permission_overrides','read user_permission_overrides'),
    ('user_roles','read user_roles'),('whatsapp_messages','read whatsapp_messages'),
    ('whatsapp_templates','read whatsapp_templates')) as t(tbl, pol)
  loop execute format('DROP POLICY IF EXISTS %I ON public.%I', r.pol, r.tbl); end loop;
end $$;

-- general operational data: any active staff member
CREATE POLICY "read fabrics" ON public.fabrics FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid()));
CREATE POLICY "read thaans" ON public.thaans FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid()));
CREATE POLICY "read holds" ON public.holds FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid()));
CREATE POLICY "read stock_movements" ON public.stock_movements FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid()));
CREATE POLICY "read listings" ON public.listings FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid()));
CREATE POLICY "read listing_variants" ON public.listing_variants FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid()));
CREATE POLICY "read listing_thaan_links" ON public.listing_thaan_links FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid()));
CREATE POLICY "read profiles" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid() OR public.is_active_staff(auth.uid()));
CREATE POLICY "read roles" ON public.roles FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid()));
CREATE POLICY "read permissions" ON public.permissions FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid()));
CREATE POLICY "read role_permissions" ON public.role_permissions FOR SELECT TO authenticated USING (public.is_active_staff(auth.uid()));
CREATE POLICY "read user_roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_perm(auth.uid(),'access.manage'));
CREATE POLICY "read user_permission_overrides" ON public.user_permission_overrides FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_perm(auth.uid(),'access.manage'));
-- scoped business data
CREATE POLICY "read suppliers" ON public.suppliers FOR SELECT TO authenticated USING (public.has_any_perm(auth.uid(), array['inventory.receive','reports.view']));
CREATE POLICY "read receiving_batches" ON public.receiving_batches FOR SELECT TO authenticated USING (public.has_any_perm(auth.uid(), array['inventory.receive','reports.view']));
CREATE POLICY "read sales" ON public.sales FOR SELECT TO authenticated USING (public.has_any_perm(auth.uid(), array['pos.sell','reports.view']));
CREATE POLICY "read sale_items" ON public.sale_items FOR SELECT TO authenticated USING (public.has_any_perm(auth.uid(), array['pos.sell','reports.view']));
CREATE POLICY "read customers" ON public.customers FOR SELECT TO authenticated USING (public.has_any_perm(auth.uid(), array['pos.sell','pos.issue_to_tailoring','tailoring.manage_jobs','reports.view']));
CREATE POLICY "read tailoring_jobs" ON public.tailoring_jobs FOR SELECT TO authenticated USING (public.has_any_perm(auth.uid(), array['tailoring.manage_jobs','pos.issue_to_tailoring','reports.view']));
CREATE POLICY "read tailoring_job_lines" ON public.tailoring_job_lines FOR SELECT TO authenticated USING (public.has_any_perm(auth.uid(), array['tailoring.manage_jobs','pos.issue_to_tailoring','reports.view']));
CREATE POLICY "read materials" ON public.materials FOR SELECT TO authenticated USING (public.has_any_perm(auth.uid(), array['tailoring.manage_jobs','pos.issue_to_tailoring','inventory.receive','reports.view']));
CREATE POLICY "read online_orders" ON public.online_orders FOR SELECT TO authenticated USING (public.has_any_perm(auth.uid(), array['ecommerce.manage_listings','pos.sell','reports.view']));
CREATE POLICY "read whatsapp_messages" ON public.whatsapp_messages FOR SELECT TO authenticated USING (public.has_any_perm(auth.uid(), array['ecommerce.manage_listings','pos.sell','reports.view']));
CREATE POLICY "read whatsapp_templates" ON public.whatsapp_templates FOR SELECT TO authenticated USING (public.has_any_perm(auth.uid(), array['ecommerce.manage_listings','pos.sell','reports.view']));

-- 6. Cost snapshots hidden at column level; exposed only through a permission-gated function
REVOKE SELECT ON public.stock_movements FROM authenticated;
GRANT SELECT (id, thaan_id, kind, delta_mm, purpose, reference, sale_id, job_id, price_snapshot_paise, reason, user_id, created_at) ON public.stock_movements TO authenticated;
REVOKE SELECT ON public.tailoring_job_lines FROM authenticated;
GRANT SELECT (id, job_id, thaan_id, material_id, category, length_mm, qty, price_snapshot_paise, created_at) ON public.tailoring_job_lines TO authenticated;

CREATE OR REPLACE FUNCTION public.tailoring_line_costs()
RETURNS TABLE(line_id uuid, cost_snapshot_paise integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select id, cost_snapshot_paise from public.tailoring_job_lines
  where public.has_any_perm(auth.uid(), array['tailoring.view_costs','inventory.view_cost']);
$$;
GRANT EXECUTE ON FUNCTION public.tailoring_line_costs() TO authenticated;

CREATE OR REPLACE FUNCTION public.tailoring_job_totals()
RETURNS TABLE(job_id uuid, fabric_cost_paise bigint, selling_value_paise bigint, lines bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select job_id,
         case when public.has_any_perm(auth.uid(), array['tailoring.view_costs','inventory.view_cost'])
           then coalesce(sum(coalesce(cost_snapshot_paise,0) * coalesce(length_mm, (coalesce(qty,0)*1000)::int)/1000),0)::bigint end,
         coalesce(sum(coalesce(price_snapshot_paise,0) * coalesce(length_mm, (coalesce(qty,0)*1000)::int)/1000),0)::bigint,
         count(*)::bigint
  from public.tailoring_job_lines
  where public.has_any_perm(auth.uid(), array['tailoring.manage_jobs','pos.issue_to_tailoring','reports.view'])
  group by job_id;
$$;

-- 7. Listing images: max 6, stored privately
ALTER TABLE public.listings ADD CONSTRAINT listings_max_six_images CHECK (coalesce(array_length(images,1),0) <= 6);

CREATE POLICY "staff read listing images" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'listing-images' AND public.is_active_staff(auth.uid()));
CREATE POLICY "ecommerce upload listing images" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'listing-images' AND public.has_perm(auth.uid(),'ecommerce.manage_listings'));
CREATE POLICY "ecommerce update listing images" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'listing-images' AND public.has_perm(auth.uid(),'ecommerce.manage_listings'));
CREATE POLICY "ecommerce delete listing images" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'listing-images' AND public.has_perm(auth.uid(),'ecommerce.manage_listings'));
