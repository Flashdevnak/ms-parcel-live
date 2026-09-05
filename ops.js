const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('th-TH');

const OPS_PAGES = ['status', 'weight'];
let cachedRows = [];
let cacheSourceBranch = '';
let scheduled = false;
let rebuilding = false;

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function cleanDestination(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return raw.replace(/^\s*(?:(?:\([^)]*\)|（[^）]*）)\s*)+/, '').trim() || raw;
}

function parseMsTime(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '-' || raw === '--') return NaN;
  let normalized = raw;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(raw) && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) normalized = raw.replace(' ', 'T') + '+07:00';
  const n = Date.parse(normalized);
  return Number.isFinite(n) ? n : NaN;
}

function ageBand(arrived, now = Date.now()) {
  const t = parseMsTime(arrived);
  if (!Number.isFinite(t) || now < t) return 'unknown';
  const h = (now - t) / 3600000;
  if (h < 3) return 'under3';
  if (h < 6) return '3to6';
  if (h < 9) return '6to9';
  if (h < 12) return '9to12';
  if (h < 16) return '12to16';
  if (h < 22) return '16to22';
  if (h < 24) return '22to24';
  if (h <= 48) return '24to48';
  return 'over48';
}

function text(el) { return String(el?.textContent ?? '').trim(); }

