import { db, decryptCredential, encryptCredential, hashPage, json } from './core.ts';

export function slimRow(r: any) {
  return {
    pno:r?.pno??null,state_name:r?.state_name??null,cod_amount:r?.cod_amount??null,store_weight:r?.store_weight??null,
    plan_leave_time:r?.plan_leave_time??null,real_arrive_time:r?.real_arrive_time??null,pack_num:r?.pack_num??null,
    marker_category_name:r?.marker_category_name??null,LastAction_name:r?.LastAction_name??null,LastActionTime:r?.LastActionTime??null,
    staff_info_name:r?.staff_info_name??null,staff_info_phone:r?.staff_info_phone??null,store_manager_phone:r?.store_manager_phone??null,
    dst_hub_name:r?.dst_hub_name??null,dst_store_name:r?.dst_store_name??null,dst_province_name:r?.dst_province_name??null,
    dst_city_name:r?.dst_city_name??null,dst_postal_code:r?.dst_postal_code??null,ka_id:r?.ka_id??null,ka_name:r?.ka_name??null,
    customer_type_category:r?.customer_type_category??null,
  };
}
export function diffRows(oldRows:any[],newRows:any[]) {
  const oldMap=new Map<string,string>(),oldKeys=new Set<string>();
  for(const row of oldRows){const k=String(row?.pno||'');if(!k)continue;oldKeys.add(k);oldMap.set(k,JSON.stringify(row));}
  const nextKeys=new Set<string>(),upserts:any[]=[],order:string[]=[];
  for(const row of newRows){const k=String(row?.pno||'');if(!k)continue;nextKeys.add(k);order.push(k);if(oldMap.get(k)!==JSON.stringify(row))upserts.push(row);}
  return {upserts,removed:[...oldKeys].filter(k=>!nextKeys.has(k)),order};
}

export async function listBranches(activeOnly=true){
  const rows=await db(`branches?select=id,code,name,store_id,is_active,created_at,updated_at${activeOnly?'&is_active=eq.true':''}&order=code.asc`);
  const conns=await db('ms_connection?select=branch_id,store_id,store_name,credential_updated_at,last_ok_at,last_error,is_active');
  const byBranch=new Map((conns||[]).map((c:any)=>[Number(c.branch_id),c]));
  return (rows||[]).map((b:any)=>{const c=byBranch.get(Number(b.id));return {...b,store_id:c?.store_id||b.store_id||null,store_name:c?.store_name||null,has_credential:!!c?.credential_updated_at,credential_updated_at:c?.credential_updated_at||null,last_ok_at:c?.last_ok_at||null,last_error:c?.last_error||null};});
}
export async function resolveBranch(profile:any,requested:number){
  let id=requested||Number(profile?.branch_id||0);
  if(profile?.role==='admin'&&!id){const branches=await listBranches(true);id=Number(branches?.[0]?.id||0);}
  if(!id)throw new Error('บัญชียังไม่ได้ผูกสาขา');
  if(profile?.role!=='admin'&&Number(profile?.branch_id||0)!==id)throw new Error('ไม่มีสิทธิ์เข้าถึงสาขานี้');
  const rows=await db(`branches?id=eq.${id}&is_active=eq.true&select=id,code,name,store_id,is_active&limit=1`);
  if(!rows?.[0])throw new Error('ไม่พบสาขาที่เปิดใช้งาน');
  return rows[0];
}
export async function getConnection(branchId:number){
  const rows=await db(`ms_connection?branch_id=eq.${branchId}&is_active=eq.true&select=*&limit=1`);
  if(!rows?.[0])throw new Error('สาขานี้ยังไม่ได้ตั้งค่าการเชื่อมต่อ MS');
  const row=rows[0],decoded=await decryptCredential(row.credential_ciphertext);
  if(!Object.keys(decoded.credential).length)throw new Error('สาขานี้ยังไม่ได้อัปโหลด HAR');
  if(decoded.legacy)await db(`ms_connection?id=eq.${row.id}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({credential_ciphertext:await encryptCredential(decoded.credential),updated_at:new Date().toISOString()})});
  return {...row,credential:decoded.credential};
}
export async function updateConnectionHealth(conn:any,ok:boolean,message=''){
  const patch:Record<string,unknown>={};
  if(ok){const last=Date.parse(String(conn?.last_ok_at||''));const due=!Number.isFinite(last)||Date.now()-last>=15*60_000||!!conn?.last_error;if(!due)return;patch.last_ok_at=new Date().toISOString();patch.last_error=null;}
  else{const next=String(message||'').slice(0,1000);if(String(conn?.last_error||'')===next)return;patch.last_error=next;}
  await db(`ms_connection?id=eq.${conn.id}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(patch)});
}

