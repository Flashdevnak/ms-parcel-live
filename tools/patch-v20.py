from pathlib import Path


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def replace_once(path, old, new):
    text = read(path)
    if old not in text:
        raise SystemExit(f'MISSING in {path}: {old[:160]!r}')
    write(path, text.replace(old, new, 1))


def replace_all(path, old, new, minimum=1):
    text = read(path)
    count = text.count(old)
    if count < minimum:
        raise SystemExit(f'MISSING in {path}: expected {minimum}, found {count}: {old[:160]!r}')
    write(path, text.replace(old, new))


def replace_line_start(path, prefix, new_line):
    lines = read(path).splitlines()
    hits = [i for i, line in enumerate(lines) if line.startswith(prefix)]
    if len(hits) != 1:
        raise SystemExit(f'{path}: expected one line starting {prefix!r}, found {len(hits)}')
    lines[hits[0]] = new_line
    write(path, '\n'.join(lines) + '\n')


# -----------------------------------------------------------------------------
# 1) Persistent dropdown component. It deliberately keeps the panel open after
# choosing an option. It closes only on explicit Close/Escape, outside click,
# or when another dropdown is opened. Re-rendered selects can reopen by key.
# -----------------------------------------------------------------------------
dropdowns = r'''(()=>{
  const registry=new Map();
  let opened=null,openKey='';
  const keyOf=(select)=>select.id?`id:${select.id}`:select.name?`name:${select.name}`:'';
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  function close(root,{clearKey=true}={}){
    if(!root)return;
    root.classList.remove('open');
    root.querySelector('.persistent-select-trigger')?.setAttribute('aria-expanded','false');
    if(opened===root)opened=null;
    if(clearKey)openKey='';
  }
  function position(root){
    if(!root?.isConnected||!root.classList.contains('open'))return;
    const trigger=root.querySelector('.persistent-select-trigger');
    const panel=root.querySelector('.persistent-select-panel');
    if(!trigger||!panel)return;
    const r=trigger.getBoundingClientRect();
    const vw=Math.max(document.documentElement.clientWidth||0,window.innerWidth||0);
    const vh=Math.max(document.documentElement.clientHeight||0,window.innerHeight||0);
    const desired=Math.min(760,Math.max(r.width,380),Math.max(280,vw-24));
    panel.style.width=`${desired}px`;
    panel.style.left=`${clamp(r.left,12,Math.max(12,vw-desired-12))}px`;
    panel.style.maxHeight=`${Math.max(220,Math.min(560,vh-32))}px`;
    const below=vh-r.bottom,above=r.top;
    if(below>=Math.min(330,above)){
      panel.style.top=`${Math.min(vh-12,r.bottom+6)}px`;
      panel.style.bottom='auto';
    }else{
      panel.style.top='auto';
      panel.style.bottom=`${Math.max(12,vh-r.top+6)}px`;
    }
  }
  function selectedText(select){
    return String(select.selectedOptions?.[0]?.textContent||select.options?.[select.selectedIndex]?.textContent||'เลือก').trim();
  }
  function sync(root,select){
    const trigger=root.querySelector('.persistent-select-trigger');
    const list=root.querySelector('.persistent-select-options');
    if(!trigger||!list)return;
    const label=selectedText(select)||'เลือก';
    trigger.querySelector('span').textContent=label;
    trigger.title=label;
    trigger.disabled=select.disabled;
    const frag=document.createDocumentFragment();
    for(const option of select.options){
      const b=document.createElement('button');
      b.type='button';
      b.className='persistent-select-option';
      b.dataset.value=option.value;
      b.textContent=String(option.textContent||option.value);
      b.title=String(option.textContent||option.value);
      b.disabled=option.disabled;
      b.setAttribute('role','option');
      b.setAttribute('aria-selected',String(option.value===select.value));
      b.addEventListener('click',(e)=>{
        e.preventDefault();e.stopPropagation();
        select.value=option.value;
        select.dispatchEvent(new Event('change',{bubbles:true}));
        sync(root,select);
        // Selection intentionally does not close this dropdown.
        openKey=keyOf(select);
        queueMicrotask(()=>{
          const replacement=[...registry.keys()].find(s=>keyOf(s)===openKey&&s.isConnected);
          const replacementRoot=replacement&&registry.get(replacement);
          if(replacementRoot){
            if(opened&&opened!==replacementRoot)close(opened,{clearKey:false});
            opened=replacementRoot;
            replacementRoot.classList.add('open');
            replacementRoot.querySelector('.persistent-select-trigger')?.setAttribute('aria-expanded','true');
            position(replacementRoot);
          }
        });
      });
      frag.appendChild(b);
    }
    list.replaceChildren(frag);
    if(root.classList.contains('open'))position(root);
  }
  function open(root,select){
    if(opened&&opened!==root)close(opened,{clearKey:false});
    opened=root;openKey=keyOf(select);
    root.classList.add('open');
    root.querySelector('.persistent-select-trigger')?.setAttribute('aria-expanded','true');
    sync(root,select);position(root);
  }
  function enhance(select){
    if(!select||registry.has(select)||select.dataset.persistentSelect==='1')return;
    select.dataset.persistentSelect='1';
    select.classList.add('persistent-native');
    const root=document.createElement('div');
    root.className='persistent-select';
    root.innerHTML='<button type="button" class="persistent-select-trigger" aria-haspopup="listbox" aria-expanded="false"><span></span><i aria-hidden="true">▾</i></button><div class="persistent-select-panel" role="dialog"><div class="persistent-select-head"><strong>เลือกข้อมูล</strong><button type="button" class="persistent-select-close">ปิด</button></div><div class="persistent-select-options" role="listbox"></div></div>';
    select.insertAdjacentElement('afterend',root);
    registry.set(select,root);
    const trigger=root.querySelector('.persistent-select-trigger');
    trigger.addEventListener('click',(e)=>{
      e.preventDefault();e.stopPropagation();
      if(root.classList.contains('open'))close(root);
      else open(root,select);
    });
    root.querySelector('.persistent-select-close').addEventListener('click',(e)=>{e.preventDefault();e.stopPropagation();close(root);});
    select.addEventListener('change',()=>sync(root,select));
    new MutationObserver(()=>sync(root,select)).observe(select,{childList:true,subtree:true,attributes:true});
    sync(root,select);
    if(openKey&&keyOf(select)===openKey)queueMicrotask(()=>open(root,select));
  }
  function scan(scope=document){scope.querySelectorAll?.('select').forEach(enhance);}
  function syncAll(){for(const [select,root] of registry){if(select.isConnected)sync(root,select);}}
  function init(){
    scan(document);
    new MutationObserver((records)=>{
      for(const record of records)for(const node of record.addedNodes){
        if(node.nodeType!==1)continue;
        if(node.matches?.('select'))enhance(node);
        scan(node);
      }
      if(opened&&!opened.isConnected)opened=null;
    }).observe(document.body,{childList:true,subtree:true});
  }
  document.addEventListener('click',(e)=>{if(opened&&!opened.contains(e.target))close(opened);});
  document.addEventListener('keydown',(e)=>{if(e.key==='Escape'&&opened)close(opened);});
  window.addEventListener('resize',()=>position(opened));
  window.addEventListener('scroll',()=>position(opened),true);
  window.addEventListener('ms-select-sync',syncAll);
  window.MSPersistentSelect={init,syncAll,closeCurrent:()=>close(opened)};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
'''
write('dropdowns.js', dropdowns)

