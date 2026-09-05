import {supabase} from './auth-client.js?v=20260906-anchored-scan-v1';

const CONFIG = {
  supabaseUrl: 'https://afhnfnfbqdqqzrghovfc.supabase.co',
  publishableKey: 'sb_publishable_4GStzbYK3_BhthidusT_hw_DqtzC7qE',
  functionBase: 'https://afhnfnfbqdqqzrghovfc.supabase.co/functions/v1/ms-parcel-api',
};


const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('th-TH');
const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const val = (v, dash = '-') => (v === null || v === undefined || v === '' ? dash : String(v));
const kg = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? `${(n / 1000).toLocaleString('th-TH', { maximumFractionDigits: 3 })} kg` : val(v);
};
const customerType = (r) => (r.ka_name || r.ka_id ? 'KA' : val(r.customer_type_category));

const state = {
  session: null,
  profileRole: 'viewer',
  accessStatus: 'pending',
  canUploadHar: false,
  profileBranchId: 0,
  branches: [],
  branchId: 0,
  page: 1,
  pageSize: 100,
  rows: [],
  total: 0,
  hash: '',
  timer: null,
  summaryTimer: null,
  loading: false,
  summaryLoading: false,
  users: [],
  adminBranches: [],
  smartFilter: 'all',
  sortRisk: true,
};

let authApplySeq = 0;
const branchId = () => Number(state.branchId || 0);
const liveKey = () => `b:${branchId()}:p:${state.page}:s:${state.pageSize}`;
const summaryKey = () => `b:${branchId()}:summary:transfer-summary`;

setInterval(() => {
  $('live-clock').textContent = new Date().toLocaleString('th-TH', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}, 1000);

function parseMsTime(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '-' || raw === '--') return NaN;
  let normalized = raw;
  const looksLocal = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?/.test(raw);
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  if (looksLocal && !hasZone) normalized = raw.replace(' ', 'T') + '+07:00';
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function formatMinutes(minutes) {
  const total = Math.max(0, Math.floor(Number(minutes) || 0));
  if (total < 60) return `${total} นาที`;
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours < 24) return `${hours}ชม.${mins ? ` ${mins}น.` : ''}`.trim();
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return `${days}วัน${restHours ? ` ${restHours}ชม.` : ''}`.trim();
}

function rowRisk(row, now = Date.now()) {
  const arrivedAt = parseMsTime(row.real_arrive_time);
  const planAt = parseMsTime(row.plan_leave_time);
  const ageHours = Number.isFinite(arrivedAt) && now >= arrivedAt ? (now - arrivedAt) / 3600000 : null;
  const missed = Number.isFinite(planAt) && now > planAt;
  const overdueMinutes = missed ? (now - planAt) / 60000 : null;
  const dueMinutes = Number.isFinite(planAt) && planAt >= now ? (planAt - now) / 60000 : null;
  const dueSoon = dueMinutes !== null && dueMinutes <= 60;

  let band = 'unknown';
  if (ageHours !== null) {
    if (ageHours < 24) band = 'under24';
    else if (ageHours <= 48) band = '24to48';
    else band = 'over48';
  }

  let score = 0;
  if (band === 'over48') score += 800 + Math.min(ageHours || 0, 240);
  else if (band === '24to48') score += 400 + (ageHours || 0);
  else if (band === 'under24') score += ageHours || 0;
  if (missed) score += 700 + Math.min(overdueMinutes || 0, 1440) / 10;
  else if (dueSoon) score += 300 + Math.max(0, 60 - (dueMinutes || 0));

  return { ageHours, band, missed, overdueMinutes, dueSoon, dueMinutes, score };
}

function smartMatch(risk, filter = state.smartFilter) {
  if (filter === 'all') return true;
  if (filter === 'under24') return risk.band === 'under24';
  if (filter === '24to48') return risk.band === '24to48';
  if (filter === 'over48') return risk.band === 'over48';
  if (filter === 'missed') return risk.missed;
  if (filter === 'dueSoon') return risk.dueSoon;
  return true;
}

function smartFilterLabel() {
  return ({
    all: 'ทั้งหมด',
    under24: 'ค้าง <24 ชม.',
    '24to48': 'ค้าง 24–48 ชม.',
    over48: 'ค้าง >48 ชม.',
    missed: 'เกินเวลาแผน',
    dueSoon: 'ใกล้เวลาแผน ≤60 นาที',
  })[state.smartFilter] || 'ทั้งหมด';
}

function riskText(risk) {
  const parts = [];
  if (risk.ageHours === null) parts.push('อายุไม่ทราบ');
  else parts.push(`ค้าง ${formatMinutes(risk.ageHours * 60)}`);
  if (risk.missed) parts.push(`เกินเวลาแผน ${formatMinutes(risk.overdueMinutes)}`);
  else if (risk.dueSoon) parts.push(`เหลือ ${formatMinutes(risk.dueMinutes)}`);
  return parts.join(' · ');
}

