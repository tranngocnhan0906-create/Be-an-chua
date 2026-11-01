// Edge Function "notify" — gửi thông báo cho app "Bé ăn chưa?"
//   {type:"vapid"}            -> trả khoá công khai để điện thoại đăng ký nhận thông báo
//   {type:"event", table, id} -> do trigger CSDL gọi khi có bài / tim / bình luận mới
//   {type:"remind"}           -> do cron gọi mỗi 10 phút để nhắc giờ ăn
//   {type:"test"}             -> người dùng bấm "Gửi thử" (cần đăng nhập)
// Deploy với verify_jwt = false; các nhánh tự kiểm tra và chống gửi trùng.

import { generateVapidKeys, sendWebPush, type VapidKeys } from "./webpush.ts";

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
const PUBLIC_KEY = pickKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY") || SERVICE_KEY;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MEAL_LABEL: Record<string, string> = {
  sang: "bữa sáng",
  trua: "bữa trưa",
  chieu: "bữa chiều",
  toi: "bữa tối",
  khuya: "bữa khuya",
};
const MEAL_ICON: Record<string, string> = { sang: "🍳", trua: "🍱", chieu: "🧋", toi: "🍲", khuya: "🍜" };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function truncate(s: string, n: number): string {
  const t = (s ?? "").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

// ---------- PostgREST bằng khoá bí mật (bỏ qua RLS) ----------
function restHeaders(prefer?: string): Record<string, string> {
  const h: Record<string, string> = { apikey: SERVICE_KEY, "Content-Type": "application/json" };
  if (!SERVICE_KEY.startsWith("sb_")) h.Authorization = `Bearer ${SERVICE_KEY}`;
  if (prefer) h.Prefer = prefer;
  return h;
}

// deno-lint-ignore no-explicit-any
async function rest<T = any>(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}): Promise<T> {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    headers: restHeaders(init.prefer),
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`REST ${init.method ?? "GET"} ${path.split("?")[0]} -> ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

interface Profile {
  id: string;
  display_name: string;
  avatar: string;
}

async function profilesMap(): Promise<Map<string, Profile>> {
  const rows = await rest<Profile[]>("profiles?select=id,display_name,avatar&order=created_at.asc");
  return new Map(rows.map((r) => [r.id, r]));
}

// ---------- Khoá VAPID: tự tạo lần đầu, lưu trong bảng bí mật ----------
let vapidCache: VapidKeys | null = null;

async function readVapidRows() {
  const rows = await rest<{ key: string; value: string }[]>(
    "app_secrets?select=key,value&key=in.(vapid_public,vapid_private)",
  );
  return {
    pub: rows.find((r) => r.key === "vapid_public")?.value,
    priv: rows.find((r) => r.key === "vapid_private")?.value,
  };
}

async function getVapid(): Promise<VapidKeys> {
  if (vapidCache) return vapidCache;
  let { pub, priv } = await readVapidRows();
  if (!pub || !priv) {
    const gen = await generateVapidKeys();
    await rest("app_secrets?on_conflict=key", {
      method: "POST",
      prefer: "resolution=ignore-duplicates,return=minimal",
      body: [
        { key: "vapid_public", value: gen.publicKey },
        { key: "vapid_private", value: JSON.stringify(gen.privateJwk) },
      ],
    });
    ({ pub, priv } = await readVapidRows());
  }
  if (!pub || !priv) throw new Error("Không tạo được khoá VAPID");
  const cfg = await rest<{ value: string }[]>("app_config?select=value&key=eq.site_url");
  const subject = cfg[0]?.value || SB_URL;
  vapidCache = { publicKey: pub, privateJwk: JSON.parse(priv), subject };
  return vapidCache;
}

// ---------- Gửi tới tất cả máy của các người nhận ----------
async function pushTo(userIds: string[], data: { title: string; body: string; tag: string; url: string }) {
  const ids = userIds.filter((id) => UUID_RE.test(id));
  if (!ids.length) return { sent: 0, total: 0 };
  const subs = await rest<{ endpoint: string; p256dh: string; auth: string; user_id: string }[]>(
    `push_subscriptions?select=endpoint,p256dh,auth,user_id&user_id=in.(${ids.join(",")})`,
  );
  if (!subs.length) return { sent: 0, total: 0 };
  const keys = await getVapid();
  const results = await Promise.all(subs.map((s) => sendWebPush(s, data, keys)));
  for (const r of results.filter((x) => x.gone)) {
    await rest(`push_subscriptions?endpoint=eq.${encodeURIComponent(r.endpoint)}`, { method: "DELETE" }).catch(() => {});
  }
  const errors = results.filter((r) => !r.ok).map((r) => ({ status: r.status, detail: r.detail }));
  if (errors.length) console.warn("push errors", JSON.stringify(errors));
  return { sent: results.filter((r) => r.ok).length, total: results.length, errors };
}

// ---------- Bài / tim / bình luận mới ----------
async function handleEvent(table: string, id: string) {
  if (!["meals", "comments", "reactions", "messages"].includes(table) || !UUID_RE.test(id)) return { skipped: "bad input" };

  // "Giành quyền" gửi: chỉ dòng chưa thông báo mới được gửi (chống gửi trùng)
  // deno-lint-ignore no-explicit-any
  const claimed = await rest<any[]>(`${table}?id=eq.${id}&notified_at=is.null`, {
    method: "PATCH",
    prefer: "return=representation",
    body: { notified_at: new Date().toISOString() },
  });
  const row = claimed?.[0];
  if (!row) return { skipped: "already notified or missing" };

  const people = await profilesMap();

  // Tin nhắn chữ: báo cho người nhận
  if (table === "messages") {
    if (row.kind !== "text") return { skipped: "not text" };
    const sender = people.get(row.sender_id);
    const to = row.recipient_id ? [row.recipient_id] : [...people.keys()].filter((uid) => uid !== row.sender_id);
    return await pushTo(to, {
      title: `💬 ${sender?.avatar ?? ""} ${sender?.display_name ?? "Người thương"}`.replace(/\s+/g, " "),
      body: truncate(row.body ?? "", 160),
      tag: `chat-${row.sender_id}`,
      url: "#/chat",
    });
  }

  const actorName = people.get(row.user_id)?.display_name ?? "Người thương";

  let meal = row;
  if (table !== "meals") {
    // deno-lint-ignore no-explicit-any
    const meals = await rest<any[]>(`meals?id=eq.${row.meal_id}&select=id,user_id,meal_type,caption`);
    meal = meals[0];
    if (!meal) return { skipped: "meal missing" };
  }
  const label = MEAL_LABEL[meal.meal_type] ?? "bữa ăn";
  const icon = MEAL_ICON[meal.meal_type] ?? "🍽️";
  const url = `#/p/${meal.id}`;
  const others = [...people.keys()].filter((uid) => uid !== row.user_id);

  if (table === "meals") {
    return await pushTo(others, {
      title: `${icon} ${actorName} vừa đăng ${label}!`,
      body: truncate(row.caption ?? "", 120) ||
        pick(["Vào xem ăn gì nè 😋", "Nhìn ngon ghê, vào thả tim đi 💕", "Có hình mới nè, xem liền đi 🐱"]),
      tag: `meal-${row.id}`,
      url,
    });
  }
  if (table === "comments") {
    return await pushTo(others, {
      title: `💬 ${actorName} bình luận ${label}`,
      body: truncate(row.body, 140),
      tag: `cmt-${meal.id}`,
      url,
    });
  }
  // reactions: chỉ báo cho chủ bài, và không báo khi tự thả tim
  if (meal.user_id === row.user_id) return { skipped: "self reaction" };
  return await pushTo([meal.user_id], {
    title: `${row.emoji || "❤️"} ${actorName} thả tim ${label} nè`,
    body: pick(["Ăn ngon được khen nè 🥰", "Được thương quá trời 💕", "Mèo nhận được một trái tim 🐱💗"]),
    tag: `heart-${meal.id}`,
    url,
  });
}

