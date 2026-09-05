const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('th-TH');
const PAGE_IDS = new Set(['dashboard', 'parcels', 'status', 'backlog', 'weight', 'bagging']);
const TIME_BANDS = [
  ['under3', '<3 ชม.'],
  ['3to6', '3–6 ชม.'],
  ['6to9', '6–9 ชม.'],
  ['9to12', '9–12 ชม.'],
  ['12to16', '12–16 ชม.'],
  ['16to22', '16–22 ชม.'],
  ['22to24', '22–24 ชม.'],
  ['24to48', '24–48 ชม.'],
  ['over48', '>48 ชม.'],
];

const shellState = {
  page: 'dashboard',
  selectedBands: new Set(TIME_BANDS.map(([key]) => key)),
  scheduled: false,
};

const text = (el) => String(el?.textContent ?? '').trim();
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

function parseMsTime(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '-' || raw === '--') return NaN;
  let normalized = raw;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(raw) && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    normalized = raw.replace(' ', 'T') + '+07:00';
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function cleanDestination(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return raw.replace(/^\s*(?:(?:\([^)]*\)|（[^）]*）)\s*)+/, '').trim() || raw;
}

function ageBand(hours) {
  if (hours === null) return 'unknown';
  if (hours < 3) return 'under3';
  if (hours < 6) return '3to6';
  if (hours < 9) return '6to9';
  if (hours < 12) return '9to12';
  if (hours < 16) return '12to16';
  if (hours < 22) return '16to22';
  if (hours < 24) return '22to24';
  if (hours <= 48) return '24to48';
  return 'over48';
}

function bandLabel(key) {
  if (key === 'unknown') return 'อายุไม่ทราบ';
  return TIME_BANDS.find(([band]) => band === key)?.[1] || key;
}

function parseRows(now = Date.now()) {
  return [...document.querySelectorAll('#table-body tr')].map((tr, index) => {
    const c = tr.cells;
    const plan = text(c[4]?.querySelector('.cell-stack > span'));
    const arrived = text(c[4]?.querySelector('.cell-stack > small'));
    const planAt = parseMsTime(plan);
    const arrivedAt = parseMsTime(arrived);
    const ageHours = Number.isFinite(arrivedAt) && now >= arrivedAt ? (now - arrivedAt) / 3600000 : null;
    const hub = cleanDestination(text(c[9]?.querySelector('.cell-stack > span')));
    const branch = cleanDestination(text(c[9]?.querySelector('.cell-stack > small')));
    const packRaw = text(c[5]);
    return {
      tr,
      index,
      pno: text(c[0]),
      status: text(c[1]),
      plan,
      arrived,
      band: ageBand(ageHours),
      planOverdue: Number.isFinite(planAt) && now > planAt,
      pack: packRaw && packRaw !== '-' && packRaw !== '--' ? packRaw : '',
      latestAction: text(c[7]?.querySelector('.cell-stack > span')) || '-',
      hub: hub || '-',
      branch: branch || '-',
      destination: [hub, branch].filter(Boolean).join(' / ') || '-',
    };
  }).filter((row) => row.pno);
}

function loadSelection() {
  try {
    const raw = JSON.parse(localStorage.getItem('ms-dashboard-time-bands') || 'null');
    if (Array.isArray(raw)) {
      shellState.selectedBands = new Set(raw.filter((key) => TIME_BANDS.some(([band]) => band === key)));
    }
  } catch (_) {}
}

function saveSelection() {
  try {
    localStorage.setItem('ms-dashboard-time-bands', JSON.stringify([...shellState.selectedBands]));
  } catch (_) {}
}

function isAllSelected() {
  return shellState.selectedBands.size === TIME_BANDS.length;
}

function selectedLabels() {
  return TIME_BANDS.filter(([key]) => shellState.selectedBands.has(key)).map(([, label]) => label);
}

function actionFilter() {
  return String($('ops-action-filter')?.value || '');
}

function updateTimeControls() {
  document.querySelectorAll('[data-dashboard-band]').forEach((input) => {
    input.checked = shellState.selectedBands.has(input.dataset.dashboardBand);
  });
  const summary = isAllSelected()
    ? 'ทั้งหมด'
    : selectedLabels().length
      ? selectedLabels().join(' + ')
      : 'ไม่ได้เลือก';
  if ($('dashboard-time-selected')) $('dashboard-time-selected').textContent = summary;
  if ($('backlog-time-label')) $('backlog-time-label').textContent = summary;
}

