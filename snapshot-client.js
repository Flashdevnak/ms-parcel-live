import {supabase as client} from './auth-client.js?v=20260906-manager-full-v1';
import {snapshotValid} from './data-model.js?v=20260906-manager-full-v1';
let rows=[],loadedId='',pending=null,generation=0,loaded=false;
const id=()=>Number(document.getElementById('branch-select')?.value||0);
function decode(r){
 const keys=['pno','state_name','store_weight','plan_leave_time','real_arrive_time','pack_num','LastAction_name','LastActionTime','staff_info_phone'];
 const out=Object.fromEntries(keys.map((k,i)=>[k,r[i]??'']));
 const manager=String(r?.[9]??'').trim();
 out.store_manager_display=manager;
 out.store_manager_phone_raw=manager.includes(' · ')?manager.split(' · ').at(-1).trim():manager;
 // Compatibility: existing workspace views historically read store_manager_phone.
 // In full snapshots this field now intentionally carries the complete manager-column display.
 out.store_manager_phone=manager;
 out.dst_hub_name=r?.[10]??'';out.dst_store_name=r?.[11]??'';
 return out;
}
function reset(){generation++;rows=[];loadedId='';loaded=false;pending=null;window.__MS_FULL_ROWS=[];window.dispatchEvent(new CustomEvent('ms-full-rows-reset'));}
async function ensureLoaded(){
 const a=window.__MS_FULL_ANALYTICS,branch=id(),seq=generation;
 if(!a?.complete||a.scanned!==a.total||!a.snapshotId||a.snapshotStore!=='live_cache_pages'||a.branchId!==branch)throw new Error('ภาพรวมยังไม่ครบ กรุณารอรอบอัปเดต');
 if(Date.parse(a.snapshotExpiresAt)<=Date.now())throw new Error('รายการหมดอายุ กรุณาอัปเดตภาพรวม');
 if(loaded&&loadedId===a.snapshotId)return rows;
 if(pending)return pending;
 const job=(async()=>{
  const {data,error}=await client.from('live_cache_pages').select('cache_key,payload,item_count,source_total,expires_at').eq('branch_id',branch).like('cache_key',`b:${branch}:snapshot:${a.snapshotId}:p:%`).gt('expires_at',new Date().toISOString()).order('cache_key',{ascending:true});
  if(seq!==generation||id()!==branch||window.__MS_FULL_ANALYTICS?.snapshotId!==a.snapshotId)throw new Error('เปลี่ยนชุดข้อมูลแล้ว กรุณาลองอีกครั้ง');
  if(error||!Array.isArray(data)||!snapshotValid(data,a))throw new Error('รายละเอียดไม่ครบ ยังไม่สามารถคัดลอกทั้งหมดได้');
  rows=data.flatMap(p=>p.payload.map(decode));loaded=true;loadedId=a.snapshotId;window.__MS_FULL_ROWS=rows;
  window.dispatchEvent(new CustomEvent('ms-full-rows',{detail:{rows,snapshotId:loadedId,branchId:branch,total:a.total}}));return rows;
 })();pending=job;
 try{return await job;}finally{if(pending===job)pending=null;}
}
window.MSFullSnapshot={ensureLoaded,reset,getRows:()=>rows,status:()=>({loaded,loading:!!pending,count:rows.length,loadedSnapshotId:loadedId})};
window.addEventListener('ms-full-analytics',e=>{if(e.detail?.snapshotId!==loadedId)reset();});
window.addEventListener('ms-session-reset',reset);
document.getElementById('branch-select')?.addEventListener('change',reset);
