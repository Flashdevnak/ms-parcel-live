import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Cache-Control": "no-store",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
}

function jwtClaims(req: Request) {
  const raw = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!raw) return { sub: "", email: "" };
  try {
    const part = raw.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, "=")));
    return { sub: String(payload.sub || ""), email: String(payload.email || "") };
  } catch { return { sub: "", email: "" }; }
}

async function db(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("apikey", SERVICE_KEY);
  headers.set("authorization", `Bearer ${SERVICE_KEY}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`DB ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

function bytesToB64(bytes: Uint8Array) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
function b64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
async function credentialKey() {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`ms-parcel-live:v1:${SERVICE_KEY}`));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function encryptCredential(value: Record<string,string>) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await credentialKey();
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  return `v1.${bytesToB64(iv)}.${bytesToB64(encrypted)}`;
}
async function decryptCredential(value: unknown) {
  const raw = String(value || "");
  if (!raw) return { credential: {} as Record<string,string>, legacy: false };
  if (!raw.startsWith("v1.")) {
    try { return { credential: JSON.parse(raw) as Record<string,string>, legacy: true }; }
    catch { return { credential: {} as Record<string,string>, legacy: false }; }
  }
  const [, iv64, data64] = raw.split(".");
  if (!iv64 || !data64) throw new Error("รูปแบบ credential ไม่ถูกต้อง");
  const key = await credentialKey();
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(iv64) }, key, b64ToBytes(data64));
  return { credential: JSON.parse(new TextDecoder().decode(decrypted)) as Record<string,string>, legacy: false };
}

async function ensureProfile(userId: string, email: string) {
  const rows = await db(`app_profiles?user_id=eq.${encodeURIComponent(userId)}&select=user_id,email,role,display_name,access_status,created_at,updated_at&limit=1`);
  if (rows?.[0]) {
    if (email && !rows[0].email) {
      const updated = await db(`app_profiles?user_id=eq.${encodeURIComponent(userId)}`, {
        method: "PATCH", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ email, updated_at: new Date().toISOString() }),
      });
      if (updated?.[0]) return updated[0];
    }
    return rows[0];
  }
  const created = await db("app_profiles", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ user_id: userId, email: email || null, role: "viewer", access_status: "pending" }),
  });
  return created?.[0] || { user_id: userId, email, role: "viewer", access_status: "pending" };
}

async function sha256Hex(value: string) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function adminClaimAvailable() {
  const admins = await db("app_profiles?role=eq.admin&select=user_id&limit=1");
  if (admins?.length) return false;
  const rows = await db("app_settings?key=eq.admin_bootstrap&select=used_at&limit=1");
  return !!rows?.[0] && !rows[0].used_at;
}

async function claimAdmin(userId: string, code: string) {
  if (!code || code.length > 128) throw new Error("รหัสเปิดสิทธิ์ไม่ถูกต้อง");
  const admins = await db("app_profiles?role=eq.admin&select=user_id&limit=1");
  if (admins?.length) throw new Error("มีผู้ดูแลระบบแล้ว");
  const rows = await db("app_settings?key=eq.admin_bootstrap&select=value_hash,used_at&limit=1");
  const row = rows?.[0];
  if (!row || row.used_at) throw new Error("รหัสเปิดสิทธิ์นี้ถูกใช้แล้ว");
  const hash = await sha256Hex(code);
  if (hash !== String(row.value_hash || "")) throw new Error("รหัสเปิดสิทธิ์ไม่ถูกต้อง");

  const reserved = await db("app_settings?key=eq.admin_bootstrap&used_at=is.null", {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ used_at: new Date().toISOString(), used_by: userId, updated_at: new Date().toISOString() }),
  });
  if (!reserved?.length) throw new Error("รหัสเปิดสิทธิ์ถูกใช้งานไปแล้ว");

  const promoted = await db(`app_profiles?user_id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ role: "admin", access_status: "active", updated_at: new Date().toISOString() }),
  });
  if (!promoted?.length) throw new Error("ไม่สามารถเปิดสิทธิ์ผู้ดูแลได้");
  return promoted[0];
}

async function getConnection() {
  const rows = await db("ms_connection?is_active=eq.true&select=*&order=id.asc&limit=1");
  if (!rows?.[0]) throw new Error("ยังไม่ได้ตั้งค่าการเชื่อมต่อ MS");
  const row = rows[0];
  const decoded = await decryptCredential(row.credential_ciphertext);
  if (decoded.legacy && Object.keys(decoded.credential).length) {
    const encrypted = await encryptCredential(decoded.credential);
    await db(`ms_connection?id=eq.${row.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ credential_ciphertext: encrypted, updated_at: new Date().toISOString() }),
    });
  }
  return { ...row, credential: decoded.credential };
}

