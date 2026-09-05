import './ops.js?v=20260905-3';

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('th-TH');

const PAGE_IDS = new Set(['dashboard', 'parcels', 'status', 'backlog', 'weight', 'bagging']);
const TIME_BANDS = [
  ['under3', '<3 ชม.'], ['3to6', '3–6 ชม.'], ['6to9', '6–9 ชม.'], ['9to12', '9–12 ชม.'],
  ['12to16', '12–16 ชม.'], ['16to22', '16–22 ชม.'], ['22to24', '22–24 ชม.'], ['24to48', '24–48 ชม.'], ['over48', '>48 ชม.'],
];
const shellState = { page: 'dashboard', selectedBands: new Set(TIME_BANDS.map(([key]) => key)), scheduled: false };
const text = (el) => String(el?.textContent ?? '').trim();

function parseMsTime(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '-' || raw === '--') return NaN;
  let normalized = raw;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(raw) && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) normalized = raw.replace(' ', 'T') + '+07:00';
  const n = Date.parse(normalized);
  return Number.isFinite(n) ? n : NaN;
}
function cleanDestination(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return raw.replace(/^\s*(?:(?:\([^)]*\)|（[^）]*）)\s*)+/, '').trim() || raw;
}
function ageBand(h) {
  if (h === null) return 'unknown';
  if (h < 3) return 'under3'; if (h < 6) return '3to6'; if (h < 9) return '6to9'; if (h < 12) return '9to12';
  if (h < 16) return '12to16'; if (h < 22) return '16to22'; if (h < 24) return '22to24'; if (h <= 48) return '24to48'; return 'over48';
}
function bandLabel(key) { return key === 'unknown' ? 'อายุไม่ทราบ' : TIME_BANDS.find(([band]) => band === key)?.[1] || key; }

function parseRows(now = Date.now()) {
  return [...document.querySelectorAll('#table-body tr')].map((tr, index) => {
    const c = tr.cells;
    const plan = text(c[4]?.querySelector('.cell-stack > span'));
    const arrived = text(c[4]?.querySelector('.cell-stack > small'));
    const planAt = parseMsTime(plan), arrivedAt = parseMsTime(arrived);
    const ageHours = Number.isFinite(arrivedAt) && now >= arrivedAt ? (now - arrivedAt) / 3600000 : null;
    const hub = cleanDestination(text(c[9]?.querySelector('.cell-stack > span')));
    const branch = cleanDestination(text(c[9]?.querySelector('.cell-stack > small')));
    const packRaw = text(c[5]);
    return {
      tr, index, pno: text(c[0]), status: text(c[1]), plan, arrived, ageHours, band: ageBand(ageHours),
      planOverdue: Number.isFinite(planAt) && now > planAt,
      pack: packRaw && packRaw !== '-' && packRaw !== '--' ? packRaw : '',
      latestAction: text(c[7]?.querySelector('.cell-stack > span')) || '-', latestTime: text(c[7]?.querySelector('.cell-stack > small')),
      hub: hub || '-', branch: branch || '-', destination: [hub, branch].filter(Boolean).join(' / ') || '-',
    };
  });
}

function loadSelection() {
  try {
    const raw = JSON.parse(localStorage.getItem('ms-dashboard-time-bands') || 'null');
    if (Array.isArray(raw)) shellState.selectedBands = new Set(raw.filter((key) => TIME_BANDS.some(([band]) => band === key)));
  } catch (_) {}
}
function saveSelection() { localStorage.setItem('ms-dashboard-time-bands', JSON.stringify([...shellState.selectedBands])); }
function selectedLabels() { return TIME_BANDS.filter(([key]) => shellState.selectedBands.has(key)).map(([, label]) => label); }
function isAllSelected() { return shellState.selectedBands.size === TIME_BANDS.length; }
function actionFilter() { return String($('ops-action-filter')?.value || ''); }