# -----------------------------------------------------------------------------
# 2) Waiting-time semantics and manager identity.
# -----------------------------------------------------------------------------
replace_once(
    'data-model.js',
    "export const managerValue=r=>String(r?.store_manager_display||[r?.store_id&&`(${r.store_id})`,r?.store_name,r?.store_manager_name,r?.store_manager_phone].filter(Boolean).join(' · ')||r?.store_manager_phone||'-').trim()||'-';",
    "export function managerValue(r){const full=String(r?.store_manager_display||'').trim();if(full)return full;const managerName=String(r?.store_manager_name||'').trim(),managerPhone=String(r?.store_manager_phone||'').trim();if(!managerName&&!managerPhone)return'-';const storeId=String(r?.store_id||'').trim(),storeName=String(r?.store_name||'').trim(),storeLabel=`${storeId?`(${storeId})`:''}${storeName}`.trim();return [storeLabel,managerName,managerPhone].filter(Boolean).join(' · ')||'-';}"
)
replace_once('data-model.js', 'b:band(r.real_arrive_time,now)', 'b:band(r.LastActionTime,now)')
replace_once('data-model.js', "g.critical ||= band(r.real_arrive_time,now)==='over48'", "g.critical ||= band(r.LastActionTime,now)==='over48'")
replace_once('data-model.js', 'const b=band(r.real_arrive_time,now),p=time(r.plan_leave_time);', 'const b=band(r.LastActionTime,now),p=time(r.plan_leave_time);')

# Analytics semantics change => schema 9.
replace_all('supabase/functions/ms-parcel-api/analytics.ts', 'schemaVersion:8', 'schemaVersion:9', 2)
replace_once('supabase/functions/ms-parcel-api/analytics.ts', 'band=bandOf(row?.real_arrive_time,now)', 'band=bandOf(row?.LastActionTime,now)')
replace_once('supabase/functions/ms-parcel-api/index.ts', 'schemaVersion===8', 'schemaVersion===9')
replace_once('analytics-client.js', 'schemaVersion===8', 'schemaVersion===9')

# Live page risk also follows latest action.
replace_once('app.js', '  const arrivedAt = parseMsTime(row.real_arrive_time);', '  const lastActionAt = parseMsTime(row.LastActionTime);')
replace_once('app.js', '  const ageHours = Number.isFinite(arrivedAt) && now >= arrivedAt ? (now - arrivedAt) / 3600000 : null;', '  const ageHours = Number.isFinite(lastActionAt) && now >= lastActionAt ? (now - lastActionAt) / 3600000 : null;')
replace_once('app.js', "else parts.push(`ค้าง ${formatMinutes(risk.ageHours * 60)}`);", "else parts.push(`ค้างจากดำเนินการล่าสุด ${formatMinutes(risk.ageHours * 60)}`);")
replace_once('app.js', '? `<span class="risk-chip risk-missed">ตกรอบ ${esc(formatMinutes(risk.overdueMinutes))}</span>`', '? `<span class="risk-chip risk-missed">เกินเวลาแผน ${esc(formatMinutes(risk.overdueMinutes))}</span>`')
replace_once('app.js', "window.dispatchEvent(new CustomEvent('ms-live-state',{detail:{total:state.total,count:state.rows.length,sourceAt,branchId:branchId()}}));", "window.__MS_LIVE_ROWS=state.rows;window.dispatchEvent(new CustomEvent('ms-live-state',{detail:{total:state.total,count:state.rows.length,rows:state.rows,sourceAt,branchId:branchId()}}));")

manager_helper = """const managerText = (r) => {
  const full = String(r?.store_manager_display || '').trim();
  if (full) return full;
  const managerName = String(r?.store_manager_name || '').trim();
  const managerPhone = String(r?.store_manager_phone || '').trim();
  if (!managerName && !managerPhone) return '-';
  const storeId = String(r?.store_id || '').trim();
  const storeName = String(r?.store_name || '').trim();
  const storeLabel = `${storeId ? `(${storeId})` : ''}${storeName}`.trim();
  return [storeLabel, managerName, managerPhone].filter(Boolean).join(' · ') || '-';
};
"""
replace_once('app.js', "const customerType = (r) => (r.ka_name || r.ka_id ? 'KA' : val(r.customer_type_category));\n", "const customerType = (r) => (r.ka_name || r.ka_id ? 'KA' : val(r.customer_type_category));\n" + manager_helper)

# Admin menu: keep backend authorization, but restore clear navigation for admins.
old_permissions = """function updateHeaderPermissions() {
  const active = state.accessStatus === 'active';
  $('manage-users-btn').classList.toggle('hidden', !(active && state.profileRole === 'admin'));
  $('manage-branches-btn').classList.toggle('hidden', !(active && state.profileRole === 'admin'));
  $('upload-har-btn').classList.toggle('hidden', !(active && branchId() && canUploadCurrentBranch()));
  $('refresh-btn').classList.toggle('hidden', !active);
  $('logout-btn').classList.toggle('hidden', !state.session);
}
"""
new_permissions = """function ensureAdminNav() {
  const nav = document.querySelector('.app-nav-inner');
  if (!nav) return;
  if (!$('nav-users-btn')) {
    const users = document.createElement('button');
    users.id = 'nav-users-btn'; users.type = 'button'; users.className = 'app-nav-btn admin-nav-btn hidden'; users.textContent = 'ผู้ใช้';
    users.addEventListener('click', () => { $('users-dialog').showModal(); void loadUsers(); });
    nav.appendChild(users);
  }
  if (!$('nav-branches-btn')) {
    const branches = document.createElement('button');
    branches.id = 'nav-branches-btn'; branches.type = 'button'; branches.className = 'app-nav-btn admin-nav-btn hidden'; branches.textContent = 'สาขา';
    branches.addEventListener('click', () => { $('branches-dialog').showModal(); void loadBranches(); });
    nav.appendChild(branches);
  }
}

function updateHeaderPermissions() {
  const active = state.accessStatus === 'active';
  const admin = active && state.profileRole === 'admin';
  ensureAdminNav();
  $('manage-users-btn').classList.toggle('hidden', !admin);
  $('manage-branches-btn').classList.toggle('hidden', !admin);
  $('nav-users-btn')?.classList.toggle('hidden', !admin);
  $('nav-branches-btn')?.classList.toggle('hidden', !admin);
  document.querySelector('.app-nav-inner')?.classList.toggle('has-admin-actions', admin);
  $('upload-har-btn').classList.toggle('hidden', !(active && branchId() && canUploadCurrentBranch()));
  $('refresh-btn').classList.toggle('hidden', !active);
  $('logout-btn').classList.toggle('hidden', !state.session);
}
"""
replace_once('app.js', old_permissions, new_permissions)
replace_once('app.js', "  $('branch-select-wrap').classList.toggle('hidden', !state.session || state.branches.length === 0);\n}", "  $('branch-select-wrap').classList.toggle('hidden', !state.session || state.branches.length === 0);\n  window.MSPersistentSelect?.syncAll?.();\n}")
replace_once('app.js', "  if (values.includes(keep)) el.value = keep;\n}", "  if (values.includes(keep)) el.value = keep;\n  window.MSPersistentSelect?.syncAll?.();\n}")

