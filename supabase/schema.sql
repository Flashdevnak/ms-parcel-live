-- Reference schema for ms-parcel-live v7 (Supabase project afhnfnfbqdqqzrghovfc)

create table if not exists public.branches (
  id bigint generated always as identity primary key,
  code text not null,
  name text not null,
  store_id text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists branches_code_lower_uidx on public.branches(lower(code));

create table if not exists public.app_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text,
  display_name text,
  email text,
  role text not null default 'viewer' check (role in ('viewer','admin')),
  access_status text not null default 'pending' check (access_status in ('pending','active','disabled')),
  branch_id bigint references public.branches(id) on delete set null,
  can_upload_har boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists app_profiles_username_lower_uidx on public.app_profiles(lower(username)) where username is not null;
create index if not exists app_profiles_access_status_idx on public.app_profiles(access_status);
create index if not exists app_profiles_branch_idx on public.app_profiles(branch_id);

create table if not exists public.ms_connection (
  id bigint generated always as identity primary key,
  branch_id bigint not null references public.branches(id) on delete cascade,
  label text not null default 'default',
  store_id text,
  store_name text,
  fbi_base_url text not null default 'https://fbi.flashexpress.com',
  endpoint_path text not null default '/api/dc/unfinished_parcel_list',
  query_template jsonb not null default '{}'::jsonb,
  credential_ciphertext text,
  credential_updated_at timestamptz,
  is_active boolean not null default true,
  last_ok_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ms_connection_branch_uidx on public.ms_connection(branch_id);

create table if not exists public.live_cache_pages (
  cache_key text primary key,
  branch_id bigint not null references public.branches(id) on delete cascade,
  payload jsonb not null,
  item_count integer not null default 0,
  source_total integer,
  source_updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  content_hash text,
  previous_hash text,
  delta_payload jsonb,
  unchanged_streak integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists live_cache_pages_expires_at_idx on public.live_cache_pages(expires_at);
create index if not exists live_cache_pages_branch_exp_idx on public.live_cache_pages(branch_id,expires_at);

create table if not exists public.summary_cache (
  cache_key text primary key,
  branch_id bigint not null references public.branches(id) on delete cascade,
  payload jsonb not null,
  content_hash text,
  source_updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists summary_cache_branch_idx on public.summary_cache(branch_id);

create table if not exists public.cache_refresh_leases (
  cache_key text primary key,
  branch_id bigint not null references public.branches(id) on delete cascade,
  owner_user_id uuid,
  lease_until timestamptz not null default to_timestamp(0),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  key text primary key,
  value_hash text not null,
  used_at timestamptz,
  used_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.branches enable row level security;
alter table public.app_profiles enable row level security;
alter table public.ms_connection enable row level security;
alter table public.live_cache_pages enable row level security;
alter table public.summary_cache enable row level security;
alter table public.cache_refresh_leases enable row level security;
alter table public.app_settings enable row level security;

revoke all on public.branches from anon,authenticated;
drop policy if exists branches_deny_clients on public.branches;
create policy branches_deny_clients on public.branches for all to anon,authenticated using(false) with check(false);

revoke insert,update,delete on public.app_profiles from anon,authenticated;
drop policy if exists profiles_self_select on public.app_profiles;
create policy profiles_self_select on public.app_profiles for select to authenticated using(user_id=(select auth.uid()));

revoke all on public.ms_connection from anon,authenticated;
drop policy if exists deny_clients_ms_connection on public.ms_connection;
create policy deny_clients_ms_connection on public.ms_connection for all to anon,authenticated using(false) with check(false);

revoke all on public.live_cache_pages from anon,authenticated;
grant select on public.live_cache_pages to authenticated;
drop policy if exists active_users_read_live_cache on public.live_cache_pages;
create policy active_users_read_live_cache on public.live_cache_pages for select to authenticated using(
  exists(select 1 from public.app_profiles p where p.user_id=(select auth.uid()) and p.access_status='active' and (p.role='admin' or p.branch_id=live_cache_pages.branch_id))
);

revoke all on public.summary_cache from anon,authenticated;
grant select on public.summary_cache to authenticated;
drop policy if exists active_users_read_summary_cache on public.summary_cache;
create policy active_users_read_summary_cache on public.summary_cache for select to authenticated using(
  exists(select 1 from public.app_profiles p where p.user_id=(select auth.uid()) and p.access_status='active' and (p.role='admin' or p.branch_id=summary_cache.branch_id))
);

revoke all on public.cache_refresh_leases from anon,authenticated;
grant select,insert,update on public.cache_refresh_leases to authenticated;
drop policy if exists active_users_read_cache_refresh_leases on public.cache_refresh_leases;
create policy active_users_read_cache_refresh_leases on public.cache_refresh_leases for select to authenticated using(
  exists(select 1 from public.app_profiles p where p.user_id=(select auth.uid()) and p.access_status='active' and (p.role='admin' or p.branch_id=cache_refresh_leases.branch_id))
);
drop policy if exists active_users_insert_cache_refresh_leases on public.cache_refresh_leases;
create policy active_users_insert_cache_refresh_leases on public.cache_refresh_leases for insert to authenticated with check(
  owner_user_id=(select auth.uid())
  and cache_key ~ ('^b:'||branch_id::text||':(p:[1-9][0-9]{0,5}:s:(20|50|100)|summary:transfer-summary)$')
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
  and cache_key ~ ('^b:'||branch_id::text||':(p:[1-9][0-9]{0,5}:s:(20|50|100)|summary:transfer-summary)$')
  and lease_until>now() and lease_until<=now()+interval '15 seconds'
  and exists(select 1 from public.app_profiles p where p.user_id=(select auth.uid()) and p.access_status='active' and (p.role='admin' or p.branch_id=cache_refresh_leases.branch_id))
);

revoke all on public.app_settings from anon,authenticated;
drop policy if exists app_settings_deny_all on public.app_settings;
create policy app_settings_deny_all on public.app_settings for all to anon,authenticated using(false) with check(false);

create or replace function public.claim_cache_refresh(p_branch_id bigint,p_cache_key text,p_lease_seconds integer default 6)
returns boolean language plpgsql security invoker set search_path=public as $$
declare
  v_uid uuid:=auth.uid();
  v_claimed boolean:=false;
  v_seconds integer:=greatest(2,least(coalesce(p_lease_seconds,6),15));
begin
  if v_uid is null or p_branch_id is null then return false; end if;
  if p_cache_key !~ ('^b:'||p_branch_id::text||':(p:[1-9][0-9]{0,5}:s:(20|50|100)|summary:transfer-summary)$') then return false; end if;
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
