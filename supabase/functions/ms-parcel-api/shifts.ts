import { db } from './core.ts';

function cleanName(value:unknown){return String(value??'').trim().replace(/\s+/g,' ');}
function minute(value:unknown,label:string){const n=Number(value);if(!Number.isInteger(n)||n<0||n>1439)throw new Error(`${label} ไม่ถูกต้อง`);return n;}
function sortOrder(value:unknown){if(value===undefined||value===null||value==='')return 0;const n=Number(value);if(!Number.isInteger(n)||n<0||n>999)throw new Error('ลำดับกะไม่ถูกต้อง');return n;}
function segments(start:number,end:number){return start<end?[[start,end]]:[[start,1440],[0,end]];}
export function shiftsOverlap(aStart:number,aEnd:number,bStart:number,bEnd:number){return segments(aStart,aEnd).some(([as,ae])=>segments(bStart,bEnd).some(([bs,be])=>as<be&&bs<ae));}
export function validateShiftInput(body:any){const name=cleanName(body?.name);if(!name||name.length>50)throw new Error('ชื่อกะต้องมี 1–50 ตัวอักษร');const startMinute=minute(body?.startMinute,'เวลาเริ่มกะ'),endMinute=minute(body?.endMinute,'เวลาสิ้นสุดกะ');if(startMinute===endMinute)throw new Error('เวลาเริ่มและสิ้นสุดกะต้องไม่เท่ากัน');return{name,startMinute,endMinute,sortOrder:sortOrder(body?.sortOrder),isActive:body?.isActive!==false};}

export async function listShifts(branchId:number){return await db(`branch_shifts?branch_id=eq.${branchId}&select=id,branch_id,name,start_minute,end_minute,sort_order,is_active,created_at,updated_at&order=sort_order.asc,start_minute.asc,id.asc`)||[];}

async function ensureNoOverlap(branchId:number,startMinute:number,endMinute:number,excludeId=0){const rows=await db(`branch_shifts?branch_id=eq.${branchId}&is_active=eq.true&select=id,name,start_minute,end_minute` )||[];const hit=rows.find((row:any)=>Number(row.id)!==excludeId&&shiftsOverlap(startMinute,endMinute,Number(row.start_minute),Number(row.end_minute)));if(hit)throw new Error(`ช่วงเวลาทับกับกะ ${cleanName(hit.name)||hit.id}`);}

export async function changeShift(userId:string,branchId:number,body:any){const action=String(body?.action||'').trim().toLowerCase();
  if(action==='create'){
    const v=validateShiftInput(body);if(v.isActive)await ensureNoOverlap(branchId,v.startMinute,v.endMinute);
    const created=await db('branch_shifts',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({branch_id:branchId,name:v.name,start_minute:v.startMinute,end_minute:v.endMinute,sort_order:v.sortOrder,is_active:v.isActive,created_by:userId,updated_by:userId})});return created?.[0]||null;
  }
  const id=Number(body?.id);if(!Number.isSafeInteger(id)||id<=0)throw new Error('ไม่พบกะที่ต้องการแก้ไข');
  const current=(await db(`branch_shifts?id=eq.${id}&branch_id=eq.${branchId}&select=*&limit=1`))?.[0];if(!current)throw new Error('ไม่พบกะใน HUB/สาขานี้');
  if(action==='update'){
    const merged={name:body?.name??current.name,startMinute:body?.startMinute??current.start_minute,endMinute:body?.endMinute??current.end_minute,sortOrder:body?.sortOrder??current.sort_order,isActive:body?.isActive??current.is_active};const v=validateShiftInput(merged);if(v.isActive)await ensureNoOverlap(branchId,v.startMinute,v.endMinute,id);
    const updated=await db(`branch_shifts?id=eq.${id}&branch_id=eq.${branchId}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({name:v.name,start_minute:v.startMinute,end_minute:v.endMinute,sort_order:v.sortOrder,is_active:v.isActive,updated_by:userId,updated_at:new Date().toISOString()})});return updated?.[0]||null;
  }
  if(action==='delete'){
    await db(`branch_shifts?id=eq.${id}&branch_id=eq.${branchId}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});return{id,deleted:true};
  }
  throw new Error('คำสั่งจัดการกะไม่ถูกต้อง');
}
