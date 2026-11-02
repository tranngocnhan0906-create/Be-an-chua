// Edge Function "notify" — thông báo cho app "Bé ăn chưa?" (bản 2.1)
//   {type:"vapid"}            -> khoá công khai để điện thoại đăng ký nhận thông báo
//   {type:"event", table, id} -> trigger CSDL gọi: bài mới, tim, tin nhắn, buzz, chị 🍓 tới/đi
//   {type:"remind"}           -> cron 10 phút/lần: nhắc Ny trễ bữa + bản tin 8h sáng (chị 🍓, sinh nhật, kỷ niệm)
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

// ---------- Ngày giờ Việt Nam (UTC+7, không đổi giờ) ----------
const vnNow = () => new Date(Date.now() + 7 * 3600 * 1000); // các trường UTC = giờ VN
const vnToday = () => vnNow().toISOString().slice(0, 10);
const addDays = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const diffDays = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const dm = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;

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
  birthday?: string | null;
}

/** Hai người theo thứ tự tạo tài khoản: người đầu là chủ app, người thứ hai là Ny */
async function couple() {
  const rows = await rest<Profile[]>("profiles?select=id,display_name,avatar,birthday&order=created_at.asc");
  const people = new Map(rows.map((r) => [r.id, r]));
  return { people, owner: rows[0] as Profile | undefined, ny: rows[1] as Profile | undefined };
}

// deno-lint-ignore no-explicit-any
async function getSettings(): Promise<any> {
  return (await rest("couple_settings?id=eq.1&select=*"))[0] ?? {};
}

/** Ghi sổ đã gửi (khoá chống gửi trùng). Trả về true nếu là lần đầu */
async function firstTime(userId: string, day: string, key: string): Promise<boolean> {
  const inserted = await rest<unknown[]>("reminder_log?on_conflict=user_id,meal_date,meal_type", {
    method: "POST",
    prefer: "resolution=ignore-duplicates,return=representation",
    body: { user_id: userId, meal_date: day, meal_type: key },
  });
  return !!inserted?.length;
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

// ====================================================================== CHỊ 🍓
interface Cycle {
  id: string;
  user_id: string;
  start_date: string;
  end_date: string | null;
  start_notified_at?: string | null;
  end_notified_at?: string | null;
}

function predict(cycles: Cycle[], cycleLen = 28, periodLen = 5) {
  const list = [...cycles].sort((a, b) => a.start_date.localeCompare(b.start_date));
  if (!list.length) return null;
  const lens: number[] = [];
  for (let i = 1; i < list.length; i++) {
    const d = diffDays(list[i - 1].start_date, list[i].start_date);
    if (d >= 18 && d <= 60) lens.push(d);
  }
  const recent = lens.slice(-6);
  const avgCycle = recent.length ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length) : cycleLen;
  const plens = list.filter((c) => c.end_date).map((c) => diffDays(c.start_date, c.end_date!) + 1)
    .filter((n) => n >= 2 && n <= 12).slice(-6);
  const avgPeriod = plens.length ? Math.round(plens.reduce((a, b) => a + b, 0) / plens.length) : periodLen;
  const last = list[list.length - 1];
  const nextStart = addDays(last.start_date, avgCycle);
  const ovulation = addDays(nextStart, -14);
  return { last, avgCycle, avgPeriod, nextStart, ovulation, fertileStart: addDays(ovulation, -5), fertileEnd: addDays(ovulation, 1) };
}

