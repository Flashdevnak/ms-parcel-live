import { fetchLivePage } from './ms.ts';

const DEFAULT_PAGE_SIZE = 5000;
const MAX_PAGES = 80;
const BANDS = ['under3','3to6','6to9','9to12','12to16','16to22','22to24','24to48','over48','unknown'];

function cleanName(value: unknown) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return raw.replace(/^\s*(?:(?:\([^)]*\)|（[^）]*）)\s*)+/, '').trim() || raw;
}
function normalize(value: unknown) { return cleanName(value).toUpperCase().replace(/^\d+\s*/, '').replace(/\s+/g, ' ').trim(); }
function ownHubMatcher(branch: any) {
  const code = String(branch?.code || '').trim().toUpperCase(), ownName = normalize(branch?.name || '');
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const codeRe = code ? new RegExp(`(^|[^A-Z0-9])${escaped}(?:_HUB)?([^A-Z0-9]|$)`, 'i') : null;
  return (value: unknown) => {
    const raw = cleanName(value); if (!raw) return false;
    if (ownName && normalize(raw) === ownName) return true;
    return !!codeRe?.test(raw.toUpperCase());
  };
}
function weightKg(value: unknown) { const n = Number(value); return Number.isFinite(n) ? n / 1000 : 0; }
function parseTime(value: unknown) {
  const raw = String(value ?? '').trim(); if (!raw || raw === '-' || raw === '--') return NaN;
  let v = raw;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(raw) && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) v = raw.replace(' ', 'T') + '+07:00';
  const n = Date.parse(v); return Number.isFinite(n) ? n : NaN;
}
function bandOf(value: unknown, now: number) {
  const t = parseTime(value); if (!Number.isFinite(t) || now < t) return 'unknown';
  const h = (now - t) / 3600000;
  if (h < 3) return 'under3'; if (h < 6) return '3to6'; if (h < 9) return '6to9'; if (h < 12) return '9to12';
  if (h < 16) return '12to16'; if (h < 22) return '16to22'; if (h < 24) return '22to24'; if (h <= 48) return '24to48'; return 'over48';
}
function addGroup(map: Map<string, any>, key: string, kg: number) {
  if (!key) return;
  const item = map.get(key) || { name:key, count:0, weightKg:0 };
  item.count += 1; item.weightKg += kg; map.set(key,item);
}
function addCount(map: Map<string, number>, key: string) { const name=key||'-'; map.set(name,(map.get(name)||0)+1); }
function sortedGroups(map: Map<string, any>) {
  return [...map.values()].map((x)=>({...x,weightKg:Math.round(x.weightKg*1000)/1000,avgKg:x.count?Math.round((x.weightKg/x.count)*1000)/1000:0})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'th'));
}
function sortedCounts(map: Map<string, number>) { return [...map.entries()].map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'th')); }
function cellKey(route:string,dest:string,band:string,action:string){return `${route}\u001f${dest}\u001f${band}\u001f${action}`;}

export async function buildFullAnalytics(conn:any, branch:any, requestedPageSize=DEFAULT_PAGE_SIZE) {
  const pageSize=Math.max(500,Math.min(10000,Number(requestedPageSize)||DEFAULT_PAGE_SIZE));
  const first=await fetchLivePage(conn,1,pageSize),total=Number(first.total||0),observed=first.rows.length;
  if(total>observed&&observed<=100&&pageSize>100)return{complete:false,reason:'source_page_cap',total,scanned:observed,sourcePageSize:observed,requestedPageSize:pageSize,updatedAt:new Date().toISOString()};
  const effectivePageSize=Math.max(1,observed||pageSize),pages=Math.max(1,Math.ceil(total/effectivePageSize));
  if(pages>MAX_PAGES)return{complete:false,reason:'too_many_pages',total,scanned:observed,sourcePageSize:effectivePageSize,requestedPageSize:pageSize,pages,updatedAt:new Date().toISOString()};

  const now=Date.now(),isOwnHub=ownHubMatcher(branch),fd=new Map<string,any>(),lh=new Map<string,any>(),actions=new Map<string,number>(),parcelStates=new Map<string,number>(),bags=new Set<string>(),cells=new Map<string,any>();
  const bandTotals:Record<string,number>=Object.fromEntries(BANDS.map((b)=>[b,0]));
  let scanned=0,totalWeightKg=0,baggedParcels=0;
  const consume=(rows:any[])=>{for(const row of rows){
    scanned+=1;
    const kg=weightKg(row?.store_weight),band=bandOf(row?.real_arrive_time,now),action=String(row?.LastAction_name||'-').trim()||'-';
    totalWeightKg+=kg; bandTotals[band]=(bandTotals[band]||0)+1; addCount(actions,action); addCount(parcelStates,String(row?.state_name||'-').trim()||'-');
    const bag=String(row?.pack_num||'').trim(),hasBag=!!bag&&bag!=='-'&&bag!=='--'; if(hasBag){baggedParcels+=1;bags.add(bag);}
    const hubRaw=row?.dst_hub_name,hub=cleanName(hubRaw),store=cleanName(row?.dst_store_name);
    let route='other',dest='';
    if(isOwnHub(hubRaw)){route='fd';dest=store;if(store)addGroup(fd,store,kg);}else if(hub){route='lh';dest=hub;addGroup(lh,hub,kg);}
    const key=cellKey(route,dest,band,action),cell=cells.get(key)||{r:route,d:dest,b:band,a:action,c:0,w:0,g:0,t:0};
    cell.c+=1;cell.w+=kg;if(hasBag)cell.g+=1;
    const latest=parseTime(row?.LastActionTime);if(Number.isFinite(latest)&&latest>cell.t)cell.t=latest;
    cells.set(key,cell);
  }};
  consume(first.rows);
  for(let start=2;start<=pages;start+=3){const nums=[start,start+1,start+2].filter((p)=>p<=pages),batch=await Promise.all(nums.map((p)=>fetchLivePage(conn,p,pageSize)));for(const page of batch)consume(page.rows);}

  const compactCells=[...cells.values()].map((x)=>({...x,w:Math.round(x.w*1000)/1000}));
  return{
    complete:scanned>=total,total,scanned,sourcePageSize:pageSize,pages,
    totalWeightKg:Math.round(totalWeightKg*1000)/1000,avgWeightKg:scanned?Math.round((totalWeightKg/scanned)*1000)/1000:0,
    baggedParcels,uniqueBags:bags.size,bandTotals,
    fd:sortedGroups(fd),lh:sortedGroups(lh),actions:sortedCounts(actions),parcelStates:sortedCounts(parcelStates),cells:compactCells,
    updatedAt:new Date().toISOString(),
  };
}
