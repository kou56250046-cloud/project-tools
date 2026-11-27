// 資料の変換: ファイルの形式を判定し、Markdown にする。DOM に触れない（node --test で試す）。
// Excel・CSV・JSON・Word（.docx）・PowerPoint（.pptx）・HTML・md・txt。PDF と画像は gemini-convert.js（Gemini に任せる）。
// 決まりは .claude/specs/workbench-p6b/design.md（「レビューを受けて決めたこと」が正）。

import { decodeBytes, parseDelimited } from './csv.js';
import { safeParse } from './extract.js';
import { zipEntries, zipText, resolvePart, relsPathOf, relsMap, xmlUnescape, xmlAttrs } from './zip.js';
import { XLSX } from './xlsx.js';
import { TABLEPREP } from './tableprep.js';

export const CONVERT_MAX_BYTES = 30 * 1024 * 1024;
export const CONVERT_METHOD = '案件ワークベンチ（ブラウザの中で変換）';

const head4 = (b, arr) => arr.every((x, i) => b[i] === x);
const extOf = (name) => { const m = /\.([^.]+)$/.exec(String(name)); return m ? m[1].toLowerCase() : ''; };
export const baseName = (name) => String(name).replace(/\.[^.]+$/, '');

// ---- 文字として読む（BOM を見る。無ければ UTF-8 → Shift_JIS） ----
export function decodeText(bytes) {
  if (bytes.length >= 3 && head4(bytes, [0xef, 0xbb, 0xbf])) return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8' };
  if (bytes.length >= 2 && head4(bytes, [0xff, 0xfe])) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' };
  if (bytes.length >= 2 && head4(bytes, [0xfe, 0xff])) return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' };
  return decodeBytes(bytes);
}

// 区切りの表として読めるか（空でない先頭 20 行のうち 2 行以上、区切りを含む行が 8 割以上、区切りの数が同じ行が 8 割以上）
function delimiterOf(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim() !== '').slice(0, 20);
  if (lines.length < 2) return null;
  for (const d of ['\t', ',']) {
    const counts = lines.map((l) => l.split(d).length - 1);
    const withD = counts.filter((c) => c > 0);
    if (withD.length < lines.length * 0.8) continue;
    const freq = new Map();
    for (const c of withD) freq.set(c, (freq.get(c) || 0) + 1);
    const top = Math.max(...freq.values());
    if (top >= lines.length * 0.8) return d;
  }
  return null;
}

