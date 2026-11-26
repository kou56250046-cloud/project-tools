// 構成図の配置: 真ん中に案件のシステム、左に受信元（連携の向き in の相手）、右に送信先（out の相手）
// 同じ相手・同じ向きの連携は 1 本にまとめ、ラベルに連携名（方式・頻度）を並べる。取り下げの連携・バッチは出さない
// DOM に触れない（描くのは src/ui/views/arch.js）

import { KINDS, enumLabel } from './schema.js';

export const ARCH_BOX = { w: 200, h: 56, gapX: 230, gapY: 22, top: 44, margin: 20, labelH: 15 };
export const ARCH_LABEL_MAX = 3;   // 1 本の線に並べる連携名の数。超えたら「ほか N 件」
const ARCH_MARK = { planned: '（新規予定）', retired: '（廃止）' };

const ifLabel = (it) => {
  const sub = [it.method ? enumLabel(KINDS.interface.fields.method.values, it.method) : '', it.frequency || ''].filter(Boolean).join('・');
  return sub ? `${it.title}（${sub}）` : it.title;
};

export function archGraph(ledger) {
  const systems = ledger.items.filter((it) => it.kind === 'system');
  const byId = new Map(systems.map((s) => [s.id, s]));
  const ifs = ledger.items.filter((it) => it.kind === 'interface' && it.status !== 'dropped' && byId.has(it.system));
  const batches = ledger.items.filter((it) => it.kind === 'batch' && it.status !== 'dropped').map((b) => ({ id: b.id, title: b.title, frequency: b.frequency || '', trigger: b.trigger || '' }));
  // 相手と向きでまとめる（台帳の順を保つ）
  const groups = new Map();
  for (const it of ifs) {
    const key = `${it.direction}|${it.system}`;
    if (!groups.has(key)) groups.set(key, { direction: it.direction, systemId: it.system, interfaces: [] });
    groups.get(key).interfaces.push(it);
  }
  const side = (dir) => [...groups.values()].filter((g) => g.direction === dir);
  const linked = new Set(ifs.map((it) => it.system));
  return {
    empty: !systems.length && !ifs.length,
    self: ledger.project.name || 'この案件のシステム',
    inbound: side('in'), outbound: side('out'),
    batches,
    unlinked: systems.filter((s) => !linked.has(s.id)),
    byId,
  };
}

// 座標を決める。戻り値の箱は { system, x, y, w, h, mark, dashed }、線は { from:[x,y], to:[x,y], labels, more, interfaces, direction }
export function archLayout(ledger) {
  const g = archGraph(ledger);
  const B = ARCH_BOX;
  const xL = B.margin, xC = B.margin + B.gapX + B.w, xR = B.margin + 2 * (B.gapX + B.w);
  const place = (list, x) => {
    let y = B.top;
    return list.map((gr) => {
      const n = Math.min(gr.interfaces.length, ARCH_LABEL_MAX) + (gr.interfaces.length > ARCH_LABEL_MAX ? 1 : 0);
      const rowH = Math.max(B.h, n * B.labelH + 12);
      const s = g.byId.get(gr.systemId);
      const box = { system: s, x, y: y + (rowH - B.h) / 2, w: B.w, h: B.h, mark: ARCH_MARK[s.status] || '', dashed: s.status === 'retired', group: gr };
      y += rowH + B.gapY;
      return box;
    });
  };
  const left = place(g.inbound, xL), right = place(g.outbound, xR);
  const bottom = (bs) => (bs.length ? Math.max(...bs.map((b) => b.y + b.h)) : B.top + B.h);
  const colBottom = Math.max(bottom(left), bottom(right));
  const selfBox = { x: xC, y: (B.top + colBottom) / 2 - B.h / 2, w: B.w, h: B.h, label: g.self };
  const edges = [];
  const edge = (box, dir) => {
    const labels = box.group.interfaces.slice(0, ARCH_LABEL_MAX).map(ifLabel);
    const more = Math.max(0, box.group.interfaces.length - ARCH_LABEL_MAX);
    const a = dir === 'in' ? [box.x + box.w, box.y + box.h / 2] : [selfBox.x + selfBox.w, selfBox.y + selfBox.h / 2];
    const b = dir === 'in' ? [selfBox.x, selfBox.y + selfBox.h / 2] : [box.x, box.y + box.h / 2];
    edges.push({ from: a, to: b, labels, more, direction: dir, interfaces: box.group.interfaces.map((it) => it.id), systemId: box.system.id });
  };
  left.forEach((b) => edge(b, 'in'));
  right.forEach((b) => edge(b, 'out'));
  const batchTop = selfBox.y + selfBox.h + 18;
  const batchBottom = g.batches.length ? batchTop + 18 + g.batches.length * 17 : selfBox.y + selfBox.h;
  return {
    empty: g.empty,
    width: xR + B.w + B.margin,
    height: Math.ceil(Math.max(colBottom, batchBottom) + B.margin),
    self: selfBox, left, right, edges,
    batches: g.batches, batchTop,
    unlinked: g.unlinked.map((s) => ({ system: s, mark: ARCH_MARK[s.status] || '' })),
  };
}