function riskHtml(risk) {
  const age = risk.band === 'under24'
    ? '<span class="risk-chip risk-under24">&lt;24 ชม.</span>'
    : risk.band === '24to48'
      ? '<span class="risk-chip risk-24to48">24–48 ชม.</span>'
      : risk.band === 'over48'
        ? '<span class="risk-chip risk-over48">&gt;48 ชม.</span>'
        : '<span class="risk-chip risk-unknown">อายุไม่ทราบ</span>';
  const route = risk.missed
    ? `<span class="risk-chip risk-missed">ตกรอบ ${esc(formatMinutes(risk.overdueMinutes))}</span>`
    : risk.dueSoon
      ? `<span class="risk-chip risk-soon">เหลือ ${esc(formatMinutes(risk.dueMinutes))}</span>`
      : '';
  const ageDetail = risk.ageHours === null ? '' : `<small>ค้าง ${esc(formatMinutes(risk.ageHours * 60))}</small>`;
  return `<div class="risk-stack">${age}${route}${ageDetail}</div>`;
}

function renderSmartMonitor(now = Date.now()) {
  const counts = { all: state.rows.length, under24: 0, '24to48': 0, over48: 0, missed: 0, dueSoon: 0, unknown: 0 };
  for (const row of state.rows) {
    const risk = rowRisk(row, now);
    if (risk.band === 'unknown') counts.unknown += 1;
    else counts[risk.band] += 1;
    if (risk.missed) counts.missed += 1;
    if (risk.dueSoon) counts.dueSoon += 1;
  }
  $('risk-all').textContent = fmt.format(counts.all);
  $('risk-under24').textContent = fmt.format(counts.under24);
  $('risk-24to48').textContent = fmt.format(counts['24to48']);
  $('risk-over48').textContent = fmt.format(counts.over48);
  $('risk-missed').textContent = fmt.format(counts.missed);
  $('risk-due-soon').textContent = fmt.format(counts.dueSoon);
  document.querySelectorAll('.smart-filter').forEach((button) => {
    button.classList.toggle('active', button.dataset.risk === state.smartFilter);
  });
  $('risk-sort').checked = state.sortRisk;
  const unknownText = counts.unknown ? ` · อายุไม่ทราบ ${fmt.format(counts.unknown)}` : '';
  $('smart-note').textContent = `รายการสด ${fmt.format(state.rows.length)}${unknownText}`;
}

async function copyFilteredRows() {
  const now = Date.now();
  const rows = filteredRows(now);
  if (!rows.length) {
    $('smart-note').textContent = 'ไม่มีรายการตามตัวกรองที่เลือก';
    return;
  }
  const branch = currentBranch();
  const lines = [
    `MS Parcel Live · ${branch?.code || '-'} · ${branch?.name || '-'}`,
    `ตัวกรอง: ${smartFilterLabel()} · ${new Date(now).toLocaleString('th-TH')}`,
    ...rows.map((r, index) => {
      const risk = rowRisk(r, now);
      const destination = [val(r.dst_hub_name, ''), val(r.dst_store_name, '')].filter(Boolean).join(' / ') || '-';
      return `${index + 1}. ${val(r.pno)} | ${riskText(risk)} | แผน ${val(r.plan_leave_time)} | ${destination}`;
    }),
  ];
  const text = lines.join('\n');
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    $('smart-note').textContent = `คัดลอก ${fmt.format(rows.length)} รายการแล้ว · ${smartFilterLabel()}`;
  } catch (error) {
    $('smart-note').textContent = `คัดลอกไม่สำเร็จ: ${error.message}`;
  }
}

async function publicApi(route, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('apikey', CONFIG.publishableKey);
  const res = await fetch(`${CONFIG.functionBase}/${route}`, { ...options, headers });
  const data = await res.json().catch(() => ({ ok: false, message: `HTTP ${res.status}` }));
  if (!res.ok || data.ok === false) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}

async function api(route, options = {}) {
  if (!state.session?.access_token) throw new Error('กรุณาเข้าสู่ระบบ');
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${state.session.access_token}`);
  headers.set('apikey', CONFIG.publishableKey);
  const res = await fetch(`${CONFIG.functionBase}/${route}`, { ...options, headers });
  const data = await res.json().catch(() => ({ ok: false, message: `HTTP ${res.status}` }));
  if (!res.ok || data.ok === false) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}

function branchQuery(route) {
  const sep = route.includes('?') ? '&' : '?';
  return `${route}${sep}branch_id=${branchId()}`;
}

function setConnection(type, text) {
  $('connection-badge').className = `badge ${type === 'ok' ? 'badge-ok' : type === 'bad' ? 'badge-bad' : 'badge-neutral'}`;
  $('connection-badge').textContent = text;
  $('live-dot').className = `live-dot ${type === 'ok' ? 'live' : type === 'bad' ? 'error' : 'stale'}`;
}

function scheduleLive(ms) {
  clearTimeout(state.timer);
  state.timer = setTimeout(() => loadPage(false), document.hidden ? 60000 : Math.max(500, ms));
}

function scheduleSummary(ms) {
  clearTimeout(state.summaryTimer);
  state.summaryTimer = setTimeout(() => loadSummary(false), document.hidden ? 60000 : Math.max(1000, ms));
}

function remainingMs(expiresAt, fallback = 1000) {
  const n = Date.parse(String(expiresAt || ''));
  return Number.isFinite(n) ? Math.max(0, n - Date.now() + 120) : fallback;
}

function currentBranch() {
  return state.branches.find((b) => Number(b.id) === branchId()) || null;
}

function branchLabel(id) {
  const b = (state.adminBranches.length ? state.adminBranches : state.branches).find((x) => Number(x.id) === Number(id));
  return b ? `${b.code} · ${b.name}` : `สาขา #${id}`;
}

