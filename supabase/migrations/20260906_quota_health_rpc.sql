create or replace function public.system_quota_health()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with branch_cache as (
    select b.id as branch_id,b.code,
      count(l.cache_key) as live_rows,
      coalesce(sum(pg_column_size(l.payload)),0) as live_payload_bytes
    from public.branches b
    left join public.live_cache_pages l on l.branch_id=b.id
    group by b.id,b.code
  ), branch_summary as (
    select b.id as branch_id,
      count(s.cache_key) as summary_rows,
      coalesce(sum(pg_column_size(s.payload)),0) as summary_payload_bytes
    from public.branches b
    left join public.summary_cache s on s.branch_id=b.id
    group by b.id
  ), branch_shift as (
    select b.id as branch_id,
      count(so.*) as shift_snapshot_rows
    from public.branches b
    left join public.shift_operational_snapshots so on so.branch_id=b.id
    group by b.id
  )
  select jsonb_build_object(
    'databaseBytes', pg_database_size(current_database()),
    'targetFreeBudgetBytes', 524288000,
    'tables', jsonb_build_object(
      'liveCacheBytes', pg_total_relation_size('public.live_cache_pages'::regclass),
      'summaryCacheBytes', pg_total_relation_size('public.summary_cache'::regclass),
      'shiftConfigBytes', pg_total_relation_size('public.branch_shifts'::regclass),
      'shiftAuditBytes', pg_total_relation_size('public.branch_shift_audit'::regclass),
      'shiftSnapshotsBytes', pg_total_relation_size('public.shift_operational_snapshots'::regclass),
      'userAccessBytes', pg_total_relation_size('public.user_branch_access'::regclass)
    ),
    'branches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'branchId',c.branch_id,
        'code',c.code,
        'liveRows',c.live_rows,
        'livePayloadBytes',c.live_payload_bytes,
        'summaryRows',s.summary_rows,
        'summaryPayloadBytes',s.summary_payload_bytes,
        'shiftSnapshotRows',sh.shift_snapshot_rows
      ) order by c.code)
      from branch_cache c
      join branch_summary s using(branch_id)
      join branch_shift sh using(branch_id)
    ),'[]'::jsonb),
    'generatedAt', now()
  );
$$;

revoke all on function public.system_quota_health() from public;
revoke execute on function public.system_quota_health() from anon, authenticated;
grant execute on function public.system_quota_health() to service_role;
