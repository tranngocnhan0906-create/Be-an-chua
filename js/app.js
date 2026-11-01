// Bé ăn chưa? — giao diện chính
import { api } from './api.js';
import { CONFIG } from './config.js';
import {
  MEALS, MEAL_BY_KEY, MAIN_MEALS, MOODS, AVATARS, WEEKDAYS_SHORT,
  mealForTime, mealDay, addDays, daysBetween, fmtDayLong, fmtDmy, relDay, fmtTime, timeAgo,
  monthTitle, addMonths, daysInMonth, weekdayOf, esc, fmtBytes, uuid, computeStreak, loveInfo,
  isIOS, isAndroid, isStandalone,
} from './util.js';
import { processFile } from './media.js';
import { cat, ICONS } from './art.js';

const app = document.getElementById('app');

const state = {
  uid: null,
  profiles: new Map(),
  settings: null,
  meals: new Map(),
  hearts: new Map(), // mealId -> Map(userId -> reaction)
  heartById: new Map(),
  comments: new Map(), // mealId -> [comment]
  filter: 'all',
  route: { name: 'day', date: null },
  loadedAt: 0,
  unsubscribe: null,
  installPrompt: null,
  overlay: null, // { kind: 'viewer'|'composer'|'sheet', pushed: bool, id? }
  composer: null,
  viewerDraft: '',
  pushOn: false,
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

boot();

async function boot() {
  if (!api.configured) {
    app.innerHTML = `<div class="center-screen">${cat({ size: 120, mood: 'sleep' })}<h2>App chưa được cấu hình</h2><p class="muted">Thiếu địa chỉ Supabase trong <code>js/config.js</code>.</p></div>`;
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
  state.unsubscribe = null;
  state.uid = null;
  state.profiles = new Map();
  state.meals = new Map();
  state.hearts = new Map();
  state.heartById = new Map();
  state.comments = new Map();
  state.settings = null;
  state.overlay = null;
  state.loadedAt = 0;
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
  maybeWelcome();
}

async function loadData() {
  const d = await api.loadAll();
  state.profiles = new Map(d.profiles.map((p) => [p.id, p]));
  state.settings = d.settings || { app_name: 'Bé ăn chưa?' };
  state.meals = new Map(d.meals.map((m) => [m.id, m]));
  state.hearts = new Map();
  state.heartById = new Map();
  for (const r of d.reactions) addHeartState(r);
  state.comments = new Map();
  for (const c of d.comments) addCommentState(c);
  state.loadedAt = Date.now();
  document.title = state.settings.app_name || 'Bé ăn chưa?';
}

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !state.uid || !state.loadedAt) return;
  if (Date.now() - state.loadedAt < 45e3) return;
  try {
    await loadData();
    state.unsubscribe?.();
    state.unsubscribe = api.subscribe(onDbChange);
    scheduleRender();
  } catch { /* lần sau thử lại */ }
});

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
function addCommentState(c) {
  if (!state.comments.has(c.meal_id)) state.comments.set(c.meal_id, []);
  const arr = state.comments.get(c.meal_id);
  if (!arr.some((x) => x.id === c.id)) {
    arr.push(c);
    arr.sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
}
function removeCommentById(id) {
  for (const [mid, arr] of state.comments) {
    const i = arr.findIndex((c) => c.id === id);
    if (i >= 0) {
      arr.splice(i, 1);
      if (!arr.length) state.comments.delete(mid);
      return;
    }
  }
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
  } else if (table === 'comments') {
    if (p.eventType === 'DELETE') removeCommentById(o.id);
    else addCommentState(n);
  } else if (table === 'couple_settings') {
    if (n.id) state.settings = { ...state.settings, ...n };
    document.title = state.settings.app_name || 'Bé ăn chưa?';
    const brand = document.querySelector('.brand-name');
    if (brand) brand.textContent = state.settings.app_name;
  } else if (table === 'profiles') {
    if (n.id) state.profiles.set(n.id, { ...(state.profiles.get(n.id) || {}), ...n });
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
    // đừng vẽ lại khi đang gõ trong trang cài đặt
    const active = document.activeElement;
    const typingInView = active && document.getElementById('view').contains(active) && /INPUT|TEXTAREA|SELECT/.test(active.tagName);
    if (!typingInView) renderView();
    if (state.overlay?.kind === 'viewer') renderViewer();
  });
}

// ============================================================ tiện ích hiển thị
const me = () => state.profiles.get(state.uid);
const partner = () => [...state.profiles.values()].find((p) => p.id !== state.uid);
const people = () => {
  const list = [me(), partner()].filter(Boolean);
  return list;
};
const nameOf = (uid) => state.profiles.get(uid)?.display_name || 'Người thương';
const avatarOf = (uid) => state.profiles.get(uid)?.avatar || '🐱';
const allMeals = () => [...state.meals.values()];

