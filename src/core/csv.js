// CSV / TSV の読み取り。引用符・"" のエスケープ・引用符の中の改行・CRLF・BOM に対応する状態機械
// ~/projects/薬膳/index.html の parseCSV を改変して流用（区切り文字を引数にし、BOM 除去を足した）

export function stripBom(text) {
  return String(text).replace(/^﻿/, '');
}

// 1 行目のタブとカンマの数で区切りを決める（引用符の中は数えない）
export function detectDelimiter(text) {
  let tabs = 0;
  let commas = 0;
  let inQ = false;
  for (const ch of text) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && (ch === '\n' || ch === '\r')) break;
    else if (!inQ && ch === '\t') tabs++;
    else if (!inQ && ch === ',') commas++;
  }
  return tabs > commas ? '\t' : ',';
}

// 戻り値: string[][]（空行は除く）
export function parseDelimited(text, delim) {
  const src = stripBom(text);
  const d = delim || detectDelimiter(src);
  const rows = [];
  let row = [];
  let cell = '';
  let inQ = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') inQ = true;
    else if (ch === d) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); if (row.length > 1 || row[0] !== '') rows.push(row); }
  return rows;
}

// バイト列を文字列にする。auto なら UTF-8 として読み、読めなければ Shift_JIS（TextDecoder は標準機能）
export function decodeBytes(buffer, encoding = 'auto') {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (encoding === 'shift_jis') return { text: new TextDecoder('shift_jis').decode(bytes), encoding: 'shift_jis' };
  if (encoding === 'utf-8') return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8' };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch (e) {
    return { text: new TextDecoder('shift_jis').decode(bytes), encoding: 'shift_jis' };
  }
}

// CSV・TSV に書き出す値を、Excel が式として読まない形にする（先頭が = + @ タブ 改行、または - の後が数値でないもの）
export function csvSafe(v) {
  const s = String(v == null ? '' : v);
  if (/^[=+@\t\r\n]/.test(s)) return "'" + s;
  if (s.startsWith('-') && !/^-[\d,]*\.?\d+$/.test(s) && s !== '-') return "'" + s;
  return s;
}
