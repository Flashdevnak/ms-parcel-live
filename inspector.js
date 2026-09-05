const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('th-TH');

const inspectorState = {
  ageBand: 'all',
  bagMode: 'all',
  bagAction: '',
  bagHub: '',
  bagBranch: '',
  bagIssue: 'all',
  bagSearch: '',
  scheduled: false,
};

const AGE_BANDS = [
  ['under3', '<3 ชม.'],
  ['3to6', '3–6 ชม.'],
  ['6to9', '6–9 ชม.'],
  ['9to12', '9–12 ชม.'],
  ['12to16', '12–16 ชม.'],
  ['16to22', '16–22 ชม.'],
  ['22to24', '22–24 ชม.'],
];

function text(el) {
  return String(el?.textContent ?? '').trim();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[c]));
}

function cleanDestination(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const cleaned = raw.replace(/^\s*(?:(?:\([^)]*\)|（[^）]*）)\s*)+/, '').trim();
  return cleaned || raw;
}

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

function durationText(hours) {
  if (hours === null || !Number.isFinite(hours)) return 'ไม่ทราบ';
  const totalMinutes = Math.max(0, Math.floor(hours * 60));
  if (totalMinutes < 60) return `${totalMinutes} นาที`;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h < 24) return `${h}ชม.${m ? ` ${m}น.` : ''}`.trim();
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return `${d}วัน${rh ? ` ${rh}ชม.` : ''}`;
}

function validBag(value) {
  const v = String(value ?? '').trim();
  return Boolean(v && v !== '-' && v !== '--');
}

function parseTableRows(now = Date.now()) {
  return [...document.querySelectorAll('#table-body tr')].map((tr, index) => {
    const c = tr.cells;
    const plan = text(c[4]?.querySelector('.cell-stack > span'));
    const arrived = text(c[4]?.querySelector('.cell-stack > small'));
    const latestAction = text(c[7]?.querySelector('.cell-stack > span'));
    const latestTime = text(c[7]?.querySelector('.cell-stack > small'));
    const rawHub = text(c[9]?.querySelector('.cell-stack > span'));
    const rawBranch = text(c[9]?.querySelector('.cell-stack > small'));
    const hub = cleanDestination(rawHub);
    const branch = cleanDestination(rawBranch);
    const arrivedAt = parseMsTime(arrived);
    const planAt = parseMsTime(plan);
    const actionAt = parseMsTime(latestTime);
    const ageHours = Number.isFinite(arrivedAt) && now >= arrivedAt ? (now - arrivedAt) / 3600000 : null;
    const planOverdue = Number.isFinite(planAt) && now > planAt;
    const planDueMinutes = Number.isFinite(planAt) && planAt >= now ? (planAt - now) / 60000 : null;
    const actionLagHours = Number.isFinite(actionAt) && now >= actionAt ? (now - actionAt) / 3600000 : null;
    return {
      tr,
      index,
      pno: text(c[0]),
      parcelState: text(c[1]),
      band: ageBand(ageHours),
      ageHours,
      plan,
      arrived,
      planOverdue,
      planDueMinutes,
      pack: text(c[5]),
      latestAction,
      latestTime,
      actionLagHours,
      hub,
      branch,
      destination: [hub, branch].filter(Boolean).join(' / '),
    };
  });
}

