import {supabase as client} from './auth-client.js?v=20260906-adaptive-scan-v1';
const URL='https://afhnfnfbqdqqzrghovfc.supabase.co';
const KEY='sb_publishable_4GStzbYK3_BhthidusT_hw_DqtzC7qE';
let generation=0,loading=false,nextAt=0,timer;
const id=()=>Number(document.getElementById('branch-select')?.value||0);
const emit=(state,extra={})=>window.dispatchEvent(new CustomEvent('ms-analytics-state',{detail:{state,...extra}}));
function schedule(ms){clearTimeout(timer);nextAt=Date.now()+ms;timer=setTimeout(()=>{if(!document.hidden)void load();},ms);}
function publish(data,expiresAt){window.__MS_FULL_ANALYTICS={...data,cacheExpiresAt:expiresAt};window.dispatchEvent(new CustomEvent('ms-full-analytics',{detail:window.__MS_FULL_ANALYTICS}));}
export async function load(){
 if(loading||document.hidden)return;
 const branch=id(),seq=generation;
 if(!branch){schedule(1500);return;}
 loading=true;
 try{
  const {data}=await client.auth.getSession();if(!data.session){schedule(2000);return;}
  const headers={apikey:KEY,Authorization:`Bearer ${data.session.access_token}`};
  const res=await fetch(`${URL}/rest/v1/summary_cache?branch_id=eq.${branch}&cache_key=eq.b:${branch}:summary:full-analytics-v1&select=payload,expires_at&limit=1`,{headers,cache:'no-store'});
  if(!res.ok)throw new Error('อ่านภาพรวมไม่ได้');
  const cached=(await res.json())[0];if(seq!==generation)return;
  const compatible=cached?.payload?.schemaVersion===5;
  if(compatible)publish(cached.payload,cached.expires_at);
  if(compatible&&Date.parse(cached.expires_at)>Date.now()){
   emit(cached.payload.complete?'ready':'incomplete',{expiresAt:cached.expires_at});schedule(Math.max(15000,Date.parse(cached.expires_at)-Date.now()+1000));return;
  }
  emit('loading');
  const claim=await fetch(`${URL}/rest/v1/rpc/claim_cache_refresh`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({p_branch_id:branch,p_cache_key:`b:${branch}:summary:transfer-summary`,p_lease_seconds:15})});
  if(!claim.ok||await claim.json()!==true){schedule(4000);return;}
  if(seq!==generation)return;
  const edge=await fetch(`${URL}/functions/v1/ms-parcel-api/analytics?branch_id=${branch}`,{headers,cache:'no-store'});
  const out=await edge.json();if(!edge.ok||!out.ok)throw new Error('อัปเดตภาพรวมไม่สำเร็จ');if(seq!==generation)return;
  const ttl=Number(out.meta?.ttlMs)||(out.data?.complete?1800000:300000);
  const expires=out.meta?.expiresAt||new Date(Date.now()+ttl).toISOString();publish(out.data,expires);
  emit(out.meta?.stale?'error':out.data?.complete?'ready':'incomplete');schedule(Math.max(15000,ttl+1000));
 }catch(e){if(seq===generation){emit('error',{message:e.message});schedule(30000);}}
 finally{loading=false;if(seq!==generation)schedule(500);}
}
function reset(){generation++;nextAt=0;window.__MS_FULL_ANALYTICS=null;emit('waiting');schedule(500);}
window.addEventListener('ms-branch-ready',()=>{if(Number(window.__MS_FULL_ANALYTICS?.branchId)!==id())reset();});
window.addEventListener('ms-session-reset',reset);
document.getElementById('branch-select')?.addEventListener('change',reset);
window.addEventListener('ms-request-analytics',()=>{if(!loading)void load();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()>=nextAt)void load();});
schedule(800);