# Copy the visible legacy/live parcel table as TSV.
live_copy = r'''
async function copyLiveTable() {
  const now = Date.now();
  const rows = filteredRows(now);
  if (!rows.length) { $('last-refresh').textContent = 'ไม่มีข้อมูลในตารางสำหรับคัดลอก'; return; }
  const cleanCell = (v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim();
  const header = ['เลขพัสดุ','สถานะ','เวลาค้างจากดำเนินการล่าสุด','COD','น้ำหนัก','เวลาแผน','ถึงจริง','แบ็กกิ้ง','สาเหตุคงคลัง','ดำเนินการล่าสุด','เวลาดำเนินการล่าสุด','ผู้ดำเนินการ','ผู้จัดการสาขา','LH','FD','จังหวัด','อำเภอ','ไปรษณีย์','ประเภทลูกค้า','ลูกค้า'];
  const lines = [header.join('\t'), ...rows.map((r) => {
    const risk = rowRisk(r, now);
    return [r.pno,r.state_name,risk.ageHours===null?'ไม่ทราบ':formatMinutes(risk.ageHours*60),r.cod_amount,kg(r.store_weight),r.plan_leave_time,r.real_arrive_time,r.pack_num,r.marker_category_name,r.LastAction_name,r.LastActionTime,[r.staff_info_name,r.staff_info_phone].filter(Boolean).join(' '),managerText(r),r.dst_hub_name,r.dst_store_name,r.dst_province_name,r.dst_city_name,r.dst_postal_code,customerType(r),r.ka_name].map(cleanCell).join('\t');
  })];
  try { await navigator.clipboard.writeText(lines.join('\n')); $('last-refresh').textContent = `คัดลอกตาราง ${fmt.format(rows.length)} รายการแล้ว`; }
  catch (e) { $('last-refresh').textContent = `คัดลอกตารางไม่สำเร็จ: ${e.message}`; }
}

'''
replace_once('app.js', 'function branchOptions(selected) {', live_copy + 'function branchOptions(selected) {')
copy_button = """if (!$('copy-table-btn')) {
  const button = document.createElement('button');
  button.id = 'copy-table-btn'; button.className = 'btn btn-header'; button.type = 'button'; button.textContent = 'คัดลอกตาราง';
  document.querySelector('.pager-actions')?.prepend(button);
}
$('copy-table-btn')?.addEventListener('click', () => void copyLiveTable());

"""
replace_once('app.js', "$('logout-btn').addEventListener('click', () => supabase.auth.signOut());\n", copy_button + "$('logout-btn').addEventListener('click', () => supabase.auth.signOut());\n")