function buildBagGroups(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!validBag(row.pack)) continue;
    if (!groups.has(row.pack)) groups.set(row.pack, []);
    groups.get(row.pack).push(row);
  }
  const meta = new Map();
  for (const [pack, items] of groups) {
    const destinations = new Set(items.map((r) => r.destination).filter(Boolean));
    const actions = new Set(items.map((r) => r.latestAction).filter((v) => v && v !== '-'));
    const parcelStates = new Set(items.map((r) => r.parcelState).filter((v) => v && v !== '-'));
    const mixedDestination = destinations.size > 1;
    const mixedAction = actions.size > 1;
    const mixedState = parcelStates.size > 1;
    const planOverdue = items.some((r) => r.planOverdue);
    const stale6h = items.some((r) => r.actionLagHours !== null && r.actionLagHours >= 6);
    const critical = items.some((r) => r.band === 'over48' && r.planOverdue);
    const anomaly = mixedDestination || mixedAction || mixedState;
    let score = 0;
    if (critical) score += 1000;
    if (anomaly) score += 500;
    if (planOverdue) score += 300;
    if (stale6h) score += 200;
    score += items.length;
    meta.set(pack, {
      pack, items, destinations, actions, parcelStates,
      mixedDestination, mixedAction, mixedState, planOverdue, stale6h, critical, anomaly, score,
    });
  }
  return meta;
}

function setOptions(select, values, current, allLabel = 'ทั้งหมด') {
  if (!select) return;
  const uniq = [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'th'));
  select.innerHTML = `<option value="">${escapeHtml(allLabel)}</option>` + uniq.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  if (uniq.includes(current)) select.value = current;
}

function normalizeVisibleLabels(rows) {
  for (const row of rows) {
    const destCell = row.tr.cells[9];
    const hubEl = destCell?.querySelector('.cell-stack > span');
    const branchEl = destCell?.querySelector('.cell-stack > small');
    if (hubEl && text(hubEl) !== row.hub) hubEl.textContent = row.hub || '-';
    if (branchEl && text(branchEl) !== row.branch) branchEl.textContent = row.branch || '';

    row.tr.querySelectorAll('.risk-chip').forEach((chip) => {
      if (chip.textContent.includes('ตกรอบ')) chip.textContent = chip.textContent.replace('ตกรอบ', 'เกินเวลาแผน');
    });
  }
  document.querySelectorAll('#mobile-cards .risk-chip').forEach((chip) => {
    if (chip.textContent.includes('ตกรอบ')) chip.textContent = chip.textContent.replace('ตกรอบ', 'เกินเวลาแผน');
  });
}

function renderAgeBands(rows) {
  const counts = Object.fromEntries(AGE_BANDS.map(([key]) => [key, 0]));
  let under24 = 0;
  let unknown = 0;
  for (const row of rows) {
    if (counts[row.band] !== undefined) counts[row.band] += 1;
    if (row.ageHours !== null && row.ageHours < 24) under24 += 1;
    if (row.band === 'unknown') unknown += 1;
  }
  for (const [key] of AGE_BANDS) {
    const el = $(`risk-${key}`);
    if (el) el.textContent = fmt.format(counts[key]);
  }
  if ($('risk-under24-total')) $('risk-under24-total').textContent = fmt.format(under24);
  document.querySelectorAll('.smart-subfilter').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.age === inspectorState.ageBand);
  });
  const detail = AGE_BANDS.map(([key, label]) => `${label} ${fmt.format(counts[key])}`).join(' · ');
  const note = $('sla-band-note');
  if (note) note.textContent = `${detail}${unknown ? ` · อายุไม่ทราบ ${fmt.format(unknown)}` : ''}`;
}

function issueMatches(group, issue) {
  if (!group) return false;
  if (issue === 'all') return true;
  if (issue === 'anomaly') return group.anomaly;
  if (issue === 'mixedDestination') return group.mixedDestination;
  if (issue === 'mixedAction') return group.mixedAction;
  if (issue === 'mixedState') return group.mixedState;
  if (issue === 'planOverdue') return group.planOverdue;
  if (issue === 'stale6h') return group.stale6h;
  if (issue === 'critical') return group.critical;
  return true;
}

