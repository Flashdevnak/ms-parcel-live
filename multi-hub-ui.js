import {supabase} from './auth-client.js?v=20260906-control-room-v31';

const FUNCTION_BASE='https://afhnfnfbqdqqzrghovfc.supabase.co/functions/v1/ms-parcel-api';
const PUBLISHABLE_KEY='sb_publishable_4GStzbYK3_BhthidusT_hw_DqtzC7qE';
const $=(id)=>document.getElementById(id);
let branch=null,active=false,admin=false,seq=0;

function sync(){
  const button=$('upload-har-btn');
  if(!button)return;
  const allowed=active&&(admin||branch?.can_upload_har===true);
  button.classList.toggle('hidden',!allowed);
  button.setAttribute('aria-hidden',String(!allowed));
  if(allowed)button.title=`อัปโหลด HAR เฉพาะ ${branch?.code||'HUB ที่เลือก'}`;
}

async function readStatus(branchId=0){
  const mine=++seq;
  if(!branchId){branch=null;active=false;admin=false;sync();return;}
  try{
    const {data}=await supabase.auth.getSession();
    const token=data?.session?.access_token;
    if(!token)return;
    const res=await fetch(`${FUNCTION_BASE}/status?branch_id=${branchId}`,{headers:{Authorization:`Bearer ${token}`,apikey:PUBLISHABLE_KEY},cache:'no-store'});
    const out=await res.json().catch(()=>null);
    if(mine!==seq||!res.ok||!out?.ok)return;
    const profile=out.data?.profile||{};
    const selected=(out.data?.branches||[]).find(b=>Number(b.id)===Number(branchId))||out.data?.branch||null;
    branch=selected;
    active=profile.access_status==='active';
    admin=profile.role==='admin';
    sync();
  }catch{}
}

window.addEventListener('ms-branch-ready',(event)=>{
  const b=event.detail||null;
  branch=b;
  void readStatus(Number(b?.id||0));
});
window.addEventListener('ms-session-reset',()=>{
  seq++;branch=null;active=false;admin=false;sync();
});

const observer=new MutationObserver(()=>sync());
const start=()=>{
  const button=$('upload-har-btn');
  if(button)observer.observe(button,{attributes:true,attributeFilter:['class']});
  sync();
};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
