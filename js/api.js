// Lớp dữ liệu: mọi thao tác với Supabase nằm ở đây
import { createClient } from './vendor/supabase.js';
import { CONFIG } from './config.js';

const BUCKET = 'meals';
const MSG_COLS = 'id,sender_id,recipient_id,kind,body,meal_type,meal_date,meal_id,media_type,media_path,thumb_path,width,height,duration,bytes,created_at,read_at';
const PROFILE_COLS = 'id,display_name,avatar,created_at,birthday,info,chat_bg';
const SIGNED_TTL = 7 * 24 * 3600; // link ảnh có hạn 7 ngày
const SIGNED_CACHE_KEY = 'bac-signed-v1';

const sb = CONFIG.CONFIGURED
  ? createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'be-an-chua-auth' },
    })
  : null;

function friendlyAuthError(error) {
  const msg = String(error?.message || error || '');
  const map = [
    [/Database error saving new user|INVITE_INVALID|APP_FULL/i, 'Mã mời không đúng, hoặc app đã đủ 2 người rồi 🙈'],
    [/already registered|already been registered|User already exists/i, 'Email này có tài khoản rồi, chuyển qua Đăng nhập nha'],
    [/at least 6|Password should be/i, 'Mật khẩu cần ít nhất 6 ký tự'],
    [/Invalid login credentials/i, 'Sai email hoặc mật khẩu rồi 😿'],
    [/Email not confirmed/i, 'Email chưa được xác nhận. Người tạo app cần tắt "Confirm email" trong Supabase.'],
    [/invalid format|Unable to validate email/i, 'Email không hợp lệ'],
    [/Signups not allowed/i, 'App đang khoá đăng ký tài khoản mới'],
    [/rate limit|too many/i, 'Thử nhiều quá, đợi một chút rồi thử lại nha'],
    [/Failed to fetch|NetworkError|Load failed/i, 'Mất mạng rồi, kiểm tra kết nối rồi thử lại nha'],
  ];
  for (const [re, text] of map) if (re.test(msg)) return new Error(text);
  return new Error(msg || 'Có lỗi xảy ra, thử lại nha');
}

function must({ data, error }) {
  if (error) throw new Error(error.message || String(error));
  return data;
}

// ---------- Bộ nhớ đệm link ảnh đã ký ----------
const signed = new Map();
try {
  const raw = JSON.parse(localStorage.getItem(SIGNED_CACHE_KEY) || '{}');
  const now = Date.now();
  for (const [p, v] of Object.entries(raw)) if (v[1] - now > 86400e3) signed.set(p, { url: v[0], exp: v[1] });
} catch { /* bỏ qua */ }
function persistSigned() {
  try {
    const obj = {};
    for (const [p, v] of signed) obj[p] = [v.url, v.exp];
    localStorage.setItem(SIGNED_CACHE_KEY, JSON.stringify(obj));
  } catch { /* bỏ qua */ }
}

async function session() {
  const { data } = await sb.auth.getSession();
  return data.session;
}

