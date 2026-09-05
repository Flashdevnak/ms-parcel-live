import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm';

const SUPABASE_URL = 'https://afhnfnfbqdqqzrghovfc.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_4GStzbYK3_BhthidusT_hw_DqtzC7qE';
const client = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

let loadedSnapshotId = '';
let rows = [];
let loadingPromise = null;

function branchId() { return Number(document.getElementById('branch-select')?.value || 0); }
function analytics() { return window.__MS_FULL_ANALYTICS || null; }
function decode(r) {
  return {
    pno:r?.[0]||'', state_name:r?.[1]||'', store_weight:r?.[2]||'', plan_leave_time:r?.[3]||'', real_arrive_time:r?.[4]||'',
    pack_num:r?.[5]||'', LastAction_name:r?.[6]||'', LastActionTime:r?.[7]||'', staff_info_phone:r?.[8]||'',
    store_manager_phone:r?.[9]||'', dst_hub_name:r?.[10]||'', dst_store_name:r?.[11]||'',
  };
}
function reset() {
  loadedSnapshotId = '';
  rows = [];
  window.__MS_FULL_ROWS = [];
  window.dispatchEvent(new CustomEvent('ms-full-rows-reset'));
}

async function ensureLoaded() {
  const a = analytics();
  const id = branchId();
  const snapshotId = String(a?.snapshotId || '');
  if (!a?.complete || !snapshotId || !id) return [];
  if (loadedSnapshotId === snapshotId && rows.length) return rows;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const { data: sessionData } = await client.auth.getSession();
    if (!sessionData?.session) return [];
    const { data, error } = await client.from('full_snapshot_pages')
      .select('page_no,payload,item_count')
      .eq('branch_id', id)
      .eq('snapshot_id', snapshotId)
      .order('page_no', { ascending: true });
    if (error || !Array.isArray(data) || !data.length) return [];
    const next = [];
    for (const page of data) {
      for (const compact of (Array.isArray(page.payload) ? page.payload : [])) next.push(decode(compact));
    }
    loadedSnapshotId = snapshotId;
    rows = next;
    window.__MS_FULL_ROWS = rows;
    window.dispatchEvent(new CustomEvent('ms-full-rows', { detail: { rows, snapshotId, total: Number(a.total || rows.length) } }));
    return rows;
  })().catch(() => []).finally(() => { loadingPromise = null; });

  return loadingPromise;
}

function getRows() { return rows; }
function status() {
  const a = analytics();
  return { loaded: !!rows.length, loading: !!loadingPromise, snapshotId: String(a?.snapshotId || ''), loadedSnapshotId, count: rows.length, total: Number(a?.total || 0) };
}

window.MSFullSnapshot = { ensureLoaded, getRows, reset, status };
window.addEventListener('ms-full-analytics', (event) => {
  const nextId = String(event.detail?.snapshotId || '');
  if (nextId !== loadedSnapshotId) reset();
});
document.getElementById('branch-select')?.addEventListener('change', reset);
