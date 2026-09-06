import {strict as assert} from 'node:assert';
import {collectSnapshot} from './supabase/functions/ms-parcel-api/scan.js';
import {band,route,validAnalytics,rowMatch,rowCell,managerValue,bags,snapshotValid,decodeSnapshotRow} from './data-model.js';
const rows=(from,n)=>Array.from({length:n},(_,i)=>({pno:String(from+i)}));
let calls=0;
let hints=[];
let a=await collectSnapshot(async(p,size,totalHint)=>{calls++;hints.push(totalHint);return {total:6000,rows:p===1?rows(0,5000):rows(5000,1000)}},5000);
assert.equal(a.complete,true);assert.equal(a.scanned,6000);assert.equal(calls,3);assert.deepEqual(hints,[0,6000,6000]);

calls=0;a=await collectSnapshot(async(p)=>{calls++;return {total:6000,rows:p===1?rows(0,5000):rows(4999,1000)}},5000);
assert.equal(a.complete,false);assert.equal(a.reason,'duplicate_parcels');assert.equal(a.scanned,5999);assert.equal(calls,6);

calls=0;a=await collectSnapshot(async(p)=>{calls++;return {total:p===1?6000:5999,rows:p===1?rows(0,5000):rows(5000,1000)}},5000);
assert.equal(a.complete,false);assert.equal(a.reason,'source_changed');assert.equal(calls,6);

calls=0;a=await collectSnapshot(async(p)=>{calls++;return {total:72724,rows:rows((p-1)*5000,p===15?2724:4998)}},5000);
assert.equal(a.complete,false);assert.equal(calls,16);assert.equal(a.pages,15);assert.ok(a.requests<=30);

calls=0;a=await collectSnapshot(async()=>{calls++;return {total:95000,rows:rows(0,100)}},5000);
assert.equal(a.reason,'source_page_cap');assert.equal(calls,1);

a=await collectSnapshot(async()=>({total:200000,rows:rows(0,5000)}),5000);
assert.equal(a.reason,'too_many_pages');assert.equal(a.requests,1);

a=await collectSnapshot(async()=>({total:0,rows:[]}),5000);
assert.equal(a.complete,true);assert.equal(a.scanned,0);assert.equal(a.requests,2);

let probeCount=0;calls=0;
a=await collectSnapshot(async(p,size,totalHint)=>{calls++;if(totalHint===0)probeCount++;const n=p===1?5000:(probeCount===1?900:1000);return {total:6000,rows:p===1?rows(0,n):rows(5000,n)}},5000);
assert.equal(a.complete,true);assert.equal(a.attempt,2);assert.equal(a.scanned,6000);assert.equal(calls,6);

// Requested 10k is accepted by MS. Probe + the real anchored pass = 3 reads.
calls=0;hints=[];a=await collectSnapshot(async(p,size,totalHint)=>{calls++;hints.push(totalHint);assert.equal(size,10000);return {total:12000,rows:p===1?rows(0,10000):rows(10000,2000)}},10000);
assert.equal(a.complete,true);assert.equal(a.pages,2);assert.equal(a.sourcePageSize,10000);assert.equal(a.effectivePageSize,10000);assert.equal(a.acceptedPageSize,10000);assert.equal(a.requests,3);assert.equal(calls,3);assert.deepEqual(hints,[0,12000,12000]);

// Requested 10k but MS materially caps to 5k: probe identifies the cap and
// the anchored pass retrieves all three source pages with one shared hint.
calls=0;hints=[];a=await collectSnapshot(async(p,size,totalHint)=>{calls++;hints.push(totalHint);assert.equal(size,10000);const lengths=[0,5000,5000,2000];return {total:12000,rows:rows((p-1)*5000,lengths[p]||0)}},10000);
assert.equal(a.complete,true);assert.equal(a.pages,3);assert.equal(a.sourcePageSize,5000);assert.equal(a.effectivePageSize,5000);assert.equal(a.scanned,12000);assert.equal(a.requests,4);assert.equal(calls,4);assert.deepEqual(hints,[0,12000,12000,12000]);

// Production pattern: the unanchored probe can be short by two rows. Those
// probe rows are discarded; an anchored page 1 can still return the complete
// 10k boundary and therefore produce an exact snapshot.
calls=0;a=await collectSnapshot(async(p,size,totalHint)=>{calls++;if(totalHint===0)return {total:12045,rows:rows(0,9998)};return {total:12000,rows:p===1?rows(0,10000):rows(10000,2000)}},10000);
assert.equal(a.complete,true);assert.equal(a.probeTotal,12045);assert.equal(a.total,12000);assert.equal(a.scanned,12000);assert.equal(a.sourcePageSize,10000);assert.equal(a.stableTotal,true);assert.equal(calls,3);

// Production boundary-gap pattern: page 1 is truly short by two while page 2
// still starts at the requested 10k offset. One overlapping page-2 request at
// size=9998 must recover only real IDs 9998/9999; no rows are fabricated.
calls=0;a=await collectSnapshot(async(p,size,totalHint)=>{
  calls++;
  if(p===1)return {total:12000,rows:rows(0,9998)};
  if(size===9998)return {total:12000,rows:rows(9998,2002)};
  return {total:12000,rows:rows(10000,2000)};
},10000);
assert.equal(a.complete,true);assert.equal(a.scanned,12000);assert.equal(a.reason,null);assert.equal(a.requests,4);assert.equal(calls,4);assert.equal(a.boundaryRepair.shortBy,2);assert.equal(a.boundaryRepair.recovered,2);assert.equal(a.boundaryRepair.pageSize,9998);