function renderSummaryList(id, entries, total, max = 12) {
  const el = $(id);
  if (!el) return;
  const rows = entries.slice(0, max);
  if (!rows.length) {
    el.innerHTML = '<div class="summary-empty">-</div>';
    return;
  }
  el.innerHTML = rows.map(([label, count]) => {
    const pct = total ? Math.max(3, Math.round((count / total) * 100)) : 0;
    return `<div class="summary-row"><div><span>${esc(label)}</span><strong>${fmt.format(count)}</strong></div><i><b style="width:${pct}%"></b></i></div>`;
  }).join('');
}

function countBy(rows, getter) {
  const map = new Map();
  for (const row of rows) {
    const key = String(getter(row) || '-').trim() || '-';
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'th'));
}

function fullData() {
  const data = window.__MS_FULL_ANALYTICS;
  return data?.complete && Array.isArray(data.cells) ? data : null;
}

function fullCells({ ignoreTime = false } = {}) {
  const data = fullData();
  if (!data) return [];
  const lh = String($('hub-filter')?.value || '');
  const fd = String($('branch-filter')?.value || '');
  const action = actionFilter();
  return data.cells.filter((cell) => {
    if (!ignoreTime && !isAllSelected() && !shellState.selectedBands.has(cell.b)) return false;
    if (lh && (cell.r !== 'lh' || cell.d !== lh)) return false;
    if (fd && (cell.r !== 'fd' || cell.d !== fd)) return false;
    if (action && cell.a !== action) return false;
    return true;
  });
}

function aggregate(cells, getter) {
  const map = new Map();
  for (const cell of cells) {
    const key = String(getter(cell) || '-');
    map.set(key, (map.get(key) || 0) + Number(cell.c || 0));
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'th'));
}

function fullMetrics(cells) {
  return cells.reduce((out, cell) => {
    out.count += Number(cell.c || 0);
    out.bagged += Number(cell.g || 0);
    out.overdue += Number(cell.o || 0);
    out.critical += Number(cell.q || 0);
    return out;
  }, { count: 0, bagged: 0, overdue: 0, critical: 0 });
}

function renderFullDashboard(data) {
  const cells = fullCells();
  const metrics = fullMetrics(cells);
  const baseBandCells = fullCells({ ignoreTime: true });
  const bandCounts = new Map(TIME_BANDS.map(([key]) => [key, 0]));
  for (const cell of baseBandCells) {
    if (bandCounts.has(cell.b)) bandCounts.set(cell.b, (bandCounts.get(cell.b) || 0) + Number(cell.c || 0));
  }
  document.querySelectorAll('[data-band-count]').forEach((el) => {
    el.textContent = fmt.format(bandCounts.get(el.dataset.bandCount) || 0);
  });
  if ($('dash-loaded')) $('dash-loaded').textContent = fmt.format(Number(data.total || 0));
  if ($('dash-selected')) $('dash-selected').textContent = fmt.format(metrics.count);
  if ($('dash-over-plan')) $('dash-over-plan').textContent = fmt.format(metrics.overdue);
  if ($('dash-bagged')) $('dash-bagged').textContent = fmt.format(metrics.bagged);
  if ($('dash-critical')) $('dash-critical').textContent = fmt.format(metrics.critical);
  if ($('dashboard-selection-note')) $('dashboard-selection-note').textContent = `${fmt.format(metrics.count)} / ${fmt.format(Number(data.total || 0))} รายการ`;
  renderSummaryList('dashboard-time-summary', TIME_BANDS.map(([key, label]) => [label, bandCounts.get(key) || 0]), Number(data.total || 0), TIME_BANDS.length);
  renderSummaryList('dashboard-hub-summary', aggregate(cells.filter((cell) => cell.r === 'lh'), (cell) => cell.d), metrics.count);
  renderSummaryList('dashboard-branch-summary', aggregate(cells.filter((cell) => cell.r === 'fd'), (cell) => cell.d), metrics.count);
  renderSummaryList('dashboard-action-summary', aggregate(cells, (cell) => cell.a), metrics.count);
}