function renderBaggingInspector(rows, bagGroups) {
  const bagRows = rows.filter((r) => validBag(r.pack));
  const groups = [...bagGroups.values()];
  setOptions($('bag-action-filter'), bagRows.map((r) => r.latestAction), inspectorState.bagAction, 'ทุกการดำเนินการ');
  setOptions($('bag-hub-filter'), bagRows.map((r) => r.hub), inspectorState.bagHub, 'ทุก HUB');
  setOptions($('bag-branch-filter'), bagRows.map((r) => r.branch), inspectorState.bagBranch, 'ทุกสาขา');

  if ($('bag-parcels')) $('bag-parcels').textContent = fmt.format(bagRows.length);
  if ($('bag-count')) $('bag-count').textContent = fmt.format(groups.length);
  if ($('bag-anomaly')) $('bag-anomaly').textContent = fmt.format(groups.filter((g) => g.anomaly).length);
  if ($('bag-plan-overdue')) $('bag-plan-overdue').textContent = fmt.format(groups.filter((g) => g.planOverdue).length);
  if ($('bag-stale')) $('bag-stale').textContent = fmt.format(groups.filter((g) => g.stale6h).length);

  const alertList = $('bag-alert-list');
  if (alertList) {
    const alerts = groups.filter((g) => g.anomaly || g.planOverdue || g.stale6h)
      .sort((a, b) => b.score - a.score).slice(0, 6);
    alertList.innerHTML = alerts.length ? alerts.map((g) => {
      const flags = [];
      if (g.critical) flags.push('วิกฤต');
      if (g.mixedDestination) flags.push('ปลายทางปน');
      if (g.mixedAction) flags.push('การดำเนินการปน');
      if (g.mixedState) flags.push('สถานะปน');
      if (g.planOverdue) flags.push('เกินเวลาแผน');
      if (g.stale6h) flags.push('ไม่อัปเดต >6ชม.');
      return `<button type="button" class="bag-alert-item" data-pack="${escapeHtml(g.pack)}"><strong>${escapeHtml(g.pack)}</strong><span>${fmt.format(g.items.length)} ชิ้น · ${escapeHtml(flags.join(' · '))}</span></button>`;
    }).join('') : '<div class="bag-ok">ยังไม่พบแบ็กกิ้งผิดปกติในหน้าปัจจุบัน</div>';
  }

  const note = $('bag-note');
  if (note) note.textContent = `ตรวจจาก ${fmt.format(bagRows.length)} พัสดุที่มีเลขแบ็กกิ้ง / ${fmt.format(groups.length)} แบ็กในหน้าปัจจุบัน · ไม่ยิง API เพิ่ม`;
}

function rowMatchesInspector(row, bagGroups) {
  if (inspectorState.ageBand !== 'all' && row.band !== inspectorState.ageBand) return false;

  const hasBagFilter = inspectorState.bagMode === 'bagging'
    || inspectorState.bagAction || inspectorState.bagHub || inspectorState.bagBranch
    || inspectorState.bagIssue !== 'all' || inspectorState.bagSearch;
  if (!hasBagFilter) return true;
  if (!validBag(row.pack)) return false;
  if (inspectorState.bagAction && row.latestAction !== inspectorState.bagAction) return false;
  if (inspectorState.bagHub && row.hub !== inspectorState.bagHub) return false;
  if (inspectorState.bagBranch && row.branch !== inspectorState.bagBranch) return false;
  if (inspectorState.bagSearch && !row.pack.toLowerCase().includes(inspectorState.bagSearch.toLowerCase())) return false;
  if (!issueMatches(bagGroups.get(row.pack), inspectorState.bagIssue)) return false;
  return true;
}

function applyRowVisibility(rows, bagGroups) {
  let visible = 0;
  const cards = [...document.querySelectorAll('#mobile-cards .mobile-card')];
  rows.forEach((row) => {
    const show = rowMatchesInspector(row, bagGroups);
    row.tr.classList.toggle('inspector-hidden', !show);
    if (cards[row.index]) cards[row.index].classList.toggle('inspector-hidden', !show);
    if (show) visible += 1;
  });
  const pageInfo = $('page-info');
  if (pageInfo) {
    const base = pageInfo.textContent.split(' · Inspector ')[0];
    const active = inspectorState.ageBand !== 'all' || inspectorState.bagMode === 'bagging'
      || inspectorState.bagAction || inspectorState.bagHub || inspectorState.bagBranch
      || inspectorState.bagIssue !== 'all' || inspectorState.bagSearch;
    pageInfo.textContent = active ? `${base} · Inspector ${fmt.format(visible)} รายการ` : base;
  }
  return visible;
}