# -----------------------------------------------------------------------------
# 3) Workspace pages: live fallback + status fully expanded + table-copy actions.
# -----------------------------------------------------------------------------
replace_once(
    'ops.js',
    "let a=null,rows=[],branch={},live=null,summary=null,analyticsState='waiting',detailError='',loadingRows=false,renderQueued=false,view='dashboard',page=1,risk='all',routeTab='fd',routeSort='risk',bagIssue='all',bagQuery='',listQuery='',listStatus='',generation=0;",
    "let a=null,rows=[],liveRows=Array.isArray(window.__MS_LIVE_ROWS)?window.__MS_LIVE_ROWS:[],branch={},live=null,summary=null,analyticsState='waiting',detailError='',loadingRows=false,renderQueued=false,view='dashboard',page=1,risk='all',routeTab='fd',routeSort='risk',bagIssue='all',bagQuery='',listQuery='',listStatus='',generation=0;"
)
replace_once(
    'ops.js',
    "const selectedRows=()=>snapshotReady()?rows.filter(r=>rowMatch(r,filters(),branch,now())):[];",
    "const fullDetailsReady=()=>snapshotReady()&&fresh();\nconst detailRows=()=>fullDetailsReady()?rows:liveRows;\nconst detailNow=()=>fullDetailsReady()?now():Date.now();\nconst selectedRows=()=>detailRows().filter(r=>rowMatch(r,filters(),branch,detailNow()));"
)
replace_once(
    'ops.js',
    "function rebuildFilters(){if(!usable())return;options($('hub-filter'),a.lh.map(g=>g.name));options($('branch-filter'),a.fd.map(g=>g.name));options($('ops-action-filter'),a.actions.map(g=>g.name));options($('manager-phone-filter'),a.managerPhones.map(g=>g.name));}",
    "function rebuildFilters(){if(!usable())return;options($('hub-filter'),a.lh.map(g=>g.name));options($('branch-filter'),a.fd.map(g=>g.name));options($('ops-action-filter'),a.actions.map(g=>g.name));options($('manager-phone-filter'),a.managerPhones.map(g=>g.name));window.MSPersistentSelect?.syncAll?.();}"
)
replace_once(
    'ops.js',
    "function chart(gs,dimension,total){const max=Math.max(1,...gs.map(g=>g.count));const item=g=>`<button class=\"work-bar\" data-chart=\"${dimension}\" data-value=\"${esc(g.name)}\"><span>${esc(g.name)}</span><b>${num(g.count)} <small>${total?(g.count/total*100).toFixed(1):0}%</small></b><i><em style=\"width:${g.count/max*100}%\"></em></i></button>`;return gs.length?gs.slice(0,10).map(item).join('')+(gs.length>10?`<details class=\"work-more\"><summary>ดูอีก ${gs.length-10} กลุ่ม · ${num(gs.slice(10).reduce((s,g)=>s+g.count,0))} ชิ้น</summary>${gs.slice(10).map(item).join('')}</details>`:''):blank('ไม่พบข้อมูลตามตัวกรอง');}",
    "function chart(gs,dimension,total,full=false){const max=Math.max(1,...gs.map(g=>g.count));const item=g=>`<button class=\"work-bar\" data-chart=\"${dimension}\" data-value=\"${esc(g.name)}\"><span>${esc(g.name)}</span><b>${num(g.count)} <small>${total?(g.count/total*100).toFixed(1):0}%</small></b><i><em style=\"width:${g.count/max*100}%\"></em></i></button>`;if(!gs.length)return blank('ไม่พบข้อมูลตามตัวกรอง');if(full)return gs.map(item).join('');return gs.slice(0,10).map(item).join('')+(gs.length>10?`<details class=\"work-more\"><summary>ดูอีก ${gs.length-10} กลุ่ม · ${num(gs.slice(10).reduce((s,g)=>s+g.count,0))} ชิ้น</summary>${gs.slice(10).map(item).join('')}</details>`:'');}"
)
replace_once(
    'ops.js',
    "function statusView(){if(!usable())return blank();const cells=selectedCells(),m=metrics(cells);return `<div class=\"work-actions-line\"><strong>${num(m.count)} รายการตามตัวกรอง</strong>${button('เปิดรายการ','data-open=\"parcels\"')}</div><div class=\"work-charts\">${[['การดำเนินการล่าสุด','action',cells,c=>c.a],['LH ปลายทาง','lh',cells.filter(c=>c.r==='lh'),c=>c.d],['FD ปลายทาง','fd',cells.filter(c=>c.r==='fd'),c=>c.d]].map(([title,dim,cs,key])=>`<section class=\"work-panel\"><h3>${title}</h3>${chart(groups(cs,key),dim,metrics(cs).count)}</section>`).join('')}</div>`;}",
    "function statusView(){if(!usable())return blank();const cells=selectedCells(),m=metrics(cells);return `<div class=\"work-actions-line\"><strong>${num(m.count)} รายการตามตัวกรอง</strong>${button('เปิดรายการ','data-open=\"parcels\"')}</div><div class=\"work-charts\">${[['การดำเนินการล่าสุด','action',cells,c=>c.a],['LH ปลายทาง','lh',cells.filter(c=>c.r==='lh'),c=>c.d],['FD ปลายทาง','fd',cells.filter(c=>c.r==='fd'),c=>c.d]].map(([title,dim,cs,key])=>`<section class=\"work-panel\"><div class=\"work-section-head\"><h3>${title}</h3>${button('คัดลอกตาราง',`data-copy-table=\"status-${dim}\"`)}</div>${chart(groups(cs,key),dim,metrics(cs).count,true)}</section>`).join('')}</div>`;}"
)
replace_once(
    'ops.js',
    "function rowBadge(r){const b=band(r.real_arrive_time,now());return `<span class=\"age-badge age-${BANDS.indexOf(b)}\">${LABELS[BANDS.indexOf(b)]}${b==='unknown'?'':' ชม.'}</span>${time(r.plan_leave_time)<now()?'<span class=\"overdue-badge\">เกินเวลาแผน</span>':''}`;}",
    "function rowBadge(r){const current=detailNow(),b=band(r.LastActionTime,current);return `<span class=\"age-badge age-${BANDS.indexOf(b)}\">${LABELS[BANDS.indexOf(b)]}${b==='unknown'?'':' ชม.'}</span>${time(r.plan_leave_time)<current?'<span class=\"overdue-badge\">เกินเวลาแผน</span>':''}`;}"
)
replace_once(
    'ops.js',
    "function listedRows(){return selectedRows().filter(r=>rowMatch(r,{q:listQuery,status:listStatus},branch,now())&&(view!=='backlog'||riskMatch(r,risk,now()))&&(listMode!=='nobag'||!hasBag(r)&&['24to48','over48'].includes(band(r.real_arrive_time,now()))));}",
    "function listedRows(){const current=detailNow();return selectedRows().filter(r=>rowMatch(r,{q:listQuery,status:listStatus},branch,current)&&(view!=='backlog'||riskMatch(r,risk,current))&&(listMode!=='nobag'||!hasBag(r)&&['24to48','over48'].includes(band(r.LastActionTime,current))));}"
)

new_row_list = r'''function rowList(){const source=detailRows();if(!source.length)return blank(detailError||(loadingRows?'กำลังเตรียมรายละเอียดทั้งคลัง':'ยังไม่มีข้อมูลสดในหน้าปัจจุบัน'))+(ready()?button('ลองโหลดรายละเอียดทั้งคลัง','data-load-rows'):'');let data=listedRows();const current=detailNow();if(view==='backlog')data.sort((x,y)=>(band(y.LastActionTime,current)==='over48')-(band(x.LastActionTime,current)==='over48')||(time(x.LastActionTime)||Infinity)-(time(y.LastActionTime)||Infinity));const pager=pagination(data.length),full=fullDetailsReady(),scope=full?'ข้อมูลทั้งคลังจาก Full Snapshot':`ข้อมูลสดหน้าปัจจุบัน ${num(source.length)} รายการ · ทั้งสาขา ${num(live?.total||source.length)} รายการ`;return `${full?'':`<div class="partial-notice live-fallback-notice" role="status"><strong>กำลังแสดงข้อมูลสดที่มีอยู่ทันที</strong><span>${scope} · ระบบจะสลับเป็นข้อมูลทั้งคลังอัตโนมัติเมื่อ Full Snapshot พร้อม</span></div>`}<div class="work-actions-line"><span>${num(data.length)} รายการตามตัวกรอง${listMode==='nobag'?' · ไม่มีแบ็กเกิน 24 ชม.':''} · ${scope}</span><div class="work-actions">${button('คัดลอกเลขพัสดุ','data-copy="list"','primary')}${button('คัดลอกตาราง','data-copy-table="list"')}</div></div>${pager}<div class="parcel-list">${data.slice((page-1)*60,page*60).map(r=>{const d=route(r,branch);return `<button class="parcel-row" data-parcel="${esc(r.pno)}"><div><strong>${esc(r.pno)}</strong><span>${esc(r.LastAction_name||'ไม่ระบุการดำเนินการ')} · ${esc(r.LastActionTime||'ไม่ระบุเวลา')}</span></div><div><span class="route-tag ${d.r}">${d.r.toUpperCase()}</span><b>${esc(d.d||'ไม่ระบุปลายทาง')}</b></div><div>${rowBadge(r)}</div><div><span>แบ็ก ${esc(r.pack_num||'—')}</span><span>ผจก. ${esc(managerValue(r))}</span></div><span class="open-detail">ดูรายละเอียด →</span></button>`;}).join('')||blank('ไม่พบพัสดุตามตัวกรอง')}</div>${pager}`;}'''
replace_line_start('ops.js', 'function rowList(){', new_row_list)