// ---------- Nhắc giờ ăn (cron gọi mỗi 10 phút) ----------
async function handleRemind() {
  // deno-lint-ignore no-explicit-any
  const settings = (await rest<any[]>("couple_settings?id=eq.1&select=*"))[0];
  if (!settings?.reminders_enabled) return { skipped: "disabled" };

  const nowVN = new Date(Date.now() + 7 * 3600 * 1000); // giờ Việt Nam (UTC+7, không đổi giờ)
  const minutes = nowVN.getUTCHours() * 60 + nowVN.getUTCMinutes();
  const mealDay = new Date(nowVN.getTime() - 5 * 3600 * 1000).toISOString().slice(0, 10);

  const slots: [string, string][] = [["sang", "remind_sang"], ["trua", "remind_trua"], ["toi", "remind_toi"]];
  const due = slots.filter(([, col]) => {
    const t = settings[col] as string | null;
    if (!t) return false;
    const [h, m] = t.split(":").map(Number);
    const start = h * 60 + m;
    return minutes >= start && minutes < start + 30;
  }).map(([type]) => type);
  if (!due.length) return { due };

  const people = await profilesMap(); // xếp theo ngày tạo: người đầu tiên là chủ app
  const ownerId = [...people.keys()][0];
  const targets = settings.remind_targets === "both"
    ? [...people.keys()]
    : [...people.keys()].filter((uid) => uid !== ownerId);
  const out = [];
  for (const type of due) {
    const label = MEAL_LABEL[type];
    const meals = await rest<{ user_id: string }[]>(`meals?select=user_id&meal_date=eq.${mealDay}&meal_type=eq.${type}`);
    const done = new Set(meals.map((m) => m.user_id));
    for (const uid of targets) {
      const p = people.get(uid)!;
      if (done.has(uid)) continue;
      const inserted = await rest<unknown[]>("reminder_log?on_conflict=user_id,meal_date,meal_type", {
        method: "POST",
        prefer: "resolution=ignore-duplicates,return=representation",
        body: { user_id: uid, meal_date: mealDay, meal_type: type },
      });
      if (!inserted?.length) continue; // đã nhắc rồi
      const partner = [...people.values()].find((x) => x.id !== uid);
      const text = partner
        ? `Tới giờ ${label} rồi nè ${p.display_name}! ${partner.display_name} đang chờ báo cáo ${label} đó 🥺`
        : `Tới giờ ${label} rồi nè! Nhớ ăn rồi chụp hình nha 🐱`;
      await rest("messages", {
        method: "POST",
        prefer: "return=minimal",
        body: { sender_id: null, recipient_id: uid, kind: "reminder", body: text, meal_type: type, meal_date: mealDay },
      }).catch((e) => console.warn("reminder message", String(e)));
      const r = await pushTo([uid], {
        title: `⏰ Tới giờ ${label} rồi nè!`,
        body: partner
          ? `${partner.display_name} đang chờ báo cáo ${label} của ${p.display_name} đó 🥺`
          : `Nhớ ăn ${label} rồi chụp hình nha 🐱`,
        tag: `remind-${type}`,
        url: "#/chat",
      });
      out.push({ uid, type, ...r });
    }
  }
  return { due, out };
}