function mealsOn(date, filter = state.filter) {
  return allMeals()
    .filter((m) => m.meal_date === date && (filter === 'all' || m.user_id === filter))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function heartCount(id) {
  return state.hearts.get(id)?.size || 0;
}
function commentCount(id) {
  return state.comments.get(id)?.length || 0;
}

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
    const dx = (Math.random() - 0.5) * 220;
    const dy = -120 - Math.random() * 220;
    s.style.left = `${x}px`;
    s.style.top = `${y}px`;
    s.style.setProperty('--dx', `${dx}px`);
    s.style.setProperty('--dy', `${dy}px`);
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
      el.addEventListener('load', () => el.classList.add('loaded'), { once: true });
      el.src = url;
    } else {
      el.src = url;
    }
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
        ${signup ? `
          <label class="field"><span>Tên gọi của bạn</span>
            <input name="display_name" maxlength="40" placeholder="vd: Bé Heo, Anh Nhân" required autocomplete="nickname"></label>
          <div class="field"><span>Chọn linh vật</span>
            <div class="avatar-pick small">${AVATARS.map((a, i) => `<button type="button" class="av-opt ${i === 0 ? 'on' : ''}" data-av="${a}">${a}</button>`).join('')}</div>
          </div>` : ''}
        <label class="field"><span>Email</span>
          <input name="email" type="email" inputmode="email" autocomplete="email" placeholder="ban@email.com" required></label>
        <label class="field"><span>Mật khẩu</span>
          <input name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" placeholder="Ít nhất 6 ký tự" minlength="6" required></label>
        ${signup ? `
          <label class="field"><span>Mã mời</span>
            <input name="invite" autocapitalize="characters" autocomplete="off" placeholder="Mã do người tạo app gửi" required></label>` : ''}
        <p class="form-err" id="auth-err" role="alert"></p>
        <button class="btn primary block" type="submit">${signup ? 'Tạo tài khoản 🐾' : 'Vào thôi 🐾'}</button>
      </form>
    </div>
    <p class="auth-foot">Chỉ hai đứa mình xem được thôi nha 🔒</p>
  </div>`;
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
  if (signup && !String(fd.get('display_name') || '').trim()) {
    err.textContent = 'Cho mèo biết tên gọi của bạn nha';
    return;
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
    } else {
      session = await api.signIn(email, password);
    }
    await enterApp(session);
  } catch (e) {
    err.textContent = e.message;
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
    <a class="me-chip" href="#/settings" aria-label="Cài đặt">${esc(avatarOf(state.uid))}</a>
  </header>
  <main id="view" class="view"></main>
  <nav class="tabbar" aria-label="Điều hướng">
    <a href="#/" data-tab="day" class="tab">${ICONS.home}<span>Hôm nay</span></a>
    <a href="#/cal" data-tab="cal" class="tab">${ICONS.calendar}<span>Nhật ký</span></a>
    <button class="fab" data-action="new" aria-label="Đăng bữa ăn">${ICONS.plus}</button>
    <a href="#/us" data-tab="us" class="tab">${ICONS.heart}<span>Hai đứa</span></a>
    <a href="#/settings" data-tab="settings" class="tab">${ICONS.gear}<span>Cài đặt</span></a>
  </nav>
  <div id="overlays"></div>`;
}

function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  const [a, b] = h.split('/');
  if (a === 'cal') return { name: 'cal', month: /^\d{4}-\d{2}$/.test(b || '') ? b : null };
  if (a === 'us') return { name: 'us' };
  if (a === 'settings') return { name: 'settings' };
  if (a === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(b || '')) return { name: 'day', date: b };
  if (a === 'p' && b) return { name: 'post', id: b };
  if (a === 'new') return { name: 'new', meal: MEAL_BY_KEY[b] ? b : null };
  return { name: 'day', date: null };
}

window.addEventListener('hashchange', () => state.uid && onRoute());

function onRoute() {
  const r = parseRoute();
  if (r.name === 'post') {
    if (!document.getElementById('view')?.innerHTML) renderView();
    openViewer(r.id, false);
    return;
  }
  if (r.name === 'new') {
    if (!document.getElementById('view')?.innerHTML) renderView();
    openComposer(r.meal, false);
    return;
  }
  if (state.overlay) closeOverlayDom();
  const changed = r.name !== state.route.name;
  state.route = r;
  renderView();
  if (changed) window.scrollTo(0, 0);
}

