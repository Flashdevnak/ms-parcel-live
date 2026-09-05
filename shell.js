const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('th-TH');

const PAGE_IDS = new Set(['dashboard', 'parcels', 'backlog', 'bagging']);
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
  useSelectedAsFilter: false,
  scheduled: false,
};

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

function cleanDestination(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return raw.replace(/^\s*(?:(?:\([^)]*\)|（[^）]*）)\s*)+/, '').trim() || raw;
}

function ageBand(ageHours) {
  if (ageHours === null) return 'unknown';
  if (ageHours < 3) return 'under3';
  if (ageHours < 6) return '3to6';
  if (ageHours < 9) return '6to9';
  if (ageHours < 12) return '9to12';
  if (ageHours < 16) return '12to16';
  if (ageHours < 22) return '16to22';
  if (ageHours < 24) return '22to24';
  if (ageHours <= 48) return '24to48';
  return 'over48';
}

function bandLabel(key) {
  return TIME_BANDS.find(([band]) => band === key)?.[1] || key;
}

function text(el) {
  return String(el?.textContent ?? '').trim();
}

function parseRows(now = Date.now()) {
  return [...document.querySelectorAll('#table-body tr')].map((tr, index) => {
    const cells = tr.cells;
    const plan = text(cells[4]?.querySelector('.cell-stack > span'));
    const arrived = text(cells[4]?.querySelector('.cell-stack > small'));
    const planAt = parseMsTime(plan);
    const arrivedAt = parseMsTime(arrived);
    const ageHours = Number.isFinite(arrivedAt) && now >= arrivedAt ? (now - arrivedAt) / 3600000 : null;
    const hub = cleanDestination(text(cells[9]?.querySelector('.cell-stack > span')));
    const branch = cleanDestination(text(cells[9]?.querySelector('.cell-stack > small')));
    const pack = text(cells[5]);
    const validBag = Boolean(pack && pack !== '-' && pack !== '--');
    return {
      tr,
      index,
      pno: text(cells[0]),
      status: text(cells[1]),
      plan,
      arrived,
      ageHours,
      band: ageBand(ageHours),
      planOverdue: Number.isFinite(planAt) && now > planAt,
      pack: validBag ? pack : '',
      latestAction: text(cells[7]?.querySelector('.cell-stack > span')),
      latestTime: text(cells[7]?.querySelector('.cell-stack > small')),
      hub,
      branch,
      destination: [hub, branch].filter(Boolean).join(' / ') || '-',
    };
  });
}

function loadSelection() {
  try {
    const raw = JSON.parse(localStorage.getItem('ms-dashboard-time-bands') || 'null');
    if (Array.isArray(raw)) {
      const valid = raw.filter((key) => TIME_BANDS.some(([band]) => band === key));
      shellState.selectedBands = new Set(valid);
    }
  } catch (_) {}
}

function saveSelection() {
  localStorage.setItem('ms-dashboard-time-bands', JSON.stringify([...shellState.selectedBands]));
}

function selectedLabels() {
  return TIME_BANDS.filter(([key]) => shellState.selectedBands.has(key)).map(([, label]) => label);
}

function updateTimeControls() {
  document.querySelectorAll('[data-dashboard-band]').forEach((input) => {
    input.checked = shellState.selectedBands.has(input.dataset.dashboardBand);
  });
  const labels = selectedLabels();
  const textValue = labels.length ? labels.join(' + ') : 'ยังไม่ได้เลือกช่วงเวลา';
  if ($('dashboard-time-selected')) $('dashboard-time-selected').textContent = textValue;
  if ($('backlog-time-label')) $('backlog-time-label').textContent = textValue;
}

function selectedRows(now = Date.now()) {
  return parseRows(now).filter((row) => shellState.selectedBands.has(row.band));
}