const CYCLE_NEWS: Record<string, { title: string; ny: string[]; owner: string[] }> = {
  pms: {
    title: "🌋 Sắp vào mùa dễ nóng tính",
    ny: [
      "Còn 3 ngày nữa chị 🍓 ghé. Từ giờ {ny} được quyền dỗi vô cớ, ai cãi mèo cào 😼",
      "Ba ngày nữa chị 🍓 tới. Tự nhiên thấy ai cũng đáng ghét là do hormone, không phải do {ny} đâu 😌",
    ],
    owner: [
      "Báo động cam 🚨 3 ngày nữa chị 🍓 tới thăm {ny}. {owner} kích hoạt chế độ nhường nhịn, cất sẵn trà sữa 🧋",
      "Còn 3 ngày chị 🍓 ghé 🧯 {owner} ghi nhớ: {ny} nói gì cũng đúng, {ny} dỗi thì dỗ, {ny} đói thì cho ăn 🍰",
    ],
  },
  eve: {
    title: "🍓 Mai chị 🍓 ghé",
    ny: [
      "Mai chị 🍓 ghé đó! Bỏ sẵn băng vệ sinh vào túi nha 🎒",
      "Chị 🍓 hẹn mai tới chơi. Mặc đồ tối màu cho chắc ăn nha 😆",
    ],
    owner: [
      "Mai chị 🍓 tới thăm {ny}. {owner} nạp sẵn socola 🍫, túi chườm ♨️ và một trái tim bao dung 💗",
      "Ngày mai chị 🍓 tới. {owner} tập sẵn câu thần chú: \"Em nói đúng, em ăn gì anh mua\" 🙏",
    ],
  },
  due: {
    title: "📅 Hôm nay chị 🍓 có hẹn",
    ny: ["Theo lịch thì hôm nay chị 🍓 ghé. Tới rồi bấm \"Chị tới rồi\" cho mèo ghi sổ nha 🐱"],
    owner: ["Dự kiến hôm nay chị 🍓 ghé. {owner} nói chuyện nhỏ nhẹ, tuyệt đối không cãi lý nha 🙏"],
  },
  start: {
    title: "🍓 Chị 🍓 đã tới",
    ny: [
      "Mèo ghi sổ rồi! Uống nước ấm, tránh đồ lạnh, đau quá thì nhắn {owner} liền nha 💗",
      "Chị 🍓 tới rồi. Hôm nay {ny} được miễn mọi việc nặng, nằm nghỉ cho khoẻ nha 🛌",
    ],
    owner: [
      "Chị 🍓 đã tới! {owner} lên đồ: nước ấm, socola, một cái ôm thật lâu 🫂",
      "{ny} đang trong \"kỳ nghỉ đỏ\" 🚑 {owner} chuyển sang chế độ chiều chuộng cấp 3 🫶",
    ],
  },
  day2: {
    title: "🫖 Ngày 2 của chị 🍓",
    ny: ["Ngày 2 thường mệt nhất. Chườm ấm bụng, ngủ thêm chút nha. {owner} đang được mèo nhắc chăm {ny} đó 😽"],
    owner: ["Ngày 2 thường mệt nhất. {owner} mua gì ấm ấm mang qua cho {ny} đi 🍲"],
  },
  end: {
    title: "🎉 Chị 🍓 về rồi",
    ny: ["Hết kỳ nghỉ đỏ! {ny} hồi máu 100% rồi đó 💪", "Chị 🍓 về rồi. Thưởng cho {ny} một ly trà sữa nha 🧋"],
    owner: ["Chị 🍓 về rồi! {ny} hồi máu 100%, {owner} được phép trêu nhẹ trở lại 😆", "Hết kỳ nghỉ đỏ 🎉 Rủ {ny} đi ăn mừng một bữa đi {owner} 🍜"],
  },
  fertile: {
    title: "🌸 Những ngày dễ thụ thai",
    ny: ["Từ hôm nay tới {den} là những ngày dễ thụ thai (dự đoán). Lưu ý nha 😉"],
    owner: ["{ny} đang vào những ngày dễ thụ thai (dự đoán, tới {den}). {owner} lưu ý nha 😉"],
  },
  ovulation: {
    title: "🥚 Ngày rụng trứng",
    ny: ["Hôm nay là ngày rụng trứng dự đoán. Nghe nói da đẹp, mood lên hương ✨"],
    owner: ["Hôm nay là ngày rụng trứng dự đoán của {ny}. Khen {ny} xinh lúc này là chuẩn bài 💐"],
  },
  late: {
    title: "⏰ Chị 🍓 trễ hẹn",
    ny: ["Chị 🍓 trễ hẹn 3 ngày rồi. Căng thẳng hay thức khuya cũng làm trễ đó, đừng lo quá nha. Tới thì bấm báo mèo 🐱"],
    owner: ["Chị 🍓 trễ hẹn 3 ngày. {owner} bình tĩnh, quan tâm {ny} nhiều hơn nha 🤍"],
  },
  late7: {
    title: "🩺 Chị 🍓 trễ 1 tuần",
    ny: ["Chị 🍓 trễ 1 tuần rồi. Nếu thấy lo thì kiểm tra hoặc hỏi bác sĩ cho yên tâm nha 🩺"],
    owner: ["Chị 🍓 trễ 1 tuần. {owner} ở bên {ny}, cùng bình tĩnh tìm hiểu nha 🤝"],
  },
  long: {
    title: "🩺 Chị 🍓 ở lâu quá",
    ny: ["Chị 🍓 ở lại 9 ngày rồi. Nếu chị đi rồi thì bấm \"Chị đi rồi\" nha; còn nếu vẫn kéo dài thì nên hỏi bác sĩ 🩺"],
    owner: ["Chị 🍓 ở lại khá lâu (9 ngày). {owner} hỏi han {ny} xem có mệt không nha 🤍"],
  },
};

