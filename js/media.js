// Xử lý ảnh/video ngay trên điện thoại trước khi tải lên:
// - Ảnh: thu nhỏ còn 1600px (~300KB) + ảnh nhỏ 480px cho danh sách
// - Video: kiểm tra độ dài/dung lượng, chụp 1 khung hình làm ảnh bìa

import { CONFIG } from './config.js';

const MAX_SIDE = 1600;
const THUMB_SIDE = 480;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Không đọc được ảnh này 😿 Thử chọn ảnh khác nha.'));
    };
    img.src = url;
  });
}

function drawScaled(source, sw, sh, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  return c;
}

function toJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Nén ảnh không thành công'))), 'image/jpeg', quality);
  });
}

export async function processImage(file) {
  const { img, url } = await loadImage(file);
  try {
    const sw = img.naturalWidth;
    const sh = img.naturalHeight;
    if (!sw || !sh) throw new Error('Ảnh bị lỗi 😿');
    const full = drawScaled(img, sw, sh, MAX_SIDE);
    const main = await toJpeg(full, 0.82);
    const thumbCanvas = drawScaled(full, full.width, full.height, THUMB_SIDE);
    const thumb = await toJpeg(thumbCanvas, 0.78);
    return {
      kind: 'image',
      main,
      thumb,
      contentType: 'image/jpeg',
      width: full.width,
      height: full.height,
      duration: null,
      previewUrl: URL.createObjectURL(main),
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function waitEvent(el, name, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      el.removeEventListener(name, ok);
      reject(new Error('timeout ' + name));
    }, ms);
    function ok() {
      clearTimeout(t);
      el.removeEventListener(name, ok);
      resolve();
    }
    el.addEventListener(name, ok, { once: true });
  });
}

function normalizeVideoType(type) {
  // Video .mov của iPhone thực chất là MP4 — báo là mp4 để Android dễ phát hơn
  if (!type || type === 'video/quicktime') return 'video/mp4';
  return type;
}

export async function processVideo(file) {
  const maxBytes = CONFIG.MAX_VIDEO_MB * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new Error(`Video nặng quá (${Math.round(file.size / 1024 / 1024)}MB). Chọn video dưới ${CONFIG.MAX_VIDEO_MB}MB nha 🥺`);
  }
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('muted', '');
  video.src = url;
  try {
    await waitEvent(video, 'loadedmetadata', 10000);
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('Máy không đọc được video này 😿 Thử quay lại hoặc chọn video khác nha.');
  }
  const duration = Number.isFinite(video.duration) ? video.duration : null;
  if (duration && duration > CONFIG.MAX_VIDEO_SEC + 0.9) {
    URL.revokeObjectURL(url);
    throw new Error(`Video dài ${Math.round(duration)} giây, chỉ đăng được video ≤ ${CONFIG.MAX_VIDEO_SEC} giây thôi nè 🥺`);
  }
  let thumb = null;
  try {
    if (video.readyState < 2) await waitEvent(video, 'loadeddata', 4000).catch(() => {});
    video.currentTime = Math.min(0.4, (duration || 1) / 3);
    await waitEvent(video, 'seeked', 4000);
    if (video.videoWidth && video.videoHeight) {
      const c = drawScaled(video, video.videoWidth, video.videoHeight, THUMB_SIDE);
      thumb = await toJpeg(c, 0.78);
    }
  } catch {
    thumb = null; // không có ảnh bìa cũng không sao
  }
  return {
    kind: 'video',
    main: file,
    thumb,
    contentType: normalizeVideoType(file.type),
    width: video.videoWidth || null,
    height: video.videoHeight || null,
    duration,
    previewUrl: url,
  };
}

export async function processFile(file) {
  if (!file) throw new Error('Chưa chọn file');
  const type = file.type || '';
  if (type.startsWith('video/') || /\.(mov|mp4|m4v|webm|3gp)$/i.test(file.name)) return processVideo(file);
  if (type.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp|gif)$/i.test(file.name)) return processImage(file);
  throw new Error('Chỉ đăng được ảnh hoặc video thôi nha 🐱');
}
