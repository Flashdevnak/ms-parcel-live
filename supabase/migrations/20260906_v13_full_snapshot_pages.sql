create table if not exists public.full_snapshot_pages (
  branch_id bigint not null references public.branches(id) on delete cascade,
  snapshot_id uuid not null,
  page_no integer not null check (page_no > 0),
  payload jsonb not null,
  item_count integer not null default 0,
  source_total integer not null default 0,
  source_updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (branch_id, snapshot_id, page_no)
);
create index if not exists full_snapshot_pages_branch_snapshot_idx on public.full_snapshot_pages(branch_id, snapshot_id, page_no);
create index if not exists full_snapshot_pages_exp_idx on public.full_snapshot_pages(expires_at);

alter table public.full_snapshot_pages enable row level security;
revoke all on public.full_snapshot_pages from anon, authenticated;
grant select on public.full_snapshot_pages to authenticated;
drop policy if exists active_users_read_full_snapshot_pages on public.full_snapshot_pages;
create policy active_users_read_full_snapshot_pages on public.full_snapshot_pages
for select to authenticated using (
  exists (
    select 1 from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.access_status = 'active'
      and (p.role = 'admin' or p.branch_id = full_snapshot_pages.branch_id)
  )
);

create or replace function public.claim_cache_refresh(p_branch_id bigint,p_cache_key text,p_lease_seconds integer default 6)
returns boolean language plpgsql security invoker set search_path=public as $$
declare
  v_uid uuid:=auth.uid();
  v_claimed boolean:=false;
  v_seconds integer:=greatest(2,least(coalesce(p_lease_seconds,6),15));
begin
  if v_uid is null or p_branch_id is null then return false; end if;
  if p_cache_key !~ ('^b:'||p_branch_id::text||':(p:[1-9][0-9]{0,5}:s:(20|50|100)|summary:(transfer-summary|full-analytics-v1))$') then return false; end if;
  if not exists(select 1 from public.app_profiles p where p.user_id=v_uid and p.access_status='active' and (p.role='admin' or p.branch_id=p_branch_id)) then return false; end if;
  insert into public.cache_refresh_leases(cache_key,branch_id,owner_user_id,lease_until,updated_at)
  values(p_cache_key,p_branch_id,v_uid,now()+make_interval(secs=>v_seconds),now())
  on conflict(cache_key) do update set branch_id=excluded.branch_id,owner_user_id=excluded.owner_user_id,lease_until=excluded.lease_until,updated_at=excluded.updated_at
  where public.cache_refresh_leases.lease_until<=now()
  returning true into v_claimed;
  return coalesce(v_claimed,false);
end $$;
revoke all on function public.claim_cache_refresh(bigint,text,integer) from public,anon;
grant execute on function public.claim_cache_refresh(bigint,text,integer) to authenticated;

drop policy if exists active_users_insert_cache_refresh_leases on public.cache_refresh_leases;
create policy active_users_insert_cache_refresh_leases on public.cache_refresh_leases for insert to authenticated with check(
  owner_user_id=(select auth.uid())
  and cache_key ~ ('^b:'||branch_id::text||':(p:[1-9][0-9]{0,5}:s:(20|50|100)|summary:(transfer-summary|full-analytics-v1))$')
  and lease_until>now() and lease_until<=now()+interval '15 seconds'
  and exists(select 1 from public.app_profiles p where p.user_id=(select auth.uid()) and p.access_status='active' and (p.role='admin' or p.branch_id=cache_refresh_leases.branch_id))
);

drop policy if exists active_users_update_expired_cache_refresh_leases on public.cache_refresh_leases;
create policy active_users_update_expired_cache_refresh_leases on public.cache_refresh_leases for update to authenticated
using(
  lease_until<=now()
  and exists(select 1 from public.app_profiles p where p.user_id=(select auth.uid()) and p.access_status='active' and (p.role='admin' or p.branch_id=cache_refresh_leases.branch_id))
)
with check(
  owner_user_id=(select auth.uid())
  and cache_key ~ ('^b:'||branch_id::text||':(p:[1-9][0-9]{0,5}:s:(20|50|100)|summary:(transfer-summary|full-analytics-v1))$')
  and lease_until>now() and lease_until<=now()+interval '15 seconds'
  and exists(select 1 from public.app_profiles p where p.user_id=(select auth.uid()) and p.access_status='active' and (p.role='admin' or p.branch_id=cache_refresh_leases.branch_id))
);