function canUploadCurrentBranch() {
  return state.profileRole === 'admin' || (state.canUploadHar && Number(state.profileBranchId) === branchId());
}

async function claimRefresh(cacheKey) {
  const { data, error } = await supabase.rpc('claim_cache_refresh', {
    p_branch_id: branchId(), p_cache_key: cacheKey, p_lease_seconds: 6,
  });
  if (error) throw error;
  return data === true;
}

async function readLiveMeta() {
  const { data, error } = await supabase.from('live_cache_pages')
    .select('cache_key,branch_id,source_total,source_updated_at,expires_at,content_hash,previous_hash')
    .eq('cache_key', liveKey()).eq('branch_id', branchId()).maybeSingle();
  if (error) throw error;
  return data;
}

async function readLiveDelta() {
  const { data, error } = await supabase.from('live_cache_pages')
    .select('delta_payload,source_total,source_updated_at,expires_at,content_hash,previous_hash')
    .eq('cache_key', liveKey()).eq('branch_id', branchId()).maybeSingle();
  if (error) throw error;
  return data;
}

async function readLiveFull() {
  const { data, error } = await supabase.from('live_cache_pages')
    .select('payload,source_total,source_updated_at,expires_at,content_hash,previous_hash')
    .eq('cache_key', liveKey()).eq('branch_id', branchId()).maybeSingle();
  if (error) throw error;
  return data;
}

async function readSummaryCache() {
  const { data, error } = await supabase.from('summary_cache')
    .select('payload,source_updated_at,expires_at,content_hash')
    .eq('cache_key', summaryKey()).eq('branch_id', branchId()).maybeSingle();
  if (error) throw error;
  return data;
}

function applyDelta(delta) {
  if (!delta || !Array.isArray(delta.order)) return false;
  const map = new Map(state.rows.map((r) => [String(r?.pno || ''), r]));
  for (const pno of (delta.removed || [])) map.delete(String(pno));
  for (const row of (delta.upserts || [])) {
    const pno = String(row?.pno || '');
    if (pno) map.set(pno, row);
  }
  const next = delta.order.map((p) => map.get(String(p))).filter(Boolean);
  if (!next.length && delta.order.length) return false;
  state.rows = next;
  return true;
}

function updateLiveDisplay(sourceAt, note = 'live') {
  renderFilters();
  renderRows();
  window.dispatchEvent(new CustomEvent('ms-live-state',{detail:{total:state.total,count:state.rows.length,sourceAt,branchId:branchId()}}));
  $('last-refresh').textContent = `ตรวจ MS ล่าสุด ${new Date(sourceAt || Date.now()).toLocaleString('th-TH')} · ${note}`;
  $('source-sync').textContent = `${fmt.format(state.total)} รายการ · ${currentBranch()?.code || ''}`;
  setConnection('ok', 'ออนไลน์');
}

async function applySharedChange(meta) {
  if (!meta?.content_hash || meta.content_hash === state.hash) return false;
  if (state.hash && String(meta.previous_hash || '') === state.hash) {
    const d = await readLiveDelta();
    if (d && String(d.previous_hash || '') === state.hash && String(d.content_hash || '') === String(meta.content_hash || '') && applyDelta(d.delta_payload)) {
      state.total = Number(d.source_total || 0);
      state.hash = String(d.content_hash || '');
      updateLiveDisplay(d.source_updated_at, 'delta cache');
      return true;
    }
  }
  const full = await readLiveFull();
  const rows = full?.payload?.rows;
  if (!Array.isArray(rows)) return false;
  state.rows = rows;
  state.total = Number(full.source_total ?? full.payload?.total ?? 0);
  state.hash = String(full.content_hash || '');
  updateLiveDisplay(full.source_updated_at, 'shared cache');
  return true;
}