// 形式の判定。上から順に当てはめる。戻り値 { kind, text?, delim?, reason? }。kind が 'reject' なら reason を出して断る
export async function detectKind(name, bytes) {
  const ext = extOf(name);
  if (bytes.length > CONVERT_MAX_BYTES) return { kind: 'reject', reason: '30MB を超えるファイルは読めません' };
  if (bytes.length >= 4 && head4(bytes, [0xd0, 0xcf, 0x11, 0xe0])) {
    return { kind: 'reject', reason: '古い形式（.xls・.doc・.ppt）か、パスワード・秘密度ラベルで暗号化されたファイルです。古い形式なら新しい形式で保存し直してください。暗号化されたものは、暗号化を外せる場合だけ読めます' };
  }
  if (bytes.length >= 4 && head4(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    let zip;
    try { zip = zipEntries(bytes); } catch (e) { return { kind: 'reject', reason: String(e.message || e) }; }
    if (zip.has('xl/workbook.xml')) return { kind: 'xlsx' };
    if (zip.has('word/document.xml')) return { kind: 'docx', zip };
    if (zip.has('ppt/presentation.xml')) return { kind: 'pptx', zip };
    return { kind: 'reject', reason: '対応していない zip 形式です（.xlsb・.vsdx・ただの zip など）' };
  }
  if (bytes.length >= 5 && head4(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { kind: 'pdf' };
  if (head4(bytes, [0x89, 0x50, 0x4e, 0x47]) || head4(bytes, [0xff, 0xd8, 0xff]) || head4(bytes, [0x47, 0x49, 0x46, 0x38]) || head4(bytes, [0x42, 0x4d])
    || (head4(bytes, [0x52, 0x49, 0x46, 0x46]) && bytes.length >= 12 && head4(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50]))) return { kind: 'image' };
  if (ext === 'mht' || ext === 'mhtml') return { kind: 'reject', reason: 'Web ページ（単一ファイル）形式は読めません。HTML で保存し直してください' };
  const { text } = decodeText(bytes);
  const lead = text.replace(/^\s+/, '').slice(0, 20).toLowerCase();
  if (lead.startsWith('<!doctype html') || lead.startsWith('<html') || ext === 'html' || ext === 'htm') return { kind: 'html', text };
  if (ext === 'json' || lead.startsWith('[') || lead.startsWith('{')) {
    try { safeParse(text.replace(/^﻿/, '')); return { kind: 'json', text }; } catch (e) {
      if (ext === 'json') return { kind: 'reject', reason: 'JSON として読めません' };
    }
  }
  const delim = delimiterOf(text);
  if (delim) return { kind: delim === '\t' ? 'tsv' : 'csv', text, delim };
  return { kind: 'text', text };
}

// ---- Markdown の部品 ----
const mdCellText = (v) => String(v == null ? '' : v).replace(/\r?\n/g, '<br>').replace(/\|/g, '\\|').trim();
// rows: 2 次元の配列（1 行目が見出し）。行の長さは最長の行にそろえる
export function mdTable(rows) {
  if (!rows.length) return '';
  const w = rows.reduce((m, r) => Math.max(m, r.length), 1);
  const pad = (r) => Array.from({ length: w }, (_, i) => mdCellText(r[i]));
  const [h, ...body] = rows;
  return [`| ${pad(h).join(' | ')} |`, `|${Array(w).fill('---').join('|')}|`, ...body.map((r) => `| ${pad(r).join(' | ')} |`)].join('\n');
}
const tidy = (lines) => lines.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
export function mdHeader(name, today, method, counts) {
  return `<!-- 出典: ${name} / 変換: ${today} / 方式: ${method} / ${counts} -->\n# ${baseName(name)}\n\n`;
}

// ---- 小さな XML の木（Office の XML 用。名前空間の接頭辞はそのまま名前に残す） ----
export function parseXml(xml) {
  const root = { name: '#root', attrs: Object.create(null), children: [] };
  const stack = [root];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (const m of String(xml).matchAll(re)) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.children.push(m[1]);
    else if (m[2]) { if (stack.length > 1) stack.pop(); }
    else if (m[3]) {
      const el = { name: m[3], attrs: xmlAttrs(String(m[4] || '').replace(/'([^']*)'/g, '"$1"')), children: [] };
      top.children.push(el);
      if (!m[5]) stack.push(el);
    } else if (m[6] !== undefined) top.children.push(xmlUnescape(m[6]));
  }
  return root;
}
const kids = (n, name) => (n ? n.children.filter((c) => typeof c !== 'string' && (!name || c.name === name)) : []);
const kid = (n, name) => kids(n, name)[0] || null;
function find(n, name) {
  if (!n || typeof n === 'string') return null;
  for (const c of n.children) {
    if (typeof c === 'string') continue;
    if (c.name === name) return c;
    const f = find(c, name);
    if (f) return f;
  }
  return null;
}
const attr = (n, a) => (n && n.attrs[a] !== undefined ? n.attrs[a] : null);

// ======== Excel・CSV・JSON ========
async function xlsxToMd(bytes) {
  const sheets = await XLSX.sheets(bytes);
  const out = [];
  let rows = 0;
  for (const s of sheets) {
    out.push(`## ${s.name}`, '');
    out.push(s.rows.length ? mdTable(s.rows) : '（空のシート）', '');
    rows += Math.max(0, s.rows.length - 1);
  }
  return { body: tidy(out), counts: `シート ${sheets.length}・行 ${rows}`, tables: sheets.filter((s) => s.rows.length).map((s) => ({ label: s.name, rows: s.rows })) };
}
function delimitedToMd(text, delim) {
  const rows = parseDelimited(text, delim);
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  return { body: tidy([mdTable(rows)]), counts: `行 ${Math.max(0, rows.length - 1)}・列 ${width}`, tables: [{ label: '', rows }] };
}
function jsonToMd(text) {
  const data = safeParse(text.replace(/^﻿/, ''));
  const keys = Array.isArray(data) ? [null] : Object.keys(data || {}).filter((k) => Array.isArray(data[k]) && data[k].some((x) => x && typeof x === 'object' && !Array.isArray(x)));
  if (!keys.length) throw new Error('JSON にオブジェクトの配列がありません（[{…}, {…}] の形か、それを持つキーが必要です）');
  const out = [];
  const tables = [];
  let rows = 0;
  for (const k of keys) {
    const { table } = TABLEPREP.fromJSON(text, { name: k || '表' }, k || undefined);
    const all = [table.cols, ...table.rows];
    if (k !== null) out.push(`## ${k}`, '');
    out.push(mdTable(all), '');
    rows += table.rows.length;
    tables.push({ label: k || '', rows: all, jsonKey: k });
  }
  return { body: tidy(out), counts: `表 ${keys.length}・行 ${rows}`, tables };
}

// ======== Word（.docx） ========
const ORDERED_FMT = new Set(['decimal', 'decimalZero', 'decimalFullWidth', 'decimalHalfWidth', 'decimalEnclosedCircle', 'decimalEnclosedParen', 'decimalEnclosedFullstop',
  'upperLetter', 'lowerLetter', 'upperRoman', 'lowerRoman', 'aiueo', 'aiueoFullWidth', 'iroha', 'irohaFullWidth', 'japaneseCounting', 'ideographDigital', 'chineseCounting']);

function docxStyles(xml) {
  const map = new Map();
  for (const s of kids(kid(parseXml(xml || ''), 'w:styles'), 'w:style')) {
    const pPr = kid(s, 'w:pPr');
    const numPr = kid(pPr, 'w:numPr');
    map.set(attr(s, 'w:styleId'), {
      name: attr(kid(s, 'w:name'), 'w:val') || '',
      basedOn: attr(kid(s, 'w:basedOn'), 'w:val'),
      outline: attr(kid(pPr, 'w:outlineLvl'), 'w:val'),
      numId: numPr ? attr(kid(numPr, 'w:numId'), 'w:val') : null,
      ilvl: numPr ? attr(kid(numPr, 'w:ilvl'), 'w:val') : null,
    });
  }
  return map;
}
function docxNumbering(xml) {
  const root = kid(parseXml(xml || ''), 'w:numbering');
  const abs = new Map();
  for (const a of kids(root, 'w:abstractNum')) {
    const lv = new Map();
    for (const l of kids(a, 'w:lvl')) lv.set(attr(l, 'w:ilvl'), attr(kid(l, 'w:numFmt'), 'w:val'));
    abs.set(attr(a, 'w:abstractNumId'), lv);
  }
  const nums = new Map();
  for (const n of kids(root, 'w:num')) nums.set(attr(n, 'w:numId'), abs.get(attr(kid(n, 'w:abstractNumId'), 'w:val')) || new Map());
  return nums;
}
// 見出しの段（1〜6）か null。スタイル名 → basedOn をたどる → outlineLvl（段落、無ければスタイル）
function docxHeading(pPr, styles) {
  const styleId = attr(kid(pPr, 'w:pStyle'), 'w:val');
  const byName = (name) => {
    const m = /^(?:heading|見出し)\s*(\d)$/i.exec(String(name).trim());
    if (m) return Math.min(6, Math.max(1, +m[1]));
    return /^(title|タイトル)$/i.test(String(name).trim()) ? 1 : null;
  };
  let id = styleId;
  for (let i = 0; id && i < 10; i++) {
    const st = styles.get(id);
    if (!st) break;
    const n = byName(st.name) || byName(id);
    if (n) return n;
    id = st.basedOn;
  }
  let ol = attr(kid(pPr, 'w:outlineLvl'), 'w:val');
  id = styleId;
  for (let i = 0; ol === null && id && i < 10; i++) { const st = styles.get(id); if (!st) break; ol = st.outline; id = st.basedOn; }
  if (ol !== null && +ol >= 0 && +ol <= 5) return +ol + 1;
  return null;
}
function docxNumPr(pPr, styles) {
  const np = kid(pPr, 'w:numPr');
  if (np) return { numId: attr(kid(np, 'w:numId'), 'w:val'), ilvl: attr(kid(np, 'w:ilvl'), 'w:val') };
  let id = attr(kid(pPr, 'w:pStyle'), 'w:val');
  for (let i = 0; id && i < 10; i++) {
    const st = styles.get(id);
    if (!st) break;
    if (st.numId !== null) return { numId: st.numId, ilvl: st.ilvl };
    id = st.basedOn;
  }
  return null;
}
// 段落の文字。テキストボックスの段落は boxes に集める。mc:Fallback は捨てる
function docxRunText(node, ctx, boxes) {
  let s = '';
  for (const c of node.children) {
    if (typeof c === 'string') continue;
    switch (c.name) {
      case 'w:t': s += c.children.filter((x) => typeof x === 'string').join(''); break;
      case 'w:tab': s += ' '; break;
      case 'w:br': case 'w:cr': s += '\n'; break;
      case 'w:txbxContent': boxes.push(...kids(c).filter((x) => x.name === 'w:p' || x.name === 'w:tbl')); break;
      case 'mc:Fallback': case 'w:instrText': case 'w:delText': case 'w:pPr': case 'w:rPr': break;
      case 'w:drawing': case 'w:pict': {
        const inner = docxRunText(c, ctx, boxes);
        s += find(c, 'w:txbxContent') ? inner : '[図]';
        break;
      }
      default: s += docxRunText(c, ctx, boxes);
    }
  }
  return s;
}
function docxCellText(tc, ctx) {
  const parts = [];
  for (const c of kids(tc)) {
    if (c.name === 'w:p') { const boxes = []; const t = docxRunText(c, ctx, boxes).trim(); if (t) parts.push(t); }
    else if (c.name === 'w:tbl') parts.push(docxTableRows(c, ctx).map((r) => r.filter((x) => x).join(' / ')).filter((x) => x).join('<br>'));
    else if (c.name === 'w:sdt') parts.push(docxCellText(kid(c, 'w:sdtContent') || c, ctx));
  }
  return parts.filter((x) => x).join('<br>');
}
function docxTableRows(tbl, ctx) {
  const rows = [];
  for (const tr of kids(tbl, 'w:tr')) {
    const row = [];
    for (const tc of kids(tr, 'w:tc')) {
      const tcPr = kid(tc, 'w:tcPr');
      const vm = kid(tcPr, 'w:vMerge');
      const cont = vm && attr(vm, 'w:val') !== 'restart';
      row.push(cont ? '' : docxCellText(tc, ctx));
      const span = +(attr(kid(tcPr, 'w:gridSpan'), 'w:val') || 1);
      for (let i = 1; i < span; i++) row.push('');
    }
    rows.push(row);
  }
  return rows;
}
async function docxToMd(zip) {
  const ctx = {
    styles: docxStyles(await zipText(zip, 'word/styles.xml')),
    nums: docxNumbering(await zipText(zip, 'word/numbering.xml')),
  };
  const body = find(parseXml(await zipText(zip, 'word/document.xml')), 'w:body');
  const out = [];
  let headings = 0, tables = 0, paras = 0, inList = false;
  const endList = () => { if (inList) { out.push(''); inList = false; } };
  const para = (p) => {
    const pPr = kid(p, 'w:pPr');
    const boxes = [];
    const text = docxRunText(p, ctx, boxes).replace(/\n/g, '  \n').trim();
    if (text) {
      paras++;
      const hl = docxHeading(pPr, ctx.styles);
      const np = hl ? null : docxNumPr(pPr, ctx.styles);
      if (hl) { endList(); out.push(`${'#'.repeat(Math.min(6, hl + 1))} ${text}`, ''); headings++; }
      else if (np && np.numId && np.numId !== '0') {
        const lv = +(np.ilvl || 0);
        const fmt = (ctx.nums.get(np.numId) || new Map()).get(String(lv));
        out.push(`${'  '.repeat(lv)}${ORDERED_FMT.has(fmt) ? '1.' : '-'} ${text}`);
        inList = true;
      } else { endList(); out.push(text, ''); }
    }
    for (const b of boxes) block(b);
  };
  const block = (n) => {
    if (n.name === 'w:p') para(n);
    else if (n.name === 'w:tbl') { endList(); out.push(mdTable(docxTableRows(n, ctx)), ''); tables++; }
    else if (n.name === 'w:sdt') for (const c of kids(kid(n, 'w:sdtContent'))) block(c);
    else if (n.name === 'mc:AlternateContent') for (const c of kids(kid(n, 'mc:Choice'))) block(c);
  };
  for (const n of kids(body)) block(n);
  endList();
  return { body: tidy(out), counts: `見出し ${headings}・表 ${tables}・段落 ${paras}` };
}

// ======== PowerPoint（.pptx） ========
const aParaText = (p) => {
  let s = '';
  const walk = (n) => {
    for (const c of n.children) {
      if (typeof c === 'string') continue;
      if (c.name === 'a:t') s += c.children.filter((x) => typeof x === 'string').join('');
      else if (c.name === 'a:br') s += ' ';
      else if (c.name !== 'a:pPr' && c.name !== 'a:rPr' && c.name !== 'a:endParaRPr') walk(c);
    }
  };
  walk(p);
  return s.trim();
};
const phType = (sp) => { const ph = find(kid(sp, 'p:nvSpPr'), 'p:ph'); return ph ? (attr(ph, 'type') || 'body') : null; };
function pptTableRows(tbl) {
  const rows = [];
  for (const tr of kids(tbl, 'a:tr')) {
    const row = [];
    for (const tc of kids(tr, 'a:tc')) {
      const merged = attr(tc, 'hMerge') === '1' || attr(tc, 'vMerge') === '1';
      row.push(merged ? '' : kids(kid(tc, 'a:txBody'), 'a:p').map(aParaText).filter((x) => x).join('<br>'));
    }
    rows.push(row);
  }
  return rows;
}
// 図形の木をたどって、タイトル・本文の行・表を集める
function pptShapes(tree, acc) {
  for (const n of kids(tree)) {
    if (n.name === 'p:sp') {
      const t = phType(n);
      const paras = kids(kid(n, 'p:txBody'), 'a:p');
      if (t === 'title' || t === 'ctrTitle') { const s = paras.map(aParaText).filter((x) => x).join(' '); if (s && !acc.title) acc.title = s; continue; }
      for (const p of paras) {
        const s = aParaText(p);
        if (!s) continue;
        const lvl = +(attr(kid(p, 'a:pPr'), 'lvl') || 0);
        acc.lines.push(`${'  '.repeat(lvl)}- ${s}`);
      }
    } else if (n.name === 'p:grpSp') pptShapes(n, acc);
    else if (n.name === 'p:graphicFrame') {
      const tbl = find(n, 'a:tbl');
      if (tbl) { acc.blocks.push(mdTable(pptTableRows(tbl))); acc.tables++; } else acc.lines.push('- [図]');
    } else if (n.name === 'p:pic') acc.lines.push('- [図]');
    else if (n.name === 'mc:AlternateContent') pptShapes(kid(n, 'mc:Choice') || { children: [] }, acc);
  }
}
async function pptxToMd(zip) {
  const pres = parseXml(await zipText(zip, 'ppt/presentation.xml'));
  const rels = relsMap(await zipText(zip, 'ppt/_rels/presentation.xml.rels'));
  const ids = kids(find(pres, 'p:sldIdLst'), 'p:sldId');
  const out = [];
  let hidden = 0, tables = 0, n = 0;
  for (const sid of ids) {
    const r = rels.get(attr(sid, 'r:id'));
    if (!r) continue;
    const part = resolvePart('ppt/presentation.xml', r.target);
    const xml = await zipText(zip, part);
    if (xml === null) continue;
    n++;
    const sld = find(parseXml(xml), 'p:sld');
    const isHidden = attr(sld, 'show') === '0';
    if (isHidden) hidden++;
    const acc = { title: '', lines: [], blocks: [], tables: 0 };
    pptShapes(find(sld, 'p:spTree'), acc);
    tables += acc.tables;
    out.push(`## スライド ${n}: ${acc.title || '（タイトルなし）'}${isHidden ? '（非表示）' : ''}`, '');
    if (acc.lines.length) out.push(...acc.lines, '');
    for (const b of acc.blocks) out.push(b, '');
    // ノート: スライドの rels から notesSlide を引き、placeholder が body の図形だけ読む
    const srels = relsMap(await zipText(zip, relsPathOf(part)));
    for (const x of srels.values()) {
      if (!/\/notesSlide$/.test(x.type)) continue;
      const nxml = await zipText(zip, resolvePart(part, x.target));
      if (nxml === null) continue;
      const notes = [];
      for (const sp of kids(find(parseXml(nxml), 'p:spTree'), 'p:sp')) {
        if (phType(sp) !== 'body') continue;
        for (const p of kids(kid(sp, 'p:txBody'), 'a:p')) { const s = aParaText(p); if (s) notes.push(s); }
      }
      if (notes.length) out.push(`> ノート: ${notes[0]}`, ...notes.slice(1).map((s) => `> ${s}`), '');
    }
  }
  return { body: tidy(out), counts: `スライド ${n}（うち非表示 ${hidden}）・表 ${tables}` };
}

// ======== HTML ========
const HTML_ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»', yen: '¥', times: '×', divide: '÷', middot: '·', bull: '•' };
export const htmlUnescape = (s) => String(s).replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, k) => {
  if (k[0] === '#') { const cp = k[1] === 'x' || k[1] === 'X' ? parseInt(k.slice(2), 16) : +k.slice(1); return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m; }
  return Object.prototype.hasOwnProperty.call(HTML_ENT, k) ? HTML_ENT[k] : m;
});
const HTML_SKIP = new Set(['script', 'style', 'head', 'noscript', 'template']);
const HTML_BLOCK = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'table', 'pre', 'hr', 'form', 'dl', 'dt', 'dd', 'figure', 'address']);

