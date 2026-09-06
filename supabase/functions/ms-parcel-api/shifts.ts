import { db } from './core.ts';

function cleanName(value:unknown){return String(value??'').trim().replace(/\s+/g,' ');}
function minute(value:unknown,label:string){const n=Number(value);if(!Number.isInteger(n)||n<0||n>1439)throw new Error(`${label} ไม่ถูกต้อง`);return n;}
function sortOrder(value:unknown){if(value===undefined||value===null||value==='')return 0;const n=Number(value);if(!Number.isInteger(n)||n<0||n>999)throw new Error('ลำดับกะไม่ถูกต้อง');return n;}
function segments(start:number,end:number){return start<end?[[start,end]]:[[start,1440],[0,end]];}
export function shiftsOverlap(aStart:number,aEnd:number,bStart:number,bEnd:number){return segments(aStart,aEnd).some(([as,ae])=>segments(bStart,bEnd).some(([bs,be])=>as<be&&bs<ae));}
export function validateShiftInput(body:any){const name=cleanName(body?.name);if(!name||name.length>50)throw new Error('ชื่อกะต้องมี 1–50 ตัวอักษร');const startMinute=minute(body?.startMinute,'เวลาเริ่มกะ'),endMinute=minute(body?.endMinute,'เวลาสิ้นสุดกะ');if(startMinute===endMinute)throw new Error('เวลาเริ่มและสิ้นสุดกะต้องไม่เท่ากัน');return{name,startMinute,endMinute,sortOrder:sortOrder(body?.sortOrder),isActive:body?.isActive!==false};}

function bangkokParts(at=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(at);
  const get=(type:string)=>parts.find(p=>p.type===type)?.value||'';
  return{date:`${get('year')}-${get('month')}-${get('day')}`,minute:Number(get('hour'))*60+Number(get('minute'))};
}
function validDate(value:unknown,fallback:string){const raw=String(value||'').trim();return/^\d{4}-\d{2}-\d{2}$/.test(raw)?raw:fallback;}
function shiftDate(date:string,days:number){const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function activeOn(row:any,date:string){const from=String(row?.effective_from||'0000-01-01'),to=String(row?.effective_to||'9999-12-31');return from<=date&&to>=date;}
function publicShift(row:any){return{id:Number(row.id),logical_id:row.logical_id,branch_id:Number(row.branch_id),name:row.name,start_minute:Number(row.start_minute),end_minute:Number(row.end_minute),sort_order:Number(row.sort_order||0),is_active:!!row.is_active,effective_from:row.effective_from,effective_to:row.effective_to,created_at:row.created_at,updated_at:row.updated_at};}
async function allShiftVersions(branchId:number){return await db(`branch_shifts?branch_id=eq.${branchId}&select=id,logical_id,branch_id,name,start_minute,end_minute,sort_order,is_active,effective_from,effective_to,created_at,updated_at&order=effective_from.asc,sort_order.asc,start_minute.asc,id.asc`)||[];}

export async function listShifts(branchId:number,effectiveDate?:string){
  const today=bangkokParts().date,date=validDate(effectiveDate,today),rows=await allShiftVersions(branchId);
  return rows.filter((row:any)=>activeOn(row,date)).map(publicShift).sort((a:any,b:any)=>a.sort_order-b.sort_order||a.start_minute-b.start_minute||a.id-b.id);
}

export async function currentShift(branchId:number,at=new Date()){
  const now=bangkokParts(at),yesterday=shiftDate(now.date,-1),rows=await allShiftVersions(branchId);
  const candidates:any[]=[];
  for(const row of rows){if(!row.is_active)continue;const start=Number(row.start_minute),end=Number(row.end_minute);if(start<end){if(activeOn(row,now.date)&&now.minute>=start&&now.minute<end)candidates.push(row);}else{if(now.minute>=start&&activeOn(row,now.date))candidates.push(row);else if(now.minute<end&&activeOn(row,yesterday))candidates.push(row);}}
  const row=candidates.sort((a,b)=>Number(a.sort_order)-Number(b.sort_order)||Number(a.start_minute)-Number(b.start_minute))[0];
  return row?publicShift(row):null;
}

async function ensureNoOverlap(branchId:number,startMinute:number,endMinute:number,effectiveDate:string,excludeLogicalId=''){
  const rows=await allShiftVersions(branchId);
  const hit=rows.find((row:any)=>row.is_active&&activeOn(row,effectiveDate)&&String(row.logical_id)!==String(excludeLogicalId||'')&&shiftsOverlap(startMinute,endMinute,Number(row.start_minute),Number(row.end_minute)));
  if(hit)throw new Error(`ช่วงเวลาทับกับกะ ${cleanName(hit.name)||hit.id}`);
}
async function writeAudit(userId:string,branchId:number,row:any,action:string,effectiveDate:string,oldValue:any,newValue:any){
  try{await db('branch_shift_audit',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({branch_id:branchId,shift_id:row?.id||null,logical_id:row?.logical_id||null,user_id:userId,action,effective_date:effectiveDate,old_value:oldValue||null,new_value:newValue||null})});}catch{}
}
export async function listShiftAudit(branchId:number,limit=50){const n=Math.max(1,Math.min(200,Number(limit)||50));return await db(`branch_shift_audit?branch_id=eq.${branchId}&select=id,branch_id,shift_id,logical_id,user_id,action,effective_date,old_value,new_value,created_at&order=created_at.desc&limit=${n}`)||[];}

