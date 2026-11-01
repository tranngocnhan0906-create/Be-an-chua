// Web Push thuần WebCrypto (chạy được trên Deno/Supabase Edge và Node 20+)
// - Mã hoá nội dung: RFC 8291 (aes128gcm)
// - Xác thực máy chủ: RFC 8292 (VAPID, ES256)

const enc = new TextEncoder();

export function b64uEncode(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64uDecode(str: string): Uint8Array {
  const clean = str.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "");
  const padded = clean + "=".repeat((4 - (clean.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

// HKDF (RFC 5869) với độ dài đầu ra <= 32 byte (một khối)
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const prk = await hmac(salt, ikm);
  const okm = await hmac(prk, concat(info, new Uint8Array([1])));
  return okm.slice(0, length);
}

export interface VapidKeys {
  publicKey: string; // base64url, điểm P-256 không nén (65 byte)
  privateJwk: JsonWebKey;
  subject: string; // https://... hoặc mailto:...
}

export async function generateVapidKeys(): Promise<{ publicKey: string; privateJwk: JsonWebKey }> {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const privateJwk = await crypto.subtle.exportKey("jwk", kp.privateKey) as JsonWebKey;
  return { publicKey: b64uEncode(raw), privateJwk };
}

export async function vapidAuthorization(endpoint: string, keys: VapidKeys, ttlSeconds = 12 * 3600): Promise<string> {
  const url = new URL(endpoint);
  const aud = `${url.protocol}//${url.host}`;
  const header = b64uEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64uEncode(enc.encode(JSON.stringify({
    aud,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    sub: keys.subject,
  })));
  const unsigned = `${header}.${payload}`;
  const { key_ops: _ops, ext: _ext, ...jwk } = keys.privateJwk as JsonWebKey & { key_ops?: string[]; ext?: boolean };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(unsigned)));
  return `vapid t=${unsigned}.${b64uEncode(sig)}, k=${keys.publicKey}`;
}

export async function encryptPayload(p256dh: string, authSecretB64u: string, payload: Uint8Array, recordSize = 4096): Promise<Uint8Array> {
  const uaPublic = b64uDecode(p256dh);
  const authSecret = b64uDecode(authSecretB64u);
  if (uaPublic.length !== 65) throw new Error("p256dh không hợp lệ");
  if (authSecret.length < 16) throw new Error("auth không hợp lệ");

  const asKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", asKeys.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asKeys.privateKey, 256));

  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  if (payload.length + 17 > recordSize) throw new Error("Nội dung thông báo quá dài");
  const plaintext = concat(payload, new Uint8Array([2])); // 0x02 = bản ghi cuối, không đệm
  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aesKey, plaintext));

  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, recordSize, false);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

export interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface SendResult {
  endpoint: string;
  status: number;
  ok: boolean;
  gone: boolean; // máy đã huỷ đăng ký -> nên xoá
  detail?: string;
}

export async function sendWebPush(
  sub: PushSubscriptionRow,
  data: unknown,
  keys: VapidKeys,
  opts: { ttl?: number; urgency?: "very-low" | "low" | "normal" | "high" } = {},
): Promise<SendResult> {
  try {
    const body = await encryptPayload(sub.p256dh, sub.auth, enc.encode(JSON.stringify(data)));
    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        "TTL": String(opts.ttl ?? 86400),
        "Urgency": opts.urgency ?? "high",
        "Authorization": await vapidAuthorization(sub.endpoint, keys),
      },
      body,
    });
    const detail = res.ok ? undefined : (await res.text()).slice(0, 300);
    return { endpoint: sub.endpoint, status: res.status, ok: res.ok, gone: res.status === 404 || res.status === 410, detail };
  } catch (e) {
    return { endpoint: sub.endpoint, status: 0, ok: false, gone: false, detail: String(e) };
  }
}
