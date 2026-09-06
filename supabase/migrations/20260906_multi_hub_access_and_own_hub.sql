alter table public.branches add column if not exists own_hub_name text;
alter table public.branches add column if not exists hub_aliases jsonb not null default '[]'::jsonb;

create table if not exists public.user_branch_access (
  user_id uuid not null references public.app_profiles(user_id) on delete cascade,
  branch_id bigint not null references public.branches(id) on delete cascade,
  can_upload_har boolean not null default false,
  can_manage_shift boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, branch_id)
);

create index if not exists user_branch_access_branch_active_idx
  on public.user_branch_access(branch_id, is_active, user_id);
create index if not exists user_branch_access_user_active_idx
  on public.user_branch_access(user_id, is_active, branch_id);

insert into public.user_branch_access(user_id, branch_id, can_upload_har, can_manage_shift, is_active)
select p.user_id, p.branch_id, p.can_upload_har, true, true
from public.app_profiles p
where p.branch_id is not null
on conflict(user_id, branch_id) do update
set can_upload_har = excluded.can_upload_har,
    is_active = true,
    updated_at = now();

alter table public.user_branch_access enable row level security;

drop policy if exists user_branch_access_self_read on public.user_branch_access;
create policy user_branch_access_self_read on public.user_branch_access
for select to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.access_status = 'active'
      and p.role = 'admin'
  )
);

grant select on public.user_branch_access to authenticated;

-- Shared live/summary cache remains branch-scoped, but non-admin access is now
-- resolved through the many-to-many membership table instead of one profile branch.
drop policy if exists active_users_read_live_cache on public.live_cache_pages;
create policy active_users_read_live_cache on public.live_cache_pages
for select to authenticated
using (
  exists (
    select 1 from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.access_status = 'active'
      and (
        p.role = 'admin'
        or exists (
          select 1 from public.user_branch_access uba
          where uba.user_id = p.user_id
            and uba.branch_id = live_cache_pages.branch_id
            and uba.is_active = true
        )
      )
  )
);

drop policy if exists active_users_read_summary_cache on public.summary_cache;
create policy active_users_read_summary_cache on public.summary_cache
for select to authenticated
using (
  exists (
    select 1 from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.access_status = 'active'
      and (
        p.role = 'admin'
        or exists (
          select 1 from public.user_branch_access uba
          where uba.user_id = p.user_id
            and uba.branch_id = summary_cache.branch_id
            and uba.is_active = true
        )
      )
  )
);

drop policy if exists active_users_read_cache_refresh_leases on public.cache_refresh_leases;
create policy active_users_read_cache_refresh_leases on public.cache_refresh_leases
for select to authenticated
using (
  exists (
    select 1 from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.access_status = 'active'
      and (
        p.role = 'admin'
        or exists (
          select 1 from public.user_branch_access uba
          where uba.user_id = p.user_id
            and uba.branch_id = cache_refresh_leases.branch_id
            and uba.is_active = true
        )
      )
  )
);

-- Shift rows can be read by every branch member. Write permission is additionally
-- gated by can_manage_shift for viewers; admins can manage every branch.
drop policy if exists branch_shifts_read on public.branch_shifts;
create policy branch_shifts_read on public.branch_shifts
for select to authenticated
using (
  exists (
    select 1 from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.access_status = 'active'
      and (
        p.role = 'admin'
        or exists (
          select 1 from public.user_branch_access uba
          where uba.user_id = p.user_id
            and uba.branch_id = branch_shifts.branch_id
            and uba.is_active = true
        )
      )
  )
);

drop policy if exists branch_shifts_insert on public.branch_shifts;
create policy branch_shifts_insert on public.branch_shifts
for insert to authenticated
with check (
  created_by = (select auth.uid())
  and updated_by = (select auth.uid())
  and exists (
    select 1 from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.access_status = 'active'
      and (
        p.role = 'admin'
        or exists (
          select 1 from public.user_branch_access uba
          where uba.user_id = p.user_id
            and uba.branch_id = branch_shifts.branch_id
            and uba.is_active = true
            and uba.can_manage_shift = true
        )
      )
  )
);

drop policy if exists branch_shifts_update on public.branch_shifts;
create policy branch_shifts_update on public.branch_shifts
for update to authenticated
using (
  exists (
    select 1 from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.access_status = 'active'
      and (
        p.role = 'admin'
        or exists (
          select 1 from public.user_branch_access uba
          where uba.user_id = p.user_id
            and uba.branch_id = branch_shifts.branch_id
            and uba.is_active = true
            and uba.can_manage_shift = true
        )
      )
  )
)
with check (
  updated_by = (select auth.uid())
  and exists (
    select 1 from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.access_status = 'active'
      and (
        p.role = 'admin'
        or exists (
          select 1 from public.user_branch_access uba
          where uba.user_id = p.user_id
            and uba.branch_id = branch_shifts.branch_id
            and uba.is_active = true
            and uba.can_manage_shift = true
        )
      )
  )
);

drop policy if exists branch_shifts_delete on public.branch_shifts;
create policy branch_shifts_delete on public.branch_shifts
for delete to authenticated
using (
  exists (
    select 1 from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.access_status = 'active'
      and (
        p.role = 'admin'
        or exists (
          select 1 from public.user_branch_access uba
          where uba.user_id = p.user_id
            and uba.branch_id = branch_shifts.branch_id
            and uba.is_active = true
            and uba.can_manage_shift = true
        )
      )
  )
);

-- Client-side refresh coordination must authorize any active branch membership.
create or replace function public.claim_cache_refresh(
  p_branch_id bigint,
  p_cache_key text,
  p_lease_seconds integer default 6
) returns boolean
language plpgsql
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_claimed boolean := false;
  v_seconds integer := greatest(2, least(coalesce(p_lease_seconds, 6), 15));
begin
  if v_uid is null or p_branch_id is null then return false; end if;
  if p_cache_key !~ ('^b:'||p_branch_id::text||':(p:[1-9][0-9]{0,5}:s:(20|50|100)|summary:transfer-summary)$') then return false; end if;
  if not exists (
    select 1 from public.app_profiles p
    where p.user_id = v_uid
      and p.access_status = 'active'
      and (
        p.role = 'admin'
        or exists (
          select 1 from public.user_branch_access uba
          where uba.user_id = v_uid
            and uba.branch_id = p_branch_id
            and uba.is_active = true
        )
      )
  ) then return false; end if;

  insert into public.cache_refresh_leases(cache_key, branch_id, owner_user_id, lease_until, updated_at)
  values(p_cache_key, p_branch_id, v_uid, now()+make_interval(secs=>v_seconds), now())
  on conflict(cache_key) do update
    set branch_id=excluded.branch_id,
        owner_user_id=excluded.owner_user_id,
        lease_until=excluded.lease_until,
        updated_at=excluded.updated_at
  where public.cache_refresh_leases.lease_until<=now()
  returning true into v_claimed;
  return coalesce(v_claimed,false);
end $$;