function htmlAttrs(s) {
  const o = Object.create(null);
  for (const m of String(s).matchAll(/([\w:-]+)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) o[m[1].toLowerCase()] = htmlUnescape(m[3] ?? m[4] ?? m[5] ?? '');
  return o;
}
export function htmlToMd(html) {
  const out = [];
  let buf = '';
  let headings = 0, tables = 0;
  const lists = [];      // { ordered }
  let liOpen = false;
  let pOpen = false;
  let heading = 0;
  const tstack = [];     // 表: { rows, row, cell, pending, inCell }
  const links = [];      // { href, at }
  const curTable = () => tstack[tstack.length - 1] || null;
  const inCell = () => { const t = curTable(); return !!(t && t.cell !== null); };
  const text = (s) => {
    const t = s.replace(/\s+/g, ' ');
    if (inCell()) curTable().cell.text += t; else buf += t;
  };
  const brk = () => { if (inCell()) curTable().cell.text += '<br>'; else buf += '\n'; };
  const flush = () => {
    const s = buf.split('\n').map((x) => x.trim()).filter((x) => x).join('  \n');
    buf = '';
    if (!s) return;
    if (heading) { out.push(`${'#'.repeat(Math.min(6, heading + 1))} ${s}`, ''); headings++; }
    else if (liOpen && lists.length) { const l = lists[lists.length - 1]; out.push(`${'  '.repeat(lists.length - 1)}${l.ordered ? '1.' : '-'} ${s}`); }
    else out.push(s, '');
  };
  const closeCell = () => {
    const t = curTable();
    if (!t || t.cell === null) return;
    const c = t.cell;
    t.cell = null;
    if (!t.row) t.row = [];
    while ((t.pending[t.row.length] || 0) > 0) { t.pending[t.row.length]--; t.row.push(''); }
    const at = t.row.length;
    t.row.push(c.text.replace(/(\s*<br>\s*)+/g, '<br>').replace(/(<br>)+$/g, '').replace(/^(<br>)+/, '').replace(/\s+/g, ' ').trim());
    for (let i = 1; i < c.colspan; i++) t.row.push('');
    if (c.rowspan > 1) for (let i = 0; i < c.colspan; i++) t.pending[at + i] = c.rowspan - 1;
  };
  const closeRow = () => {
    const t = curTable();
    if (!t) return;
    closeCell();
    if (t.row) {
      for (let i = t.row.length; i < t.pending.length; i++) if ((t.pending[i] || 0) > 0) { t.pending[i]--; t.row[i] = ''; }
      t.rows.push(Array.from(t.row, (x) => x ?? ''));
      t.row = null;
    }
  };
  const closeTable = () => {
    closeRow();
    const t = tstack.pop();
    if (!t) return;
    if (curTable() && curTable().cell !== null) {
      curTable().cell.text += t.rows.map((r) => r.filter((x) => x).join(' / ')).filter((x) => x).join('<br>');
    } else if (t.rows.length) { out.push(mdTable(t.rows), ''); tables++; }
  };
  const closeP = () => { if (pOpen) { flush(); pOpen = false; } };
  const closeLi = () => { if (liOpen) { flush(); liOpen = false; } };

  const re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/\s*([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^>]*?)?)\s*(\/?)>|([^<]+)|</gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[5] !== undefined) { text(htmlUnescape(m[5])); continue; }
    if (m[0] === '<') { text('<'); continue; }
    if (m[1]) {
      const tag = m[1].toLowerCase();
      if (inCell() && tag !== 'td' && tag !== 'th' && tag !== 'tr' && tag !== 'table' && HTML_BLOCK.has(tag)) { brk(); continue; }
      if (/^h[1-6]$/.test(tag)) { flush(); heading = 0; }
      else if (tag === 'p') closeP();
      else if (tag === 'li') closeLi();
      else if (tag === 'ul' || tag === 'ol') { closeLi(); lists.pop(); liOpen = false; if (!lists.length) out.push(''); }
      else if (tag === 'td' || tag === 'th') closeCell();
      else if (tag === 'tr') closeRow();
      else if (tag === 'table') closeTable();
      else if (tag === 'a') {
        const l = links.pop();
        if (l && l.href && !/^\s*javascript:/i.test(l.href)) {
          const target = inCell() ? curTable().cell : null;
          const src = target ? target.text : buf;
          const label = src.slice(l.at).trim();
          if (label) {
            const md = `[${label}](${l.href})`;
            if (target) target.text = src.slice(0, l.at) + md; else buf = src.slice(0, l.at) + md;
          }
        }
      } else if (HTML_BLOCK.has(tag)) { if (inCell()) brk(); else flush(); }
      continue;
    }
    const tag = (m[2] || '').toLowerCase();
    const a = htmlAttrs(m[3] || '');
    if (HTML_SKIP.has(tag) && !m[4]) {
      const close = new RegExp(`</\\s*${tag}\\s*>`, 'ig');
      close.lastIndex = re.lastIndex;
      const c = close.exec(html);
      re.lastIndex = c ? close.lastIndex : html.length;
      continue;
    }
    if (tag === 'pre') {
      const close = /<\/\s*pre\s*>/ig;
      close.lastIndex = re.lastIndex;
      const c = close.exec(html);
      const raw = html.slice(re.lastIndex, c ? c.index : html.length).replace(/<[^>]*>/g, '');
      re.lastIndex = c ? close.lastIndex : html.length;
      if (inCell()) curTable().cell.text += htmlUnescape(raw).replace(/\r?\n/g, '<br>');
      else { closeP(); flush(); out.push('```', htmlUnescape(raw).replace(/^\n/, '').replace(/\s+$/, ''), '```', ''); }
      continue;
    }
    if (tag === 'br') { brk(); continue; }
    if (tag === 'img') { text(a.alt ? `[図: ${a.alt}]` : '[図]'); continue; }
    if (tag === 'hr') { closeP(); flush(); out.push('---', ''); continue; }
    if (tag === 'a') { const t = inCell() ? curTable().cell.text : buf; links.push({ href: a.href || '', at: t.length }); continue; }
    if (tag === 'table') { if (!inCell()) { closeP(); flush(); } tstack.push({ rows: [], row: null, cell: null, pending: [] }); continue; }
    if (tag === 'tr') { if (curTable()) { closeRow(); curTable().row = []; } continue; }
    if (tag === 'td' || tag === 'th') {
      const t = curTable();
      if (!t) continue;
      closeCell();
      if (!t.row) t.row = [];
      t.cell = { text: '', colspan: Math.max(1, +a.colspan || 1), rowspan: Math.max(1, +a.rowspan || 1) };
      continue;
    }
    if (inCell()) { if (HTML_BLOCK.has(tag) || tag === 'li') brk(); continue; }
    if (/^h[1-6]$/.test(tag)) { closeP(); flush(); heading = +tag[1]; continue; }
    if (tag === 'ul' || tag === 'ol') { closeP(); if (liOpen) flush(); lists.push({ ordered: tag === 'ol' }); continue; }
    if (tag === 'li') { closeP(); closeLi(); liOpen = true; continue; }
    if (tag === 'p') { closeP(); flush(); pOpen = true; continue; }
    if (HTML_BLOCK.has(tag)) { closeP(); flush(); continue; }
  }
  while (tstack.length) closeTable();
  closeP(); closeLi(); flush();
  return { body: tidy(out), counts: `見出し ${headings}・表 ${tables}` };
}