function applyEdgeLive(out) {
  const d = out?.data || {};
  let note = out?.meta?.cache || 'edge';
  if (d.notModified) {
    state.total = Number(d.total ?? state.total);
    state.hash = String(d.hash || state.hash);
    note = 'ไม่เปลี่ยน';
  } else if (d.delta && applyDelta(d.delta)) {
    state.total = Number(d.total ?? state.total);
    state.hash = String(d.hash || state.hash);
    note = 'delta';
  } else if (Array.isArray(d.rows)) {
    state.rows = d.rows;
    state.total = Number(d.total || 0);
    state.hash = String(d.hash || '');
    note = 'full';
  }
  updateLiveDisplay(d.sourceAt, out?.meta?.stale ? 'ใช้ cache ล่าสุด' : note);
  if (out?.meta?.stale) setConnection('bad', 'ใช้ cache ล่าสุด');
  return Number(out?.meta?.ttlMs || 0);
}

function renderSummary(d) {
  d = d || {};
  window.dispatchEvent(new CustomEvent('ms-summary-state',{detail:d}));
  $('m-total').textContent = fmt.format(d.total || 0);
  $('m-day1').textContent = fmt.format(d.day1 || 0);
  $('m-day2').textContent = fmt.format(d.day2 || 0);
  $('m-day3').textContent = fmt.format(d.day3 || 0);
  $('m-day4').textContent = fmt.format(d.day4 || 0);
  $('m-day5').textContent = fmt.format(d.day5plus || 0);
  $('m-store').textContent = d.storeName || d.storeId || currentBranch()?.name || '-';
}

function renderBranchSelect() {
  const el = $('branch-select');
  el.innerHTML = state.branches.map((b) => `<option value="${Number(b.id)}">${esc(b.code)} · ${esc(b.name)}</option>`).join('');
  if (branchId()) el.value = String(branchId());
  $('branch-select-wrap').classList.toggle('hidden', !state.session || state.branches.length === 0);
}

function updateHeaderPermissions() {
  const active = state.accessStatus === 'active';
  $('manage-users-btn').classList.toggle('hidden', !(active && state.profileRole === 'admin'));
  $('manage-branches-btn').classList.toggle('hidden', !(active && state.profileRole === 'admin'));
  $('upload-har-btn').classList.toggle('hidden', !(active && branchId() && canUploadCurrentBranch()));
  $('refresh-btn').classList.toggle('hidden', !active);
  $('logout-btn').classList.toggle('hidden', !state.session);
}

async function refreshStatus(preferred = 0) {
  const route = preferred ? `status?branch_id=${preferred}` : 'status';
  const out = await api(route);
  const d = out.data || {};
  const p = d.profile || {};
  state.profileRole = p.role || 'viewer';
  state.accessStatus = p.access_status || 'pending';
  state.canUploadHar = !!p.can_upload_har;
  state.profileBranchId = Number(p.branch_id || 0);
  state.branches = Array.isArray(d.branches) ? d.branches : [];
  let chosen = preferred || Number(localStorage.getItem('ms-parcel-branch-id') || 0) || state.profileBranchId || Number(d.branch?.id || 0) || Number(state.branches[0]?.id || 0);
  if (!state.branches.some((b) => Number(b.id) === chosen)) chosen = Number(state.branches[0]?.id || 0);
  state.branchId = chosen;
  if (chosen) localStorage.setItem('ms-parcel-branch-id', String(chosen));
  renderBranchSelect();
  window.dispatchEvent(new CustomEvent('ms-branch-ready',{detail:{...currentBranch(),id:branchId()}}));
  updateHeaderPermissions();
  const conn = d.connection;
  if (conn?.last_error) setConnection('bad', 'MS มีปัญหา');
  else if (conn?.credential_updated_at) setConnection('ok', 'ออนไลน์');
  else setConnection('neutral', 'ยังไม่มี HAR');
  $('source-sync').textContent = currentBranch()?.name || d.branch?.name || 'ยังไม่ได้เลือกสาขา';
  return d;
}

function deferSessionApply(session) {
  const seq = ++authApplySeq;
  setTimeout(() => {
    if (seq === authApplySeq) void setSession(session);
  }, 0);
}

