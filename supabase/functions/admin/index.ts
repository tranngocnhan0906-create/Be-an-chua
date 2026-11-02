// Edge Function "admin" — việc của chủ app trong "Bé ăn chưa?"
//   {type:"kick", target, rotate} -> đuổi một tài khoản (xoá tài khoản + file ảnh/video), tuỳ chọn đổi mã mời
// Deploy với verify_jwt = false; hàm tự kiểm tra người gọi là chủ app (tài khoản tạo đầu tiên).

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";

function pickKey(dictName: string, legacyName: string): string {
  try {
    const dict = JSON.parse(Deno.env.get(dictName) ?? "{}");
    const v = dict.default ?? Object.values(dict)[0];
    if (typeof v === "string" && v) return v;
  } catch { /* bỏ qua */ }
  return Deno.env.get(legacyName) ?? "";
}

const SERVICE_KEY = pickKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
const LEGACY_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PUBLIC_KEY = pickKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY") || SERVICE_KEY;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function headersFor(key: string): Record<string, string> {
  const h: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (!key.startsWith("sb_")) h.Authorization = `Bearer ${key}`;
  return h;
}

/** Gọi API quản trị bằng khoá bí mật; nếu khoá mới bị từ chối thì thử khoá service_role cũ */
async function adminFetch(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}) {
  const run = (key: string) => {
    const h = headersFor(key);
    if (init.prefer) h.Prefer = init.prefer;
    return fetch(`${SB_URL}${path}`, {
      method: init.method ?? "GET",
      headers: h,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  };
  let res = await run(SERVICE_KEY);
  if ((res.status === 401 || res.status === 403) && LEGACY_SERVICE && LEGACY_SERVICE !== SERVICE_KEY) res = await run(LEGACY_SERVICE);
  return res;
}

// deno-lint-ignore no-explicit-any
async function rest<T = any>(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}): Promise<T> {
  const res = await adminFetch(`/rest/v1/${path}`, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`REST ${init.method ?? "GET"} ${path.split("?")[0]} -> ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

async function callerId(req: Request): Promise<string | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const res = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: PUBLIC_KEY, Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  return (await res.json())?.id ?? null;
}

function newInviteCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return "MEO-" + [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

// deno-lint-ignore no-explicit-any
async function handleKick(req: Request, body: any) {
  const uid = await callerId(req);
  if (!uid) return json({ error: "Phiên đăng nhập hết hạn, đăng nhập lại nha" }, 401);
  const rows = await rest<{ id: string; display_name: string }[]>("profiles?select=id,display_name&order=created_at.asc");
  const owner = rows[0];
  if (!owner || owner.id !== uid) return json({ error: "Chỉ chủ app mới được đuổi tài khoản" }, 403);
  const target = String(body?.target ?? "");
  if (!UUID_RE.test(target) || !rows.some((r) => r.id === target)) return json({ error: "Không tìm thấy tài khoản này" }, 404);
  if (target === owner.id) return json({ error: "Không tự đuổi mình được đâu 😹" }, 400);

  // Gom file ảnh/video của tài khoản này để dọn khỏi kho
  const paths = new Set<string>();
  // deno-lint-ignore no-explicit-any
  const meals = await rest<any[]>(`meals?user_id=eq.${target}&select=media_path,thumb_path`);
  // deno-lint-ignore no-explicit-any
  const msgs = await rest<any[]>(`messages?sender_id=eq.${target}&media_path=not.is.null&select=media_path,thumb_path`);
  // deno-lint-ignore no-explicit-any
  const prof = (await rest<any[]>(`profiles?id=eq.${target}&select=chat_bg`))[0];
  for (const r of [...meals, ...msgs]) {
    if (r.media_path) paths.add(r.media_path);
    if (r.thumb_path) paths.add(r.thumb_path);
  }
  const bg = String(prof?.chat_bg ?? "");
  if (bg.startsWith("photo:")) paths.add(bg.slice(6).split("|")[0]);

  // Xoá tài khoản: hồ sơ, bài, tin nhắn, lịch, chu kỳ… xoá theo (on delete cascade)
  const del = await adminFetch(`/auth/v1/admin/users/${target}`, { method: "DELETE" });
  if (!del.ok && del.status !== 404) {
    return json({ error: `Không xoá được tài khoản (${del.status}): ${(await del.text()).slice(0, 200)}` }, 500);
  }

  let removedFiles = 0;
  const list = [...paths].filter((p) => p.startsWith(`${target}/`));
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100);
    const r = await adminFetch("/storage/v1/object/meals", { method: "DELETE", body: { prefixes: chunk } });
    if (r.ok) removedFiles += chunk.length;
  }

  let invite: string | null = null;
  if (body?.rotate !== false) {
    invite = newInviteCode();
    await rest("app_secrets?on_conflict=key", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: { key: "invite_code", value: invite },
    });
  }
  return json({ ok: true, removedFiles, invite });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (!SB_URL || !SERVICE_KEY) return json({ error: "Thiếu biến môi trường Supabase" }, 500);
    // deno-lint-ignore no-explicit-any
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    switch (body?.type) {
      case "kick":
        return await handleKick(req, body);
      default:
        return json({ error: "unknown type" }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
