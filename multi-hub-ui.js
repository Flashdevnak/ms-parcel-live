// Compatibility bridge for the legacy shell. Branch permissions now come from
// user_branch_access and are returned on each accessible branch by /status.
// This module only fixes presentation state; Edge authorization remains the
// source of truth for every HAR write.
const $=(id)=>document.getElementById(id);
let branch=null,active=false,admin=false;

function sync(){
  const button=$('upload-har-btn');
  if(!button)return;
  const allowed=active&&(admin||branch?.can_upload_har===true);
  button.classList.toggle('hidden',!allowed);
  button.setAttribute('aria-hidden',String(!allowed));
  if(allowed)button.title=`อัปโหลด HAR เฉพาะ ${branch?.code||'HUB ที่เลือก'}`;
}

async function readStatus(branchId=0){
  try{
    const auth=window.supabase||null;
    // app.js owns authentication; status events below normally provide all
    // state we need. Do not create a polling loop here.
    if(!auth||!branchId)return;
  }catch{}
}

window.addEventListener('ms-branch-ready',(event)=>{
  branch=event.detail||null;
  sync();
});
window.addEventListener('ms-session-reset',()=>{
  branch=null;active=false;admin=false;sync();
});
window.addEventListener('ms-account-state',(event)=>{
  const d=event.detail||{};
  active=d.accessStatus==='active';
  admin=d.role==='admin';
  sync();
});

// app.js may update button visibility after the branch event. Keep this tiny
// observer scoped to the one permission-controlled button, not the whole DOM.
const observer=new MutationObserver(()=>sync());
const start=()=>{const button=$('upload-har-btn');if(button)observer.observe(button,{attributes:true,attributeFilter:['class']});sync();};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