async function boot() {
  const { data } = await supabase.auth.getSession();
  await setSession(data.session);
  supabase.auth.onAuthStateChange((event, session) => {
    const sameUser = state.session?.user?.id && session?.user?.id === state.session.user.id;
    if (sameUser && (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN')) {
      state.session = session;
      return;
    }
    deferSessionApply(session);
  });
}

async function setSession(session) {
  state.session = session;
  window.dispatchEvent(new CustomEvent('ms-session-reset'));
  clearTimeout(state.timer);
  clearTimeout(state.summaryTimer);
  state.hash = '';
  state.rows = [];
  state.total = 0;
  renderSmartMonitor();
  if (!session) {
    $('login-dialog').showModal();
    $('branch-select-wrap').classList.add('hidden');
    updateHeaderPermissions();
    $('empty-state').textContent = 'กรุณาเข้าสู่ระบบ';
    $('empty-state').classList.remove('hidden');
    $('table-wrap').classList.add('hidden');
    $('mobile-cards').classList.add('hidden');
    setConnection('neutral', 'ยังไม่ได้เข้าสู่ระบบ');
    $('source-sync').textContent = 'ยังไม่ได้เชื่อมต่อ';
    return;
  }
  if ($('login-dialog').open) $('login-dialog').close();
  $('empty-state').classList.add('hidden');
  try {
    await refreshStatus();
    if (state.accessStatus !== 'active') {
      setConnection('neutral', state.accessStatus === 'disabled' ? 'ถูกระงับ' : 'ยังไม่เปิดใช้งาน');
      $('empty-state').textContent = 'บัญชีนี้ยังไม่เปิดใช้งาน';
      $('empty-state').classList.remove('hidden');
      return;
    }
    if (!branchId()) {
      setConnection('neutral', 'ยังไม่มีสาขา');
      $('empty-state').textContent = 'ยังไม่ได้ตั้งค่าสาขา';
      $('empty-state').classList.remove('hidden');
      return;
    }
    await Promise.allSettled([loadSummary(false), loadPage(false)]);
  } catch (e) {
    setConnection('bad', 'เชื่อมต่อไม่ได้');
    $('source-sync').textContent = e.message;
  }
}

async function loadSummary(force = false) {
  if (!state.session || state.accessStatus !== 'active' || !branchId() || state.summaryLoading) return;
  state.summaryLoading = true;
  try {
    const c = await readSummaryCache();
    if (c?.payload) renderSummary(c.payload);
    const fresh = c && Date.parse(String(c.expires_at || '')) > Date.now();
    if (fresh && !force) {
      scheduleSummary(remainingMs(c.expires_at, 60000));
      return;
    }
    const leader = await claimRefresh(summaryKey());
    if (!leader) {
      scheduleSummary(900);
      return;
    }
    const out = await api(branchQuery('summary'));
    renderSummary(out.data);
    if (out.meta?.stale) setConnection('bad', 'ใช้ cache ล่าสุด');
    scheduleSummary(Number(out.meta?.ttlMs || 60000));
  } catch (e) {
    scheduleSummary(15000);
  } finally {
    state.summaryLoading = false;
  }
}

async function loadPage(force = false) {
  if (!state.session || state.accessStatus !== 'active' || !branchId() || state.loading) return;
  state.loading = true;
  try {
    const meta = await readLiveMeta();
    if (meta?.content_hash !== state.hash) await applySharedChange(meta);
    const fresh = meta && Date.parse(String(meta.expires_at || '')) > Date.now();
    if (fresh && !force) {
      renderSmartMonitor();
      scheduleLive(remainingMs(meta.expires_at, 8000));
      return;
    }
    const leader = await claimRefresh(liveKey());
    if (!leader) {
      scheduleLive(900);
      return;
    }
    const known = state.hash ? `&known_hash=${encodeURIComponent(state.hash)}` : '';
    const out = await api(`live?page=${state.page}&page_size=${state.pageSize}&branch_id=${branchId()}${known}`);
    const ttl = applyEdgeLive(out) || 8000;
    scheduleLive(ttl + 100);
  } catch (e) {
    if (!state.rows.length) {
      $('empty-state').textContent = 'ยังไม่มีข้อมูลในหน้าปัจจุบัน';
      $('empty-state').classList.remove('hidden');
    } else {
      $('last-refresh').textContent = `รีเฟรชไม่สำเร็จ · ใช้ข้อมูลล่าสุด · ${e.message}`;
    }
    setConnection('bad', 'รีเฟรชไม่สำเร็จ');
    scheduleLive(document.hidden ? 60000 : 15000);
  } finally {
    state.loading = false;
  }
}

function unique(field) {
  return [...new Set(state.rows.map((r) => val(r[field], '')).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'th'));
}

function fillSelect(id, values) {
  const el = $(id);
  const keep = el.value;
  el.innerHTML = '<option value="">ทั้งหมด</option>' + values.map((v) => `<option>${esc(v)}</option>`).join('');
  if (values.includes(keep)) el.value = keep;
}

function renderFilters() {
  fillSelect('status-filter', unique('state_name'));
  // Global destination filters belong to the full inventory workspace.
}

function hasLocalFilters() {
  return Boolean(
    $('search-input').value.trim()
    || $('status-filter').value
    || $('hub-filter').value
    || $('branch-filter').value
    || state.smartFilter !== 'all',
  );
}

function filteredRows(now = Date.now()) {
  const q = $('search-input').value.trim().toLowerCase();
  const st = $('status-filter').value;
  const hub = '';
  const br = ''; // Full-inventory filters must not filter a live sample.
  let rows = state.rows.filter((r) => {
    if (st && val(r.state_name) !== st) return false;
    if (hub && val(r.dst_hub_name) !== hub) return false;
    if (br && val(r.dst_store_name) !== br) return false;
    const risk = rowRisk(r, now);
    if (!smartMatch(risk)) return false;
    if (!q) return true;
    return Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(q));
  });
  if (state.sortRisk) {
    rows = [...rows].sort((a, b) => {
      const diff = rowRisk(b, now).score - rowRisk(a, now).score;
      if (Math.abs(diff) > 0.001) return diff;
      return String(a.pno || '').localeCompare(String(b.pno || ''));
    });
  }
  return rows;
}

