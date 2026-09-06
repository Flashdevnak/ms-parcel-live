import { db } from './core.ts';

const HISTORY_DAYS=45;
const BASELINE_DAYS=14;

function bucket15(sourceAt:string){
  const ms=Date.parse(sourceAt);if(!Number.isFinite(ms))return new Date().toISOString();
  const size=15*60_000;return new Date(Math.floor(ms/size)*size).toISOString();
}
function bangkokHour(value:string){
  const d=new Date(value);if(!Number.isFinite(d.getTime()))return-1;
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',hour:'2-digit',hourCycle:'h23'}).formatToParts(d);
  return Number(parts.find(p=>p.type==='hour')?.value||-1);
}
function scalarMetrics(a:any){return{
  total:Number(a?.total||0),fd:Number(a?.fdCount||0),lh:Number(a?.lhCount||0),single_parcels:Number(a?.singleParcels||0),bagged_parcels:Number(a?.baggedParcels||0),unique_bags:Number(a?.uniqueBags||0),over24:Number(a?.bandTotals?.['24to48']||0)+Number(a?.bandTotals?.over48||0),over48:Number(a?.bandTotals?.over48||0),overdue:Number(a?.overdueTotal||0),weight_kg:Number(a?.totalWeightKg||0),
};}
function destinationSnapshot(a:any){
  const compact=(list:any)=> (Array.isArray(list)?list:[]).map((g:any)=>({n:String(g?.name||''),c:Number(g?.count||0),w:Number(g?.weightKg||0)})).filter((g:any)=>g.n).slice(0,500);
  return{fd:compact(a?.fd),lh:compact(a?.lh)};
}
function median(values:number[]){const a=values.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;}
function percentile(values:number[],p:number){const a=values.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const i=Math.max(0,Math.min(a.length-1,Math.floor((a.length-1)*p)));return a[i];}
function destMap(snapshot:any,route:'fd'|'lh'){const out=new Map<string,number>();for(const x of(Array.isArray(snapshot?.[route])?snapshot[route]:[])){const n=String(x?.n||'');if(n)out.set(n,Number(x?.c||0));}return out;}

export async function recordAggregateHistory(branchId:number,analytics:any,sourceAt:string,shiftSnapshot:any){
  if(!analytics?.complete)return null;
  const bucket=bucket15(sourceAt),d=new Date(bucket),hourly=d.getUTCMinutes()===0;
  const m=scalarMetrics(analytics),record:any={branch_id:branchId,bucket_at:bucket,source_at:sourceAt,shift_logical_id:shiftSnapshot?.shift_logical_id||null,shift_name:shiftSnapshot?.shift_name||null,total:m.total,fd:m.fd,lh:m.lh,single_parcels:m.single_parcels,bagged_parcels:m.bagged_parcels,unique_bags:m.unique_bags,over24:m.over24,over48:m.over48,overdue:m.overdue,weight_kg:m.weight_kg,destination_snapshot:hourly?destinationSnapshot(analytics):null,updated_at:new Date().toISOString()};
  const rows=await db('ops_aggregate_history?on_conflict=branch_id,bucket_at',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify(record)});
  return rows?.[0]||record;
}

export async function historyRows(branchId:number,hours=168){
  const n=Math.max(1,Math.min(HISTORY_DAYS*24,Number(hours)||168)),from=new Date(Date.now()-n*3600_000).toISOString();
  return await db(`ops_aggregate_history?branch_id=eq.${branchId}&bucket_at=gte.${encodeURIComponent(from)}&select=branch_id,bucket_at,source_at,shift_logical_id,shift_name,total,fd,lh,single_parcels,bagged_parcels,unique_bags,over24,over48,overdue,weight_kg,destination_snapshot&order=bucket_at.asc&limit=5000`)||[];
}

export async function buildBaseline(branchId:number,analytics:any,sourceAt:string,shiftSnapshot:any){
  if(!analytics?.complete)return{available:false,reason:'incomplete_snapshot'};
  const from=new Date(Date.parse(sourceAt)-BASELINE_DAYS*86400_000).toISOString(),rows=await db(`ops_aggregate_history?branch_id=eq.${branchId}&bucket_at=gte.${encodeURIComponent(from)}&bucket_at=lt.${encodeURIComponent(sourceAt)}&select=bucket_at,shift_logical_id,total,fd,lh,over24,over48,overdue,destination_snapshot&order=bucket_at.asc&limit=2000`)||[];
  const hour=bangkokHour(sourceAt),logical=String(shiftSnapshot?.shift_logical_id||'');
  const sameHour=rows.filter((r:any)=>bangkokHour(r.bucket_at)===hour),sameShift=logical?sameHour.filter((r:any)=>String(r.shift_logical_id||'')===logical):[];
  const samples=(sameShift.length>=4?sameShift:sameHour).filter((r:any)=>Number.isFinite(Number(r.total)));
  if(samples.length<4)return{available:false,reason:'insufficient_history',samples:samples.length};
  const keys=['total','fd','lh','over24','over48','overdue'],scalar:any={};
  for(const key of keys){const values=samples.map((r:any)=>Number(r[key]||0));scalar[key]={median:median(values),p75:percentile(values,.75),p90:percentile(values,.90)};}
  const destinationRows=samples.filter((r:any)=>r.destination_snapshot),routes:any={fd:[],lh:[]};
  for(const route of ['fd','lh'] as const){
    const names=new Set<string>();for(const r of destinationRows)for(const n of destMap(r.destination_snapshot,route).keys())names.add(n);
    const current=new Map((Array.isArray(analytics?.[route])?analytics[route]:[]).map((g:any)=>[String(g.name||''),Number(g.count||0)]));
    const alerts:any[]=[];
    for(const name of names){const values=destinationRows.map((r:any)=>destMap(r.destination_snapshot,route).get(name)||0),med=median(values);if(med===null||values.length<4)continue;const now=Number(current.get(name)||0),threshold=Math.max(med*1.5,med+50);if(now>threshold)alerts.push({name,current:now,median:Math.round(med*10)/10,delta:Math.round((now-med)*10)/10,ratio:med>0?Math.round(now/med*100)/100:null,samples:values.length});}
    routes[route]=alerts.sort((a:any,b:any)=>b.delta-a.delta||b.current-a.current).slice(0,20);
  }
  const current=scalarMetrics(analytics),alerts:any[]=[];
  for(const key of keys){const med=Number(scalar[key]?.median||0),now=Number((current as any)[key]||0),threshold=Math.max(med*1.35,med+Math.max(20,med*.1));if(now>threshold)alerts.push({metric:key,current:now,median:Math.round(med*10)/10,delta:Math.round((now-med)*10)/10,ratio:med>0?Math.round(now/med*100)/100:null});}
  return{available:true,samples:samples.length,hourBangkok:hour,scope:sameShift.length>=4?'same_shift_same_hour':'same_hour',scalar,destinationAlerts:routes,alerts};
}
