// Bé ăn chưa? — bản 2.1: Lịch ăn của Ny · Tin nhắn · Chị 🍓 · hồ sơ hai đứa
import { api } from './api.js';
import { CONFIG } from './config.js';
import {
  MEALS, MEAL_BY_KEY, MAIN_MEALS, MOODS, AVATARS,
  mealForTime, mealDay, addDays, daysBetween, fmtDayLong, fmtDmy, relDay, fmtTime, timeAgo,
  monthTitle, addMonths, daysInMonth, weekdayOf, esc, fmtBytes, uuid, computeStreak, loveInfo,
  isIOS, isAndroid, isStandalone, ymd,
  schedMinutes, fmtHM, schedDate, fmtDur, lateInfo, cyclePredict, cycleStatus, cycleDayKinds,
  nextBirthday, ageOf, zodiacOf,
} from './util.js';
import { processFile, processImage } from './media.js';
import { cat, ICONS } from './art.js';
import { meow, unlockSound, soundOn, setSoundOn } from './sound.js';

const app = document.getElementById('app');
const QUICK_OWNER = ['Ăn chưa nè? 🍚', 'Ăn đúng giờ nha ⏰', 'Giỏi quá 👏', 'Nhớ quá à 🥺', 'Thương nhiều 💗'];
const QUICK_NY = ['Ăn rồi nè 😋', 'Đang ăn nè 🍜', 'Tí ăn liền 🥺', 'Nhớ quá à 🥺', 'Thương nhiều 💗'];

// Hồ sơ: các mục để hai đứa hiểu nhau hơn (lưu trong profiles.info)
const INFO_FIELDS = [
  { key: 'foods', icon: '😋', label: 'Món ăn ưa thích', ph: 'vd: bún bò, lẩu thái, bánh tráng trộn…', req: true },
  { key: 'hobbies', icon: '🎨', label: 'Sở thích', ph: 'vd: xem phim, đi cà phê, chụp ảnh…', req: true },
  { key: 'drinks', icon: '🧋', label: 'Thức uống ruột', ph: 'vd: trà sữa trân châu, 50% đường, ít đá' },
  { key: 'dislikes', icon: '🙅', label: 'Món không ăn được / dị ứng', ph: 'vd: hành, sầu riêng, hải sản…' },
  { key: 'comfort', icon: '🫂', label: 'Khi buồn hay dỗi thì cần', ph: 'vd: ôm thật lâu, trà sữa, đi dạo…' },
  { key: 'color', icon: '🎀', label: 'Màu yêu thích', ph: 'vd: hồng pastel' },
  { key: 'flower', icon: '🌷', label: 'Hoa yêu thích', ph: 'vd: hướng dương' },
  { key: 'sizes', icon: '👗', label: 'Size áo · quần · giày', ph: 'vd: áo M, quần 27, giày 37' },
  { key: 'wish', icon: '🌠', label: 'Điều ước nhỏ gần đây', ph: 'vd: một chiếc máy ảnh film' },
];

// Hình nền tin nhắn có sẵn
const BG_PRESETS = [
  { key: 'dots', name: 'Chấm bi' },
  { key: 'paws', name: 'Chân mèo' },
  { key: 'hearts', name: 'Tim hồng' },
  { key: 'straw', name: 'Dâu tây' },
  { key: 'sky', name: 'Mây trời' },
  { key: 'sunset', name: 'Hoàng hôn' },
  { key: 'mint', name: 'Bạc hà' },
  { key: 'night', name: 'Đêm sao', dark: true },
];

// Lời buzz nhắc ăn (n = Ny, o = chủ app, m = tên bữa)
const BUZZ_TEXTS = [
  (n, o, m) => `Tới giờ ${m} rồi ${n} ơi, ăn liền cho ${o} yên tâm nha 🍚`,
  (n, o, m) => `Bíp bíp! ${o} đang đói giùm ${n} nè, ăn ${m} đi rồi chụp hình nha 😿`,
  (n, o, m) => `Mèo được ${o} sai đi nhắc: ${n} ăn ${m} chưa đó? 🐱`,
  (n, o, m) => `Reng reng! Cơm nước gì chưa ${n}? ${o} đang chờ hình ${m} nè 📸`,
];
const buzzCooldown = {};
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const state = {
  uid: null,
  profiles: new Map(),
  settings: null,
  meals: new Map(),
  hearts: new Map(), // mealId -> Map(userId -> reaction)
  heartById: new Map(),
  messages: new Map(),
  cycles: new Map(),
  route: { name: 'day', date: null },
  loadedAt: 0,
  unsubscribe: null,
  installPrompt: null,
  overlay: null, // { kind, pushed, id }
  composer: null,
  viewerDraft: '',
  pushOn: false,
  chatStick: false,
  chatStickUntil: 0,
  cycleMonth: null,
  bgUrl: null, // { path, url } ảnh nền tin nhắn đã ký
};

// ============================================================ khởi động
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  state.installPrompt = e;
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'open' && typeof e.data.url === 'string') {
      const hash = e.data.url.includes('#') ? e.data.url.slice(e.data.url.indexOf('#')) : '#/';
      if (location.hash !== hash) location.hash = hash;
    }
  });
}

document.addEventListener('pointerdown', () => unlockSound(), { passive: true });

boot();

async function boot() {
  if (!api.configured) {
    app.innerHTML = `<div class="center-screen">${cat({ size: 120, mood: 'sleep' })}<h2>App chưa được cấu hình</h2></div>`;
    return;
  }
  let session = null;
  try {
    session = await api.getSession();
  } catch { /* bỏ qua */ }
  api.onAuth((event) => {
    if (event === 'SIGNED_OUT' && state.uid) {
      teardown();
      showAuth('login');
    }
  });
  if (session) enterApp(session);
  else showAuth('login');
}

function teardown() {
  state.unsubscribe?.();
  Object.assign(state, {
    unsubscribe: null, uid: null, profiles: new Map(), meals: new Map(), hearts: new Map(), heartById: new Map(),
    messages: new Map(), cycles: new Map(), settings: null, overlay: null, loadedAt: 0,
  });
}

let entering = null;
function enterApp(session) {
  if (state.uid === session.user.id && state.loadedAt) return Promise.resolve();
  if (!entering) entering = doEnterApp(session).finally(() => { entering = null; });
  return entering;
}

async function doEnterApp(session) {
  state.uid = session.user.id;
  app.innerHTML = `<div class="center-screen">${cat({ size: 110, mood: 'happy', cls: 'bounce' })}<p class="muted">Đang dọn mâm…</p></div>`;
  try {
    await loadData();
  } catch (e) {
    app.innerHTML = `<div class="center-screen">${cat({ size: 110, mood: 'sleep' })}
      <h2>Không tải được dữ liệu 😿</h2><p class="muted">${esc(e.message)}</p>
      <button class="btn primary" data-action="retry">Thử lại</button>
      <button class="btn ghost" data-action="logout">Đăng xuất</button></div>`;
    return;
  }
  if (!state.profiles.has(state.uid)) {
    app.innerHTML = `<div class="center-screen">${cat({ size: 110, mood: 'hungry' })}
      <h2>Tài khoản chưa vào app được</h2><p class="muted">Tài khoản này không nằm trong hai người của app.</p>
      <button class="btn ghost" data-action="logout">Đăng xuất</button></div>`;
    return;
  }
  renderShell();
  state.unsubscribe = api.subscribe(onDbChange);
  onRoute();
  refreshPushState();
  if (!maybeRequireProfile()) maybeWelcome();
}

async function loadData() {
  const d = await api.loadAll();
  state.profiles = new Map(d.profiles.map((p) => [p.id, p]));
  state.settings = d.settings || { app_name: 'Bé ăn chưa?' };
  state.meals = new Map(d.meals.map((m) => [m.id, m]));
  state.hearts = new Map();
  state.heartById = new Map();
  for (const r of d.reactions) addHeartState(r);
  state.messages = new Map((d.messages || []).map((m) => [m.id, m]));
  state.cycles = new Map((d.cycles || []).map((c) => [c.id, c]));
  state.loadedAt = Date.now();
  document.title = state.settings.app_name || 'Bé ăn chưa?';
}

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !state.uid || !state.loadedAt) return;
  markChatRead();
  if (Date.now() - state.loadedAt < 45e3) return;
  try {
    await loadData();
    state.unsubscribe?.();
    state.unsubscribe = api.subscribe(onDbChange);
    scheduleRender();
  } catch { /* lần sau thử lại */ }
});

// Đồng hồ: cập nhật số phút trễ bữa mỗi phút
setInterval(() => {
  if (!state.uid || document.visibilityState !== 'visible') return;
  if (state.route.name === 'day' || state.route.name === 'cycle') scheduleRender();
}, 60e3);

// ============================================================ trạng thái dữ liệu
function addHeartState(r) {
  if (!state.hearts.has(r.meal_id)) state.hearts.set(r.meal_id, new Map());
  state.hearts.get(r.meal_id).set(r.user_id, r);
  if (r.id) state.heartById.set(r.id, r);
}
function removeHeartState(mealId, userId) {
  const m = state.hearts.get(mealId);
  const r = m?.get(userId);
  m?.delete(userId);
  if (r?.id) state.heartById.delete(r.id);
}

function onDbChange(table, p) {
  const n = p.new || {};
  const o = p.old || {};
  if (table === 'meals') {
    if (p.eventType === 'DELETE') {
      state.meals.delete(o.id);
      if (state.overlay?.kind === 'viewer' && state.overlay.id === o.id) closeOverlay();
    } else state.meals.set(n.id, { ...(state.meals.get(n.id) || {}), ...n });
  } else if (table === 'reactions') {
    if (p.eventType === 'DELETE') {
      const r = state.heartById.get(o.id);
      if (r) removeHeartState(r.meal_id, r.user_id);
    } else addHeartState(n);
  } else if (table === 'couple_settings') {
    if (n.id) state.settings = { ...state.settings, ...n };
    document.title = state.settings.app_name || 'Bé ăn chưa?';
    const brand = document.querySelector('.brand-name');
    if (brand) brand.textContent = state.settings.app_name;
  } else if (table === 'profiles') {
    if (n.id) state.profiles.set(n.id, { ...(state.profiles.get(n.id) || {}), ...n });
  } else if (table === 'messages') {
    if (state.route.name === 'chat') state.chatStick = state.chatStick || isNearBottom();
    const fresh = p.eventType === 'INSERT' && n.id && !state.messages.has(n.id);
    if (p.eventType === 'DELETE') state.messages.delete(o.id);
    else if (n.id) state.messages.set(n.id, { ...(state.messages.get(n.id) || {}), ...n });
    refreshBadge();
    if (fresh && n.recipient_id === state.uid && n.sender_id !== state.uid) onIncoming(n);
  } else if (table === 'cycles') {
    if (p.eventType === 'DELETE') state.cycles.delete(o.id);
    else if (n.id) state.cycles.set(n.id, { ...(state.cycles.get(n.id) || {}), ...n });
  }
  scheduleRender();
}

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    if (!state.uid || !document.getElementById('view')) return;
    const active = document.activeElement;
    const typingInView = active && document.getElementById('view').contains(active) && /INPUT|TEXTAREA|SELECT/.test(active.tagName);
    if (!typingInView) renderView();
    if (state.overlay?.kind === 'viewer') renderViewer();
  });
}

// ============================================================ ai là ai
const people = () => [...state.profiles.values()].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
const ownerId = () => people()[0]?.id;
const nyId = () => people()[1]?.id || null;
const owner = () => state.profiles.get(ownerId());
const ny = () => state.profiles.get(nyId());
const isNy = () => !!state.uid && state.uid === nyId();
const me = () => state.profiles.get(state.uid);
const partner = () => [...state.profiles.values()].find((p) => p.id !== state.uid);
const nameOf = (uid) => state.profiles.get(uid)?.display_name || 'Người thương';
const avatarOf = (uid) => state.profiles.get(uid)?.avatar || '🐱';
const nyName = () => ny()?.display_name || 'Ny';
const ownerName = () => owner()?.display_name || 'anh';
const allMeals = () => [...state.meals.values()];
const nyMeals = () => allMeals().filter((m) => m.user_id === nyId());

function nyMealsOn(date, type) {
  return nyMeals()
    .filter((m) => m.meal_date === date && (!type || m.meal_type === type))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** Trạng thái một bữa chính của Ny trong ngày */
function slotStatus(date, type) {
  const list = nyMealsOn(date, type);
  const sched = schedMinutes(state.settings, type);
  if (list.length) {
    const late = Math.round((new Date(list[0].created_at) - schedDate(date, sched)) / 60000);
    return { state: 'done', late, info: lateInfo(late), first: list[0], list, sched };
  }
  // bữa trước lúc Ny vào app thì không tính là bỏ bữa
  const joined = ny()?.created_at ? new Date(ny().created_at) : null;
  if (joined && schedDate(date, sched) < joined) return { state: 'none', list, sched };
  const today = mealDay();
  if (date < today) return { state: 'missed', list, sched };
  if (date > today) return { state: 'future', list, sched };
  const diff = Math.round((Date.now() - schedDate(date, sched)) / 60000);
  if (diff < 0) return { state: 'upcoming', inMin: -diff, list, sched };
  return { state: 'overdue', late: diff, list, sched };
}

const heartCount = (id) => state.hearts.get(id)?.size || 0;
const mealComments = (id) => [...state.messages.values()]
  .filter((m) => m.kind === 'text' && m.meal_id === id)
  .sort((a, b) => a.created_at.localeCompare(b.created_at));
const commentCount = (id) => mealComments(id).length;

// ============================================================ hiệu ứng & ảnh
function toast(msg, kind = 'ok', ms = 2800) {
  let box = document.getElementById('toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    document.body.appendChild(box);
  }
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  box.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, ms);
}

function hearts(x, y, n = 14, chars = ['💗', '💕', '💖', '🐾', '✨']) {
  const layer = document.createElement('div');
  layer.className = 'fx-layer';
  for (let i = 0; i < n; i++) {
    const s = document.createElement('span');
    s.className = 'fx-heart';
    s.textContent = chars[i % chars.length];
    s.style.left = `${x}px`;
    s.style.top = `${y}px`;
    s.style.setProperty('--dx', `${(Math.random() - 0.5) * 220}px`);
    s.style.setProperty('--dy', `${-120 - Math.random() * 220}px`);
    s.style.setProperty('--r', `${(Math.random() - 0.5) * 80}deg`);
    s.style.animationDelay = `${Math.random() * 0.15}s`;
    s.style.fontSize = `${18 + Math.random() * 18}px`;
    layer.appendChild(s);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 1800);
}

/** Gán link ảnh đã ký cho mọi <img|video data-path> chưa có src */
async function hydrateMedia(root = document) {
  const els = [...root.querySelectorAll('[data-path]:not([data-ready])')];
  if (!els.length) return;
  const paths = els.map((el) => el.dataset.path).concat(els.map((el) => el.dataset.poster).filter(Boolean));
  let map;
  try {
    map = await api.signedUrls(paths);
  } catch {
    return;
  }
  for (const el of els) {
    const url = map.get(el.dataset.path);
    if (!url) continue;
    el.dataset.ready = '1';
    if (el.dataset.poster && map.get(el.dataset.poster)) el.poster = map.get(el.dataset.poster);
    if (el.tagName === 'IMG') {
      el.addEventListener('load', () => {
        el.classList.add('loaded');
        if (state.route.name === 'chat' && Date.now() < state.chatStickUntil) scrollChatBottom(true);
      }, { once: true });
    }
    el.src = url;
  }
}

// ============================================================ hồ sơ (dùng chung: đăng ký, bổ sung, cài đặt)
function infoOf(p) {
  return p?.info && typeof p.info === 'object' ? p.info : {};
}

/** Ny bắt buộc có: ngày sinh, món ăn ưa thích, sở thích */
function profileMissing(p) {
  const i = infoOf(p);
  return !p?.birthday || !String(i.foods || '').trim() || !String(i.hobbies || '').trim();
}

function rangeOptions(from, to, current, unit) {
  let html = '';
  for (let v = from; v <= to; v++) html += `<option value="${v}" ${v === current ? 'selected' : ''}>${v} ${unit}</option>`;
  return html;
}