new_bag_list = r'''function bagList(){const source=detailRows();if(!source.length)return blank(detailError||'ยังไม่มีข้อมูลแบ็กกิ้งในหน้าปัจจุบัน')+(ready()?button('ลองโหลดรายละเอียดทั้งคลัง','data-load-rows'):'');const current=detailNow(),fullGroups=bags(source,branch,current),matches=fullGroups.map(g=>({...g,selected:g.rows.filter(r=>rowMatch(r,filters(),branch,current))})).filter(g=>g.selected.length&&(!bagQuery||g.id.toLowerCase().includes(bagQuery.toLowerCase())||g.selected.some(r=>String(r.pno).toLowerCase().includes(bagQuery.toLowerCase())))&&(bagIssue==='all'||bagIssue==='mixed'&&g.mixed||bagIssue==='overdue'&&g.overdue||bagIssue==='stale'&&g.stale));const byDest=new Map();for(const g of matches){const arr=byDest.get(g.destination)||[];arr.push(g);byDest.set(g.destination,arr);}const dests=[...byDest].sort((x,y)=>y[1].reduce((s,g)=>s+g.selected.length,0)-x[1].reduce((s,g)=>s+g.selected.length,0)),pager=pagination(dests.length,8),full=fullDetailsReady(),scope=full?'ข้อมูลทั้งคลัง':`ข้อมูลสดหน้าปัจจุบัน ${num(source.length)} รายการ`;return `${full?'':`<div class="partial-notice live-fallback-notice" role="status"><strong>กำลังแสดงแบ็กกิ้งจากข้อมูลสดที่มีอยู่</strong><span>${scope} · เมื่อ Full Snapshot พร้อมระบบจะสลับเป็นทั้งคลังอัตโนมัติ</span></div>`}<div class="weight-totals"><div>พัสดุตามตัวกรอง<b>${num(matches.reduce((s,g)=>s+g.selected.length,0))} ชิ้น</b></div><div>แบ็ก<b>${num(matches.length)}</b></div><div>ปลายทางปน<b>${num(matches.filter(g=>g.mixed).length)}</b></div></div><div class="work-actions-line"><span>ตรวจปลายทางปนจากสมาชิกทั้งแบ็ก · ${scope}</span><div class="work-actions">${button('คัดลอกเลขพัสดุที่กรอง','data-copy="bags"','primary')}${button('คัดลอกตาราง','data-copy-table="bags"')}</div></div>${pager}${dests.slice((page-1)*8,page*8).map(([key,gs])=>`<section class="work-panel"><div class="work-section-head"><h3>${esc(key.replace('|',' · ').toUpperCase())}</h3><strong>${gs.length} แบ็ก · ${num(gs.reduce((s,g)=>s+g.selected.length,0))} ชิ้น</strong></div><div class="bag-grid">${gs.slice(0,bagLimits.get(key)||24).map(g=>`<article class="work-bag ${g.mixed?'mixed':''}"><div><strong>${esc(g.id)}</strong><span>${g.mixed?'ปลายทางปน':'ปลายทางเดียว'}</span></div><b>${num(g.selected.length)} / ${num(g.rows.length)} ชิ้น</b><small>ตามตัวกรอง / ทั้งแบ็ก${g.stale?' · ไม่อัปเดตเกิน 6 ชม.':''}</small><details data-bag-details="${esc(g.id)}"><summary>แสดงเลขพัสดุ</summary><div class="bag-numbers"></div></details>${button('คัดลอกเลขพัสดุ',`data-copy-bag="${esc(g.id)}"`)}</article>`).join('')}</div>${gs.length>(bagLimits.get(key)||24)?button('ดูแบ็กเพิ่ม · เหลือ '+num(gs.length-(bagLimits.get(key)||24)),`data-bag-more="${esc(key)}"`):''}</section>`).join('')||blank('ไม่พบแบ็กตามตัวกรอง')}`;}'''
replace_line_start('ops.js', 'function bagList(){', new_bag_list)

copy_helpers = r'''function tsv(v){return String(v??'').replace(/[\t\r\n]+/g,' ').trim();}
function waitText(r,current=detailNow()){const t=time(r.LastActionTime);if(!Number.isFinite(t)||t>current)return'ไม่ทราบ';const mins=Math.max(0,Math.floor((current-t)/60000)),h=Math.floor(mins/60),m=mins%60;return h?`${h}ชม.${m?` ${m}น.`:''}`:`${m} นาที`;}
async function writeCopy(text,message){try{await navigator.clipboard.writeText(text);notify(message);}catch{$('copy-text').value=text;$('copy-dialog').showModal();notify('คัดลอกอัตโนมัติไม่ได้ กรุณาคัดลอกจากช่องข้อความ');}}
async function copyTable(kind){const cells=selectedCells();let lines=[],title='';const grouped=(cs,key)=>groups(cs,key);if(kind==='dest'){const gs=grouped(cells.filter(c=>c.r===routeTab),c=>c.d);title=`ปลายทาง ${routeTab.toUpperCase()}`;lines=[['ปลายทาง','จำนวน','น้ำหนัก(กก.)','เกิน48ชม.','เกินเวลาแผน'].join('\t'),...gs.map(g=>[g.name,g.count,kg(g.weight),g.bands.over48,g.overdue].map(tsv).join('\t'))];}else if(kind==='heat'){const gs=grouped(cells,c=>`${c.r}|${c.d}`);title='จุดสะสมงานตามเวลาค้างจากดำเนินการล่าสุด';lines=[['ปลายทาง',...LABELS].join('\t'),...gs.map(g=>[g.name,...BANDS.map(b=>g.bands[b]||0)].map(tsv).join('\t'))];}else if(kind==='manager'){const gs=grouped(cells,c=>c.m);title='ผู้จัดการสาขา';lines=[['ผู้จัดการสาขา','จำนวน'].join('\t'),...gs.map(g=>[g.name,g.count].map(tsv).join('\t'))];}else if(kind.startsWith('status-')){const dim=kind.slice(7),cs=dim==='lh'?cells.filter(c=>c.r==='lh'):dim==='fd'?cells.filter(c=>c.r==='fd'):cells,key=dim==='action'?(c=>c.a):(c=>c.d),gs=grouped(cs,key),total=metrics(cs).count;title=dim==='action'?'การดำเนินการล่าสุด':`${dim.toUpperCase()} ปลายทาง`;lines=[['รายการ','จำนวน','สัดส่วน'].join('\t'),...gs.map(g=>[g.name,g.count,total?(g.count/total*100).toFixed(1)+'%':'0%'].map(tsv).join('\t'))];}else if(kind.startsWith('weight-')){const r=kind.slice(7),gs=grouped(cells.filter(c=>c.r===r),c=>c.d);title=`น้ำหนัก ${r.toUpperCase()} ปลายทาง`;lines=[['ปลายทาง','จำนวน','น้ำหนักรวม(กก.)','เฉลี่ย(กก.)'].join('\t'),...gs.map(g=>[g.name,g.count,kg(g.weight),kg(g.count?g.weight/g.count:0)].map(tsv).join('\t'))];}else if(kind==='list'){const current=detailNow(),data=listedRows();title=`รายการพัสดุ · ${fullDetailsReady()?'ทั้งคลัง':'ข้อมูลสดหน้าปัจจุบัน'}`;lines=[['เลขพัสดุ','สถานะ','ดำเนินการล่าสุด','เวลาดำเนินการล่าสุด','เวลาค้าง','ประเภท','ปลายทาง','แบ็ก','ผู้จัดการสาขา'].join('\t'),...data.map(r=>{const d=route(r,branch);return[r.pno,r.state_name,r.LastAction_name,r.LastActionTime,waitText(r,current),d.r.toUpperCase(),d.d,r.pack_num,managerValue(r)].map(tsv).join('\t');})];}else if(kind==='bags'){const current=detailNow(),gs=bags(detailRows(),branch,current);title=`ตารางแบ็กกิ้ง · ${fullDetailsReady()?'ทั้งคลัง':'ข้อมูลสดหน้าปัจจุบัน'}`;lines=[['เลขแบ็ก','ปลายทาง','จำนวนพัสดุ','ปลายทางปน','เกินเวลาแผน','ไม่อัปเดตเกิน6ชม.'].join('\t'),...gs.map(g=>[g.id,g.destination,g.rows.length,g.mixed?'ใช่':'ไม่',g.overdue?'ใช่':'ไม่',g.stale?'ใช่':'ไม่'].map(tsv).join('\t'))];}if(!lines.length){notify('ไม่มีข้อมูลตารางสำหรับคัดลอก');return;}await writeCopy([title,...lines].join('\n'),`คัดลอกตาราง ${title} แล้ว`);}
'''
replace_once('ops.js', 'function render(){', copy_helpers + 'function render(){')

