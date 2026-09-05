import { db } from './core.ts';
import { fetchLivePage } from './ms.ts';
import { collectSnapshot } from './scan.js';

const DEFAULT_PAGE_SIZE = 10000;
const SNAPSHOT_PAGE_SIZE = 5000;
const SNAPSHOT_TTL_MS = 30 * 60_000;
const SNAPSHOT_WRITE_BATCH = 3;
const BANDS = ['under3','3to6','6to9','9to12','12to16','16to22','22to24','24to48','over48','unknown'];

function cleanName(value:unknown){const raw=String(value??'').trim();if(!raw)return'';return raw.replace(/^\s*(?:(?:\([^)]*\)|（[^）]*）)\s*)+/,'').trim()||raw;}
function normalize(value:unknown){return cleanName(value).toUpperCase().replace(/^\d+\s*/,'').replace(/\s+/g,' ').trim();}
function ownHubMatcher(branch:any){const code=String(branch?.code||'').trim().toUpperCase(),ownName=normalize(branch?.name||''),escaped=code.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),codeRe=code?new RegExp(`(^|[^A-Z0-9])${escaped}(?:_HUB)?([^A-Z0-9]|$)`,'i'):null;return(value:unknown)=>{const raw=cleanName(value);if(!raw)return false;if(ownName&&normalize(raw)===ownName)return true;return!!codeRe?.test(raw.toUpperCase());};}
function weightKg(value:unknown){const n=Number(value);return Number.isFinite(n)?n/1000:0;}
function parseTime(value:unknown){const raw=String(value??'').trim();if(!raw||raw==='-'||raw==='--')return NaN;let v=raw;if(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(raw)&&!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw))v=raw.replace(' ','T')+'+07:00';const n=Date.parse(v);return Number.isFinite(n)?n:NaN;}
function bandOf(value:unknown,now:number){const t=parseTime(value);if(!Number.isFinite(t)||now<t)return'unknown';const h=(now-t)/3600000;if(h<3)return'under3';if(h<6)return'3to6';if(h<9)return'6to9';if(h<12)return'9to12';if(h<16)return'12to16';if(h<22)return'16to22';if(h<24)return'22to24';if(h<=48)return'24to48';return'over48';}
function addGroup(map:Map<string,any>,key:string,kg:number){if(!key)return;const item=map.get(key)||{name:key,count:0,weightKg:0};item.count+=1;item.weightKg+=kg;map.set(key,item);}
function addCount(map:Map<string,number>,key:string){const name=String(key||'-').trim()||'-';map.set(name,(map.get(name)||0)+1);}
function sortedGroups(map:Map<string,any>){return[...map.values()].map((x)=>({...x,weightKg:Math.round(x.weightKg*1000)/1000,avgKg:x.count?Math.round((x.weightKg/x.count)*1000)/1000:0})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'th'));}
function sortedCounts(map:Map<string,number>){return[...map.entries()].map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'th'));}
function cellKey(route:string,dest:string,band:string,action:string,manager:string){return`${route}\u001f${dest}\u001f${band}\u001f${action}\u001f${manager}`;}
function snapshotRow(r:any){return[
  r?.pno??'',r?.state_name??'',r?.store_weight??'',r?.plan_leave_time??'',r?.real_arrive_time??'',r?.pack_num??'',
  r?.LastAction_name??'',r?.LastActionTime??'',r?.staff_info_phone??'',r?.store_manager_display??r?.store_manager_phone??'',r?.dst_hub_name??'',r?.dst_store_name??''
];}
function snapshotPrefix(branchId:number,snapshotId:string){return`b:${branchId}:snapshot:${snapshotId}:p:`;}
function snapshotKey(branchId:number,snapshotId:string,pageNo:number){return`${snapshotPrefix(branchId,snapshotId)}${String(pageNo).padStart(4,'0')}`;}

async function persistSnapshot(branchId:number,snapshotId:string,pages:any[],sourceTotal:number,sourceAt:string,expiresAt:string){
  const prefix=snapshotPrefix(branchId,snapshotId);
  try{
    for(let start=0;start<pages.length;start+=SNAPSHOT_WRITE_BATCH){
      const records=pages.slice(start,start+SNAPSHOT_WRITE_BATCH).map((rows,offset)=>{
        const pageNo=start+offset+1;
        return{
          cache_key:snapshotKey(branchId,snapshotId,pageNo),
          branch_id:branchId,
          payload:rows,
          item_count:rows.length,
          source_total:sourceTotal,
          source_updated_at:sourceAt,
          expires_at:expiresAt,
          content_hash:null,
          previous_hash:null,
          delta_payload:null,
          unchanged_streak:0,
        };
      });
      await db('live_cache_pages?on_conflict=cache_key',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(records)});
    }
    const oldBefore=new Date(Date.now()-60_000).toISOString();
    const pattern=encodeURIComponent(`b:${branchId}:snapshot:%`);
    await db(`live_cache_pages?branch_id=eq.${branchId}&cache_key=like.${pattern}&expires_at=lt.${encodeURIComponent(oldBefore)}`,{method:'DELETE'});
    return true;
  }catch{
    try{await db(`live_cache_pages?branch_id=eq.${branchId}&cache_key=like.${encodeURIComponent(prefix+'%')}`,{method:'DELETE'});}catch{}
    return false;
  }
}

