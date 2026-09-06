import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { asBranchId, authenticate, authPasswordLogin, cors, db, encryptCredential, ensureProfile, errMessage, hashPage, hashSummary, json, normalizeUsername, publicProfile, validUsername } from './core.ts';
import { changeBranch, createBranch, changeUser, createManagedUser, listUsers } from './admin.ts';
import { buildFullAnalytics } from './analytics.ts';
import { claimAnalyticsLease } from './refresh-lease.js';
import { changeShift, listShifts } from './shifts.ts';
import { diffRows, fetchLivePage, fetchSummary, getConnection, listAccessibleBranches, listBranches, liveResponseFromCache, oldHashForCache, pickHarRequest, resolveBranch, updateConnectionHealth } from './ms.ts';

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  const u=new URL(req.url),route=u.pathname.split('/').filter(Boolean).pop()||'';
  try{
    if(req.method==='POST'&&route==='login'){
      let body:any={};try{body=await req.json();}catch{}
      const username=normalizeUsername(body?.username),password=String(body?.password||'');
      if(!validUsername(username)||!password)return json({ok:false,message:'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'},401);
      const rows=await db(`app_profiles?username=ilike.${encodeURIComponent(username)}&select=email,access_status&limit=1`),p=rows?.[0];
      if(!p?.email)return json({ok:false,message:'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'},401);
      let session;try{session=await authPasswordLogin(String(p.email),password);}catch{return json({ok:false,message:'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'},401);}
      if(p.access_status==='disabled')return json({ok:false,message:'บัญชีนี้ถูกระงับการใช้งาน'},403);
      return json({ok:true,data:{session}});
    }

    const authUser=await authenticate(req);
    if(!authUser)return json({ok:false,message:'Unauthorized'},401);
    const profile=await ensureProfile(authUser.id,authUser.email);
    if(!profile)return json({ok:false,message:'ไม่พบโปรไฟล์ผู้ใช้'},403);

    if(route==='users'){
      if(profile.role!=='admin'||profile.access_status!=='active')return json({ok:false,message:'Admin only'},403);
      if(req.method==='GET')return json({ok:true,data:{users:await listUsers(),branches:await listBranches(true)}});
      if(req.method==='POST'){
        let body:any={};try{body=await req.json();}catch{}
        if(String(body?.action||'')==='create')return json({ok:true,data:{user:await createManagedUser(body)}});
        return json({ok:true,data:{user:await changeUser(authUser.id,body)}});
      }
    }

    if(route==='branches'){
      if(profile.role!=='admin'||profile.access_status!=='active')return json({ok:false,message:'Admin only'},403);
      if(req.method==='GET')return json({ok:true,data:{branches:await listBranches(false)}});
      if(req.method==='POST'){
        let body:any={};try{body=await req.json();}catch{}
        const action=String(body?.action||'');
        if(action==='create')return json({ok:true,data:{branch:await createBranch(body)}});
        if(action==='update')return json({ok:true,data:{branch:await changeBranch(body)}});
        return json({ok:false,message:'คำสั่งสาขาไม่ถูกต้อง'},400);
      }
    }

    if(req.method==='GET'&&route==='status'){
      const requested=asBranchId(u.searchParams.get('branch_id'));
      const branches=await listAccessibleBranches(profile,true);
      let branch:any=null;try{branch=await resolveBranch(profile,requested);}catch{}
      const conn=branch?(await db(`ms_connection?branch_id=eq.${branch.id}&select=branch_id,label,store_id,store_name,credential_updated_at,last_ok_at,last_error&limit=1`))?.[0]||null:null;
      return json({ok:true,data:{profile:publicProfile(profile),branch,branches,connection:conn}});
    }

    if(profile.access_status!=='active')return json({ok:false,message:profile.access_status==='disabled'?'บัญชีนี้ถูกระงับการใช้งาน':'บัญชีนี้ยังไม่เปิดใช้งาน'},403);
    const requestedBranch=asBranchId(u.searchParams.get('branch_id')),branch=await resolveBranch(profile,requestedBranch),branchId=Number(branch.id);

    if(route==='shifts'){
      if(req.method==='GET')return json({ok:true,data:{branchId,canManage:profile.role==='admin'||branch.can_manage_shift!==false,shifts:await listShifts(branchId)}});
      if(req.method==='POST'){
        if(profile.role!=='admin'&&branch.can_manage_shift===false)return json({ok:false,message:'ไม่มีสิทธิ์แก้กะของ HUB/สาขานี้'},403);
        let body:any={};try{body=await req.json();}catch{}
        return json({ok:true,data:{shift:await changeShift(authUser.id,branchId,body)}});
      }
      return json({ok:false,message:'Method not allowed'},405);
    }

    if(req.method==='POST'&&route==='har'){
      const allowed=profile.role==='admin'||branch.can_upload_har===true;
      if(!allowed)return json({ok:false,message:'ไม่มีสิทธิ์อัปโหลด HAR ของสาขานี้'},403);
      const text=await req.text();if(text.length>25_000_000)return json({ok:false,message:'HAR ใหญ่เกิน 25 MB'},413);
      let har:any;try{har=JSON.parse(text);}catch{return json({ok:false,message:'ไฟล์ HAR ไม่ใช่ JSON ที่ถูกต้อง'},400);}
      const found=pickHarRequest(har),encrypted=await encryptCredential(found.credential),existing=await db(`ms_connection?branch_id=eq.${branchId}&select=id&limit=1`);
      const patch={branch_id:branchId,label:branch.code,store_id:found.queryTemplate.store_id||null,store_name:branch.name,fbi_base_url:found.baseUrl,endpoint_path:found.path,query_template:found.queryTemplate,credential_ciphertext:encrypted,credential_updated_at:new Date().toISOString(),last_error:null,is_active:true,updated_at:new Date().toISOString()};
      if(existing?.[0])await db(`ms_connection?id=eq.${existing[0].id}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(patch)});
      else await db('ms_connection',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(patch)});
      await db(`branches?id=eq.${branchId}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({store_id:found.queryTemplate.store_id||null,updated_at:new Date().toISOString()})});
      await db(`live_cache_pages?branch_id=eq.${branchId}`,{method:'DELETE'});
      await db(`summary_cache?branch_id=eq.${branchId}`,{method:'DELETE'});
      await db(`cache_refresh_leases?branch_id=eq.${branchId}`,{method:'DELETE'});
      return json({ok:true,data:{branchId,storeId:found.queryTemplate.store_id}});
    }

    if(req.method==='GET'&&route==='summary'){
      const cacheKey=`b:${branchId}:summary:transfer-summary`,cached=await db(`summary_cache?cache_key=eq.${encodeURIComponent(cacheKey)}&select=*&limit=1`),c=cached?.[0];
      if(c&&new Date(c.expires_at).getTime()>Date.now())return json({ok:true,data:c.payload,meta:{cache:'hit',expiresAt:c.expires_at,ttlMs:Math.max(0,new Date(c.expires_at).getTime()-Date.now()),branchId}});
      const conn=await getConnection(branchId);
      try{
        const summary=await fetchSummary(conn),sourceAt=new Date().toISOString(),hash=await hashSummary(summary),expiresAt=new Date(Date.now()+60_000).toISOString(),payload={...summary,sourceAt,branchId};
        if(c?.content_hash===hash)await db(`summary_cache?cache_key=eq.${encodeURIComponent(cacheKey)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({source_updated_at:sourceAt,expires_at:expiresAt})});
        else await db('summary_cache?on_conflict=cache_key',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({cache_key:cacheKey,branch_id:branchId,payload,content_hash:hash,source_updated_at:sourceAt,expires_at:expiresAt})});
        await updateConnectionHealth(conn,true);
        return json({ok:true,data:payload,meta:{cache:'miss',ttlMs:60000,branchId}});
      }catch(e){const m=errMessage(e);await updateConnectionHealth(conn,false,m);if(c?.payload)return json({ok:true,data:c.payload,meta:{cache:'stale',stale:true,error:m,ttlMs:15000,branchId}});return json({ok:false,message:m},502);}
    }

    if(req.method==='GET'&&route==='analytics'){
      const cacheKey=`b:${branchId}:summary:full-analytics-v1`,cached=await db(`summary_cache?cache_key=eq.${encodeURIComponent(cacheKey)}&select=*&limit=1`),c=cached?.[0];
      if(c?.payload?.schemaVersion===10&&new Date(c.expires_at).getTime()>Date.now())return json({ok:true,data:c.payload,meta:{cache:'hit',expiresAt:c.expires_at,ttlMs:Math.max(0,new Date(c.expires_at).getTime()-Date.now()),branchId}});
      const release=await claimAnalyticsLease(db,branchId,authUser.id);
      if(!release){
        if(c?.payload)return json({ok:true,data:c.payload,meta:{cache:'coalesced',stale:true,refreshing:true,ttlMs:15000,branchId}});
        return json({ok:false,message:'กำลังรวบรวมข้อมูลของ HUB นี้ กรุณารอสักครู่',meta:{cache:'coalesced',refreshing:true,ttlMs:15000,branchId}},202);
      }
      try{
      const latest=(await db(`summary_cache?cache_key=eq.${encodeURIComponent(cacheKey)}&select=*&limit=1`))?.[0];
      if(latest?.payload?.schemaVersion===10&&new Date(latest.expires_at).getTime()>Date.now())return json({ok:true,data:latest.payload,meta:{cache:'hit-after-lease',ttlMs:Math.max(0,new Date(latest.expires_at).getTime()-Date.now()),branchId}});
      const conn=await getConnection(branchId);
      try{
        const analytics=await buildFullAnalytics(conn,branch,10000),sourceAt=new Date().toISOString(),ttlMs=analytics.complete?30*60_000:5*60_000,expiresAt=new Date(Date.now()+ttlMs).toISOString(),payload={...analytics,sourceAt,branchId},hash=await hashSummary(payload);
        await db('summary_cache?on_conflict=cache_key',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({cache_key:cacheKey,branch_id:branchId,payload,content_hash:hash,source_updated_at:sourceAt,expires_at:expiresAt})});
        await updateConnectionHealth(conn,true);
        return json({ok:true,data:payload,meta:{cache:'miss',ttlMs,branchId}});
      }catch(e){
        const m=errMessage(e),backoffMs=5*60_000,expiresAt=new Date(Date.now()+backoffMs).toISOString();
        await updateConnectionHealth(conn,false,m);
        if(c?.payload){
          try{await db(`summary_cache?cache_key=eq.${encodeURIComponent(cacheKey)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({expires_at:expiresAt})});}catch{}
          return json({ok:true,data:c.payload,meta:{cache:'stale',stale:true,error:m,expiresAt,ttlMs:backoffMs,branchId}});
        }
        return json({ok:false,message:m},502);
      }
      }finally{try{await release();}catch{/* Crash-safe lease expires without deleting configuration. */}}
    }

    if(req.method==='GET'&&route==='live'){
      const page=Math.max(1,Math.min(100000,Number(u.searchParams.get('page')||1)||1)),requestedSize=Number(u.searchParams.get('page_size')||100),pageSize=[20,50,100].includes(requestedSize)?requestedSize:100,knownHash=String(u.searchParams.get('known_hash')||'').slice(0,128),cacheKey=`b:${branchId}:p:${page}:s:${pageSize}`,cached=await db(`live_cache_pages?cache_key=eq.${encodeURIComponent(cacheKey)}&select=*&limit=1`),c=cached?.[0];
      if(c?.content_hash&&new Date(c.expires_at).getTime()>Date.now())return liveResponseFromCache(c,knownHash,profile.role,'hit');
      const conn=await getConnection(branchId);
      try{
        const fresh=await fetchLivePage(conn,page,pageSize),now=new Date().toISOString(),oldRows=Array.isArray(c?.payload?.rows)?c.payload.rows:[],oldHash=await oldHashForCache(c),newHash=await hashPage(fresh.rows,fresh.total),changed=!c?.content_hash||oldHash!==newHash,streak=changed?0:Number(c?.unchanged_streak||0)+1,ttlMs=changed?8000:(streak>=5?30000:15000),expiresAt=new Date(Date.now()+ttlMs).toISOString();
        let delta:any=null;
        if(changed){delta=oldHash?diffRows(oldRows,fresh.rows):null;const payload={rows:fresh.rows,total:fresh.total,page,pageSize,changed:true,branchId};await db('live_cache_pages?on_conflict=cache_key',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({cache_key:cacheKey,branch_id:branchId,payload,item_count:fresh.rows.length,source_total:fresh.total,content_hash:newHash,previous_hash:oldHash||null,delta_payload:delta,unchanged_streak:0,source_updated_at:now,expires_at:expiresAt})});}
        else await db(`live_cache_pages?cache_key=eq.${encodeURIComponent(cacheKey)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({source_updated_at:now,expires_at:expiresAt,item_count:fresh.rows.length,source_total:fresh.total,unchanged_streak:streak})});
        if(page===1)await db(`live_cache_pages?branch_id=eq.${branchId}&expires_at=lt.${encodeURIComponent(new Date(Date.now()-60*60_000).toISOString())}`,{method:'DELETE'});
        await updateConnectionHealth(conn,true);
        const base={total:fresh.total,page,pageSize,sourceAt:now,hash:newHash,branchId};
        if(knownHash&&knownHash===newHash)return json({ok:true,data:{...base,notModified:true,changed:false},meta:{cache:'miss',ttlMs,branchId}});
        if(changed&&delta&&knownHash&&knownHash===oldHash)return json({ok:true,data:{...base,delta,changed:true},meta:{cache:'miss',ttlMs,branchId}});
        return json({ok:true,data:{...base,rows:fresh.rows,changed},meta:{cache:'miss',ttlMs,branchId}});
      }catch(e){const m=errMessage(e);await updateConnectionHealth(conn,false,m);if(c?.payload)return liveResponseFromCache(c,knownHash,profile.role,'stale',true,m);return json({ok:false,message:m},502);}
    }

    return json({ok:false,message:'Not found'},404);
  }catch(e){return json({ok:false,message:errMessage(e)},500);}
});
