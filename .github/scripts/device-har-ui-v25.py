from pathlib import Path
import re

OLD='20260906-handoff-v24'
NEW='20260906-device-har-v25'

# Bump frontend assets without touching Edge behavior.
for name in ['index.html','app.js','ops.js','analytics-client.js','snapshot-client.js','dropdowns.js']:
    p=Path(name)
    s=p.read_text(encoding='utf-8')
    s=s.replace(OLD,NEW)
    p.write_text(s,encoding='utf-8')

# Header: show current account/role and a shared HAR health banner.
p=Path('index.html')
s=p.read_text(encoding='utf-8')
s=s.replace('<div class="topbar-actions"><span id="connection-badge"', '<div class="topbar-actions"><span id="account-badge" class="account-badge hidden"></span><span id="connection-badge"', 1)
s=s.replace('<button id="manage-users-btn" class="btn btn-header hidden" type="button">ผู้ใช้</button><button id="manage-branches-btn" class="btn btn-header hidden" type="button">สาขา</button>', '<button id="manage-users-btn" class="btn btn-header hidden" type="button">จัดการผู้ใช้</button><button id="manage-branches-btn" class="btn btn-header hidden" type="button">จัดการสาขา</button>', 1)
heading='</section>\n\n    <section class="panel global-filter-bar">'
insert='</section>\n    <section id="har-health" class="har-health hidden" role="status" aria-live="polite"></section>\n\n    <section class="panel global-filter-bar">'
if heading not in s: raise SystemExit('index heading anchor not found')
s=s.replace(heading,insert,1)
p.write_text(s,encoding='utf-8')

# Make selected dropdown rows high-contrast. The old ops.css gave selected rows white text;
# dropdown-fix.css changed only the background, creating pale-blue + white text.
p=Path('dropdown-fix.css')
s=p.read_text(encoding='utf-8')
s=s.replace('.persistent-select-option:hover,.persistent-select-option[aria-selected="true"]{background:#eaf2ff}', '.persistent-select-option:hover{background:#eef5ff;color:#10263b}.persistent-select-option[aria-selected="true"]{background:#d9eaff;color:#10263b!important;font-weight:750;box-shadow:inset 0 0 0 1px #6f98c5}', 1)
p.write_text(s,encoding='utf-8')

# Remove the unattractive "ไม่ทราบ" column from the dashboard heat table only.
# Unknown-age data is still retained in filters/counts and is not discarded.
p=Path('ops.js')
s=p.read_text(encoding='utf-8')
new_heat=r'''function heatmap(cells){const shownBands=BANDS.filter(b=>b!=='unknown'),gs=groups(cells,c=>`${c.r}|${c.d}`).sort((x,y)=>y.bands.over48-x.bands.over48||y.count-x.count);const max=Math.max(1,...gs.flatMap(g=>shownBands.map(b=>g.bands[b])));return `<div class="work-section-head"><div><h3>จุดสะสมงานตามเวลาค้างจากดำเนินการล่าสุด</h3><span>สีเข้ม = จำนวนมากในช่วงเดียวกัน · กดช่องเพื่อเปิดรายการ</span></div>${button('คัดลอกตาราง','data-copy-table="heat"')}</div><div class="heat-scroll"><table class="heat-table"><thead><tr><th>ปลายทาง</th>${shownBands.map(b=>`<th>${LABELS[BANDS.indexOf(b)]}</th>`).join('')}</tr></thead><tbody>${gs.slice(0,20).map(g=>{const [r,...rest]=g.name.split('|'),d=rest.join('|');return `<tr><th>${r.toUpperCase()} · ${esc(d||'ไม่ระบุ')}</th>${shownBands.map(b=>{const i=BANDS.indexOf(b);return `<td data-label="${esc(LABELS[i])}">${button(num(g.bands[b]),`data-heat-band="${b}" data-destination="${esc(d)}" data-route="${r}" style="--intensity:${g.bands[b]?0.15+0.65*g.bands[b]/max:0}" aria-label="${esc(d)} ${LABELS[i]} ชั่วโมง ${g.bands[b]} ชิ้น"`)}</td>`;}).join('')}</tr>`;}).join('')}</tbody></table></div>${gs.length>20?`<p class="work-caption">แสดง 20 จาก ${gs.length} ปลายทาง · เลือกปลายทางด้านบนเพื่อดูเจาะจง</p>`:''}`;}'''
s,n=re.subn(r'function heatmap\(cells\)\{.*?\}\nfunction dashboard',new_heat+'\nfunction dashboard',s,count=1,flags=re.S)
if n!=1: raise SystemExit(f'heatmap replace failed {n}')
p.write_text(s,encoding='utf-8')

