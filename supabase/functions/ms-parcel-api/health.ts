import { db } from './core.ts';

export async function systemHealth(){
  const raw=await db('rpc/system_quota_health',{method:'POST',headers:{Prefer:'return=representation'},body:'{}'});
  const data=Array.isArray(raw)?raw[0]:raw;
  const databaseBytes=Number(data?.databaseBytes||0),budgetBytes=Number(data?.targetFreeBudgetBytes||0),ratio=budgetBytes>0?databaseBytes/budgetBytes:0;
  const quotaStatus=ratio>=0.9?'ใกล้โควต้า':ratio>=0.75?'ควรลด':ratio>=0.55?'เริ่มสูง':'ปกติ';
  return{...data,databaseBytes,budgetBytes,ratio:Math.round(ratio*10000)/100,quotaStatus,build:'control-room-20260906'};
}