/** Các ô hồ sơ. withPeriod: hỏi thêm kỳ dâu gần nhất (cho Ny) */
function profileFieldsHtml(p, { withPeriod = false, strict = true } = {}) {
  const today = ymd(new Date());
  const info = infoOf(p);
  const req = (on) => (on && strict ? '<em class="req">*</em>' : '<em class="opt">không bắt buộc</em>');
  const s = state.settings || {};
  return `
    <label class="field"><span>🎂 Ngày sinh ${req(true)}</span>
      <input type="date" name="birthday" min="1940-01-01" max="${today}" value="${esc(p?.birthday || '')}"></label>
    ${withPeriod ? `
      <div class="pf-straw">
        <label class="field"><span>🍓 Chị 🍓 ghé lần gần nhất ${req(true)}</span>
          <input type="date" name="period_start" max="${today}" min="${addDays(today, -120)}"></label>
        <p class="hint">Ngày bắt đầu kỳ dâu gần nhất. Không nhớ chính xác thì chọn ngày gần đúng nha.</p>
        <div class="num-grid">
          <label class="field"><span>Thường ở lại</span>
            <select name="period_len">${rangeOptions(3, 8, s.period_length || 5, 'ngày')}</select></label>
          <label class="field"><span>Bao lâu ghé một lần</span>
            <select name="cycle_len"><option value="">Không rõ</option>${rangeOptions(21, 40, s.cycle_length && s.cycle_length !== 28 ? s.cycle_length : 0, 'ngày')}</select></label>
        </div>
      </div>` : ''}
    ${INFO_FIELDS.map((f) => `
      <label class="field"><span>${f.icon} ${f.label} ${req(f.req)}</span>
        <textarea name="info_${f.key}" rows="${f.req ? 2 : 1}" maxlength="300" placeholder="${esc(f.ph)}">${esc(info[f.key] || '')}</textarea></label>`).join('')}`;
}

/** Đọc & kiểm tra các ô hồ sơ trong root. Trả về { error } hoặc { patch, period } */
function readProfileFields(root, { withPeriod = false, strict = true } = {}) {
  const today = ymd(new Date());
  const val = (name) => String(root.querySelector(`[name="${name}"]`)?.value || '').trim();
  const birthday = val('birthday');
  const info = {};
  for (const f of INFO_FIELDS) {
    const v = val(`info_${f.key}`).slice(0, 300);
    if (v) info[f.key] = v;
  }
  if (birthday) {
    const age = ageOf(birthday, today);
    if (age < 10 || age > 90) return { error: 'Ngày sinh chưa đúng lắm, kiểm tra lại nha 🎂' };
  } else if (strict) return { error: 'Cho mèo biết ngày sinh nha 🎂' };
  if (strict && !info.foods) return { error: 'Điền món ăn ưa thích nha 😋' };
  if (strict && !info.hobbies) return { error: 'Điền sở thích nha 🎨' };
  let period = null;
  if (withPeriod) {
    const start = val('period_start');
    if (!start) return { error: 'Chọn ngày chị 🍓 ghé gần nhất nha 🍓' };
    if (start > today) return { error: 'Ngày chị 🍓 ghé không thể ở tương lai nha' };
    if (start < addDays(today, -120)) return { error: 'Chọn kỳ gần nhất trong 4 tháng nay thôi nha' };
    period = { start, len: Number(val('period_len')) || null, cycle: Number(val('cycle_len')) || null };
  }
  return { patch: { birthday: birthday || null, info }, period };
}

/** Lưu kỳ dâu gần nhất + số ngày quen thuộc (lúc đăng ký / bổ sung hồ sơ) */
async function savePeriodInfo(uid, period) {
  if (!period) return;
  const exists = [...state.cycles.values()].some((c) => c.user_id === uid && c.start_date === period.start);
  if (!exists) {
    const c = await api.addCycle(uid, period.start);
    state.cycles.set(c.id, c);
  }
  const patch = {};
  if (period.len) patch.period_length = period.len;
  if (period.cycle) patch.cycle_length = period.cycle;
  if (Object.keys(patch).length) state.settings = await api.updateSettings(patch).catch(() => state.settings);
}

/** Ny chưa đủ hồ sơ -> hiện bảng bắt buộc điền. Trả về true nếu đã hiện */
function maybeRequireProfile() {
  if (!isNy()) return false;
  const needCycle = !nyCycles().length;
  if (!profileMissing(me()) && !needCycle) return false;
  if (/^#\/(p|new|m)\b/.test(location.hash)) history.replaceState(null, '', baseHash());
  openOverlay('gate', `
    <div class="sheet gate-sheet">
      <div class="center">${cat({ size: 84, mood: 'love' })}</div>
      <h3 class="center">Kể mèo nghe về ${esc(me().display_name)} nha 🐾</h3>
      <p class="center muted">Điền xong là vào app liền. Mấy mục có dấu * là bắt buộc.</p>
      <form id="gate-form" novalidate>
        ${profileFieldsHtml(me(), { withPeriod: needCycle })}
        <p class="form-err" id="gate-err" role="alert"></p>
        <button class="btn primary block big-btn" type="submit">Lưu và vào app 💕</button>
      </form>
    </div>`, { locked: true });
  return true;
}

async function submitGate(form) {
  const err = document.getElementById('gate-err');
  const needCycle = !nyCycles().length;
  const r = readProfileFields(form, { withPeriod: needCycle });
  err.textContent = '';
  if (r.error) {
    err.textContent = r.error;
    return;
  }
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const p = await api.updateProfile(state.uid, r.patch);
    state.profiles.set(p.id, { ...me(), ...p });
    await savePeriodInfo(state.uid, r.period);
    state.overlay.locked = false;
    closeOverlayDom();
    hearts(window.innerWidth / 2, window.innerHeight / 2, 18);
    toast('Mèo ghi nhớ hết rồi nè 🐾');
    renderView();
    maybeWelcome();
  } catch (e) {
    err.textContent = e.message;
    btn.disabled = false;
  }
}

// ============================================================ đăng nhập / đăng ký
function showAuth(mode = 'login') {
  const signup = mode === 'signup';
  app.innerHTML = `
  <div class="auth">
    <div class="auth-hero">
      ${cat({ size: 132, mood: 'happy', bowl: true, cls: 'bounce' })}
      <h1>Bé ăn chưa?</h1>
      <p>Nhật ký bữa ăn của hai đứa mình 💕</p>
    </div>
    <div class="card auth-card">
      <div class="seg two">
        <button type="button" class="${signup ? '' : 'on'}" data-auth-mode="login">Đăng nhập</button>
        <button type="button" class="${signup ? 'on' : ''}" data-auth-mode="signup">Tạo tài khoản</button>
      </div>
      <form id="auth-form" novalidate>
        <div class="auth-step" data-step="1">
          ${signup ? `<p class="step-title">Bước 1/2 · Tài khoản</p>` : ''}
          <label class="field"><span>Email</span>
            <input name="email" type="email" inputmode="email" autocomplete="email" placeholder="ban@email.com" required></label>
          <label class="field"><span>Mật khẩu</span>
            <input name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" placeholder="Ít nhất 6 ký tự" minlength="6" required></label>
          ${signup ? `
            <label class="field"><span>Mã mời</span>
              <input name="invite" autocapitalize="characters" autocomplete="off" placeholder="Mã do người tạo app gửi" required></label>` : ''}
        </div>
        ${signup ? `
          <div class="auth-step" data-step="2" hidden>
            <p class="step-title">Bước 2/2 · Kể mèo nghe về bạn 🐾</p>
            <label class="field"><span>Tên gọi của bạn <em class="req">*</em></span>
              <input name="display_name" maxlength="40" placeholder="vd: Bé Heo" required autocomplete="nickname"></label>
            <div class="field"><span>Chọn linh vật</span>
              <div class="avatar-pick small">${AVATARS.map((a, i) => `<button type="button" class="av-opt ${i === 5 ? 'on' : ''}" data-av="${a}">${a}</button>`).join('')}</div>
            </div>
            ${profileFieldsHtml(null, { withPeriod: true })}
          </div>` : ''}
        <p class="form-err" id="auth-err" role="alert"></p>
        ${signup ? `
          <button class="btn primary block" type="button" data-action="signup-next" data-step-btn="1">Tiếp tục →</button>
          <div class="btn-row step-btns" data-step-btn="2" hidden>
            <button class="btn ghost" type="button" data-action="signup-back">← Quay lại</button>
            <button class="btn primary grow" type="submit">Tạo tài khoản 🐾</button>
          </div>` : `<button class="btn primary block" type="submit">Vào thôi 🐾</button>`}
      </form>
    </div>
    <p class="auth-foot">Chỉ hai đứa mình xem được thôi nha 🔒</p>
  </div>`;
}

