import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm';

const CONFIG = {
  supabaseUrl: 'https://afhnfnfbqdqqzrghovfc.supabase.co',
  publishableKey: 'sb_publishable_4GStzbYK3_BhthidusT_hw_DqtzC7qE',
  functionBase: 'https://afhnfnfbqdqqzrghovfc.supabase.co/functions/v1/ms-parcel-api',
};
const supabase = createClient(CONFIG.supabaseUrl, CONFIG.publishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

const $ = (id) => document.getElementById(id);
const state = { session: null, profileRole: 'viewer', accessStatus: 'pending', page: 1, pageSize: 100, rows: [], total: 0, hash: '', timer: null, summaryTimer: null, loading: false, summaryLoading: false };
const fmt = new Intl.NumberFormat('th-TH');
const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const val = (v, dash='-') => v === null || v === undefined || v === '' ? dash : String(v);
const kg = (v) => { const n=Number(v); return Number.isFinite(n) ? `${(n/1000).toLocaleString('th-TH',{maximumFractionDigits:3})} kg` : val(v); };
const customerType = (r) => r.ka_name || r.ka_id ? 'KA' : val(r.customer_type_category);
const liveKey = () => `p:${state.page}:s:${state.pageSize}`;

setInterval(() => $('live-clock').textContent = new Date().toLocaleString('th-TH',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}), 1000);

