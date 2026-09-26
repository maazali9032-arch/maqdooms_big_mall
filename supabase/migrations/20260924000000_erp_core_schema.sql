
-- ============ ACCESS CONTROL ============
create table public.profiles (
  id uuid primary key,
  full_name text not null default 'Staff',
  email text,
  active boolean not null default true,
  last_login timestamptz,
  created_at timestamptz not null default now()
);

create table public.roles (
  key text primary key,
  label text not null,
  description text
);

create table public.permissions (
  key text primary key,
  label text not null,
  domain text not null
);

create table public.role_permissions (
  role_key text not null references public.roles(key) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  primary key (role_key, permission_key)
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role_key text not null references public.roles(key) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, role_key)
);

create table public.user_permission_overrides (
  user_id uuid not null,
  permission_key text not null references public.permissions(key) on delete cascade,
  granted boolean not null,
  primary key (user_id, permission_key)
);

insert into public.roles(key,label,description) values
 ('owner','Owner','Full access to every module, costs, reports and audit'),
 ('stock_entry','Stock Entry','Receives stock, scans thaans, edits receiving records'),
 ('counter','Counter / Salesperson','Sells and cuts fabric, issues to tailoring'),
 ('tailor','Tailor','Views assigned jobs and consumed materials'),
 ('ecommerce_manager','E-commerce Manager','Manages listings, inventory links and online orders');

insert into public.permissions(key,label,domain) values
 ('inventory.receive','Receive stock','inventory'),
 ('inventory.edit_thaan','Edit thaan','inventory'),
 ('inventory.view_cost','View laagat / cost','inventory'),
 ('pos.sell','Sell at counter','pos'),
 ('pos.override_price_or_discount','Override price / discount','pos'),
 ('pos.issue_to_tailoring','Issue fabric to tailoring','pos'),
 ('stock.adjust','Adjust stock','stock'),
 ('stock.return_from_tailor','Return stock from tailor','stock'),
 ('tailoring.manage_jobs','Manage tailoring jobs','tailoring'),
 ('tailoring.view_costs','View tailoring costs','tailoring'),
 ('ecommerce.manage_listings','Manage listings','ecommerce'),
 ('ecommerce.link_stock','Link stock to listings','ecommerce'),
 ('reports.view','View reports','reports'),
 ('audit.view','View audit trail','audit'),
 ('access.manage','Manage access','access');

insert into public.role_permissions(role_key, permission_key)
 select 'owner', key from public.permissions;
insert into public.role_permissions(role_key, permission_key) values
 ('stock_entry','inventory.receive'),('stock_entry','inventory.edit_thaan'),('stock_entry','inventory.view_cost'),
 ('counter','pos.sell'),('counter','pos.issue_to_tailoring'),
 ('tailor','tailoring.manage_jobs'),
 ('ecommerce_manager','ecommerce.manage_listings'),('ecommerce_manager','ecommerce.link_stock');

create or replace function public.has_perm(_user_id uuid, _perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select granted from public.user_permission_overrides o where o.user_id=_user_id and o.permission_key=_perm),
    exists (
      select 1 from public.user_roles ur
      join public.role_permissions rp on rp.role_key = ur.role_key
      where ur.user_id=_user_id and rp.permission_key=_perm
    )
  );
$$;

create or replace function public.has_role(_user_id uuid, _role text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.user_roles where user_id=_user_id and role_key=_role);
$$;

-- ============ CATALOGUE & STOCK ============
create table public.fabrics (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  category text not null default 'Suiting',
  colour text,
  design text,
  width_mm integer,
  default_price_paise integer,
  created_at timestamptz not null default now()
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  city text
);