function isSourceHubLabel(value) {
  const raw = cleanDestination(value); if (!raw) return false;
  const label = text($('branch-select')?.selectedOptions?.[0]);
  const [codePart, ...rest] = label.split('·');
  const code = String(codePart || '').trim().toUpperCase();
  const source = cleanDestination(rest.join('·')).toUpperCase().replace(/^\d+\s*/, '').replace(/\s+/g, ' ').trim();
  const dest = raw.toUpperCase().replace(/^\d+\s*/, '').replace(/\s+/g, ' ').trim();
  if (source && source === dest) return true;
  if (!code) return false;
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Z0-9])${escaped}(?:_HUB)?([^A-Z0-9]|$)`, 'i').test(raw.toUpperCase());
}

function updateTimeControls() {
  document.querySelectorAll('[data-dashboard-band]').forEach((input) => { input.checked = shellState.selectedBands.has(input.dataset.dashboardBand); });
  const labels = selectedLabels();
  const summary = isAllSelected() ? 'ทั้งหมด' : labels.length ? labels.join(' + ') : 'ไม่ได้เลือก';
  if ($('dashboard-time-selected')) $('dashboard-time-selected').textContent = summary;
  if ($('backlog-time-label')) $('backlog-time-label').textContent = summary;
}
function countBy(rows, getter) {
  const map = new Map();
  for (const row of rows) { const key = String(getter(row) || '-').trim() || '-'; map.set(key, (map.get(key) || 0) + 1); }
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'th'));
}
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
function renderSummaryList(id, entries, total, max = 8) {
  const el = $(id); if (!el) return;
  const rows = entries.slice(0, max);
  if (!rows.length) { el.innerHTML = '<div class="summary-empty">-</div>'; return; }
  el.innerHTML = rows.map(([label, count]) => {
    const pct = total ? Math.max(3, Math.round((count / total) * 100)) : 0;
    return `<div class="summary-row"><div><span>${escapeHtml(label)}</span><strong>${fmt.format(count)}</strong></div><i><b style="width:${pct}%"></b></i></div>`;
  }).join('');
}
function normalizeDestinationSelectLabels() {
  for (const id of ['hub-filter', 'branch-filter']) {
    const select = $(id); if (!select) continue;
    [...select.options].forEach((option, index) => { if (index) option.textContent = cleanDestination(option.value) || option.value; });
  }
}
function dashboardBaseRows() {
  const action = actionFilter();
  return parseRows().filter((row) => !action || row.latestAction === action);
}
function timeSelectedRows(rows) { return isAllSelected() ? rows : rows.filter((row) => shellState.selectedBands.has(row.band)); }

function renderDashboard() {
  const baseRows = dashboardBaseRows();
  const selected = timeSelectedRows(baseRows);
  const unknown = baseRows.filter((row) => row.band === 'unknown').length;
  const overPlan = selected.filter((row) => row.planOverdue).length;
  const bagged = selected.filter((row) => row.pack).length;
  const critical = selected.filter((row) => row.band === 'over48' && row.planOverdue).length;

  if ($('dash-loaded')) $('dash-loaded').textContent = fmt.format(baseRows.length);
  if ($('dash-selected')) $('dash-selected').textContent = fmt.format(selected.length);
  if ($('dash-over-plan')) $('dash-over-plan').textContent = fmt.format(overPlan);
  if ($('dash-bagged')) $('dash-bagged').textContent = fmt.format(bagged);
  if ($('dash-critical')) $('dash-critical').textContent = fmt.format(critical);

  const bandCounts = new Map(TIME_BANDS.map(([key]) => [key, 0]));
  for (const row of baseRows) if (bandCounts.has(row.band)) bandCounts.set(row.band, bandCounts.get(row.band) + 1);
  document.querySelectorAll('[data-band-count]').forEach((el) => { el.textContent = fmt.format(bandCounts.get(el.dataset.bandCount) || 0); });
  if ($('dashboard-selection-note')) $('dashboard-selection-note').textContent = `${fmt.format(selected.length)} / ${fmt.format(baseRows.length)} รายการ${unknown ? ` · ไม่ทราบอายุ ${fmt.format(unknown)}` : ''}`;

  const timeEntries = TIME_BANDS.map(([key, label]) => [label, bandCounts.get(key) || 0]);
  const lhRows = selected.filter((row) => !isSourceHubLabel(row.hub));
  renderSummaryList('dashboard-time-summary', timeEntries, baseRows.length, TIME_BANDS.length);
  renderSummaryList('dashboard-hub-summary', countBy(lhRows, (row) => row.hub), lhRows.length);
  renderSummaryList('dashboard-branch-summary', countBy(selected, (row) => row.branch), selected.length);
  renderSummaryList('dashboard-action-summary', countBy(selected, (row) => row.latestAction), selected.length);
  updateTimeControls(); normalizeDestinationSelectLabels(); applySelectedTimeFilter();
}

function applySelectedTimeFilter() {
  const rows = parseRows(), timeActive = shellState.page !== 'dashboard' && !isAllSelected(), action = actionFilter();
  rows.forEach((row) => {
    const hide = (timeActive && !shellState.selectedBands.has(row.band)) || (!!action && row.latestAction !== action);
    row.tr.classList.toggle('dashboard-time-hidden', hide);
  });
  const cards = [...document.querySelectorAll('#mobile-cards .mobile-card')];
  rows.forEach((row) => {
    const hide = (timeActive && !shellState.selectedBands.has(row.band)) || (!!action && row.latestAction !== action);
    cards[row.index]?.classList.toggle('dashboard-time-hidden', hide);
  });
  $('backlog-time-banner')?.classList.toggle('hidden', !(shellState.page === 'backlog' && timeActive));
}
function selectedRows(now = Date.now()) {
  const action = actionFilter();
  const base = parseRows(now).filter((row) => !action || row.latestAction === action);
  return isAllSelected() ? base : base.filter((row) => shellState.selectedBands.has(row.band));
}

async function copySelectedSummary() {
  const now = Date.now();
  if (!shellState.selectedBands.size) { if ($('dashboard-copy-status')) $('dashboard-copy-status').textContent = 'เลือกช่วงเวลาก่อน'; return; }
  const rows = selectedRows(now);
  if (!rows.length) { if ($('dashboard-copy-status')) $('dashboard-copy-status').textContent = 'ไม่มีรายการ'; return; }
  const bandCounts = new Map(TIME_BANDS.map(([key]) => [key, 0])), hubs = new Map(), branches = new Map();
  let unknown = 0;
  for (const row of rows) {
    if (bandCounts.has(row.band)) bandCounts.set(row.band, (bandCounts.get(row.band) || 0) + 1); else unknown += 1;
    if (!isSourceHubLabel(row.hub)) hubs.set(row.hub, (hubs.get(row.hub) || 0) + 1);
    branches.set(row.branch, (branches.get(row.branch) || 0) + 1);
  }
  const branchText = text($('branch-select')?.selectedOptions?.[0]) || '-';
  const lines = [
    `MS Parcel Live · ${branchText}`, `ช่วงเวลา: ${isAllSelected() ? 'ทั้งหมด' : selectedLabels().join(', ')}`, `รวม ${fmt.format(rows.length)} รายการ · ${new Date(now).toLocaleString('th-TH')}`, '',
    'ช่วงเวลา', ...TIME_BANDS.filter(([key]) => shellState.selectedBands.has(key)).map(([key, label]) => `- ${label}: ${fmt.format(bandCounts.get(key) || 0)}`), ...(unknown ? [`- อายุไม่ทราบ: ${fmt.format(unknown)}`] : []), '',
    'LH ปลายทาง', ...[...hubs.entries()].sort((a,b) => b[1]-a[1]).map(([name,count]) => `- ${name}: ${fmt.format(count)}`), '',
    'FD ปลายทาง', ...[...branches.entries()].sort((a,b) => b[1]-a[1]).map(([name,count]) => `- ${name}: ${fmt.format(count)}`), '',
    'รายการ', ...rows.map((row,i) => `${i+1}. ${row.pno} | ${bandLabel(row.band)} | ${row.planOverdue ? 'เกินเวลาแผน' : 'ตามเวลาแผน'} | ${row.pack ? `แบ็ก ${row.pack}` : 'ไม่มีแบ็ก'} | ${row.latestAction} | ${row.destination}`),
  ];
  try {
    const output = lines.join('\n');
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(output);
    else { const ta = document.createElement('textarea'); ta.value = output; ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    if ($('dashboard-copy-status')) $('dashboard-copy-status').textContent = `คัดลอก ${fmt.format(rows.length)} รายการแล้ว`;
  } catch (_) { if ($('dashboard-copy-status')) $('dashboard-copy-status').textContent = 'คัดลอกไม่สำเร็จ'; }
}

function clearDashboardOnlyFilters() {
  let changed = false;
  if ($('search-input')?.value) { $('search-input').value = ''; changed = true; }
  if ($('status-filter')?.value) { $('status-filter').value = ''; changed = true; }
  if (changed) $('search-input')?.dispatchEvent(new Event('input', { bubbles: true }));
}
function resetPageFiltersFor(page) {
  if (page === 'dashboard') { clearDashboardOnlyFilters(); $('bag-reset-btn')?.click(); document.querySelector('.smart-filter[data-risk="all"]')?.click(); }
  else if (page === 'parcels' || page === 'status' || page === 'weight') { $('bag-reset-btn')?.click(); document.querySelector('.smart-filter[data-risk="all"]')?.click(); }
  else if (page === 'backlog') $('bag-reset-btn')?.click();
  else if (page === 'bagging') document.querySelector('.smart-filter[data-risk="all"]')?.click();
}
function moveResults(page) {
  const panel = $('results-panel'); if (!panel) return;
  const slot = page === 'backlog' ? $('backlog-results-slot') : page === 'parcels' ? $('parcels-results-slot') : null;
  if (slot && panel.parentElement !== slot) slot.appendChild(panel);
}
function setPage(nextPage, { updateHash = true, resetFilters = true } = {}) {
  const page = PAGE_IDS.has(nextPage) ? nextPage : 'dashboard'; shellState.page = page;
  if (resetFilters) resetPageFiltersFor(page);
  document.querySelectorAll('[data-page-view]').forEach((section) => section.classList.toggle('hidden', section.dataset.pageView !== page));
  document.querySelectorAll('[data-page-nav]').forEach((button) => button.classList.toggle('active', button.dataset.pageNav === page));
  moveResults(page);
  if (updateHash && location.hash !== `#${page}`) history.replaceState(null, '', `#${page}`);
  applySelectedTimeFilter(); renderDashboard(); window.scrollTo({ top: 0, behavior: 'auto' });
}
function scheduleDashboardRender() { if (shellState.scheduled) return; shellState.scheduled = true; requestAnimationFrame(() => { shellState.scheduled = false; renderDashboard(); }); }

