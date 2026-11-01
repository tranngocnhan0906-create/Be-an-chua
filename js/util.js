// Tiện ích chung: bữa ăn, ngày giờ, chuỗi ngày, escape HTML

export const MEALS = [
  { key: 'sang',  name: 'Bữa sáng',  short: 'Sáng',  icon: '🍳', range: '5:00 – 10:00' },
  { key: 'trua',  name: 'Bữa trưa',  short: 'Trưa',  icon: '🍱', range: '10:00 – 14:00' },
  { key: 'chieu', name: 'Bữa chiều', short: 'Chiều', icon: '🧋', range: '14:00 – 17:00' },
  { key: 'toi',   name: 'Bữa tối',   short: 'Tối',   icon: '🍲', range: '17:00 – 21:00' },
  { key: 'khuya', name: 'Ăn khuya',  short: 'Khuya', icon: '🍜', range: '21:00 – 5:00' },
];
export const MEAL_BY_KEY = Object.fromEntries(MEALS.map((m) => [m.key, m]));
export const MAIN_MEALS = ['sang', 'trua', 'toi'];
export const DAY_START_HOUR = 5; // ăn khuya sau nửa đêm vẫn tính cho ngày hôm trước

export const MOODS = ['😋', '🤤', '😍', '🥰', '😌', '🥲', '😵‍💫', '🤢'];
export const AVATARS = ['🐱', '🐶', '🐰', '🐻', '🐼', '🐷', '🐥', '🦊', '🐹', '🐨', '🐸', '🦄'];

export function mealForTime(d = new Date()) {
  const h = d.getHours();
  if (h >= 5 && h < 10) return 'sang';
  if (h >= 10 && h < 14) return 'trua';
  if (h >= 14 && h < 17) return 'chieu';
  if (h >= 17 && h < 21) return 'toi';
  return 'khuya';
}

const pad = (n) => String(n).padStart(2, '0');

export function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "Ngày bữa ăn" hiện tại theo giờ máy (bắt đầu lúc 5h sáng) */
export function mealDay(d = new Date()) {
  return ymd(new Date(d.getTime() - DAY_START_HOUR * 3600e3));
}