async function api(route, options={}) {
  if (!state.session?.access_token) throw new Error('กรุณาเข้าสู่ระบบ');
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${state.session.access_token}`);
  headers.set('apikey', CONFIG.publishableKey);
  const res = await fetch(`${CONFIG.functionBase}/${route}`, { ...options, headers });
  const data = await res.json().catch(()=>({ok:false,message:`HTTP ${res.status}`}));
  if (!res.ok || data.ok === false) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}

function setConnection(type, text) {
  $('connection-badge').className = `badge ${type==='ok'?'badge-ok':type==='bad'?'badge-bad':'badge-neutral'}`;
  $('connection-badge').textContent = text;
  $('live-dot').className = `live-dot ${type==='ok'?'live':type==='bad'?'error':'stale'}`;
}
function scheduleLive(ms) { clearTimeout(state.timer); state.timer=setTimeout(()=>loadPage(false), document.hidden ? 60000 : Math.max(500,ms)); }
function scheduleSummary(ms) { clearTimeout(state.summaryTimer); state.summaryTimer=setTimeout(()=>loadSummary(false), document.hidden ? 60000 : Math.max(1000,ms)); }
function remainingMs(expiresAt, fallback=1000) { const n=Date.parse(String(expiresAt||'')); return Number.isFinite(n) ? Math.max(0,n-Date.now()+120) : fallback; }

async function claimRefresh(cacheKey) {
  const { data, error } = await supabase.rpc('claim_cache_refresh', { p_cache_key: cacheKey, p_lease_seconds: 6 });
  if (error) throw error;
  return data === true;
}
async function readLiveMeta() {
  const { data, error } = await supabase.from('live_cache_pages').select('cache_key,source_total,source_updated_at,expires_at,content_hash,previous_hash').eq('cache_key',liveKey()).maybeSingle();
  if (error) throw error;
  return data;
}
async function readLiveSnapshot() {
  const { data, error } = await supabase.from('live_cache_pages').select('payload,delta_payload,source_total,source_updated_at,expires_at,content_hash,previous_hash').eq('cache_key',liveKey()).maybeSingle();
  if (error) throw error;
  return data;
}
async function readSummaryCache() {
  const { data, error } = await supabase.from('summary_cache').select('payload,source_updated_at,expires_at,content_hash').eq('cache_key','transfer-summary').maybeSingle();
  if (error) throw error;
  return data;
}

function applyDelta(delta) {
  if (!delta || !Array.isArray(delta.order)) return false;
  const map = new Map(state.rows.map(r=>[String(r?.pno||''),r]));
  for (const pno of (delta.removed||[])) map.delete(String(pno));
  for (const row of (delta.upserts||[])) { const pno=String(row?.pno||''); if(pno) map.set(pno,row); }
  state.rows = delta.order.map(pno=>map.get(String(pno))).filter(Boolean);
  return true;
}
function updateLiveDisplay(sourceAt, note='shared cache') {
  renderFilters(); renderRows();
  $('last-refresh').textContent=`ตรวจ MS ล่าสุด ${new Date(sourceAt||Date.now()).toLocaleString('th-TH')} · ${note}`;
  $('source-sync').textContent=`${fmt.format(state.total)} รายการ · หน้า ${state.page}`;
  setConnection('ok','ออนไลน์');
}
function applyLiveSnapshot(row) {
  if (!row) return false;
  const newHash=String(row.content_hash||'');
  let applied=false;
  if (state.hash && newHash && state.hash===String(row.previous_hash||'') && row.delta_payload) applied=applyDelta(row.delta_payload);
  if (!applied) {
    const rows=row.payload?.rows;
    if (!Array.isArray(rows)) return false;
    state.rows=rows;
  }
  state.total=Number(row.source_total ?? row.payload?.total ?? 0);
  state.hash=newHash;
  updateLiveDisplay(row.source_updated_at, applied?'delta cache':'shared cache');
  return true;
}
function applyEdgeLive(out) {
  const d=out?.data||{};
  let note=out?.meta?.cache||'edge';
  if (d.notModified) {
    state.total=Number(d.total??state.total); state.hash=String(d.hash||state.hash); note='ไม่เปลี่ยน';
  } else if (d.delta && applyDelta(d.delta)) {
    state.total=Number(d.total??state.total); state.hash=String(d.hash||state.hash); note='delta';
  } else if (Array.isArray(d.rows)) {
    state.rows=d.rows; state.total=Number(d.total||0); state.hash=String(d.hash||''); note='full';
  }
  updateLiveDisplay(d.sourceAt, out?.meta?.stale?'stale cache':note);
  if (out?.meta?.stale) setConnection('bad','ใช้ cache เก่า');
  return Number(out?.meta?.ttlMs||0);
}
function renderSummary(d) {
  d=d||{};
  $('m-total').textContent=fmt.format(d.total||0); $('m-day1').textContent=fmt.format(d.day1||0); $('m-day2').textContent=fmt.format(d.day2||0); $('m-day3').textContent=fmt.format(d.day3||0); $('m-day4').textContent=fmt.format(d.day4||0); $('m-day5').textContent=fmt.format(d.day5plus||0); $('m-store').textContent=d.storeName||d.storeId||'-';
}

async function boot() {
  const { data } = await supabase.auth.getSession();
  await setSession(data.session);
  supabase.auth.onAuthStateChange(async (_event, session) => setSession(session));
}

async function setSession(session) {
  state.session=session; state.hash=''; state.rows=[]; state.total=0;
  clearTimeout(state.timer); clearTimeout(state.summaryTimer);
  if (!session) {
    $('login-dialog').showModal();
    $('logout-btn').classList.add('hidden'); $('refresh-btn').classList.add('hidden'); $('upload-har-btn').classList.add('hidden'); $('manage-users-btn').classList.add('hidden'); $('claim-admin-btn').classList.add('hidden');
    $('loading-state').textContent='กรุณาเข้าสู่ระบบ'; $('table-wrap').classList.add('hidden'); $('mobile-cards').classList.add('hidden');
    setConnection('neutral','ยังไม่ได้เข้าสู่ระบบ'); $('source-sync').textContent='ยังไม่ได้เชื่อมต่อ';
    return;
  }
  if ($('login-dialog').open) $('login-dialog').close();
  $('logout-btn').classList.remove('hidden'); $('refresh-btn').classList.remove('hidden');
  try {
    const status=await api('status');
    state.profileRole=status.data.profile?.role||'viewer'; state.accessStatus=status.data.profile?.access_status||'pending';
    $('upload-har-btn').classList.toggle('hidden',state.profileRole!=='admin'||state.accessStatus!=='active');
    $('manage-users-btn').classList.toggle('hidden',state.profileRole!=='admin'||state.accessStatus!=='active');
    $('claim-admin-btn').classList.toggle('hidden',state.profileRole==='admin'||!status.data.canClaimAdmin);
    const c=status.data.connection;
    if(c?.last_error)setConnection('bad','MS มีปัญหา');else setConnection('ok','ออนไลน์');
    $('source-sync').textContent=c?.store_name||c?.store_id||'เชื่อมต่อแล้ว';
    if(state.accessStatus!=='active'){
      setConnection('neutral',state.accessStatus==='disabled'?'ถูกระงับ':'รออนุมัติ');
      $('source-sync').textContent=state.accessStatus==='disabled'?'บัญชีถูกระงับการใช้งาน':'รอ Admin อนุมัติบัญชี';
      $('loading-state').textContent=state.accessStatus==='disabled'?'บัญชีนี้ถูกระงับการใช้งาน':'บัญชีนี้กำลังรอ Admin อนุมัติ';
      $('loading-state').classList.remove('hidden'); $('table-wrap').classList.add('hidden'); $('mobile-cards').classList.add('hidden');
      return;
    }
  } catch(e) { setConnection('bad','เชื่อมต่อไม่ได้'); $('source-sync').textContent=e.message; return; }
  await Promise.allSettled([loadSummary(false),loadPage(false)]);
}

async function loadSummary(force=false) {
  if(!state.session||state.accessStatus!=='active'||state.summaryLoading)return;
  state.summaryLoading=true;
  try {
    let c=await readSummaryCache();
    if(c?.payload) renderSummary(c.payload);
    const fresh=c&&Date.parse(String(c.expires_at||''))>Date.now();
    if(fresh&&!force){scheduleSummary(remainingMs(c.expires_at,60000));return;}
    const leader=await claimRefresh('summary:transfer-summary');
    if(!leader){scheduleSummary(900);return;}
    const out=await api('summary'); renderSummary(out.data);
    if(out.meta?.stale)setConnection('bad','ใช้ข้อมูล cache');
    scheduleSummary(Number(out.meta?.ttlMs||60000));
  } catch(e) { scheduleSummary(15000); }
  finally { state.summaryLoading=false; }
}

async function loadPage(force=false) {
  if(!state.session||state.accessStatus!=='active'||state.loading)return;
  state.loading=true;
  try {
    let meta=await readLiveMeta();
    if(meta?.content_hash&&meta.content_hash!==state.hash){
      const snap=await readLiveSnapshot(); applyLiveSnapshot(snap); meta=snap||meta;
    }
    const fresh=meta&&Date.parse(String(meta.expires_at||''))>Date.now();
    if(fresh&&!force){scheduleLive(remainingMs(meta.expires_at,8000));return;}
    const leader=await claimRefresh(liveKey());
    if(!leader){
      if(!state.rows.length)$('loading-state').textContent='กำลังรอข้อมูล shared cache…';
      scheduleLive(900); return;
    }
    $('loading-state').textContent='กำลังตรวจข้อมูล MS…'; $('loading-state').classList.remove('hidden');
    const known=state.hash?`&known_hash=${encodeURIComponent(state.hash)}`:'';
    const out=await api(`live?page=${state.page}&page_size=${state.pageSize}${known}`);
    const ttl=applyEdgeLive(out)||8000; scheduleLive(ttl+100);
  } catch(e) {
    $('loading-state').textContent=e.message; setConnection('bad','โหลดไม่สำเร็จ'); scheduleLive(document.hidden?60000:15000);
  } finally { state.loading=false; }
}

function unique(field){return [...new Set(state.rows.map(r=>val(r[field],'')).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'th'));}
function fillSelect(id,values){const el=$(id),keep=el.value;el.innerHTML='<option value="">ทั้งหมด</option>'+values.map(v=>`<option>${esc(v)}</option>`).join('');if(values.includes(keep))el.value=keep;}
function renderFilters(){fillSelect('status-filter',unique('state_name'));fillSelect('hub-filter',unique('dst_hub_name'));fillSelect('branch-filter',unique('dst_store_name'));}
function filteredRows(){const q=$('search-input').value.trim().toLowerCase(),st=$('status-filter').value,hub=$('hub-filter').value,br=$('branch-filter').value;return state.rows.filter(r=>{if(st&&val(r.state_name)!==st)return false;if(hub&&val(r.dst_hub_name)!==hub)return false;if(br&&val(r.dst_store_name)!==br)return false;if(!q)return true;return Object.values(r).some(v=>String(v??'').toLowerCase().includes(q));});}
function stack(a,b){return `<div class="cell-stack"><span>${esc(val(a))}</span>${b?`<small>${esc(val(b,''))}</small>`:''}</div>`;}
function renderRows(){const rows=filteredRows();$('loading-state').classList.toggle('hidden',rows.length>0);$('table-wrap').classList.toggle('hidden',rows.length===0);$('mobile-cards').classList.toggle('hidden',rows.length===0);if(!rows.length)$('loading-state').textContent='ไม่พบข้อมูลในหน้าปัจจุบัน';
  $('table-body').innerHTML=rows.map(r=>`<tr><td>${esc(val(r.pno))}</td><td><span class="status-chip">${esc(val(r.state_name))}</span></td><td>${stack(`${Number(r.cod_amount||0).toLocaleString('th-TH',{minimumFractionDigits:2})} บาท`,kg(r.store_weight))}</td><td>${stack(r.plan_leave_time,r.real_arrive_time)}</td><td>${esc(val(r.pack_num))}</td><td>${esc(val(r.marker_category_name))}</td><td>${stack(r.LastAction_name,r.LastActionTime)}</td><td>${stack(r.staff_info_name,r.staff_info_phone)}</td><td>${stack(r.dst_hub_name,r.dst_store_name)}</td><td>${stack(`${val(r.dst_province_name,'')} ${val(r.dst_city_name,'')}`.trim(),r.dst_postal_code)}</td><td>${stack(customerType(r),r.ka_name)}</td></tr>`).join('');
  $('mobile-cards').innerHTML=rows.map(r=>`<article class="mobile-card"><h3>${esc(val(r.pno))} · ${esc(val(r.state_name))}</h3><dl><dt>COD / น้ำหนัก</dt><dd>${esc(Number(r.cod_amount||0).toLocaleString('th-TH',{minimumFractionDigits:2}))} / ${esc(kg(r.store_weight))}</dd><dt>แผน / ถึงจริง</dt><dd>${esc(val(r.plan_leave_time))}<br>${esc(val(r.real_arrive_time))}</dd><dt>แบ็กกิ้ง</dt><dd>${esc(val(r.pack_num))}</dd><dt>ล่าสุด</dt><dd>${esc(val(r.LastAction_name))}<br>${esc(val(r.LastActionTime))}</dd><dt>ปลายทาง</dt><dd>${esc(val(r.dst_hub_name))}<br>${esc(val(r.dst_store_name))}</dd><dt>ลูกค้า</dt><dd>${esc(val(r.ka_name))}</dd></dl></article>`).join('');
  const pages=Math.max(1,Math.ceil(state.total/state.pageSize));$('page-info').textContent=`หน้า ${state.page} / ${fmt.format(pages)} · แสดง ${fmt.format(rows.length)} จาก ${fmt.format(state.total)}`;$('prev-btn').disabled=state.page<=1;$('next-btn').disabled=state.page>=pages;
}

$('login-form').addEventListener('submit',async e=>{e.preventDefault();$('login-error').classList.add('hidden');const{error}=await supabase.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});if(error){$('login-error').textContent=error.message;$('login-error').classList.remove('hidden');}});
$('signup-btn').addEventListener('click',async()=>{const email=$('email').value.trim(),password=$('password').value;if(!email||password.length<6){$('login-error').textContent='กรอกอีเมลและรหัสผ่านอย่างน้อย 6 ตัวอักษร';$('login-error').classList.remove('hidden');return;}const{error}=await supabase.auth.signUp({email,password,options:{emailRedirectTo:'https://flashdevnak.github.io/ms-parcel-live/'}});$('login-error').textContent=error?error.message:'สร้างบัญชีแล้ว กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ';$('login-error').classList.remove('hidden');});

$('claim-admin-btn').addEventListener('click',()=>{$('claim-admin-status').textContent='';$('claim-admin-code').value='';$('claim-admin-dialog').showModal();});
$('claim-admin-close').addEventListener('click',()=>$('claim-admin-dialog').close());
$('claim-admin-form').addEventListener('submit',async e=>{e.preventDefault();$('claim-admin-status').textContent='กำลังตรวจรหัส…';try{const out=await api('claim-admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:$('claim-admin-code').value})});state.profileRole=out.data?.profile?.role||'admin';state.accessStatus='active';$('claim-admin-status').textContent='เปิดสิทธิ์ Admin สำเร็จ';$('claim-admin-btn').classList.add('hidden');$('upload-har-btn').classList.remove('hidden');$('manage-users-btn').classList.remove('hidden');setTimeout(()=>{if($('claim-admin-dialog').open)$('claim-admin-dialog').close();loadPage(true);loadSummary(true);},500);}catch(err){$('claim-admin-status').textContent=`ไม่สำเร็จ: ${err.message}`;}});

async function loadUsers(){
  $('users-status').textContent='กำลังโหลดรายชื่อ…';
  try{
    const out=await api('users'),users=out.data?.users||[];$('users-status').textContent=`ทั้งหมด ${users.length} บัญชี`;
    $('users-list').innerHTML=users.map(u=>{const status=u.access_status||'pending',isAdmin=u.role==='admin';const actions=isAdmin?'':status==='pending'?`<button class="btn btn-accent user-action" data-id="${esc(u.user_id)}" data-action="approve">อนุมัติ</button><button class="btn btn-header user-action" data-id="${esc(u.user_id)}" data-action="disable">ระงับ</button>`:status==='active'?`<button class="btn btn-header user-action" data-id="${esc(u.user_id)}" data-action="disable">ระงับ</button>`:`<button class="btn btn-accent user-action" data-id="${esc(u.user_id)}" data-action="approve">เปิดใช้งาน</button>`;return `<article class="user-row"><div><strong>${esc(u.email||u.display_name||u.user_id)}</strong><small>${esc(u.role)} · ${esc(status)}</small></div><div class="user-row-actions">${actions}</div></article>`;}).join('')||'<div class="empty-state">ยังไม่มีผู้ใช้</div>';
    document.querySelectorAll('.user-action').forEach(btn=>btn.addEventListener('click',async()=>{btn.disabled=true;try{await api('users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:btn.dataset.id,action:btn.dataset.action})});await loadUsers();}catch(err){$('users-status').textContent=`ไม่สำเร็จ: ${err.message}`;}finally{btn.disabled=false;}}));
  }catch(err){$('users-status').textContent=`โหลดไม่สำเร็จ: ${err.message}`;}
}
$('manage-users-btn').addEventListener('click',()=>{$('users-dialog').showModal();loadUsers();});$('users-close').addEventListener('click',()=>$('users-dialog').close());$('users-refresh').addEventListener('click',loadUsers);

$('logout-btn').addEventListener('click',()=>supabase.auth.signOut());
$('refresh-btn').addEventListener('click',()=>Promise.allSettled([loadSummary(true),loadPage(true)]));
$('upload-har-btn').addEventListener('click',()=>$('har-dialog').showModal());$('har-close').addEventListener('click',()=>$('har-dialog').close());
$('har-form').addEventListener('submit',async e=>{e.preventDefault();const file=$('har-file').files?.[0];if(!file)return;$('har-status').textContent='กำลังอัปโหลดและตรวจ session…';try{const text=await file.text();const out=await api('har',{method:'POST',headers:{'Content-Type':'application/json'},body:text});$('har-status').textContent=`สำเร็จ · Store ${out.data.storeId}`;state.hash='';state.rows=[];await Promise.allSettled([loadSummary(true),loadPage(true)]);}catch(err){$('har-status').textContent=`ไม่สำเร็จ: ${err.message}`;}});
['search-input','status-filter','hub-filter','branch-filter'].forEach(id=>$(id).addEventListener(id==='search-input'?'input':'change',renderRows));
$('page-size').addEventListener('change',()=>{state.pageSize=Number($('page-size').value);state.page=1;state.hash='';state.rows=[];loadPage(false)});
$('prev-btn').addEventListener('click',()=>{if(state.page>1){state.page--;state.hash='';state.rows=[];loadPage(false)}});
$('next-btn').addEventListener('click',()=>{state.page++;state.hash='';state.rows=[];loadPage(false)});
document.addEventListener('visibilitychange',()=>{clearTimeout(state.timer);clearTimeout(state.summaryTimer);if(state.session&&state.accessStatus==='active'){if(document.hidden){scheduleLive(60000);scheduleSummary(60000);}else{scheduleLive(300);scheduleSummary(500);}}});

boot();