replace_line_start(
    'ops.js',
    'function render(){',
    "function render(){renderHealth();rebuildFilters();const base=usable()?a.cells.filter(c=>match(c,{...filters(),bands:null})):[];document.querySelectorAll('[data-band-count]').forEach(el=>{el.textContent=usable()?num(base.filter(c=>c.b===el.dataset.bandCount).reduce((s,c)=>s+c.c,0)):'—';});document.querySelectorAll('[data-dashboard-band]').forEach(el=>el.checked=bands.has(el.dataset.dashboardBand));const content=$(`work-${view}`);if(!content)return;content.innerHTML=view==='dashboard'?dashboard():view==='status'?statusView():view==='weight'?weights():view==='bagging'?bagList():rowList();if(usable()&&!ready())content.insertAdjacentHTML('afterbegin',`<div class=\"partial-notice\" role=\"status\"><strong>ข้อมูลบางส่วน · ${num(a.scanned)} / ${num(a.total)} รายการ</strong><span>กราฟและตัวกรองด้านล่างครอบคลุมเฉพาะรายการที่รวบรวมได้ ยังไม่ใช่ยอดทั้งคลัง</span></div>`);if($('route-sort'))$('route-sort').value=routeSort;document.querySelectorAll('[data-work-risk]').forEach(el=>{el.classList.toggle('chosen',el.dataset.workRisk===risk);el.setAttribute('aria-pressed',el.dataset.workRisk===risk?'true':'false');});window.MSPersistentSelect?.syncAll?.();}"
)

new_copy = r'''async function copy(kind,bagId){const needsFull=kind==='dashboard';if(needsFull){if(!ready()){notify('ภาพรวมยังไม่ครบ ยังไม่สามารถคัดลอกทั้งคลังได้');return;}if(!await ensureRows()){notify(detailError||'รายละเอียดทั้งคลังยังไม่พร้อม');return;}if(!fullDetailsReady()){notify('Full Snapshot ยังไม่พร้อม กรุณาอัปเดตภาพรวมก่อนคัดลอกทั้งคลัง');return;}}else if(ready()&&!fullDetailsReady()&&!loadingRows){void ensureRows();}const current=detailNow();let data=kind==='list'?listedRows():selectedRows();if(kind==='bags'){const gs=bags(detailRows(),branch,current).filter(g=>bagIssue==='all'||bagIssue==='mixed'&&g.mixed||bagIssue==='overdue'&&g.overdue||bagIssue==='stale'&&g.stale);const ids=new Set(gs.filter(g=>!bagQuery||g.id.toLowerCase().includes(bagQuery.toLowerCase())||g.rows.some(r=>String(r.pno).toLowerCase().includes(bagQuery.toLowerCase()))).map(g=>g.id));data=data.filter(r=>hasBag(r)&&ids.has(String(r.pack_num).trim()));}if(bagId)data=data.filter(r=>String(r.pack_num).trim()===bagId);if(!data.length){notify('ไม่มีเลขพัสดุตามตัวกรอง');return;}const scope=fullDetailsReady()?'ข้อมูลทั้งคลัง':'ข้อมูลสดหน้าปัจจุบัน (ไม่ใช่ทั้งหมด)',output=[`MS Parcel Live · ${branch.code||''}`,scope,`ข้อมูล ณ ${new Date(fullDetailsReady()?a.updatedAt:live?.sourceAt||Date.now()).toLocaleString('th-TH')}`,`รวม ${num(data.length)} รายการ`,...data.map(r=>r.pno)].join('\n');await writeCopy(output,`คัดลอก ${num(data.length)} เลขพัสดุแล้ว · ${scope}`);}'''
replace_line_start('ops.js', 'async function copy(kind,bagId)', new_copy)
replace_once('ops.js', 'function openParcel(id){const r=rows.find(r=>String(r.pno)===id);if(!r)return;', 'function openParcel(id){const r=detailRows().find(r=>String(r.pno)===id);if(!r)return;')
replace_once('ops.js', "function reset(){generation++;a=null;rows=[];live=null;summary=null;analyticsState='waiting';detailError='';page=1;listMode='all';listQuery='';listStatus='';", "function reset(){generation++;a=null;rows=[];liveRows=[];live=null;summary=null;analyticsState='waiting';detailError='';page=1;listMode='all';listQuery='';listStatus='';")
replace_once('ops.js', "document.querySelector('.global-filter-top strong').textContent='อายุพัสดุในคลัง (ชั่วโมง)';", "document.querySelector('.global-filter-top strong').textContent='เวลาค้างจากการดำเนินการล่าสุด (ชั่วโมง)';")
replace_once('ops.js', "if(d.copy)void copy(d.copy);if(d.copyBag)void copy('dashboard',d.copyBag);", "if(d.copy)void copy(d.copy);if(d.copyTable)void copyTable(d.copyTable);if(d.copyBag)void copy('dashboard',d.copyBag);")
replace_once('ops.js', "window.addEventListener('ms-live-state',e=>{if(e.detail.branchId!==Number(branch.id))return;live=e.detail;renderHealth();});", "window.addEventListener('ms-live-state',e=>{if(e.detail.branchId!==Number(branch.id))return;live=e.detail;liveRows=Array.isArray(e.detail.rows)?e.detail.rows:liveRows;document.querySelectorAll('[data-list-status]').forEach(el=>options(el,[...new Set(detailRows().map(r=>r.state_name))]));schedule();});")

