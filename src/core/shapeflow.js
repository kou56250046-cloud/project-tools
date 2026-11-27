// 図形と矢印（コネクタ）→ フロー記法。PowerPoint のスライドと Excel のシートの図形で共通に使う（P6d）
// 入力: { shapes: [{ id, text, geom, x, y, w, h }], links: [{ from, to, x1, y1, x2, y2, head, tail }] }
//   geom: prstGeom の名前。links の from/to は接続先の図形 id（無ければ null。端点から近い図形を探す）
//   head/tail: 線の始点側（head）・終点側（tail）に矢じりがあるか
// 出力: { ok, notation, used: Set<図形 id>, reason }。ok=false のときは呼ぶ側が今までどおり文字だけを出す
// DOM に触れない

import { FLOWCHART } from './flow.js';

export const SHAPEFLOW_MAX = 60;       // これを超える図形の数ではフローを起こさない
const SF_LABEL_MAX = 12;               // 線のラベルとみなす文字の長さの上限

const SF_DECISION = new Set(['diamond', 'flowChartDecision']);
const SF_TERMINAL = new Set(['flowChartTerminator', 'ellipse', 'roundRect', 'flowChartAlternateProcess', 'flowChartConnector']);
const SF_DOC = new Set(['flowChartDocument', 'flowChartMultidocument']);
const SF_DATA = new Set(['can', 'flowChartMagneticDisk', 'flowChartInputOutput', 'flowChartMagneticDrum', 'flowChartStoredData', 'parallelogram']);
const SF_SUB = new Set(['flowChartPredefinedProcess']);
const SF_RECT = new Set(['rect', 'flowChartProcess', '']);

const sfOneLine = (t) => String(t || '').replace(/\s+/g, ' ').replace(/->/g, '→').replace(/\.\.>/g, '→').replace(/[[\]［］{}｛｝]/g, (c) => ({ '[': '［', ']': '］', '{': '｛', '}': '｝' })[c] || c).trim();
const sfCenter = (s) => ({ cx: s.x + s.w / 2, cy: s.y + s.h / 2 });
const sfInside = (inner, outer) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
// 点から図形の枠までの距離（中なら 0）
function sfDist(px, py, s) {
  const dx = Math.max(s.x - px, 0, px - (s.x + s.w));
  const dy = Math.max(s.y - py, 0, py - (s.y + s.h));
  return Math.hypot(dx, dy);
}