export const api = {
  configured: CONFIG.CONFIGURED,

  async getSession() {
    return session();
  },

  onAuth(cb) {
    return sb.auth.onAuthStateChange((event, s) => cb(event, s));
  },

  async signIn(email, password) {
    const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw friendlyAuthError(error);
    return data.session;
  },

  async signUp({ email, password, displayName, avatar, inviteCode }) {
    const { data, error } = await sb.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { display_name: displayName, avatar, invite_code: inviteCode } },
    });
    if (error) throw friendlyAuthError(error);
    if (!data.session) {
      throw new Error('Tạo tài khoản xong nhưng cần xác nhận email. Người tạo app cần tắt "Confirm email" trong Supabase rồi đăng nhập lại.');
    }
    return data.session;
  },

  async signOut() {
    try {
      await sb.auth.signOut();
    } finally {
      signed.clear();
      try { localStorage.removeItem(SIGNED_CACHE_KEY); } catch { /* bỏ qua */ }
    }
  },

  async loadAll() {
    const [profiles, settingsRows, reactions, messages, cycles] = await Promise.all([
      sb.from('profiles').select(PROFILE_COLS).order('created_at').then(must),
      sb.from('couple_settings').select('*').eq('id', 1).then(must),
      sb.from('reactions').select('id,meal_id,user_id,emoji,created_at').then(must),
      sb.from('messages').select(MSG_COLS).order('created_at', { ascending: false }).limit(800).then(must),
      sb.from('cycles').select('id,user_id,start_date,end_date,created_by,created_at').order('start_date').then(must),
    ]);
    const meals = [];
    for (let from = 0; ; from += 1000) {
      const page = must(
        await sb
          .from('meals')
          .select('id,user_id,meal_type,meal_date,media_type,media_path,thumb_path,width,height,duration,bytes,caption,mood,created_at')
          .order('created_at', { ascending: true })
          .range(from, from + 999),
      );
      meals.push(...page);
      if (page.length < 1000) break;
    }
    return { profiles, settings: settingsRows[0] || null, meals, reactions, messages: messages.reverse(), cycles };
  },

  async upload(path, blob, contentType, onProgress) {
    const s = await session();
    if (!s) throw new Error('Phiên đăng nhập hết hạn, đăng nhập lại nha');
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${CONFIG.SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`);
      xhr.setRequestHeader('Authorization', `Bearer ${s.access_token}`);
      xhr.setRequestHeader('apikey', CONFIG.SUPABASE_KEY);
      xhr.setRequestHeader('Content-Type', contentType);
      xhr.setRequestHeader('cache-control', 'max-age=31536000');
      xhr.setRequestHeader('x-upsert', 'false');
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else {
          let m = xhr.responseText;
          try { m = JSON.parse(m).message || m; } catch { /* bỏ qua */ }
          reject(new Error(`Tải lên không được (${xhr.status}): ${String(m).slice(0, 140)}`));
        }
      };
      xhr.onerror = () => reject(new Error('Mất mạng khi đang tải lên, thử lại nha'));
      xhr.send(blob);
    });
  },

  async removeFiles(paths) {
    const list = paths.filter(Boolean);
    if (!list.length) return;
    await sb.storage.from(BUCKET).remove(list);
    for (const p of list) signed.delete(p);
    persistSigned();
  },

  /** Trả về Map path -> url (đã ký), có bộ nhớ đệm để ảnh được trình duyệt cache lại */
  async signedUrls(paths) {
    const now = Date.now();
    const need = [...new Set(paths.filter(Boolean))].filter((p) => {
      const v = signed.get(p);
      return !v || v.exp - now < 86400e3;
    });
    for (let i = 0; i < need.length; i += 100) {
      const chunk = need.slice(i, i + 100);
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(chunk, SIGNED_TTL);
      if (error) throw error;
      for (const item of data || []) {
        if (item.signedUrl && !item.error) signed.set(item.path, { url: item.signedUrl, exp: now + SIGNED_TTL * 1000 });
      }
    }
    if (need.length) persistSigned();
    const out = new Map();
    for (const p of paths) if (signed.has(p)) out.set(p, signed.get(p).url);
    return out;
  },

  async insertMeal(row) {
    return must(await sb.from('meals').insert(row).select().single());
  },

  async updateMeal(id, patch) {
    return must(await sb.from('meals').update(patch).eq('id', id).select().single());
  },

  async deleteMeal(meal) {
    must(await sb.from('meals').delete().eq('id', meal.id));
    await api.removeFiles([meal.media_path, meal.thumb_path]).catch(() => {});
  },

  async addHeart(mealId) {
    return must(await sb.from('reactions').insert({ meal_id: mealId }).select().single());
  },

  async removeHeart(mealId, uid) {
    must(await sb.from('reactions').delete().eq('meal_id', mealId).eq('user_id', uid));
  },

  async addComment(mealId, body) {
    return must(await sb.from('comments').insert({ meal_id: mealId, body }).select().single());
  },

  async deleteComment(id) {
    must(await sb.from('comments').delete().eq('id', id));
  },

  /** Gửi tin nhắn: chữ, ảnh/video (media), hoặc bình luận một bữa ăn (meal_id) */
  async sendMessage(row) {
    return must(await sb.from('messages').insert({ kind: 'text', ...row }).select(MSG_COLS).single());
  },

  async addCycle(userId, startDate) {
    return must(await sb.from('cycles').insert({ user_id: userId, start_date: startDate }).select().single());
  },

  async updateCycle(id, patch) {
    return must(await sb.from('cycles').update(patch).eq('id', id).select().single());
  },

  async deleteCycle(id) {
    must(await sb.from('cycles').delete().eq('id', id));
  },

  async markRead(ids) {
    if (!ids.length) return;
    must(await sb.from('messages').update({ read_at: new Date().toISOString() }).in('id', ids).is('read_at', null));
  },

  async deleteMessage(id) {
    must(await sb.from('messages').delete().eq('id', id));
  },

  async updateSettings(patch) {
    return must(await sb.from('couple_settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', 1).select().single());
  },

  async updateProfile(uid, patch) {
    return must(await sb.from('profiles').update(patch).eq('id', uid).select(PROFILE_COLS).single());
  },

  subscribe(onChange, onStatus) {
    const ch = sb.channel('be-an-chua-db');
    for (const table of ['meals', 'reactions', 'couple_settings', 'profiles', 'messages', 'cycles']) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => onChange(table, payload));
    }
    ch.subscribe((status) => onStatus?.(status));
    return () => sb.removeChannel(ch);
  },

  async callFunction(type, extra = {}) {
    const s = await session();
    const res = await fetch(`${CONFIG.FUNCTIONS_URL}/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: CONFIG.SUPABASE_KEY,
        ...(s ? { Authorization: `Bearer ${s.access_token}` } : {}),
      },
      body: JSON.stringify({ type, ...extra }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || `Lỗi máy chủ (${res.status})`);
    return j;
  },

  async savePushSubscription(sub, uid) {
    const j = sub.toJSON();
    must(
      await sb.from('push_subscriptions').upsert({
        endpoint: j.endpoint,
        p256dh: j.keys.p256dh,
        auth: j.keys.auth,
        user_id: uid,
        ua: navigator.userAgent.slice(0, 200),
      }),
    );
  },

  async deletePushSubscription(endpoint) {
    await sb.from('push_subscriptions').delete().eq('endpoint', endpoint);
  },
};