# Copy buttons for all aggregate/table-style sections.
replace_once(
    'ops.js',
    '<select id="route-sort" aria-label="เรียงปลายทาง"><option value="risk">เร่งด่วนก่อน</option><option value="count">จำนวนมากก่อน</option><option value="weight">น้ำหนักมากก่อน</option></select></div>',
    '<select id="route-sort" aria-label="เรียงปลายทาง"><option value="risk">เร่งด่วนก่อน</option><option value="count">จำนวนมากก่อน</option><option value="weight">น้ำหนักมากก่อน</option></select>${button(\'คัดลอกตาราง\',\'data-copy-table="dest"\')}</div>'
)
replace_once(
    'ops.js',
    '<div class="work-section-head"><div><h3>จุดสะสมงานตามช่วงอายุ</h3><span>สีเข้ม = จำนวนมากในช่วงเดียวกัน · กดช่องเพื่อเปิดรายการ</span></div></div>',
    '<div class="work-section-head"><div><h3>จุดสะสมงานตามเวลาค้างจากดำเนินการล่าสุด</h3><span>สีเข้ม = จำนวนมากในช่วงเดียวกัน · กดช่องเพื่อเปิดรายการ</span></div>${button(\'คัดลอกตาราง\',\'data-copy-table="heat"\')}</div>'
)
replace_once(
    'ops.js',
    '<section class="work-panel"><h3>ผู้จัดการสาขา</h3>${chart(groups(cells,c=>c.m),\'manager\',m.count)}</section>',
    '<section class="work-panel"><div class="work-section-head"><h3>ผู้จัดการสาขา</h3>${button(\'คัดลอกตาราง\',\'data-copy-table="manager"\')}</div>${chart(groups(cells,c=>c.m),\'manager\',m.count)}</section>'
)
replace_once(
    'ops.js',
    '<section class="work-panel"><h3>${r.toUpperCase()} ปลายทาง</h3><div class="destination-grid">',
    '<section class="work-panel"><div class="work-section-head"><h3>${r.toUpperCase()} ปลายทาง</h3>${button(\'คัดลอกตาราง\',`data-copy-table="weight-${r}"`)}</div><div class="destination-grid">'
)

# -----------------------------------------------------------------------------
# 4) Persistent dropdown styling and admin nav.
# -----------------------------------------------------------------------------
css = r'''
/* Persistent dropdowns: selection stays open until Close/Escape/outside/another dropdown. */
.persistent-native{position:absolute!important;width:1px!important;height:1px!important;opacity:0!important;pointer-events:none!important;margin:0!important;padding:0!important;border:0!important}
.persistent-select{position:relative;width:100%;min-width:0}.persistent-select-trigger{width:100%;min-height:44px;border:1px solid #b7c6d4;border-radius:8px;background:#fff;color:var(--ink);padding:8px 10px;display:flex;align-items:flex-start;justify-content:space-between;gap:10px;text-align:left}.persistent-select-trigger span{white-space:normal!important;overflow-wrap:anywhere;line-height:1.45;min-width:0}.persistent-select-trigger i{font-style:normal;flex:0 0 auto}.persistent-select.open .persistent-select-trigger{outline:3px solid #2977d5;outline-offset:2px}.persistent-select-panel{display:none;position:fixed;z-index:10000;background:#fff;border:1px solid #9eb3c7;border-radius:10px;box-shadow:0 18px 55px #10263b33;overflow:hidden}.persistent-select.open .persistent-select-panel{display:flex;flex-direction:column}.persistent-select-head{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 12px;border-bottom:1px solid var(--line);background:#f5f8fb}.persistent-select-head strong{font-size:14px}.persistent-select-close{border:1px solid #9eb3c7;background:#fff;border-radius:7px;min-height:34px;padding:5px 12px;font-weight:700}.persistent-select-options{overflow:auto;padding:6px;display:grid;gap:2px}.persistent-select-option{border:0;background:#fff;color:var(--ink);text-align:left;padding:9px 10px;border-radius:6px;white-space:normal;overflow-wrap:anywhere;line-height:1.45}.persistent-select-option:hover{background:#eef5ff}.persistent-select-option[aria-selected="true"]{background:#1d334d;color:#fff}.global-destination-grid .persistent-select-trigger{min-height:48px}.app-nav-inner.has-admin-actions{grid-template-columns:repeat(8,minmax(0,1fr))}.admin-nav-btn{background:#223b57!important;color:#fff!important}.live-fallback-notice{margin-bottom:16px}
@media(max-width:640px){.app-nav-inner.has-admin-actions{grid-template-columns:repeat(4,minmax(0,1fr))}.persistent-select-panel{max-width:calc(100vw - 24px)!important}.persistent-select-option{font-size:14px}}
'''
ops_css = read('ops.css')
if '/* Persistent dropdowns:' not in ops_css:
    write('ops.css', ops_css + css)

# Load dropdown component and bust browser cache.
replace_once(
    'index.html',
    '  <script type="module" src="ops.js?v=20260906-anchored-scan-v1"></script>\n  <link rel="stylesheet" href="ops.css?v=20260906-anchored-scan-v1" />',
    '  <script type="module" src="ops.js?v=20260906-anchored-scan-v1"></script>\n  <script type="module" src="dropdowns.js?v=20260906-anchored-scan-v1"></script>\n  <link rel="stylesheet" href="ops.css?v=20260906-anchored-scan-v1" />'
)
for path in ['index.html','app.js','ops.js','analytics-client.js','snapshot-client.js']:
    text = read(path)
    if '20260906-anchored-scan-v1' not in text:
        raise SystemExit(f'asset version missing in {path}')
    write(path, text.replace('20260906-anchored-scan-v1', '20260906-operational-v20'))

# CI validates the custom dropdown module.
replace_once('.github/workflows/pages.yml', '          node --check auth-client.js\n          node tests-data.mjs', '          node --check auth-client.js\n          node --check dropdowns.js\n          node tests-data.mjs')

# -----------------------------------------------------------------------------
# 5) Regression tests.
# -----------------------------------------------------------------------------
replace_once('tests-data.mjs', "import {band,route,validAnalytics,rowMatch,managerValue,bags,snapshotValid} from './data-model.js';", "import {band,route,validAnalytics,rowMatch,rowCell,managerValue,bags,snapshotValid} from './data-model.js';")
replace_once(
    'tests-data.mjs',
    "assert.equal(managerValue({store_manager_phone:'0812345678'}),'0812345678');",
    "assert.equal(managerValue({store_manager_phone:'0812345678'}),'0812345678');\nassert.equal(managerValue({store_id:'TH00000001',store_name:'01 TEST_HUB-A',store_manager_name:'นาย ทดสอบ',store_manager_phone:'0812345678'}),'(TH00000001)01 TEST_HUB-A · นาย ทดสอบ · 0812345678');\nassert.equal(rowCell({real_arrive_time:'2026-09-01 00:00:00',LastActionTime:'2026-09-06 00:00:00'},branch,Date.parse('2026-09-06T01:00:00+07:00')).b,'under3');"
)

