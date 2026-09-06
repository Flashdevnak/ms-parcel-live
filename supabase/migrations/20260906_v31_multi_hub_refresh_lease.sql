create or replace function public.claim_cache_refresh(
  p_branch_id bigint,
  p_cache_key text,
  p_lease_seconds integer default 6
)
returns boolean
language plpgsql
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_claimed boolean := false;
  v_is_analytics boolean := p_cache_key = ('b:' || p_branch_id::text || ':summary:full-analytics-v1');
  v_seconds integer := case
    when v_is_analytics then greatest(30, least(coalesce(p_lease_seconds, 120), 120))
    else greatest(2, least(coalesce(p_lease_seconds, 6), 15))
  end;
begin
  if v_uid is null or p_branch_id is null then
    return false;
  end if;

  if p_cache_key !~ (
    '^b:' || p_branch_id::text ||
    ':(p:[1-9][0-9]{0,5}:s:(20|50|100)|summary:(transfer-summary|full-analytics-v1))$'
  ) then
    return false;
  end if;

  if not exists (
    select 1
    from public.app_profiles p
    where p.user_id = v_uid
      and p.access_status = 'active'
      and (
        p.role = 'admin'
        or exists (
          select 1
          from public.user_branch_access a
          where a.user_id = v_uid
            and a.branch_id = p_branch_id
            and a.is_active = true
        )
      )
  ) then
    return false;
  end if;

  insert into public.cache_refresh_leases(
    cache_key, branch_id, owner_user_id, lease_until, updated_at
  )
  values(
    p_cache_key,
    p_branch_id,
    v_uid,
    now() + make_interval(secs => v_seconds),
    now()
  )
  on conflict(cache_key) do update
    set branch_id = excluded.branch_id,
        owner_user_id = excluded.owner_user_id,
        lease_until = excluded.lease_until,
        updated_at = excluded.updated_at
  where public.cache_refresh_leases.lease_until <= now()
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end
$function$;
