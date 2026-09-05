// One bounded scan budget, including a possible retry. Never walk 100-row pages.
export const MAX_PAGES = 30;
export async function collectSnapshot(fetchPage, pageSize = 10000) {
  let requests = 0;
  let result;
  for (let attempt = 1; attempt <= 2 && requests < MAX_PAGES; attempt++) {
    const first = await fetchPage(1, pageSize); requests++;
    const total = Number(first.total);
    if (!Number.isSafeInteger(total) || total < 0) throw new Error('MS total ไม่ถูกต้อง');
    const observed = first.rows.length;
    if (total > 0 && observed === 0) {
      return { total, requestedPageSize: pageSize, sourcePageSize: 0, pages: 1, maxPages: MAX_PAGES, attempt, complete:false, reason:'source_empty_page', scanned:0, requests, rowPages:[] };
    }
    // MS may cap page_size below what we request. Use the first full-page observation
    // for page count so a silent source cap cannot make us skip half of the inventory.
    const effectivePageSize = total > observed ? observed : Math.max(1, pageSize);
    const pages = Math.max(1, Math.ceil(total / effectivePageSize));
    const base = { total, requestedPageSize: pageSize, sourcePageSize: observed, effectivePageSize, pages, maxPages: MAX_PAGES, attempt };
    if (total > observed && observed <= 100 && pageSize > 100) return {...base, complete:false, reason:'source_page_cap', scanned:observed, requests, rowPages:[]};
    if (pages - 1 > MAX_PAGES - requests) return {...base, complete:false, reason:'too_many_pages', scanned:observed, requests, rowPages:[]};
    const all = [first];
    for (let start = 2; start <= pages; start += 3) {
      const nums = [start,start+1,start+2].filter(p => p <= pages);
      requests += nums.length;
      all.push(...await Promise.all(nums.map(p => fetchPage(p, pageSize))));
    }
    const seen = new Set(); let duplicates = 0, missingIds = 0;
    const rowPages = all.map(page => page.rows.filter(row => {
      const id = String(row?.pno || '').trim();
      if (!id) { missingIds++; return false; }
      if (seen.has(id)) { duplicates++; return false; }
      seen.add(id); return true;
    }));
    const stableTotal = all.every(p => Number(p.total) === total);
    const complete = seen.size === total && !duplicates && !missingIds && stableTotal;
    result = {...base, complete, scanned:seen.size, requests, duplicates, missingIds, stableTotal,
      pageCounts:all.map(p=>p.rows.length), sourceTotals:all.map(p=>Number(p.total)),
      reason:complete?null:!stableTotal?'source_changed':duplicates?'duplicate_parcels':missingIds?'missing_parcel_ids':'row_count_mismatch', rowPages};
    if (complete || requests + pages > MAX_PAGES) return result;
    // Discard attempt one entirely. Do not merge inventories from different times.
  }
  return result;
}