async function sendCycleNews(event: string, vars: { den?: string } = {}) {
  const news = CYCLE_NEWS[event];
  if (!news) return { skipped: "unknown event" };
  const { owner, ny } = await couple();
  if (!ny || !owner) return { skipped: "no couple" };
  const fill = (t: string) =>
    t.replaceAll("{ny}", ny.display_name).replaceAll("{owner}", owner.display_name).replaceAll("{den}", vars.den ?? "");
  const nyText = fill(pick(news.ny));
  const ownerText = fill(pick(news.owner));
  await rest("messages", {
    method: "POST",
    prefer: "return=minimal",
    body: { sender_id: null, recipient_id: ny.id, kind: "cycle", body: JSON.stringify({ event, title: news.title, ny: nyText, owner: ownerText }) },
  }).catch((e) => console.warn("cycle message", String(e)));
  const a = await pushTo([ny.id], { title: news.title, body: nyText, tag: `cycle-${event}`, url: "#/cycle" });
  const b = await pushTo([owner.id], { title: news.title, body: ownerText, tag: `cycle-${event}`, url: "#/cycle" });
  return { event, ny: a, owner: b };
}

async function handleCycleEvent(id: string) {
  const c = (await rest<Cycle[]>(`cycles?id=eq.${id}&select=*`))[0];
  if (!c) return { skipped: "missing" };
  const today = vnToday();
  let event: string | null = null;
  if (c.end_date && !c.end_notified_at) {
    const won = await rest<unknown[]>(`cycles?id=eq.${id}&end_notified_at=is.null`, {
      method: "PATCH", prefer: "return=representation", body: { end_notified_at: new Date().toISOString() },
    });
    if (!won?.length) return { skipped: "dup" };
    if (Math.abs(diffDays(c.end_date, today)) <= 2) event = "end";
  } else if (!c.start_notified_at) {
    const won = await rest<unknown[]>(`cycles?id=eq.${id}&start_notified_at=is.null`, {
      method: "PATCH", prefer: "return=representation", body: { start_notified_at: new Date().toISOString() },
    });
    if (!won?.length) return { skipped: "dup" };
    if (Math.abs(diffDays(c.start_date, today)) <= 2) event = "start"; // nhập lịch sử cũ thì không báo
  }
  const settings = await getSettings();
  if (!event || settings.cycle_notify === false) return { silent: true };
  return await sendCycleNews(event);
}

async function cycleDigest(settings: Record<string, unknown>) {
  if (settings.cycle_notify === false) return { skipped: "off" };
  const { ny } = await couple();
  if (!ny) return { skipped: "no ny" };
  const cycles = await rest<Cycle[]>(`cycles?user_id=eq.${ny.id}&select=*&order=start_date.asc`);
  const pred = predict(cycles, Number(settings.cycle_length) || 28, Number(settings.period_length) || 5);
  if (!pred) return { skipped: "no data" };
  const today = vnToday();
  const last = pred.last;
  const sinceStart = diffDays(last.start_date, today);
  const ongoing = !last.end_date && sinceStart >= 0 && sinceStart < 12;
  const events: string[] = [];
  if (ongoing) {
    if (sinceStart + 1 === 2) events.push("day2");
    if (sinceStart + 1 === 9) events.push("long");
  } else {
    const toNext = diffDays(today, pred.nextStart);
    if (toNext === 3) events.push("pms");
    if (toNext === 1) events.push("eve");
    if (toNext === 0) events.push("due");
    if (toNext === -3) events.push("late");
    if (toNext === -7) events.push("late7");
    if (today === pred.fertileStart) events.push("fertile");
    if (today === pred.ovulation) events.push("ovulation");
  }
  const out = [];
  for (const ev of events) {
    if (!(await firstTime(ny.id, today, `cycle:${ev}`))) continue;
    out.push(await sendCycleNews(ev, { den: dm(pred.fertileEnd) }));
  }
  return { events, out };
}