// If the overlap request cannot reveal the missing IDs, keep the inventory
// incomplete and stop instead of repeating the same expensive stable mismatch.
calls=0;a=await collectSnapshot(async(p,size,totalHint)=>{calls++;return {total:12000,rows:p===1?rows(0,9998):rows(10000,2000)}},10000);
assert.equal(a.complete,false);assert.equal(a.reason,'row_count_mismatch');assert.equal(a.scanned,11998);assert.equal(a.requests,4);assert.equal(calls,4);assert.equal(a.boundaryRepair.recovered,0);

// A changing probe total is harmless when the entire concurrent anchored pass
// agrees on one newer total and contains exactly that many unique parcels.
hints=[];a=await collectSnapshot(async(p,size,totalHint)=>{hints.push(totalHint);if(totalHint===0)return {total:12050,rows:rows(0,9998)};return {total:12000,rows:p===1?rows(0,10000):rows(10000,2000)}},10000);
assert.equal(a.complete,true);assert.equal(a.probeTotal,12050);assert.equal(a.total,12000);assert.equal(a.stableTotal,true);assert.deepEqual(hints,[0,12050,12050]);

const branch={code:'NE1',name:'NE1_HUB'};assert.deepEqual(route({dst_hub_name:'(123)NE1_HUB',dst_store_name:'(42)บุรีรัมย์'},branch),{r:'fd',d:'บุรีรัมย์'});assert.equal(route({dst_hub_name:'NE4_HUB'},branch).r,'lh');assert.equal(route({},branch).r,'other');
assert.equal(band('2026-09-06 00:00:00',Date.parse('2026-09-06T00:00:00+07:00')),'under3');assert.equal(band(null),'unknown');
const fullManager='(TH00000001)01 TEST_HUB-ทดสอบ\nนาย ทดสอบ ระบบ\n0812345678';
const decodedManager=decodeSnapshotRow(['PX','คงคลัง',1000,'','','','','','099',fullManager,'TH00000001','01 TEST_HUB-ทดสอบ','นาย ทดสอบ ระบบ','0812345678','NE1_HUB','ปลายทาง']);
assert.equal(decodedManager.store_id,'TH00000001');assert.equal(decodedManager.store_name,'01 TEST_HUB-ทดสอบ');assert.equal(decodedManager.store_manager_name,'นาย ทดสอบ ระบบ');assert.equal(decodedManager.store_manager_phone,'0812345678');assert.equal(managerValue(decodedManager),fullManager);
assert.equal(managerValue({store_manager_display:fullManager,store_manager_phone:'0812345678'}),fullManager);
assert.equal(managerValue({store_manager_phone:'0812345678'}),'()\n0812345678');
assert.equal(managerValue({store_id:'TH00000001',store_name:'01 TEST_HUB-A',store_manager_name:'นาย ทดสอบ',store_manager_phone:'0812345678'}),'(TH00000001)01 TEST_HUB-A\nนาย ทดสอบ\n0812345678');assert.equal(managerValue({store_id:'1'}),'(1)');assert.equal(managerValue({store_id:''}),'()');
assert.equal(rowCell({real_arrive_time:'2026-09-01 00:00:00',LastActionTime:'2026-09-06 00:00:00'},branch,Date.parse('2026-09-06T01:00:00+07:00')).b,'under3');
assert.equal(rowMatch({store_manager_display:fullManager,store_manager_phone:'0812345678',staff_info_phone:'099'},{manager:fullManager},branch,Date.now()),true);assert.equal(rowMatch({store_manager_display:fullManager,store_manager_phone:'0812345678'},{manager:new Set([fullManager,'(1)'])},branch,Date.now()),true);
assert.equal(rowMatch({store_manager_display:fullManager,store_manager_phone:'0812345678',staff_info_phone:'099'},{manager:'099'},branch,Date.now()),false);
assert.equal(rowMatch({store_manager_display:fullManager,store_manager_phone:'0812345678'},{q:'ทดสอบ ระบบ'},branch,Date.now()),true);
const grouped=bags([{pno:'1',pack_num:'bag',dst_hub_name:'NE1_HUB',dst_store_name:'A'},{pno:'2',pack_num:'bag',dst_hub_name:'NE4_HUB'}],branch,Date.now());assert.equal(grouped[0].mixed,true);
assert.equal(validAnalytics({complete:true,total:2,scanned:3,cells:[{c:3}]}),false);
const meta={complete:true,total:2,scanned:2,snapshotPages:1};const pages=[{cache_key:'b:1:snapshot:x:p:0001',source_total:2,item_count:2,payload:[['1'],['2']]}];assert.equal(snapshotValid(pages,meta),true);pages[0].payload[1]=['1'];assert.equal(snapshotValid(pages,meta),false);
console.log('PASS: anchored concurrent scan, exact boundary-gap recovery with real IDs only, bounded retries, duplicate/missing/changed totals, 30 request ceiling, zero inventory, Thai time, FD/LH, exact manager/store column, mixed bags, snapshot identity/count');
