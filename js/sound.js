// Tiếng mèo kêu trong app (khi app đang mở trên màn hình).
// Lúc app đóng, điện thoại dùng âm báo mặc định của hệ thống — web app không đổi được âm đó.
const FILES = { meow: 'sounds/meow.mp3', meow2: 'sounds/meow2.mp3' };
const KEY = 'bac-sound';
const RATE = { msg: 1.08, heart: 1.2, report: 1.04, remind: 1, buzz: 1, cycle: 0.93, test: 1 };

let ctx = null;
let loading = null;
let lastAt = 0;
const buffers = {};

export function soundOn() {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSoundOn(on) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch { /* bỏ qua */ }
}

function audioCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

function load() {
  if (loading) return loading;
  const c = audioCtx();
  if (!c) return Promise.resolve();
  loading = Promise.all(Object.entries(FILES).map(async ([name, url]) => {
    const res = await fetch(url);
    const data = await res.arrayBuffer();
    buffers[name] = await new Promise((ok, bad) => c.decodeAudioData(data, ok, bad));
  })).catch(() => {
    loading = null; // lần sau thử lại
  });
  return loading;
}

/** Gọi trong một lần chạm của người dùng (iPhone cần vậy mới cho phát âm thanh) */
export function unlockSound() {
  const c = audioCtx();
  if (!c) return;
  if (c.state !== 'running') c.resume().catch(() => {});
  try {
    const src = c.createBufferSource();
    src.buffer = c.createBuffer(1, 1, 22050);
    src.connect(c.destination);
    src.start(0);
  } catch { /* bỏ qua */ }
  load();
}

/** Meo! kind: msg | heart | report | remind | buzz | cycle | test */
export async function meow(kind = 'msg', { force = false } = {}) {
  if (!force && !soundOn()) return;
  const now = Date.now();
  if (!force && now - lastAt < 1200) return; // nhiều tin tới cùng lúc thì kêu một lần thôi
  lastAt = now;
  const c = audioCtx();
  if (!c) return;
  if (c.state !== 'running') {
    try {
      await c.resume();
    } catch {
      return;
    }
  }
  await load();
  const buf = buffers[kind === 'buzz' ? 'meow2' : 'meow'];
  if (!buf) return;
  const src = c.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = RATE[kind] || 1;
  const gain = c.createGain();
  gain.gain.value = kind === 'buzz' || kind === 'test' ? 1 : 0.75;
  src.connect(gain).connect(c.destination);
  src.start();
}