function signupStep(n) {
  const form = document.getElementById('auth-form');
  if (!form) return;
  form.querySelectorAll('.auth-step').forEach((el) => { el.hidden = el.dataset.step !== String(n); });
  form.querySelectorAll('[data-step-btn]').forEach((el) => { el.hidden = el.dataset.stepBtn !== String(n); });
  document.getElementById('auth-err').textContent = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function checkSignupStep1(form) {
  const fd = new FormData(form);
  const email = String(fd.get('email') || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Email chưa đúng, kiểm tra lại nha';
  if (String(fd.get('password') || '').length < 6) return 'Mật khẩu cần ít nhất 6 ký tự';
  if (!String(fd.get('invite') || '').trim()) return 'Nhập mã mời nha';
  return '';
}

async function submitAuth(form) {
  const fd = new FormData(form);
  const err = document.getElementById('auth-err');
  const btn = form.querySelector('button[type=submit]');
  const signup = fd.has('invite');
  const email = String(fd.get('email') || '').trim();
  const password = String(fd.get('password') || '');
  err.textContent = '';
  if (!email || !password) {
    err.textContent = 'Nhập email và mật khẩu nha';
    return;
  }
  let prof = null;
  if (signup) {
    const e1 = checkSignupStep1(form);
    if (e1) {
      signupStep(1);
      err.textContent = e1;
      return;
    }
    if (!String(fd.get('display_name') || '').trim()) {
      err.textContent = 'Cho mèo biết tên gọi của bạn nha';
      return;
    }
    prof = readProfileFields(form.querySelector('[data-step="2"]'), { withPeriod: true });
    if (prof.error) {
      err.textContent = prof.error;
      return;
    }
  }
  btn.disabled = true;
  btn.classList.add('loading');
  try {
    let session;
    if (signup) {
      session = await api.signUp({
        email,
        password,
        displayName: String(fd.get('display_name')).trim(),
        avatar: form.querySelector('.av-opt.on')?.dataset.av || '🐱',
        inviteCode: String(fd.get('invite') || '').trim(),
      });
      // lưu hồ sơ ngay sau khi có tài khoản (lỗi thì lúc vào app sẽ hỏi lại)
      try {
        await api.updateProfile(session.user.id, prof.patch);
        await savePeriodInfo(session.user.id, prof.period);
      } catch { /* bảng bổ sung hồ sơ sẽ hỏi lại */ }
    } else {
      session = await api.signIn(email, password);
    }
    await enterApp(session);
  } catch (e) {
    err.textContent = e.message;
    if (signup && /mời|email|mật khẩu/i.test(e.message)) signupStep(1);
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
  }
}

// ============================================================ khung chính
function renderShell() {
  app.innerHTML = `
  <header class="topbar">
    <a class="brand" href="#/">${cat({ size: 36, mood: 'happy' })}<span class="brand-name">${esc(state.settings.app_name || 'Bé ăn chưa?')}</span></a>
    <a class="love-chip" href="#/us" id="love-chip" aria-label="Hai đứa mình">${loveChipHtml()}</a>
    <a class="me-chip" href="#/settings" aria-label="Cài đặt"><span class="me-av">${esc(avatarOf(state.uid))}</span><span class="me-gear">${ICONS.gear}</span></a>
  </header>
  <main id="view" class="view"></main>
  <nav class="tabbar three" aria-label="Điều hướng">
    <a href="#/" data-tab="day" class="tab">${ICONS.bowl}<span>Lịch ăn</span></a>
    <a href="#/chat" data-tab="chat" class="tab-center" aria-label="Tin nhắn">
      <span class="tc-bubble">${ICONS.chat}<i class="tab-badge" hidden></i></span><span>Tin nhắn</span>
    </a>
    <a href="#/cycle" data-tab="cycle" class="tab">${ICONS.cycle}<span>Chị 🍓</span></a>
  </nav>
  <div id="chatbar" class="chatbar" hidden>
    <div class="quick" id="quick"></div>
    <form id="chat-form" class="chat-form" autocomplete="off">
      <button type="button" class="attach-btn" data-action="attach" aria-label="Gửi ảnh, video">${ICONS.plus}</button>
      <input id="chat-text" maxlength="2000" placeholder="Nhắn gì đó…" enterkeyhint="send" autocomplete="off">
      <button class="send-btn" type="submit" aria-label="Gửi">${ICONS.send}</button>
    </form>
    <div class="attach-menu" id="attach-menu" hidden>
      <label class="am-item">${ICONS.image}<span>Ảnh / video</span><input type="file" accept="image/*,video/*" data-chat-pick hidden></label>
      <label class="am-item">${ICONS.camera}<span>Chụp / quay</span><input type="file" accept="image/*,video/*" capture="environment" data-chat-pick hidden></label>
      <button type="button" class="am-item ny-only" data-action="chat-report">🍱<span>Báo cáo bữa ăn</span></button>
    </div>
  </div>
  <div id="overlays"></div>`;
  refreshBadge();
}

function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  const [a, b, c] = h.split('/');
  if (a === 'cal') return { name: 'cal', month: /^\d{4}-\d{2}$/.test(b || '') ? b : null };
  if (a === 'us') return { name: 'us' };
  if (a === 'settings') return { name: 'settings' };
  if (a === 'chat') return { name: 'chat' };
  if (a === 'cycle') return { name: 'cycle' };
  if (a === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(b || '')) return { name: 'day', date: b };
  if (a === 'p' && b) return { name: 'post', id: b };
  if (a === 'm' && b) return { name: 'media', id: b };
  if (a === 'new') return { name: 'new', meal: MEAL_BY_KEY[b] ? b : null, date: /^\d{4}-\d{2}-\d{2}$/.test(c || '') ? c : null };
  return { name: 'day', date: null };
}

window.addEventListener('hashchange', () => state.uid && onRoute());

function onRoute() {
  const r = parseRoute();
  const viewEmpty = !document.getElementById('view')?.innerHTML;
  if (r.name === 'post' || r.name === 'media' || r.name === 'new') {
    if (state.overlay?.locked) {
      history.replaceState(null, '', baseHash());
      return;
    }
    if (viewEmpty) renderView();
    if (r.name === 'post') openViewer(r.id);
    else if (r.name === 'media') openMediaViewer(r.id);
    else openComposer(r.meal, r.date);
    return;
  }
  if (state.overlay && !state.overlay.locked) closeOverlayDom();
  const changed = r.name !== state.route.name;
  state.route = r;
  renderView();
  if (changed && r.name !== 'chat') window.scrollTo(0, 0);
}

function tabOf(name) {
  if (name === 'cal' || name === 'us') return 'day';
  return name;
}

function renderView() {
  const view = document.getElementById('view');
  if (!view) return;
  const r = state.route;
  const inChat = r.name === 'chat';
  const wasChat = document.body.classList.contains('in-chat');
  document.body.classList.toggle('in-chat', inChat);
  document.body.classList.toggle('is-ny', isNy());
  const bar = document.getElementById('chatbar');
  if (bar) bar.hidden = !inChat;
  const prevScroll = window.scrollY;
  if (r.name === 'cal') view.innerHTML = viewCalendar();
  else if (r.name === 'us') view.innerHTML = viewUs();
  else if (r.name === 'settings') view.innerHTML = viewSettings();
  else if (r.name === 'cycle') view.innerHTML = viewCycle();
  else if (inChat) view.innerHTML = viewChat();
  else view.innerHTML = viewDay();
  const tab = tabOf(r.name);
  for (const t of document.querySelectorAll('[data-tab]')) t.classList.toggle('on', t.dataset.tab === tab);
  const av = document.querySelector('.me-av');
  if (av) av.textContent = avatarOf(state.uid);
  const chip = document.getElementById('love-chip');
  if (chip) chip.innerHTML = loveChipHtml();
  document.body.classList.toggle('has-chat-bg', inChat && chatBgKey() !== 'dots');
  document.body.classList.toggle('chat-dark', inChat && !!BG_PRESETS.find((b) => b.key === chatBgKey())?.dark);
  hydrateMedia(view);
  if (inChat) hydrateChatBg();
  if (r.name === 'settings' && state.scrollToProfile) {
    state.scrollToProfile = false;
    requestAnimationFrame(() => document.getElementById('pf-settings')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }
  if (inChat) {
    const input = document.getElementById('chat-text');
    const p2 = partner();
    if (input) input.placeholder = p2 ? `Nhắn cho ${p2.display_name}…` : 'Nhắn gì đó…';
    const quick = document.getElementById('quick');
    const replies = isNy() ? QUICK_NY : QUICK_OWNER;
    if (quick && quick.dataset.role !== String(isNy())) {
      quick.dataset.role = String(isNy());
      quick.innerHTML = replies.map((q) => `<button type="button" class="qchip" data-quick="${esc(q)}">${esc(q)}</button>`).join('');
    }
    if (!wasChat || state.chatStick) {
      scrollChatBottom(!wasChat);
      state.chatStickUntil = Date.now() + 2500; // ảnh tải xong vẫn giữ ở cuối
    } else window.scrollTo(0, prevScroll);
    state.chatStick = false;
    markChatRead();
  }
  refreshBadge();
}

// ============================================================ LỊCH ĂN
function waitingCard(text = 'Gửi link app và mã mời cho người ấy để bắt đầu theo dõi giờ ăn nha.') {
  return `
    <div class="card invite-card">
      ${cat({ size: 64, mood: 'hungry' })}
      <div><b>Đang chờ Ny vào app 💌</b>
      <small>${text}</small>
      <button class="btn small primary" data-action="copy-link">Sao chép link app</button></div>
    </div>`;
}

function cyclePill() {
  const pred = cyclePredict([...state.cycles.values()].filter((c) => c.user_id === nyId()), state.settings?.cycle_length, state.settings?.period_length);
  const st = cycleStatus(pred, ymd(new Date()));
  const text = {
    period: `🍓 Chị đang ghé · ngày ${st.day}`,
    pms: `🌋 Còn ${st.toNext} ngày chị 🍓 ghé`,
    due: '📅 Hôm nay chị 🍓 có hẹn',
    late: `⏰ Chị 🍓 trễ ${st.lateBy} ngày`,
    ovulation: '🥚 Ngày rụng trứng',
    fertile: '🌸 Ngày dễ thụ thai',
  }[st.phase];
  return text ? `<a class="pill straw" href="#/cycle">${text}</a>` : '';
}

function slotCardHtml(date, meal, canPost) {
  const st = slotStatus(date, meal.key);
  let chip;
  let cls = '';
  if (st.state === 'done') {
    chip = `<span class="lt ${st.info.cls}">${st.info.icon} ${st.info.text} · ${fmtTime(st.first.created_at)}</span>`;
    if (st.info.cls === 'late2') cls = 'warn';
  } else if (st.state === 'overdue') {
    chip = `<span class="lt red">🚨 Chưa ăn · trễ ${fmtDur(st.late)}</span>`;
    cls = 'alert';
  } else if (st.state === 'missed') {
    chip = `<span class="lt red">😿 Bỏ bữa · không có hình</span>`;
    cls = 'alert';
  } else if (st.state === 'upcoming') {
    chip = `<span class="lt soon">⏳ Còn ${fmtDur(st.inMin)} tới giờ ăn</span>`;
  } else {
    chip = '';
  }
  const cards = st.list.map((m) => postCard(m, meal.key)).join('');
  let body = '';
  if (st.list.length) {
    body = `<div class="post-row">${cards}${canPost ? `<button class="add-card" data-new="${meal.key}" aria-label="Báo cáo thêm">${ICONS.plus}</button>` : ''}</div>`;
  } else if (canPost) {
    body = `<button class="report-btn ${cls === 'alert' ? 'urgent' : ''}" data-new="${meal.key}">📸 Báo cáo ${meal.name.toLowerCase()} cho ${esc(ownerName())}</button>`;
  } else if (st.state === 'overdue') {
    body = `<div class="empty-note red-note">${esc(nyName())} chưa gửi hình ${meal.name.toLowerCase()}</div>`;
  }
  // Chủ app: nút Buzz nhắc Ny bữa này bất cứ lúc nào trong ngày
  if (!isNy() && nyId() && date === mealDay() && (st.state === 'upcoming' || st.state === 'overdue')) {
    body += buzzBlockHtml(meal, st.state === 'overdue');
  }
  return `
    <section class="meal-sec ${cls}" style="--mc: var(--m-${meal.key})">
      <div class="meal-head">
        <span class="meal-ico">${meal.icon}</span>
        <div class="meal-title"><b>${meal.name}</b><small>Giờ ăn ${fmtHM(st.sched)}</small></div>
        ${st.list.length ? `<span class="meal-count">${st.list.length}</span>` : ''}
      </div>
      ${chip ? `<div class="slot-status">${chip}</div>` : ''}
      ${body}
    </section>`;
}

function myBuzzes(date, type) {
  return [...state.messages.values()]
    .filter((m) => m.kind === 'buzz' && m.sender_id === state.uid && m.meal_date === date && m.meal_type === type)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function buzzBlockHtml(meal, hot) {
  const list = myBuzzes(mealDay(), meal.key);
  const last = list[list.length - 1];
  const note = last
    ? `Đã buzz ${list.length} lần · lần cuối ${fmtTime(last.created_at)}${last.pending ? ' (đang gửi…)' : ''}`
    : hot ? `Quá giờ rồi, buzz cho ${esc(nyName())} nhớ ăn đi!` : 'Nhắc trước cho nhớ cũng được nè';
  return `
    <div class="buzz-row">
      <button class="buzz-btn ${hot ? 'hot' : ''}" data-buzz="${meal.key}">🔔 Buzzz ${esc(nyName())}</button>
      <small>${note}</small>
    </div>`;
}

async function sendBuzz(type, btn) {
  if ((buzzCooldown[type] || 0) > Date.now()) {
    toast('Vừa buzz xong, đợi xíu nha 🐱');
    return;
  }
  buzzCooldown[type] = Date.now() + 15000;
  const mi = MEAL_BY_KEY[type];
  btn?.classList.add('ringing');
  navigator.vibrate?.(40);
  await sendChat(pick(BUZZ_TEXTS)(nyName(), ownerName(), mi.name.toLowerCase()), {
    kind: 'buzz', meal_type: type, meal_date: mealDay(),
  });
  toast(`Đã buzz ${nyName()} ${mi.name.toLowerCase()} 🔔`);
}

function snackSectionHtml(date, canPost) {
  const list = nyMeals().filter((m) => m.meal_date === date && (m.meal_type === 'chieu' || m.meal_type === 'khuya'))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (!list.length && !canPost) return '';
  return `
    <section class="meal-sec snack" style="--mc: var(--m-chieu)">
      <div class="meal-head">
        <span class="meal-ico">🧋</span>
        <div class="meal-title"><b>Ăn vặt & ăn khuya</b><small>Không tính giờ</small></div>
        ${list.length ? `<span class="meal-count">${list.length}</span>` : ''}
      </div>
      ${list.length
        ? `<div class="post-row">${list.map((m) => postCard(m, m.meal_type)).join('')}${canPost ? `<button class="add-card" data-new="${mealForTime() === 'khuya' ? 'khuya' : 'chieu'}">${ICONS.plus}</button>` : ''}</div>`
        : `<div class="empty-note">Chưa có món vặt nào ${canPost ? `· <button class="link-btn" data-new="${mealForTime() === 'khuya' ? 'khuya' : 'chieu'}">thêm</button>` : ''}</div>`}
    </section>`;
}

function viewDay() {
  const today = mealDay();
  const date = state.route.date || today;
  const diff = daysBetween(date, today);
  const hasNy = !!nyId();
  const canPost = isNy() && diff >= 0 && diff <= 1;
  const streak = hasNy ? computeStreak(nyMeals(), nyId(), today) : null;

  let summary = '';
  if (hasNy) {
    const sts = MAIN_MEALS.map((k) => slotStatus(date, k));
    const done = sts.filter((s) => s.state === 'done');
    const lateSum = done.filter((s) => s.late > 15 && s.late < 12 * 60).reduce((a, s) => a + s.late, 0);
    const onTime = done.filter((s) => s.late <= 15).length;
    const red = sts.filter((s) => s.state === 'overdue' || s.state === 'missed').length;
    summary = `
      <div class="card sum-card">
        <span class="sum-av">${esc(ny().avatar)}</span>
        <div class="sum-main">
          <b>${esc(nyName())} ${date === today ? 'hôm nay' : relDay(date, today).toLowerCase()}: ${done.length}/3 bữa</b>
          <small>${onTime ? `✅ ${onTime} đúng giờ` : ''}${lateSum ? ` · ⏰ trễ tổng ${fmtDur(lateSum)}` : ''}${red ? ` · <span class="red-text">🚨 ${red} bữa chưa có hình</span>` : ''}${!onTime && !lateSum && !red ? 'Chưa tới giờ ăn nào' : ''}</small>
        </div>
        <span class="sum-dots">${sts.map((s, i) => `<i class="${s.state === 'done' ? s.info.cls : s.state === 'overdue' || s.state === 'missed' ? 'red' : ''}">${MEAL_BY_KEY[MAIN_MEALS[i]].icon}</i>`).join('')}</span>
      </div>`;
  }

  const pills = `
    <div class="pills">
      <a class="pill" href="#/cal/${date.slice(0, 7)}">📅 Cả tháng</a>
      ${streak ? `<a class="pill streak" href="#/us">🔥 Ăn đủ bữa <b>${streak.current}</b> ngày</a>` : ''}
      ${hasNy ? cyclePill() : ''}
    </div>`;

  const meals = MEALS.filter((m) => MAIN_MEALS.includes(m.key));
  return `
    <div class="day-head">
      <button class="icon-btn" data-day="-1" aria-label="Ngày trước">${ICONS.left}</button>
      <a class="day-title" href="#/cal/${date.slice(0, 7)}" aria-label="Xem cả tháng">
        <div class="day-rel">${relDay(date, today)}</div>
        <div class="day-date">${fmtDayLong(date)}</div>
      </a>
      <button class="icon-btn" data-day="1" aria-label="Ngày sau" ${date >= today ? 'disabled' : ''}>${ICONS.right}</button>
    </div>
    ${date !== today ? `<div class="back-today"><a href="#/" class="pill">↩ Về hôm nay</a></div>` : ''}
    ${pills}
    ${hasNy ? '' : waitingCard()}
    ${summary}
    ${hasNy ? meals.map((m) => slotCardHtml(date, m, canPost)).join('') + snackSectionHtml(date, canPost) : ''}
    <div class="bottom-space"></div>`;
}

function postCard(m) {
  const hc = heartCount(m.id);
  const cc = commentCount(m.id);
  const isVideo = m.media_type === 'video';
  const thumb = m.thumb_path || (!isVideo ? m.media_path : null);
  return `
    <button class="post-card" data-open="${m.id}" aria-label="Xem bài lúc ${fmtTime(m.created_at)}">
      <span class="ph">${thumb ? `<img data-path="${esc(thumb)}" alt="" loading="lazy">` : `<span class="ph-video">🎬</span>`}</span>
      ${isVideo ? `<span class="pc-play">${ICONS.play}</span>` : ''}
      ${hc || cc ? `<span class="pc-meta">${hc ? `❤️${hc > 1 ? hc : ''}` : ''}${cc ? ` 💬${cc}` : ''}</span>` : ''}
      <span class="pc-time">${fmtTime(m.created_at)}</span>
      ${m.mood ? `<span class="pc-mood">${esc(m.mood)}</span>` : ''}
    </button>`;
}

// ------------------------------------------------------------ Lịch tháng (bữa ăn của Ny)
function viewCalendar() {
  const today = mealDay();
  const month = state.route.month || today.slice(0, 7);
  const first = `${month}-01`;
  const lead = (weekdayOf(first) + 6) % 7;
  const n = daysInMonth(month);
  let cells = '';
  for (let i = 0; i < lead; i++) cells += `<span class="cell blank"></span>`;
  let full = 0;
  let missed = 0;
  let onTime = 0;
  let doneCount = 0;
  for (let d = 1; d <= n; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    const future = date > today;
    const list = nyMealsOn(date);
    const cover = list.find((m) => m.thumb_path || m.media_type === 'image');
    let dots = '';
    if (!future && nyId()) {
      const sts = MAIN_MEALS.map((k) => slotStatus(date, k));
      dots = sts.filter((s) => s.state !== 'none')
        .map((s) => `<i class="${s.state === 'done' ? (s.late <= 15 ? 'ok' : 'late') : s.state === 'missed' || s.state === 'overdue' ? 'red' : ''}"></i>`).join('');
      const done = sts.filter((s) => s.state === 'done');
      doneCount += done.length;
      onTime += done.filter((s) => s.late <= 15).length;
      missed += sts.filter((s) => s.state === 'missed').length;
      if (done.length === 3) full++;
    }
    cells += `
      <button class="cell ${date === today ? 'today' : ''} ${cover ? 'has-cover' : ''}" ${future ? 'disabled' : ''} data-goday="${date}">
        ${cover ? `<img data-path="${esc(cover.thumb_path || cover.media_path)}" alt="" loading="lazy">` : ''}
        <span class="num">${d}</span>
        <span class="dots">${dots}</span>
      </button>`;
  }
  const nextDisabled = month >= today.slice(0, 7);
  const rate = doneCount ? Math.round((onTime / doneCount) * 100) : 0;
  return `
    <div class="cal-head">
      <button class="icon-btn" data-month="${addMonths(month, -1)}" aria-label="Tháng trước">${ICONS.left}</button>
      <h2>${monthTitle(month)}</h2>
      <button class="icon-btn" data-month="${addMonths(month, 1)}" aria-label="Tháng sau" ${nextDisabled ? 'disabled' : ''}>${ICONS.right}</button>
    </div>
    <div class="card cal-card">
      <div class="cal-grid wk">${['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((w) => `<span>${w}</span>`).join('')}</div>
      <div class="cal-grid">${cells}</div>
      <div class="cal-legend"><span><i class="ok"></i> đúng giờ</span><span><i class="late"></i> trễ</span><span><i class="red"></i> bỏ bữa</span></div>
    </div>
    ${nyId() ? `<div class="card stats-card"><h3>${esc(nyName())} tháng này</h3>
      <div class="stat-grid">
        <div><b>${full}</b><small>ngày ăn đủ 3 bữa</small></div>
        <div><b>${rate}%</b><small>bữa đúng giờ</small></div>
        <div class="${missed ? 'red-text' : ''}"><b>${missed}</b><small>bữa bỏ</small></div>
      </div></div>` : ''}
    <div class="bottom-space"></div>`;
}

// ------------------------------------------------------------ Hai đứa
function loveChipHtml() {
  const love = loveInfo(state.settings?.start_date);
  if (!love) return '💞 <span>Ngày yêu?</span>';
  return `💞 <b>${love.future ? 0 : love.days}</b><span> ngày</span>`;
}

function profileCardHtml(p, role) {
  if (!p) return '';
  const today = ymd(new Date());
  const info = infoOf(p);
  const mine = p.id === state.uid;
  let bday = '';
  if (p.birthday) {
    const nb = nextBirthday(p.birthday, today);
    const z = zodiacOf(p.birthday);
    const when = nb.daysTo === 0 ? '<b class="hl">Hôm nay! 🎉</b>' : nb.daysTo === 1 ? '<b class="hl">Ngày mai! 🎁</b>' : `còn <b>${nb.daysTo}</b> ngày`;
    bday = `
      <div class="pc-bday">
        <span>🎂 ${fmtDmy(p.birthday)} · ${ageOf(p.birthday, today)} tuổi</span>
        <span>🎁 Sinh nhật ${when}</span>
        <span>${z.icon} Cung ${z.name}</span>
      </div>`;
  }
  const rows = INFO_FIELDS.filter((f) => info[f.key]).map((f) => `
    <div class="pc-row"><span class="pc-ico">${f.icon}</span><div><small>${f.label}</small><p>${esc(info[f.key])}</p></div></div>`).join('');
  const missing = profileMissing(p);
  return `
    <div class="card profile-card">
      <div class="pc-head">
        <span class="pc-av">${esc(p.avatar)}</span>
        <div class="pc-name"><b>${esc(p.display_name)}</b><small>${role}</small></div>
        ${mine ? `<a class="btn small ghost" href="#/settings" data-goto-profile>✏️ Sửa</a>` : ''}
      </div>
      ${bday}
      ${rows ? `<div class="pc-rows">${rows}</div>` : ''}
      ${missing ? `<p class="pc-empty">${mine ? 'Điền ngày sinh, món ruột, sở thích… để người ấy hiểu mình hơn nha 🐾' : `${esc(p.display_name)} chưa điền hồ sơ 🙈`}</p>` : ''}
    </div>`;
}

function viewUs() {
  const today = mealDay();
  const love = loveInfo(state.settings?.start_date);
  const ps = people();
  let loveCard;
  if (!love) {
    loveCard = `
      <div class="card love-card empty">
        ${cat({ size: 80, mood: 'love' })}
        <h3>Hai đứa yêu nhau từ ngày nào?</h3>
        <p class="muted">Nhập ngày để mèo đếm ngày bên nhau nha</p>
        <label class="field inline"><input type="date" id="start-date-quick" max="${today}"></label>
        <button class="btn primary" data-action="save-start-quick">Lưu ngày 💘</button>
      </div>`;
  } else {
    const avs = ps.map((p) => `<span class="love-av">${esc(p.avatar)}</span>`).join(`<span class="love-heart">💗</span>`);
    let extra = '';
    if (love.todayIsAnniv) extra = `<p class="hl">🎉 Hôm nay là kỷ niệm ${love.yearsNow} năm! Chúc mừng hai đứa 💍</p>`;
    else if (love.isMilestone) extra = `<p class="hl">🎉 Hôm nay tròn ${love.days} ngày! Đi ăn gì ngon đi 🥂</p>`;
    loveCard = `
      <div class="card love-card">
        <div class="love-avs">${avs}</div>
        <div class="love-label">Đã bên nhau</div>
        <div class="love-days">${love.future ? 0 : love.days}</div>
        <div class="love-unit">ngày · từ ${fmtDmy(state.settings.start_date)}</div>
        ${extra}
        ${!love.future ? `<div class="love-next">
          <span>⏳ Còn <b>${love.daysTo100}</b> ngày nữa là tròn <b>${love.next100}</b> ngày</span>
          <span>💍 Còn <b>${love.daysToAnniv}</b> ngày nữa là kỷ niệm <b>${love.nextAnnivYears}</b> năm</span>
        </div>` : ''}
      </div>`;
  }
  let nyCard = '';
  if (nyId()) {
    const st = computeStreak(nyMeals(), nyId(), today);
    const total = nyMeals();
    nyCard = `
      <div class="card streak-card wide">
        <div class="sc-top"><span class="sc-av">${esc(ny().avatar)}</span><b>${esc(nyName())}</b></div>
        <div class="sc-fire">${ICONS.fire}<span><b>${st.current}</b> ngày ăn đủ bữa liên tiếp</span></div>
        <small>kỷ lục: ${st.best} ngày · tổng ${total.length} lần báo cáo</small>
      </div>`;
  }
  const loved = nyMeals().filter((m) => heartCount(m.id) + commentCount(m.id) > 0)
    .sort((a, b) => (heartCount(b.id) * 2 + commentCount(b.id)) - (heartCount(a.id) * 2 + commentCount(a.id)) || b.created_at.localeCompare(a.created_at))
    .slice(0, 6);
  return `
    <h2 class="page-title"><a href="#/" class="back-link">${ICONS.left}</a> Hai đứa mình 💞</h2>
    ${loveCard}
    ${nyId() ? profileCardHtml(ny(), '🐷 Ny của app') : ''}
    ${profileCardHtml(owner(), '👑 Chủ app')}
    ${nyCard}
    ${loved.length ? `<div class="card"><h3>Được thương nhiều nhất 💗</h3><div class="post-row wrap">${loved.map((m) => postCard(m)).join('')}</div></div>` : ''}
    <div class="bottom-space"></div>`;
}

// ============================================================ CHỊ 🍓
function nyCycles() {
  return [...state.cycles.values()].filter((c) => c.user_id === nyId()).sort((a, b) => a.start_date.localeCompare(b.start_date));
}

function cyclePred() {
  return cyclePredict(nyCycles(), state.settings?.cycle_length || 28, state.settings?.period_length || 5);
}

function viewCycle() {
  if (!nyId()) {
    return `<h2 class="page-title">Chị 🍓</h2>${waitingCard('Khi Ny vào app, hai đứa cùng theo dõi chị 🍓 ở đây: ngày tới, ngày đi, ngày dự kiến và những bản tin vui vui 🍓')}<div class="bottom-space"></div>`;
  }
  const today = ymd(new Date());
  const pred = cyclePred();
  const st = cycleStatus(pred, today);
  const N = esc(nyName());
  const O = esc(ownerName());
  let hero;
  if (st.phase === 'nodata') {
    hero = `
      <div class="straw-emoji">🍓</div>
      <h3>Chị 🍓 ghé lần gần nhất ngày nào?</h3>
      <p>Nhập ngày bắt đầu kỳ gần nhất, mèo sẽ đoán các ngày tiếp theo cho hai đứa.</p>
      <label class="field inline"><input type="date" id="first-start" max="${today}" value="${today}"></label>
      <button class="btn primary" data-action="cycle-first">Lưu ngày 🍓</button>`;
  } else if (st.phase === 'period') {
    hero = `
      <div class="straw-emoji wobble">🍓</div>
      <h3>Chị 🍓 đang ghé thăm</h3>
      <div class="big-num">Ngày ${st.day}</div>
      <p>${isNy() ? 'Uống nước ấm, nghỉ ngơi nhiều nha 💗' : `Chế độ chiều chuộng ${N}: BẬT 🫶`}</p>
      ${st.ongoing ? `<button class="btn primary" data-action="cycle-end">✅ Chị đi rồi</button>` : `<p class="muted small">Đã ghi nhận chị đi ngày ${fmtDmy(pred.last.end_date)}</p>`}`;
  } else {
    const big = st.phase === 'late' ? `Trễ ${st.lateBy} ngày` : st.phase === 'due' ? 'Hôm nay' : `Còn ${st.toNext} ngày`;
    const sub = {
      late: `Chị 🍓 trễ hẹn rồi. Tới thì bấm báo mèo nha 🐱`,
      due: `Theo lịch hôm nay chị 🍓 ghé. ${isNy() ? 'Tới thì bấm nút dưới nha' : `${O} nói chuyện nhỏ nhẹ nha 🙏`}`,
      pms: isNy() ? 'Đang vào mùa dễ nóng tính, được quyền dỗi vô cớ 😤' : `🚨 Mùa nóng tính sắp tới. ${O} nhường nhịn tối đa nha 🧋`,
      ovulation: 'Hôm nay là ngày rụng trứng (dự đoán) 🥚',
      fertile: 'Đang trong những ngày dễ thụ thai (dự đoán) 🌸',
      normal: 'Mọi thứ bình yên, ăn uống đầy đủ nha 🌿',
    }[st.phase];
    hero = `
      <div class="straw-emoji ${st.phase === 'pms' || st.phase === 'due' ? 'wobble' : ''}">${{ pms: '🌋', due: '📅', late: '⏰', ovulation: '🥚', fertile: '🌸' }[st.phase] || '🍓'}</div>
      <h3>${st.phase === 'late' ? 'Chị 🍓 trễ hẹn' : 'Chị 🍓 ghé lần tới'}</h3>
      <div class="big-num">${big}</div>
      <p>Dự kiến ${fmtDmy(pred.nextStart)} · ${sub}</p>
      <button class="btn primary" data-action="cycle-start">🍓 Chị tới rồi</button>`;
  }

  let upcoming = '';
  if (pred) {
    const nextF = pred.future.find((f) => f.fertileEnd >= today) || pred.future[0];
    const nextP = pred.future.find((f) => f.start >= today || (st.phase === 'late' && f === pred.future[0])) || pred.future[0];
    const rows = [
      { icon: '🌋', label: 'Mùa dễ nóng tính', from: nextP.pmsStart, to: addDays(nextP.start, -1) },
      { icon: '🍓', label: 'Chị 🍓 dự kiến ghé', from: nextP.start, to: nextP.end },
      { icon: '🌸', label: 'Ngày dễ thụ thai', from: nextF.fertileStart, to: nextF.fertileEnd },
      { icon: '🥚', label: 'Ngày rụng trứng', from: nextF.ovulation, to: null },
    ].sort((a, b) => a.from.localeCompare(b.from));
    upcoming = `
      <div class="card">
        <h3>Sắp tới</h3>
        <div class="ms-list">
          ${rows.map((r) => {
            const dd = daysBetween(today, r.from);
            const when = dd > 0 ? `còn ${dd} ngày` : dd === 0 ? 'hôm nay' : r.to && r.to >= today ? 'đang diễn ra' : `${-dd} ngày trước`;
            return `<div class="ms-row"><span class="ms-ico">${r.icon}</span><div><b>${r.label}</b><small>${fmtDmy(r.from).slice(0, 5)}${r.to ? ` – ${fmtDmy(r.to).slice(0, 5)}` : ''}</small></div><span class="ms-when">${when}</span></div>`;
          }).join('')}
        </div>
        <p class="hint">Chu kỳ trung bình ${pred.avgCycle} ngày · hành kinh ~${pred.avgPeriod} ngày${pred.samples ? ` (tính từ ${pred.samples} kỳ gần nhất)` : ' (chưa đủ dữ liệu, đang dùng số mặc định)'}.</p>
      </div>`;
  }

  // lịch tháng
  const month = state.cycleMonth || today.slice(0, 7);
  const lead = (weekdayOf(`${month}-01`) + 6) % 7;
  let cells = '';
  for (let i = 0; i < lead; i++) cells += `<span class="cell blank"></span>`;
  for (let d = 1; d <= daysInMonth(month); d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    const kinds = cycleDayKinds(date, pred, today);
    const icon = kinds.has('ovulation') ? '🥚' : kinds.has('period') ? '🍓' : '';
    cells += `<button class="ccell ${[...kinds].join(' ')} ${date === today ? 'today' : ''}" data-cycday="${date}"><span>${d}</span>${icon ? `<i>${icon}</i>` : ''}</button>`;
  }
  const calendar = `
    <div class="card cyc-cal">
      <div class="cal-head inner">
        <button class="icon-btn" data-cmonth="${addMonths(month, -1)}" aria-label="Tháng trước">${ICONS.left}</button>
        <h3>${monthTitle(month)}</h3>
        <button class="icon-btn" data-cmonth="${addMonths(month, 1)}" aria-label="Tháng sau">${ICONS.right}</button>
      </div>
      <div class="cal-grid wk">${['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((w) => `<span>${w}</span>`).join('')}</div>
      <div class="cal-grid">${cells}</div>
      <div class="cyc-legend">
        <span><i class="period"></i>Chị 🍓</span><span><i class="period-pred"></i>Dự kiến</span>
        <span><i class="fertile"></i>Dễ thụ thai</span><span><i class="ovulation"></i>Rụng trứng</span><span><i class="pms"></i>Dễ nóng tính</span>
      </div>
      <p class="hint center">Chạm vào một ngày để đánh dấu chị tới / chị đi</p>
    </div>`;

  const list = nyCycles().slice().reverse();
  const history = list.length ? `
    <div class="card">
      <h3>Lịch sử</h3>
      ${list.map((c, i) => {
        const older = list[i + 1];
        const len = c.end_date ? daysBetween(c.start_date, c.end_date) + 1 : null;
        const cyc = older ? daysBetween(older.start_date, c.start_date) : null;
        return `<div class="hist-row"><span>🍓</span><div><b>${fmtDmy(c.start_date)}${c.end_date ? ` → ${fmtDmy(c.end_date).slice(0, 5)}` : ' → đang ghé'}</b>
          <small>${len ? `${len} ngày` : ''}${len && cyc ? ' · ' : ''}${cyc ? `chu kỳ ${cyc} ngày` : ''}</small></div>
          <button class="icon-btn small" data-delcycle="${c.id}" aria-label="Xoá">${ICONS.trash}</button></div>`;
      }).join('')}
    </div>` : '';

  const s = state.settings || {};
  const settings = `
    <div class="card form-card">
      <h3>⚙️ Cài đặt chị 🍓</h3>
      <div class="num-grid">
        <label class="field"><span>Chu kỳ mặc định (ngày)</span><input type="number" id="cyc-len" min="18" max="60" value="${s.cycle_length || 28}"></label>
        <label class="field"><span>Số ngày hành kinh</span><input type="number" id="per-len" min="2" max="12" value="${s.period_length || 5}"></label>
      </div>
      <label class="switch-row"><span>Bản tin chị 🍓 cho cả hai (8h sáng)</span>
        <input type="checkbox" id="cyc-notify" ${s.cycle_notify !== false ? 'checked' : ''}><i class="switch"></i></label>
      <button class="btn primary" data-action="save-cycle-settings">Lưu</button>
      <p class="hint">Mèo đoán ngày dựa trên các kỳ đã ghi, chỉ để tham khảo cho vui và nhắc nhau quan tâm, <b>không dùng để tránh thai</b>.</p>
    </div>`;

  return `
    <h2 class="page-title">Chị 🍓 của ${N}</h2>
    <div class="card straw-hero phase-${st.phase}">${hero}</div>
    ${upcoming}
    ${calendar}
    ${history}
    ${settings}
    <div class="bottom-space"></div>`;
}

function openCycleSheet(kind, date) {
  const today = ymd(new Date());
  const pred = cyclePred();
  const last = pred?.last;
  let title;
  let options = [];
  if (kind === 'start') {
    title = '🍓 Chị tới ngày nào?';
    options = [0, 1, 2].map((n) => ({ label: n === 0 ? 'Hôm nay' : n === 1 ? 'Hôm qua' : 'Hôm kia', action: 'start', date: addDays(today, -n) }));
  } else if (kind === 'end') {
    title = '✅ Chị đi ngày nào?';
    options = [0, 1, 2].map((n) => ({ label: n === 0 ? 'Hôm nay' : n === 1 ? 'Hôm qua' : 'Hôm kia', action: 'end', date: addDays(today, -n) }))
      .filter((o) => last && o.date >= last.start_date);
  } else {
    title = `Ngày ${fmtDmy(date)}`;
    const dm = fmtDmy(date).slice(0, 5);
    const cyc = nyCycles();
    const inCycle = cyc.find((c) => date >= c.start_date && date <= (c.end_date || addDays(c.start_date, 11)));
    const soonAfter = cyc.find((c) => c.start_date > date && daysBetween(date, c.start_date) <= 10);
    if (date > today) {
      options.push({ label: 'Ngày này chưa tới, chưa đánh dấu được 🙈', action: 'none' });
    } else if (inCycle) {
      if (date !== inCycle.start_date) options.push({ label: `✏️ Đổi ngày chị tới thành ${dm}`, action: 'move-start', date, id: inCycle.id });
      if (inCycle.end_date !== date) {
        options.push({ label: inCycle.end_date ? `✏️ Đổi ngày chị đi thành ${dm}` : `✅ Chị đi ngày ${dm}`, action: 'end-of', date, id: inCycle.id });
      }
      options.push({ label: '🗑️ Xoá kỳ này', action: 'delete', id: inCycle.id, danger: true });
    } else if (soonAfter) {
      options.push({ label: `✏️ Dời ngày chị tới từ ${fmtDmy(soonAfter.start_date).slice(0, 5)} về ${dm}`, action: 'move-start', date, id: soonAfter.id });
    } else {
      options.push({ label: `🍓 Chị tới ngày ${dm}`, action: 'start', date });
    }
  }
  openOverlay('info', `
    <div class="sheet cyc-sheet">
      <div class="grab"></div>
      <h3>${title}</h3>
      <div class="opt-list">
        ${options.map((o) => `<button class="btn ${o.danger ? 'ghost danger' : o.action === 'none' ? 'ghost' : 'primary'} block" data-cyc="${o.action}" data-date="${o.date || ''}" data-id="${o.id || ''}">${o.label}</button>`).join('')}
        ${kind !== 'day' ? `<label class="field"><span>Hoặc chọn ngày khác</span><input type="date" id="cyc-other" max="${today}"></label>
          <button class="btn ghost block" data-cyc="${kind}-other">Lưu ngày đã chọn</button>` : ''}
      </div>
    </div>`);
}

async function doCycleAction(action, date, id) {
  try {
    const pred = cyclePred();
    if (action === 'start') {
      if (nyCycles().some((c) => c.start_date === date)) throw new Error('Ngày này đã được đánh dấu rồi');
      const prevOpen = pred?.last && !pred.last.end_date && date > pred.last.start_date ? pred.last : null;
      if (prevOpen && daysBetween(prevOpen.start_date, date) < 12) throw new Error('Kỳ trước chưa kết thúc. Bấm "Chị đi rồi" trước nha');
      const c = await api.addCycle(nyId(), date);
      state.cycles.set(c.id, c);
      hearts(window.innerWidth / 2, window.innerHeight / 2, 12, ['🍓', '💗', '🫶']);
      toast(isNy() ? 'Mèo ghi sổ rồi, nghỉ ngơi nha 💗' : `Đã ghi chị 🍓 tới cho ${nyName()} 🍓`);
    } else if (action === 'end' || action === 'end-of') {
      const target = action === 'end-of' ? state.cycles.get(id) : pred?.last;
      if (!target) throw new Error('Chưa có kỳ nào để kết thúc');
      if (date < target.start_date) throw new Error('Ngày chị đi phải sau ngày chị tới');
      if (daysBetween(target.start_date, date) > 14) throw new Error('Kỳ này dài quá 15 ngày, kiểm tra lại ngày nha');
      const wasOpen = !target.end_date;
      const c = await api.updateCycle(target.id, { end_date: date });
      state.cycles.set(c.id, { ...target, ...c });
      if (wasOpen) {
        hearts(window.innerWidth / 2, window.innerHeight / 2, 14, ['🎉', '💗', '✨']);
        toast('Chị 🍓 về rồi! 🎉');
      } else toast('Đã sửa ngày ✏️');
    } else if (action === 'move-start') {
      const target = state.cycles.get(id);
      if (!target) throw new Error('Không tìm thấy kỳ này');
      if (target.end_date && date > target.end_date) throw new Error('Ngày chị tới phải trước ngày chị đi');
      const c = await api.updateCycle(target.id, { start_date: date });
      state.cycles.set(c.id, { ...target, ...c });
      toast('Đã sửa ngày ✏️');
    } else if (action === 'delete') {
      if (!confirm('Xoá kỳ này khỏi lịch sử nha?')) return;
      await api.deleteCycle(id);
      state.cycles.delete(id);
      toast('Đã xoá');
    } else {
      return;
    }
    closeOverlay();
    renderView();
  } catch (e) {
    const msg = /duplicate|unique/i.test(e.message) ? 'Ngày này đã được đánh dấu rồi' : e.message;
    toast(msg, 'error', 3800);
  }
}

// ============================================================ TIN NHẮN
function unreadCount() {
  let n = 0;
  for (const m of state.messages.values()) if (m.recipient_id === state.uid && !m.read_at) n++;
  return n;
}

function refreshBadge() {
  const n = unreadCount();
  const b = document.querySelector('.tab-badge');
  if (b) {
    b.hidden = !n;
    b.textContent = n > 9 ? '9+' : String(n);
  }
  try {
    if (n) navigator.setAppBadge?.(n)?.catch?.(() => {});
    else navigator.clearAppBadge?.()?.catch?.(() => {});
  } catch { /* bỏ qua */ }
}

function isNearBottom() {
  return window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 180;
}

function scrollChatBottom(instant) {
  requestAnimationFrame(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: instant ? 'auto' : 'smooth' });
  });
}