// ====================================================================== SINH NHẬT & KỶ NIỆM
function nextBirthday(bday: string, today: string) {
  const [y, m, d] = bday.split("-").map(Number);
  const leap = (yy: number) => (yy % 4 === 0 && yy % 100 !== 0) || yy % 400 === 0;
  const on = (yy: number) => (m === 2 && d === 29 && !leap(yy)) ? `${yy}-03-01` : `${yy}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const ty = Number(today.slice(0, 4));
  let date = on(ty);
  if (date < today) date = on(ty + 1);
  return { date, daysTo: diffDays(today, date), turning: Number(date.slice(0, 4)) - y };
}

/** Thẻ sự kiện trong chat (mỗi người đọc một câu riêng) + thông báo cho cả hai */
async function sendEventCard(event: string, title: string, nyText: string, ownerText: string, recipient: string, ny: Profile, owner: Profile) {
  await rest("messages", {
    method: "POST",
    prefer: "return=minimal",
    body: { sender_id: null, recipient_id: recipient, kind: "event", body: JSON.stringify({ event, title, ny: nyText, owner: ownerText }) },
  }).catch((e) => console.warn("event message", String(e)));
  const a = await pushTo([ny.id], { title, body: nyText, tag: `event-${event}`, url: "#/us" });
  const b = await pushTo([owner.id], { title, body: ownerText, tag: `event-${event}`, url: "#/us" });
  return { event, ny: a, owner: b };
}

async function loveDigest(settings: Record<string, unknown>) {
  const { owner, ny } = await couple();
  if (!owner || !ny) return { skipped: "no couple" };
  const today = vnToday();
  const out: unknown[] = [];
  const nameOf = (p: Profile) => p.display_name;
  for (const p of [ny, owner]) {
    if (!p.birthday) continue;
    const other = p.id === ny.id ? owner : ny;
    const nb = nextBirthday(p.birthday, today);
    if (nb.daysTo === 7 && (await firstTime(other.id, today, `bday7:${p.id}`))) {
      out.push(await pushTo([other.id], {
        title: `🎁 Còn 1 tuần là sinh nhật ${nameOf(p)}`,
        body: `${nameOf(other)} lên kế hoạch quà cáp đi, mèo giữ bí mật cho 🤫`,
        tag: `bday-${p.id}`,
        url: "#/us",
      }));
    }
    if (nb.daysTo === 1 && (await firstTime(other.id, today, `bday1:${p.id}`))) {
      out.push(await pushTo([other.id], {
        title: `🎂 Mai là sinh nhật ${nameOf(p)}!`,
        body: `Bánh kem, hoa, quà đủ chưa ${nameOf(other)}? Mèo hỏi vậy thôi 😼`,
        tag: `bday-${p.id}`,
        url: "#/us",
      }));
    }
    if (nb.daysTo === 0 && (await firstTime(p.id, today, `bday0:${p.id}`))) {
      const self = `Chúc mừng sinh nhật ${nameOf(p)}! Tuổi ${nb.turning} ăn ngon ngủ kỹ, được thương nhiều nhất 💗`;
      const toOther = `Hôm nay sinh nhật ${nameOf(p)} (${nb.turning} tuổi). ${nameOf(other)} nhớ chúc thật to, ôm thật chặt nha 🎉`;
      out.push(await sendEventCard("birthday", `🎂 Sinh nhật ${nameOf(p)}!`,
        p.id === ny.id ? self : toOther, p.id === owner.id ? self : toOther, p.id, ny, owner));
    }
  }
  const start = String(settings.start_date ?? "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(start) && start <= today) {
    const days = diffDays(start, today) + 1;
    const years = Number(today.slice(0, 4)) - Number(start.slice(0, 4));
    if (days % 100 === 0 && (await firstTime(owner.id, today, `love:${days}`))) {
      out.push(await sendEventCard("love100", `💞 Tròn ${days} ngày yêu nhau!`,
        `${days} ngày bên ${owner.display_name} rồi đó 🥰 Hôm nay đòi một bữa thật ngon nha!`,
        `${days} ngày bên ${ny.display_name} rồi 🥰 ${owner.display_name} dẫn ${ny.display_name} đi ăn mừng đi!`, ny.id, ny, owner));
    }
    if (years >= 1 && today.slice(5) === start.slice(5) && (await firstTime(owner.id, today, `anniv:${years}`))) {
      out.push(await sendEventCard("anniv", `💍 Kỷ niệm ${years} năm yêu nhau!`,
        `Tròn ${years} năm bên ${owner.display_name} 💍 Cảm ơn vì đã cùng nhau ăn biết bao nhiêu bữa 🍲`,
        `Tròn ${years} năm bên ${ny.display_name} 💍 Hôm nay là ngày của hai đứa, ${owner.display_name} chuẩn bị gì chưa?`, ny.id, ny, owner));
    }
  }
  return { out };
}

// ====================================================================== SỰ KIỆN
async function handleEvent(table: string, id: string) {
  if (!["meals", "comments", "reactions", "messages", "cycles"].includes(table) || !UUID_RE.test(id)) return { skipped: "bad input" };
  if (table === "cycles") return await handleCycleEvent(id);

  // "Giành quyền" gửi: chỉ dòng chưa thông báo mới được gửi (chống gửi trùng)
  // deno-lint-ignore no-explicit-any
  const claimed = await rest<any[]>(`${table}?id=eq.${id}&notified_at=is.null`, {
    method: "PATCH",
    prefer: "return=representation",
    body: { notified_at: new Date().toISOString() },
  });
  const row = claimed?.[0];
  if (!row) return { skipped: "already notified or missing" };

  const { people } = await couple();

  if (table === "messages") {
    if (row.kind !== "text" && row.kind !== "buzz") return { skipped: "not text" };
    const sender = people.get(row.sender_id);
    const name = sender?.display_name ?? "Người thương";
    if (row.kind === "buzz") {
      const label = MEAL_LABEL[row.meal_type] ?? "bữa ăn";
      return await pushTo(row.recipient_id ? [row.recipient_id] : [], {
        title: `🔔 Buzzz! ${name} nhắc ${label} ${MEAL_ICON[row.meal_type] ?? ""}`.trim(),
        body: truncate(row.body ?? "", 160) || `Ăn ${label} liền đi nha 🐱`,
        tag: "buzz",
        url: row.meal_type ? `#/new/${row.meal_type}${row.meal_date ? "/" + row.meal_date : ""}` : "#/chat",
      });
    }
    const to = row.recipient_id ? [row.recipient_id] : [...people.keys()].filter((uid) => uid !== row.sender_id);
    let body = truncate(row.body ?? "", 160);
    if (!body) body = row.media_type === "video" ? "🎬 Đã gửi một video" : row.media_type === "image" ? "📷 Đã gửi một ảnh" : "💌";
    if (row.meal_id) {
      // deno-lint-ignore no-explicit-any
      const meal = (await rest<any[]>(`meals?id=eq.${row.meal_id}&select=id,meal_type`))[0];
      return await pushTo(to, {
        title: `💬 ${name} bình luận ${MEAL_LABEL[meal?.meal_type] ?? "bữa ăn"}`,
        body,
        tag: `cmt-${row.meal_id}`,
        url: `#/p/${row.meal_id}`,
      });
    }
    return await pushTo(to, { title: `💬 ${sender?.avatar ?? ""} ${name}`.trim(), body, tag: `chat-${row.sender_id}`, url: "#/chat" });
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
      title: `${icon} ${actorName} vừa báo cáo ${label}!`,
      body: truncate(row.caption ?? "", 120) ||
        pick(["Vào xem ăn gì nè 😋", "Nhìn ngon ghê, vào thả tim đi 💕", "Có hình mới nè, xem liền đi 🐱"]),
      tag: `meal-${row.id}`,
      url,
    });
  }
  if (table === "comments") {
    return await pushTo(others, { title: `💬 ${actorName} bình luận ${label}`, body: truncate(row.body, 140), tag: `cmt-${meal.id}`, url });
  }
  if (meal.user_id === row.user_id) return { skipped: "self reaction" };
  return await pushTo([meal.user_id], {
    title: `${row.emoji || "❤️"} ${actorName} thả tim ${label} nè`,
    body: pick(["Ăn ngon được khen nè 🥰", "Được thương quá trời 💕", "Mèo nhận được một trái tim 🐱💗"]),
    tag: `heart-${meal.id}`,
    url,
  });
}

