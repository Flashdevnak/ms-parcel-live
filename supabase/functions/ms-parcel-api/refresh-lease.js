// Backend-only lease in the existing branch-scoped table. Frontend leases
// remain unchanged; their short lifetime is not sufficient for a full scan.
// Five minutes exceeds the Free Edge worker lifetime and prevents a crashed
// collector from immediately starting another expensive full scan.
export async function claimAnalyticsLease(db, branchId, userId, now = Date.now()) {
  if (!Number.isSafeInteger(branchId) || branchId <= 0 || !userId) throw new Error('Invalid lease scope');
  const key = `b:${branchId}:engine:full-analytics`;
  const at = new Date(now).toISOString(), until = new Date(now + 300000).toISOString();
  const record = {cache_key:key, branch_id:branchId, owner_user_id:userId, lease_until:until, updated_at:at};
  const scope = `cache_key=eq.${encodeURIComponent(key)}&branch_id=eq.${branchId}`;
  const headers = {Prefer:'return=representation'};
  const updated = await db(`cache_refresh_leases?${scope}&lease_until=lte.${encodeURIComponent(at)}`, {
    method:'PATCH', headers, body:JSON.stringify(record)
  });
  let claimed = updated?.length === 1;
  if (!claimed) {
    const inserted = await db('cache_refresh_leases?on_conflict=cache_key', {
      method:'POST', headers:{Prefer:'resolution=ignore-duplicates,return=representation'}, body:JSON.stringify(record)
    });
    claimed = inserted?.length === 1;
  }
  if (!claimed) return null;
  return async () => {
    // Conditional release cannot unlock a successor's lease.
    await db(`cache_refresh_leases?${scope}&owner_user_id=eq.${encodeURIComponent(userId)}&lease_until=eq.${encodeURIComponent(until)}`, {
      method:'PATCH', headers:{Prefer:'return=minimal'},
      body:JSON.stringify({lease_until:new Date(0).toISOString()})
    });
  };
}