# Connection UX: separate shared MS/HAR state from this device's browser/network state.
p=Path('app.js')
s=p.read_text(encoding='utf-8')
s=s.replace("  profileRole: 'viewer',\n", "  profileRole: 'viewer',\n  profileUsername: '',\n  profileDisplayName: '',\n  connection: null,\n", 1)

set_conn='''function setConnection(type, text) {\n  $('connection-badge').className = `badge ${type === 'ok' ? 'badge-ok' : type === 'bad' ? 'badge-bad' : 'badge-neutral'}`;\n  $('connection-badge').textContent = text;\n  $('live-dot').className = `live-dot ${type === 'ok' ? 'live' : type === 'bad' ? 'error' : 'stale'}`;\n}\n'''
if set_conn not in s: raise SystemExit('setConnection anchor not found')
extra=set_conn+r'''

function isHarCredentialError(message) {
  const text = String(message || '').toLowerCase();
  if (!text) return false;
  return /\bms\s*(401|403)\b|unauthori[sz]ed|forbidden|auth(?:entication)?\s*(?:expired|invalid|fail)|session\s*(?:expired|invalid)|token\s*(?:expired|invalid)|cookie\s*(?:expired|invalid)|credential\s*(?:expired|invalid)|login\s*(?:expired|required)|หมดอายุ|เข้าสู่ระบบใหม่|ไม่อนุญาตให้อ่านข้อมูล/.test(text);
}

function statusTime(value) {
  const t = Date.parse(String(value || ''));
  return Number.isFinite(t) ? new Date(t).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : 'ยังไม่มี';
}

function notifyHarExpiredOnce(message) {
  const key = `ms-har-alert:${branchId()}:${String(message || '').slice(0,80)}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('MS Parcel Live', { body: `${currentBranch()?.code || ''} HAR ต้องอัปเดตเพื่ออ่านข้อมูล MS ต่อ` });
    }
  } catch {}
}

function renderHarHealth(conn = state.connection) {
  const el = $('har-health');
  if (!el) return;
  state.connection = conn || null;
  if (!state.session || !branchId()) { el.className = 'har-health hidden'; el.innerHTML = ''; return; }
  const credentialAt = conn?.credential_updated_at || '';
  const lastOk = conn?.last_ok_at || '';
  const error = String(conn?.last_error || '');
  const branchName = currentBranch()?.code || 'ต้นทางนี้';
  if (!credentialAt) {
    el.className = 'har-health neutral';
    el.innerHTML = `<strong>${branchName} · ยังไม่มี HAR</strong><span>อัปโหลด HAR ก่อนเริ่มอ่านข้อมูล MS</span>`;
    return;
  }
  if (error && isHarCredentialError(error)) {
    el.className = 'har-health bad';
    el.innerHTML = `<strong>${branchName} · HAR ต้องอัปเดต</strong><span>MS ปฏิเสธข้อมูลยืนยันตัวตน · สำเร็จล่าสุด ${statusTime(lastOk)} · กด HAR เพื่ออัปโหลดไฟล์ใหม่</span>`;
    notifyHarExpiredOnce(error);
    return;
  }
  if (error) {
    el.className = 'har-health warn';
    el.innerHTML = `<strong>${branchName} · MS ตรวจไม่สำเร็จชั่วคราว</strong><span>ยังไม่ถือว่า HAR หมดอายุ · สำเร็จล่าสุด ${statusTime(lastOk)} · ระบบจะลองใหม่ตามรอบเดิม</span>`;
    return;
  }
  el.className = 'har-health ok';
  el.innerHTML = `<strong>${branchName} · HAR ใช้งานได้</strong><span>MS สำเร็จล่าสุด ${statusTime(lastOk)} · HAR อัปเดต ${statusTime(credentialAt)}</span>`;
}

function markHarError(message) {
  if (!isHarCredentialError(message)) return false;
  state.connection = { ...(state.connection || {}), last_error: String(message || '') };
  renderHarHealth();
  setConnection('bad', 'HAR ต้องอัปเดต');
  return true;
}
'''
s=s.replace(set_conn,extra,1)

