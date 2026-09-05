// One bounded scan budget, including a possible retry. Never walk 100-row pages.
export const MAX_PAGES = 30;
export async function collectSnapshot(fetchPage, pageSize = 10000) {
  let requests = 0;
  let result;
  for (let attempt = 1; attempt <= 2 && requests < MAX_PAGES; attempt++) {
    // FBI's own pager sends total=0 on page 1, then reuses the returned total
    // on every following page. Mirror that contract so the source can keep one
    // pagination boundary while the operational inventory continues changing.
    const first = await fetchPage(1, pageSize, 0); requests++;
    const total = Number(first.total);
    if (!Number.isSafeInteger(total) || total < 0) throw new Error('MS total ไม่ถูกต้อง');
    const observed = first.rows.length;
    if (total > 0 && observed === 0) {
      return { total, requestedPageSize: pageSize, sourcePageSize: 0, effectivePageSize: pageSize, pages: 1, maxPages: MAX_PAGES, attempt, complete:false, reason:'source_empty_page', scanned:0, requests, rowPages:[] };
    }

    // Page numbering in FBI is based on the requested page_size. A first page
    // can occasionally be short while later pages still contain page_size rows,
    // so never use only page-1 length as the offset/stride.
    const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
    const base = { total, requestedPageSize: pageSize, sourcePageSize: observed, effectivePageSize: pageSize, pages, maxPages: MAX_PAGES, attempt };
    if (total > observed && observed <= 100 && pageSize > 100) return {...base, complete:false, reason:'source_page_cap', scanned:observed, requests, rowPages:[]};
    if (pages - 1 > MAX_PAGES - requests) return {...base, complete:false, reason:'too_many_pages', scanned:observed, requests, rowPages:[]};

    const all = [first];
    // Fetch the remaining source pages concurrently. With the current NE1
    // inventory this keeps a full pass to roughly six source reads instead of
    // two sequential batches, reducing the mutation window without increasing
    // request count.
    if (pages > 1) {
      const nums = Array.from({length: pages - 1}, (_, i) => i + 2);
      requests += nums.length;
      all.push(...await Promise.all(nums.map(p => fetchPage(p, pageSize, total))));
    }

    const seen = new Set(); let duplicates = 0, missingIds = 0;
    const rowPages = all.map(page => page.rows.filter(row => {
      const id = String(row?.pno || '').trim();
      if (!id) { missingIds++; return false; }
      if (seen.has(id)) { duplicates++; return false; }
      seen.add(id); return true;
    }));
    const stableTotal = all.every(p => Number(p.total) === total);
    const nonFinalCounts = all.slice(0, Math.max(1, all.length - 1)).map(p => p.rows.length);
    const acceptedPageSize = nonFinalCounts.length ? Math.max(...nonFinalCounts) : observed;
    const complete = seen.size === total && !duplicates && !missingIds && stableTotal;
    result = {...base, effectivePageSize:acceptedPageSize || pageSize, acceptedPageSize:acceptedPageSize || 0, complete, scanned:seen.size, requests, duplicates, missingIds, stableTotal,
      pageCounts:all.map(p=>p.rows.length), sourceTotals:all.map(p=>Number(p.total)),
      reason:complete?null:!stableTotal?'source_changed':duplicates?'duplicate_parcels':missingIds?'missing_parcel_ids':'row_count_mismatch', rowPages};
    if (complete || requests + pages > MAX_PAGES) return result;
    // Discard attempt one entirely. Do not merge inventories from different times.
  }
  return result;
}
