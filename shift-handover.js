import {supabase} from './auth-client.js?v=20260906-control-room-v31';

const FUNCTION_BASE='https://afhnfnfbqdqqzrghovfc.supabase.co/functions/v1/ms-parcel-api';
const PUBLISHABLE_KEY='sb_publishable_4GStzbYK3_BhthidusT_hw_DqtzC7qE';
const $=(id)=>document.getElementById(id);
const esc=(v)=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const num=(v)=>Number(v||0).toLocaleString('th-TH',{maximumFractionDigits:2});
let branchId=0,branch=null,currentShift=null,summary=null,seq=0,loading=false;

async function api(){
  if(!branchId)return null;
  const {data}=await supabase.auth.getSession();const token=data?.session?.access_token;if(!token)return null;
  const res=await fetch(`${FUNCTION_BASE}/shift-summary?branch_id=${branchId}`,{headers:{Authorization:`Bearer ${token}`,apikey:PUBLISHABLE_KEY},cache:'no-store'});
  const out=await res.json().catch(()=>null);if(!res.ok||!out?.ok)throw new Error(out?.message||`HTTP ${res.status}`);return out.data||null;
}
function diff(v){const n=Number(v||0);return`${n>0?'+':''}${num(n)}`;}
function tone(v){const n=Number(v||0);return n>0?'up':n<0?'down':'';}
function ensureRoot(){
  if($('shift-handover-root'))return $('shift-handover-root');
  const dashboard=document.querySelector('[data-page-view="dashboard"]');if(!dashboard)return null;
  const root=document.createElement('section');root.id='shift-handover-root';root.className='panel shift-handover-panel';
  const intelligence=$('control-room-intelligence-root');
  if(intelligence)intelligence.insertAdjacentElement('afterend',root);else dashboard.prepend(root);
  return root;
}
function metric(start,latest,key,label){const a=Number(start?.[key]||0),b=Number(latest?.[key]||0),d=b-a;return`<div class="handover-metric"><span>${label}</span><strong>${num(b)}</strong><small class="${tone(d)}">ต้นกะ ${num(a)} · ${diff(d)}</small></div>`;}
function render(){
  const root=ensureRoot();if(!root)return;
  const cur=summary?.current||null;
  if(!cur){root.innerHTML=`<div class="handover-head"><div><h3>Shift Handover</h3><span>${esc(branch?.code||'')} · ${esc(currentShift?.name||'ยังไม่ได้ตั้งกะ')}</span></div></div><div class="intel-empty">ยังไม่มี Snapshot ที่ครบในกะนี้ ระบบจะเริ่มสรุปเมื่อ Full Snapshot ผ่าน Data Gate โดยไม่ยิง MS เพิ่ม</div>`;return;}
  const start=cur.start_metrics||{},latest=cur.latest_metrics||{},d=summary.delta||{};
  root.innerHTML=`<div class="handover-head"><div><h3>Shift Handover</h3><span>${esc(branch?.code||'')} · ${esc(cur.shift_name||currentShift?.name||'-')} · ${esc(cur.shift_date||'-')}</span></div><div class="work-actions"><button id="handover-copy" class="btn btn-header" type="button">คัดลอกส่งต่อกะ</button></div></div><div class="handover-grid">${metric(start,latest,'total','คงคลัง')}${metric(start,latest,'fd','FD')}${metric(start,latest,'lh','LH')}${metric(start,latest,'over24','≥24ชม.')}${metric(start,latest,'over48','>48ชม.')}${metric(start,latest,'uniqueBags','เลขแบ็กกิ้ง')}</div><div class="handover-foot"><span>Snapshot ต้นกะ ${new Date(cur.first_seen_at).toLocaleString('th-TH')}</span><span>ล่าสุด ${new Date(cur.latest_seen_at).toLocaleString('th-TH')}</span><span>Carry-over ปัจจุบัน ${num(latest.total)} ชิ้น</span></div>`;
  $('handover-copy')?.addEventListener('click',()=>void copy(cur,d));
}
async function copy(cur,d){
  const latest=cur.latest_metrics||{},start=cur.start_metrics||{};
  const lines=[
    `สรุปส่งต่อกะ · ${branch?.code||'-'} · ${cur.shift_name||'-'} · ${cur.shift_date||'-'}`,
    `คงคลัง: ${num(latest.total)} (ต้นกะ ${num(start.total)} / ${diff(d.total)})`,
    `FD: ${num(latest.fd)} (${diff(d.fd)})`,
    `LH ส่งต่อ HUB อื่น: ${num(latest.lh)} (${diff(d.lh)})`,
    `≥24ชม.: ${num(latest.over24)} (${diff(d.over24)})`,
    `>48ชม.: ${num(latest.over48)} (${diff(d.over48)})`,
    `เลขแบ็กกิ้งที่พบ: ${num(latest.uniqueBags)} (${diff(d.uniqueBags)})`,
    `น้ำหนักรวม: ${num(latest.weightKg)} kg`,
    `ข้อมูลล่าสุด: ${new Date(cur.latest_seen_at).toLocaleString('th-TH')}`,
  ];
  try{await navigator.clipboard.writeText(lines.join('\n'));$('handover-copy').textContent='คัดลอกแล้ว';setTimeout(()=>{if($('handover-copy'))$('handover-copy').textContent='คัดลอกส่งต่อกะ';},1500);}catch{}
}
async function load(){
  if(!branchId||loading)return;const mine=++seq;loading=true;
  try{const data=await api();if(mine!==seq)return;summary=data;render();}
  catch{if(mine===seq){summary=null;render();}}
  finally{loading=false;}
}
window.addEventListener('ms-branch-ready',(event)=>{seq++;branch=event.detail||null;branchId=Number(branch?.id||0);summary=null;render();void load();});
window.addEventListener('ms-shift-state',(event)=>{if(Number(event.detail?.branchId||0)!==branchId)return;currentShift=event.detail?.currentShift||null;render();});
window.addEventListener('ms-full-analytics',(event)=>{if(Number(event.detail?.branchId||0)!==branchId)return;if(event.detail?.complete)void load();});
window.addEventListener('ms-session-reset',()=>{seq++;branchId=0;branch=null;currentShift=null;summary=null;$('shift-handover-root')?.remove();});
