import { authAdminCreateUser, authAdminDeleteUser, authAdminSetPassword, db, normalizeUsername, publicProfile, validUsername } from './core.ts';

type BranchAccess={branch_id:number;can_upload_har:boolean;can_manage_shift:boolean};

function cleanAliases(value:any){
  const list=Array.isArray(value)?value:String(value||'').split(/[,\n]/);
  return [...new Set(list.map((v:any)=>String(v||'').trim()).filter(Boolean))].slice(0,50);
}
function parseBranchAccess(body:any):BranchAccess[]{
  const raw=Array.isArray(body?.branchAccess)?body.branchAccess:[];
  let rows=raw.map((x:any)=>({branch_id:Number(x?.branchId||x?.branch_id||0),can_upload_har:!!(x?.canUploadHar??x?.can_upload_har),can_manage_shift:(x?.canManageShift??x?.can_manage_shift)!==false}));
  if(!rows.length&&Array.isArray(body?.branchIds))rows=body.branchIds.map((id:any)=>({branch_id:Number(id||0),can_upload_har:false,can_manage_shift:true}));
  if(!rows.length&&Number(body?.branchId||0)>0)rows=[{branch_id:Number(body.branchId),can_upload_har:!!body?.canUploadHar,can_manage_shift:true}];
  const merged=new Map<number,BranchAccess>();
  for(const row of rows){if(!Number.isSafeInteger(row.branch_id)||row.branch_id<=0)continue;const prev=merged.get(row.branch_id);merged.set(row.branch_id,{branch_id:row.branch_id,can_upload_har:!!(row.can_upload_har||prev?.can_upload_har),can_manage_shift:row.can_manage_shift!==false&&(prev?.can_manage_shift!==false)});}
  return [...merged.values()];
}
async function validateBranches(access:BranchAccess[]){
  if(!access.length)throw new Error('กรุณาเลือกอย่างน้อย 1 HUB/สาขา');
  for(const a of access){const rows=await db(`branches?id=eq.${a.branch_id}&is_active=eq.true&select=id&limit=1`);if(!rows?.[0])throw new Error(`HUB/สาขา #${a.branch_id} ไม่ถูกต้องหรือถูกปิดใช้งาน`);}
}
async function syncBranchAccess(userId:string,access:BranchAccess[]){
  await db(`user_branch_access?user_id=eq.${encodeURIComponent(userId)}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});
  if(!access.length)return;
  await db('user_branch_access',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(access.map(a=>({user_id:userId,branch_id:a.branch_id,can_upload_har:a.can_upload_har,can_manage_shift:a.can_manage_shift,is_active:true,updated_at:new Date().toISOString()})))});
}

export async function listUsers(){
  const profiles=await db('app_profiles?select=user_id,username,display_name,role,access_status,branch_id,can_upload_har,created_at,updated_at&order=created_at.asc')||[];
  const accesses=await db('user_branch_access?select=user_id,branch_id,can_upload_har,can_manage_shift,is_active&order=branch_id.asc')||[];
  const byUser=new Map<string,any[]>();
  for(const a of accesses){const key=String(a.user_id||'');if(!byUser.has(key))byUser.set(key,[]);byUser.get(key)!.push(a);}
  return profiles.map((p:any)=>({...p,branch_access:byUser.get(String(p.user_id))||[]}));
}

export async function createManagedUser(body:any){
  const username=normalizeUsername(body?.username),password=String(body?.password||''),displayName=String(body?.displayName||'').trim(),access=parseBranchAccess(body);
  if(!validUsername(username))throw new Error('Username ใช้ a-z, 0-9, จุด, ขีด และ _ จำนวน 3-32 ตัว');
  if(password.length<6||password.length>128)throw new Error('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');
  const existing=await db(`app_profiles?username=ilike.${encodeURIComponent(username)}&select=user_id&limit=1`);
  if(existing?.length)throw new Error('Username นี้ถูกใช้แล้ว');
  await validateBranches(access);
  const requestedDefault=Number(body?.defaultBranchId||body?.branchId||0),defaultBranch=access.some(a=>a.branch_id===requestedDefault)?requestedDefault:access[0].branch_id;
  const internalEmail=`${username}.${crypto.randomUUID().replaceAll('-','')}@ms-parcel.invalid`;
  const authUser=await authAdminCreateUser(internalEmail,password,username,displayName);
  try{
    const created=await db('app_profiles',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({user_id:authUser.id,username,display_name:displayName||username,email:internalEmail,role:'viewer',access_status:'active',branch_id:defaultBranch,can_upload_har:access.some(a=>a.can_upload_har)})});
    await syncBranchAccess(String(authUser.id),access);
    return {...publicProfile(created?.[0]),branch_access:access};
  }catch(e){await authAdminDeleteUser(String(authUser.id));throw e;}
}

export async function changeUser(actorId:string,body:any){
  const targetId=String(body?.userId||''),action=String(body?.action||'');
  if(!targetId)throw new Error('ไม่พบผู้ใช้');
  const targetRows=await db(`app_profiles?user_id=eq.${encodeURIComponent(targetId)}&select=user_id,username,role,access_status,branch_id,can_upload_har&limit=1`),target=targetRows?.[0];
  if(!target)throw new Error('ไม่พบผู้ใช้');
  if(target.role==='admin'&&['disable','update'].includes(action))throw new Error('ไม่แก้สิทธิ์ Admin ผ่านหน้าจอนี้');
  if(action==='enable'||action==='disable'){
    if(targetId===actorId&&action==='disable')throw new Error('ปิดบัญชีตัวเองไม่ได้');
    const updated=await db(`app_profiles?user_id=eq.${encodeURIComponent(targetId)}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({access_status:action==='enable'?'active':'disabled',updated_at:new Date().toISOString()})});
    return publicProfile(updated?.[0]);
  }
  if(action==='update'){
    const access=parseBranchAccess(body);await validateBranches(access);
    const requestedDefault=Number(body?.defaultBranchId||body?.branchId||0),defaultBranch=access.some(a=>a.branch_id===requestedDefault)?requestedDefault:access[0].branch_id;
    const updated=await db(`app_profiles?user_id=eq.${encodeURIComponent(targetId)}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({branch_id:defaultBranch,can_upload_har:access.some(a=>a.can_upload_har),display_name:String(body?.displayName||target.username||'').trim(),updated_at:new Date().toISOString()})});
    await syncBranchAccess(targetId,access);
    return {...publicProfile(updated?.[0]),branch_access:access};
  }
  if(action==='reset_password'){
    const password=String(body?.password||'');
    if(password.length<6||password.length>128)throw new Error('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');
    await authAdminSetPassword(targetId,password);
    return publicProfile(target);
  }
  throw new Error('คำสั่งจัดการผู้ใช้ไม่ถูกต้อง');
}

export async function createBranch(body:any){
  const code=String(body?.code||'').trim().toUpperCase(),name=String(body?.name||'').trim(),ownHubName=String(body?.ownHubName||'').trim(),aliases=cleanAliases(body?.hubAliases);
  if(!/^[A-Z0-9_-]{2,20}$/.test(code))throw new Error('รหัสสาขาใช้ A-Z, 0-9, _ หรือ - จำนวน 2-20 ตัว');
  if(!name)throw new Error('กรุณากรอกชื่อสาขา');
  const exists=await db(`branches?code=ilike.${encodeURIComponent(code)}&select=id&limit=1`);
  if(exists?.length)throw new Error('รหัสสาขานี้มีอยู่แล้ว');
  const b=await db('branches',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({code,name,own_hub_name:ownHubName||null,hub_aliases:aliases,is_active:true})}),branch=b?.[0];
  await db('ms_connection',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({branch_id:branch.id,label:code,store_name:name,is_active:true})});
  return branch;
}

export async function changeBranch(body:any){
  const id=Number(body?.id||body?.branchId||0);if(!Number.isSafeInteger(id)||id<=0)throw new Error('ไม่พบ HUB/สาขา');
  const current=(await db(`branches?id=eq.${id}&select=id,code,name,own_hub_name,hub_aliases,is_active&limit=1`))?.[0];if(!current)throw new Error('ไม่พบ HUB/สาขา');
  const name=body?.name===undefined?current.name:String(body.name||'').trim();if(!name)throw new Error('ชื่อ HUB/สาขาห้ามว่าง');
  const ownHubName=body?.ownHubName===undefined?current.own_hub_name:String(body.ownHubName||'').trim()||null;
  const aliases=body?.hubAliases===undefined?(Array.isArray(current.hub_aliases)?current.hub_aliases:[]):cleanAliases(body.hubAliases);
  const isActive=body?.isActive===undefined?!!current.is_active:!!body.isActive;
  const updated=await db(`branches?id=eq.${id}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({name,own_hub_name:ownHubName,hub_aliases:aliases,is_active:isActive,updated_at:new Date().toISOString()})});
  return updated?.[0]||null;
}