function parseWeightKg(value) {
  const raw = String(value ?? '').replace(/,/g, '').trim();
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

function parseTableRows() {
  return [...document.querySelectorAll('#table-body tr')].map((tr) => {
    const c = tr.cells;
    const weightText = text(c[3]?.querySelector('.cell-stack > small'));
    return {
      pno: text(c[0]),
      parcelState: text(c[1]),
      plan: text(c[4]?.querySelector('.cell-stack > span')),
      arrived: text(c[4]?.querySelector('.cell-stack > small')),
      bag: text(c[5]) === '-' || text(c[5]) === '--' ? '' : text(c[5]),
      latestAction: text(c[7]?.querySelector('.cell-stack > span')) || '-',
      latestTime: text(c[7]?.querySelector('.cell-stack > small')) || '-',
      operatorName: text(c[8]?.querySelector('.cell-stack > span')) || '-',
      operatorPhone: text(c[8]?.querySelector('.cell-stack > small')) || '-',
      hubRaw: text(c[9]?.querySelector('.cell-stack > span')),
      branchRaw: text(c[9]?.querySelector('.cell-stack > small')),
      hub: cleanDestination(text(c[9]?.querySelector('.cell-stack > span'))) || '-',
      branch: cleanDestination(text(c[9]?.querySelector('.cell-stack > small'))) || '-',
      weightKg: parseWeightKg(weightText),
    };
  }).filter((r) => r.pno);
}

function sourceBranchKey() {
  return String($('branch-select')?.value || '') + '|' + text($('branch-select')?.selectedOptions?.[0]);
}

function sourceAliases() {
  const label = text($('branch-select')?.selectedOptions?.[0]);
  const [codePart, ...rest] = label.split('·');
  const code = String(codePart || '').trim().toUpperCase();
  const name = String(rest.join('·') || '').trim();
  return { code, name };
}

function normalizeName(value) {
  return cleanDestination(value).toUpperCase().replace(/^\d+\s*/, '').replace(/\s+/g, ' ').trim();
}

function isOwnHub(value) {
  const raw = cleanDestination(value);
  if (!raw) return false;
  const { code, name } = sourceAliases();
  const dest = normalizeName(raw);
  const own = normalizeName(name);
  if (own && dest === own) return true;
  if (!code) return false;
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Z0-9])${escaped}(?:_HUB)?([^A-Z0-9]|$)`, 'i').test(raw.toUpperCase());
}

function filtersNeutral() {
  return !String($('search-input')?.value || '').trim()
    && !String($('status-filter')?.value || '')
    && !String($('hub-filter')?.value || '')
    && !String($('branch-filter')?.value || '');
}

function updateCache() {
  const key = sourceBranchKey();
  if (key !== cacheSourceBranch) {
    cacheSourceBranch = key;
    cachedRows = [];
  }
  const rows = parseTableRows();
  if (rows.length && (filtersNeutral() || !cachedRows.length)) cachedRows = rows;
  return cachedRows.length ? cachedRows : rows;
}

function selectedBands() {
  return new Set([...document.querySelectorAll('[data-dashboard-band]')].filter((x) => x.checked).map((x) => x.dataset.dashboardBand));
}

function globalRows({ ignoreAction = false } = {}) {
  const rows = updateCache();
  const bands = selectedBands();
  const hub = String($('hub-filter')?.value || '');
  const branch = String($('branch-filter')?.value || '');
  const action = String($('ops-action-filter')?.value || '');
  return rows.filter((r) => {
    if (!bands.has(ageBand(r.arrived))) return false;
    if (hub && r.hubRaw !== hub) return false;
    if (branch && r.branchRaw !== branch) return false;
    if (!ignoreAction && action && r.latestAction !== action) return false;
    return true;
  });
}

function unique(values) {
  return [...new Set(values.filter((v) => v && v !== '-'))].sort((a, b) => cleanDestination(a).localeCompare(cleanDestination(b), 'th'));
}

function setSelectOptions(select, values, keep, labelFn = cleanDestination) {
  if (!select) return;
  select.innerHTML = '<option value="">ทั้งหมด</option>' + values.map((v) => `<option value="${esc(v)}">${esc(labelFn(v) || v)}</option>`).join('');
  if (values.includes(keep)) select.value = keep;
  else select.value = '';
}

function rebuildDestinationFilters() {
  if (rebuilding) return;
  rebuilding = true;
  try {
    const rows = updateCache();
    const hubSelect = $('hub-filter');
    const branchSelect = $('branch-filter');
    const actionSelect = $('ops-action-filter');
    const keepHub = String(hubSelect?.value || '');
    const keepBranch = String(branchSelect?.value || '');
    const keepAction = String(actionSelect?.value || '');

    const hubs = unique(rows.map((r) => r.hubRaw).filter((v) => !isOwnHub(v)));
    setSelectOptions(hubSelect, hubs, keepHub);
    const selectedHub = String(hubSelect?.value || '');
    const branchRows = selectedHub ? rows.filter((r) => r.hubRaw === selectedHub) : rows;
    const branches = unique(branchRows.map((r) => r.branchRaw));
    setSelectOptions(branchSelect, branches, keepBranch);

    const filteredForActions = globalRows({ ignoreAction: true });
    const actions = unique(filteredForActions.map((r) => r.latestAction));
    setSelectOptions(actionSelect, actions, keepAction, (v) => v);
  } finally {
    rebuilding = false;
  }
}

function countBy(rows, getter) {
  const map = new Map();
  for (const row of rows) {
    const key = String(getter(row) || '-');
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'th'));
}

function latestTime(rows) {
  let best = null;
  for (const row of rows) {
    const n = parseMsTime(row.latestTime);
    if (Number.isFinite(n) && (!best || n > best.n)) best = { n, text: row.latestTime };
  }
  return best?.text || '-';
}

function renderStatusPage() {
  const rows = globalRows();
  const groups = countBy(rows, (r) => r.latestAction);
  $('ops-status-total').textContent = fmt.format(rows.length);
  $('ops-status-types').textContent = fmt.format(groups.length);
  $('ops-status-table').innerHTML = groups.length ? groups.map(([action, count]) => {
    const subset = rows.filter((r) => r.latestAction === action);
    const pct = rows.length ? (count / rows.length * 100).toFixed(1) : '0.0';
    return `<tr><td>${esc(action)}</td><td>${fmt.format(count)}</td><td>${pct}%</td><td>${esc(latestTime(subset))}</td></tr>`;
  }).join('') : '<tr><td colspan="4">-</td></tr>';
  $('ops-status-detail').innerHTML = rows.length ? rows.map((r) => `<tr><td>${esc(r.pno)}</td><td>${esc(r.latestAction)}</td><td>${esc(r.latestTime)}</td><td>${esc(r.operatorPhone)}</td><td>${esc(r.hub)}</td><td>${esc(r.branch)}</td></tr>`).join('') : '<tr><td colspan="6">-</td></tr>';
}

function renderWeightPage() {
  const rows = globalRows();
  const map = new Map();
  for (const r of rows) {
    const key = r.branch || '-';
    const item = map.get(key) || { branch: key, hubs: new Set(), count: 0, weight: 0 };
    item.count += 1;
    item.weight += r.weightKg;
    if (r.hub && r.hub !== '-') item.hubs.add(r.hub);
    map.set(key, item);
  }
  const groups = [...map.values()].sort((a, b) => b.weight - a.weight || b.count - a.count);
  const totalWeight = rows.reduce((sum, r) => sum + r.weightKg, 0);
  $('ops-weight-parcels').textContent = fmt.format(rows.length);
  $('ops-weight-total').textContent = `${totalWeight.toLocaleString('th-TH', { maximumFractionDigits: 2 })} kg`;
  $('ops-weight-avg').textContent = `${(rows.length ? totalWeight / rows.length : 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })} kg`;
  $('ops-weight-branches').textContent = fmt.format(groups.length);
  $('ops-weight-table').innerHTML = groups.length ? groups.map((g) => `<tr><td>${esc(g.branch)}</td><td>${esc([...g.hubs].join(', ') || '-')}</td><td>${fmt.format(g.count)}</td><td>${g.weight.toLocaleString('th-TH', { maximumFractionDigits: 2 })}</td><td>${(g.count ? g.weight / g.count : 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })}</td></tr>`).join('') : '<tr><td colspan="5">-</td></tr>';
}

function bagRows() {
  let rows = globalRows().filter((r) => r.bag);
  const bagSearch = String($('bag-search')?.value || '').trim().toLowerCase();
  const action = String($('bag-action-filter')?.value || '');
  const hub = String($('bag-hub-filter')?.value || '');
  const branch = String($('bag-branch-filter')?.value || '');
  if (bagSearch) rows = rows.filter((r) => r.bag.toLowerCase().includes(bagSearch));
  if (action) rows = rows.filter((r) => r.latestAction === action);
  if (hub) rows = rows.filter((r) => r.hubRaw === hub || r.hub === cleanDestination(hub));
  if (branch) rows = rows.filter((r) => r.branchRaw === branch || r.branch === cleanDestination(branch));
  return rows;
}

function renderBagDetail() {
  const rows = bagRows();
  $('ops-bag-detail').innerHTML = rows.length ? rows.map((r) => `<tr><td>${esc(r.hub)}</td><td>${esc(r.branch)}</td><td>${esc(r.bag)}</td><td>${esc(r.pno)}</td><td>${esc(r.operatorPhone)}</td><td>${esc(r.latestTime)}</td></tr>`).join('') : '<tr><td colspan="6">-</td></tr>';
  $('ops-bag-detail-count').textContent = fmt.format(rows.length);
}

function renderAll() {
  rebuildDestinationFilters();
  renderStatusPage();
  renderWeightPage();
  renderBagDetail();
}

function scheduleRender() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    renderAll();
  });
}

function pageSection(name, title, body) {
  const section = document.createElement('section');
  section.className = 'page-view hidden';
  section.dataset.pageView = name;
  section.innerHTML = `<div class="page-title"><h2>${title}</h2></div>${body}`;
  return section;
}

function ensureStructure() {
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = 'ops.css?v=20260905-1';
  document.head.appendChild(css);

  const nav = document.querySelector('.app-nav-inner');
  if (nav && !nav.querySelector('[data-page-nav="status"]')) {
    const backlogBtn = nav.querySelector('[data-page-nav="backlog"]');
    const statusBtn = document.createElement('button');
    statusBtn.className = 'app-nav-btn'; statusBtn.type = 'button'; statusBtn.dataset.pageNav = 'status'; statusBtn.textContent = 'สถานะพัสดุ';
    nav.insertBefore(statusBtn, backlogBtn);
    const bagBtn = nav.querySelector('[data-page-nav="bagging"]');
    const weightBtn = document.createElement('button');
    weightBtn.className = 'app-nav-btn'; weightBtn.type = 'button'; weightBtn.dataset.pageNav = 'weight'; weightBtn.textContent = 'น้ำหนักสาขา';
    nav.insertBefore(weightBtn, bagBtn);
  }

  const main = document.querySelector('main.app-shell');
  const backlog = document.querySelector('[data-page-view="backlog"]');
  const bagging = document.querySelector('[data-page-view="bagging"]');
  if (main && backlog && !document.querySelector('[data-page-view="status"]')) {
    const status = pageSection('status', 'สถานะพัสดุ', `
      <div class="ops-metric-grid"><article><span>รายการ</span><strong id="ops-status-total">0</strong></article><article><span>สถานะล่าสุด</span><strong id="ops-status-types">0</strong></article></div>
      <section class="panel ops-panel"><h3>การดำเนินการล่าสุด</h3><div class="ops-table-scroll compact"><table class="ops-table"><thead><tr><th>การดำเนินการล่าสุด</th><th>จำนวน</th><th>สัดส่วน</th><th>เวลาล่าสุด</th></tr></thead><tbody id="ops-status-table"></tbody></table></div></section>
      <section class="panel ops-panel"><h3>รายการพัสดุ</h3><div class="ops-table-scroll"><table class="ops-table"><thead><tr><th>เลขพัสดุ</th><th>การดำเนินการล่าสุด</th><th>เวลา</th><th>เบอร์ผู้ดำเนินการ</th><th>LH ปลายทาง</th><th>FD ปลายทาง</th></tr></thead><tbody id="ops-status-detail"></tbody></table></div></section>`);
    main.insertBefore(status, backlog);
  }
  if (main && bagging && !document.querySelector('[data-page-view="weight"]')) {
    const weight = pageSection('weight', 'น้ำหนักสาขา', `
      <div class="ops-metric-grid four"><article><span>พัสดุ</span><strong id="ops-weight-parcels">0</strong></article><article><span>น้ำหนักรวม</span><strong id="ops-weight-total">0 kg</strong></article><article><span>เฉลี่ย/ชิ้น</span><strong id="ops-weight-avg">0 kg</strong></article><article><span>FD ปลายทาง</span><strong id="ops-weight-branches">0</strong></article></div>
      <section class="panel ops-panel"><div class="ops-table-scroll"><table class="ops-table"><thead><tr><th>FD ปลายทาง</th><th>LH ปลายทาง</th><th>เลขพัสดุ (จำนวน)</th><th>น้ำหนักรวม kg</th><th>เฉลี่ย kg</th></tr></thead><tbody id="ops-weight-table"></tbody></table></div></section>`);
    main.insertBefore(weight, bagging);
  }

  const globalGrid = document.querySelector('.global-destination-grid');
  if (globalGrid && !$('ops-action-filter')) {
    const label = document.createElement('label');
    label.innerHTML = '<span>การดำเนินการล่าสุด</span><select id="ops-action-filter"><option value="">ทั้งหมด</option></select>';
    globalGrid.insertBefore(label, globalGrid.querySelector('.selected-inline'));
  }
  const hubSpan = $('hub-filter')?.closest('label')?.querySelector('span'); if (hubSpan) hubSpan.textContent = 'LH ปลายทาง';
  const branchSpan = $('branch-filter')?.closest('label')?.querySelector('span'); if (branchSpan) branchSpan.textContent = 'FD ปลายทาง';

  if (bagging && !$('ops-bag-detail')) {
    const detail = document.createElement('section');
    detail.className = 'panel ops-panel ops-bag-detail-panel';
    detail.innerHTML = `<div class="ops-panel-head"><h3>รายการแบ็กกิ้ง</h3><span><b id="ops-bag-detail-count">0</b> รายการ</span></div><div class="ops-table-scroll"><table class="ops-table"><thead><tr><th>LH ปลายทาง</th><th>FD ปลายทาง</th><th>เลขแบ็กกิ้ง</th><th>เลขพัสดุ</th><th>เบอร์ผู้ดำเนินการล่าสุด</th><th>เวลาที่ดำเนินการล่าสุด</th></tr></thead><tbody id="ops-bag-detail"></tbody></table></div>`;
    bagging.querySelector('.bag-panel')?.after(detail);
  }
}

ensureStructure();

document.addEventListener('DOMContentLoaded', () => {
  const tbody = $('table-body');
  if (tbody) new MutationObserver(scheduleRender).observe(tbody, { childList: true });
  const hub = $('hub-filter');
  const branch = $('branch-filter');
  if (hub) new MutationObserver(scheduleRender).observe(hub, { childList: true });
  if (branch) new MutationObserver(scheduleRender).observe(branch, { childList: true });

  for (const id of ['hub-filter', 'branch-filter', 'ops-action-filter', 'bag-action-filter', 'bag-hub-filter', 'bag-branch-filter', 'bag-issue-filter', 'bag-mode']) {
    $(id)?.addEventListener('change', () => {
      if (id === 'hub-filter') rebuildDestinationFilters();
      scheduleRender();
    });
  }
  $('bag-search')?.addEventListener('input', scheduleRender);
  document.querySelectorAll('[data-dashboard-band]').forEach((el) => el.addEventListener('change', scheduleRender));

  $('branch-select')?.addEventListener('change', () => {
    cachedRows = [];
    cacheSourceBranch = sourceBranchKey();
    if ($('hub-filter')) $('hub-filter').value = '';
    if ($('branch-filter')) $('branch-filter').value = '';
    if ($('ops-action-filter')) $('ops-action-filter').value = '';
    setTimeout(scheduleRender, 0);
  });

  renderAll();
});