export function shapesToFlow(input) {
  const shapes = (input.shapes || []).filter((s) => s && s.w > 0 && s.h > 0);
  const links = input.links || [];
  const fail = (reason) => ({ ok: false, notation: '', used: new Set(), reason });
  if (links.length < 2) return fail('線が 2 本未満');
  if (shapes.length > SHAPEFLOW_MAX) return fail(`図形が ${SHAPEFLOW_MAX} を超える`);
  const byId = new Map(shapes.map((s) => [String(s.id), s]));

  // レーン: 文字を持ち、ほかの図形を 2 つ以上完全に囲む長方形
  const lanes = shapes.filter((s) => SF_RECT.has(s.geom || '') && sfOneLine(s.text) && shapes.filter((o) => o !== s && sfInside(o, s)).length >= 2);
  const laneSet = new Set(lanes);
  // 線の端の図形（レーンは端にしない）
  const nodeCands = shapes.filter((s) => !laneSet.has(s));
  const tol = (l) => Math.max(20, Math.hypot(l.x2 - l.x1, l.y2 - l.y1) * 0.25);
  const nearest = (px, py, limit) => {
    let best = null, bd = Infinity;
    for (const s of nodeCands) { const d = sfDist(px, py, s); if (d < bd) { bd = d; best = s; } }
    return bd <= limit ? best : null;
  };
  const edges = [];
  for (const l of links) {
    let a = l.from != null && byId.has(String(l.from)) && !laneSet.has(byId.get(String(l.from))) ? byId.get(String(l.from)) : nearest(l.x1, l.y1, tol(l));
    let b = l.to != null && byId.has(String(l.to)) && !laneSet.has(byId.get(String(l.to))) ? byId.get(String(l.to)) : nearest(l.x2, l.y2, tol(l));
    if (!a || !b || a === b) continue;
    // 矢じりが始点側にだけあるときは向きを逆にする
    if (l.head && !l.tail) [a, b] = [b, a];
    edges.push({ a, b, mx: (l.x1 + l.x2) / 2, my: (l.y1 + l.y2) / 2, len: Math.hypot(l.x2 - l.x1, l.y2 - l.y1), label: '' });
  }
  if (edges.length < 2) return fail('図形どうしを結ぶ線が 2 本未満');

  const nodes = [...new Set(edges.flatMap((e) => [e.a, e.b]))];
  const nodeSet = new Set(nodes);
  // ラベル: 線に結ばれない、短い文字の図形で、線の中点に最も近いもの
  const used = new Set();
  const labelCands = nodeCands.filter((s) => !nodeSet.has(s) && sfOneLine(s.text) && [...sfOneLine(s.text)].length <= SF_LABEL_MAX);
  for (const s of labelCands) {
    const { cx, cy } = sfCenter(s);
    let best = null, bd = Infinity;
    for (const e of edges) { const d = Math.hypot(cx - e.mx, cy - e.my); if (d < bd) { bd = d; best = e; } }
    if (best && !best.label && bd <= Math.max(best.len / 2, 40)) { best.label = sfOneLine(s.text); used.add(String(s.id)); }
  }

  // 並び: 上から下、左から右（ほぼ同じ高さは左から）
  const rowH = Math.max(1, Math.min(...nodes.map((n) => n.h)) / 2);
  nodes.sort((p, q) => Math.round(sfCenter(p).cy / rowH) - Math.round(sfCenter(q).cy / rowH) || sfCenter(p).cx - sfCenter(q).cx);
  const idOf = new Map(nodes.map((n, i) => [n, `N${i + 1}`]));
  const inDeg = new Map(nodes.map((n) => [n, 0])), outDeg = new Map(nodes.map((n) => [n, 0]));
  for (const e of edges) { outDeg.set(e.a, outDeg.get(e.a) + 1); inDeg.set(e.b, inDeg.get(e.b) + 1); }
  const typeOf = (n) => {
    const g = n.geom || '';
    if (SF_DECISION.has(g)) return 'decision';
    if (SF_DOC.has(g)) return 'doc';
    if (SF_DATA.has(g)) return 'data';
    if (SF_SUB.has(g)) return 'sub';
    if (SF_TERMINAL.has(g)) return !inDeg.get(n) ? 'start' : !outDeg.get(n) ? 'end' : 'task';
    return 'task';
  };
  // レーンの名前（重なりは ［］ に置き換え済み）。ノードは中心が入るレーン
  const laneName = (s) => sfOneLine(s.text);
  const horizontal = lanes.length ? lanes.every((l) => l.w >= l.h) : true;
  const laneOrder = [...lanes].sort((p, q) => (horizontal ? p.y - q.y : p.x - q.x));
  const laneOf = (n) => { const { cx, cy } = sfCenter(n); return laneOrder.find((l) => cx >= l.x && cx <= l.x + l.w && cy >= l.y && cy <= l.y + l.h) || null; };
  const useLanes = laneOrder.length > 0 && nodes.every((n) => laneOf(n));

  const out = [];
  if (input.title) out.push(`title ${sfOneLine(input.title)}`);
  if (useLanes) for (const l of laneOrder) out.push(`lane ${laneName(l)}`);
  if (out.length) out.push('');
  for (const n of nodes) {
    const lane = useLanes ? laneName(laneOf(n)) : '';
    const at = lane ? ` @${/\s/.test(lane) ? `[${lane}]` : lane}` : '';
    out.push(`${typeOf(n)} ${idOf.get(n)}${at} ${sfOneLine(n.text) || '（文字なし）'}`);
  }
  out.push('');
  for (const e of edges) out.push(`${idOf.get(e.a)} -> ${idOf.get(e.b)}${e.label ? ` : ${e.label}` : ''}`);
  const notation = out.join('\n');
  const g = FLOWCHART.parse(notation);
  if (g.errors.length) return fail(`フロー記法にできない（${g.errors[0].message}）`);
  for (const n of nodes) used.add(String(n.id));
  if (useLanes) for (const l of laneOrder) used.add(String(l.id));
  return { ok: true, notation, used, reason: '' };
}