async function updateConnectionHealth(conn: any, ok: boolean, message = "") {
  const patch: Record<string, unknown> = {};
  if (ok) {
    const last = Date.parse(String(conn?.last_ok_at || ""));
    const due = !Number.isFinite(last) || Date.now() - last >= 15 * 60_000 || !!conn?.last_error;
    if (!due) return;
    patch.last_ok_at = new Date().toISOString();
    patch.last_error = null;
  } else {
    const next = String(message || "").slice(0, 1000);
    if (String(conn?.last_error || "") === next) return;
    patch.last_error = next;
  }
  await db("ms_connection?is_active=eq.true", {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
}

function pickHarRequest(har: any) {
  const entries = Array.isArray(har?.log?.entries) ? har.log.entries : [];
  const matches = entries.filter((e: any) => {
    try {
      const u = new URL(e?.request?.url || "");
      return u.hostname === "fbi.flashexpress.com" && u.pathname === "/api/dc/unfinished_parcel_list" && e?.request?.method === "GET";
    } catch { return false; }
  });
  if (!matches.length) throw new Error("HAR นี้ไม่มี request /api/dc/unfinished_parcel_list");
  const req = matches[matches.length - 1].request;
  const url = new URL(req.url);
  const ignored = new Set(["page", "page_size", "export", "total"]);
  const publicKeys = new Set(["lang", "_from", "store_id", "key", "time_key"]);
  const queryTemplate: Record<string,string> = {};
  const credential: Record<string,string> = {};
  for (const [k,v] of url.searchParams.entries()) {
    if (ignored.has(k)) continue;
    if (publicKeys.has(k)) queryTemplate[k] = v;
    else credential[k] = v;
  }
  if (!queryTemplate.store_id || !credential.auth) throw new Error("HAR ไม่มี store_id หรือ auth ที่จำเป็น");
  return { baseUrl: `${url.protocol}//${url.host}`, path: url.pathname, queryTemplate, credential };
}

function sourceHeaders(conn: any) {
  return {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "th",
    "BI-PLATFORM": "",
    "Referer": `${conn.fbi_base_url}/fbi-ui/`,
    "User-Agent": "Mozilla/5.0",
  };
}

function applyBase(url: URL, conn: any) {
  const params = { ...(conn.query_template || {}), ...(conn.credential || {}) };
  for (const [k,v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v) !== "") url.searchParams.set(k, String(v));
  }
}

async function fetchJson(url: URL, conn: any) {
  const res = await fetch(url.toString(), { method: "GET", headers: sourceHeaders(conn) });
  const text = await res.text();
  if (!res.ok) throw new Error(`MS ${res.status}: ${text.slice(0, 300)}`);
  let obj: any;
  try { obj = JSON.parse(text); } catch { throw new Error("MS ตอบกลับไม่ใช่ JSON"); }
  if (Number(obj?.code) !== 1) throw new Error(obj?.msg || "MS ไม่อนุญาตให้อ่านข้อมูล");
  return obj;
}

async function fetchLivePage(conn: any, page: number, pageSize: number) {
  const url = new URL(conn.endpoint_path, conn.fbi_base_url);
  applyBase(url, conn);
  url.searchParams.set("page", String(page));
  url.searchParams.set("page_size", String(pageSize));
  const obj = await fetchJson(url, conn);
  return {
    rows: Array.isArray(obj?.data?.list) ? obj.data.list : [],
    total: Number(obj?.data?.total || 0),
  };
}

async function fetchSummary(conn: any) {
  const url = new URL("/api/dc/dc_delivery_transfer_list", conn.fbi_base_url);
  applyBase(url, conn);
  url.searchParams.delete("store_id");
  url.searchParams.delete("time_key");
  url.searchParams.set("type", "1");
  url.searchParams.set("key", "transfer");
  const obj = await fetchJson(url, conn);
  const rows = Array.isArray(obj?.data?.data) ? obj.data.data : [];
  const target = rows.find((r: any) => String(r?.store_id || "") === String(conn.store_id || "")) || rows[0] || {};
  return {
    storeId: target.store_id || conn.store_id || "",
    storeName: target.store_name || conn.store_name || "",
    region: target.store_area || "",
    total: Number(target.transfer_total || 0),
    day1: Number(target.transfer_1 || 0),
    day2: Number(target.transfer_2 || 0),
    day3: Number(target.transfer_3 || 0),
    day4: Number(target.transfer_4 || 0),
    day5plus: Number(target.transfer_5 || 0),
  };
}

function canonicalRows(rows: any[]) { return JSON.stringify(rows || []); }

async function listUsers() {
  return await db("app_profiles?select=user_id,email,display_name,role,access_status,created_at,updated_at&order=created_at.asc");
}

async function changeUserAccess(actorId: string, targetId: string, action: string) {
  if (!targetId) throw new Error("ไม่พบผู้ใช้");
  if (targetId === actorId && action === "disable") throw new Error("ไม่สามารถปิดสิทธิ์บัญชี Admin ที่กำลังใช้งานได้");
  const target = await db(`app_profiles?user_id=eq.${encodeURIComponent(targetId)}&select=user_id,role,access_status&limit=1`);
  if (!target?.[0]) throw new Error("ไม่พบผู้ใช้");
  if (target[0].role === "admin" && action === "disable") throw new Error("ไม่สามารถปิดสิทธิ์ Admin ผ่านหน้าจอนี้ได้");
  const access_status = action === "approve" ? "active" : action === "disable" ? "disabled" : action === "pending" ? "pending" : "";
  if (!access_status) throw new Error("คำสั่งจัดการผู้ใช้ไม่ถูกต้อง");
  const updated = await db(`app_profiles?user_id=eq.${encodeURIComponent(targetId)}`, {
    method: "PATCH", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ access_status, updated_at: new Date().toISOString() }),
  });
  return updated?.[0] || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const claims = jwtClaims(req);
  const userId = claims.sub;
  if (!userId) return json({ ok: false, message: "Unauthorized" }, 401);

  try {
    let profile = await ensureProfile(userId, claims.email);
    const u = new URL(req.url);
    const route = u.pathname.split("/").filter(Boolean).pop() || "";

    if (req.method === "POST" && route === "claim-admin") {
      if (profile.role === "admin") return json({ ok: true, data: { profile, alreadyAdmin: true } });
      let body: any = {};
      try { body = await req.json(); } catch {}
      try {
        const claimed = await claimAdmin(userId, String(body?.code || ""));
        return json({ ok: true, data: { profile: claimed } });
      } catch (err) {
        return json({ ok: false, message: err instanceof Error ? err.message : String(err) }, 403);
      }
    }

    if (route === "users") {
      if (profile.role !== "admin" || profile.access_status !== "active") return json({ ok: false, message: "Admin only" }, 403);
      if (req.method === "GET") return json({ ok: true, data: { users: await listUsers() } });
      if (req.method === "POST") {
        let body: any = {};
        try { body = await req.json(); } catch {}
        const updated = await changeUserAccess(userId, String(body?.userId || ""), String(body?.action || ""));
        return json({ ok: true, data: { user: updated } });
      }
    }

    if (req.method === "GET" && route === "status") {
      const conn = await db("ms_connection?is_active=eq.true&select=label,store_id,store_name,credential_updated_at,last_ok_at,last_error&limit=1");
      const canClaimAdmin = profile.role !== "admin" ? await adminClaimAvailable() : false;
      return json({ ok: true, data: { profile, connection: conn?.[0] || null, canClaimAdmin } });
    }

    if (profile.access_status !== "active") {
      return json({ ok: false, message: profile.access_status === "disabled" ? "บัญชีนี้ถูกระงับการใช้งาน" : "บัญชีนี้กำลังรอ Admin อนุมัติ" }, 403);
    }

    if (req.method === "POST" && route === "har") {
      if (profile.role !== "admin") return json({ ok: false, message: "Admin only" }, 403);
      const text = await req.text();
      if (text.length > 25_000_000) return json({ ok: false, message: "HAR ใหญ่เกิน 25 MB" }, 413);
      let har: any;
      try { har = JSON.parse(text); } catch { return json({ ok: false, message: "ไฟล์ HAR ไม่ใช่ JSON ที่ถูกต้อง" }, 400); }
      const found = pickHarRequest(har);
      const encryptedCredential = await encryptCredential(found.credential);
      await db("ms_connection?is_active=eq.true", {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          fbi_base_url: found.baseUrl,
          endpoint_path: found.path,
          store_id: found.queryTemplate.store_id || null,
          query_template: found.queryTemplate,
          credential_ciphertext: encryptedCredential,
          credential_updated_at: new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString(),
        }),
      });
      await db("live_cache_pages?cache_key=not.is.null", { method: "DELETE" });
      await db("summary_cache?cache_key=not.is.null", { method: "DELETE" });
      return json({ ok: true, data: { storeId: found.queryTemplate.store_id, credentialKeys: Object.keys(found.credential).sort() } });
    }

    if (req.method === "GET" && route === "summary") {
      const cacheKey = "transfer-summary";
      const cached = await db(`summary_cache?cache_key=eq.${cacheKey}&select=*&limit=1`);
      const c = cached?.[0];
      if (c && new Date(c.expires_at).getTime() > Date.now()) {
        return json({ ok: true, data: c.payload, meta: { cache: "hit", expiresAt: c.expires_at, profileRole: profile.role } });
      }
      const conn = await getConnection();
      try {
        const summary = await fetchSummary(conn);
        const payload = { ...summary, sourceAt: new Date().toISOString() };
        const expiresAt = new Date(Date.now() + 15_000).toISOString();
        await db("summary_cache?on_conflict=cache_key", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({ cache_key: cacheKey, payload, source_updated_at: new Date().toISOString(), expires_at: expiresAt }),
        });
        await updateConnectionHealth(conn, true);
        return json({ ok: true, data: payload, meta: { cache: "miss", ttlMs: 15000, profileRole: profile.role } });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await updateConnectionHealth(conn, false, message);
        if (c?.payload) return json({ ok: true, data: c.payload, meta: { cache: "stale", stale: true, error: message, profileRole: profile.role } });
        return json({ ok: false, message }, 502);
      }
    }

    if (req.method === "GET" && route === "live") {
      const page = Math.max(1, Math.min(100000, Number(u.searchParams.get("page") || 1) || 1));
      const pageSize = Math.max(10, Math.min(100, Number(u.searchParams.get("page_size") || 100) || 100));
      const cacheKey = `p:${page}:s:${pageSize}`;
      const cached = await db(`live_cache_pages?cache_key=eq.${encodeURIComponent(cacheKey)}&select=*&limit=1`);
      const c = cached?.[0];
      if (c && new Date(c.expires_at).getTime() > Date.now()) {
        return json({ ok: true, data: c.payload, meta: { cache: "hit", expiresAt: c.expires_at, profileRole: profile.role } });
      }

      const conn = await getConnection();
      try {
        const fresh = await fetchLivePage(conn, page, pageSize);
        const oldRows = Array.isArray(c?.payload?.rows) ? c.payload.rows : [];
        const changed = canonicalRows(oldRows) !== canonicalRows(fresh.rows) || Number(c?.payload?.total || -1) !== fresh.total;
        const ttlMs = changed ? 7000 : 15000;
        const payload = { rows: fresh.rows, total: fresh.total, page, pageSize, sourceAt: new Date().toISOString(), changed };
        const expiresAt = new Date(Date.now() + ttlMs).toISOString();
        await db("live_cache_pages?on_conflict=cache_key", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({ cache_key: cacheKey, payload, item_count: fresh.rows.length, source_total: fresh.total, source_updated_at: new Date().toISOString(), expires_at: expiresAt }),
        });
        if (page === 1) await db(`live_cache_pages?expires_at=lt.${encodeURIComponent(new Date(Date.now() - 60 * 60_000).toISOString())}`, { method: "DELETE" });
        await updateConnectionHealth(conn, true);
        return json({ ok: true, data: payload, meta: { cache: "miss", ttlMs, profileRole: profile.role } });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await updateConnectionHealth(conn, false, message);
        if (c?.payload) return json({ ok: true, data: c.payload, meta: { cache: "stale", stale: true, error: message, profileRole: profile.role } });
        return json({ ok: false, message }, 502);
      }
    }

    return json({ ok: false, message: "Not found" }, 404);
  } catch (err) {
    return json({ ok: false, message: err instanceof Error ? err.message : String(err) }, 500);
  }
});