const pendingRead = new Set();
let readTimer = null;
function markChatRead() {
  if (document.visibilityState !== 'visible' || state.route.name !== 'chat') return;
  const now = new Date().toISOString();
  for (const m of state.messages.values()) {
    if (m.recipient_id === state.uid && !m.read_at) {
      m.read_at = now;
      pendingRead.add(m.id);
    }
  }
  if (!pendingRead.size) return;
  refreshBadge();
  clearTimeout(readTimer);
  readTimer = setTimeout(() => {
    const ids = [...pendingRead];
    pendingRead.clear();
    api.markRead(ids).catch(() => {});
  }, 400);
}

function chatDayLabel(day) {
  const diff = daysBetween(day, ymd(new Date()));
  if (diff === 0) return 'Hôm nay';
  if (diff === 1) return 'Hôm qua';
  return fmtDayLong(day);
}

function isEmojiOnly(text) {
  const t = String(text || '').trim();
  return !!t && [...t].length <= 6 && /\p{Extended_Pictographic}/u.test(t) &&
    /^(\p{Extended_Pictographic}|\p{Emoji_Component}|️|‍|\s)+$/u.test(t);
}

function mealQuote(mealId) {
  const meal = state.meals.get(mealId);
  if (!meal) return `<span class="quote gone">📸 Ảnh bữa ăn đã bị xoá</span>`;
  const mi = MEAL_BY_KEY[meal.meal_type] || MEALS[0];
  const thumb = meal.thumb_path || (meal.media_type === 'image' ? meal.media_path : null);
  return `<span class="quote" data-open="${meal.id}">
      <span class="q-ph">${thumb ? `<img data-path="${esc(thumb)}" alt="">` : '🎬'}</span>
      <span class="q-txt"><b>${mi.icon} ${mi.name}</b><small>${fmtTime(meal.created_at)} · ${relDay(meal.meal_date)}</small></span>
    </span>`;
}