function stack(a, b) {
  return `<div class="cell-stack"><span>${esc(val(a))}</span>${b ? `<small>${esc(val(b, ''))}</small>` : ''}</div>`;
}

function renderRows() {
  const now = Date.now();
  renderSmartMonitor(now);
  const rows = filteredRows(now);
  $('empty-state').classList.toggle('hidden', rows.length > 0);
  $('table-wrap').classList.toggle('hidden', rows.length === 0);
  $('mobile-cards').classList.toggle('hidden', rows.length === 0);
  if (!rows.length) $('empty-state').textContent = 'ไม่พบข้อมูลตามตัวกรองในหน้าปัจจุบัน';

  $('table-body').innerHTML = rows.map((r) => {
    const risk = rowRisk(r, now);
    const critical = risk.band === 'over48' && risk.missed;
    return `<tr class="${critical ? 'row-critical' : ''}">
      <td>${esc(val(r.pno))}</td>
      <td><span class="status-chip">${esc(val(r.state_name))}</span></td>
      <td>${riskHtml(risk)}</td>
      <td>${stack(`${Number(r.cod_amount || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท`, kg(r.store_weight))}</td>
      <td>${stack(r.plan_leave_time, r.real_arrive_time)}</td>
      <td>${esc(val(r.pack_num))}</td>
      <td>${esc(val(r.marker_category_name))}</td>
      <td>${stack(r.LastAction_name, r.LastActionTime)}</td>
      <td>${stack(r.staff_info_name, r.staff_info_phone)}</td>
      <td>${stack(r.dst_hub_name, r.dst_store_name)}</td>
      <td>${stack(`${val(r.dst_province_name, '')} ${val(r.dst_city_name, '')}`.trim(), r.dst_postal_code)}</td>
      <td>${stack(customerType(r), r.ka_name)}</td>
    </tr>`;
  }).join('');

  $('mobile-cards').innerHTML = rows.map((r) => {
    const risk = rowRisk(r, now);
    const critical = risk.band === 'over48' && risk.missed;
    return `<article class="mobile-card ${critical ? 'mobile-critical' : ''}">
      <h3>${esc(val(r.pno))} · ${esc(val(r.state_name))}</h3>
      <dl>
        <dt>เฝ้าระวัง</dt><dd>${riskHtml(risk)}</dd>
        <dt>COD / น้ำหนัก</dt><dd>${esc(Number(r.cod_amount || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 }))} / ${esc(kg(r.store_weight))}</dd>
        <dt>แผน / ถึงจริง</dt><dd>${esc(val(r.plan_leave_time))}<br>${esc(val(r.real_arrive_time))}</dd>
        <dt>แบ็กกิ้ง</dt><dd>${esc(val(r.pack_num))}</dd>
        <dt>ล่าสุด</dt><dd>${esc(val(r.LastAction_name))}<br>${esc(val(r.LastActionTime))}</dd>
        <dt>ปลายทาง</dt><dd>${esc(val(r.dst_hub_name))}<br>${esc(val(r.dst_store_name))}</dd>
        <dt>ลูกค้า</dt><dd>${esc(val(r.ka_name))}</dd>
      </dl>
    </article>`;
  }).join('');

  const pages = Math.max(1, Math.ceil(state.total / state.pageSize));
  if (hasLocalFilters()) {
    $('page-info').textContent = `หน้า ${state.page} / ${fmt.format(pages)} · พบ ${fmt.format(rows.length)} จาก ${fmt.format(state.rows.length)} ในหน้านี้ · ทั้งสาขา ${fmt.format(state.total)}`;
  } else {
    $('page-info').textContent = `หน้า ${state.page} / ${fmt.format(pages)} · แสดง ${fmt.format(rows.length)} จาก ${fmt.format(state.total)}`;
  }
  $('prev-btn').disabled = state.page <= 1;
  $('next-btn').disabled = state.page >= pages;
}

function branchOptions(selected) {
  return (state.adminBranches.length ? state.adminBranches : state.branches)
    .map((b) => `<option value="${Number(b.id)}" ${Number(b.id) === Number(selected) ? 'selected' : ''}>${esc(b.code)} · ${esc(b.name)}</option>`)
    .join('');
}

async function loadUsers() {
  $('users-status').textContent = 'กำลังอ่านรายชื่อ…';
  try {
    const out = await api('users');
    state.users = out.data?.users || [];
    state.adminBranches = out.data?.branches || [];
    $('new-user-branch').innerHTML = branchOptions(state.branchId);
    $('users-status').textContent = `ทั้งหมด ${state.users.length} บัญชี`;
    const branchMap = new Map(state.adminBranches.map((b) => [Number(b.id), b]));
    $('users-list').innerHTML = state.users.map((u) => {
      const b = branchMap.get(Number(u.branch_id));
      if (u.role === 'admin') return `<article class="user-row"><div><strong>@${esc(u.username || 'admin')}</strong><small>${esc(u.display_name || 'Owner')} · Admin · ${esc(b?.code || '-')}</small></div><span class="badge badge-ok">Admin</span></article>`;
      return `<article class="user-row user-row-edit" data-user-id="${esc(u.user_id)}"><div><strong>@${esc(u.username)}</strong><small>${esc(u.display_name || '')} · ${esc(u.access_status)} · HAR ${u.can_upload_har ? 'ได้' : 'ไม่ได้'}</small></div><div class="user-edit-controls"><select class="user-branch-select">${branchOptions(u.branch_id)}</select><label class="mini-check"><input class="user-har-check" type="checkbox" ${u.can_upload_har ? 'checked' : ''}/>HAR</label><button class="btn btn-header user-save" type="button">บันทึกสิทธิ์</button><button class="btn btn-header user-password" type="button">เปลี่ยนรหัส</button><button class="btn ${u.access_status === 'active' ? 'btn-danger' : 'btn-accent'} user-toggle" type="button" data-action="${u.access_status === 'active' ? 'disable' : 'enable'}">${u.access_status === 'active' ? 'ระงับ' : 'เปิดใช้'}</button></div></article>`;
    }).join('') || '<div class="empty-state">ยังไม่มีผู้ใช้</div>';
    bindUserActions();
  } catch (e) {
    $('users-status').textContent = `โหลดไม่สำเร็จ: ${e.message}`;
  }
}

function bindUserActions() {
  document.querySelectorAll('.user-row-edit').forEach((row) => {
    const id = row.dataset.userId;
    row.querySelector('.user-save')?.addEventListener('click', async () => {
      try {
        await api('users', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'update', userId: id, branchId: Number(row.querySelector('.user-branch-select').value), canUploadHar: row.querySelector('.user-har-check').checked }),
        });
        await loadUsers();
      } catch (e) {
        $('users-status').textContent = `ไม่สำเร็จ: ${e.message}`;
      }
    });
    row.querySelector('.user-password')?.addEventListener('click', async () => {
      const password = prompt('ตั้งรหัสผ่านใหม่อย่างน้อย 6 ตัวอักษร');
      if (!password) return;
      try {
        await api('users', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'reset_password', userId: id, password }),
        });
        $('users-status').textContent = 'เปลี่ยนรหัสผ่านแล้ว';
      } catch (e) {
        $('users-status').textContent = `ไม่สำเร็จ: ${e.message}`;
      }
    });
    row.querySelector('.user-toggle')?.addEventListener('click', async (e) => {
      const action = e.currentTarget.dataset.action;
      try {
        await api('users', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, userId: id }),
        });
        await loadUsers();
      } catch (err) {
        $('users-status').textContent = `ไม่สำเร็จ: ${err.message}`;
      }
    });
  });
}

