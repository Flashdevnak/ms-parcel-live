create table if not exists public.ops_aggregate_history (
  id bigint generated always as identity primary key,
  branch_id bigint not null references public.branches(id) on delete cascade,
  bucket_at timestamptz not null,
  source_at timestamptz not null,
  shift_logical_id uuid null,
  shift_name text null,
  total integer not null default 0,
  fd integer not null default 0,
  lh integer not null default 0,
  single_parcels integer not null default 0,
  bagged_parcels integer not null default 0,
  unique_bags integer not null default 0,
  over24 integer not null default 0,
  over48 integer not null default 0,
  overdue integer not null default 0,
  weight_kg numeric not null default 0,
  destination_snapshot jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(branch_id,bucket_at)
);

create index if not exists ops_aggregate_history_branch_time_idx
  on public.ops_aggregate_history(branch_id,bucket_at desc);
create index if not exists ops_aggregate_history_shift_time_idx
  on public.ops_aggregate_history(branch_id,shift_logical_id,bucket_at desc);

alter table public.ops_aggregate_history enable row level security;

drop policy if exists ops_aggregate_history_read on public.ops_aggregate_history;
create policy ops_aggregate_history_read on public.ops_aggregate_history
for select to authenticated
using (
  exists (
    select 1 from public.app_profiles p
    where p.user_id=(select auth.uid())
      and p.access_status='active'
      and (
        p.role='admin'
        or exists (
          select 1 from public.user_branch_access a
          where a.user_id=(select auth.uid())
            and a.branch_id=ops_aggregate_history.branch_id
            and a.is_active=true
        )
      )
  )
);

grant select on public.ops_aggregate_history to authenticated;

authorization revoke all on function public.system_quota_health() from public;

create or replace function public.cleanup_ops_history()
returns jsonb
language plpgsql
security definer
set search_path='public'
as $function$
declare
  v_old integer:=0;
  v_expired_cache integer:=0;
begin
  delete from public.ops_aggregate_history
  where bucket_at < now() - interval '45 days';
  get diagnostics v_old = row_count;

  delete from public.live_cache_pages
  where expires_at < now() - interval '6 hours'
    and cache_key like 'b:%:snapshot:%';
  get diagnostics v_expired_cache = row_count;

  return jsonb_build_object(
    'history_deleted',v_old,
    'expired_snapshot_pages_deleted',v_expired_cache
  );
end
$function$;

revoke all on function public.cleanup_ops_history() from public;
revoke all on function public.cleanup_ops_history() from anon;
revoke all on function public.cleanup_ops_history() from authenticated;
