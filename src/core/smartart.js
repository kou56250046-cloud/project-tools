// SmartArt のデータ（ppt/diagrams/data*.xml・word/diagrams/data*.xml）→ md（P6d）
// 親子のつながり（dgm:cxn の parOf）から字下げの箇条書きにする。手順型（process・cycle・chevron・arrow）はフロー記法にする
// 入力は convert.js の parseXml で読んだ木（この中では XML を読まない）。DOM に触れない

import { FLOWCHART } from './flow.js';

const saKids = (n, name) => (n ? n.children.filter((c) => typeof c !== 'string' && (!name || c.name === name)) : []);
function saFind(n, name) {
  if (!n || typeof n === 'string') return null;
  for (const c of n.children) {
    if (typeof c === 'string') continue;
    if (c.name === name) return c;
    const f = saFind(c, name);
    if (f) return f;
  }
  return null;
}
function saText(n) {
  const out = [];
  const walk = (x) => { for (const c of x.children) { if (typeof c === 'string') continue; if (c.name === 'a:t') out.push(c.children.filter((y) => typeof y === 'string').join('')); else walk(c); } };
  if (n) walk(n);
  return out.join(' ').replace(/\s+/g, ' ').trim();
}
const SA_STEP = /process|cycle|chevron|arrow|funnel|venn/i;
const SA_FLOW_ONLY = /process|cycle|chevron|arrow/i;

// tree: parseXml(data.xml) の結果。戻り値: md の文字列（中身が無ければ ''）
export function smartArtToMd(tree) {
  const model = saFind(tree, 'dgm:dataModel');
  if (!model) return '';
  const pts = new Map();
  let docId = null, layout = '';
  for (const pt of saKids(saFind(model, 'dgm:ptLst'), 'dgm:pt')) {
    const type = pt.attrs.type || 'node';
    const id = pt.attrs.modelId;
    if (type === 'doc') { docId = id; const ps = saFind(pt, 'dgm:prSet'); layout = (ps && ps.attrs.loTypeId) || ''; continue; }
    if (type !== 'node' && type !== 'asst') continue;
    pts.set(id, { id, text: saText(saFind(pt, 'dgm:t')), kids: [] });
  }
  if (!docId) return '';
  const roots = [];
  const cxns = saKids(saFind(model, 'dgm:cxnLst'), 'dgm:cxn').filter((c) => (c.attrs.type || 'parOf') === 'parOf');
  cxns.sort((a, b) => (+a.attrs.srcOrd || 0) - (+b.attrs.srcOrd || 0));
  for (const c of cxns) {
    const child = pts.get(c.attrs.destId);
    if (!child) continue;
    if (c.attrs.srcId === docId) roots.push(child);
    else { const parent = pts.get(c.attrs.srcId); if (parent) parent.kids.push(child); }
  }
  const named = roots.filter((r) => r.text || r.kids.length);
  if (!named.length) return '';
  // 手順型は、根の並びを順につないだフロー記法にする（子の文字は箱の文字に添える）
  if (SA_FLOW_ONLY.test(layout) && named.length >= 2) {
    const one = (t) => String(t).replace(/->/g, '→').replace(/[[\]{}]/g, ' ').trim();
    const lines = named.map((r, i) => `task S${i + 1} ${one([r.text, r.kids.map((k) => k.text).filter(Boolean).join('・')].filter(Boolean).join('：')) || '（文字なし）'}`);
    const chain = named.map((_, i) => `S${i + 1}`).join(' -> ');
    const notation = [...lines, '', chain].join('\n');
    if (!FLOWCHART.parse(notation).errors.length) return ['[SmartArt（手順）]', '```flow', notation, '```'].join('\n');
  }
  const out = [`[SmartArt${SA_STEP.test(layout) ? '（手順）' : ''}]`];
  const walk = (n, depth) => { if (n.text) out.push(`${'  '.repeat(depth)}- ${n.text}`); for (const k of n.kids) walk(k, n.text ? depth + 1 : depth); };
  for (const r of named) walk(r, 0);
  return out.join('\n');
}
