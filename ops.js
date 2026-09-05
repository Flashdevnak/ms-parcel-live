const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('th-TH');
const BANDS = ['under3','3to6','6to9','9to12','12to16','16to22','22to24','24to48','over48'];
let fullAnalytics = window.__MS_FULL_ANALYTICS || null;
let scheduled = false;
let cachedRows = [];
let cacheBranch = '';

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function text(el) { return String(el?.textContent ?? '').trim(); }
function cleanDestination(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return raw.replace(/^\s*(?:(?:\([^)]*\)|（[^）]*）)\s*)+/, '').trim() || raw;
}
function parseTime(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '-' || raw === '--') return NaN;
  let normalized = raw;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(raw) && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) normalized = raw.replace(' ', 'T') + '+07:00';
  const n = Date.parse(normalized);
  return Number.isFinite(n) ? n : NaN;
}
function ageBand(arrived, now = Date.now()) {
  const t = parseTime(arrived);
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
function weightKg(value) {
  const n = Number.parseFloat(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}
function sourceAliases() {
  const [codePart, ...rest] = text($('branch-select')?.selectedOptions?.[0]).split('·');
  return { code: String(codePart || '').trim().toUpperCase(), name: String(rest.join('·') || '').trim() };
}
function normalizeName(value) { return cleanDestination(value).toUpperCase().replace(/^\d+\s*/, '').replace(/\s+/g, ' ').trim(); }
function isOwnHub(value) {
  const raw = cleanDestination(value);
  if (!raw) return false;
  const { code, name } = sourceAliases();
  if (name && normalizeName(raw) === normalizeName(name)) return true;
  if (!code) return false;
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Z0-9])${escaped}(?:_HUB)?([^A-Z0-9]|$)`, 'i').test(raw.toUpperCase());
}
function parseRows() {
  return [...document.querySelectorAll('#table-body tr')].map((tr, index) => {
    const c = tr.cells;
    if (!c?.length) return null;
    const bagRaw = text(c[5]);
    const hubRaw = text(c[9]?.querySelector('.cell-stack > span'));
    const fdRaw = text(c[9]?.querySelector('.cell-stack > small'));
    return {
      tr, index,
      pno: text(c[0]),
      state: text(c[1]),
      weight: weightKg(text(c[3]?.querySelector('.cell-stack > small'))),
      plan: text(c[4]?.querySelector('.cell-stack > span')),
      arrived: text(c[4]?.querySelector('.cell-stack > small')),
      bag: bagRaw && !['-','--'].includes(bagRaw) ? bagRaw : '',
      action: text(c[7]?.querySelector('.cell-stack > span')) || '-',
      actionTime: text(c[7]?.querySelector('.cell-stack > small')) || '-',
      phone: text(c[8]?.querySelector('.cell-stack > small')) || '-',
      hubRaw,
      hub: cleanDestination(hubRaw) || '-',
      fd: cleanDestination(fdRaw) || '-',
    };
  }).filter((r) => r?.pno);
}
function currentRows() {
  const branch = String($('branch-select')?.value || '');
  if (branch !== cacheBranch) { cacheBranch = branch; cachedRows = []; }
  const rows = parseRows();
  if (rows.length) cachedRows = rows;
  return cachedRows.length ? cachedRows : rows;
}
function selectedBands() {
  return new Set([...document.querySelectorAll('[data-dashboard-band]')].filter((x) => x.checked).map((x) => x.dataset.dashboardBand));
}
function allTimes() { return selectedBands().size === BANDS.length; }
function selectedLH() { return String($('hub-filter')?.value || ''); }
function selectedFD() { return String($('branch-filter')?.value || ''); }
function selectedAction() { return String($('ops-action-filter')?.value || ''); }
function hasFull() { return !!fullAnalytics?.complete && Array.isArray(fullAnalytics?.cells); }
function filteredRows() {
  const bands = selectedBands(), lh = selectedLH(), fd = selectedFD(), action = selectedAction();
  return currentRows().filter((r) => {
    if (!allTimes() && !bands.has(ageBand(r.arrived))) return false;
    if (lh && (isOwnHub(r.hubRaw) || r.hub !== lh)) return false;
    if (fd && (!isOwnHub(r.hubRaw) || r.fd !== fd)) return false;
    if (action && r.action !== action) return false;
    return true;
  });
}
function filteredCells() {
  if (!hasFull()) return [];
  const bands = selectedBands(), lh = selectedLH(), fd = selectedFD(), action = selectedAction();
  return fullAnalytics.cells.filter((c) => {
    if (!allTimes() && !bands.has(c.b)) return false;
    if (lh && (c.r !== 'lh' || c.d !== lh)) return false;
    if (fd && (c.r !== 'fd' || c.d !== fd)) return false;
    if (action && c.a !== action) return false;
    return true;
  });
}
function cellMetrics(cells) {
  return cells.reduce((m,c) => { m.count += Number(c.c||0); m.weight += Number(c.w||0); m.bagged += Number(c.g||0); return m; }, {count:0,weight:0,bagged:0});
}
function groupCells(cells, keyFn) {
  const map = new Map();
  for (const c of cells) {
    const key = String(keyFn(c) || '-');
    const v = map.get(key) || {name:key,count:0,weight:0,latest:0};
    v.count += Number(c.c||0); v.weight += Number(c.w||0); v.latest = Math.max(v.latest, Number(c.t||0));
    map.set(key, v);
  }
  return [...map.values()].sort((a,b) => b.count-a.count || a.name.localeCompare(b.name,'th'));
}
function fmtKg(v) { return Number(v||0).toLocaleString('th-TH',{maximumFractionDigits:2}); }
function latestText(ms) { return ms ? new Date(ms).toLocaleString('th-TH') : '-'; }
function setOptions(select, values, keep) {
  if (!select) return;
  const unique = [...new Set(values.filter(Boolean))].sort((a,b) => a.localeCompare(b,'th'));
  const html = ['<option value="">ทั้งหมด</option>', ...unique.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`)].join('');
  if (select.innerHTML !== html) select.innerHTML = html;
  select.value = unique.includes(keep) ? keep : '';
}
function rebuildFilters() {
  const keepLH = selectedLH(), keepFD = selectedFD(), keepAction = selectedAction();
  if (hasFull()) {
    setOptions($('hub-filter'), (fullAnalytics.lh||[]).map((x)=>cleanDestination(x.name)), keepLH);
    setOptions($('branch-filter'), (fullAnalytics.fd||[]).map((x)=>cleanDestination(x.name)), keepFD);
    setOptions($('ops-action-filter'), (fullAnalytics.actions||[]).map((x)=>String(x.name||'')), keepAction);
  } else {
    const rows = currentRows();
    setOptions($('hub-filter'), rows.filter((r)=>!isOwnHub(r.hubRaw)).map((r)=>r.hub).filter((x)=>x!=='-'), keepLH);
    setOptions($('branch-filter'), rows.filter((r)=>isOwnHub(r.hubRaw)).map((r)=>r.fd).filter((x)=>x!=='-'), keepFD);
    setOptions($('ops-action-filter'), rows.map((r)=>r.action), keepAction);
  }
}
function applyRowVisibility() {
  const allowed = new Set(filteredRows().map((r)=>r.pno));
  const cards = [...document.querySelectorAll('#mobile-cards .mobile-card')];
  parseRows().forEach((r) => {
    const hidden = !allowed.has(r.pno);
    r.tr.classList.toggle('ops-filter-hidden', hidden);
    cards[r.index]?.classList.toggle('ops-filter-hidden', hidden);
  });
}
function renderStatus() {
  const detail = filteredRows();
  if (hasFull()) {
    const cells = filteredCells(), groups = groupCells(cells,(c)=>c.a), metrics = cellMetrics(cells);
    $('ops-status-total').textContent = fmt.format(metrics.count);
    $('ops-status-types').textContent = fmt.format(groups.length);
    $('ops-status-table').innerHTML = groups.length ? groups.map((g)=>`<tr><td>${esc(g.name)}</td><td>${fmt.format(g.count)}</td><td>${metrics.count?(g.count/metrics.count*100).toFixed(1):'0.0'}%</td><td>${esc(latestText(g.latest))}</td></tr>`).join('') : '<tr><td colspan="4">-</td></tr>';
  } else {
    $('ops-status-total').textContent = text($('m-total')) || '0';
    $('ops-status-types').textContent = '-';
    $('ops-status-table').innerHTML = '<tr><td colspan="4">รอข้อมูลรวม</td></tr>';
  }
  $('ops-status-detail').innerHTML = detail.length ? detail.map((r)=>`<tr><td>${esc(r.pno)}</td><td>${esc(r.action)}</td><td>${esc(r.actionTime)}</td><td>${esc(r.phone)}</td><td>${esc(isOwnHub(r.hubRaw)?'-':r.hub)}</td><td>${esc(isOwnHub(r.hubRaw)?r.fd:'-')}</td></tr>`).join('') : '<tr><td colspan="6">-</td></tr>';
}
function renderWeight() {
  if (!hasFull()) {
    $('ops-weight-parcels').textContent = text($('m-total')) || '0';
    $('ops-weight-total').textContent = '-'; $('ops-weight-avg').textContent = '-'; $('ops-weight-branches').textContent = '-'; $('ops-weight-lh-count').textContent = '-';
    $('ops-fd-table').innerHTML = '<tr><td colspan="4">รอข้อมูลรวม</td></tr>';
    $('ops-lh-table').innerHTML = '<tr><td colspan="4">รอข้อมูลรวม</td></tr>';
    return;
  }
  const cells = filteredCells(), metrics = cellMetrics(cells);
  const fds = groupCells(cells.filter((c)=>c.r==='fd'),(c)=>c.d), lhs = groupCells(cells.filter((c)=>c.r==='lh'),(c)=>c.d);
  $('ops-weight-parcels').textContent = fmt.format(metrics.count);
  $('ops-weight-total').textContent = `${fmtKg(metrics.weight)} kg`;
  $('ops-weight-avg').textContent = `${fmtKg(metrics.count?metrics.weight/metrics.count:0)} kg`;
  $('ops-weight-branches').textContent = fmt.format(fds.length); $('ops-weight-lh-count').textContent = fmt.format(lhs.length);
  $('ops-fd-table').innerHTML = fds.length ? fds.map((g)=>`<tr><td>${esc(g.name)}</td><td>${fmt.format(g.count)}</td><td>${fmtKg(g.weight)}</td><td>${fmtKg(g.count?g.weight/g.count:0)}</td></tr>`).join('') : '<tr><td colspan="4">-</td></tr>';
  $('ops-lh-table').innerHTML = lhs.length ? lhs.map((g)=>`<tr><td>${esc(g.name)}</td><td>${fmt.format(g.count)}</td><td>${fmtKg(g.weight)}</td><td>${fmtKg(g.count?g.weight/g.count:0)}</td></tr>`).join('') : '<tr><td colspan="4">-</td></tr>';
}
function renderBag() {
  const rows = filteredRows().filter((r)=>r.bag);
  const search = String($('bag-search')?.value||'').trim().toLowerCase();
  const shown = search ? rows.filter((r)=>r.bag.toLowerCase().includes(search)) : rows;
  if (hasFull()) {
    const metrics = cellMetrics(filteredCells());
    $('bag-parcels').textContent = fmt.format(metrics.bagged);
    $('bag-count').textContent = allTimes()&&!selectedLH()&&!selectedFD()&&!selectedAction() ? fmt.format(Number(fullAnalytics.uniqueBags||0)) : '-';
  } else {
    $('bag-parcels').textContent = fmt.format(rows.length);
    $('bag-count').textContent = fmt.format(new Set(rows.map((r)=>r.bag)).size);
  }
  $('ops-bag-detail-count').textContent = fmt.format(shown.length);
  $('ops-bag-detail').innerHTML = shown.length ? shown.map((r)=>`<tr><td>${esc(isOwnHub(r.hubRaw)?'-':r.hub)}</td><td>${esc(isOwnHub(r.hubRaw)?r.fd:'-')}</td><td>${esc(r.bag)}</td><td>${esc(r.pno)}</td><td>${esc(r.phone)}</td><td>${esc(r.actionTime)}</td></tr>`).join('') : '<tr><td colspan="6">-</td></tr>';
}
function renderAll() {
  rebuildFilters(); applyRowVisibility(); renderStatus(); renderWeight(); renderBag();
}
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => { scheduled = false; try { renderAll(); } catch (e) { console.error('[ops]',e); } });
}
function pageSection(name,title,body) {
  const s = document.createElement('section'); s.className='page-view hidden'; s.dataset.pageView=name; s.innerHTML=`<div class="page-title"><h2>${title}</h2></div>${body}`; return s;
}
function ensureStructure() {
  if (!document.querySelector('link[href^="ops.css"]')) { const css=document.createElement('link'); css.rel='stylesheet'; css.href='ops.css?v=20260906-2'; document.head.appendChild(css); }
  const main=document.querySelector('main.app-shell'), backlog=document.querySelector('[data-page-view="backlog"]'), bagging=document.querySelector('[data-page-view="bagging"]');
  if (main&&backlog&&!document.querySelector('[data-page-view="status"]')) main.insertBefore(pageSection('status','สถานะพัสดุ','<div class="ops-metric-grid"><article><span>พัสดุทั้งหมด</span><strong id="ops-status-total">0</strong></article><article><span>การดำเนินการล่าสุด</span><strong id="ops-status-types">0</strong></article></div><section class="panel ops-panel"><h3>สรุปการดำเนินการล่าสุด</h3><div class="ops-table-scroll compact"><table class="ops-table"><thead><tr><th>การดำเนินการล่าสุด</th><th>จำนวน</th><th>สัดส่วน</th><th>เวลาล่าสุด</th></tr></thead><tbody id="ops-status-table"></tbody></table></div></section><section class="panel ops-panel"><h3>รายการพัสดุ</h3><div class="ops-table-scroll"><table class="ops-table"><thead><tr><th>เลขพัสดุ</th><th>การดำเนินการล่าสุด</th><th>เวลา</th><th>เบอร์ผู้ดำเนินการ</th><th>LH ปลายทาง</th><th>FD ปลายทาง</th></tr></thead><tbody id="ops-status-detail"></tbody></table></div></section>'),backlog);
  if (main&&bagging&&!document.querySelector('[data-page-view="weight"]')) main.insertBefore(pageSection('weight','น้ำหนักสาขา','<div class="ops-metric-grid five"><article><span>พัสดุทั้งหมด</span><strong id="ops-weight-parcels">0</strong></article><article><span>น้ำหนักรวม</span><strong id="ops-weight-total">0 kg</strong></article><article><span>เฉลี่ย/ชิ้น</span><strong id="ops-weight-avg">0 kg</strong></article><article><span>FD</span><strong id="ops-weight-branches">0</strong></article><article><span>LH</span><strong id="ops-weight-lh-count">0</strong></article></div><section class="panel ops-panel"><h3>FD ปลายทาง</h3><div class="ops-table-scroll"><table class="ops-table"><thead><tr><th>FD ปลายทาง</th><th>จำนวนพัสดุ</th><th>น้ำหนักรวม kg</th><th>เฉลี่ย kg</th></tr></thead><tbody id="ops-fd-table"></tbody></table></div></section><section class="panel ops-panel"><h3>LH ปลายทาง</h3><div class="ops-table-scroll"><table class="ops-table"><thead><tr><th>LH ปลายทาง</th><th>จำนวนพัสดุ</th><th>น้ำหนักรวม kg</th><th>เฉลี่ย kg</th></tr></thead><tbody id="ops-lh-table"></tbody></table></div></section>'),bagging);
  const grid=document.querySelector('.global-destination-grid');
  if (grid&&!$('ops-action-filter')) { const label=document.createElement('label'); label.innerHTML='<span>การดำเนินการล่าสุด</span><select id="ops-action-filter"><option value="">ทั้งหมด</option></select>'; grid.insertBefore(label,grid.querySelector('.selected-inline')); }
  if (bagging&&!$('ops-bag-detail')) { const detail=document.createElement('section'); detail.className='panel ops-panel'; detail.innerHTML='<div class="ops-panel-head"><h3>รายการแบ็กกิ้ง</h3><span><b id="ops-bag-detail-count">0</b> รายการในหน้า</span></div><div class="ops-table-scroll"><table class="ops-table"><thead><tr><th>LH ปลายทาง</th><th>FD ปลายทาง</th><th>เลขแบ็กกิ้ง</th><th>เลขพัสดุ</th><th>เบอร์ผู้ดำเนินการล่าสุด</th><th>เวลาที่ดำเนินการล่าสุด</th></tr></thead><tbody id="ops-bag-detail"></tbody></table></div>'; bagging.querySelector('.bag-panel')?.after(detail); }
}
function init() {
  ensureStructure();
  $('hub-filter')?.addEventListener('change',()=>{ if($('hub-filter').value)$('branch-filter').value=''; schedule(); });
  $('branch-filter')?.addEventListener('change',()=>{ if($('branch-filter').value)$('hub-filter').value=''; schedule(); });
  $('ops-action-filter')?.addEventListener('change',schedule);
  $('bag-search')?.addEventListener('input',schedule);
  document.querySelectorAll('[data-dashboard-band]').forEach((el)=>el.addEventListener('change',schedule));
  $('branch-select')?.addEventListener('change',()=>{cachedRows=[];cacheBranch='';fullAnalytics=null;schedule();});
  const tbody=$('table-body'); if(tbody)new MutationObserver(schedule).observe(tbody,{childList:true});
  window.addEventListener('ms-full-analytics',(e)=>{fullAnalytics=e.detail||null;schedule();});
  schedule(); window.dispatchEvent(new CustomEvent('ms-ops-ready'));
}
if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();