function renderView() {
  const view = document.getElementById('view');
  if (!view) return;
  const r = state.route;
  if (r.name === 'cal') view.innerHTML = viewCalendar();
  else if (r.name === 'us') view.innerHTML = viewUs();
  else if (r.name === 'settings') view.innerHTML = viewSettings();
  else view.innerHTML = viewDay();
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('on', t.dataset.tab === (r.name === 'day' ? 'day' : r.name));
  const chip = document.querySelector('.me-chip');
  if (chip) chip.textContent = avatarOf(state.uid);
  hydrateMedia(view);
}

// ============================================================ HÔM NAY
function viewDay() {
  const today = mealDay();
  const date = state.route.date || today;
  const diff = daysBetween(date, today);
  const canPost = diff >= 0 && diff <= 1;
  const ps = people();
  const p2 = partner();
  if (state.filter !== 'all' && !state.profiles.has(state.filter)) state.filter = 'all';

  const love = loveInfo(state.settings?.start_date);
  const myStreak = computeStreak(allMeals(), state.uid, today);
  const p2Streak = p2 ? computeStreak(allMeals(), p2.id, today) : null;

  const pills = date === today ? `
    <div class="pills">
      ${love && !love.future ? `<a class="pill love" href="#/us">💞 Bên nhau <b>${love.days}</b> ngày</a>` : ''}
      <a class="pill streak" href="#/us">🔥 ${esc(me().avatar)} ${myStreak.current}${p2Streak ? ` · ${esc(p2.avatar)} ${p2Streak.current}` : ''} ngày</a>
    </div>` : '';

  const seg = p2 ? `
    <div class="seg three" role="tablist">
      <button class="${state.filter === 'all' ? 'on' : ''}" data-filter="all">Cả hai</button>
      <button class="${state.filter === state.uid ? 'on' : ''}" data-filter="${state.uid}">${esc(me().avatar)} ${esc(me().display_name)}</button>
      <button class="${state.filter === p2.id ? 'on' : ''}" data-filter="${p2.id}">${esc(p2.avatar)} ${esc(p2.display_name)}</button>
    </div>` : '';

  const progress = `
    <div class="card progress-card">
      ${ps.map((p) => {
        const types = new Set(allMeals().filter((m) => m.user_id === p.id && m.meal_date === date).map((m) => m.meal_type));
        const n = MAIN_MEALS.filter((k) => types.has(k)).length;
        return `<div class="prog-row">
          <span class="prog-av">${esc(p.avatar)}</span>
          <span class="prog-name">${esc(p.display_name)}</span>
          <span class="prog-dots">${MAIN_MEALS.map((k) => `<i class="${types.has(k) ? 'on' : ''}" title="${MEAL_BY_KEY[k].name}">${MEAL_BY_KEY[k].icon}</i>`).join('')}</span>
          <span class="prog-n ${n === 3 ? 'full' : ''}">${n === 3 ? 'Đủ bữa 🎉' : `${n}/3`}</span>
        </div>`;
      }).join('')}
    </div>`;

  const myTypes = new Set(allMeals().filter((m) => m.user_id === state.uid && m.meal_date === date).map((m) => m.meal_type));
  const yay = date === today && MAIN_MEALS.every((k) => myTypes.has(k)) ? `
    <div class="card yay">${cat({ size: 58, mood: 'love' })}<div><b>Hôm nay ăn đủ bữa rồi!</b><small>Giỏi quá trời luôn, thưởng một trái tim 💗</small></div></div>` : '';

  const waiting = !p2 ? `
    <div class="card invite-card">
      ${cat({ size: 64, mood: 'hungry' })}
      <div><b>Đang chờ người thương vào app 💌</b>
      <small>Gửi link app và mã mời cho người ấy để cùng đăng bữa ăn nha.</small>
      <button class="btn small primary" data-action="copy-link">Sao chép link app</button></div>
    </div>` : '';

  const sections = MEALS.map((meal) => {
    const list = mealsOn(date).filter((m) => m.meal_type === meal.key);
    const iCanAdd = canPost && (state.filter === 'all' || state.filter === state.uid);
    const cards = list.map(postCard).join('');
    let body;
    if (list.length) {
      body = `<div class="post-row">${cards}${iCanAdd ? `<button class="add-card" data-new="${meal.key}" aria-label="Đăng thêm ${meal.name}">${ICONS.plus}</button>` : ''}</div>`;
    } else if (iCanAdd) {
      body = `<button class="empty-card" data-new="${meal.key}">${cat({ size: 46, mood: 'hungry' })}<span><b>Chưa có gì nè</b><small>Chạm để đăng ${meal.name.toLowerCase()}</small></span></button>`;
    } else {
      body = `<div class="empty-note">Không có bài nào</div>`;
    }
    return `
      <section class="meal-sec" style="--mc: var(--m-${meal.key})">
        <div class="meal-head">
          <span class="meal-ico">${meal.icon}</span>
          <div class="meal-title"><b>${meal.name}</b><small>${meal.range}</small></div>
          ${list.length ? `<span class="meal-count">${list.length}</span>` : ''}
        </div>
        ${body}
      </section>`;
  }).join('');

  return `
    <div class="day-head">
      <button class="icon-btn" data-day="-1" aria-label="Ngày trước">${ICONS.left}</button>
      <div class="day-title">
        <div class="day-rel">${relDay(date, today)}</div>
        <div class="day-date">${fmtDayLong(date)}</div>
      </div>
      <button class="icon-btn" data-day="1" aria-label="Ngày sau" ${date >= today ? 'disabled' : ''}>${ICONS.right}</button>
    </div>
    ${date !== today ? `<div class="back-today"><a href="#/" class="pill">↩ Về hôm nay</a></div>` : ''}
    ${pills}
    ${waiting}
    ${seg}
    ${progress}
    ${yay}
    ${sections}
    <div class="bottom-space"></div>`;
}

