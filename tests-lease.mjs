import {strict as assert} from 'node:assert';
import {claimAnalyticsLease} from './supabase/functions/ms-parcel-api/refresh-lease.js';

// Model PostgREST conditional writes as atomic operations, with asynchronous
// callers interleaved. Production database verification remains a separate gate.
const records = new Map();
async function db(path, init) {
  await new Promise(resolve => setImmediate(resolve));
  const params = new URL('https://test.invalid/' + path).searchParams;
  const body = JSON.parse(init.body);
  if(init.method === 'POST') {
    if(records.has(body.cache_key)) return [];
    records.set(body.cache_key, body); return [body];
  }
  const key = params.get('cache_key').slice(3), row = records.get(key);
  if(!row || row.branch_id !== Number(params.get('branch_id').slice(3))) return [];
  const expiry = params.get('lease_until');
  if(expiry.startsWith('lte.') && row.lease_until > expiry.slice(4)) return [];
  if(expiry.startsWith('eq.') && row.lease_until !== expiry.slice(3)) return [];
  if(params.has('owner_user_id') && row.owner_user_id !== params.get('owner_user_id').slice(3)) return [];
  const next = {...row,...body}; records.set(key,next); return [next];
}
const at = Date.parse('2026-09-06T12:00:00Z');
const results = await Promise.all([1,2].flatMap(branch => Array.from({length:20}, (_,i) =>
  claimAnalyticsLease(db,branch,`user-${i}`,at).then(release=>({branch,release})))));
for(const branch of [1,2]) assert.equal(results.filter(r=>r.branch===branch && r.release).length,1);
assert.equal(records.size,2);
assert.equal(await claimAnalyticsLease(db,1,'late-user',at+299999),null);
const successor = await claimAnalyticsLease(db,1,'successor',at+300001);
assert.equal(typeof successor,'function');
await results.find(r=>r.branch===1 && r.release).release();
assert.equal(records.get('b:1:engine:full-analytics').owner_user_id,'successor');
assert.ok(Date.parse(records.get('b:1:engine:full-analytics').lease_until)>at+300001);
await successor();
assert.equal(typeof await claimAnalyticsLease(db,1,'next',at+300002),'function');
assert.equal(await claimAnalyticsLease(db,2,'outsider',at+1),null);
await assert.rejects(()=>claimAnalyticsLease(db,0,'user',at));
await assert.rejects(()=>claimAnalyticsLease(async()=>{throw new Error('database unavailable')},3,'user',at),/database unavailable/);
console.log('PASS simulated atomic lease: 40 clients / 2 branches = 2 leaders, 300s crash expiry, late release fenced, branch keys isolated, DB failure stops scan');
