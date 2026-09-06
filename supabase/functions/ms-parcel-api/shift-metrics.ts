import { db } from './core.ts';

function bangkokParts(at=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(at),get=(type:string)=>parts.find(p=>p.type===type)?.value||'';
  return{date:`${get('year')}-${get('month')}-${get('day')}`,minute:Number(get('hour'))*60+Number(get('minute'))};
}
function shiftDate(date:string,days:number){const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function activeOn(row:any,date:string){const from=String(row?.effective_from||'0000-01-01'),to=String(row?.effective_to||'9999-12-31');return from<=date&&to>=date;}
async function currentContext(branchId:number,at=new Date()){
  const now=bangkokParts(at),yesterday=shiftDate(now.date,-1),rows=await db(`branch_shifts?branch_id=eq.${branchId}&is_active=eq.true&select=id,logical_id,name,start_minute,end_minute,sort_order,effective_from,effective_to&order=sort_order.asc,start_minute.asc`)||[];
  const candidates:any[]=[];
  for(const row of rows){const start=Number(row.start_minute),end=Number(row.end_minute);if(start<end){if(activeOn(row,now.date)&&now.minute>=start&&now.minute<end)candidates.push({row,shiftDate:now.date});}else{if(now.minute>=start&&activeOn(row,now.date))candidates.push({row,shiftDate:now.date});else if(now.minute<end&&activeOn(row,yesterday))candidates.push({row,shiftDate:yesterday});}}
  return candidates.sort((a,b)=>Number(a.row.sort_order)-Number(b.row.sort_order)||Number(a.row.start_minute)-Number(b.row.start_minute))[0]||null;
}
function metrics(analytics:any){return{total:Number(analytics?.total||0),fd:Number(analytics?.fdCount||0),lh:Number(analytics?.lhCount||0),singleParcels:Number(analytics?.singleParcels||0),baggedParcels:Number(analytics?.baggedParcels||0),uniqueBags:Number(analytics?.uniqueBags||0),over24:Number(analytics?.bandTotals?.['24to48']||0)+Number(analytics?.bandTotals?.over48||0),over48:Number(analytics?.bandTotals?.over48||0),overdue:Number(analytics?.overdueTotal||0),weightKg:Number(analytics?.totalWeightKg||0)};}
export async function recordShiftSnapshot(branchId:number,analytics:any,sourceAt:string){
  if(!analytics?.complete)return null;
  const ctx=await currentContext(branchId,new Date(sourceAt));if(!ctx?.row?.logical_id)return null;
  const current=metrics(analytics),key=`branch_id=eq.${branchId}&shift_logical_id=eq.${encodeURIComponent(String(ctx.row.logical_id))}&shift_date=eq.${ctx.shiftDate}`,existing=(await db(`shift_operational_snapshots?${key}&select=branch_id,shift_logical_id,shift_date,shift_name,first_seen_at,latest_seen_at,start_metrics,latest_metrics&limit=1`))?.[0];
  if(existing){await db(`shift_operational_snapshots?${key}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({latest_seen_at:sourceAt,latest_metrics:current,updated_at:new Date().toISOString()})});return{...existing,latest_seen_at:sourceAt,latest_metrics:current};}
  const record={branch_id:branchId,shift_logical_id:ctx.row.logical_id,shift_date:ctx.shiftDate,shift_name:ctx.row.name,first_seen_at:sourceAt,latest_seen_at:sourceAt,start_metrics:current,latest_metrics:current};
  const inserted=await db('shift_operational_snapshots',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(record)});return inserted?.[0]||record;
}
export async function shiftSummary(branchId:number){
  const rows=await db(`shift_operational_snapshots?branch_id=eq.${branchId}&select=branch_id,shift_logical_id,shift_date,shift_name,first_seen_at,latest_seen_at,start_metrics,latest_metrics&order=shift_date.desc,latest_seen_at.desc&limit=8`)||[];
  const current=rows[0]||null,previous=rows[1]||null;
  if(!current)return{current:null,previous:null,delta:null};
  const start=current.start_metrics||{},latest=current.latest_metrics||{},keys=['total','fd','lh','singleParcels','baggedParcels','uniqueBags','over24','over48','overdue','weightKg'],delta:any={};for(const key of keys)delta[key]=Math.round((Number(latest[key]||0)-Number(start[key]||0))*1000)/1000;
  return{current,previous,delta};
}