function applyInspector() {
  const tbody = $('table-body');
  if (!tbody) return;
  observer.disconnect();
  try {
    const rows = parseTableRows();
    const bagGroups = buildBagGroups(rows);
    normalizeVisibleLabels(rows);
    renderAgeBands(rows);
    renderBaggingInspector(rows, bagGroups);
    applyRowVisibility(rows, bagGroups);
  } finally {
    observer.observe(tbody, { childList: true });
  }
}

function scheduleInspector() {
  if (inspectorState.scheduled) return;
  inspectorState.scheduled = true;
  requestAnimationFrame(() => {
    inspectorState.scheduled = false;
    applyInspector();
  });
}

const observer = new MutationObserver(scheduleInspector);

function resetOldSmartFilter() {
  const all = document.querySelector('.smart-filter[data-risk="all"]');
  if (all && !all.classList.contains('active')) all.click();
}

function filteredBagGroupsForCopy() {
  const rows = parseTableRows();
  const groups = buildBagGroups(rows);
  return [...groups.values()].filter((g) => {
    if (inspectorState.bagSearch && !g.pack.toLowerCase().includes(inspectorState.bagSearch.toLowerCase())) return false;
    if (!issueMatches(g, inspectorState.bagIssue)) return false;
    return g.items.some((r) => {
      if (inspectorState.bagAction && r.latestAction !== inspectorState.bagAction) return false;
      if (inspectorState.bagHub && r.hub !== inspectorState.bagHub) return false;
      if (inspectorState.bagBranch && r.branch !== inspectorState.bagBranch) return false;
      return true;
    });
  }).sort((a, b) => b.score - a.score);
}

async function writeClipboard(value) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const ta = document.createElement('textarea');
  ta.value = value;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
}

async function copyBagSummary() {
  const groups = filteredBagGroupsForCopy();
  if (!groups.length) {
    if ($('bag-note')) $('bag-note').textContent = 'ไม่มีแบ็กกิ้งตามตัวกรองที่เลือก';
    return;
  }
  const lines = [`Bagging Inspector · ${new Date().toLocaleString('th-TH')}`];
  groups.forEach((g, i) => {
    const flags = [];
    if (g.mixedDestination) flags.push('ปลายทางปน');
    if (g.mixedAction) flags.push('การดำเนินการปน');
    if (g.mixedState) flags.push('สถานะปน');
    if (g.planOverdue) flags.push('เกินเวลาแผน');
    if (g.stale6h) flags.push('ไม่อัปเดต >6ชม.');
    const destinations = [...g.destinations].join(', ') || '-';
    lines.push(`${i + 1}. ${g.pack} | ${g.items.length} ชิ้น | ${destinations} | ${flags.join(', ') || 'ปกติ'}`);
  });
  await writeClipboard(lines.join('\n'));
  if ($('bag-note')) $('bag-note').textContent = `คัดลอกสรุป ${fmt.format(groups.length)} แบ็กแล้ว`;
}

function copyVisibleRiskRowsCapture(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
  const rows = parseTableRows().filter((r) => !r.tr.classList.contains('inspector-hidden'));
  const lines = [`MS Parcel Live · ${new Date().toLocaleString('th-TH')}`];
  rows.forEach((r, i) => {
    const age = r.ageHours === null ? 'อายุไม่ทราบ' : `ค้าง ${durationText(r.ageHours)}`;
    const plan = r.planOverdue ? 'เกินเวลาแผน' : (r.planDueMinutes !== null && r.planDueMinutes <= 60 ? `ใกล้เวลาแผน ${Math.max(0, Math.floor(r.planDueMinutes))} นาที` : '');
    lines.push(`${i + 1}. ${r.pno} | ${age}${plan ? ` | ${plan}` : ''} | ${r.pack && validBag(r.pack) ? `แบ็ก ${r.pack}` : 'ไม่มีแบ็ก'} | ${r.destination || '-'}`);
  });
  void writeClipboard(lines.join('\n')).then(() => {
    if ($('smart-note')) $('smart-note').textContent = `คัดลอก ${fmt.format(rows.length)} รายการแล้ว · ใช้คำว่า “เกินเวลาแผน”`;
  });
}