function postCard(m) {
  const hc = heartCount(m.id);
  const cc = commentCount(m.id);
  const isVideo = m.media_type === 'video';
  const thumb = m.thumb_path || (!isVideo ? m.media_path : null);
  return `
    <button class="post-card" data-open="${m.id}" aria-label="Xem bài của ${esc(nameOf(m.user_id))} lúc ${fmtTime(m.created_at)}">
      <span class="ph">${thumb ? `<img data-path="${esc(thumb)}" alt="" loading="lazy">` : `<span class="ph-video">🎬</span>`}</span>
      ${isVideo ? `<span class="pc-play">${ICONS.play}</span>` : ''}
      ${hc || cc ? `<span class="pc-meta">${hc ? `❤️${hc > 1 ? hc : ''}` : ''}${cc ? ` 💬${cc}` : ''}</span>` : ''}
      <span class="pc-who">${esc(avatarOf(m.user_id))}</span>
      <span class="pc-time">${fmtTime(m.created_at)}</span>
      ${m.mood ? `<span class="pc-mood">${esc(m.mood)}</span>` : ''}
    </button>`;
}

// ============================================================ NHẬT KÝ (lịch tháng)
function viewCalendar() {
  const today = mealDay();
  const month = state.route.month || today.slice(0, 7);
  const first = `${month}-01`;
  const lead = (weekdayOf(first) + 6) % 7; // bắt đầu từ thứ hai
  const n = daysInMonth(month);
  const ps = people();
  const byDay = new Map();
  for (const m of allMeals()) {
    if (!m.meal_date.startsWith(month)) continue;
    if (!byDay.has(m.meal_date)) byDay.set(m.meal_date, []);
    byDay.get(m.meal_date).push(m);
  }
  const fullSets = new Map(ps.map((p) => [p.id, computeStreak(allMeals(), p.id, today).fullDays]));

  let cells = '';
  for (let i = 0; i < lead; i++) cells += `<span class="cell blank"></span>`;
  for (let d = 1; d <= n; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    const list = (byDay.get(date) || []).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const future = date > today;
    const cover = list.find((m) => m.thumb_path || m.media_type === 'image');
    const dots = ps.map((p) => {
      const cnt = list.filter((m) => m.user_id === p.id).length;
      const full = fullSets.get(p.id)?.has(date);
      return `<i class="${full ? 'full' : cnt ? 'some' : ''}" title="${esc(p.display_name)}"></i>`;
    }).join('');
    cells += `
      <button class="cell ${date === today ? 'today' : ''} ${cover ? 'has-cover' : ''}" ${future ? 'disabled' : ''} data-goday="${date}">
        ${cover ? `<img data-path="${esc(cover.thumb_path || cover.media_path)}" alt="" loading="lazy">` : ''}
        <span class="num">${d}</span>
        ${list.length ? `<span class="cnt">${list.length}</span>` : ''}
        <span class="dots">${dots}</span>
      </button>`;
  }

  const monthMeals = allMeals().filter((m) => m.meal_date.startsWith(month));
  const stats = ps.map((p) => {
    const mine = monthMeals.filter((m) => m.user_id === p.id);
    const fullDays = [...(fullSets.get(p.id) || [])].filter((d) => d.startsWith(month)).length;
    return `<div class="stat"><span class="stat-av">${esc(p.avatar)}</span><div><b>${esc(p.display_name)}</b>
      <small>${mine.length} bữa · ăn đủ bữa ${fullDays} ngày</small></div></div>`;
  }).join('');

  const nextDisabled = month >= today.slice(0, 7);
  return `
    <div class="cal-head">
      <button class="icon-btn" data-month="${addMonths(month, -1)}" aria-label="Tháng trước">${ICONS.left}</button>
      <h2>${monthTitle(month)}</h2>
      <button class="icon-btn" data-month="${addMonths(month, 1)}" aria-label="Tháng sau" ${nextDisabled ? 'disabled' : ''}>${ICONS.right}</button>
    </div>
    <div class="card cal-card">
      <div class="cal-grid wk">${['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((w) => `<span>${w}</span>`).join('')}</div>
      <div class="cal-grid">${cells}</div>
      <div class="cal-legend"><span><i class="full"></i> ăn đủ 3 bữa chính</span><span><i class="some"></i> có đăng</span></div>
    </div>
    <div class="card stats-card"><h3>Tháng này</h3>${stats || '<p class="muted">Chưa có ai</p>'}</div>
    <div class="bottom-space"></div>`;
}

