import {supabase} from './auth-client.js?v=20260906-control-room-v31';

const FUNCTION_BASE='https://afhnfnfbqdqqzrghovfc.supabase.co/functions/v1/ms-parcel-api';
const PUBLISHABLE_KEY='sb_publishable_4GStzbYK3_BhthidusT_hw_DqtzC7qE';
let loading=false,lastAt=0;
const $=(id)=>document.getElementById(id);
const fmtBytes=(bytes)=>{const n=Number(bytes||0);if(n<1024)return`${n} B`;const units=['KB','MB','GB','TB'];let v=n/1024,i=0;while(v>=1024&&i<units.length-1){v/=1024;i++;}return`${v.toLocaleString('th-TH',{maximumFractionDigits:2})} ${units[i]}`;};
const esc=(v)=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

async function api(){
  const {data}=await supabase.auth.getSession();
  const token=data?.session?.access_token;
  if(!token)throw new Error('กรุณาเข้าสู่ระบบ');
  const res=await fetch(`${FUNCTION_BASE}/health`,{headers:{Authorization:`Bearer ${token}`,apikey:PUBLISHABLE_KEY},cache:'no-store'});
  const out=await res.json().catch(()=>({ok:false,message:`HTTP ${res.status}`}));
  if(!res.ok||!out.ok)throw new Error(out.message||`HTTP ${res.status}`);
  return out.data||{};
}

function cardHtml(d){
  const ratio=Math.max(0,Number(d.ratio||0));
  const pct=(ratio*100).toLocaleString('th-TH',{maximumFractionDigits:1});
  const tables=Array.isArray(d.tables)?d.tables:[];
  const rows=tables.slice(0,8).map(t=>`<div class="quota-row"><span>${esc(t.name||t.table||'-')}</span><b>${fmtBytes(t.bytes||t.sizeBytes||0)}</b></div>`).join('');
  return `<article id="quota-health-card" class="admin-health-card quota-health-card"><div class="quota-health-head"><div><strong>Free Quota Health</strong><span>ใช้ข้อมูลฐานข้อมูลของระบบ ไม่เรียก MS เพิ่ม</span></div><b class="${ratio>=.75?'bad':''}">${esc(d.quotaStatus||'ปกติ')}</b></div><div class="quota-meter" aria-label="ใช้พื้นที่ฐานข้อมูล ${pct}%"><span style="width:${Math.min(100,Math.max(0,ratio*100))}%"></span></div><div class="quota-kpis"><span>ฐานข้อมูล<b>${fmtBytes(d.databaseBytes)}</b></span><span>งบ Free ที่เฝ้าระวัง<b>${fmtBytes(d.budgetBytes||d.targetFreeBudgetBytes)}</b></span><span>สัดส่วน<b>${pct}%</b></span><span>Build<b>${esc(d.build||'-')}</b></span></div>${rows?`<details class="quota-details"><summary>ดูส่วนที่ใช้พื้นที่มาก</summary><div>${rows}</div></details>`:''}</article>`;
}

async function load(force=false){
  const dialog=$('admin-control-dialog'),grid=$('admin-health-grid');
  if(!dialog?.open||!grid||loading)return;
  if(!force&&Date.now()-lastAt<60000)return;
  loading=true;
  try{
    const d=await api();lastAt=Date.now();
    grid.querySelector('#quota-health-card')?.remove();
    grid.insertAdjacentHTML('afterbegin',cardHtml(d));
  }catch(e){
    if(/Admin only|Unauthorized|403/i.test(String(e.message||'')))return;
    grid.querySelector('#quota-health-card')?.remove();
    grid.insertAdjacentHTML('afterbegin',`<article id="quota-health-card" class="admin-health-card"><strong>Free Quota Health</strong><small>อ่านไม่สำเร็จ: ${esc(e.message)}</small></article>`);
  }finally{loading=false;}
}

function install(){
  const dialog=$('admin-control-dialog');
  if(!dialog){setTimeout(install,300);return;}
  new MutationObserver(()=>{if(dialog.open)void load();}).observe(dialog,{attributes:true,attributeFilter:['open']});
  dialog.addEventListener('click',(e)=>{
    if(e.target?.dataset?.adminTab==='health')setTimeout(()=>void load(),0);
    if(e.target?.id==='admin-refresh')setTimeout(()=>void load(true),0);
  });
}
install();