// ======== 入口 ========
// 戻り値 { ok: true, kind, md, counts, tables? } / { ok: false, kind, reason } / { ok: true, kind: 'pdf' | 'image' }（md は作らない）
export async function convertFile(name, bytes, { today } = {}) {
  const d = await detectKind(name, bytes);
  if (d.kind === 'reject') return { ok: false, kind: 'reject', reason: d.reason };
  if (d.kind === 'pdf' || d.kind === 'image') return { ok: true, kind: d.kind, md: null };
  let r;
  try {
    if (d.kind === 'xlsx') r = await xlsxToMd(bytes);
    else if (d.kind === 'csv' || d.kind === 'tsv') r = delimitedToMd(d.text, d.delim);
    else if (d.kind === 'json') r = jsonToMd(d.text);
    else if (d.kind === 'docx') r = await docxToMd(d.zip);
    else if (d.kind === 'pptx') r = await pptxToMd(d.zip);
    else if (d.kind === 'html') r = htmlToMd(d.text);
    else r = { body: d.text.replace(/^﻿/, '').replace(/\s+$/, '') + '\n', counts: `行 ${d.text.split(/\r?\n/).length}` };
  } catch (e) {
    return { ok: false, kind: d.kind, reason: String(e && e.message || e) };
  }
  return { ok: true, kind: d.kind, md: mdHeader(name, today || '', CONVERT_METHOD, r.counts) + r.body, counts: r.counts, tables: r.tables || null };
}