function renderDashboard() {
  const rows = parseRows();
  const selected = rows.filter((row) => shellState.selectedBands.has(row.band));
  const unknown = rows.filter((row) => row.band === 'unknown').length;
  const overPlan = rows.filter((row) => row.planOverdue).length;
  const bagged = rows.filter((row) => row.pack).length;
  const critical = rows.filter((row) => row.band === 'over48' && row.planOverdue).length;

  if ($('dash-loaded')) $('dash-loaded').textContent = fmt.format(rows.length);
  if ($('dash-selected')) $('dash-selected').textContent = fmt.format(selected.length);
  if ($('dash-over-plan')) $('dash-over-plan').textContent = fmt.format(overPlan);
  if ($('dash-bagged')) $('dash-bagged').textContent = fmt.format(bagged);
  if ($('dash-critical')) $('dash-critical').textContent = fmt.format(critical);
  if ($('dashboard-selection-note')) {
    $('dashboard-selection-note').textContent = `เลือก ${fmt.format(shellState.selectedBands.size)} ช่วง · พบ ${fmt.format(selected.length)} จาก ${fmt.format(rows.length)} รายการในหน้าที่โหลดอยู่${unknown ? ` · อายุไม่ทราบ ${fmt.format(unknown)}` : ''}`;
  }
  updateTimeControls();
  applySelectedTimeFilter();
}

function applySelectedTimeFilter() {
  const rows = parseRows();
  const active = shellState.useSelectedAsFilter && shellState.page === 'backlog';
  rows.forEach((row) => {
    row.tr.classList.toggle('dashboard-time-hidden', active && !shellState.selectedBands.has(row.band));
  });
  const cards = [...document.querySelectorAll('#mobile-cards .mobile-card')];
  rows.forEach((row) => {
    cards[row.index]?.classList.toggle('dashboard-time-hidden', active && !shellState.selectedBands.has(row.band));
  });
  $('backlog-time-banner')?.classList.toggle('hidden', !active);
}