export function pickHarRequest(har:any){
  const entries=Array.isArray(har?.log?.entries)?har.log.entries:[];
  const matches=entries.filter((e:any)=>{try{const u=new URL(e?.request?.url||'');return u.hostname==='fbi.flashexpress.com'&&u.pathname==='/api/dc/unfinished_parcel_list'&&e?.request?.method==='GET';}catch{return false;}});
  if(!matches.length)throw new Error('HAR นี้ไม่มี request /api/dc/unfinished_parcel_list');
  const req=matches[matches.length-1].request,url=new URL(req.url),ignored=new Set(['page','page_size','export','total']),publicKeys=new Set(['lang','_from','store_id','key','time_key']),queryTemplate:Record<string,string>={},credential:Record<string,string>={};
  for(const[k,v]of url.searchParams.entries()){if(ignored.has(k))continue;if(publicKeys.has(k))queryTemplate[k]=v;else credential[k]=v;}
  if(!queryTemplate.store_id||!credential.auth)throw new Error('HAR ไม่มี store_id หรือ auth ที่จำเป็น');
  return{baseUrl:`${url.protocol}//${url.host}`,path:url.pathname,queryTemplate,credential};
}
function sourceHeaders(conn:any){return{'Accept':'application/json, text/plain, */*','Accept-Language':'th','BI-PLATFORM':'','Referer':`${conn.fbi_base_url}/fbi-ui/`,'User-Agent':'Mozilla/5.0'};}
function applyBase(url:URL,conn:any){const params={...(conn.query_template||{}),...(conn.credential||{})};for(const[k,v]of Object.entries(params))if(v!==undefined&&v!==null&&String(v)!=='')url.searchParams.set(k,String(v));}
async function fetchJson(url:URL,conn:any){const res=await fetch(url.toString(),{method:'GET',headers:sourceHeaders(conn)}),text=await res.text();if(!res.ok)throw new Error(`MS ${res.status}: ${text.slice(0,300)}`);let obj:any;try{obj=JSON.parse(text);}catch{throw new Error('MS ตอบกลับไม่ใช่ JSON');}if(Number(obj?.code)!==1)throw new Error(obj?.msg||'MS ไม่อนุญาตให้อ่านข้อมูล');return obj;}
export async function fetchLivePage(conn:any,page:number,pageSize:number){const url=new URL(conn.endpoint_path,conn.fbi_base_url);applyBase(url,conn);url.searchParams.set('page',String(page));url.searchParams.set('page_size',String(pageSize));const obj=await fetchJson(url,conn);return{rows:(Array.isArray(obj?.data?.list)?obj.data.list:[]).map(slimRow),total:Number(obj?.data?.total||0)};}
export async function fetchSummary(conn:any){const url=new URL('/api/dc/dc_delivery_transfer_list',conn.fbi_base_url);applyBase(url,conn);url.searchParams.delete('store_id');url.searchParams.delete('time_key');url.searchParams.set('type','1');url.searchParams.set('key','transfer');const obj=await fetchJson(url,conn),rows=Array.isArray(obj?.data?.data)?obj.data.data:[],target=rows.find((r:any)=>String(r?.store_id||'')===String(conn.store_id||''))||rows[0]||{};return{storeId:target.store_id||conn.store_id||'',storeName:target.store_name||conn.store_name||'',region:target.store_area||'',total:Number(target.transfer_total||0),day1:Number(target.transfer_1||0),day2:Number(target.transfer_2||0),day3:Number(target.transfer_3||0),day4:Number(target.transfer_4||0),day5plus:Number(target.transfer_5||0)};}

export function liveResponseFromCache(c:any,knownHash:string,profileRole:string,cache='hit',stale=false,error=''){
  const p=c?.payload||{},hash=String(c?.content_hash||p?.hash||''),base={total:Number(c?.source_total??p?.total??0),page:Number(p?.page||1),pageSize:Number(p?.pageSize||100),sourceAt:c?.source_updated_at||p?.sourceAt||new Date().toISOString(),hash,branchId:Number(c?.branch_id||0)},meta={cache,stale,error:error||undefined,profileRole,ttlMs:Math.max(0,new Date(c?.expires_at||0).getTime()-Date.now())};
  if(knownHash&&hash&&knownHash===hash)return json({ok:true,data:{...base,notModified:true,changed:false},meta});
  if(knownHash&&c?.previous_hash&&knownHash===c.previous_hash&&c?.delta_payload)return json({ok:true,data:{...base,delta:c.delta_payload,changed:true},meta});
  return json({ok:true,data:{...base,rows:Array.isArray(p?.rows)?p.rows:[],changed:!!p?.changed},meta});
}

export async function oldHashForCache(c:any){const oldRows=Array.isArray(c?.payload?.rows)?c.payload.rows:[],oldTotal=Number(c?.source_total??c?.payload?.total??0);return String(c?.content_hash||(oldRows.length?await hashPage(oldRows,oldTotal):''));}