async function loadBranches() {
  $('branches-status').textContent = 'กำลังอ่านสาขา…';
  try {
    const out = await api('branches');
    state.adminBranches = out.data?.branches || [];
    $('branches-status').textContent = `ทั้งหมด ${state.adminBranches.length} สาขา`;
    $('branches-list').innerHTML = state.adminBranches.map((b) => `<article class="user-row"><div><strong>${esc(b.code)} · ${esc(b.name)}</strong><small>${b.store_id ? `Store ${esc(b.store_id)}` : 'Store ID จะเติมจาก HAR'} · HAR ${b.has_credential ? 'พร้อม' : 'ยังไม่มี'}${b.last_error ? ` · Error: ${esc(b.last_error)}` : ''}</small></div><span class="badge ${b.has_credential ? 'badge-ok' : 'badge-neutral'}">${b.has_credential ? 'เชื่อมแล้ว' : 'รอ HAR'}</span></article>`).join('');
  } catch (e) {
    $('branches-status').textContent = `โหลดไม่สำเร็จ: ${e.message}`;
  }
}

async function refreshBranchListAndStatus(preferred = state.branchId) {
  await refreshStatus(preferred);
  await Promise.allSettled([loadSummary(true), loadPage(true)]);
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').classList.add('hidden');
  try {
    const out = await publicApi('login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: $('username').value.trim(), password: $('password').value }),
    });
    const { error } = await supabase.auth.setSession(out.data.session);
    if (error) throw error;
  } catch (err) {
    $('login-error').textContent = err.message;
    $('login-error').classList.remove('hidden');
  }
});

