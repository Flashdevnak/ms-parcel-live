import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm';

const CONFIG = {
  supabaseUrl: 'https://afhnfnfbqdqqzrghovfc.supabase.co',
  publishableKey: 'sb_publishable_4GStzbYK3_BhthidusT_hw_DqtzC7qE',
  functionBase: 'https://afhnfnfbqdqqzrghovfc.supabase.co/functions/v1/ms-parcel-api',
};
const supabase = createClient(CONFIG.supabaseUrl, CONFIG.publishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

const $ = (id) => document.getElementById(id);
const state = { session: null, profileRole: 'viewer', page: 1, pageSize: 100, rows: [], total: 0, timer: null, summaryTimer: null, lastChanged: false, loading: false };

const fmt = new Intl.NumberFormat('th-TH');
const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const val = (v, dash='-') => v === null || v === undefined || v === '' ? dash : String(v);
const kg = (v) => { const n=Number(v); return Number.isFinite(n) ? `${(n/1000).toLocaleString('th-TH',{maximumFractionDigits:3})} kg` : val(v); };
const customerType = (r) => r.ka_name || r.ka_id ? 'KA' : val(r.customer_type_category);

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

async function boot() {
  const { data } = await supabase.auth.getSession();
  await setSession(data.session);
  supabase.auth.onAuthStateChange(async (_event, session) => setSession(session));
}

async function setSession(session) {
  state.session = session;
  clearTimeout(state.timer); clearTimeout(state.summaryTimer);
  if (!session) {
    $('login-dialog').showModal();
    $('logout-btn').classList.add('hidden'); $('refresh-btn').classList.add('hidden'); $('upload-har-btn').classList.add('hidden');
    $('loading-state').textContent = 'กรุณาเข้าสู่ระบบ'; $('table-wrap').classList.add('hidden'); $('mobile-cards').classList.add('hidden');
    setConnection('neutral','ยังไม่ได้เข้าสู่ระบบ'); $('source-sync').textContent='ยังไม่ได้เชื่อมต่อ';
    return;
  }
  if ($('login-dialog').open) $('login-dialog').close();
  $('logout-btn').classList.remove('hidden'); $('refresh-btn').classList.remove('hidden');
  try {
    const status = await api('status');
    state.profileRole = status.data.profile?.role || 'viewer';
    if (state.profileRole === 'admin') $('upload-har-btn').classList.remove('hidden');
    const c = status.data.connection;
    if (c?.last_error) setConnection('bad','MS มีปัญหา'); else setConnection('ok','ออนไลน์');
    $('source-sync').textContent = c?.store_name || c?.store_id || 'เชื่อมต่อแล้ว';
  } catch (e) { setConnection('bad','เชื่อมต่อไม่ได้'); $('source-sync').textContent=e.message; }
  await Promise.allSettled([loadSummary(true), loadPage(true)]);
}

async function loadSummary(force=false) {
  if (!state.session) return;
  try {
    const out = await api('summary'); const d=out.data || {};
    $('m-total').textContent=fmt.format(d.total||0); $('m-day1').textContent=fmt.format(d.day1||0); $('m-day2').textContent=fmt.format(d.day2||0); $('m-day3').textContent=fmt.format(d.day3||0); $('m-day4').textContent=fmt.format(d.day4||0); $('m-day5').textContent=fmt.format(d.day5plus||0); $('m-store').textContent=d.storeName||d.storeId||'-';
    if (out.meta?.stale) setConnection('bad','ใช้ข้อมูล cache'); else setConnection('ok','ออนไลน์');
  } catch(e) { setConnection('bad','Summary error'); }
  clearTimeout(state.summaryTimer);
  state.summaryTimer=setTimeout(()=>loadSummary(false), document.hidden?60000:30000);
}

async function loadPage(force=false) {
  if (!state.session || state.loading) return;
  state.loading=true; $('loading-state').textContent='กำลังโหลดข้อมูล…'; $('loading-state').classList.remove('hidden');
  try {
    const out = await api(`live?page=${state.page}&page_size=${state.pageSize}`);
    const d=out.data || {}; state.rows=Array.isArray(d.rows)?d.rows:[]; state.total=Number(d.total||0); state.lastChanged=!!d.changed;
    state.profileRole=out.meta?.profileRole||state.profileRole;
    renderFilters(); renderRows();
    $('last-refresh').textContent=`อัปเดต ${new Date(d.sourceAt||Date.now()).toLocaleString('th-TH')} · ${out.meta?.cache||'-'}${out.meta?.stale?' · stale':''}`;
    $('source-sync').textContent=`${fmt.format(state.total)} รายการ · หน้า ${state.page}`;
    setConnection(out.meta?.stale?'bad':'ok',out.meta?.stale?'ใช้ cache เก่า':'ออนไลน์');
  } catch(e) {
    $('loading-state').textContent=e.message; setConnection('bad','โหลดไม่สำเร็จ');
  } finally {
    state.loading=false;
    clearTimeout(state.timer);
    const delay=document.hidden?60000:(state.lastChanged?7000:15000);
    state.timer=setTimeout(()=>loadPage(false),delay);
  }
}

function unique(field){return [...new Set(state.rows.map(r=>val(r[field],'')).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'th'));}
function fillSelect(id, values){const el=$(id), keep=el.value; el.innerHTML='<option value="">ทั้งหมด</option>'+values.map(v=>`<option>${esc(v)}</option>`).join(''); if(values.includes(keep))el.value=keep;}
function renderFilters(){fillSelect('status-filter',unique('state_name'));fillSelect('hub-filter',unique('dst_hub_name'));fillSelect('branch-filter',unique('dst_store_name'));}
function filteredRows(){const q=$('search-input').value.trim().toLowerCase(),st=$('status-filter').value,hub=$('hub-filter').value,br=$('branch-filter').value;return state.rows.filter(r=>{if(st&&val(r.state_name)!==st)return false;if(hub&&val(r.dst_hub_name)!==hub)return false;if(br&&val(r.dst_store_name)!==br)return false;if(!q)return true;return Object.values(r).some(v=>String(v??'').toLowerCase().includes(q));});}
function stack(a,b){return `<div class="cell-stack"><span>${esc(val(a))}</span>${b?`<small>${esc(val(b,''))}</small>`:''}</div>`;}
function renderRows(){const rows=filteredRows(); $('loading-state').classList.toggle('hidden',rows.length>0); $('table-wrap').classList.toggle('hidden',rows.length===0); $('mobile-cards').classList.toggle('hidden',rows.length===0); if(!rows.length)$('loading-state').textContent='ไม่พบข้อมูลในหน้าปัจจุบัน';
  $('table-body').innerHTML=rows.map(r=>`<tr><td>${esc(val(r.pno))}</td><td><span class="status-chip">${esc(val(r.state_name))}</span></td><td>${stack(`${Number(r.cod_amount||0).toLocaleString('th-TH',{minimumFractionDigits:2})} บาท`,kg(r.store_weight))}</td><td>${stack(r.plan_leave_time,r.real_arrive_time)}</td><td>${esc(val(r.pack_num))}</td><td>${esc(val(r.marker_category_name))}</td><td>${stack(r.LastAction_name,r.LastActionTime)}</td><td>${stack(r.staff_info_name,r.staff_info_phone)}</td><td>${stack(r.dst_hub_name,r.dst_store_name)}</td><td>${stack(`${val(r.dst_province_name,'')} ${val(r.dst_city_name,'')}`.trim(),r.dst_postal_code)}</td><td>${stack(customerType(r),r.ka_name)}</td></tr>`).join('');
  $('mobile-cards').innerHTML=rows.map(r=>`<article class="mobile-card"><h3>${esc(val(r.pno))} · ${esc(val(r.state_name))}</h3><dl><dt>COD / น้ำหนัก</dt><dd>${esc(Number(r.cod_amount||0).toLocaleString('th-TH',{minimumFractionDigits:2}))} / ${esc(kg(r.store_weight))}</dd><dt>แผน / ถึงจริง</dt><dd>${esc(val(r.plan_leave_time))}<br>${esc(val(r.real_arrive_time))}</dd><dt>แบ็กกิ้ง</dt><dd>${esc(val(r.pack_num))}</dd><dt>ล่าสุด</dt><dd>${esc(val(r.LastAction_name))}<br>${esc(val(r.LastActionTime))}</dd><dt>ปลายทาง</dt><dd>${esc(val(r.dst_hub_name))}<br>${esc(val(r.dst_store_name))}</dd><dt>ลูกค้า</dt><dd>${esc(val(r.ka_name))}</dd></dl></article>`).join('');
  const pages=Math.max(1,Math.ceil(state.total/state.pageSize)); $('page-info').textContent=`หน้า ${state.page} / ${fmt.format(pages)} · แสดง ${fmt.format(rows.length)} จาก ${fmt.format(state.total)}`; $('prev-btn').disabled=state.page<=1; $('next-btn').disabled=state.page>=pages;
}

$('login-form').addEventListener('submit',async e=>{e.preventDefault();$('login-error').classList.add('hidden');const {error}=await supabase.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});if(error){$('login-error').textContent=error.message;$('login-error').classList.remove('hidden');}});
$('signup-btn').addEventListener('click',async()=>{const email=$('email').value.trim(),password=$('password').value;if(!email||password.length<6){$('login-error').textContent='กรอกอีเมลและรหัสผ่านอย่างน้อย 6 ตัวอักษร';$('login-error').classList.remove('hidden');return;}const {error}=await supabase.auth.signUp({email,password});$('login-error').textContent=error?error.message:'สร้างบัญชีแล้ว หากระบบขอยืนยันอีเมล กรุณายืนยันก่อนเข้าสู่ระบบ';$('login-error').classList.remove('hidden');});
$('logout-btn').addEventListener('click',()=>supabase.auth.signOut()); $('refresh-btn').addEventListener('click',()=>Promise.allSettled([loadSummary(true),loadPage(true)]));
$('upload-har-btn').addEventListener('click',()=>$('har-dialog').showModal()); $('har-close').addEventListener('click',()=>$('har-dialog').close());
$('har-form').addEventListener('submit',async e=>{e.preventDefault();const file=$('har-file').files?.[0];if(!file)return;$('har-status').textContent='กำลังอัปโหลดและตรวจ session…';try{const text=await file.text();const out=await api('har',{method:'POST',headers:{'Content-Type':'application/json'},body:text});$('har-status').textContent=`สำเร็จ · Store ${out.data.storeId}`;await Promise.allSettled([loadSummary(true),loadPage(true)]);}catch(err){$('har-status').textContent=`ไม่สำเร็จ: ${err.message}`;}});
['search-input','status-filter','hub-filter','branch-filter'].forEach(id=>$(id).addEventListener(id==='search-input'?'input':'change',renderRows));
$('page-size').addEventListener('change',()=>{state.pageSize=Number($('page-size').value);state.page=1;loadPage(true)}); $('prev-btn').addEventListener('click',()=>{if(state.page>1){state.page--;loadPage(true)}}); $('next-btn').addEventListener('click',()=>{state.page++;loadPage(true)});
document.addEventListener('visibilitychange',()=>{clearTimeout(state.timer);clearTimeout(state.summaryTimer); if(state.session){state.timer=setTimeout(()=>loadPage(false),document.hidden?60000:1000);state.summaryTimer=setTimeout(()=>loadSummary(false),document.hidden?60000:1500);}});

boot();