function reminderHtml(m) {
  const mi = MEAL_BY_KEY[m.meal_type] || MEALS[0];
  const forMe = m.recipient_id === state.uid;
  const who = nameOf(m.recipient_id);
  const meal = m.meal_id ? state.meals.get(m.meal_id) : null;
  const diff = m.meal_date ? daysBetween(m.meal_date, mealDay()) : 99;
  const canReport = forMe && !m.meal_id && diff >= 0 && diff <= 1;
  const urgent = /🚨/.test(m.body || '');
  let action;
  if (m.meal_id) {
    action = `<div class="rc-done">✅ ${forMe ? 'Đã báo cáo' : `${esc(who)} đã báo cáo`}${meal ? ` · <button class="link-btn" data-open="${meal.id}">Xem hình</button>` : ''}</div>`;
  } else if (canReport) {
    action = `<button class="btn primary rc-btn" data-report="${m.meal_type}|${m.meal_date}">📸 Gửi báo cáo cho ${esc(nameOf(ownerId()))}</button>`;
  } else if (forMe) {
    action = `<div class="rc-note">Đã qua giờ báo cáo rồi 🥲</div>`;
  } else if (diff >= 1) {
    action = `<div class="rc-note red-text">😿 ${esc(who)} không gửi hình bữa này</div>`;
  } else {
    action = `<div class="rc-note">⏳ Đang chờ ${esc(who)} báo cáo…</div>`;
  }
  return `
    <div class="remind-card ${m.meal_id ? 'done' : ''} ${urgent && !m.meal_id ? 'urgent' : ''}">
      <div class="rc-top">${cat({ size: 34, mood: m.meal_id ? 'happy' : 'hungry' })}<span>Mèo nhắc ${forMe ? 'bạn' : esc(who)} · ${fmtTime(m.created_at)}</span></div>
      <p>${mi.icon} ${esc(m.body || `Tới giờ ${mi.name.toLowerCase()} rồi nè!`)}</p>
      ${action}
    </div>`;
}

function cycleCardHtml(m) {
  let d = null;
  try { d = JSON.parse(m.body); } catch { /* chữ thường */ }
  if (!d) return `<div class="cycle-card"><p>${esc(m.body)}</p></div>`;
  const mine = isNy() ? d.ny : d.owner;
  const other = isNy() ? d.owner : d.ny;
  return `
    <a class="cycle-card" href="#/cycle">
      <div class="cy-top"><span class="cy-icon">🍓</span><b>${esc(d.title)}</b><time>${fmtTime(m.created_at)}</time></div>
      <p class="cy-mine">${esc(mine)}</p>
      <p class="cy-other"><span>${isNy() ? esc(avatarOf(ownerId())) : esc(avatarOf(nyId()))}</span>${esc(other)}</p>
    </a>`;
}

function eventCardHtml(m) {
  let d = null;
  try { d = JSON.parse(m.body); } catch { /* chữ thường */ }
  if (!d) return `<div class="cycle-card event-card"><p>${esc(m.body)}</p></div>`;
  const mine = isNy() ? d.ny : d.owner;
  const icon = { birthday: '🎂', love100: '💞', anniv: '💍' }[d.event] || '🎉';
  return `
    <a class="cycle-card event-card" href="#/us">
      <div class="cy-top"><span class="cy-icon">${icon}</span><b>${esc(d.title)}</b><time>${fmtTime(m.created_at)}</time></div>
      <p class="cy-mine">${esc(mine)}</p>
    </a>`;
}

function buzzHtml(m) {
  const mi = MEAL_BY_KEY[m.meal_type] || MEALS[0];
  const forMe = m.recipient_id === state.uid;
  const reported = m.meal_date && m.meal_type ? nyMealsOn(m.meal_date, m.meal_type)[0] : null;
  const diff = m.meal_date ? daysBetween(m.meal_date, mealDay()) : 99;
  let action;
  if (reported) {
    action = `<div class="rc-done">✅ ${forMe ? 'Đã báo cáo' : `${esc(nyName())} đã báo cáo`} lúc ${fmtTime(reported.created_at)} · <button class="link-btn" data-open="${reported.id}">Xem hình</button></div>`;
  } else if (forMe && diff >= 0 && diff <= 1) {
    action = `<button class="btn primary rc-btn" data-report="${m.meal_type}|${m.meal_date}">📸 Báo cáo ${mi.name.toLowerCase()} ngay</button>`;
  } else if (!forMe && diff === 0) {
    action = `<div class="rc-note">⏳ Chưa thấy hình ${mi.name.toLowerCase()}…</div>`;
  } else {
    action = `<div class="rc-note">${forMe ? 'Bữa này qua rồi 🥲' : '😿 Bữa này không có hình'}</div>`;
  }
  return `
    <div class="buzz-card ${m.pending ? 'pending' : ''}">
      <div class="bz-top"><span class="bz-bell">🔔</span><b>Buzzz!</b><span class="bz-from">${esc(avatarOf(m.sender_id))} ${forMe ? esc(nameOf(m.sender_id)) : 'Bạn'} · ${fmtTime(m.created_at)}</span></div>
      <p>${mi.icon} ${esc(m.body || '')}</p>
      ${action}
    </div>`;
}

function msgHtml(m, grouped) {
  if (m.kind === 'reminder') return reminderHtml(m);
  if (m.kind === 'cycle') return cycleCardHtml(m);
  if (m.kind === 'event') return eventCardHtml(m);
  if (m.kind === 'buzz') return buzzHtml(m);
  const mine = m.sender_id === state.uid;
  const time = fmtTime(m.created_at);
  if (m.kind === 'heart') {
    if (!state.hearts.get(m.meal_id)?.has(m.sender_id)) return '';
    const mi = MEAL_BY_KEY[m.meal_type] || MEALS[0];
    return `<div class="heart-note" data-open="${m.meal_id}">💗 ${esc(mine ? 'Bạn' : nameOf(m.sender_id))} thả tim ${mi.name.toLowerCase()} ${mi.icon} <time>${time}</time></div>`;
  }
  const av = mine ? '' : `<span class="msg-av">${grouped ? '' : esc(avatarOf(m.sender_id))}</span>`;
  if (m.kind === 'report') {
    const mi = MEAL_BY_KEY[m.meal_type] || MEALS[0];
    const meal = m.meal_id ? state.meals.get(m.meal_id) : null;
    if (!meal) return ''; // bài đã bị xoá thì ẩn luôn thẻ báo cáo
    const thumb = meal ? meal.thumb_path || (meal.media_type === 'image' ? meal.media_path : null) : null;
    let late = '';
    const sched = schedMinutes(state.settings, m.meal_type);
    if (meal && sched != null) {
      const li = lateInfo(Math.round((new Date(meal.created_at) - schedDate(meal.meal_date, sched)) / 60000));
      late = `<span class="lt ${li.cls}">${li.icon} ${li.text}</span>`;
    }
    const hc = heartCount(meal.id);
    const cc = commentCount(meal.id);
    const inner = `<button class="report-card" data-open="${meal.id}">
           <span class="rp-ph">${thumb ? `<img data-path="${esc(thumb)}" alt="">` : '<span class="ph-video">🎬</span>'}${meal.media_type === 'video' ? `<span class="pc-play">${ICONS.play}</span>` : ''}</span>
           <span class="rp-text"><b>📸 Báo cáo ${mi.name.toLowerCase()} ${mi.icon}</b>${late}${m.body ? `<span class="rp-cap">${esc(m.body)}</span>` : ''}<time>${time}${hc ? ` · ❤️${hc > 1 ? hc : ''}` : ''}${cc ? ` · 💬${cc}` : ''}</time></span>
         </button>`;
    return `<div class="msg ${mine ? 'mine' : ''}">${av}${inner}</div>`;
  }
  // tin nhắn thường (có thể kèm ảnh/video, hoặc là bình luận một bữa ăn)
  let media = '';
  if (m.media_path) {
    const ratio = m.width && m.height ? Math.max(0.6, Math.min(1.6, m.width / m.height)) : 1;
    const thumb = m.thumb_path || (m.media_type === 'image' ? m.media_path : null);
    media = `
      <button class="msg-media" style="--ar:${ratio}" ${m.pending ? '' : `data-media="${m.id}"`}>
        ${m.localUrl ? (m.media_type === 'video' ? `<video src="${m.localUrl}" muted playsinline></video>` : `<img src="${m.localUrl}" alt="" class="loaded">`)
          : thumb ? `<img data-path="${esc(thumb)}" alt="">` : '<span class="ph-video">🎬</span>'}
        ${m.media_type === 'video' ? `<span class="pc-play">${ICONS.play}</span>` : ''}
        ${m.pending ? `<span class="up-progress">${Math.round((m.progress || 0) * 100)}%</span>` : ''}
      </button>`;
  }
  const quote = m.meal_id ? mealQuote(m.meal_id) : '';
  const big = !media && !quote && isEmojiOnly(m.body);
  const text = m.body ? esc(m.body) : '';
  return `
    <div class="msg ${mine ? 'mine' : ''} ${grouped ? 'grouped' : ''}">
      ${av}
      <div class="bubble ${big ? 'big-emoji' : ''} ${m.pending ? 'pending' : ''} ${media ? 'has-media' : ''}" ${mine && !m.pending ? `data-bubble="${m.id}"` : ''}>${quote}${media}${text ? `<span class="b-text">${text}</span>` : ''}<time>${time}</time></div>
      ${mine && !m.pending ? `<button class="unsend-btn" data-unsend="${m.id}" hidden>Thu hồi</button>` : ''}
    </div>`;
}

