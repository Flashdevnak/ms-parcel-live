import { fetchLivePage } from './ms.ts';

const DEFAULT_PAGE_SIZE = 5000;
const MAX_PAGES = 80;

function cleanName(value: unknown) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return raw.replace(/^\s*(?:(?:\([^)]*\)|（[^）]*）)\s*)+/, '').trim() || raw;
}

function normalize(value: unknown) {
  return cleanName(value).toUpperCase().replace(/^\d+\s*/, '').replace(/\s+/g, ' ').trim();
}

function ownHubMatcher(branch: any) {
  const code = String(branch?.code || '').trim().toUpperCase();
  const ownName = normalize(branch?.name || '');
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const codeRe = code ? new RegExp(`(^|[^A-Z0-9])${escaped}(?:_HUB)?([^A-Z0-9]|$)`, 'i') : null;
  return (value: unknown) => {
    const raw = cleanName(value);
    if (!raw) return false;
    if (ownName && normalize(raw) === ownName) return true;
    return !!codeRe?.test(raw.toUpperCase());
  };
}

function weightKg(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  // MS store_weight is grams in current payload.
  return n / 1000;
}

function addGroup(map: Map<string, any>, key: string, kg: number) {
  if (!key) return;
  const item = map.get(key) || { name: key, count: 0, weightKg: 0 };
  item.count += 1;
  item.weightKg += kg;
  map.set(key, item);
}

function addCount(map: Map<string, number>, key: string) {
  const name = key || '-';
  map.set(name, (map.get(name) || 0) + 1);
}

function sortedGroups(map: Map<string, any>) {
  return [...map.values()]
    .map((x) => ({ ...x, weightKg: Math.round(x.weightKg * 1000) / 1000, avgKg: x.count ? Math.round((x.weightKg / x.count) * 1000) / 1000 : 0 }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'th'));
}

function sortedCounts(map: Map<string, number>) {
  return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'th'));
}

export async function buildFullAnalytics(conn: any, branch: any, requestedPageSize = DEFAULT_PAGE_SIZE) {
  const pageSize = Math.max(500, Math.min(10000, Number(requestedPageSize) || DEFAULT_PAGE_SIZE));
  const first = await fetchLivePage(conn, 1, pageSize);
  const total = Number(first.total || 0);
  const observed = first.rows.length;

  // MS UI is known to show max 100, but probe the API itself. Never fall back to ~900 requests.
  if (total > observed && observed <= 100 && pageSize > 100) {
    return {
      complete: false,
      reason: 'source_page_cap',
      total,
      scanned: observed,
      sourcePageSize: observed,
      requestedPageSize: pageSize,
      updatedAt: new Date().toISOString(),
    };
  }

  const effectivePageSize = Math.max(1, observed || pageSize);
  const pages = Math.max(1, Math.ceil(total / effectivePageSize));
  if (pages > MAX_PAGES) {
    return {
      complete: false,
      reason: 'too_many_pages',
      total,
      scanned: observed,
      sourcePageSize: effectivePageSize,
      requestedPageSize: pageSize,
      pages,
      updatedAt: new Date().toISOString(),
    };
  }

  const isOwnHub = ownHubMatcher(branch);
  const fd = new Map<string, any>();
  const lh = new Map<string, any>();
  const actions = new Map<string, number>();
  const parcelStates = new Map<string, number>();
  const bags = new Set<string>();
  let scanned = 0;
  let totalWeightKg = 0;
  let baggedParcels = 0;

  const consume = (rows: any[]) => {
    for (const row of rows) {
      scanned += 1;
      const kg = weightKg(row?.store_weight);
      totalWeightKg += kg;
      addCount(actions, String(row?.LastAction_name || '-').trim() || '-');
      addCount(parcelStates, String(row?.state_name || '-').trim() || '-');
      const bag = String(row?.pack_num || '').trim();
      if (bag && bag !== '-' && bag !== '--') { baggedParcels += 1; bags.add(bag); }
      const hubRaw = row?.dst_hub_name;
      const hub = cleanName(hubRaw);
      const store = cleanName(row?.dst_store_name);
      if (isOwnHub(hubRaw)) {
        // FD means only destination branches under the currently selected source HUB.
        if (store) addGroup(fd, store, kg);
      } else {
        // LH means only remote destination HUB; never mix destination branches into this table.
        if (hub) addGroup(lh, hub, kg);
      }
    }
  };

  consume(first.rows);

  for (let start = 2; start <= pages; start += 3) {
    const nums = [start, start + 1, start + 2].filter((p) => p <= pages);
    const batch = await Promise.all(nums.map((p) => fetchLivePage(conn, p, pageSize)));
    for (const page of batch) consume(page.rows);
  }

  return {
    complete: scanned >= total,
    total,
    scanned,
    sourcePageSize: pageSize,
    pages,
    totalWeightKg: Math.round(totalWeightKg * 1000) / 1000,
    avgWeightKg: scanned ? Math.round((totalWeightKg / scanned) * 1000) / 1000 : 0,
    baggedParcels,
    uniqueBags: bags.size,
    fd: sortedGroups(fd),
    lh: sortedGroups(lh),
    actions: sortedCounts(actions),
    parcelStates: sortedCounts(parcelStates),
    updatedAt: new Date().toISOString(),
  };
}