export async function changeShift(userId:string,branchId:number,body:any){
  const action=String(body?.action||'').trim().toLowerCase(),today=bangkokParts().date,effectiveDate=validDate(body?.effectiveDate,today);
  if(action==='create'){
    const v=validateShiftInput(body);if(v.isActive)await ensureNoOverlap(branchId,v.startMinute,v.endMinute,effectiveDate);
    const created=await db('branch_shifts',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({branch_id:branchId,name:v.name,start_minute:v.startMinute,end_minute:v.endMinute,sort_order:v.sortOrder,is_active:v.isActive,effective_from:effectiveDate,created_by:userId,updated_by:userId})}),row=created?.[0]||null;
    await writeAudit(userId,branchId,row,'create',effectiveDate,null,publicShift(row));return publicShift(row);
  }
  const id=Number(body?.id);if(!Number.isSafeInteger(id)||id<=0)throw new Error('ไม่พบกะที่ต้องการแก้ไข');
  const current=(await db(`branch_shifts?id=eq.${id}&branch_id=eq.${branchId}&select=*&limit=1`))?.[0];if(!current)throw new Error('ไม่พบกะใน HUB/สาขานี้');
  const oldPublic=publicShift(current),logicalId=String(current.logical_id||'');
  if(action==='update'){
    const merged={name:body?.name??current.name,startMinute:body?.startMinute??current.start_minute,endMinute:body?.endMinute??current.end_minute,sortOrder:body?.sortOrder??current.sort_order,isActive:body?.isActive??current.is_active};const v=validateShiftInput(merged);if(v.isActive)await ensureNoOverlap(branchId,v.startMinute,v.endMinute,effectiveDate,logicalId);
    let row:any;
    if(effectiveDate===String(current.effective_from)){
      const updated=await db(`branch_shifts?id=eq.${id}&branch_id=eq.${branchId}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({name:v.name,start_minute:v.startMinute,end_minute:v.endMinute,sort_order:v.sortOrder,is_active:v.isActive,updated_by:userId,updated_at:new Date().toISOString()})});row=updated?.[0];
    }else if(effectiveDate>String(current.effective_from)){
      const previousDay=shiftDate(effectiveDate,-1);if(current.effective_to&&String(current.effective_to)<effectiveDate)throw new Error('Effective Date อยู่นอกช่วงเวอร์ชันกะนี้');
      await db(`branch_shifts?id=eq.${id}&branch_id=eq.${branchId}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({effective_to:previousDay,updated_by:userId,updated_at:new Date().toISOString()})});
      const created=await db('branch_shifts',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({branch_id:branchId,logical_id:logicalId,name:v.name,start_minute:v.startMinute,end_minute:v.endMinute,sort_order:v.sortOrder,is_active:v.isActive,effective_from:effectiveDate,effective_to:current.effective_to||null,created_by:userId,updated_by:userId})});row=created?.[0];
    }else throw new Error('Effective Date ต้องไม่ก่อนวันที่เริ่มใช้ของเวอร์ชันนี้');
    await writeAudit(userId,branchId,row,'update',effectiveDate,oldPublic,publicShift(row));return publicShift(row);
  }
  if(action==='delete'){
    if(effectiveDate===String(current.effective_from)){
      const updated=await db(`branch_shifts?id=eq.${id}&branch_id=eq.${branchId}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({is_active:false,updated_by:userId,updated_at:new Date().toISOString()})}),row=updated?.[0];
      await writeAudit(userId,branchId,row,'deactivate',effectiveDate,oldPublic,publicShift(row));return publicShift(row);
    }
    if(effectiveDate<String(current.effective_from))throw new Error('Effective Date ต้องไม่ก่อนวันที่เริ่มใช้ของเวอร์ชันนี้');
    const previousDay=shiftDate(effectiveDate,-1);await db(`branch_shifts?id=eq.${id}&branch_id=eq.${branchId}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({effective_to:previousDay,updated_by:userId,updated_at:new Date().toISOString()})});
    const created=await db('branch_shifts',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({branch_id:branchId,logical_id:logicalId,name:current.name,start_minute:current.start_minute,end_minute:current.end_minute,sort_order:current.sort_order,is_active:false,effective_from:effectiveDate,effective_to:current.effective_to||null,created_by:userId,updated_by:userId})}),row=created?.[0];
    await writeAudit(userId,branchId,row,'deactivate',effectiveDate,oldPublic,publicShift(row));return publicShift(row);
  }
  throw new Error('คำสั่งจัดการกะไม่ถูกต้อง');
}