// ============================================================ HAI ĐỨA
function viewUs() {
  const today = mealDay();
  const ps = people();
  const love = loveInfo(state.settings?.start_date);
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
    if (love.future) extra = `<p>Ngày bắt đầu ở tương lai? Sửa lại trong Cài đặt nha.</p>`;
    else if (love.todayIsAnniv) extra = `<p class="hl">🎉 Hôm nay là kỷ niệm ${love.yearsNow} năm! Chúc mừng hai đứa 💍</p>`;
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

  const streaks = ps.map((p) => {
    const st = computeStreak(allMeals(), p.id, today);
    const total = allMeals().filter((m) => m.user_id === p.id);
    const vids = total.filter((m) => m.media_type === 'video').length;
    const fav = favoriteMeal(total);
    return `
      <div class="card streak-card">
        <div class="sc-top"><span class="sc-av">${esc(p.avatar)}</span><b>${esc(p.display_name)}</b></div>
        <div class="sc-fire">${ICONS.fire}<span><b>${st.current}</b> ngày</span></div>
        <small>ăn đủ bữa liên tiếp</small><small>kỷ lục: ${st.best} ngày</small>
        <div class="sc-today"><span>Hôm nay</span><span class="sc-icons">${MAIN_MEALS.map((k) => `<i class="${st.todayTypes.has(k) ? 'on' : ''}">${MEAL_BY_KEY[k].icon}</i>`).join('')}</span></div>
        <div class="sc-stats"><span><b>${total.length}</b> bữa</span><span><b>${total.length - vids}</b> ảnh</span><span><b>${vids}</b> video</span></div>
        ${fav ? `<small class="sc-fav">Hay đăng nhất: ${fav.icon} ${fav.name.toLowerCase()}</small>` : ''}
      </div>`;
  }).join('');

  const loved = allMeals().filter((m) => heartCount(m.id) + commentCount(m.id) > 0)
    .sort((a, b) => (heartCount(b.id) * 2 + commentCount(b.id)) - (heartCount(a.id) * 2 + commentCount(a.id)) || b.created_at.localeCompare(a.created_at))
    .slice(0, 6);

  return `
    <h2 class="page-title">Hai đứa mình 💞</h2>
    ${loveCard}
    <div class="streak-grid">${streaks}</div>
    ${loved.length ? `<div class="card"><h3>Được thương nhiều nhất 💗</h3><div class="post-row wrap">${loved.map(postCard).join('')}</div></div>` : ''}
    ${ps.length < 2 ? `<div class="card invite-card">${cat({ size: 60, mood: 'hungry' })}<div><b>Còn thiếu một người nè</b><small>Gửi link app và mã mời cho người thương nha.</small>
      <button class="btn small primary" data-action="copy-link">Sao chép link app</button></div></div>` : ''}
    <div class="bottom-space"></div>`;
}

function favoriteMeal(list) {
  if (!list.length) return null;
  const count = {};
  for (const m of list) count[m.meal_type] = (count[m.meal_type] || 0) + 1;
  const key = Object.entries(count).sort((a, b) => b[1] - a[1])[0][0];
  return MEAL_BY_KEY[key];
}