replace_once('tests-ui.mjs', "real_arrive_time:'2026-09-05 23:00:00',pack_num:'B1',LastAction_name:'คัดแยก',state_name:", "real_arrive_time:'2026-09-05 23:00:00',pack_num:'B1',LastAction_name:'คัดแยก',LastActionTime:'2026-09-05 23:30:00',state_name:")
replace_once('tests-ui.mjs', 'schemaVersion:8', 'schemaVersion:9')
replace_once(
    'tests-ui.mjs',
    "const managerOptions=[...w.document.querySelector('#manager-phone-filter').options].map(o=>o.textContent);assert.ok(managerOptions.some(v=>v.includes('TEST_HUB-A')&&v.includes('ผู้จัดการ เอ')&&v.includes('0811111111')));",
    "const managerOptions=[...w.document.querySelector('#manager-phone-filter').options].map(o=>o.textContent);assert.ok(managerOptions.some(v=>v.includes('(TH00000001)01 TEST_HUB-A')&&v.includes('ผู้จัดการ เอ')&&v.includes('0811111111')));\nvm.runInContext(readFileSync('dropdowns.js','utf8'),dom.getInternalVMContext());w.MSPersistentSelect.init();const managerWidget=w.document.querySelector('#manager-phone-filter').nextElementSibling;managerWidget.querySelector('.persistent-select-trigger').click();const fullManagerOption=[...managerWidget.querySelectorAll('.persistent-select-option')].find(b=>b.textContent===M1);fullManagerOption.click();assert.equal(managerWidget.classList.contains('open'),true);assert.match(managerWidget.querySelector('.persistent-select-trigger').textContent,/\\(TH00000001\\)01 TEST_HUB-A/);w.document.querySelector('#manager-phone-filter').value='';w.document.querySelector('#manager-phone-filter').dispatchEvent(new w.Event('change'));flush();"
)
replace_once('tests-ui.mjs', "nav('status');assert.equal(w.document.querySelectorAll('.work-charts .work-panel').length,3);", "nav('status');assert.equal(w.document.querySelectorAll('.work-charts .work-panel').length,3);const many=vm.runInContext(\"chart(Array.from({length:12},(_,i)=>({name:'S'+i,count:1})), 'action', 12, true)\",dom.getInternalVMContext());assert.doesNotMatch(many,/work-more/);assert.match(w.document.querySelector('#work-status').textContent,/คัดลอกตาราง/);")
old_tail = "emit('ms-full-analytics',{...a,complete:false,total:3,scanned:2,snapshotId:null});flush();nav('dashboard');assert.match(w.document.querySelector('#work-dashboard').textContent,/ข้อมูลบางส่วน/);const beforeCopy=clipboard;await vm.runInContext(\"copy('dashboard')\",dom.getInternalVMContext());assert.equal(clipboard,beforeCopy);nav('backlog');emit('ms-session-reset');flush();assert.match(w.document.querySelector('#work-backlog').textContent,/รอภาพรวม/);assert.equal(w.document.querySelector('#parcel-detail').textContent,'');"
new_tail = "emit('ms-full-analytics',{...a,complete:false,total:3,scanned:2,snapshotId:null});emit('ms-live-state',{branchId:1,total:200,rows:fixtures,sourceAt:'2026-09-06T00:00:00+07:00'});flush();nav('dashboard');assert.match(w.document.querySelector('#work-dashboard').textContent,/ข้อมูลบางส่วน/);const beforeCopy=clipboard;await vm.runInContext(\"copy('dashboard')\",dom.getInternalVMContext());assert.equal(clipboard,beforeCopy);nav('parcels');flush();assert.equal(w.document.querySelectorAll('#work-parcels .parcel-row').length,2);assert.match(w.document.querySelector('#work-parcels').textContent,/ข้อมูลสดหน้าปัจจุบัน/);nav('bagging');flush();assert.equal(w.document.querySelectorAll('#work-bagging .work-bag').length,1);nav('backlog');flush();assert.ok(w.document.querySelectorAll('#work-backlog .parcel-row').length>=1);emit('ms-session-reset');flush();assert.match(w.document.querySelector('#work-backlog').textContent,/รอภาพรวม|ยังไม่มีข้อมูลสด/);assert.equal(w.document.querySelector('#parcel-detail').textContent,'');"
replace_once('tests-ui.mjs', old_tail, new_tail)
replace_once('tests-ui.mjs', "console.log('PASS: six views, no partial fallback, full manager column filter/display, FD/LH charts and weights, mixed bag, details, copy and logout clearing');", "assert.match(readFileSync('app.js','utf8'),/nav-users-btn/);console.log('PASS: six views, live fallback, latest-action waiting age, expanded Status, persistent full manager dropdown, copy tables, admin nav, mixed bag, details and logout clearing');")

# -----------------------------------------------------------------------------
# 6) Documentation.
# -----------------------------------------------------------------------------
readme = read('README.md')
readme = readme.replace('- ข้อมูล `ผู้จัดการสาขา` ใช้ข้อมูลจริงครบจาก source row: `store_id` + `store_name` + `store_manager_name` + `store_manager_phone`', '- ข้อมูล `ผู้จัดการสาขา` ใช้ข้อมูลจริงครบจาก source row: `store_id` + `store_name` + `store_manager_name` + `store_manager_phone`; แสดง Store ID พร้อมวงเล็บและไม่ตัดข้อความ')
if '## Waiting-time rule' not in readme:
    readme = readme.replace('## Shared filters', '## Waiting-time rule\n- เวลาค้างทุกหน้าใช้ `LastActionTime` (เวลาที่ดำเนินการล่าสุด) เป็นจุดเริ่มต้น ไม่ใช้ `real_arrive_time` สำหรับอายุค้าง\n- หน้ารายการ/SLA/Bagging แสดง live page ทันทีระหว่างรอ Full Snapshot และติดป้ายชัดเจนว่าไม่ใช่ทั้งคลัง\n- Dropdown ทุกตัวเป็นแบบ persistent: เลือกค่าแล้วรายการยังเปิดอยู่ ปิดเมื่อกดปิด/Escape/เปิด dropdown อื่น/คลิกออกนอกกล่อง\n- ตารางและกลุ่มสรุปหลักมีปุ่มคัดลอกตาราง\n\n## Shared filters')
write('README.md', readme)

print('PATCH_V20_OK')
