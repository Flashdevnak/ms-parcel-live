create table if not exists public.shift_operational_snapshots (
  branch_id bigint not null references public.branches(id) on delete cascade,
  shift_logical_id uuid not null,
  shift_date date not null,
  shift_name text not null,
  first_seen_at timestamptz not null,
  latest_seen_at timestamptz not null,
  start_metrics jsonb not null,
  latest_metrics jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (branch_id, shift_logical_id, shift_date)
);

create index if not exists shift_operational_branch_recent_idx
  on public.shift_operational_snapshots(branch_id, shift_date desc, latest_seen_at desc);

alter table public.shift_operational_snapshots enable row level security;
drop policy if exists shift_operational_read on public.shift_operational_snapshots;
create policy shift_operational_read on public.shift_operational_snapshots
for select to authenticated
using (
  exists (
    select 1 from public.app_profiles p
    where p.user_id=(select auth.uid())
      and p.access_status='active'
      and (
        p.role='admin'
        or exists (
          select 1 from public.user_branch_access uba
          where uba.user_id=p.user_id
            and uba.branch_id=shift_operational_snapshots.branch_id
            and uba.is_active=true
        )
      )
  )
);

grant select on public.shift_operational_snapshots to authenticated;