function utcMs(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(s, n) {
  const d = new Date(utcMs(s) + n * 86400e3);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function daysBetween(a, b) {
  return Math.round((utcMs(b) - utcMs(a)) / 86400e3);
}

export function weekdayOf(s) {
  return new Date(utcMs(s)).getUTCDay(); // 0 = Chủ nhật
}

const WEEKDAYS = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
export const WEEKDAYS_SHORT = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

export function fmtDayLong(s) {
  const [y, m, d] = s.split('-');
  return `${WEEKDAYS[weekdayOf(s)]}, ${d}/${m}${y !== String(new Date().getFullYear()) ? '/' + y : ''}`;
}

export function fmtDmy(s) {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

export function relDay(s, today = mealDay()) {
  const diff = daysBetween(s, today);
  if (diff === 0) return 'Hôm nay';
  if (diff === 1) return 'Hôm qua';
  if (diff === 2) return 'Hôm kia';
  if (diff === -1) return 'Ngày mai';
  if (diff > 0 && diff < 7) return `${diff} ngày trước`;
  return WEEKDAYS[weekdayOf(s)];
}

export function fmtTime(iso) {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function timeAgo(iso) {
  const d = new Date(iso);
  const sec = (Date.now() - d.getTime()) / 1000;
  if (sec < 60) return 'vừa xong';
  if (sec < 3600) return `${Math.floor(sec / 60)} phút trước`;
  if (sec < 6 * 3600) return `${Math.floor(sec / 3600)} giờ trước`;
  const day = ymd(d);
  const today = ymd(new Date());
  if (day === today) return `hôm nay ${fmtTime(iso)}`;
  if (daysBetween(day, today) === 1) return `hôm qua ${fmtTime(iso)}`;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${fmtTime(iso)}`;
}

export function monthTitle(ym) {
  const [y, m] = ym.split('-');
  return `Tháng ${Number(m)}, ${y}`;
}

export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

export function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function fmtBytes(n) {
  if (!n) return '0 MB';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Chuỗi ngày "ăn đủ bữa" (đủ sáng + trưa + tối) của một người */
export function computeStreak(meals, uid, today = mealDay()) {
  const byDay = new Map();
  for (const m of meals) {
    if (m.user_id !== uid) continue;
    if (!byDay.has(m.meal_date)) byDay.set(m.meal_date, new Set());
    byDay.get(m.meal_date).add(m.meal_type);
  }
  const full = (d) => {
    const s = byDay.get(d);
    return !!s && MAIN_MEALS.every((k) => s.has(k));
  };
  let current = 0;
  let d = full(today) ? today : addDays(today, -1);
  while (full(d)) {
    current++;
    d = addDays(d, -1);
  }
  let best = 0;
  let run = 0;
  let prev = null;
  for (const day of [...byDay.keys()].filter(full).sort()) {
    run = prev && daysBetween(prev, day) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = day;
  }
  const todaySet = byDay.get(today);
  return {
    current,
    best,
    todayDone: full(today),
    todayCount: MAIN_MEALS.filter((k) => todaySet?.has(k)).length,
    todayTypes: todaySet ?? new Set(),
    fullDays: new Set([...byDay.keys()].filter(full)),
  };
}

/** Số ngày bên nhau (ngày bắt đầu tính là ngày 1) và các cột mốc sắp tới */
export function loveInfo(startDate, today = ymd(new Date())) {
  if (!startDate) return null;
  const days = daysBetween(startDate, today) + 1;
  if (days < 1) return { days: 0, future: true };
  const next100 = Math.ceil((days + (days % 100 === 0 ? 1 : 0)) / 100) * 100;
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ty] = today.split('-').map(Number);
  let years = ty - sy;
  let anniv = `${ty}-${pad(sm)}-${pad(sd)}`;
  if (daysBetween(today, anniv) <= 0) {
    years += 1;
    anniv = `${ty + 1}-${pad(sm)}-${pad(sd)}`;
  }
  // ngày 29/2 ở năm không nhuận -> addDays sẽ tự trôi sang 1/3, chấp nhận được
  const todayIsAnniv = today.slice(5) === startDate.slice(5) && today !== startDate;
  return {
    days,
    isMilestone: days % 100 === 0,
    todayIsAnniv,
    yearsNow: ty - sy - (today.slice(5) < startDate.slice(5) ? 1 : 0),
    next100,
    daysTo100: next100 - days,
    nextAnnivYears: years,
    daysToAnniv: daysBetween(today, anniv),
  };
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = () => /android/i.test(navigator.userAgent);
export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

// ====================================================================== GIỜ ĂN & TRỄ BỮA
export const SCHED_KEYS = { sang: 'sched_sang', trua: 'sched_trua', toi: 'sched_toi' };
export const SCHED_DEFAULT = { sang: '07:30', trua: '12:00', toi: '19:00' };

/** Giờ ăn chuẩn (phút trong ngày) của một bữa chính, null nếu là bữa phụ */
export function schedMinutes(settings, mealKey) {
  if (!SCHED_KEYS[mealKey]) return null;
  const t = String(settings?.[SCHED_KEYS[mealKey]] || SCHED_DEFAULT[mealKey]);
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

export function fmtHM(minutes) {
  return `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
}

/** Thời điểm giờ ăn chuẩn của ngày dateStr (giờ máy) */
export function schedDate(dateStr, minutes) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, 0, minutes, 0, 0);
}

/** "25 phút", "1 giờ 20 phút", "3 giờ" */
export function fmtDur(min) {
  const v = Math.max(0, Math.round(min));
  if (v < 60) return `${v} phút`;
  const h = Math.floor(v / 60);
  const m = v % 60;
  return m ? `${h} giờ ${m} phút` : `${h} giờ`;
}

/** Nhãn đúng giờ/trễ cho số phút lệch so với giờ ăn chuẩn */
export function lateInfo(late) {
  if (late <= -16) return { cls: 'early', icon: '👍', text: `Sớm ${fmtDur(-late)}` };
  if (late <= 15) return { cls: 'ontime', icon: '✅', text: 'Đúng giờ' };
  if (late < 60) return { cls: 'late', icon: '⏰', text: `Trễ ${fmtDur(late)}` };
  if (late < 12 * 60) return { cls: 'late2', icon: '⏰', text: `Trễ ${fmtDur(late)}` };
  return { cls: 'late2', icon: '🕒', text: 'Đăng bù' };
}

// ====================================================================== CHỊ 🍓 (chu kỳ)
/**
 * Dự đoán chu kỳ từ lịch sử. Trung bình tối đa 6 kỳ gần nhất; ít dữ liệu thì dùng số mặc định.
 * Trả về null nếu chưa có kỳ nào.
 */
export function cyclePredict(cycles, cycleLen = 28, periodLen = 5) {
  const list = [...(cycles || [])].sort((a, b) => a.start_date.localeCompare(b.start_date));
  if (!list.length) return null;
  const lens = [];
  for (let i = 1; i < list.length; i++) {
    const d = daysBetween(list[i - 1].start_date, list[i].start_date);
    if (d >= 18 && d <= 60) lens.push(d);
  }
  const recent = lens.slice(-6);
  const avgCycle = recent.length ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length) : cycleLen;
  const plens = list.filter((c) => c.end_date).map((c) => daysBetween(c.start_date, c.end_date) + 1)
    .filter((n) => n >= 2 && n <= 12).slice(-6);
  const avgPeriod = plens.length ? Math.round(plens.reduce((a, b) => a + b, 0) / plens.length) : periodLen;
  const last = list[list.length - 1];
  const nextStart = addDays(last.start_date, avgCycle);
  const ovulation = addDays(nextStart, -14);
  const future = [];
  for (let k = 1; k <= 4; k++) {
    const s = addDays(last.start_date, avgCycle * k);
    const ov = addDays(s, -14);
    future.push({
      start: s,
      end: addDays(s, avgPeriod - 1),
      ovulation: ov,
      fertileStart: addDays(ov, -5),
      fertileEnd: addDays(ov, 1),
      pmsStart: addDays(s, -3),
    });
  }
  return {
    list, last, avgCycle, avgPeriod, nextStart, ovulation,
    fertileStart: addDays(ovulation, -5), fertileEnd: addDays(ovulation, 1), pmsStart: addDays(nextStart, -3),
    future, samples: recent.length,
  };
}

/** Trạng thái hôm nay để hiển thị */
export function cycleStatus(pred, today) {
  if (!pred) return { phase: 'nodata' };
  const last = pred.last;
  const since = daysBetween(last.start_date, today);
  const inLogged = last.end_date ? since >= 0 && today <= last.end_date : since >= 0 && since < 12;
  if (inLogged) {
    return { phase: 'period', day: since + 1, ongoing: !last.end_date };
  }
  const toNext = daysBetween(today, pred.nextStart);
  if (toNext < 0) return { phase: 'late', lateBy: -toNext, toNext };
  if (toNext === 0) return { phase: 'due', toNext };
  if (today === pred.ovulation) return { phase: 'ovulation', toNext };
  if (today >= pred.fertileStart && today <= pred.fertileEnd) return { phase: 'fertile', toNext };
  if (toNext <= 3) return { phase: 'pms', toNext };
  return { phase: 'normal', toNext };
}

/** Lớp màu cho một ngày trên lịch chị 🍓 */
export function cycleDayKinds(date, pred, today) {
  const kinds = new Set();
  if (!pred) return kinds;
  for (const c of pred.list) {
    let end = c.end_date;
    if (!end) {
      const guess = addDays(c.start_date, pred.avgPeriod - 1);
      end = c === pred.last && today < guess ? guess : (c === pred.last ? (today > guess ? today : guess) : guess);
      if (c === pred.last && daysBetween(c.start_date, today) >= 12) end = guess;
    }
    if (date >= c.start_date && date <= end) {
      kinds.add(c.end_date || date <= today ? 'period' : 'period-pred');
    }
  }
  if (kinds.size) return kinds;
  for (const f of pred.future) {
    if (date >= f.start && date <= f.end) kinds.add('period-pred');
    if (date === f.ovulation) kinds.add('ovulation');
    else if (date >= f.fertileStart && date <= f.fertileEnd) kinds.add('fertile');
    if (date >= f.pmsStart && date < f.start) kinds.add('pms');
  }
  return kinds;
}