function bindEvents() {
  document.querySelectorAll('.smart-subfilter').forEach((button) => {
    button.addEventListener('click', () => {
      resetOldSmartFilter();
      inspectorState.ageBand = button.dataset.age || 'all';
      applyInspector();
    });
  });

  document.querySelectorAll('.smart-filter').forEach((button) => {
    button.addEventListener('click', () => {
      inspectorState.ageBand = 'all';
      scheduleInspector();
    }, true);
  });

  $('risk-sort')?.addEventListener('change', scheduleInspector);
  $('copy-risk-btn')?.addEventListener('click', copyVisibleRiskRowsCapture, true);

  $('bag-mode')?.addEventListener('change', (e) => {
    inspectorState.bagMode = e.target.value;
    applyInspector();
  });
  $('bag-search')?.addEventListener('input', (e) => {
    inspectorState.bagSearch = e.target.value.trim();
    if (inspectorState.bagSearch) {
      inspectorState.bagMode = 'bagging';
      $('bag-mode').value = 'bagging';
    }
    applyInspector();
  });
  $('bag-action-filter')?.addEventListener('change', (e) => {
    inspectorState.bagAction = e.target.value;
    if (inspectorState.bagAction) { inspectorState.bagMode = 'bagging'; $('bag-mode').value = 'bagging'; }
    applyInspector();
  });
  $('bag-hub-filter')?.addEventListener('change', (e) => {
    inspectorState.bagHub = e.target.value;
    if (inspectorState.bagHub) { inspectorState.bagMode = 'bagging'; $('bag-mode').value = 'bagging'; }
    applyInspector();
  });
  $('bag-branch-filter')?.addEventListener('change', (e) => {
    inspectorState.bagBranch = e.target.value;
    if (inspectorState.bagBranch) { inspectorState.bagMode = 'bagging'; $('bag-mode').value = 'bagging'; }
    applyInspector();
  });
  $('bag-issue-filter')?.addEventListener('change', (e) => {
    inspectorState.bagIssue = e.target.value;
    if (inspectorState.bagIssue !== 'all') { inspectorState.bagMode = 'bagging'; $('bag-mode').value = 'bagging'; }
    applyInspector();
  });
  $('copy-bag-btn')?.addEventListener('click', () => void copyBagSummary());
  $('bag-reset-btn')?.addEventListener('click', () => {
    inspectorState.bagMode = 'all';
    inspectorState.bagAction = '';
    inspectorState.bagHub = '';
    inspectorState.bagBranch = '';
    inspectorState.bagIssue = 'all';
    inspectorState.bagSearch = '';
    $('bag-mode').value = 'all';
    $('bag-search').value = '';
    $('bag-issue-filter').value = 'all';
    applyInspector();
  });

  $('bag-alert-list')?.addEventListener('click', (e) => {
    const button = e.target.closest('.bag-alert-item');
    if (!button) return;
    inspectorState.bagMode = 'bagging';
    inspectorState.bagSearch = button.dataset.pack || '';
    $('bag-mode').value = 'bagging';
    $('bag-search').value = inspectorState.bagSearch;
    applyInspector();
  });
}

function init() {
  const tbody = $('table-body');
  if (!tbody) return;
  bindEvents();
  observer.observe(tbody, { childList: true });
  applyInspector();
  setInterval(() => {
    if (!document.hidden && document.querySelector('#table-body tr')) scheduleInspector();
  }, 60000);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