// ====================================================================== NHẮC GIỜ ĂN
const hhmm = (t: string) => t.slice(0, 5);

async function handleRemind() {
  const settings = await getSettings();
  const now = vnNow();
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const out: unknown[] = [];

  // Bản tin lúc 8h sáng: chị 🍓, sinh nhật, kỷ niệm ngày yêu
  if (minutes >= 8 * 60 && minutes < 8 * 60 + 30) {
    out.push({ cycle: await cycleDigest(settings).catch((e) => ({ error: String(e) })) });
    out.push({ love: await loveDigest(settings).catch((e) => ({ error: String(e) })) });
  }

  if (settings.reminders_enabled === false) return { skipped: "meals off", out };
  const { owner, ny } = await couple();
  if (!ny) return { skipped: "no ny", out };
  const ownerName = owner?.display_name ?? "anh";
  const mealDay = new Date(now.getTime() - 5 * 3600 * 1000).toISOString().slice(0, 10);

  const slots: [string, string][] = [["sang", "sched_sang"], ["trua", "sched_trua"], ["toi", "sched_toi"]];
  for (const [type, col] of slots) {
    const t = String(settings[col] ?? "");
    if (!/^\d{2}:\d{2}/.test(t)) continue;
    const [h, m] = t.split(":").map(Number);
    const sched = h * 60 + m;
    const label = MEAL_LABEL[type];
    let stage = 0;
    if (minutes >= sched + 15 && minutes < sched + 45) stage = 1;
    else if (minutes >= sched + 60 && minutes < sched + 90) stage = 2;
    if (!stage) continue;
    const posted = await rest<unknown[]>(`meals?select=id&user_id=eq.${ny.id}&meal_date=eq.${mealDay}&meal_type=eq.${type}&limit=1`);
    if (posted.length) continue;
    if (!(await firstTime(ny.id, mealDay, stage === 1 ? type : `${type}+60`))) continue;

    const text = stage === 1
      ? `Tới giờ ${label} (${hhmm(t)}) rồi nè ${ny.display_name}! ${ownerName} đang chờ báo cáo đó 🥺`
      : `🚨 Trễ ${label} 1 tiếng rồi đó ${ny.display_name}! Ăn liền rồi báo cáo cho ${ownerName} nha 😾`;
    await rest("messages", {
      method: "POST",
      prefer: "return=minimal",
      body: { sender_id: null, recipient_id: ny.id, kind: "reminder", body: text, meal_type: type, meal_date: mealDay },
    }).catch((e) => console.warn("reminder message", String(e)));
    const r1 = await pushTo([ny.id], {
      title: stage === 1 ? `⏰ Tới giờ ${label} rồi nè!` : `🚨 Trễ ${label} 1 tiếng rồi!`,
      body: stage === 1 ? `${ownerName} đang chờ báo cáo ${label} đó 🥺` : `Ăn liền đi rồi chụp hình báo cáo cho ${ownerName} nha 😾`,
      tag: `remind-${type}`,
      url: "#/chat",
    });
    let r2 = null;
    if (stage === 2 && owner && settings.late_alert_owner !== false) {
      r2 = await pushTo([owner.id], {
        title: `🚨 ${ny.display_name} trễ ${label} 1 tiếng`,
        body: `Giờ ăn ${hhmm(t)} mà chưa thấy hình. Nhắn nhắc ${ny.display_name} đi ${ownerName}!`,
        tag: `late-${type}`,
        url: "#/",
      });
    }
    out.push({ type, stage, ny: r1, owner: r2 });
  }
  return { minutes, out };
}

// ---------- Gửi thử cho chính mình ----------
async function handleTest(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Chưa đăng nhập" }, 401);
  const res = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: PUBLIC_KEY, Authorization: `Bearer ${token}` } });
  if (!res.ok) return json({ error: "Phiên đăng nhập hết hạn" }, 401);
  const user = await res.json();
  const { people } = await couple();
  if (!people.has(user.id)) return json({ error: "Không phải thành viên" }, 403);
  const r = await pushTo([user.id], {
    title: "🔔 Thông báo chạy ngon rồi nè!",
    body: "Từ giờ có tin nhắn, giờ ăn hay chị 🍓 ghé là mèo báo liền 🐱",
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
