create table if not exists public.branch_shifts (
  id bigint generated always as identity primary key,
  branch_id bigint not null references public.branches(id) on delete cascade,
  name text not null,
  start_minute smallint not null,
  end_minute smallint not null,
  sort_order smallint not null default 0,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint branch_shifts_name_check check (char_length(btrim(name)) between 1 and 50),
  constraint branch_shifts_start_check check (start_minute between 0 and 1439),
  constraint branch_shifts_end_check check (end_minute between 0 and 1439),
  constraint branch_shifts_nonzero_check check (start_minute <> end_minute),
  constraint branch_shifts_sort_check check (sort_order between 0 and 999)
);

create unique index if not exists branch_shifts_branch_name_uq
  on public.branch_shifts (branch_id, lower(btrim(name)));
create index if not exists branch_shifts_branch_active_idx
  on public.branch_shifts (branch_id, is_active, sort_order, start_minute);

alter table public.branch_shifts enable row level security;

drop policy if exists branch_shifts_read on public.branch_shifts;
create policy branch_shifts_read on public.branch_shifts
for select to authenticated
using (
  exists (
    select 1 from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.access_status = 'active'
      and (p.role = 'admin' or p.branch_id = branch_shifts.branch_id)
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
      and (p.role = 'admin' or p.branch_id = branch_shifts.branch_id)
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
      and (p.role = 'admin' or p.branch_id = branch_shifts.branch_id)
  )
)
with check (
  updated_by = (select auth.uid())
  and exists (
    select 1 from public.app_profiles p
    where p.user_id = (select auth.uid())
      and p.access_status = 'active'
      and (p.role = 'admin' or p.branch_id = branch_shifts.branch_id)
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
      and (p.role = 'admin' or p.branch_id = branch_shifts.branch_id)
  )
);

grant select, insert, update, delete on public.branch_shifts to authenticated;
grant usage, select on sequence public.branch_shifts_id_seq to authenticated;
