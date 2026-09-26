
create view public.v_thaan_overview
with (security_invoker = true)
as
select t.id,
       t.barcode,
       t.status,
       t.original_mm,
       t.width_mm,
       t.price_paise,
       t.rack,
       t.created_at,
       t.updated_at,
       t.batch_id,
       b.code as batch_code,
       s.name as supplier_name,
       f.id as fabric_id,
       f.name as fabric_name,
       f.code as fabric_code,
       f.category,
       f.colour,
       f.design,
       coalesce(m.available_mm, 0)::int as available_mm,
       coalesce(h.held_mm, 0)::int as held_mm,
       (t.original_mm is null or t.price_paise is null) as is_incomplete,
       m.last_movement_at
from public.thaans t
left join public.fabrics f on f.id = t.fabric_id
left join public.receiving_batches b on b.id = t.batch_id
left join public.suppliers s on s.id = b.supplier_id
left join (
  select thaan_id, sum(delta_mm)::int as available_mm, max(created_at) as last_movement_at
  from public.stock_movements group by thaan_id
) m on m.thaan_id = t.id
left join (
  select thaan_id, sum(length_mm)::int as held_mm
  from public.holds where status = 'active' and expires_at > now() group by thaan_id
) h on h.thaan_id = t.id;

grant select on public.v_thaan_overview to authenticated;

create view public.v_movement_log
with (security_invoker = true)
as
select m.id,
       m.created_at,
       m.kind,
       m.delta_mm,
       m.purpose,
       m.reference,
       m.reason,
       m.price_snapshot_paise,
       m.user_id,
       p.full_name as user_name,
       t.barcode,
       f.name as fabric_name
from public.stock_movements m
join public.thaans t on t.id = m.thaan_id
left join public.fabrics f on f.id = t.fabric_id
left join public.profiles p on p.id = m.user_id;

grant select on public.v_movement_log to authenticated;

create view public.v_listing_availability
with (security_invoker = true)
as
select l.id as listing_id,
       count(lk.thaan_id)::int as linked_thaans,
       coalesce(max(o.available_mm - o.held_mm), 0)::int as largest_piece_mm,
       coalesce(sum(o.available_mm), 0)::int as total_linked_mm
from public.listings l
left join public.listing_thaan_links lk on lk.listing_id = l.id
left join public.v_thaan_overview o on o.id = lk.thaan_id and o.status = 'active'
group by l.id;

grant select on public.v_listing_availability to authenticated;

create or replace function public.dashboard_metrics()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'active_thaans', (select count(*) from public.thaans where status='active'),
    'depleted_thaans', (select count(*) from public.thaans where status='depleted'),
    'draft_thaans', (select count(*) from public.thaans where status='draft'),
    'incomplete_thaans', (select count(*) from public.thaans where status in ('draft','active') and (original_mm is null or price_paise is null)),
    'available_mm', (select coalesce(sum(o.available_mm),0) from public.v_thaan_overview o where o.status='active'),
    'low_stock', (select count(*) from public.v_thaan_overview where status='active' and available_mm < 3000),
    'sales_today_paise', (select coalesce(sum(total_paise),0) from public.sales where created_at >= date_trunc('day', now())),
    'sales_today_count', (select count(*) from public.sales where created_at >= date_trunc('day', now())),
    'sales_week_paise', (select coalesce(sum(total_paise),0) from public.sales where created_at >= now() - interval '7 days'),
    'sales_month_paise', (select coalesce(sum(total_paise),0) from public.sales where created_at >= now() - interval '30 days'),
    'open_jobs', (select count(*) from public.tailoring_jobs where status in ('open','in_progress')),
    'online_orders', (select count(*) from public.online_orders where status in ('new','picking')),
    'active_listings', (select count(*) from public.listings where published),
    'active_holds', (select count(*) from public.holds where status='active' and expires_at > now())
  );
$$;
grant execute on function public.dashboard_metrics() to authenticated;

create or replace function public.tailoring_job_totals()
returns table(job_id uuid, fabric_cost_paise bigint, selling_value_paise bigint, lines bigint)
language sql stable security definer set search_path = public as $$
  select job_id,
         coalesce(sum(coalesce(cost_snapshot_paise,0) * coalesce(length_mm, (coalesce(qty,0)*1000)::int)/1000),0)::bigint,
         coalesce(sum(coalesce(price_snapshot_paise,0) * coalesce(length_mm, (coalesce(qty,0)*1000)::int)/1000),0)::bigint,
         count(*)::bigint
  from public.tailoring_job_lines group by job_id;
$$;
grant execute on function public.tailoring_job_totals() to authenticated;
