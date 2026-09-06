alter table public.branch_shifts add column if not exists logical_id uuid not null default gen_random_uuid();
alter table public.branch_shifts add column if not exists effective_from date not null default current_date;
alter table public.branch_shifts add column if not exists effective_to date;

alter table public.branch_shifts drop constraint if exists branch_shifts_effective_range_check;
alter table public.branch_shifts add constraint branch_shifts_effective_range_check
  check (effective_to is null or effective_to >= effective_from);

drop index if exists public.branch_shifts_branch_name_uq;
create unique index if not exists branch_shifts_version_uq
  on public.branch_shifts(branch_id, logical_id, effective_from);
create index if not exists branch_shifts_effective_idx
  on public.branch_shifts(branch_id, effective_from, effective_to, is_active, sort_order);

create table if not exists public.branch_shift_audit (
  id bigint generated always as identity primary key,
  branch_id bigint not null references public.branches(id) on delete cascade,
  shift_id bigint references public.branch_shifts(id) on delete set null,
  logical_id uuid,
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  effective_date date not null,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now(),
  constraint branch_shift_audit_action_check check (action in ('create','update','delete','activate','deactivate'))
);

create index if not exists branch_shift_audit_branch_time_idx on public.branch_shift_audit(branch_id, created_at desc);
create index if not exists branch_shift_audit_user_idx on public.branch_shift_audit(user_id, created_at desc);
create index if not exists branch_shift_audit_logical_idx on public.branch_shift_audit(logical_id, created_at desc);

alter table public.branch_shift_audit enable row level security;
drop policy if exists branch_shift_audit_read on public.branch_shift_audit;
create policy branch_shift_audit_read on public.branch_shift_audit
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
            and uba.branch_id=branch_shift_audit.branch_id
            and uba.is_active=true
        )
      )
  )
);
grant select on public.branch_shift_audit to authenticated;
