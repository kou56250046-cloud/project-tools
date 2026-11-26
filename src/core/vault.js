// 台帳の暗号化。合言葉 → PBKDF2(SHA-256) → AES-GCM 256。鍵はメモリにだけ持ち、保存しない。
// ブラウザと Node（テスト）の両方で globalThis.crypto.subtle を使う。

export const VAULT_VERSION = 1;
export const PBKDF2_ITERATIONS = 600000;

const enc = new TextEncoder();
const dec = new TextDecoder();

export function cryptoAvailable() {
  return !!(globalThis.crypto && globalThis.crypto.subtle && globalThis.crypto.getRandomValues);
}

function toB64(bytes) {
  let s = '';
  const u = new Uint8Array(bytes);
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
}

function fromB64(b64) {
  const s = atob(b64);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}

export function newSalt() {
  return toB64(globalThis.crypto.getRandomValues(new Uint8Array(16)));
}

// 合言葉と salt から鍵を作る（取り出せない鍵）
export async function deriveKey(passphrase, saltB64, iterations = PBKDF2_ITERATIONS) {
  const base = await globalThis.crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return globalThis.crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(saltB64), iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// 文字列を暗号化して、保存用の箱（JSON 文字列）を返す
export async function sealText(key, saltB64, iterations, text) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  return JSON.stringify({ v: VAULT_VERSION, kdf: 'PBKDF2-SHA256', iter: iterations, salt: saltB64, iv: toB64(iv), ct: toB64(ct) });
}

// 保存用の箱を読む（中身は開けない。salt と回数を取り出すだけ）
export function parseBox(boxText) {
  let b;
  try { b = JSON.parse(boxText); } catch (e) { return null; }
  if (!b || b.v !== VAULT_VERSION || typeof b.salt !== 'string' || typeof b.iv !== 'string' || typeof b.ct !== 'string' || !Number.isInteger(b.iter)) return null;
  return b;
}

// 箱を開ける。合言葉が違うと例外（AES-GCM の認証に失敗する）
export async function openBox(key, box) {
  const pt = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(box.iv) }, key, fromB64(box.ct));
  return dec.decode(pt);
}