$('logout-btn').addEventListener('click', () => supabase.auth.signOut());
$('refresh-btn').addEventListener('click', () => Promise.allSettled([loadSummary(true), loadPage(true)]));
$('branch-select').addEventListener('change', async () => {
  const id = Number($('branch-select').value);
  if (!id || id === state.branchId) return;
  state.branchId = id;
  localStorage.setItem('ms-parcel-branch-id', String(id));
  state.page = 1;
  state.hash = '';
  state.rows = [];
  state.total = 0;
  clearTimeout(state.timer);
  clearTimeout(state.summaryTimer);
  renderRows();
  try {
    await refreshStatus(id);
    await Promise.allSettled([loadSummary(false), loadPage(false)]);
  } catch (e) {
    setConnection('bad', 'สลับสาขาไม่สำเร็จ');
  }
});

document.querySelectorAll('.smart-filter').forEach((button) => {
  button.addEventListener('click', () => {
    state.smartFilter = button.dataset.risk || 'all';
    renderRows();
  });
});
$('risk-sort').addEventListener('change', () => {
  state.sortRisk = $('risk-sort').checked;
  renderRows();
});
// Full-inventory copy is owned by ops.js; never fall back to live rows.

$('manage-users-btn').addEventListener('click', () => { $('users-dialog').showModal(); loadUsers(); });
$('users-close').addEventListener('click', () => $('users-dialog').close());
$('users-refresh').addEventListener('click', loadUsers);
$('create-user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  $('users-status').textContent = 'กำลังสร้างผู้ใช้…';
  try {
    await api('users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create', username: $('new-username').value.trim(), displayName: $('new-display-name').value.trim(),
        password: $('new-password').value, branchId: Number($('new-user-branch').value), canUploadHar: $('new-can-upload-har').checked,
      }),
    });
    form.reset();
    $('new-user-branch').innerHTML = branchOptions(state.branchId);
    await loadUsers();
    $('users-status').textContent = 'สร้างผู้ใช้สำเร็จ';
  } catch (err) {
    $('users-status').textContent = `สร้างไม่สำเร็จ: ${err.message}`;
  }
});

$('manage-branches-btn').addEventListener('click', () => { $('branches-dialog').showModal(); loadBranches(); });
$('branches-close').addEventListener('click', () => $('branches-dialog').close());
$('branches-refresh').addEventListener('click', loadBranches);
$('create-branch-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  $('branches-status').textContent = 'กำลังเพิ่มสาขา…';
  try {
    const out = await api('branches', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create', code: $('new-branch-code').value.trim(), name: $('new-branch-name').value.trim() }),
    });
    form.reset();
    await loadBranches();
    await refreshStatus(Number(out.data?.branch?.id || state.branchId));
    $('branches-status').textContent = 'เพิ่มสาขาแล้ว · Store ID จะเติมจาก HAR เมื่ออัปโหลด';
  } catch (err) {
    $('branches-status').textContent = `เพิ่มไม่สำเร็จ: ${err.message}`;
  }
});

$('upload-har-btn').addEventListener('click', () => {
  const b = currentBranch();
  $('har-branch-note').textContent = `HAR นี้จะอัปเดตเฉพาะ ${b?.code || ''} · ${b?.name || ''}`;
  $('har-status').textContent = '';
  $('har-dialog').showModal();
});
$('har-close').addEventListener('click', () => $('har-dialog').close());
$('har-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = $('har-file').files?.[0];
  if (!file) return;
  $('har-status').textContent = 'กำลังตรวจ HAR…';
  try {
    const text = await file.text();
    const out = await api(branchQuery('har'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text });
    $('har-status').textContent = `สำเร็จ · Store ${out.data.storeId}`;
    state.hash = '';
    state.rows = [];
    state.total = 0;
    await refreshBranchListAndStatus(branchId());
  } catch (err) {
    $('har-status').textContent = `ไม่สำเร็จ: ${err.message}`;
  }
});

['search-input', 'status-filter', 'hub-filter', 'branch-filter'].forEach((id) => {
  $(id).addEventListener(id === 'search-input' ? 'input' : 'change', renderRows);
});
$('page-size').addEventListener('change', () => {
  state.pageSize = Number($('page-size').value);
  state.page = 1;
  state.hash = '';
  state.rows = [];
  state.total = 0;
  renderRows();
  loadPage(false);
});
$('prev-btn').addEventListener('click', () => {
  if (state.page > 1) {
    state.page -= 1;
    state.hash = '';
    state.rows = [];
    renderRows();
    loadPage(false);
  }
});
$('next-btn').addEventListener('click', () => {
  state.page += 1;
  state.hash = '';
  state.rows = [];
  renderRows();
  loadPage(false);
});

document.addEventListener('visibilitychange', () => {
  clearTimeout(state.timer);
  clearTimeout(state.summaryTimer);
  if (state.session && state.accessStatus === 'active' && branchId()) {
    if (document.hidden) {
      scheduleLive(60000);
      scheduleSummary(60000);
    } else {
      scheduleLive(300);
      scheduleSummary(500);
    }
  }
});

boot();