create table public.receiving_batches (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  supplier_id uuid references public.suppliers(id),
  bill_no text,
  received_on date not null default current_date,
  notes text,
  status text not null default 'draft' check (status in ('draft','committed')),
  created_by uuid,
  committed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.thaans (
  id uuid primary key default gen_random_uuid(),
  barcode text unique not null,
  fabric_id uuid references public.fabrics(id),
  batch_id uuid references public.receiving_batches(id),
  original_mm integer,
  width_mm integer,
  price_paise integer,
  rack text,
  status text not null default 'draft' check (status in ('draft','active','depleted','archived')),
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index thaans_status_idx on public.thaans(status);
create index thaans_batch_idx on public.thaans(batch_id);
create index thaans_fabric_idx on public.thaans(fabric_id);

create table public.thaan_costs (
  thaan_id uuid primary key references public.thaans(id) on delete cascade,
  cost_paise integer not null,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text unique,
  notes text,
  created_at timestamptz not null default now()
);

create table public.tailoring_jobs (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  garment text not null,
  tailor_id uuid,
  tailor_name text,
  customer_id uuid references public.customers(id),
  status text not null default 'open' check (status in ('open','in_progress','ready','delivered','cancelled')),
  notes text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table public.materials (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit text not null default 'pc',
  qty_on_hand numeric not null default 0,
  cost_paise integer,
  price_paise integer
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  bill_no text unique not null,
  customer_id uuid references public.customers(id),
  user_id uuid,
  total_paise integer not null default 0,
  payment_mode text not null default 'cash',
  created_at timestamptz not null default now()
);
create index sales_created_idx on public.sales(created_at);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  thaan_id uuid references public.thaans(id),
  length_mm integer not null,
  price_paise_per_m integer not null,
  amount_paise integer not null
);

create table public.tailoring_job_lines (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.tailoring_jobs(id) on delete cascade,
  thaan_id uuid references public.thaans(id),
  material_id uuid references public.materials(id),
  category text not null default 'outer fabric',
  length_mm integer,
  qty numeric,
  cost_snapshot_paise integer,
  price_snapshot_paise integer,
  created_at timestamptz not null default now()
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  thaan_id uuid not null references public.thaans(id),
  kind text not null check (kind in ('INWARD','SALE','TAILORING','RETURN','WASTAGE','ADJUSTMENT')),
  delta_mm integer not null,
  purpose text,
  reference text,
  sale_id uuid references public.sales(id),
  job_id uuid references public.tailoring_jobs(id),
  cost_snapshot_paise integer,
  price_snapshot_paise integer,
  reason text,
  user_id uuid,
  created_at timestamptz not null default now()
);
create index movements_thaan_idx on public.stock_movements(thaan_id);
create index movements_created_idx on public.stock_movements(created_at desc);
create index movements_user_idx on public.stock_movements(user_id);

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text unique not null,
  description text,
  category text,
  collection text,
  tags text[] not null default '{}',
  seo_title text,
  seo_description text,
  images text[] not null default '{}',
  price_paise integer,
  sale_price_paise integer,
  stock_mode text not null default 'linked' check (stock_mode in ('linked','manual','untracked')),
  published boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.listing_thaan_links (
  listing_id uuid not null references public.listings(id) on delete cascade,
  thaan_id uuid not null references public.thaans(id) on delete cascade,
  primary key (listing_id, thaan_id)
);

create table public.listing_variants (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  label text not null,
  qty integer not null default 0
);

create table public.holds (
  id uuid primary key default gen_random_uuid(),
  thaan_id uuid not null references public.thaans(id),
  length_mm integer not null,
  reference text,
  status text not null default 'active' check (status in ('active','released','consumed','expired')),
  expires_at timestamptz not null default now() + interval '30 minutes',
  created_at timestamptz not null default now()
);
create index holds_thaan_idx on public.holds(thaan_id);

create table public.online_orders (
  id uuid primary key default gen_random_uuid(),
  order_no text unique not null,
  customer_name text not null,
  phone text,
  listing_id uuid references public.listings(id),
  length_mm integer,
  qty integer,
  amount_paise integer,
  status text not null default 'new' check (status in ('new','picking','picked','fulfilled','cancelled')),
  created_at timestamptz not null default now()
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  actor_name text,
  action text not null,
  entity text not null,
  entity_ref text,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_created_idx on public.audit_log(created_at desc);

create table public.whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  name text not null,
  body text not null,
  trigger_event text
);

create table public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  template_key text,
  to_phone text not null,
  rendered_body text not null,
  status text not null default 'preview' check (status in ('preview','queued','sent','failed')),
  created_at timestamptz not null default now()
);

-- ============ DERIVED STOCK ============
create or replace function public.thaan_available_mm(p_thaan uuid)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce((select sum(delta_mm) from public.stock_movements where thaan_id = p_thaan),0)::int;
$$;

create view public.v_thaan_stock as
select t.id as thaan_id,
       coalesce(m.available_mm,0)::int as available_mm,
       coalesce(h.held_mm,0)::int as held_mm
from public.thaans t
left join (select thaan_id, sum(delta_mm)::int as available_mm from public.stock_movements group by thaan_id) m on m.thaan_id = t.id
left join (select thaan_id, sum(length_mm)::int as held_mm from public.holds where status='active' and expires_at > now() group by thaan_id) h on h.thaan_id = t.id;

-- ============ BUSINESS FUNCTIONS ============
create or replace function public.log_audit(_action text, _entity text, _ref text, _detail jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log(actor_id, actor_name, action, entity, entity_ref, detail)
  values (auth.uid(), (select full_name from public.profiles where id = auth.uid()), _action, _entity, _ref, coalesce(_detail,'{}'::jsonb));
end;
$$;

create or replace function public.cut_thaan(
  p_barcode text,
  p_length_mm integer,
  p_purpose text default 'sale',
  p_customer_id uuid default null,
  p_job_id uuid default null,
  p_category text default 'outer fabric',
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_thaan public.thaans%rowtype;
  v_avail int; v_held int; v_cost int; v_sale_id uuid; v_bill text; v_amount int;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_purpose = 'tailoring' then
    if not public.has_perm(auth.uid(),'pos.issue_to_tailoring') then raise exception 'Permission denied: pos.issue_to_tailoring'; end if;
  else
    if not public.has_perm(auth.uid(),'pos.sell') then raise exception 'Permission denied: pos.sell'; end if;
  end if;
  if p_length_mm is null or p_length_mm <= 0 then raise exception 'Cut length must be greater than zero'; end if;

  select * into v_thaan from public.thaans where barcode = p_barcode for update;
  if not found then raise exception 'Unknown barcode %', p_barcode; end if;
  if v_thaan.status <> 'active' then raise exception 'Thaan % is not active (status: %)', p_barcode, v_thaan.status; end if;
  if v_thaan.price_paise is null or v_thaan.original_mm is null then raise exception 'Thaan % is incomplete and cannot be sold', p_barcode; end if;

  select coalesce(sum(delta_mm),0)::int into v_avail from public.stock_movements where thaan_id = v_thaan.id;
  select coalesce(sum(length_mm),0)::int into v_held from public.holds where thaan_id = v_thaan.id and status='active' and expires_at > now();

  if p_length_mm > (v_avail - v_held) then
    raise exception 'Insufficient stock: % has % m available (% m held)', p_barcode, round((v_avail)/1000.0,2), round(v_held/1000.0,2);
  end if;

  select cost_paise into v_cost from public.thaan_costs where thaan_id = v_thaan.id;
  v_amount := round(p_length_mm::numeric / 1000 * v_thaan.price_paise)::int;

  if p_purpose = 'tailoring' then
    if p_job_id is null then raise exception 'A tailoring job is required'; end if;
    insert into public.tailoring_job_lines(job_id, thaan_id, category, length_mm, cost_snapshot_paise, price_snapshot_paise)
    values (p_job_id, v_thaan.id, p_category, p_length_mm, v_cost, v_thaan.price_paise);
    insert into public.stock_movements(thaan_id, kind, delta_mm, purpose, reference, job_id, cost_snapshot_paise, price_snapshot_paise, reason, user_id)
    values (v_thaan.id,'TAILORING', -p_length_mm, 'tailoring', (select code from public.tailoring_jobs where id=p_job_id), p_job_id, v_cost, v_thaan.price_paise, p_reason, auth.uid());
  else
    v_bill := 'INV-' || to_char(now(),'YYMMDD') || '-' || lpad((floor(random()*9999)+1)::text,4,'0');
    insert into public.sales(bill_no, customer_id, user_id, total_paise) values (v_bill, p_customer_id, auth.uid(), v_amount) returning id into v_sale_id;
    insert into public.sale_items(sale_id, thaan_id, length_mm, price_paise_per_m, amount_paise)
    values (v_sale_id, v_thaan.id, p_length_mm, v_thaan.price_paise, v_amount);
    insert into public.stock_movements(thaan_id, kind, delta_mm, purpose, reference, sale_id, cost_snapshot_paise, price_snapshot_paise, reason, user_id)
    values (v_thaan.id,'SALE', -p_length_mm, 'sale', v_bill, v_sale_id, v_cost, v_thaan.price_paise, p_reason, auth.uid());
  end if;

  if (v_avail - p_length_mm) <= 0 then
    update public.thaans set status='depleted', updated_at=now() where id = v_thaan.id;
  end if;

  perform public.log_audit('cut_thaan','thaan', v_thaan.barcode,
    jsonb_build_object('length_mm',p_length_mm,'purpose',p_purpose,'amount_paise',v_amount));

  return jsonb_build_object(
    'thaan_id', v_thaan.id, 'barcode', v_thaan.barcode, 'length_mm', p_length_mm,
    'remaining_mm', v_avail - p_length_mm, 'amount_paise', case when p_purpose='tailoring' then 0 else v_amount end,
    'bill_no', v_bill, 'sale_id', v_sale_id);
end;
$$;

create or replace function public.commit_receiving_batch(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_count int; v_incomplete int; v_code text;
begin
  if not public.has_perm(auth.uid(),'inventory.receive') then raise exception 'Permission denied: inventory.receive'; end if;
  select code into v_code from public.receiving_batches where id = p_batch_id and status='draft';
  if v_code is null then raise exception 'Batch not found or already committed'; end if;
  select count(*) filter (where original_mm is null or price_paise is null) into v_incomplete from public.thaans where batch_id = p_batch_id;

  insert into public.stock_movements(thaan_id, kind, delta_mm, purpose, reference, cost_snapshot_paise, price_snapshot_paise, user_id)
  select t.id,'INWARD', t.original_mm, 'receiving', v_code, c.cost_paise, t.price_paise, auth.uid()
  from public.thaans t left join public.thaan_costs c on c.thaan_id = t.id
  where t.batch_id = p_batch_id and t.status='draft' and t.original_mm is not null and t.price_paise is not null;
  get diagnostics v_count = row_count;

  update public.thaans set status='active', updated_at=now()
   where batch_id = p_batch_id and status='draft' and original_mm is not null and price_paise is not null;
  update public.receiving_batches set status='committed', committed_at=now() where id = p_batch_id;

  perform public.log_audit('commit_receiving_batch','receiving_batch', v_code,
    jsonb_build_object('activated', v_count, 'incomplete', v_incomplete));
  return jsonb_build_object('activated', v_count, 'incomplete', v_incomplete, 'code', v_code);
end;
$$;

create or replace function public.adjust_thaan(p_thaan_id uuid, p_delta_mm integer, p_kind text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_barcode text; v_avail int;
begin
  if not public.has_perm(auth.uid(),'stock.adjust') then raise exception 'Permission denied: stock.adjust'; end if;
  if p_kind not in ('ADJUSTMENT','RETURN','WASTAGE') then raise exception 'Invalid movement kind'; end if;
  select barcode into v_barcode from public.thaans where id = p_thaan_id for update;
  if v_barcode is null then raise exception 'Thaan not found'; end if;
  select coalesce(sum(delta_mm),0)::int into v_avail from public.stock_movements where thaan_id = p_thaan_id;
  if v_avail + p_delta_mm < 0 then raise exception 'Adjustment would make stock negative'; end if;
  insert into public.stock_movements(thaan_id, kind, delta_mm, purpose, reason, user_id)
  values (p_thaan_id, p_kind, p_delta_mm, lower(p_kind), p_reason, auth.uid());
  update public.thaans set status = case when v_avail + p_delta_mm <= 0 then 'depleted' else 'active' end, updated_at=now()
   where id = p_thaan_id and status in ('active','depleted');
  perform public.log_audit('adjust_stock','thaan', v_barcode, jsonb_build_object('delta_mm',p_delta_mm,'kind',p_kind,'reason',p_reason));
end;
$$;

create or replace function public.place_hold(p_thaan_id uuid, p_length_mm integer, p_minutes integer default 30, p_reference text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_avail int; v_held int;
begin
  select coalesce(sum(delta_mm),0)::int into v_avail from public.stock_movements where thaan_id=p_thaan_id;
  select coalesce(sum(length_mm),0)::int into v_held from public.holds where thaan_id=p_thaan_id and status='active' and expires_at>now();
  if p_length_mm > v_avail - v_held then raise exception 'Insufficient stock for hold'; end if;
  insert into public.holds(thaan_id, length_mm, reference, expires_at)
  values (p_thaan_id, p_length_mm, p_reference, now() + make_interval(mins => p_minutes)) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.release_hold(p_hold_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin update public.holds set status='released' where id=p_hold_id; end;
$$;

-- bootstrap profile + role on first login
create or replace function public.bootstrap_current_user(_full_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_email text; v_role text;
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
  return jsonb_build_object('user_id', v_uid,
    'roles', (select coalesce(jsonb_agg(role_key),'[]'::jsonb) from public.user_roles where user_id=v_uid),
    'permissions', (select coalesce(jsonb_agg(distinct rp.permission_key),'[]'::jsonb)
                    from public.user_roles ur join public.role_permissions rp on rp.role_key=ur.role_key where ur.user_id=v_uid));
end;
$$;

-- ============ GRANTS + RLS ============
grant select on public.v_thaan_stock to authenticated;
grant execute on function public.cut_thaan(text,integer,text,uuid,uuid,text,text) to authenticated;
grant execute on function public.commit_receiving_batch(uuid) to authenticated;
grant execute on function public.adjust_thaan(uuid,integer,text,text) to authenticated;
grant execute on function public.place_hold(uuid,integer,integer,text) to authenticated;
grant execute on function public.release_hold(uuid) to authenticated;
grant execute on function public.bootstrap_current_user(text) to authenticated;
grant execute on function public.has_perm(uuid,text) to authenticated;
grant execute on function public.has_role(uuid,text) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['profiles','roles','permissions','role_permissions','user_roles','user_permission_overrides',
    'fabrics','suppliers','receiving_batches','thaans','thaan_costs','customers','tailoring_jobs','materials','sales',
    'sale_items','tailoring_job_lines','stock_movements','listings','listing_thaan_links','listing_variants','holds',
    'online_orders','audit_log','whatsapp_templates','whatsapp_messages']
  loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "read %1$s" on public.%1$I for select to authenticated using (true)', t);
  end loop;
end $$;

-- cost table is restricted
drop policy "read thaan_costs" on public.thaan_costs;
create policy "read costs with permission" on public.thaan_costs for select to authenticated
  using (public.has_perm(auth.uid(),'inventory.view_cost'));
create policy "write costs with permission" on public.thaan_costs for all to authenticated
  using (public.has_perm(auth.uid(),'inventory.receive')) with check (public.has_perm(auth.uid(),'inventory.receive'));

drop policy "read audit_log" on public.audit_log;
create policy "read audit with permission" on public.audit_log for select to authenticated
  using (public.has_perm(auth.uid(),'audit.view'));

-- write policies
create policy "receive thaans" on public.thaans for insert to authenticated with check (public.has_perm(auth.uid(),'inventory.receive'));
create policy "edit thaans" on public.thaans for update to authenticated using (public.has_perm(auth.uid(),'inventory.edit_thaan'));
create policy "receive batches" on public.receiving_batches for all to authenticated
  using (public.has_perm(auth.uid(),'inventory.receive')) with check (public.has_perm(auth.uid(),'inventory.receive'));
create policy "manage fabrics" on public.fabrics for all to authenticated
  using (public.has_perm(auth.uid(),'inventory.receive')) with check (public.has_perm(auth.uid(),'inventory.receive'));
create policy "manage customers" on public.customers for all to authenticated
  using (public.has_perm(auth.uid(),'pos.sell')) with check (public.has_perm(auth.uid(),'pos.sell'));
create policy "manage jobs" on public.tailoring_jobs for all to authenticated
  using (public.has_perm(auth.uid(),'tailoring.manage_jobs') or public.has_perm(auth.uid(),'pos.issue_to_tailoring'))
  with check (public.has_perm(auth.uid(),'tailoring.manage_jobs') or public.has_perm(auth.uid(),'pos.issue_to_tailoring'));
create policy "manage listings" on public.listings for all to authenticated
  using (public.has_perm(auth.uid(),'ecommerce.manage_listings')) with check (public.has_perm(auth.uid(),'ecommerce.manage_listings'));
create policy "manage listing links" on public.listing_thaan_links for all to authenticated
  using (public.has_perm(auth.uid(),'ecommerce.link_stock')) with check (public.has_perm(auth.uid(),'ecommerce.link_stock'));
create policy "manage variants" on public.listing_variants for all to authenticated
  using (public.has_perm(auth.uid(),'ecommerce.manage_listings')) with check (public.has_perm(auth.uid(),'ecommerce.manage_listings'));
create policy "manage orders" on public.online_orders for all to authenticated
  using (public.has_perm(auth.uid(),'ecommerce.manage_listings') or public.has_perm(auth.uid(),'pos.sell'))
  with check (public.has_perm(auth.uid(),'ecommerce.manage_listings') or public.has_perm(auth.uid(),'pos.sell'));
create policy "manage access roles" on public.user_roles for all to authenticated
  using (public.has_perm(auth.uid(),'access.manage')) with check (public.has_perm(auth.uid(),'access.manage'));
create policy "manage overrides" on public.user_permission_overrides for all to authenticated
  using (public.has_perm(auth.uid(),'access.manage')) with check (public.has_perm(auth.uid(),'access.manage'));
create policy "update own profile" on public.profiles for update to authenticated
  using (id = auth.uid() or public.has_perm(auth.uid(),'access.manage'))
  with check (id = auth.uid() or public.has_perm(auth.uid(),'access.manage'));
create policy "whatsapp preview" on public.whatsapp_messages for insert to authenticated with check (true);