function viewChat() {
  const p2 = partner();
  const list = [...state.messages.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const lastMine = [...list].reverse().find((m) => m.kind === 'text' && m.sender_id === state.uid);
  let html = '';
  let lastDay = null;
  let prevKey = null;
  for (const m of list) {
    const day = ymd(new Date(m.created_at));
    if (day !== lastDay) {
      html += `<div class="chat-day"><span>${chatDayLabel(day)}</span></div>`;
      lastDay = day;
      prevKey = null;
    }
    const key = m.kind === 'text' ? m.sender_id : null;
    html += msgHtml(m, key && key === prevKey);
    prevKey = key;
    if (lastMine && m.id === lastMine.id) {
      html += `<div class="msg-status">${m.pending ? 'Đang gửi…' : m.read_at ? 'Đã xem ✓✓' : 'Đã gửi ✓'}</div>`;
    }
  }
  const empty = `<div class="chat-empty">${cat({ size: 96, mood: 'love' })}<p>Chưa có tin nhắn nào.<br>Nhắn một câu thương thương đi 💌</p></div>`;
  return `
    ${chatBgHtml()}
    <div class="chat-head">
      <button class="icon-btn" data-action="chat-back" aria-label="Về Lịch ăn">${ICONS.left}</button>
      <a class="chat-av" href="#/us" aria-label="Hồ sơ">${esc(p2?.avatar || '💌')}</a>
      <div class="chat-title"><b>${esc(p2?.display_name || 'Đang chờ người thương')}</b>
        <small>${p2 ? 'Chỉ hai đứa mình thấy 🔒' : 'Gửi link app và mã mời cho người ấy nha'}</small></div>
      <button class="icon-btn head-bg" data-action="chat-bg" aria-label="Đổi hình nền">🎨</button>
      <a class="icon-btn head-straw" href="#/cycle" aria-label="Chị 🍓">🍓</a>
    </div>
    <div class="chat-list">${list.length ? html : empty}</div>`;
}

// ------------------------------------------------------------ hình nền tin nhắn (mỗi người tự chọn)
function chatBgValue() {
  return String(me()?.chat_bg || '');
}

function chatBgKey() {
  const v = chatBgValue();
  if (v.startsWith('photo:')) return 'photo';
  const key = v.startsWith('preset:') ? v.slice(7) : 'dots';
  return BG_PRESETS.some((b) => b.key === key) ? key : 'dots';
}

function chatBgPhoto() {
  const v = chatBgValue();
  if (!v.startsWith('photo:')) return null;
  const [path, flag] = v.slice(6).split('|');
  return { path, soft: flag !== 'sharp' };
}

function chatBgHtml() {
  const key = chatBgKey();
  if (key !== 'photo') return `<div class="chat-bg bg-${key}" aria-hidden="true"></div>`;
  const ph = chatBgPhoto();
  const url = state.bgUrl?.path === ph.path ? state.bgUrl.url : '';
  return `<div class="chat-bg bg-photo ${ph.soft ? 'soft' : ''}" data-bgpath="${esc(ph.path)}" aria-hidden="true" ${url ? `style="background-image:url('${url}')"` : ''}></div>`;
}

async function hydrateChatBg() {
  const ph = chatBgPhoto();
  if (!ph || state.bgUrl?.path === ph.path) return;
  try {
    const map = await api.signedUrls([ph.path]);
    const url = map.get(ph.path);
    if (!url) return;
    state.bgUrl = { path: ph.path, url };
    const el = document.querySelector(`.chat-bg[data-bgpath="${CSS.escape(ph.path)}"]`);
    if (el) el.style.backgroundImage = `url('${url}')`;
  } catch { /* để nền trơn */ }
}

function bgSheetHtml() {
  const key = chatBgKey();
  const ph = chatBgPhoto();
  return `
    <div class="sheet bg-sheet">
      <div class="grab"></div>
      <div class="sheet-head"><h3>🎨 Hình nền tin nhắn</h3>
        <button class="icon-btn" data-action="close-overlay" aria-label="Đóng">${ICONS.close}</button></div>
      <div class="bg-grid">
        ${BG_PRESETS.map((b) => `<button type="button" class="bg-tile bg-${b.key} ${key === b.key ? 'on' : ''}" data-bg="${b.key}"><span>${b.name}</span></button>`).join('')}
        <label class="bg-tile bg-upload ${key === 'photo' ? 'on' : ''}" ${ph && state.bgUrl?.path === ph.path ? `style="background-image:url('${state.bgUrl.url}')"` : ''}>
          <span>📷 Ảnh của mình</span><input type="file" accept="image/*" data-bg-pick hidden></label>
      </div>
      ${ph ? `<label class="switch-row"><span>Làm dịu ảnh cho dễ đọc chữ</span>
        <input type="checkbox" id="bg-soft" ${ph.soft ? 'checked' : ''}><i class="switch"></i></label>` : ''}
      <p class="hint">Hình nền chỉ đổi trên tài khoản của bạn, người kia vẫn giữ nền riêng.</p>
    </div>`;
}

function openBgSheet() {
  openOverlay('info', bgSheetHtml());
  state.overlay.sub = 'bg';
}

async function setChatBg(value) {
  const old = chatBgPhoto();
  try {
    const p = await api.updateProfile(state.uid, { chat_bg: value });
    state.profiles.set(p.id, { ...me(), ...p });
    if (old && !String(value || '').startsWith(`photo:${old.path}`)) api.removeFiles([old.path]).catch(() => {});
    renderView();
    const wrap = document.querySelector('.overlay .sheet-wrap');
    if (wrap && state.overlay?.sub === 'bg') wrap.innerHTML = bgSheetHtml();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function uploadChatBg(file) {
  toast('Đang đặt ảnh nền… 🖼️');
  try {
    const img = await processImage(file);
    const path = `${state.uid}/bg/${uuid()}.jpg`;
    await api.upload(path, img.main, 'image/jpeg');
    state.bgUrl = { path, url: img.previewUrl };
    await setChatBg(`photo:${path}`);
    toast('Đã đổi hình nền 🎨');
  } catch (e) {
    toast(e.message, 'error', 4000);
  }
}

// ------------------------------------------------------------ có tin mới: kêu meo, buzz thì rung
function onIncoming(m) {
  if (document.visibilityState !== 'visible') return;
  if (m.kind === 'buzz') return onBuzzArrived(m);
  const kind = { reminder: 'remind', cycle: 'cycle', event: 'cycle', heart: 'heart', report: 'report' }[m.kind] || 'msg';
  meow(kind);
  if (m.kind === 'reminder') navigator.vibrate?.([120, 60, 120]);
}

function onBuzzArrived(m) {
  meow('buzz');
  navigator.vibrate?.([220, 90, 220, 90, 420]);
  document.body.classList.remove('shake');
  void document.body.offsetWidth;
  document.body.classList.add('shake');
  setTimeout(() => document.body.classList.remove('shake'), 900);
  const mi = MEAL_BY_KEY[m.meal_type] || MEALS[0];
  const done = m.meal_date && m.meal_type && nyMealsOn(m.meal_date, m.meal_type).length;
  if (state.overlay) {
    toast(`🔔 ${nameOf(m.sender_id)} buzz bạn ăn ${mi.name.toLowerCase()}!`, 'buzz', 4200);
    return;
  }
  openOverlay('buzz', `
    <div class="sheet buzz-sheet">
      <div class="bz-big">🔔</div>
      <h3>Buzzz! ${esc(avatarOf(m.sender_id))}</h3>
      <p>${esc(m.body || `${nameOf(m.sender_id)} nhắc bạn ăn ${mi.name.toLowerCase()} nè`)}</p>
      <div class="btn-row center-row">
        ${done ? '' : `<button class="btn primary" data-report="${m.meal_type}|${m.meal_date}">📸 Báo cáo ${mi.name.toLowerCase()}</button>`}
        <button class="btn ghost" data-action="close-overlay">${done ? 'Biết rồi 😚' : 'Để tí nữa 🥺'}</button>
      </div>
    </div>`);
}

async function sendChat(text, extra = {}) {
  const body = String(text || '').trim();
  if (!body && !extra.media_path) return;
  const tempId = `tmp-${uuid()}`;
  const recipient = partner()?.id || null;
  state.messages.set(tempId, {
    id: tempId, sender_id: state.uid, recipient_id: recipient, kind: 'text', body, created_at: new Date().toISOString(), pending: true, ...extra,
  });
  state.chatStick = true;
  if (state.route.name === 'chat') renderView();
  if (state.overlay?.kind === 'viewer') renderViewer();
  try {
    const row = await api.sendMessage({ body: body || null, recipient_id: recipient, ...extra });
    state.messages.delete(tempId);
    state.messages.set(row.id, { ...(state.messages.get(row.id) || {}), ...row });
  } catch (e) {
    state.messages.delete(tempId);
    toast(e.message, 'error');
    if (extra.kind === 'buzz') delete buzzCooldown[extra.meal_type];
    else if (!extra.media_path) {
      const input = document.getElementById(extra.meal_id ? 'cmt-input' : 'chat-text');
      if (input && !input.value) input.value = body;
    }
  }
  state.chatStick = true;
  scheduleRender();
}

async function sendChatMedia(file) {
  let media;
  const tempId = `tmp-${uuid()}`;
  try {
    media = await processFile(file);
  } catch (e) {
    toast(e.message, 'error', 4200);
    return;
  }
  const recipient = partner()?.id || null;
  const temp = {
    id: tempId, sender_id: state.uid, recipient_id: recipient, kind: 'text', body: null, created_at: new Date().toISOString(),
    pending: true, progress: 0, media_type: media.kind, media_path: 'pending', localUrl: media.previewUrl, width: media.width, height: media.height,
  };
  state.messages.set(tempId, temp);
  state.chatStick = true;
  renderView();
  const id = uuid();
  const now = new Date();
  const folder = `${state.uid}/chat/${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const ext = media.kind === 'video' ? (media.contentType.includes('webm') ? 'webm' : 'mp4') : 'jpg';
  const mediaPath = `${folder}/${id}.${ext}`;
  const thumbPath = media.thumb ? `${folder}/${id}_t.jpg` : null;
  const total = media.main.size + (media.thumb?.size || 0);
  try {
    await api.upload(mediaPath, media.main, media.contentType, (f) => {
      temp.progress = (f * media.main.size) / total;
      const el = document.querySelector('.up-progress');
      if (el) el.textContent = `${Math.round(temp.progress * 100)}%`;
    });
    if (thumbPath) await api.upload(thumbPath, media.thumb, 'image/jpeg');
    const row = await api.sendMessage({
      body: null, recipient_id: recipient, media_type: media.kind, media_path: mediaPath, thumb_path: thumbPath,
      width: media.width, height: media.height, duration: media.duration, bytes: total,
    });
    state.messages.delete(tempId);
    // giữ ảnh đã nén trong máy để khỏi tải lại ngay sau khi gửi
    state.messages.set(row.id, { ...(state.messages.get(row.id) || {}), ...row, localUrl: media.kind === 'image' ? media.previewUrl : undefined });
    if (media.kind !== 'image') URL.revokeObjectURL(media.previewUrl);
  } catch (e) {
    state.messages.delete(tempId);
    toast(e.message, 'error', 4200);
    api.removeFiles([mediaPath, thumbPath]).catch(() => {});
    if (media.previewUrl) URL.revokeObjectURL(media.previewUrl);
  }
  state.chatStick = true;
  scheduleRender();
}

// Bàn phím điện thoại che khung nhập: đẩy thanh nhắn tin lên theo bàn phím
if (window.visualViewport) {
  const onViewport = () => {
    const vv = window.visualViewport;
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    document.documentElement.style.setProperty('--kb', `${kb}px`);
    const open = kb > 80;
    if (open !== document.body.classList.contains('kb-open')) {
      document.body.classList.toggle('kb-open', open);
      if (open && state.route.name === 'chat') scrollChatBottom(true);
    }
  };
  window.visualViewport.addEventListener('resize', onViewport);
  window.visualViewport.addEventListener('scroll', onViewport);
}

// ============================================================ CÀI ĐẶT
function viewSettings() {
  const p = me();
  const s = state.settings || {};
  const used = allMeals().reduce((n, m) => n + (Number(m.bytes) || 0), 0) +
    [...state.messages.values()].reduce((n, m) => n + (Number(m.bytes) || 0), 0);
  const limit = CONFIG.STORAGE_LIMIT_MB * 1024 * 1024;
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const t = (v, d) => (v || d).slice(0, 5);
  const ios = isIOS();
  const standalone = isStandalone();
  const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  let pushStatus;
  if (state.pushOn) pushStatus = `<span class="ok-text">Đã bật trên máy này ✅</span>`;
  else if (ios && !standalone) pushStatus = `<span class="warn-text">iPhone cần thêm app ra màn hình chính trước, rồi mở app từ biểu tượng mèo.</span>`;
  else if (!pushSupported) pushStatus = `<span class="warn-text">Trình duyệt này chưa hỗ trợ thông báo.</span>`;
  else if (Notification.permission === 'denied') pushStatus = `<span class="warn-text">Đã chặn thông báo. Vào cài đặt điện thoại → thông báo → cho phép app.</span>`;
  else pushStatus = `<span class="muted">Chưa bật trên máy này</span>`;

  return `
    <h2 class="page-title"><a href="#/" class="back-link">${ICONS.left}</a> Cài đặt ⚙️</h2>

    <div class="card form-card" id="profile-card">
      <h3>Hồ sơ của mình</h3>
      <p class="hint">Người ấy xem được ở trang Hai đứa mình 💞${isNy() ? ' · mục có dấu * là bắt buộc' : ''}</p>
      <label class="field"><span>Tên gọi</span><input id="my-name" maxlength="40" value="${esc(p.display_name)}"></label>
      <div class="field"><span>Linh vật</span>
        <div class="avatar-pick">${AVATARS.map((a) => `<button type="button" class="av-opt ${a === p.avatar ? 'on' : ''}" data-myav="${a}">${a}</button>`).join('')}</div>
      </div>
      <div id="pf-settings">${profileFieldsHtml(p, { strict: isNy() })}</div>
      <p class="form-err" id="pf-err" role="alert"></p>
      <button class="btn primary" data-action="save-profile">Lưu hồ sơ</button>
    </div>

    <div class="card form-card">
      <h3>🐱 Tiếng mèo & hình nền</h3>
      <label class="switch-row"><span>Mèo kêu khi có tin nhắn, buzz, nhắc giờ ăn</span>
        <input type="checkbox" id="snd-on" ${soundOn() ? 'checked' : ''}><i class="switch"></i></label>
      <div class="btn-row">
        <button class="btn ghost" data-action="test-meow">🔊 Nghe thử</button>
        <button class="btn ghost" data-action="chat-bg">🎨 Hình nền tin nhắn</button>
      </div>
      <p class="hint">Tiếng mèo kêu khi app đang mở. Lúc app đóng, điện thoại phát âm báo mặc định vì web app không được đổi âm thông báo của máy.${isAndroid() ? ' Trên Android có thể tải <a class="link-btn" href="sounds/meow.mp3" download="meo-meo.mp3">tiếng mèo</a> về máy rồi chọn làm âm báo trong Cài đặt → Ứng dụng → Bé ăn chưa? → Thông báo.' : ''}</p>
    </div>

    <div class="card form-card">
      <h3>⏰ Giờ ăn của ${esc(nyName())}</h3>
      <p class="hint">Quá giờ 15 phút chưa có hình, mèo nhắc ${esc(nyName())} trong Tin nhắn. Trễ 1 tiếng mèo nhắc lần nữa${s.late_alert_owner !== false ? ` và báo cho ${esc(ownerName())}` : ''}.</p>
      <div class="time-grid">
        <label class="field"><span>🍳 Sáng</span><input type="time" id="sch-sang" value="${t(s.sched_sang, '07:30')}"></label>
        <label class="field"><span>🍱 Trưa</span><input type="time" id="sch-trua" value="${t(s.sched_trua, '12:00')}"></label>
        <label class="field"><span>🍲 Tối</span><input type="time" id="sch-toi" value="${t(s.sched_toi, '19:00')}"></label>
      </div>
      <label class="switch-row"><span>Mèo nhắc ${esc(nyName())} khi trễ bữa</span>
        <input type="checkbox" id="rem-on" ${s.reminders_enabled !== false ? 'checked' : ''}><i class="switch"></i></label>
      <label class="switch-row"><span>Báo ${esc(ownerName())} khi ${esc(nyName())} trễ 1 tiếng</span>
        <input type="checkbox" id="late-owner" ${s.late_alert_owner !== false ? 'checked' : ''}><i class="switch"></i></label>
      <button class="btn primary" data-action="save-schedule">Lưu giờ ăn</button>
    </div>

    <div class="card form-card">
      <h3>Của chung hai đứa</h3>
      <p class="hint">👑 Chủ app: <b>${esc(ownerName())}</b> · 🐷 Ny: <b>${esc(nyId() ? nyName() : 'chưa vào app')}</b></p>
      <label class="field"><span>Tên app</span><input id="app-name" maxlength="40" value="${esc(s.app_name || 'Bé ăn chưa?')}"></label>
      <label class="field"><span>Ngày bắt đầu yêu 💘</span><input id="start-date" type="date" value="${esc(s.start_date || '')}" max="${mealDay()}"></label>
      <button class="btn primary" data-action="save-couple">Lưu</button>
      <a class="btn ghost block love-link" href="#/us">💞 Xem trang Hai đứa mình</a>
    </div>

    <div class="card form-card">
      <h3>${ICONS.bell} Thông báo</h3>
      <p class="hint">Tin nhắn mới, giờ ăn, bản tin chị 🍓.</p>
      <p>${pushStatus}</p>
      <div class="btn-row">
        ${!state.pushOn ? `<button class="btn primary" data-action="enable-push" ${(ios && !standalone) || !pushSupported ? 'disabled' : ''}>Bật thông báo</button>` : ''}
        ${state.pushOn ? `<button class="btn ghost" data-action="test-push">Gửi thử</button>` : ''}
      </div>
    </div>

    <div class="card form-card">
      <h3>📲 Cài app ra màn hình chính</h3>
      ${standalone ? `<p class="ok-text">Đang chạy như app rồi nè ✅</p>` : ios ? iosInstallSteps() : `
        <p class="hint">Trên Android (Chrome): bấm nút dưới, hoặc menu ⋮ → <b>Thêm vào màn hình chính</b>.</p>
        <button class="btn primary" data-action="install" ${state.installPrompt ? '' : 'disabled'}>Cài app</button>`}
    </div>

    <div class="card form-card">
      <h3>🎬 Mẹo video</h3>
      <p class="hint">Video tối đa ${CONFIG.MAX_VIDEO_SEC} giây. iPhone nên vào <b>Cài đặt → Camera → Định dạng → Tương thích nhất</b> để máy Android xem được video.</p>
    </div>

    <div class="card form-card">
      <h3>💾 Dung lượng</h3>
      <div class="meter"><i style="width:${pct}%"></i></div>
      <p class="hint">Đã dùng ${fmtBytes(used)} / ${fmtBytes(limit)} miễn phí (${pct}%)</p>
    </div>

    <div class="card form-card">
      <button class="btn ghost block danger" data-action="logout">Đăng xuất</button>
      <p class="hint center">Bé ăn chưa? · phiên bản ${CONFIG.APP_VERSION} · làm bằng 💗</p>
    </div>
    <div class="bottom-space"></div>`;
}

function iosInstallSteps() {
  return `
    <ol class="steps">
      <li>Mở link app bằng <b>Safari</b></li>
      <li>Bấm nút <b>Chia sẻ</b> <span class="inline-ico">${ICONS.share}</span> ở thanh dưới</li>
      <li>Chọn <b>Thêm vào MH chính</b> (Add to Home Screen)</li>
      <li>Mở app từ biểu tượng mèo 🐱 rồi bật thông báo</li>
    </ol>`;
}

async function refreshPushState() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    const on = !!sub && Notification.permission === 'granted';
    if (on) await api.savePushSubscription(sub, state.uid).catch(() => {});
    if (on !== state.pushOn) {
      state.pushOn = on;
      if (state.route.name === 'settings') renderView();
    }
  } catch { /* bỏ qua */ }
}

function b64uToBytes(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

async function enablePush(btn) {
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    toast(isIOS() && !isStandalone() ? 'iPhone cần thêm app ra màn hình chính trước nha 📲' : 'Trình duyệt này chưa hỗ trợ thông báo 😿', 'error', 4000);
    return;
  }
  let perm = 'default';
  try {
    perm = await Notification.requestPermission(); // iOS: phải hỏi ngay trong lần chạm
  } catch {
    perm = Notification.permission;
  }
  if (perm !== 'granted') {
    toast('Chưa được cho phép thông báo 😿', 'error');
    renderView();
    return;
  }
  btn.disabled = true;
  btn.classList.add('loading');
  try {
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await api.callFunction('vapid');
    const key = b64uToBytes(publicKey);
    let sub = await reg.pushManager.getSubscription();
    if (sub) {
      const cur = sub.options?.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
      if (cur && (cur.length !== key.length || cur.some((v, i) => v !== key[i]))) {
        await sub.unsubscribe();
        sub = null;
      }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await api.savePushSubscription(sub, state.uid);
    state.pushOn = true;
    toast('Đã bật thông báo trên máy này 🔔');
    renderView();
  } catch (e) {
    toast(`Bật thông báo lỗi: ${e.message}`, 'error', 4000);
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
  }
}

// ============================================================ lớp phủ
function overlayRoot() {
  return document.getElementById('overlays');
}

function openOverlay(kind, html, { pushed, id, locked } = {}) {
  const root = overlayRoot();
  root.innerHTML = `<div class="overlay ${kind}" data-kind="${kind}"><div class="backdrop" ${locked ? '' : 'data-action="close-overlay"'}></div><div class="sheet-wrap">${html}</div></div>`;
  state.overlay = { kind, pushed: !!pushed, id, locked: !!locked };
  document.body.classList.add('no-scroll');
  requestAnimationFrame(() => root.firstElementChild?.classList.add('open'));
}

function closeOverlayDom() {
  const root = overlayRoot();
  const el = root?.firstElementChild;
  state.overlay = null;
  state.composer = null;
  document.body.classList.remove('no-scroll');
  if (!el) return;
  el.querySelectorAll('video').forEach((v) => v.pause());
  el.classList.remove('open');
  setTimeout(() => {
    if (el.parentNode === root && !el.classList.contains('open')) el.remove();
  }, 260);
}

function baseHash() {
  const r = state.route;
  if (r.name === 'cal') return `#/cal${r.month ? '/' + r.month : ''}`;
  if (['us', 'settings', 'chat', 'cycle'].includes(r.name)) return `#/${r.name}`;
  return r.date ? `#/day/${r.date}` : '#/';
}

function closeOverlay() {
  const ov = state.overlay;
  if (!ov || ov.locked) return;
  if (ov.pushed) {
    history.back();
  } else {
    if (/^#\/(p|new|m)\b/.test(location.hash)) history.replaceState(null, '', baseHash());
    closeOverlayDom();
  }
}

function navOverlay(hash) {
  state.pendingPush = true;
  location.hash = hash;
}

// ------------------------------------------------------------ Báo cáo bữa ăn (chỉ Ny)
function openComposer(mealKey, date) {
  const pushed = !!state.pendingPush;
  state.pendingPush = false;
  if (state.overlay?.kind === 'composer') return;
  if (!isNy()) {
    if (pushed) history.back();
    else history.replaceState(null, '', baseHash());
    toast(`Chỉ ${nyName()} báo cáo bữa ăn thôi nha 🐱`);
    return;
  }
  const today = mealDay();
  state.composer = {
    meal: mealKey || mealForTime(),
    day: date && date === addDays(today, -1) ? 'yesterday' : 'today',
    fromChat: state.route.name === 'chat',
    media: null,
    processing: false,
    caption: '',
    mood: null,
    busy: false,
    progress: 0,
  };
  openOverlay('composer', composerHtml(), { pushed });
}

function composerHtml() {
  const c = state.composer;
  const today = mealDay();
  const yesterday = addDays(today, -1);
  const sched = schedMinutes(state.settings, c.meal);
  let mediaBlock;
  if (c.processing) {
    mediaBlock = `<div class="pick-zone busy">${cat({ size: 70, mood: 'happy', cls: 'bounce' })}<p>Mèo đang nén ảnh cho nhẹ…</p></div>`;
  } else if (c.media) {
    mediaBlock = `
      <div class="preview">
        ${c.media.kind === 'video'
          ? `<video src="${c.media.previewUrl}" playsinline muted loop autoplay controls></video>`
          : `<img src="${c.media.previewUrl}" alt="Ảnh bữa ăn">`}
        <label class="change-btn">Đổi<input type="file" accept="image/*,video/*" data-pick hidden></label>
      </div>`;
  } else {
    mediaBlock = `
      <div class="pick-zone">
        <label class="pick big">${ICONS.camera}<span>Chụp / quay</span>
          <input type="file" accept="image/*,video/*" capture="environment" data-pick hidden></label>
        <label class="pick big">${ICONS.image}<span>Chọn từ máy</span>
          <input type="file" accept="image/*,video/*" data-pick hidden></label>
      </div>
      <p class="hint center">Ảnh tự nén cho nhẹ · video tối đa ${CONFIG.MAX_VIDEO_SEC} giây</p>`;
  }
  return `
    <div class="sheet composer-sheet">
      <div class="grab"></div>
      <div class="sheet-head">
        <h3>Báo cáo cho ${esc(ownerName())} 📸</h3>
        <button class="icon-btn" data-action="close-overlay" aria-label="Đóng">${ICONS.close}</button>
      </div>
      ${mediaBlock}
      <div class="field"><span>Bữa nào nè?${sched != null ? ` <em class="sched-hint">giờ ăn ${fmtHM(sched)}</em>` : ''}</span>
        <div class="chips">${MEALS.map((m) => `<button type="button" class="chip ${c.meal === m.key ? 'on' : ''}" data-cmeal="${m.key}">${m.icon} ${m.short}</button>`).join('')}</div>
      </div>
      <div class="field"><span>Ngày</span>
        <div class="chips">
          <button type="button" class="chip ${c.day === 'today' ? 'on' : ''}" data-cday="today">Hôm nay · ${fmtDmy(today).slice(0, 5)}</button>
          <button type="button" class="chip ${c.day === 'yesterday' ? 'on' : ''}" data-cday="yesterday">Hôm qua · ${fmtDmy(yesterday).slice(0, 5)}</button>
        </div>
      </div>
      <label class="field"><span>Ghi chú</span>
        <textarea id="c-caption" rows="2" maxlength="500" placeholder="Ăn gì đó? Ngon không? 😋">${esc(c.caption)}</textarea></label>
      <div class="field"><span>Cảm xúc</span>
        <div class="moods">${MOODS.map((m) => `<button type="button" class="mood ${c.mood === m ? 'on' : ''}" data-cmood="${m}">${m}</button>`).join('')}</div>
      </div>
      ${c.busy ? `<div class="upload-bar"><i style="width:${Math.round(c.progress * 100)}%"></i></div>` : ''}
      <button class="btn primary block big-btn" data-action="submit-meal" ${!c.media || c.busy || c.processing ? 'disabled' : ''}>
        ${c.busy ? `Đang gửi… ${Math.round(c.progress * 100)}%` : 'Gửi báo cáo 📸'}
      </button>
    </div>`;
}

function rerenderComposer() {
  const wrap = document.querySelector('.overlay.composer .sheet-wrap');
  if (!wrap || !state.composer) return;
  const scroll = wrap.querySelector('.sheet')?.scrollTop || 0;
  wrap.innerHTML = composerHtml();
  const sheet = wrap.querySelector('.sheet');
  if (sheet) sheet.scrollTop = scroll;
}

async function onPickFile(input) {
  const file = input.files?.[0];
  if (!file || !state.composer) return;
  const c = state.composer;
  if (c.media?.previewUrl) URL.revokeObjectURL(c.media.previewUrl);
  c.media = null;
  c.processing = true;
  rerenderComposer();
  try {
    const media = await processFile(file);
    if (state.composer !== c) return;
    c.media = media;
  } catch (e) {
    toast(e.message, 'error', 4200);
  } finally {
    c.processing = false;
    if (state.composer === c) rerenderComposer();
  }
}

async function submitMeal() {
  const c = state.composer;
  if (!c?.media || c.busy) return;
  c.caption = document.getElementById('c-caption')?.value.trim() || '';
  c.busy = true;
  c.progress = 0;
  rerenderComposer();
  const id = uuid();
  const now = new Date();
  const folder = `${state.uid}/${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const isVideo = c.media.kind === 'video';
  const ext = isVideo ? (c.media.contentType.includes('webm') ? 'webm' : 'mp4') : 'jpg';
  const mediaPath = `${folder}/${id}.${ext}`;
  const thumbPath = c.media.thumb ? `${folder}/${id}_t.jpg` : null;
  const total = c.media.main.size + (c.media.thumb?.size || 0);
  const mealDateBefore = c.day === 'yesterday' ? addDays(mealDay(), -1) : mealDay();
  const before = MAIN_MEALS.filter((k) => nyMealsOn(mealDateBefore, k).length).length;
  try {
    await api.upload(mediaPath, c.media.main, c.media.contentType, (f) => {
      c.progress = (f * c.media.main.size) / total;
      const btn = document.querySelector('[data-action=submit-meal]');
      const bar = document.querySelector('.upload-bar i');
      if (btn) btn.textContent = `Đang gửi… ${Math.round(c.progress * 100)}%`;
      if (bar) bar.style.width = `${Math.round(c.progress * 100)}%`;
    });
    if (thumbPath) await api.upload(thumbPath, c.media.thumb, 'image/jpeg');
    const mealDate = c.day === 'yesterday' ? addDays(mealDay(), -1) : mealDay();
    const row = await api.insertMeal({
      id,
      user_id: state.uid,
      meal_type: c.meal,
      meal_date: mealDate,
      media_type: c.media.kind,
      media_path: mediaPath,
      thumb_path: thumbPath,
      width: c.media.width,
      height: c.media.height,
      duration: c.media.duration,
      bytes: total,
      caption: c.caption || null,
      mood: c.mood,
    });
    state.meals.set(row.id, row);
    if (c.media.previewUrl) URL.revokeObjectURL(c.media.previewUrl);
    const sched = schedMinutes(state.settings, c.meal);
    const li = sched != null ? lateInfo(Math.round((new Date(row.created_at) - schedDate(mealDate, sched)) / 60000)) : null;
    const after = MAIN_MEALS.filter((k) => nyMealsOn(mealDate, k).length).length;
    closeOverlay();
    setTimeout(() => {
      if (!c.fromChat && mealDate !== (state.route.date || mealDay())) location.hash = mealDate === mealDay() ? '#/' : `#/day/${mealDate}`;
      state.chatStick = c.fromChat;
      scheduleRender();
      if (before < 3 && after === 3) {
        hearts(window.innerWidth / 2, window.innerHeight * 0.55, 26, ['🎉', '💗', '🍚', '✨', '🐾']);
        toast('Ăn đủ 3 bữa rồi, giỏi quá trời! 🎉', 'ok', 3600);
      } else {
        hearts(window.innerWidth / 2, window.innerHeight * 0.6, 12, ['📸', '💗', '🍚', '🐾']);
        toast(`Đã báo cáo cho ${ownerName()}${li ? ` · ${li.text.toLowerCase()}` : ''} 📸`);
      }
    }, 120);
  } catch (e) {
    c.busy = false;
    rerenderComposer();
    toast(e.message, 'error', 4500);
    api.removeFiles([mediaPath, thumbPath]).catch(() => {});
  }
}

// ------------------------------------------------------------ Xem ảnh bữa ăn
function openViewer(id) {
  const pushed = !!state.pendingPush;
  state.pendingPush = false;
  state.viewerDraft = '';
  openOverlay('viewer', `<div class="sheet viewer-sheet" id="viewer-body"></div>`, { pushed, id });
  renderViewer();
}

function renderViewer() {
  const body = document.getElementById('viewer-body');
  const ov = state.overlay;
  if (!body || ov?.kind !== 'viewer') return;
  const m = state.meals.get(ov.id);
  if (!m) {
    body.innerHTML = `<div class="sheet-head"><span></span><button class="icon-btn" data-action="close-overlay">${ICONS.close}</button></div>
      <div class="center-screen small">${cat({ size: 80, mood: 'sleep' })}<p class="muted">Bài này không còn nữa</p></div>`;
    return;
  }
  const input = document.getElementById('cmt-input');
  if (input) state.viewerDraft = input.value;
  const hadFocus = document.activeElement === input;
  const mine = m.user_id === state.uid;
  const hs = state.hearts.get(m.id) || new Map();
  const iHeart = hs.has(state.uid);
  const cmts = mealComments(m.id);
  const meal = MEAL_BY_KEY[m.meal_type];
  const sched = schedMinutes(state.settings, m.meal_type);
  const li = sched != null ? lateInfo(Math.round((new Date(m.created_at) - schedDate(m.meal_date, sched)) / 60000)) : null;
  const existingMedia = body.querySelector('.v-media');
  const sameMedia = existingMedia && existingMedia.dataset.mid === m.id;

  const mediaHtml = m.media_type === 'video'
    ? `<video data-path="${esc(m.media_path)}" ${m.thumb_path ? `data-poster="${esc(m.thumb_path)}"` : ''} controls playsinline preload="metadata"></video>
       <p class="v-error" hidden>Máy này không phát được video 😿 iPhone: Cài đặt → Camera → Định dạng → Tương thích nhất.</p>`
    : `<img data-path="${esc(m.media_path)}" alt="Ảnh bữa ăn" class="dbl-heart">`;

  const whoHearted = [...hs.keys()].map((u) => `${esc(avatarOf(u))} ${esc(nameOf(u))}`).join(', ');
  const restHtml = `
    <div class="v-body">
      ${li ? `<div class="v-late"><span class="lt ${li.cls}">${li.icon} ${li.text}</span><small>Giờ ăn ${fmtHM(sched)} · gửi lúc ${fmtTime(m.created_at)}</small></div>` : ''}
      ${m.caption || m.mood ? `<p class="v-caption">${m.mood ? `<span class="v-mood">${esc(m.mood)}</span>` : ''}${esc(m.caption || '')}</p>` : ''}
      <div class="v-actions">
        <button class="heart-btn ${iHeart ? 'on' : ''}" data-action="toggle-heart" aria-pressed="${iHeart}">${iHeart ? ICONS.heartFill : ICONS.heart}<span>${hs.size || ''}</span></button>
        <span class="v-hearted">${whoHearted ? `${whoHearted} đã thả tim` : 'Chạm 2 lần vào ảnh để thả tim'}</span>
      </div>
      <div class="comments">
        ${cmts.map((c) => `
          <div class="cmt ${c.sender_id === state.uid ? 'mine' : ''}">
            <span class="cmt-av">${esc(avatarOf(c.sender_id))}</span>
            <div class="cmt-bubble"><b>${esc(nameOf(c.sender_id))}</b><p>${esc(c.body || '')}</p><small>${c.pending ? 'đang gửi…' : timeAgo(c.created_at)}</small></div>
          </div>`).join('') || `<p class="muted small-note">Bình luận ở đây sẽ hiện cả trong Tin nhắn 💬</p>`}
      </div>
      <form class="cmt-form" id="cmt-form">
        <input id="cmt-input" maxlength="1000" placeholder="${mine ? 'Viết gì đó…' : 'Khen một câu đi 😚'}" autocomplete="off" enterkeyhint="send">
        <button class="send-btn" type="submit" aria-label="Gửi">${ICONS.send}</button>
      </form>
    </div>`;

  const headHtml = `
    <div class="sheet-head v-head">
      <div class="v-who"><span class="v-av">${esc(avatarOf(m.user_id))}</span>
        <div><b>${esc(nameOf(m.user_id))}</b><small>${meal.icon} ${meal.name} · ${fmtTime(m.created_at)} · ${relDay(m.meal_date)}</small></div></div>
      <div class="v-tools">
        ${mine ? `<button class="icon-btn" data-action="delete-meal" aria-label="Xoá bài">${ICONS.trash}</button>` : ''}
        <button class="icon-btn" data-action="close-overlay" aria-label="Đóng">${ICONS.close}</button>
      </div>
    </div>`;

  if (sameMedia) {
    body.querySelector('.v-head').outerHTML = headHtml;
    body.querySelector('.v-body').outerHTML = restHtml;
    hydrateMedia(body);
  } else {
    body.innerHTML = `${headHtml}<div class="v-media" data-mid="${m.id}">${mediaHtml}</div>${restHtml}`;
    body.querySelector('video')?.addEventListener('error', () => body.querySelector('.v-error')?.removeAttribute('hidden'));
    hydrateMedia(body);
  }
  const newInput = document.getElementById('cmt-input');
  if (newInput) {
    newInput.value = state.viewerDraft || '';
    if (hadFocus) newInput.focus();
  }
}

async function toggleHeart(evt) {
  const id = state.overlay?.id;
  const m = state.meals.get(id);
  if (!m) return;
  const has = state.hearts.get(id)?.has(state.uid);
  if (has) {
    const old = state.hearts.get(id).get(state.uid);
    removeHeartState(id, state.uid);
    renderViewer();
    try {
      await api.removeHeart(id, state.uid);
    } catch (e) {
      addHeartState(old);
      renderViewer();
      toast(e.message, 'error');
    }
  } else {
    addHeartState({ meal_id: id, user_id: state.uid, emoji: '❤️', created_at: new Date().toISOString() });
    renderViewer();
    if (evt) hearts(evt.clientX || window.innerWidth / 2, evt.clientY || window.innerHeight / 2, 10, ['💗', '💖', '💕']);
    try {
      const r = await api.addHeart(id);
      addHeartState(r);
    } catch (e) {
      if (!/duplicate|unique/i.test(e.message)) {
        removeHeartState(id, state.uid);
        renderViewer();
        toast(e.message, 'error');
      }
    }
  }
  scheduleRender();
}

async function deleteMeal() {
  const m = state.meals.get(state.overlay?.id);
  if (!m || m.user_id !== state.uid) return;
  if (!confirm('Xoá bài này luôn hả? Không lấy lại được đâu nha 🥺')) return;
  try {
    await api.deleteMeal(m);
    state.meals.delete(m.id);
    closeOverlay();
    toast('Đã xoá bài');
    scheduleRender();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ------------------------------------------------------------ Xem ảnh/video trong chat
function openMediaViewer(msgId) {
  const pushed = !!state.pendingPush;
  state.pendingPush = false;
  const m = state.messages.get(msgId);
  if (!m?.media_path) {
    if (!pushed) history.replaceState(null, '', baseHash());
    return;
  }
  const inner = m.media_type === 'video'
    ? `<video data-path="${esc(m.media_path)}" ${m.thumb_path ? `data-poster="${esc(m.thumb_path)}"` : ''} controls playsinline autoplay></video>`
    : `<img data-path="${esc(m.media_path)}" alt="">`;
  openOverlay('media', `
    <div class="media-full">
      <button class="icon-btn mf-close" data-action="close-overlay" aria-label="Đóng">${ICONS.close}</button>
      ${inner}
      <p class="mf-cap">${esc(avatarOf(m.sender_id))} ${esc(nameOf(m.sender_id))} · ${fmtTime(m.created_at)} ${relDay(ymd(new Date(m.created_at)), ymd(new Date())).toLowerCase()}</p>
    </div>`, { pushed, id: msgId });
  hydrateMedia(overlayRoot());
}

// ------------------------------------------------------------ Chào mừng lần đầu
function maybeWelcome() {
  const key = `bac-welcome2-${state.uid}`;
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
  } catch {
    return;
  }
  if (/^#\/(p|new|m)\//.test(location.hash)) return;
  const ios = isIOS();
  const standalone = isStandalone();
  const install = standalone ? '' : ios ? `<h4>1. Thêm app ra màn hình chính</h4>${iosInstallSteps()}` : isAndroid()
    ? `<h4>1. Cài app ra màn hình chính</h4><p class="hint">Chrome: menu ⋮ → <b>Thêm vào màn hình chính</b>, hoặc bấm nút dưới.</p>
       <button class="btn ghost" data-action="install" ${state.installPrompt ? '' : 'disabled'}>Cài app</button>`
    : '';
  const intro = isNy()
    ? `Mỗi bữa nhớ chụp hình báo cáo cho ${esc(ownerName())} nha. Trễ giờ là mèo nhắc đó 😼`
    : `Ở đây anh xem ${esc(nyName())} ăn uống có đúng giờ không, nhắn tin và theo dõi chị 🍓.`;
  openOverlay('info', `
    <div class="sheet welcome-sheet">
      <div class="grab"></div>
      <div class="center">${cat({ size: 100, mood: 'love', bowl: true })}</div>
      <h3 class="center">Chào ${esc(me().display_name)}! 🐾</h3>
      <p class="center muted">${intro}</p>
      ${install}
      <h4>${install ? '2' : '1'}. Bật thông báo</h4>
      <p class="hint">Để nhận tin nhắn, nhắc giờ ăn và bản tin chị 🍓. ${ios && !standalone ? 'Trên iPhone cần làm bước 1 trước, rồi bấm hình đại diện ở góc trên → Cài đặt để bật.' : ''}</p>
      <div class="btn-row">
        ${!(ios && !standalone) ? `<button class="btn ghost" data-action="enable-push">Bật thông báo</button>` : ''}
        <button class="btn primary" data-action="close-overlay">Bắt đầu thôi 💕</button>
      </div>
    </div>`);
}

// ============================================================ sự kiện
document.addEventListener('click', async (e) => {
  const menu = document.getElementById('attach-menu');
  if (menu && !menu.hidden && !e.target.closest('#attach-menu, [data-action=attach]')) menu.hidden = true;

  const t = e.target.closest('button, a, [data-action], label, [data-bubble], [data-open], [data-media]');
  if (!t) return;

  if (t.dataset.authMode) return showAuth(t.dataset.authMode);
  if (t.dataset.buzz) {
    sendBuzz(t.dataset.buzz, t);
    return;
  }
  if (t.dataset.bg) {
    setChatBg(t.dataset.bg === 'dots' ? null : `preset:${t.dataset.bg}`);
    return;
  }
  if (t.hasAttribute('data-goto-profile')) state.scrollToProfile = true;
  if (t.classList.contains('av-opt') && t.closest('.avatar-pick')) {
    t.closest('.avatar-pick').querySelectorAll('.av-opt').forEach((b) => b.classList.toggle('on', b === t));
    return;
  }
  if (t.dataset.media) {
    navOverlay(`#/m/${t.dataset.media}`);
    return;
  }
  if (t.dataset.bubble) {
    const b = document.querySelector(`[data-unsend="${t.dataset.bubble}"]`);
    if (b) b.hidden = !b.hidden;
    return;
  }
  if (t.dataset.unsend) {
    if (!confirm('Thu hồi tin nhắn này nha?')) return;
    const msg = state.messages.get(t.dataset.unsend);
    try {
      await api.deleteMessage(t.dataset.unsend);
      state.messages.delete(t.dataset.unsend);
      if (msg?.media_path) api.removeFiles([msg.media_path, msg.thumb_path]).catch(() => {});
      renderView();
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }
  if (t.dataset.quick) {
    sendChat(t.dataset.quick);
    return;
  }
  if (t.dataset.report) {
    const [meal, date] = t.dataset.report.split('|');
    navOverlay(`#/new/${meal}/${date}`);
    return;
  }
  if (t.dataset.day) {
    const today = mealDay();
    const next = addDays(state.route.date || today, Number(t.dataset.day));
    location.hash = next >= today ? '#/' : `#/day/${next}`;
    return;
  }
  if (t.dataset.month) {
    location.hash = `#/cal/${t.dataset.month}`;
    return;
  }
  if (t.dataset.cmonth) {
    state.cycleMonth = t.dataset.cmonth;
    renderView();
    return;
  }
  if (t.dataset.cycday) {
    openCycleSheet('day', t.dataset.cycday);
    return;
  }
  if (t.dataset.cyc) {
    const a = t.dataset.cyc;
    if (a.endsWith('-other')) {
      const d = document.getElementById('cyc-other')?.value;
      if (!d) return toast('Chọn ngày trước nha', 'error');
      return doCycleAction(a.replace('-other', ''), d);
    }
    return doCycleAction(a, t.dataset.date, t.dataset.id);
  }
  if (t.dataset.delcycle) {
    return doCycleAction('delete', null, t.dataset.delcycle);
  }
  if (t.dataset.goday) {
    location.hash = t.dataset.goday === mealDay() ? '#/' : `#/day/${t.dataset.goday}`;
    return;
  }
  if (t.dataset.open) {
    navOverlay(`#/p/${t.dataset.open}`);
    return;
  }
  if (t.dataset.new) {
    navOverlay(`#/new/${t.dataset.new}`);
    return;
  }
  if (t.dataset.cmeal && state.composer) {
    state.composer.caption = document.getElementById('c-caption')?.value || '';
    state.composer.meal = t.dataset.cmeal;
    rerenderComposer();
    return;
  }
  if (t.dataset.cday && state.composer) {
    state.composer.caption = document.getElementById('c-caption')?.value || '';
    state.composer.day = t.dataset.cday;
    rerenderComposer();
    return;
  }
  if (t.dataset.cmood && state.composer) {
    state.composer.caption = document.getElementById('c-caption')?.value || '';
    state.composer.mood = state.composer.mood === t.dataset.cmood ? null : t.dataset.cmood;
    rerenderComposer();
    return;
  }
  if (t.dataset.myav) {
    t.closest('.avatar-pick').querySelectorAll('.av-opt').forEach((b) => b.classList.toggle('on', b === t));
    return;
  }

  const action = t.dataset.action;
  if (!action) return;
  switch (action) {
    case 'signup-next': {
      const form = document.getElementById('auth-form');
      const e1 = checkSignupStep1(form);
      if (e1) {
        document.getElementById('auth-err').textContent = e1;
        return;
      }
      signupStep(2);
      break;
    }
    case 'signup-back':
      signupStep(1);
      break;
    case 'chat-bg':
      openBgSheet();
      break;
    case 'test-meow':
      meow('test', { force: true });
      break;
    case 'retry':
      location.reload();
      break;
    case 'logout':
      if (!confirm('Đăng xuất khỏi máy này?')) return;
      try {
        const reg = await navigator.serviceWorker?.getRegistration();
        const sub = await reg?.pushManager?.getSubscription();
        if (sub) {
          await api.deletePushSubscription(sub.endpoint).catch(() => {});
          await sub.unsubscribe().catch(() => {});
        }
      } catch { /* bỏ qua */ }
      await api.signOut();
      teardown();
      showAuth('login');
      break;
    case 'attach':
      if (menu) menu.hidden = !menu.hidden;
      break;
    case 'chat-report':
      if (menu) menu.hidden = true;
      navOverlay(`#/new/${mealForTime()}`);
      break;
    case 'close-overlay':
      closeOverlay();
      break;
    case 'chat-back':
      location.hash = '#/';
      break;
    case 'nudge': {
      const mi = MEAL_BY_KEY[t.dataset.meal];
      await sendChat(`${mi.icon} ${nyName()} ơi, tới giờ ${mi.name.toLowerCase()} rồi đó, ăn liền rồi chụp hình cho ${ownerName()} xem nha 🥺`);
      toast('Đã nhắn nhắc 💌');
      break;
    }
    case 'submit-meal':
      submitMeal();
      break;
    case 'toggle-heart':
      toggleHeart(e);
      break;
    case 'delete-meal':
      deleteMeal();
      break;
    case 'enable-push':
      enablePush(t);
      break;
    case 'test-push':
      t.disabled = true;
      try {
        const r = await api.callFunction('test');
        toast(r.sent ? 'Đã gửi, chờ xíu là có thông báo 🔔' : 'Chưa gửi được — thử bật lại thông báo nha', r.sent ? 'ok' : 'error');
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        t.disabled = false;
      }
      break;
    case 'install':
      if (state.installPrompt) {
        state.installPrompt.prompt();
        await state.installPrompt.userChoice.catch(() => {});
        state.installPrompt = null;
        renderView();
      }
      break;
    case 'copy-link': {
      const url = location.origin + location.pathname;
      try {
        await navigator.clipboard.writeText(url);
        toast('Đã sao chép link app 📋');
      } catch {
        prompt('Sao chép link này gửi cho người thương nha:', url);
      }
      break;
    }
    case 'cycle-first': {
      const d = document.getElementById('first-start')?.value;
      if (!d) return toast('Chọn ngày trước nha', 'error');
      doCycleAction('start', d);
      break;
    }
    case 'cycle-start':
      openCycleSheet('start');
      break;
    case 'cycle-end':
      openCycleSheet('end');
      break;
    case 'save-cycle-settings': {
      const cl = Number(document.getElementById('cyc-len').value);
      const pl = Number(document.getElementById('per-len').value);
      if (!(cl >= 18 && cl <= 60) || !(pl >= 2 && pl <= 12)) return toast('Chu kỳ 18–60 ngày, hành kinh 2–12 ngày nha', 'error');
      try {
        state.settings = await api.updateSettings({ cycle_length: cl, period_length: pl, cycle_notify: document.getElementById('cyc-notify').checked });
        toast('Đã lưu 🍓');
        renderView();
      } catch (err) {
        toast(err.message, 'error');
      }
      break;
    }
    case 'save-profile': {
      const name = document.getElementById('my-name').value.trim();
      const avatar = document.querySelector('[data-myav].on')?.dataset.myav || me().avatar;
      const errEl = document.getElementById('pf-err');
      if (errEl) errEl.textContent = '';
      if (!name) return toast('Tên gọi không được trống nha', 'error');
      const r = readProfileFields(document.getElementById('pf-settings'), { strict: isNy() });
      if (r.error) {
        if (errEl) errEl.textContent = r.error;
        return toast(r.error, 'error');
      }
      try {
        const p = await api.updateProfile(state.uid, { display_name: name, avatar, ...r.patch });
        state.profiles.set(p.id, { ...me(), ...p });
        toast('Đã lưu hồ sơ 🐾');
        renderView();
      } catch (err) {
        toast(err.message, 'error');
      }
      break;
    }
    case 'save-couple': {
      const appName = document.getElementById('app-name').value.trim() || 'Bé ăn chưa?';
      const start = document.getElementById('start-date').value || null;
      try {
        state.settings = await api.updateSettings({ app_name: appName, start_date: start });
        document.title = appName;
        document.querySelector('.brand-name').textContent = appName;
        toast('Đã lưu 💘');
        renderView();
      } catch (err) {
        toast(err.message, 'error');
      }
      break;
    }
    case 'save-start-quick': {
      const start = document.getElementById('start-date-quick').value;
      if (!start) return toast('Chọn ngày trước nha', 'error');
      try {
        state.settings = await api.updateSettings({ start_date: start });
        hearts(window.innerWidth / 2, window.innerHeight / 2, 20);
        renderView();
      } catch (err) {
        toast(err.message, 'error');
      }
      break;
    }
    case 'save-schedule': {
      try {
        state.settings = await api.updateSettings({
          sched_sang: document.getElementById('sch-sang').value || '07:30',
          sched_trua: document.getElementById('sch-trua').value || '12:00',
          sched_toi: document.getElementById('sch-toi').value || '19:00',
          reminders_enabled: document.getElementById('rem-on').checked,
          late_alert_owner: document.getElementById('late-owner').checked,
        });
        toast('Đã lưu giờ ăn ⏰');
        renderView();
      } catch (err) {
        toast(err.message, 'error');
      }
      break;
    }
    default:
      break;
  }
});

document.addEventListener('submit', (e) => {
  if (e.target.id === 'auth-form') {
    e.preventDefault();
    submitAuth(e.target);
  } else if (e.target.id === 'gate-form') {
    e.preventDefault();
    submitGate(e.target);
  } else if (e.target.id === 'cmt-form') {
    e.preventDefault();
    const input = document.getElementById('cmt-input');
    const text = input.value.trim();
    const id = state.overlay?.id;
    if (!text || !id) return;
    input.value = '';
    state.viewerDraft = '';
    sendChat(text, { meal_id: id });
  } else if (e.target.id === 'chat-form') {
    e.preventDefault();
    const input = document.getElementById('chat-text');
    const text = input.value;
    input.value = '';
    input.focus();
    sendChat(text);
  }
});

document.addEventListener('change', (e) => {
  if (e.target.matches('input[data-pick]')) onPickFile(e.target);
  if (e.target.matches('input[data-bg-pick]')) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) uploadChatBg(f);
  }
  if (e.target.id === 'bg-soft') {
    const ph = chatBgPhoto();
    if (ph) setChatBg(`photo:${ph.path}${e.target.checked ? '' : '|sharp'}`);
  }
  if (e.target.id === 'snd-on') {
    setSoundOn(e.target.checked);
    if (e.target.checked) meow('test', { force: true });
  }
  if (e.target.matches('input[data-chat-pick]')) {
    const f = e.target.files?.[0];
    document.getElementById('attach-menu').hidden = true;
    e.target.value = '';
    if (f) sendChatMedia(f);
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'c-caption' && state.composer) state.composer.caption = e.target.value;
  if (e.target.id === 'cmt-input') state.viewerDraft = e.target.value;
});

// Chạm 2 lần vào ảnh để thả tim
let lastTap = 0;
document.addEventListener('pointerup', (e) => {
  const img = e.target.closest('.dbl-heart');
  if (!img) return;
  const now = Date.now();
  if (now - lastTap < 320) {
    lastTap = 0;
    if (!state.hearts.get(state.overlay?.id)?.has(state.uid)) toggleHeart(e);
    else hearts(e.clientX, e.clientY, 8, ['💗', '💖']);
  } else lastTap = now;
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.overlay && !state.overlay.locked) closeOverlay();
});
