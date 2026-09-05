import {strict as assert} from 'node:assert';
import {collectSnapshot} from './supabase/functions/ms-parcel-api/scan.js';
import {band,route,validAnalytics,rowMatch,managerValue,bags,snapshotValid} from './data-model.js';
const rows=(from,n)=>Array.from({length:n},(_,i)=>({pno:String(from+i)}));
let calls=0;
let a=await collectSnapshot(async(p,size)=>{calls++;return {total:6000,rows:p===1?rows(0,5000):rows(5000,1000)}},5000);
assert.equal(a.complete,true);assert.equal(a.scanned,6000);assert.equal(calls,2);
calls=0;a=await collectSnapshot(async(p)=>{calls++;return {total:6000,rows:p===1?rows(0,5000):rows(4999,1000)}},5000);assert.equal(a.complete,false);assert.equal(a.reason,'duplicate_parcels');assert.equal(a.scanned,5999);assert.equal(calls,4);
calls=0;a=await collectSnapshot(async(p)=>{calls++;return {total:p===1?6000:5999,rows:p===1?rows(0,5000):rows(5000,1000)}},5000);assert.equal(a.complete,false);assert.equal(a.reason,'source_changed');
calls=0;a=await collectSnapshot(async(p)=>{calls++;return {total:72724,rows:rows((p-1)*5000,p===15?2724:4998)}},5000);assert.equal(a.complete,false);assert.equal(calls,30);assert.equal(a.pages,15);
calls=0;a=await collectSnapshot(async()=>{calls++;return {total:95000,rows:rows(0,100)}},5000);assert.equal(a.reason,'source_page_cap');assert.equal(calls,1);
a=await collectSnapshot(async()=>({total:200000,rows:rows(0,5000)}),5000);assert.equal(a.reason,'too_many_pages');assert.equal(a.requests,1);
a=await collectSnapshot(async()=>({total:0,rows:[]}),5000);assert.equal(a.complete,true);assert.equal(a.scanned,0);
calls=0;a=await collectSnapshot(async(p)=>{calls++;return {total:6000,rows:p===1?rows(0,5000):rows(5000,calls===2?900:1000)}},5000);assert.equal(a.complete,true);assert.equal(a.attempt,2);assert.equal(a.scanned,6000);

// Requested 10k is accepted by MS: 12k inventory needs only two source requests.
calls=0;a=await collectSnapshot(async(p,size)=>{calls++;assert.equal(size,10000);return {total:12000,rows:p===1?rows(0,10000):rows(10000,2000)}},10000);
assert.equal(a.complete,true);assert.equal(a.pages,2);assert.equal(a.sourcePageSize,10000);assert.equal(a.effectivePageSize,10000);assert.equal(a.requests,2);assert.equal(calls,2);
// Requested 10k but MS silently caps to 5k: scanner must adapt to 3 pages, never skip rows 10k-12k.
calls=0;a=await collectSnapshot(async(p,size)=>{calls++;assert.equal(size,10000);const lengths=[0,5000,5000,2000];return {total:12000,rows:rows((p-1)*5000,lengths[p]||0)}},10000);
assert.equal(a.complete,true);assert.equal(a.pages,3);assert.equal(a.sourcePageSize,5000);assert.equal(a.effectivePageSize,5000);assert.equal(a.scanned,12000);assert.equal(a.requests,3);assert.equal(calls,3);

const branch={code:'NE1',name:'NE1_HUB'};assert.deepEqual(route({dst_hub_name:'(123)NE1_HUB',dst_store_name:'(42)บุรีรัมย์'},branch),{r:'fd',d:'บุรีรัมย์'});assert.equal(route({dst_hub_name:'NE4_HUB'},branch).r,'lh');assert.equal(route({},branch).r,'other');
assert.equal(band('2026-09-06 00:00:00',Date.parse('2026-09-06T00:00:00+07:00')),'under3');assert.equal(band(null),'unknown');
const fullManager='(TH00000001)01 TEST_HUB-ทดสอบ · นาย ทดสอบ ระบบ · 0812345678';
assert.equal(managerValue({store_manager_display:fullManager,store_manager_phone:'0812345678'}),fullManager);
assert.equal(managerValue({store_manager_phone:'0812345678'}),'0812345678');
assert.equal(rowMatch({store_manager_display:fullManager,store_manager_phone:'0812345678',staff_info_phone:'099'},{manager:fullManager},branch,Date.now()),true);
assert.equal(rowMatch({store_manager_display:fullManager,store_manager_phone:'0812345678',staff_info_phone:'099'},{manager:'099'},branch,Date.now()),false);
assert.equal(rowMatch({store_manager_display:fullManager,store_manager_phone:'0812345678'},{q:'ทดสอบ ระบบ'},branch,Date.now()),true);
const grouped=bags([{pno:'1',pack_num:'bag',dst_hub_name:'NE1_HUB',dst_store_name:'A'},{pno:'2',pack_num:'bag',dst_hub_name:'NE4_HUB'}],branch,Date.now());assert.equal(grouped[0].mixed,true);
assert.equal(validAnalytics({complete:true,total:2,scanned:3,cells:[{c:3}]}),false);
const meta={complete:true,total:2,scanned:2,snapshotPages:1};const pages=[{cache_key:'b:1:snapshot:x:p:0001',source_total:2,item_count:2,payload:[['1'],['2']]}];assert.equal(snapshotValid(pages,meta),true);pages[0].payload[1]=['1'];assert.equal(snapshotValid(pages,meta),false);
console.log('PASS: bounded/adaptive scan, 10k accepted/capped paging, retry isolation, duplicate/missing/changed totals, 30 request ceiling, zero inventory, Thai time, FD/LH, full manager identity, mixed bags, snapshot identity/count');