function renderPageDashboard() {
  const data = fullData();
  if (data) {
    renderFullDashboard(data);
    updateTimeControls();
    applySelectedTimeFilter();
    return;
  }

  const rows = parseRows();
  const action = actionFilter();
  const base = action ? rows.filter((row) => row.latestAction === action) : rows;
  const selected = isAllSelected() ? base : base.filter((row) => shellState.selectedBands.has(row.band));
  const totalFull = Number(String(text($('m-total'))).replace(/,/g, '')) || 0;
  const overPlan = selected.filter((row) => row.planOverdue).length;
  const bagged = selected.filter((row) => row.pack).length;
  const critical = selected.filter((row) => row.band === 'over48' && row.planOverdue).length;

  if ($('dash-loaded')) $('dash-loaded').textContent = fmt.format(totalFull);
  if ($('dash-selected')) $('dash-selected').textContent = fmt.format(selected.length);
  if ($('dash-over-plan')) $('dash-over-plan').textContent = fmt.format(overPlan);
  if ($('dash-bagged')) $('dash-bagged').textContent = fmt.format(bagged);
  if ($('dash-critical')) $('dash-critical').textContent = fmt.format(critical);

  const bandCounts = new Map(TIME_BANDS.map(([key]) => [key, 0]));
  for (const row of base) {
    if (bandCounts.has(row.band)) bandCounts.set(row.band, (bandCounts.get(row.band) || 0) + 1);
  }
  document.querySelectorAll('[data-band-count]').forEach((el) => {
    el.textContent = fmt.format(bandCounts.get(el.dataset.bandCount) || 0);
  });
  if ($('dashboard-selection-note')) {
    $('dashboard-selection-note').textContent = selected.length ? `${fmt.format(selected.length)} รายการ` : '-';
  }
  renderSummaryList('dashboard-time-summary', TIME_BANDS.map(([key, label]) => [label, bandCounts.get(key) || 0]), base.length, TIME_BANDS.length);
  renderSummaryList('dashboard-hub-summary', countBy(selected, (row) => row.hub), selected.length);
  renderSummaryList('dashboard-branch-summary', countBy(selected, (row) => row.branch), selected.length);
  renderSummaryList('dashboard-action-summary', countBy(selected, (row) => row.latestAction), selected.length);
  updateTimeControls();
  applySelectedTimeFilter();
}

function applySelectedTimeFilter() {
  const rows = parseRows();
  const active = shellState.page !== 'dashboard' && !isAllSelected();
  const action = actionFilter();
  const cards = [...document.querySelectorAll('#mobile-cards .mobile-card')];
  rows.forEach((row) => {
    const hidden = (active && !shellState.selectedBands.has(row.band)) || (action && row.latestAction !== action);
    row.tr.classList.toggle('dashboard-time-hidden', hidden);
    cards[row.index]?.classList.toggle('dashboard-time-hidden', hidden);
  });
  $('backlog-time-banner')?.classList.toggle('hidden', !(shellState.page === 'backlog' && active));
}

function moveResults(page) {
  const panel = $('results-panel');
  if (!panel) return;
  const slot = page === 'backlog' ? $('backlog-results-slot') : page === 'parcels' ? $('parcels-results-slot') : null;
  if (slot && panel.parentElement !== slot) slot.appendChild(panel);
}

