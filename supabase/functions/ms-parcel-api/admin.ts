import { authAdminCreateUser, authAdminDeleteUser, authAdminSetPassword, db, normalizeUsername, publicProfile, validUsername } from './core.ts';

export async function listUsers(){
  return await db('app_profiles?select=user_id,username,display_name,role,access_status,branch_id,can_upload_har,created_at,updated_at&order=created_at.asc')||[];
}

export async function createManagedUser(body:any){
  const username=normalizeUsername(body?.username),password=String(body?.password||''),displayName=String(body?.displayName||'').trim(),branchId=Number(body?.branchId||0),canUploadHar=!!body?.canUploadHar;
  if(!validUsername(username))throw new Error('Username ใช้ a-z, 0-9, จุด, ขีด และ _ จำนวน 3-32 ตัว');
  if(password.length<6||password.length>128)throw new Error('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');
  const existing=await db(`app_profiles?username=ilike.${encodeURIComponent(username)}&select=user_id&limit=1`);
  if(existing?.length)throw new Error('Username นี้ถูกใช้แล้ว');
  const branch=await db(`branches?id=eq.${branchId}&is_active=eq.true&select=id&limit=1`);
  if(!branch?.[0])throw new Error('กรุณาเลือกสาขาที่เปิดใช้งาน');
  const internalEmail=`${username}.${crypto.randomUUID().replaceAll('-','')}@ms-parcel.invalid`;
  const authUser=await authAdminCreateUser(internalEmail,password,username,displayName);
  try{
    const created=await db('app_profiles',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({user_id:authUser.id,username,display_name:displayName||username,email:internalEmail,role:'viewer',access_status:'active',branch_id:branchId,can_upload_har:canUploadHar})});
    return publicProfile(created?.[0]);
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
    const branchId=Number(body?.branchId||0),branch=await db(`branches?id=eq.${branchId}&is_active=eq.true&select=id&limit=1`);
    if(!branch?.[0])throw new Error('สาขาไม่ถูกต้อง');
    const updated=await db(`app_profiles?user_id=eq.${encodeURIComponent(targetId)}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({branch_id:branchId,can_upload_har:!!body?.canUploadHar,display_name:String(body?.displayName||target.username||'').trim(),updated_at:new Date().toISOString()})});
    return publicProfile(updated?.[0]);
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
  const code=String(body?.code||'').trim().toUpperCase(),name=String(body?.name||'').trim();
  if(!/^[A-Z0-9_-]{2,20}$/.test(code))throw new Error('รหัสสาขาใช้ A-Z, 0-9, _ หรือ - จำนวน 2-20 ตัว');
  if(!name)throw new Error('กรุณากรอกชื่อสาขา');
  const exists=await db(`branches?code=ilike.${encodeURIComponent(code)}&select=id&limit=1`);
  if(exists?.length)throw new Error('รหัสสาขานี้มีอยู่แล้ว');
  const b=await db('branches',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({code,name,is_active:true})}),branch=b?.[0];
  await db('ms_connection',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({branch_id:branch.id,label:code,store_name:name,is_active:true})});
  return branch;
}
