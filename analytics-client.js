import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm';

const SUPABASE_URL = 'https://afhnfnfbqdqqzrghovfc.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_4GStzbYK3_BhthidusT_hw_DqtzC7qE';
const FUNCTION_BASE = `${SUPABASE_URL}/functions/v1/ms-parcel-api`;
const analyticsSupabase = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

let loading = false;
let lastBranch = 0;
let nextCheckAt = 0;
let retryTimer = null;

async function accessToken() {
  try {
    const { data } = await analyticsSupabase.auth.getSession();
    return String(data?.session?.access_token || '');
  } catch (_) {
    return '';
  }
}

function branchId() { return Number(document.getElementById('branch-select')?.value || 0); }
function cacheKey(id) { return `b:${id}:summary:full-analytics-v1`; }
// Production v8 schema already authorizes this shared summary lease key.
// It is only a 15-second leader election; full analytics itself remains a separate 30-minute cache.
function leaseKey(id) { return `b:${id}:summary:transfer-summary`; }

function headers(token, json = false) {
  const h = { Authorization: `Bearer ${token}`, apikey: PUBLISHABLE_KEY };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

function publish(data) {
  if (!data) return;
  window.__MS_FULL_ANALYTICS = data;
  window.dispatchEvent(new CustomEvent('ms-full-analytics', { detail: data }));
}

function retrySoon(ms = 1500) {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => { if (!document.hidden) void loadFullAnalytics(false); }, Math.max(250, ms));
}

function scheduleFromExpiry(expiresAt) {
  const expiry = Date.parse(String(expiresAt || ''));
  nextCheckAt = Number.isFinite(expiry) ? Math.max(Date.now() + 15_000, expiry - 20_000) : Date.now() + 4 * 60_000;
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => { if (!document.hidden) void loadFullAnalytics(false); }, Math.max(15_000, nextCheckAt - Date.now()));
}

async function readCache(id, token) {
  const select = encodeURIComponent('payload,expires_at,source_updated_at');
  const key = encodeURIComponent(cacheKey(id));
  const res = await fetch(`${SUPABASE_URL}/rest/v1/summary_cache?cache_key=eq.${key}&branch_id=eq.${id}&select=${select}&limit=1`, { headers: headers(token), cache: 'no-store' });
  if (!res.ok) return null;
  const rows = await res.json().catch(() => []);
  return rows?.[0] || null;
}

async function claim(id, token) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/claim_cache_refresh`, {
    method: 'POST',
    headers: headers(token, true),
    body: JSON.stringify({ p_branch_id: id, p_cache_key: leaseKey(id), p_lease_seconds: 15 }),
  });
  if (!res.ok) return false;
  return (await res.json().catch(() => false)) === true;
}

async function edgeRefresh(id, token) {
  const res = await fetch(`${FUNCTION_BASE}/analytics?branch_id=${id}`, { headers: headers(token), cache: 'no-store' });
  const out = await res.json().catch(() => null);
  if (!res.ok || !out?.ok) throw new Error(out?.message || `HTTP ${res.status}`);
  return out;
}

async function loadFullAnalytics(forceRead = false) {
  const id = branchId();
  const token = await accessToken();
  if (!id || !token) { retrySoon(1500); return; }
  if (loading) return;
  if (!forceRead && id === lastBranch && Date.now() < nextCheckAt) return;

  loading = true;
  try {
    const cached = await readCache(id, token);
    if (cached?.payload) publish(cached.payload);
    const fresh = cached && Date.parse(String(cached.expires_at || '')) > Date.now();
    if (fresh) { lastBranch = id; scheduleFromExpiry(cached.expires_at); return; }

    const leader = await claim(id, token);
    if (!leader) { nextCheckAt = Date.now() + 1800; retrySoon(1800); return; }

    const out = await edgeRefresh(id, token);
    publish(out.data);
    lastBranch = id;
    const ttlMs = Math.max(30_000, Number(out?.meta?.ttlMs || (out.data?.complete ? 30 * 60_000 : 5 * 60_000)));
    nextCheckAt = Date.now() + Math.max(15_000, ttlMs - 20_000);
    retrySoon(Math.max(15_000, ttlMs - 20_000));
  } catch (error) {
    window.dispatchEvent(new CustomEvent('ms-full-analytics-error', { detail: { message: String(error?.message || error) } }));
    nextCheckAt = Date.now() + 5000;
    retrySoon(5000);
  } finally { loading = false; }
}

function init() {
  retrySoon(800);
  document.getElementById('branch-select')?.addEventListener('change', () => {
    lastBranch = 0; nextCheckAt = 0; window.__MS_FULL_ANALYTICS = null; retrySoon(1000);
  });
  document.getElementById('refresh-btn')?.addEventListener('click', () => { nextCheckAt = 0; retrySoon(700); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() >= nextCheckAt) retrySoon(300); });
  setInterval(() => { if (!document.hidden && Date.now() >= nextCheckAt) void loadFullAnalytics(false); }, 60_000);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