function setPage(nextPage, { updateHash = true } = {}) {
  const page = PAGE_IDS.has(nextPage) ? nextPage : 'dashboard';
  const target = document.querySelector(`[data-page-view="${page}"]`);
  if (!target && (page === 'status' || page === 'weight')) {
    shellState.page = page;
    document.querySelectorAll('[data-page-nav]').forEach((button) => button.classList.toggle('active', button.dataset.pageNav === page));
    return;
  }
  shellState.page = page;
  document.querySelectorAll('[data-page-view]').forEach((section) => {
    section.classList.toggle('hidden', section.dataset.pageView !== page);
  });
  document.querySelectorAll('[data-page-nav]').forEach((button) => {
    button.classList.toggle('active', button.dataset.pageNav === page);
  });
  moveResults(page);
  if (updateHash && location.hash !== `#${page}`) history.replaceState(null, '', `#${page}`);
  applySelectedTimeFilter();
  renderPageDashboard();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

async function copySelectedSummary() {
  const data = fullData();
  if (data) {
    const cells = fullCells();
    const metrics = fullMetrics(cells);
    const labels = Object.fromEntries(TIME_BANDS);
    labels.unknown = 'อายุไม่ทราบ';
    const lines = [
      `MS Parcel Live · ${text($('branch-select')?.selectedOptions?.[0]) || '-'}`,
      `ช่วงเวลา: ${isAllSelected() ? 'ทั้งหมด' : selectedLabels().join(', ')}`,
      `รวม ${fmt.format(metrics.count)} รายการ`,
      '', 'ช่วงเวลา',
      ...aggregate(cells, (cell) => cell.b).map(([key, count]) => `- ${labels[key] || key}: ${fmt.format(count)}`),
      '', 'LH ปลายทาง',
      ...aggregate(cells.filter((cell) => cell.r === 'lh'), (cell) => cell.d).map(([name, count]) => `- ${name}: ${fmt.format(count)}`),
      '', 'FD ปลายทาง',
      ...aggregate(cells.filter((cell) => cell.r === 'fd'), (cell) => cell.d).map(([name, count]) => `- ${name}: ${fmt.format(count)}`),
      '', 'การดำเนินการล่าสุด',
      ...aggregate(cells, (cell) => cell.a).map(([name, count]) => `- ${name}: ${fmt.format(count)}`),
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      if ($('dashboard-copy-status')) $('dashboard-copy-status').textContent = `คัดลอก ${fmt.format(metrics.count)} รายการแล้ว`;
    } catch (_) {
      if ($('dashboard-copy-status')) $('dashboard-copy-status').textContent = 'คัดลอกไม่สำเร็จ';
    }
    return;
  }

  const rows = parseRows().filter((row) => isAllSelected() || shellState.selectedBands.has(row.band));
  if (!rows.length) {
    if ($('dashboard-copy-status')) $('dashboard-copy-status').textContent = 'ยังไม่มีรายการ';
    return;
  }
  const lines = [
    `MS Parcel Live · ${text($('branch-select')?.selectedOptions?.[0]) || '-'}`,
    `รวม ${fmt.format(rows.length)} รายการ`,
    ...rows.map((row, index) => `${index + 1}. ${row.pno} | ${bandLabel(row.band)} | ${row.latestAction} | ${row.destination}`),
  ];
  try {
    await navigator.clipboard.writeText(lines.join('\n'));
    if ($('dashboard-copy-status')) $('dashboard-copy-status').textContent = `คัดลอก ${fmt.format(rows.length)} รายการแล้ว`;
  } catch (_) {}
}

function scheduleDashboardRender() {
  if (shellState.scheduled) return;
  shellState.scheduled = true;
  requestAnimationFrame(() => {
    shellState.scheduled = false;
    try { renderPageDashboard(); } catch (error) { console.error('[shell render]', error); }
  });
}

function bindCoreEvents() {
  document.querySelectorAll('[data-page-nav]').forEach((button) => {
    button.addEventListener('click', () => setPage(button.dataset.pageNav));
  });
  window.addEventListener('hashchange', () => setPage(location.hash.slice(1), { updateHash: false }));
  document.querySelectorAll('[data-dashboard-band]').forEach((input) => {
    input.addEventListener('change', () => {
      const key = input.dataset.dashboardBand;
      if (input.checked) shellState.selectedBands.add(key);
      else shellState.selectedBands.delete(key);
      saveSelection();
      renderPageDashboard();
    });
  });
  $('dashboard-time-all')?.addEventListener('click', () => {
    shellState.selectedBands = new Set(TIME_BANDS.map(([key]) => key));
    saveSelection();
    renderPageDashboard();
  });
  $('dashboard-time-clear')?.addEventListener('click', () => {
    shellState.selectedBands.clear();
    saveSelection();
    renderPageDashboard();
  });
  $('dashboard-copy-selected')?.addEventListener('click', () => void copySelectedSummary());
  $('dashboard-open-selected')?.addEventListener('click', () => setPage('backlog'));
  $('backlog-time-clear')?.addEventListener('click', () => {
    shellState.selectedBands = new Set(TIME_BANDS.map(([key]) => key));
    saveSelection();
    renderPageDashboard();
  });
  window.addEventListener('ms-full-analytics', scheduleDashboardRender);
  document.addEventListener('change', (event) => {
    if (event.target?.id === 'ops-action-filter' || event.target?.id === 'hub-filter' || event.target?.id === 'branch-filter') {
      scheduleDashboardRender();
    }
  });
}

function loadOptionalModules() {
  import('./ops.js?v=20260906-2')
    .then(() => {
      const pending = shellState.page;
      if (pending === 'status' || pending === 'weight') setPage(pending, { updateHash: false });
      scheduleDashboardRender();
    })
    .catch((error) => console.error('[ops module]', error));

  import('./analytics-client.js?v=20260906-2')
    .catch((error) => console.error('[analytics module]', error));
}

function init() {
  loadSelection();
  bindCoreEvents();
  const tbody = $('table-body');
  if (tbody) new MutationObserver(scheduleDashboardRender).observe(tbody, { childList: true });
  const initial = PAGE_IDS.has(location.hash.slice(1)) ? location.hash.slice(1) : 'dashboard';
  setPage(initial, { updateHash: true });
  renderPageDashboard();
  window.__MS_NAV_READY = true;
  setTimeout(loadOptionalModules, 0);
  setInterval(() => {
    if (!document.hidden) scheduleDashboardRender();
  }, 60000);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