# Account identity: prevents viewer sessions from looking like a missing Admin menu.
s=s.replace("  const admin = active && state.profileRole === 'admin';\n  ensureAdminNav();", "  const admin = active && state.profileRole === 'admin';\n  const account = $('account-badge');\n  if (account) {\n    account.classList.toggle('hidden', !state.session);\n    account.textContent = state.session ? `${state.profileUsername || state.profileDisplayName || 'บัญชี'} · ${admin ? 'ผู้ดูแลระบบ' : 'ผู้ใช้งาน'}` : '';\n    account.title = admin ? 'บัญชีนี้จัดการผู้ใช้และสาขาได้' : 'เมนูจัดการผู้ใช้และสาขาแสดงเฉพาะบัญชีผู้ดูแลระบบ';\n  }\n  ensureAdminNav();", 1)
# More explicit Admin labels in the navigation.
s=s.replace("users.textContent = 'ผู้ใช้';", "users.textContent = 'จัดการผู้ใช้';", 1)
s=s.replace("branches.textContent = 'สาขา';", "branches.textContent = 'จัดการสาขา';", 1)

# Save profile identity and shared connection health from /status.
s=s.replace("  state.profileRole = p.role || 'viewer';\n", "  state.profileRole = p.role || 'viewer';\n  state.profileUsername = String(p.username || '');\n  state.profileDisplayName = String(p.display_name || '');\n", 1)
old_conn="""  const conn = d.connection;\n  if (conn?.last_error) setConnection('bad', 'MS มีปัญหา');\n  else if (conn?.credential_updated_at) setConnection('ok', 'ออนไลน์');\n  else setConnection('neutral', 'ยังไม่มี HAR');\n"""
new_conn="""  const conn = d.connection;\n  state.connection = conn || null;\n  renderHarHealth(conn);\n  if (!conn?.credential_updated_at) setConnection('neutral', 'ยังไม่มี HAR');\n  else if (conn?.last_error && isHarCredentialError(conn.last_error)) setConnection('bad', 'HAR ต้องอัปเดต');\n  else if (conn?.last_error) setConnection('neutral', 'MS ตรวจไม่สำเร็จ');\n  else setConnection('ok', 'MS เชื่อมต่อ');\n"""
if old_conn not in s: raise SystemExit('refreshStatus connection anchor not found')
s=s.replace(old_conn,new_conn,1)

# A successful shared live result proves the shared HAR path is working, regardless of device.
s=s.replace("  setConnection('ok', 'ออนไลน์');\n}", "  state.connection = { ...(state.connection || {}), last_error: null, last_ok_at: sourceAt || new Date().toISOString() };\n  renderHarHealth();\n  setConnection('ok', 'MS เชื่อมต่อ');\n}", 1)

# Stale server cache can carry the upstream MS error. Alert only if that error is credential-related.
s=s.replace("  if (out?.meta?.stale) setConnection('bad', 'ใช้ cache ล่าสุด');", "  if (out?.meta?.stale) { const upstream = String(out.meta.error || ''); if (!markHarError(upstream)) setConnection('neutral', 'ใช้ข้อมูลล่าสุด'); }", 1)
s=s.replace("    if (out.meta?.stale) setConnection('bad', 'ใช้ cache ล่าสุด');", "    if (out.meta?.stale) { const upstream = String(out.meta.error || ''); if (!markHarError(upstream)) setConnection('neutral', 'ใช้ข้อมูลล่าสุด'); }", 1)

# Device/browser failures must not be labelled as HAR failures.
s=s.replace("    setConnection('bad', 'เชื่อมต่อไม่ได้');\n    $('source-sync').textContent = e.message;", "    if (!markHarError(e.message)) setConnection('neutral', 'อุปกรณ์นี้เชื่อมต่อไม่ได้');\n    $('source-sync').textContent = e.message;", 1)
s=s.replace("    setConnection('bad', 'รีเฟรชไม่สำเร็จ');\n    scheduleLive(document.hidden ? 60000 : 15000);", "    if (!markHarError(e.message)) setConnection('neutral', 'อุปกรณ์นี้อัปเดตไม่ได้');\n    scheduleLive(document.hidden ? 60000 : 15000);", 1)
s=s.replace("    setConnection('bad', 'สลับสาขาไม่สำเร็จ');", "    if (!markHarError(e.message)) setConnection('neutral', 'สลับต้นทางไม่สำเร็จ');", 1)

