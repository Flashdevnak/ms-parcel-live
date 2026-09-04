-- Reference schema used by ms-parcel-live. Applied to Supabase project afhnfnfbqdqqzrghovfc.
create table if not exists public.app_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role text not null default 'viewer' check (role in ('viewer','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.ms_connection (
  id bigint generated always as identity primary key,
  label text not null default 'default', store_id text, store_name text,
  fbi_base_url text not null default 'https://fbi.flashexpress.com',
  endpoint_path text not null default '/api/dc/unfinished_parcel_list',
  query_template jsonb not null default '{}'::jsonb,
  credential_ciphertext text, credential_updated_at timestamptz,
  is_active boolean not null default true, last_ok_at timestamptz, last_error text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.live_cache_pages (
  cache_key text primary key, payload jsonb not null, item_count integer not null default 0,
  source_total integer, source_updated_at timestamptz not null default now(), expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create table if not exists public.summary_cache (
  cache_key text primary key, payload jsonb not null, source_updated_at timestamptz not null default now(),
  expires_at timestamptz not null, created_at timestamptz not null default now()
);
alter table public.app_profiles enable row level security;
alter table public.ms_connection enable row level security;
alter table public.live_cache_pages enable row level security;
alter table public.summary_cache enable row level security;

create policy "profiles_self_select" on public.app_profiles for select to authenticated using (user_id = (select auth.uid()));
create policy "profiles_self_update" on public.app_profiles for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "deny_clients_ms_connection" on public.ms_connection for all to anon, authenticated using (false) with check (false);
create policy "deny_clients_live_cache" on public.live_cache_pages for all to anon, authenticated using (false) with check (false);
create policy "deny_clients_summary_cache" on public.summary_cache for all to anon, authenticated using (false) with check (false);

-- One-time admin bootstrap guard. Store only SHA-256 hash, never the plaintext code.
create table if not exists public.app_settings (
  key text primary key,
  value_hash text not null,
  used_at timestamptz,
  used_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;
drop policy if exists app_settings_deny_all on public.app_settings;
create policy app_settings_deny_all on public.app_settings for all to anon, authenticated using (false) with check (false);