export async function buildFullAnalytics(conn:any,branch:any,requestedPageSize=DEFAULT_PAGE_SIZE){
  const branchId=Number(branch?.id||0),pageSize=Math.max(500,Math.min(10000,Number(requestedPageSize)||DEFAULT_PAGE_SIZE));
  const collected:any=await collectSnapshot((p:number,size:number)=>fetchLivePage(conn,p,size),pageSize);
  const {rowPages,...scan}=collected;
  const {total,pages}=scan;
  if(!rowPages?.length)return {...scan,branchId,snapshotStore:null,snapshotId:null,snapshotPages:0,snapshotExpiresAt:null,updatedAt:new Date().toISOString(),schemaVersion:5};

  const now=Date.now(),sourceAt=new Date(now).toISOString(),snapshotId=crypto.randomUUID(),expiresAt=new Date(now+SNAPSHOT_TTL_MS).toISOString();
  const isOwnHub=ownHubMatcher(branch),fd=new Map<string,any>(),lh=new Map<string,any>(),actions=new Map<string,number>(),parcelStates=new Map<string,number>(),managerPhones=new Map<string,number>(),bags=new Set<string>(),cells=new Map<string,any>(),bandTotals:Record<string,number>=Object.fromEntries(BANDS.map((b)=>[b,0])),snapshotPages:any[]=[];
  let scanned=0,totalWeightKg=0,baggedParcels=0,overdueTotal=0,criticalTotal=0;

  const consume=(rows:any[])=>{
    const compact=rows.map(snapshotRow);
    for(let i=0;i<compact.length;i+=SNAPSHOT_PAGE_SIZE)snapshotPages.push(compact.slice(i,i+SNAPSHOT_PAGE_SIZE));
    for(const row of rows){
      scanned+=1;
      const kg=weightKg(row?.store_weight),band=bandOf(row?.real_arrive_time,now),action=String(row?.LastAction_name||'-').trim()||'-',manager=String(row?.store_manager_display||row?.store_manager_phone||'-').trim()||'-',plan=parseTime(row?.plan_leave_time),overdue=Number.isFinite(plan)&&now>plan,critical=overdue&&band==='over48';
      totalWeightKg+=kg;bandTotals[band]=(bandTotals[band]||0)+1;addCount(actions,action);addCount(parcelStates,String(row?.state_name||'-'));addCount(managerPhones,manager);if(overdue)overdueTotal+=1;if(critical)criticalTotal+=1;
      const bag=String(row?.pack_num||'').trim(),hasBag=!!bag&&bag!=='-'&&bag!=='--';if(hasBag){baggedParcels+=1;bags.add(bag);}
      const hubRaw=row?.dst_hub_name,hub=cleanName(hubRaw),store=cleanName(row?.dst_store_name);let route='other',dest='';
      if(isOwnHub(hubRaw)){route='fd';dest=store;if(store)addGroup(fd,store,kg);}else if(hub){route='lh';dest=hub;addGroup(lh,hub,kg);}
      const key=cellKey(route,dest,band,action,manager),cell=cells.get(key)||{r:route,d:dest,b:band,a:action,m:manager,c:0,w:0,g:0,o:0,q:0,t:0};
      cell.c+=1;cell.w+=kg;if(hasBag)cell.g+=1;if(overdue)cell.o+=1;if(critical)cell.q+=1;const latest=parseTime(row?.LastActionTime);if(Number.isFinite(latest)&&latest>cell.t)cell.t=latest;cells.set(key,cell);
    }
  };

  for(const rows of rowPages)consume(rows);
  const complete=scan.complete&&scanned===total;
  const snapshotAvailable=complete&&branchId>0?await persistSnapshot(branchId,snapshotId,snapshotPages,total,sourceAt,expiresAt):false;
  return{
    ...scan,complete:complete&&snapshotAvailable,reason:!complete?scan.reason:snapshotAvailable?null:'snapshot_write_failed',schemaVersion:5,total,scanned,pages,snapshotStore:snapshotAvailable?'live_cache_pages':null,snapshotId:snapshotAvailable?snapshotId:null,snapshotPages:snapshotAvailable?snapshotPages.length:0,snapshotExpiresAt:snapshotAvailable?expiresAt:null,
    totalWeightKg:Math.round(totalWeightKg*1000)/1000,avgWeightKg:scanned?Math.round((totalWeightKg/scanned)*1000)/1000:0,baggedParcels,uniqueBags:bags.size,overdueTotal,criticalTotal,bandTotals,
    fd:sortedGroups(fd),lh:sortedGroups(lh),actions:sortedCounts(actions),parcelStates:sortedCounts(parcelStates),managerPhones:sortedCounts(managerPhones),cells:[...cells.values()].map((x)=>({...x,w:Math.round(x.w*1000)/1000})),updatedAt:sourceAt
  };
}