# Clear account/connection health on logout.
s=s.replace("    setConnection('neutral', 'ยังไม่ได้เข้าสู่ระบบ');\n    $('source-sync').textContent = 'ยังไม่ได้เชื่อมต่อ';", "    state.profileUsername = ''; state.profileDisplayName = ''; state.connection = null;\n    renderHarHealth();\n    setConnection('neutral', 'ยังไม่ได้เข้าสู่ระบบ');\n    $('source-sync').textContent = 'ยังไม่ได้เชื่อมต่อ';", 1)
p.write_text(s,encoding='utf-8')

# Responsive styling for account identity and HAR banner. No new network calls.
p=Path('ops.css')
s=p.read_text(encoding='utf-8')
css=r'''

/* v25: distinguish shared HAR/MS health from this device's browser connection. */
.account-badge{display:inline-flex;align-items:center;min-height:36px;padding:6px 10px;border:1px solid #536579;border-radius:8px;background:#203249;color:#fff;font-size:13px;font-weight:700;white-space:nowrap}
.har-health{display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;margin:10px 0 0;padding:10px 14px;border-radius:10px;border:1px solid var(--line);text-align:center;font-size:14px;background:#fff}
.har-health strong{font-size:14px}.har-health span{color:var(--muted)}
.har-health.ok{border-color:#8fc9b3;background:#eef9f4}.har-health.ok strong{color:#176b4f}
.har-health.warn{border-color:#e1bd70;background:#fff8e8}.har-health.warn strong{color:#78500a}
.har-health.bad{border-color:#df8d98;background:#fff0f2}.har-health.bad strong{color:#992a3d}.har-health.bad span{color:#76283a}
.har-health.neutral{background:#f7f9fb}
.badge-warn{background:#fff1cf!important;color:#72500b!important}
@media(max-width:640px){.account-badge{width:100%;justify-content:center;order:10}.har-health{align-items:flex-start;flex-direction:column;text-align:left;padding:10px 12px}.har-health strong,.har-health span{width:100%}}
'''
if 'v25: distinguish shared HAR/MS health' not in s: s += css
p.write_text(s,encoding='utf-8')

# Extend UI tests: heat table no longer shows the unknown header; operational pieces remain.
p=Path('tests-ui.mjs')
t=p.read_text(encoding='utf-8')
anchor="assert.match(w.document.querySelector('#work-dashboard').textContent,/ปลายทางที่ต้องติดตาม/);"
if anchor not in t: raise SystemExit('tests dashboard anchor not found')
t=t.replace(anchor, anchor+"assert.doesNotMatch(w.document.querySelector('.heat-table thead').textContent,/ไม่ทราบ/);", 1)
Path('tests-ui.mjs').write_text(t,encoding='utf-8')

# Docs note.
p=Path('README.md')
r=p.read_text(encoding='utf-8')
r += '\n\n## Device/HAR status v25\n- dropdown ที่เลือกแล้วใช้สีตัวอักษรเข้มบนพื้นฟ้า อ่านได้ชัดทั้งมือถือและคอม\n- Heatmap ไม่แสดงคอลัมน์หัวตาราง “ไม่ทราบ” แต่ข้อมูลอายุไม่ทราบยังไม่ถูกทิ้ง\n- Header แสดงชื่อบัญชีและระดับสิทธิ์ เพื่อแยกกรณีบัญชีผู้ใช้งานกับผู้ดูแลระบบ\n- HAR health ใช้ผลจาก MS ที่ backend มีอยู่แล้ว: แจ้ง “HAR ต้องอัปเดต” เฉพาะ error ยืนยันตัวตน และแยกออกจากปัญหา network/browser ของอุปกรณ์\n- ฟีเจอร์นี้ไม่เพิ่ม polling หรือ request ไป MS\n'
p.write_text(r,encoding='utf-8')