async function copySelectedSummary() {
  const now = Date.now();
  const rows = selectedRows(now);
  if (!shellState.selectedBands.size) {
    if ($('dashboard-copy-status')) $('dashboard-copy-status').textContent = 'กรุณาเลือกอย่างน้อย 1 ช่วงเวลา';
    return;
  }
  if (!rows.length) {
    if ($('dashboard-copy-status')) $('dashboard-copy-status').textContent = 'ไม่พบพัสดุตามช่วงเวลาที่เลือกในหน้าที่โหลดอยู่';
    return;
  }

  const bandCounts = new Map(TIME_BANDS.map(([key]) => [key, 0]));
  const destinationCounts = new Map();
  for (const row of rows) {
    bandCounts.set(row.band, (bandCounts.get(row.band) || 0) + 1);
    destinationCounts.set(row.destination, (destinationCounts.get(row.destination) || 0) + 1);
  }

  const branchText = text($('branch-select')?.selectedOptions?.[0]) || text($('source-sync')) || '-';
  const lines = [
    `MS Parcel Live · ${branchText}`,
    `ช่วงเวลา: ${selectedLabels().join(', ')}`,
    `รวม ${fmt.format(rows.length)} รายการ · ${new Date(now).toLocaleString('th-TH')}`,
    '',
    'สรุปตามช่วงเวลา',
    ...TIME_BANDS.filter(([key]) => shellState.selectedBands.has(key)).map(([key, label]) => `- ${label}: ${fmt.format(bandCounts.get(key) || 0)}`),
    '',
    'สรุปตามปลายทาง',
    ...[...destinationCounts.entries()].sort((a, b) => b[1] - a[1]).map(([destination, count]) => `- ${destination}: ${fmt.format(count)}`),
    '',
    'รายการพัสดุ',
    ...rows.map((row, i) => `${i + 1}. ${row.pno} | ${bandLabel(row.band)} | ${row.planOverdue ? 'เกินเวลาแผน' : 'ตามเวลาแผน'} | ${row.pack ? `แบ็ก ${row.pack}` : 'ไม่มีแบ็ก'} | ${row.latestAction || '-'} | ${row.destination}`),
  ];

  try {
    const output = lines.join('\n');
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(output);
    else {
      const ta = document.createElement('textarea');
      ta.value = output;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    if ($('dashboard-copy-status')) $('dashboard-copy-status').textContent = `คัดลอกรวม ${fmt.format(rows.length)} รายการแล้ว`;
  } catch (error) {
    if ($('dashboard-copy-status')) $('dashboard-copy-status').textContent = `คัดลอกไม่สำเร็จ: ${error.message}`;
  }
}

function clearNativeFilters() {
  if ($('search-input')) $('search-input').value = '';
  for (const id of ['status-filter', 'hub-filter', 'branch-filter']) {
    if ($(id)) $(id).value = '';
  }
  $('search-input')?.dispatchEvent(new Event('input', { bubbles: true }));
}

function resetPageFiltersFor(page) {
  if (page === 'dashboard') {
    clearNativeFilters();
    $('bag-reset-btn')?.click();
    document.querySelector('.smart-filter[data-risk="all"]')?.click();
    shellState.useSelectedAsFilter = false;
  } else if (page === 'parcels') {
    $('bag-reset-btn')?.click();
    document.querySelector('.smart-filter[data-risk="all"]')?.click();
    shellState.useSelectedAsFilter = false;
  } else if (page === 'backlog') {
    $('bag-reset-btn')?.click();
  } else if (page === 'bagging') {
    document.querySelector('.smart-filter[data-risk="all"]')?.click();
    shellState.useSelectedAsFilter = false;
  }
}

function moveResults(page) {
  const panel = $('results-panel');
  if (!panel) return;
  const slot = page === 'backlog' ? $('backlog-results-slot') : page === 'bagging' ? $('bagging-results-slot') : $('parcels-results-slot');
  if (slot && panel.parentElement !== slot) slot.appendChild(panel);
}

function setPage(nextPage, { updateHash = true, resetFilters = true } = {}) {
  const page = PAGE_IDS.has(nextPage) ? nextPage : 'dashboard';
  shellState.page = page;
  if (resetFilters) resetPageFiltersFor(page);
  document.querySelectorAll('[data-page-view]').forEach((section) => {
    section.classList.toggle('hidden', section.dataset.pageView !== page);
  });
  document.querySelectorAll('[data-page-nav]').forEach((button) => {
    button.classList.toggle('active', button.dataset.pageNav === page);
  });
  if (page !== 'dashboard') moveResults(page);
  if (updateHash && location.hash !== `#${page}`) history.replaceState(null, '', `#${page}`);
  applySelectedTimeFilter();
  renderDashboard();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function scheduleDashboardRender() {
  if (shellState.scheduled) return;
  shellState.scheduled = true;
  requestAnimationFrame(() => {
    shellState.scheduled = false;
    renderDashboard();
  });
}

function bindEvents() {
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
      renderDashboard();
    });
  });

  $('dashboard-time-all')?.addEventListener('click', () => {
    shellState.selectedBands = new Set(TIME_BANDS.map(([key]) => key));
    saveSelection();
    renderDashboard();
  });
  $('dashboard-time-clear')?.addEventListener('click', () => {
    shellState.selectedBands.clear();
    saveSelection();
    renderDashboard();
  });
  $('dashboard-copy-selected')?.addEventListener('click', () => void copySelectedSummary());
  $('dashboard-open-selected')?.addEventListener('click', () => {
    if (!shellState.selectedBands.size) {
      if ($('dashboard-copy-status')) $('dashboard-copy-status').textContent = 'เลือกช่วงเวลาก่อนเปิดรายการ';
      return;
    }
    shellState.useSelectedAsFilter = true;
    setPage('backlog', { resetFilters: false });
  });
  $('backlog-time-clear')?.addEventListener('click', () => {
    shellState.useSelectedAsFilter = false;
    applySelectedTimeFilter();
  });

  document.querySelectorAll('.smart-filter,.smart-subfilter').forEach((button) => {
    button.addEventListener('click', () => {
      if (shellState.page === 'backlog') {
        shellState.useSelectedAsFilter = false;
        applySelectedTimeFilter();
      }
    });
  });
}

function init() {
  loadSelection();
  bindEvents();
  const tbody = $('table-body');
  if (tbody) new MutationObserver(scheduleDashboardRender).observe(tbody, { childList: true });
  const initial = PAGE_IDS.has(location.hash.slice(1)) ? location.hash.slice(1) : 'dashboard';
  setPage(initial, { updateHash: true, resetFilters: false });
  renderDashboard();
  setInterval(() => {
    if (!document.hidden) renderDashboard();
  }, 60000);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();