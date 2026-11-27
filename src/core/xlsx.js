// 写した部品: gemini-kit src/js/xlsx.js（2026-11-26）。外側の IIFE を、XLSX だけを外に出す形に包み直した。中身は変えていない
// Excel（.xlsx）を読む。zip の中央ディレクトリを読み、無圧縮はそのまま、deflate はブラウザ標準の DecompressionStream で展開する。
// XML は正規表現で必要な要素だけ読む（Node のテストに DOMParser が無いため。sheetData・sharedStrings・styles・workbook だけ）。
// 数式は再計算せず、保存されている値を読む。DOM は使わない
export const XLSX = (() => {

  const dec = new TextDecoder("utf-8");
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

  // ---------- zip ----------
  function entries(bytes) {
    const b = bytes;
    if (b.length >= 8 && u32(b, 0) === 0xe011cfd0) throw new Error("古い Excel（.xls）か、パスワード付きのファイルです。Excel で開き、パスワードなしの .xlsx として保存し直してください");
    if (b.length < 22 || u32(b, 0) !== 0x04034b50) throw new Error("xlsx として読めません（zip ではありません）");
    let e = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (u32(b, i) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error("xlsx として読めません（zip の終わりが見つかりません）");
    const count = u16(b, e + 10);
    let p = u32(b, e + 16);
    if (p === 0xffffffff) throw new Error("大きすぎる xlsx（ZIP64）は読めません");
    const map = new Map();
    for (let k = 0; k < count; k++) {
      if (u32(b, p) !== 0x02014b50) throw new Error("xlsx として読めません（目次が壊れています）");
      const flag = u16(b, p + 8), method = u16(b, p + 10), size = u32(b, p + 20);
      const nlen = u16(b, p + 28), xlen = u16(b, p + 30), clen = u16(b, p + 32), local = u32(b, p + 42);
      const name = dec.decode(b.subarray(p + 46, p + 46 + nlen));
      if (flag & 1) throw new Error("パスワード付きの xlsx は読めません");
      const start = local + 30 + u16(b, local + 26) + u16(b, local + 28);
      map.set(name, { method, data: b.subarray(start, start + size), usize: u32(b, p + 24) });
      p += 46 + nlen + xlen + clen;
    }
    return map;
  }
  // 展開後の大きさの上限（zip 爆弾でタブが落ちないように。写し元から足した）
  const INFLATE_MAX = 200 * 1024 * 1024;
  async function inflate(data) {
    if (typeof DecompressionStream !== "function") throw new Error("このブラウザは圧縮された xlsx を展開できません（新しい Chrome / Edge で開いてください）");
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    const reader = stream.getReader();
    const parts = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
      if (n > INFLATE_MAX) { await reader.cancel().catch(() => {}); throw new Error("展開すると大きすぎる xlsx です（200MB を超えます）"); }
      parts.push(value);
    }
    const out = new Uint8Array(n);
    let o = 0;
    for (const x of parts) { out.set(x, o); o += x.length; }
    return out;
  }
  async function text(zip, name) {
    const e = zip.get(name);
    if (!e) return null;
    if (e.method === 0) return dec.decode(e.data);
    if (e.method === 8) {
      if (e.usize > INFLATE_MAX) throw new Error("展開すると大きすぎる xlsx です（200MB を超えます）");
      return dec.decode(await inflate(e.data));
    }
    throw new Error(`xlsx の圧縮方式 ${e.method} は読めません`);
  }

  // ---------- XML の小道具 ----------
  const unesc = (s) => String(s).replace(/&(lt|gt|amp|quot|apos|#x[0-9a-fA-F]+|#\d+);/g, (m, k) =>
    k === "lt" ? "<" : k === "gt" ? ">" : k === "amp" ? "&" : k === "quot" ? '"' : k === "apos" ? "'" : String.fromCodePoint(k[1] === "x" ? parseInt(k.slice(2), 16) : +k.slice(1)));
  function attrs(s) {
    const o = {};
    for (const m of String(s).matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)) o[m[1]] = unesc(m[2]);
    return o;
  }
  // <t> をつなぐ。ふりがな（<rPh>）は除く
  const runs = (xml) => [...String(xml).replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unesc(m[1])).join("");

  function sharedStrings(xml) {
    if (!xml) return [];
    return [...xml.matchAll(/<si>([\s\S]*?)<\/si>|<si\s*\/>/g)].map((m) => (m[1] ? runs(m[1]) : ""));
  }

  // 日付の書式か。組み込み：14〜22・45〜47、日本語の組み込み：27〜36・50〜58
  const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
  function isDateCode(code) {
    const s = String(code || "").replace(/"[^"]*"/g, "").replace(/\\./g, "").replace(/\[(?!h\]|m\]|s\])[^\]]*\]/gi, "").replace(/_.|\*./g, "");
    return /[ymdhsge]/i.test(s.replace(/General/gi, ""));
  }
  function dateStyles(xml) {
    if (!xml) return [];
    const custom = new Map();
    for (const m of xml.matchAll(/<numFmt\b([^>]*?)\/?>/g)) { const a = attrs(m[1]); custom.set(+a.numFmtId, a.formatCode); }
    const xfs = (xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/) || [])[1] || "";
    return [...xfs.matchAll(/<xf\b([^>]*?)\/?>/g)].map((m) => {
      const id = +(attrs(m[1]).numFmtId || 0);
      // 経過時間の書式（[h]:mm など。組み込みの 46）は日付ではなく「時:分」で出す
      if (id === 46 || (custom.has(id) && /\[(h|m|s)+\]/i.test(String(custom.get(id))))) return "elapsed";
      return custom.has(id) ? isDateCode(custom.get(id)) : BUILTIN_DATE.has(id);
    });
  }
  // シリアル値 → yyyy-mm-dd（時刻があれば hh:mm を足す。1 未満は時刻だけ）。date1904: Mac の 1904 年基準のブック
  // 1900 年基準では Excel が 1900 年をうるう年として数えるので、60（1900-02-29）より前は 1 日足す
  function serialToDate(v, date1904) {
    const p = (n) => String(n).padStart(2, "0");
    if (date1904) v += 1462;
    else if (v >= 1 && v < 60) v += 1;
    const ms = Math.round((v - 25569) * 86400000 / 60000) * 60000;
    const d = new Date(ms);
    const time = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
    if (v < 1) return time;
    const day = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
    return time === "00:00" ? day : `${day} ${time}`;
  }
  // 経過時間（[h]:mm）: 1 日を 24 時間として 時:分 にする（36:00 など）
  function serialToElapsed(v) {
    const min = Math.round(v * 1440);
    const sign = min < 0 ? "-" : "";
    const a = Math.abs(min);
    return `${sign}${Math.floor(a / 60)}:${String(a % 60).padStart(2, "0")}`;
  }
  const colIndex = (ref) => { let n = 0; for (const ch of String(ref).replace(/\d+$/, "").toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
  const cleanNum = (s) => { const n = Number(s); return isFinite(n) ? String(Number(n.toPrecision(15))) : s; };

  const ROW_MAX = 1048576, COL_MAX = 16384;   // Excel の行・列の上限（これを超える番号は壊れたファイルか細工）
  function sheetRows(xml, sst, dates, date1904) {
    const rows = [];
    let rowNo = 0;
    for (const rm of String(xml).matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const ra = attrs(rm[1]);
      rowNo = ra.r ? +ra.r : rowNo + 1;
      if (!(rowNo >= 1 && rowNo <= ROW_MAX)) throw new Error(`行の番号（${ra.r}）が Excel の上限を超えています。ファイルが壊れていないか確かめてください`);
      const row = [];
      let col = -1;
      for (const cm of String(rm[2] || "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const a = attrs(cm[1]);
        col = a.r ? colIndex(a.r) : col + 1;
        if (!(col >= 0 && col < COL_MAX)) throw new Error(`列の番号（${a.r}）が Excel の上限を超えています。ファイルが壊れていないか確かめてください`);
        const inner = cm[2] || "";
        const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let out = "";
        if (a.t === "s") out = v != null ? sst[+v] || "" : "";
        else if (a.t === "inlineStr") out = runs((inner.match(/<is>([\s\S]*?)<\/is>/) || [])[1] || "");
        else if (a.t === "b") out = v === "1" ? "TRUE" : v === "0" ? "FALSE" : "";
        else if (a.t === "str" || a.t === "e") out = v != null ? unesc(v) : "";
        else if (v != null) {
          const kind = dates[+(a.s || 0)];
          out = kind === "elapsed" ? serialToElapsed(Number(v)) : kind ? serialToDate(Number(v), date1904) : cleanNum(unesc(v));
        }
        row[col] = out;
      }
      rows.push(Array.from(row, (x) => (x == null ? "" : x)));
    }
    return rows.filter((r) => r.some((x) => String(x).trim() !== ""));
  }

  // bytes（Uint8Array）→ [{ name, rows }]。rows は 2 次元の文字列の配列（1 行目が見出し）
  async function sheets(bytes) {
    const zip = entries(bytes);
    if (zip.has("EncryptedPackage")) throw new Error("パスワード付きの xlsx は読めません");
    const wb = await text(zip, "xl/workbook.xml");
    if (!wb) throw new Error("xlsx として読めません（xl/workbook.xml がありません）");
    const rels = (await text(zip, "xl/_rels/workbook.xml.rels")) || "";
    const target = new Map();
    for (const m of rels.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
      const a = attrs(m[1]);
      const t = String(a.Target || "");
      target.set(a.Id, t.startsWith("/") ? t.slice(1) : "xl/" + t.replace(/^\.\//, ""));
    }
    const sst = sharedStrings(await text(zip, "xl/sharedStrings.xml"));
    const dates = dateStyles(await text(zip, "xl/styles.xml"));
    const date1904 = /<workbookPr\b[^>]*\bdate1904="(?:1|true)"/i.test(wb);
    const out = [];
    for (const m of wb.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
      const a = attrs(m[1]);
      const path = target.get(a["r:id"]);
      const xml = path && (await text(zip, path));
      if (xml == null) continue; // グラフのシートなど
      out.push({ name: a.name || `シート${out.length + 1}`, rows: sheetRows(xml, sst, dates, date1904) });
    }
    if (!out.length) throw new Error("xlsx にシートがありません");
    return out;
  }

  return { sheets, entries, isDateCode, serialToDate, serialToElapsed, colIndex };
})();
