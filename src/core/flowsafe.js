// 誤りのある業務フローの記法でも描けるようにする。誤りのある行を外して読み直し、残りで配置する
// 行を消すと行番号がずれるので、空行に置き換える（誤りの行番号は元の記法のまま返す）

import { FLOWCHART } from './flow.js';

const FLOW_RETRY = 5;   // 行を外すと別の行が誤りになる（消えた箱への矢印など）ので、何回か繰り返す

export function parseFlowTolerant(src) {
  const first = FLOWCHART.parse(String(src || ''));
  let lines = String(src || '').split(/\r?\n/);
  let g = first;
  const dropped = new Set();
  for (let k = 0; k < FLOW_RETRY && g.errors.length; k++) {
    for (const e of g.errors) if (e.line >= 1 && e.line <= lines.length) dropped.add(e.line);
    lines = lines.map((l, i) => (dropped.has(i + 1) ? '' : l));
    g = FLOWCHART.parse(lines.join('\n'));
  }
  // 繰り返しても誤りが残るときは、描かない（箱の無い図を出さない）
  const drawable = !g.errors.length && g.nodes.length > 0;
  return { graph: drawable ? g : null, errors: first.errors, warnings: g.warnings || [], dropped: [...dropped].sort((a, b) => a - b) };
}

export function flowGeometry(src, opt) {
  const r = parseFlowTolerant(src);
  return { ...r, geo: r.graph ? FLOWCHART.layout(r.graph, opt) : null };
}
