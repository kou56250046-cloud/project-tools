// WBS: 作業の階層と、子からの集計（見積・実績・進捗）、遅れの判定

import { dayNumber } from './schema.js';

export const DELAY_POINTS = 20;

export function dayToYmd(d) {
  return new Date(d * 86400000).toISOString().slice(0, 10);
}

// 期間の経過割合（0〜1）。today の日の終わり時点。日付がそろわなければ null
export function elapsedRatio(task, todayNum) {
  if (!task.start || !task.end) return null;
  const s = dayNumber(task.start);
  const e = dayNumber(task.end);
  if (todayNum < s) return 0;
  return Math.min(1, (todayNum - s + 1) / (e - s + 1));
}

const byStart = (a, b) => (a.start || '9999').localeCompare(b.start || '9999') || a.id.localeCompare(b.id);

// 戻り値: { roots: Node[], byId: Map<id, Node>, flat: Node[] }
// Node = { item, children, depth, leaf, rollup: { estimate, actual, progress }, ratio, delayed }
export function buildTree(ledger, today) {
  const todayNum = dayNumber(today);
  const tasks = ledger.items.filter((it) => it.kind === 'task');
  const byId = new Map(tasks.map((t) => [t.id, { item: t, children: [], depth: 0 }]));
  const roots = [];
  for (const n of byId.values()) {
    const p = n.item.parent && byId.get(n.item.parent);
    if (p && p !== n) p.children.push(n); else roots.push(n);
  }
  const flat = [];
  const seen = new Set();
  const walk = (n, depth) => {
    if (seen.has(n.item.id)) return; // 循環していても止まる（循環は健康診断が出す）
    seen.add(n.item.id);
    n.depth = depth;
    n.children.sort((a, b) => byStart(a.item, b.item));
    flat.push(n);
    for (const c of n.children) walk(c, depth + 1);
    n.leaf = n.children.length === 0;
    if (n.leaf) {
      n.rollup = { estimate: n.item.estimate || 0, actual: n.item.actual || 0, progress: n.item.progress || 0 };
    } else {
      const live = n.children.filter((c) => c.item.status !== 'cancelled' && c.rollup);
      const est = live.reduce((a, c) => a + c.rollup.estimate, 0);
      const act = live.reduce((a, c) => a + c.rollup.actual, 0);
      const prog = est > 0
        ? live.reduce((a, c) => a + c.rollup.estimate * c.rollup.progress, 0) / est
        : (live.length ? live.reduce((a, c) => a + c.rollup.progress, 0) / live.length : 0);
      n.rollup = { estimate: est, actual: act, progress: Math.round(prog * 10) / 10 };
    }
    n.ratio = elapsedRatio(n.item, todayNum);
    n.delayed = n.leaf && !n.item.milestone && n.ratio !== null && !['done', 'cancelled'].includes(n.item.status) && n.ratio * 100 - n.rollup.progress >= DELAY_POINTS;
  };
  roots.sort((a, b) => byStart(a.item, b.item));
  for (const r of roots) walk(r, 0);
  return { roots, byId, flat };
}