// ---------- Gửi thử cho chính mình ----------
async function handleTest(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Chưa đăng nhập" }, 401);
  const res = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: PUBLIC_KEY, Authorization: `Bearer ${token}` } });
  if (!res.ok) return json({ error: "Phiên đăng nhập hết hạn" }, 401);
  const user = await res.json();
  const people = await profilesMap();
  if (!people.has(user.id)) return json({ error: "Không phải thành viên" }, 403);
  const r = await pushTo([user.id], {
    title: "🔔 Thông báo chạy ngon rồi nè!",
    body: "Từ giờ có bài mới hay tới giờ ăn là mèo báo liền 🐱",
    tag: "test",
    url: "#/",
  });
  return json(r);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (!SB_URL || !SERVICE_KEY) return json({ error: "Thiếu biến môi trường Supabase" }, 500);
    // deno-lint-ignore no-explicit-any
    let body: any = {};
    if (req.method === "POST") {
      try {
        body = await req.json();
      } catch {
        body = {};
      }
    } else {
      body = { type: new URL(req.url).searchParams.get("type") };
    }
    switch (body?.type) {
      case "vapid":
        return json({ publicKey: (await getVapid()).publicKey });
      case "event":
        return json(await handleEvent(String(body.table), String(body.id)));
      case "remind":
        return json(await handleRemind());
      case "test":
        return await handleTest(req);
      default:
        return json({ error: "unknown type" }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