function bindEvents() {
  document.querySelectorAll('[data-page-nav]').forEach((button) => button.addEventListener('click', () => setPage(button.dataset.pageNav)));
  window.addEventListener('hashchange', () => setPage(location.hash.slice(1), { updateHash: false }));
  document.querySelectorAll('[data-dashboard-band]').forEach((input) => input.addEventListener('change', () => {
    const key = input.dataset.dashboardBand; if (input.checked) shellState.selectedBands.add(key); else shellState.selectedBands.delete(key); saveSelection(); renderDashboard();
  }));
  $('dashboard-time-all')?.addEventListener('click', () => { shellState.selectedBands = new Set(TIME_BANDS.map(([key]) => key)); saveSelection(); renderDashboard(); });
  $('dashboard-time-clear')?.addEventListener('click', () => { shellState.selectedBands.clear(); saveSelection(); renderDashboard(); });
  $('dashboard-copy-selected')?.addEventListener('click', () => void copySelectedSummary());
  $('dashboard-open-selected')?.addEventListener('click', () => { if (!shellState.selectedBands.size) { if ($('dashboard-copy-status')) $('dashboard-copy-status').textContent = 'เลือกช่วงเวลาก่อน'; return; } setPage('backlog', { resetFilters: false }); });
  $('backlog-time-clear')?.addEventListener('click', () => { shellState.selectedBands = new Set(TIME_BANDS.map(([key]) => key)); saveSelection(); renderDashboard(); });
  for (const id of ['hub-filter', 'branch-filter', 'ops-action-filter']) $(id)?.addEventListener('change', () => { scheduleDashboardRender(); applySelectedTimeFilter(); });
}
function init() {
  loadSelection(); bindEvents();
  const tbody = $('table-body'); if (tbody) new MutationObserver(scheduleDashboardRender).observe(tbody, { childList: true });
  for (const id of ['hub-filter', 'branch-filter']) { const select = $(id); if (select) new MutationObserver(() => { normalizeDestinationSelectLabels(); scheduleDashboardRender(); }).observe(select, { childList: true }); }
  const initial = PAGE_IDS.has(location.hash.slice(1)) ? location.hash.slice(1) : 'dashboard';
  setPage(initial, { updateHash: true, resetFilters: false }); renderDashboard();
  setInterval(() => { if (!document.hidden) renderDashboard(); }, 60000);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
