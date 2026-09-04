export const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
export const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
export const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Cache-Control": "no-store",
};

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
}
export function errMessage(err: unknown) { return err instanceof Error ? err.message : String(err); }
export function normalizeUsername(value: unknown) { return String(value || "").trim().toLowerCase(); }
export function validUsername(value: string) { return /^[a-z0-9._-]{3,32}$/.test(value); }
export function asBranchId(value: unknown) { const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? n : 0; }

export async function db(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("apikey", SERVICE_KEY);
  headers.set("authorization", `Bearer ${SERVICE_KEY}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`DB ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

export async function authenticate(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY, authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const user = await res.json();
  return user?.id ? { id: String(user.id), email: String(user.email || "") } : null;
}

export async function authPasswordLogin(email: string, password: string) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.access_token || !data?.refresh_token) throw new Error("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
  return { access_token: data.access_token, refresh_token: data.refresh_token, expires_in: data.expires_in, expires_at: data.expires_at, token_type: data.token_type || "bearer" };
}

export async function authAdminCreateUser(email: string, password: string, username: string, displayName: string) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { username, display_name: displayName || username } }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.id) throw new Error(data?.msg || data?.message || "สร้างบัญชี Auth ไม่สำเร็จ");
  return data;
}
export async function authAdminDeleteUser(userId: string) {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE", headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` } });
}
export async function authAdminSetPassword(userId: string, password: string) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "PUT",
    headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.msg || data?.message || "เปลี่ยนรหัสผ่านไม่สำเร็จ");
}

function bytesToB64(bytes: Uint8Array) { let binary = ""; for (const b of bytes) binary += String.fromCharCode(b); return btoa(binary); }
function b64ToBytes(value: string) { const binary = atob(value); return Uint8Array.from(binary, c => c.charCodeAt(0)); }
async function credentialKey() {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`ms-parcel-live:v1:${SERVICE_KEY}`));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
export async function encryptCredential(value: Record<string,string>) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await credentialKey();
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  return `v1.${bytesToB64(iv)}.${bytesToB64(encrypted)}`;
}
export async function decryptCredential(value: unknown) {
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

export async function ensureProfile(userId: string, email: string) {
  const rows = await db(`app_profiles?user_id=eq.${encodeURIComponent(userId)}&select=user_id,username,display_name,email,role,access_status,branch_id,can_upload_har,created_at,updated_at&limit=1`);
  if (rows?.[0]) return rows[0];
  const created = await db("app_profiles", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ user_id: userId, email: email || null, role: "viewer", access_status: "pending" }),
  });
  return created?.[0];
}
export function publicProfile(p: any) {
  return p ? { user_id:p.user_id, username:p.username, display_name:p.display_name, role:p.role, access_status:p.access_status, branch_id:p.branch_id, can_upload_har:!!p.can_upload_har, created_at:p.created_at, updated_at:p.updated_at } : null;
}
export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}
export async function hashPage(rows: any[], total: number) { return await sha256Hex(JSON.stringify({ rows, total })); }
export async function hashSummary(value: any) { return await sha256Hex(JSON.stringify(value)); }
