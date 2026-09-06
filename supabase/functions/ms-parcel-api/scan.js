// One bounded scan budget, including a possible retry. Never walk 100-row pages.
export const MAX_PAGES = 30;

function rowId(row) { return String(row?.pno || '').trim(); }

export async function collectSnapshot(fetchPage, pageSize = 10000) {
  let requests = 0;
  let result;
  for (let attempt = 1; attempt <= 2 && requests < MAX_PAGES; attempt++) {
    // Probe only discovers the current total/page shape. Do not include probe
    // rows in the snapshot: live inventory can mutate between this request and
    // the full pass.
    const probe = await fetchPage(1, pageSize, 0); requests++;
    const probeTotal = Number(probe.total);
    if (!Number.isSafeInteger(probeTotal) || probeTotal < 0) throw new Error('MS total ไม่ถูกต้อง');
    const probeObserved = probe.rows.length;
    if (probeTotal > 0 && probeObserved === 0) {
      return { total:probeTotal, probeTotal, requestedPageSize:pageSize, sourcePageSize:0, effectivePageSize:pageSize, pages:1, maxPages:MAX_PAGES, attempt, complete:false, reason:'source_empty_page', scanned:0, requests, rowPages:[] };
    }
    if (probeTotal > probeObserved && probeObserved <= 100 && pageSize > 100) {
      return { total:probeTotal, probeTotal, requestedPageSize:pageSize, sourcePageSize:probeObserved, effectivePageSize:probeObserved, pages:Math.max(1,Math.ceil(probeTotal/Math.max(1,probeObserved))), maxPages:MAX_PAGES, attempt, complete:false, reason:'source_page_cap', scanned:probeObserved, requests, rowPages:[] };
    }

    const probeCapped = probeTotal > probeObserved && pageSize > 100 && probeObserved > 100 && probeObserved < pageSize * 0.9;
    const probeStride = probeCapped ? probeObserved : Math.max(1, pageSize);
    const probePages = Math.max(1, Math.ceil(probeTotal / probeStride));
    if (probePages > MAX_PAGES - requests) {
      return { total:probeTotal, probeTotal, requestedPageSize:pageSize, sourcePageSize:probeObserved, effectivePageSize:probeStride, pages:probePages, maxPages:MAX_PAGES, attempt, complete:false, reason:'too_many_pages', scanned:probeObserved, requests, rowPages:[] };
    }

    // Start the real snapshot from page 1 again and issue the entire pass in
    // parallel with one shared total hint. This removes the stale probe page
    // from the dataset and keeps the mutation window as short as possible.
    const nums = Array.from({length:probePages}, (_, i) => i + 1);
    requests += nums.length;
    const all = await Promise.all(nums.map(p => fetchPage(p, pageSize, probeTotal)));

    const total = Number(all[0]?.total);
    if (!Number.isSafeInteger(total) || total < 0) throw new Error('MS total ไม่ถูกต้อง');
    const observed = all[0]?.rows?.length ?? 0;
    const materiallyCapped = total > observed && pageSize > 100 && observed > 100 && observed < pageSize * 0.9;
    const stride = materiallyCapped ? observed : Math.max(1, pageSize);
    const pages = Math.max(1, Math.ceil(total / stride));
    const pageShapeStable = pages === all.length;

    const seen = new Set(); let duplicates = 0, missingIds = 0;
    const rowPages = all.map(page => page.rows.filter(row => {
      const id = rowId(row);
      if (!id) { missingIds++; return false; }
      if (seen.has(id)) { duplicates++; return false; }
      seen.add(id); return true;
    }));
    const sourceTotals = all.map(p=>Number(p.total));
    let stableTotal = sourceTotals.every(t => t === total);
    const nonFinalCounts = all.slice(0, Math.max(1, all.length - 1)).map(p => p.rows.length);
    const acceptedPageSize = nonFinalCounts.length ? Math.max(...nonFinalCounts) : observed;

    // Production source occasionally reports a stable total while page 1 is a
    // few rows shorter than the requested page size and later pages still use
    // the requested offset. That leaves a real boundary gap (for example 9,998
    // then page 2 starts at 10,000). Recover the gap with one overlapping read
    // whose page-2 offset starts exactly at the observed page-1 length. Only
    // source rows with real parcel IDs are added; nothing is synthesized.
    let boundaryRepair = null;
    const shortBy = pageSize - observed;
    const laterFull = all.length > 1 && all.slice(1, -1).every(p => p.rows.length === pageSize);
    const repairCandidate = stableTotal && pageShapeStable && duplicates === 0 && missingIds === 0 &&
      seen.size < total && observed > 100 && shortBy > 0 && shortBy <= 100 && laterFull && requests < MAX_PAGES;
    if (repairCandidate) {
      const repairPageSize = observed;
      const repair = await fetchPage(2, repairPageSize, total); requests++;
      const repairTotal = Number(repair.total);
      sourceTotals.push(repairTotal);
      stableTotal = stableTotal && repairTotal === total;
      let recovered = 0, repairMissingIds = 0, repairOverlap = 0;
      const recoveredRows = [];
      if (stableTotal) {
        for (const row of repair.rows) {
          const id = rowId(row);
          if (!id) { repairMissingIds++; continue; }
          if (seen.has(id)) { repairOverlap++; continue; }
          seen.add(id); recoveredRows.push(row); recovered++;
        }
      }
      if (recoveredRows.length) rowPages.push(recoveredRows);
      missingIds += repairMissingIds;
      boundaryRepair = { page:2, pageSize:repairPageSize, shortBy, recovered, overlap:repairOverlap, total:repairTotal };
    }

    const complete = pageShapeStable && seen.size === total && !duplicates && !missingIds && stableTotal;
    const reason = complete ? null : !stableTotal ? 'source_changed' : !pageShapeStable ? 'page_shape_changed' : duplicates ? 'duplicate_parcels' : missingIds ? 'missing_parcel_ids' : 'row_count_mismatch';
    result = {
      total,probeTotal,requestedPageSize:pageSize,sourcePageSize:observed,effectivePageSize:stride,acceptedPageSize:acceptedPageSize||0,
      pages,maxPages:MAX_PAGES,attempt,complete,scanned:seen.size,requests,duplicates,missingIds,stableTotal,pageShapeStable,
      pageCounts:all.map(p=>p.rows.length),sourceTotals,boundaryRepair,reason,rowPages
    };
    if (complete) return result;

    // If a stable boundary-gap repair ran and still could not reveal real IDs,
    // repeating the identical pass only burns source quota. Other unstable
    // shapes still get one isolated retry within the same hard request budget.
    if (reason === 'row_count_mismatch' && boundaryRepair) return result;
    const retryPages = Math.max(1, Math.ceil(total / Math.max(1, stride)));
    if (requests + 1 + retryPages > MAX_PAGES) return result;
  }
  return result;
}
