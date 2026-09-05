const PROJECT_REF = 'afhnfnfbqdqqzrghovfc';
const PUBLISHABLE_KEY = 'sb_publishable_4GStzbYK3_BhthidusT_hw_DqtzC7qE';
const FUNCTION_BASE = 'https://afhnfnfbqdqqzrghovfc.supabase.co/functions/v1/ms-parcel-api';
let loading = false;
let lastBranch = 0;
let lastLoadedAt = 0;

function findAccessToken() {
  const preferred = `sb-${PROJECT_REF}-auth-token`;
  const keys = [preferred, ...Object.keys(localStorage).filter((k) => k.startsWith(`sb-${PROJECT_REF}`) && k !== preferred)];
  const walk = (value) => {
    if (!value || typeof value !== 'object') return '';
    if (typeof value.access_token === 'string' && value.access_token) return value.access_token;
    for (const v of Object.values(value)) { const found = walk(v); if (found) return found; }
    return '';
  };
  for (const key of keys) {
    try { const token = walk(JSON.parse(localStorage.getItem(key) || 'null')); if (token) return token; } catch (_) {}
  }
  return '';
}

function branchId() { return Number(document.getElementById('branch-select')?.value || 0); }

async function loadFullAnalytics(force = false) {
  const id = branchId();
  const token = findAccessToken();
  if (!id || !token || loading) return;
  if (!force && id === lastBranch && Date.now() - lastLoadedAt < 14 * 60_000) return;
  loading = true;
  try {
    const res = await fetch(`${FUNCTION_BASE}/analytics?branch_id=${id}`, {
      headers: { Authorization: `Bearer ${token}`, apikey: PUBLISHABLE_KEY },
      cache: 'no-store',
    });
    const out = await res.json().catch(() => null);
    if (!res.ok || !out?.ok) throw new Error(out?.message || `HTTP ${res.status}`);
    window.__MS_FULL_ANALYTICS = out.data;
    lastBranch = id;
    lastLoadedAt = Date.now();
    window.dispatchEvent(new CustomEvent('ms-full-analytics', { detail: out.data }));
  } catch (error) {
    window.dispatchEvent(new CustomEvent('ms-full-analytics-error', { detail: { message: String(error?.message || error) } }));
  } finally { loading = false; }
}

function init() {
  setTimeout(() => void loadFullAnalytics(false), 1200);
  document.getElementById('branch-select')?.addEventListener('change', () => {
    lastBranch = 0;
    lastLoadedAt = 0;
    setTimeout(() => void loadFullAnalytics(true), 800);
  });
  document.getElementById('refresh-btn')?.addEventListener('click', () => setTimeout(() => void loadFullAnalytics(true), 600));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastLoadedAt > 14 * 60_000) void loadFullAnalytics(false);
  });
  setInterval(() => { if (!document.hidden) void loadFullAnalytics(false); }, 60_000);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