// ============================================================ CÀI ĐẶT
function viewSettings() {
  const p = me();
  const s = state.settings || {};
  const used = allMeals().reduce((n, m) => n + (Number(m.bytes) || 0), 0);
  const limit = CONFIG.STORAGE_LIMIT_MB * 1024 * 1024;
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const t = (v) => (v || '').slice(0, 5);
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
    <h2 class="page-title">Cài đặt ⚙️</h2>

    <div class="card form-card">
      <h3>Hồ sơ của mình</h3>
      <label class="field"><span>Tên gọi</span><input id="my-name" maxlength="40" value="${esc(p.display_name)}"></label>
      <div class="field"><span>Linh vật</span>
        <div class="avatar-pick">${AVATARS.map((a) => `<button type="button" class="av-opt ${a === p.avatar ? 'on' : ''}" data-myav="${a}">${a}</button>`).join('')}</div>
      </div>
      <button class="btn primary" data-action="save-profile">Lưu hồ sơ</button>
    </div>

    <div class="card form-card">
      <h3>Của chung hai đứa</h3>
      <label class="field"><span>Tên app</span><input id="app-name" maxlength="40" value="${esc(s.app_name || 'Bé ăn chưa?')}"></label>
      <label class="field"><span>Ngày bắt đầu yêu 💘</span><input id="start-date" type="date" value="${esc(s.start_date || '')}" max="${mealDay()}"></label>
      <button class="btn primary" data-action="save-couple">Lưu</button>
    </div>

    <div class="card form-card">
      <h3>${ICONS.bell} Thông báo</h3>
      <p class="hint">Báo khi người kia đăng bữa ăn, thả tim, bình luận và nhắc giờ ăn.</p>
      <p>${pushStatus}</p>
      <div class="btn-row">
        ${!state.pushOn ? `<button class="btn primary" data-action="enable-push" ${(ios && !standalone) || !pushSupported ? 'disabled' : ''}>Bật thông báo</button>` : ''}
        ${state.pushOn ? `<button class="btn ghost" data-action="test-push">Gửi thử</button>` : ''}
      </div>
    </div>

    <div class="card form-card">
      <h3>⏰ Nhắc giờ ăn</h3>
      <p class="hint">Tới giờ mà chưa đăng bữa đó thì mèo nhắc. Dùng chung cho cả hai.</p>
      <label class="switch-row"><span>Bật nhắc giờ ăn</span>
        <input type="checkbox" id="rem-on" ${s.reminders_enabled !== false ? 'checked' : ''}><i class="switch"></i></label>
      <div class="time-grid">
        <label class="field"><span>🍳 Sáng</span><input type="time" id="rem-sang" value="${t(s.remind_sang) || '09:30'}"></label>
        <label class="field"><span>🍱 Trưa</span><input type="time" id="rem-trua" value="${t(s.remind_trua) || '13:00'}"></label>
        <label class="field"><span>🍲 Tối</span><input type="time" id="rem-toi" value="${t(s.remind_toi) || '20:00'}"></label>
      </div>
      <button class="btn primary" data-action="save-reminders">Lưu giờ nhắc</button>
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
  // iOS bắt buộc hỏi quyền ngay trong lần chạm, nên gọi trước mọi thứ khác
  let perm = 'default';
  try {
    perm = await Notification.requestPermission();
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

// ============================================================ lớp phủ (đăng bài / xem bài / sheet)
function overlayRoot() {
  return document.getElementById('overlays');
}

function openOverlay(kind, html, { pushed, id } = {}) {
  const root = overlayRoot();
  root.innerHTML = `<div class="overlay ${kind}" data-kind="${kind}"><div class="backdrop" data-action="close-overlay"></div><div class="sheet-wrap">${html}</div></div>`;
  state.overlay = { kind, pushed: !!pushed, id };
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

/** Đóng lớp phủ: nếu đã thêm vào lịch sử thì lùi lại (nút Back của Android cũng hoạt động) */
function closeOverlay() {
  const ov = state.overlay;
  if (!ov) return;
  if (ov.pushed) {
    history.back();
  } else {
    const r = state.route;
    const base = r.name === 'cal' ? `#/cal${r.month ? '/' + r.month : ''}` : r.name === 'us' ? '#/us' : r.name === 'settings' ? '#/settings' : r.date ? `#/day/${r.date}` : '#/';
    if (/^#\/(p|new)\b/.test(location.hash)) history.replaceState(null, '', base);
    closeOverlayDom();
  }
}

function navOverlay(hash) {
  // mở lớp phủ có thêm vào lịch sử
  state.pendingPush = true;
  location.hash = hash;
}

// ------------------------------------------------------------ Đăng bữa
function openComposer(mealKey, _fromRoute) {
  const pushed = !!state.pendingPush;
  state.pendingPush = false;
  if (state.overlay?.kind === 'composer') return;
  state.composer = {
    meal: mealKey || mealForTime(),
    day: 'today',
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
        <h3>Đăng bữa ăn ${MEAL_BY_KEY[c.meal].icon}</h3>
        <button class="icon-btn" data-action="close-overlay" aria-label="Đóng">${ICONS.close}</button>
      </div>
      ${mediaBlock}
      <div class="field"><span>Bữa nào nè?</span>
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
        ${c.busy ? `Đang gửi… ${Math.round(c.progress * 100)}%` : 'Đăng nè 💌'}
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
    const before = MAIN_MEALS.filter((k) => allMeals().some((m) => m.user_id === state.uid && m.meal_date === mealDate && m.meal_type === k && m.id !== row.id)).length;
    const after = MAIN_MEALS.filter((k) => allMeals().some((m) => m.user_id === state.uid && m.meal_date === mealDate && m.meal_type === k)).length;
    if (c.media.previewUrl) URL.revokeObjectURL(c.media.previewUrl);
    closeOverlay();
    const target = mealDate === mealDay() ? '#/' : `#/day/${mealDate}`;
    setTimeout(() => {
      if (location.hash !== target && !(target === '#/' && (location.hash === '' || location.hash === '#/'))) location.hash = target;
      else renderView();
      if (after === 3 && before < 3) {
        hearts(window.innerWidth / 2, window.innerHeight * 0.55, 26, ['🎉', '💗', '🍚', '✨', '🐾']);
        toast('Ăn đủ 3 bữa rồi, giỏi quá trời! 🎉', 'ok', 3600);
      } else {
        hearts(window.innerWidth / 2, window.innerHeight * 0.6, 12);
        toast('Đăng rồi nè! 🐱');
      }
    }, 120);
  } catch (e) {
    c.busy = false;
    rerenderComposer();
    toast(e.message, 'error', 4500);
    api.removeFiles([mediaPath, thumbPath]).catch(() => {});
  }
}

// ------------------------------------------------------------ Xem bài
function openViewer(id, _fromRoute) {
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
  const cmts = state.comments.get(m.id) || [];
  const meal = MEAL_BY_KEY[m.meal_type];
  const existingMedia = body.querySelector('.v-media');
  const sameMedia = existingMedia && existingMedia.dataset.mid === m.id;

  const mediaHtml = m.media_type === 'video'
    ? `<video data-path="${esc(m.media_path)}" ${m.thumb_path ? `data-poster="${esc(m.thumb_path)}"` : ''} controls playsinline preload="metadata"></video>
       <p class="v-error" hidden>Máy này không phát được video 😿 iPhone: Cài đặt → Camera → Định dạng → Tương thích nhất.</p>`
    : `<img data-path="${esc(m.media_path)}" alt="Ảnh bữa ăn" class="dbl-heart">`;

  const whoHearted = [...hs.keys()].map((u) => `${esc(avatarOf(u))} ${esc(nameOf(u))}`).join(', ');
  const restHtml = `
    <div class="v-body">
      ${m.caption || m.mood ? `<p class="v-caption">${m.mood ? `<span class="v-mood">${esc(m.mood)}</span>` : ''}${esc(m.caption || '')}</p>` : ''}
      <div class="v-actions">
        <button class="heart-btn ${iHeart ? 'on' : ''}" data-action="toggle-heart" aria-pressed="${iHeart}">${iHeart ? ICONS.heartFill : ICONS.heart}<span>${hs.size || ''}</span></button>
        <span class="v-hearted">${whoHearted ? `${whoHearted} đã thả tim` : 'Chạm 2 lần vào ảnh để thả tim'}</span>
      </div>
      <div class="comments">
        ${cmts.map((c) => `
          <div class="cmt ${c.user_id === state.uid ? 'mine' : ''}">
            <span class="cmt-av">${esc(avatarOf(c.user_id))}</span>
            <div class="cmt-bubble"><b>${esc(nameOf(c.user_id))}</b><p>${esc(c.body)}</p><small>${timeAgo(c.created_at)}</small></div>
            ${c.user_id === state.uid ? `<button class="cmt-del" data-delcmt="${c.id}" aria-label="Xoá bình luận">${ICONS.trash}</button>` : ''}
          </div>`).join('') || `<p class="muted small-note">Chưa có bình luận. Khen một câu đi nè 😚</p>`}
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
  } else {
    body.innerHTML = `${headHtml}<div class="v-media" data-mid="${m.id}">${mediaHtml}</div>${restHtml}`;
    const vid = body.querySelector('video');
    vid?.addEventListener('error', () => body.querySelector('.v-error')?.removeAttribute('hidden'));
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

async function sendComment(form) {
  const input = form.querySelector('input');
  const text = input.value.trim();
  const id = state.overlay?.id;
  if (!text || !id) return;
  input.value = '';
  state.viewerDraft = '';
  const btn = form.querySelector('button');
  btn.disabled = true;
  try {
    const c = await api.addComment(id, text);
    addCommentState(c);
    renderViewer();
    document.querySelector('.comments .cmt:last-child')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    input.value = text;
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
  }
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

// ------------------------------------------------------------ Chào mừng lần đầu
function maybeWelcome() {
  const key = `bac-welcome-${state.uid}`;
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
  } catch {
    return;
  }
  if (/^#\/(p|new)\//.test(location.hash)) return;
  const ios = isIOS();
  const standalone = isStandalone();
  const install = standalone ? '' : ios ? `<h4>1. Thêm app ra màn hình chính</h4>${iosInstallSteps()}` : isAndroid()
    ? `<h4>1. Cài app ra màn hình chính</h4><p class="hint">Chrome: menu ⋮ → <b>Thêm vào màn hình chính</b>, hoặc bấm nút dưới.</p>
       <button class="btn ghost" data-action="install" ${state.installPrompt ? '' : 'disabled'}>Cài app</button>`
    : '';
  openOverlay('info', `
    <div class="sheet welcome-sheet">
      <div class="grab"></div>
      <div class="center">${cat({ size: 100, mood: 'love', bowl: true })}</div>
      <h3 class="center">Chào ${esc(me().display_name)}! 🐾</h3>
      <p class="center muted">Mỗi bữa ăn chụp một tấm cho người thương xem nha.</p>
      ${install}
      <h4>${install ? '2' : '1'}. Bật thông báo</h4>
      <p class="hint">Để biết khi người ấy đăng bữa ăn và được nhắc giờ ăn. ${ios && !standalone ? 'Trên iPhone cần làm bước 1 trước, rồi vào Cài đặt trong app để bật.' : ''}</p>
      <div class="btn-row">
        ${!(ios && !standalone) ? `<button class="btn ghost" data-action="enable-push">Bật thông báo</button>` : ''}
        <button class="btn primary" data-action="close-overlay">Bắt đầu thôi 💕</button>
      </div>
    </div>`);
}

// ============================================================ sự kiện
document.addEventListener('click', async (e) => {
  const t = e.target.closest('button, a, [data-action], label');
  if (!t) return;

  if (t.dataset.authMode) return showAuth(t.dataset.authMode);
  if (t.classList.contains('av-opt') && t.closest('.avatar-pick')) {
    t.closest('.avatar-pick').querySelectorAll('.av-opt').forEach((b) => b.classList.toggle('on', b === t));
    return;
  }
  if (t.dataset.filter) {
    state.filter = t.dataset.filter;
    renderView();
    return;
  }
  if (t.dataset.day) {
    const today = mealDay();
    const cur = state.route.date || today;
    const next = addDays(cur, Number(t.dataset.day));
    location.hash = next >= today ? '#/' : `#/day/${next}`;
    return;
  }
  if (t.dataset.month) {
    location.hash = `#/cal/${t.dataset.month}`;
    return;
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
  if (t.dataset.delcmt) {
    if (!confirm('Xoá bình luận này nha?')) return;
    try {
      await api.deleteComment(t.dataset.delcmt);
      removeCommentById(t.dataset.delcmt);
      renderViewer();
      scheduleRender();
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }
  if (t.dataset.myav) {
    t.closest('.avatar-pick').querySelectorAll('.av-opt').forEach((b) => b.classList.toggle('on', b === t));
    return;
  }

  const action = t.dataset.action;
  if (!action) return;
  switch (action) {
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
    case 'new':
      navOverlay(`#/new/${mealForTime()}`);
      break;
    case 'close-overlay':
      closeOverlay();
      break;
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
    case 'save-profile': {
      const name = document.getElementById('my-name').value.trim();
      const avatar = document.querySelector('[data-myav].on')?.dataset.myav || me().avatar;
      if (!name) return toast('Tên gọi không được trống nha', 'error');
      try {
        const p = await api.updateProfile(state.uid, { display_name: name, avatar });
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
    case 'save-reminders': {
      try {
        state.settings = await api.updateSettings({
          reminders_enabled: document.getElementById('rem-on').checked,
          remind_sang: document.getElementById('rem-sang').value || '09:30',
          remind_trua: document.getElementById('rem-trua').value || '13:00',
          remind_toi: document.getElementById('rem-toi').value || '20:00',
        });
        toast('Đã lưu giờ nhắc ⏰');
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
  } else if (e.target.id === 'cmt-form') {
    e.preventDefault();
    sendComment(e.target);
  }
});

document.addEventListener('change', (e) => {
  if (e.target.matches('input[data-pick]')) onPickFile(e.target);
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

// Phím Esc trên máy tính
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.overlay) closeOverlay();
});
