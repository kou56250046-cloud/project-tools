// zip の読み書きと、Office の XML を読む小道具。DOM に触れない。
// 読み取りは gemini-kit src/js/xlsx.js の entries・inflate、書き出しは gemini-kit src/js/pptx.js の zip・crc32 を写したもの（2026-11-26）。
// 展開は標準の DecompressionStream('deflate-raw')（Node 22 以上・新しい Chrome / Edge）。書き出しは無圧縮

const zipUtf8 = new TextDecoder('utf-8');
const zu16 = (b, o) => b[o] | (b[o + 1] << 8);
const zu32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

// bytes（Uint8Array）→ Map<名前, { method, data }>
export function zipEntries(bytes) {
  const b = bytes;
  if (b.length < 22 || zu32(b, 0) !== 0x04034b50) throw new Error('zip として読めません');
  let e = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (zu32(b, i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('zip として読めません（終わりが見つかりません）');
  const count = zu16(b, e + 10);
  let p = zu32(b, e + 16);
  if (p === 0xffffffff) throw new Error('大きすぎる zip（ZIP64）は読めません');
  const map = new Map();
  for (let k = 0; k < count; k++) {
    if (zu32(b, p) !== 0x02014b50) throw new Error('zip として読めません（目次が壊れています）');
    const flag = zu16(b, p + 8), method = zu16(b, p + 10), size = zu32(b, p + 20);
    const nlen = zu16(b, p + 28), xlen = zu16(b, p + 30), clen = zu16(b, p + 32), local = zu32(b, p + 42);
    const name = zipUtf8.decode(b.subarray(p + 46, p + 46 + nlen));
    if (flag & 1) throw new Error('パスワード付きのファイルは読めません');
    const start = local + 30 + zu16(b, local + 26) + zu16(b, local + 28);
    map.set(name, { method, data: b.subarray(start, start + size) });
    p += 46 + nlen + xlen + clen;
  }
  return map;
}

async function zipInflate(data) {
  if (typeof DecompressionStream !== 'function') throw new Error('このブラウザは圧縮されたファイルを展開できません（新しい Chrome / Edge で開いてください）');
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const parts = [];
  let n = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); n += value.length; }
  const out = new Uint8Array(n);
  let o = 0;
  for (const x of parts) { out.set(x, o); o += x.length; }
  return out;
}

// 中のファイルのバイト列。無ければ null
export async function zipBytes(zip, name) {
  const e = zip.get(name);
  if (!e) return null;
  if (e.method === 0) return e.data;
  if (e.method === 8) return zipInflate(e.data);
  throw new Error(`圧縮方式 ${e.method} は読めません`);
}
// 中のファイルの文字列（UTF-8）。無ければ null
export async function zipText(zip, name) {
  const b = await zipBytes(zip, name);
  return b === null ? null : zipUtf8.decode(b);
}

// rels の Target を、その rels が属するファイルのフォルダからの相対として解決する（../ と ./ を扱う）
// owner: 'ppt/slides/slide1.xml' のような持ち主のパス。Target が / で始まればパッケージの根から
export function resolvePart(owner, target) {
  const t = String(target || '');
  if (t.startsWith('/')) return t.slice(1);
  const parts = owner.split('/').slice(0, -1);
  for (const seg of t.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}
// 'ppt/slides/slide1.xml' → 'ppt/slides/_rels/slide1.xml.rels'
export function relsPathOf(part) {
  const i = part.lastIndexOf('/');
  return `${part.slice(0, i + 1)}_rels/${part.slice(i + 1)}.rels`;
}

// ---- XML の小道具（正規表現で読む。Node のテストに DOMParser が無いため） ----
export const xmlUnescape = (s) => String(s).replace(/&(lt|gt|amp|quot|apos|#x[0-9a-fA-F]+|#\d+);/g, (m, k) =>
  (k === 'lt' ? '<' : k === 'gt' ? '>' : k === 'amp' ? '&' : k === 'quot' ? '"' : k === 'apos' ? "'" : String.fromCodePoint(k[1] === 'x' ? parseInt(k.slice(2), 16) : +k.slice(1))));
export function xmlAttrs(s) {
  const o = Object.create(null);
  for (const m of String(s).matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) o[m[1]] = xmlUnescape(m[2]);
  return o;
}
// rels の XML → Map<Id, Target>
export function relsMap(xml) {
  const m = new Map();
  for (const r of String(xml || '').matchAll(/<Relationship\b([^>]*?)\/?>/g)) { const a = xmlAttrs(r[1]); m.set(a.Id, { target: a.Target || '', type: a.Type || '', mode: a.TargetMode || '' }); }
  return m;
}

// ---- 書き出し（無圧縮） ----
const ZIP_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = ZIP_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
// files: [{ name, data: 文字列 | Uint8Array }] → Uint8Array（zip）
export function zipWrite(files, date) {
  const enc = new TextEncoder();
  const d = date || new Date();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    chunks.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const parts = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((s, c) => s + c.length, 0));
  let p = 0;
  for (const c of parts) { out.set(c, p); p += c.length; }
  return out;
}
