// 変更の影響範囲: 対象の項目から、参照フィールド（両方向）・links・関係を幅優先で 2 段までたどる
// 関係者とシステムは影響範囲に含めるが、そこから先へはたどらない（担当者つながりで無関係な作業が入らないように）

import { refsOf, buildBackrefs, linkIndex, KIND_IDS, kindLabel, statusLabel } from './schema.js';

const TERMINAL = new Set(['stakeholder', 'system']);

// 戻り値: { items: { item, depth }[], byKind: Record<kind, Item[]>, tasks: Item[], taskEstimate: number }
export function impactOf(ledger, rootIds, depth = 2) {
  const byId = new Map(ledger.items.map((it) => [it.id, it]));
  const back = buildBackrefs(ledger);
  const links = linkIndex(ledger);
  const neighbors = (id) => {
    const it = byId.get(id);
    const out = new Set();
    // 親子（parent）はたどらない。子から親へ上がると兄弟の作業まで入るため。子孫は下でまとめて足す
    if (it) for (const r of refsOf(it)) if (r.field !== 'parent') out.add(r.id);
    for (const b of back.get(id) || []) if (b.field !== 'parent') out.add(b.from);
    for (const x of links.get(id) || []) out.add(x);
    return out;
  };
  const roots = new Set(rootIds);
  const seen = new Map();
  let frontier = [...roots];
  for (let d = 1; d <= depth && frontier.length; d++) {
    const next = [];
    for (const id of frontier) {
      const it = byId.get(id);
      // 根でない関係者・システムからは先へ進まない
      if (it && TERMINAL.has(it.kind) && !roots.has(id)) continue;
      for (const n of neighbors(id)) {
        if (roots.has(n) || seen.has(n) || !byId.has(n)) continue;
        seen.set(n, d);
        next.push(n);
      }
    }
    frontier = next;
  }
  // たどり着いた作業の子孫も含める（親だけがつながっていても、子の見積を数えるため）
  const children = new Map();
  for (const it of ledger.items) if (it.kind === 'task' && it.parent) {
    if (!children.has(it.parent)) children.set(it.parent, []);
    children.get(it.parent).push(it.id);
  }
  const addDesc = (id, d) => {
    for (const c of children.get(id) || []) {
      if (!seen.has(c) && !roots.has(c)) { seen.set(c, d); addDesc(c, d); }
    }
  };
  for (const [id, d] of [...seen]) if (byId.get(id).kind === 'task') addDesc(id, d);

  const items = [...seen].map(([id, d]) => ({ item: byId.get(id), depth: d }));
  const byKind = {};
  for (const k of KIND_IDS) byKind[k] = [];
  for (const x of items) byKind[x.item.kind].push(x.item);
  // 見積は末端の作業だけを足す（親と子を二重に数えない）
  const tasks = byKind.task || [];
  const leafEst = tasks.filter((t) => !children.has(t.id) && t.status !== 'cancelled').reduce((a, t) => a + (t.estimate || 0), 0);
  return { items, byKind, tasks, taskEstimate: Math.round(leafEst * 10) / 10 };
}

// 変更要求書の下書き（平文）
export function changeRequestText(ledger, cr, imp) {
  const name = (id) => { const it = ledger.items.find((x) => x.id === id); return it ? `${it.title}（${id}）` : id; };
  const L = [];
  L.push(`変更要求書（下書き）　${cr.id}`, '');
  L.push(`■ 件名: ${cr.title}`);
  if (cr.requestedBy) L.push(`■ 依頼者: ${name(cr.requestedBy)}`);
  L.push(`■ 状態: ${statusLabel('change', cr.status)}`);
  if (cr.body) L.push('', '■ 内容', cr.body);
  L.push('', '■ 対象');
  for (const id of cr.links || []) L.push(`・${name(id)}`);
  if (!(cr.links || []).length) L.push('・（未指定）');
  L.push('', '■ 影響範囲（台帳から機械的に求めたもの）');
  for (const [k, list] of Object.entries(imp.byKind)) {
    if (!list.length || k === 'stakeholder' || k === 'system') continue;
    L.push(`【${kindLabel(k)}】`);
    for (const it of list) L.push(`・${it.title}（${it.id}${it.kind === 'task' && typeof it.estimate === 'number' ? `・見積 ${it.estimate} 人日` : ''}）`);
  }
  const people = [...(imp.byKind.stakeholder || []), ...(imp.byKind.system || [])];
  if (people.length) L.push('【関係者・システム】', ...people.map((it) => `・${it.title}（${it.id}）`));
  L.push('', `■ 影響する作業の見積の合計: ${imp.taskEstimate} 人日`);
  L.push(`■ 追加工数の見込み: ${typeof cr.extraEstimate === 'number' ? cr.extraEstimate + ' 人日' : '未見積'}`);
  L.push('', '■ 判断', '（承認 / 却下 / 保留。決定者と日付を記入）');
  return L.join('\n');
}
