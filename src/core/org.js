// 体制図の配置。DOM に触れない。
// 列は立場（schema の stakeholder.side の順）、列の中は所属ごとのまとまり、まとまりの中は上長 → 部下の木（字下げ）。
// 上長が別の所属・別の列にいるときは、その所属の根として置き、線だけ引く（cross）。上長が循環していても箱は消えない

import { KINDS } from './schema.js';

export const ORG_BOX = { w: 200, h: 46, indent: 18, gapY: 8, groupGap: 30, colGap: 40, top: 30, left: 16, groupHead: 22 };

// 戻り値 { columns: [{ side, label, x, groups: [{ org, y, nodes: [{ id, item, x, y, w, h, depth, cycle }] }] }], edges: [{ from, to, cross }], width, height }
export function orgLayout(ledger) {
  const B = ORG_BOX;
  const people = ledger.items.filter((it) => it.kind === 'stakeholder');
  const byId = new Map(people.map((p) => [p.id, p]));
  const sides = KINDS.stakeholder.fields.side.values;
  const orgOf = (p) => String(p.org || '').trim() || '（所属なし）';
  const columns = [];
  const pos = new Map();
  let height = 0;
  sides.forEach((sd, ci) => {
    const x = B.left + ci * (B.w + B.indent * 3 + B.colGap);
    const col = { side: sd.v, label: sd.label, x, groups: [] };
    const inSide = people.filter((p) => p.side === sd.v);
    const orgs = [...new Set(inSide.map(orgOf))].sort((a, b) => (a === '（所属なし）') - (b === '（所属なし）') || a.localeCompare(b, 'ja'));
    let y = B.top;
    for (const org of orgs) {
      const members = inSide.filter((p) => orgOf(p) === org).sort((a, b) => a.id.localeCompare(b.id));
      const inGroup = new Set(members.map((p) => p.id));
      const kids = new Map();
      for (const p of members) if (p.reportsTo && inGroup.has(p.reportsTo) && p.reportsTo !== p.id) {
        if (!kids.has(p.reportsTo)) kids.set(p.reportsTo, []);
        kids.get(p.reportsTo).push(p);
      }
      const group = { org, y, nodes: [] };
      y += B.groupHead;
      const seen = new Set();
      const place = (p, depth, cycle) => {
        if (seen.has(p.id)) return;
        seen.add(p.id);
        const node = { id: p.id, item: p, x: x + depth * B.indent, y, w: B.w, h: B.h, depth, cycle: !!cycle };
        group.nodes.push(node);
        pos.set(p.id, node);
        y += B.h + B.gapY;
        for (const c of kids.get(p.id) || []) place(c, depth + 1, false);
      };
      // 根: 上長がいない・上長がこのまとまりの外・自分自身
      for (const p of members) if (!p.reportsTo || !inGroup.has(p.reportsTo) || p.reportsTo === p.id) place(p, 0, false);
      // 循環だけでできた人も消えないよう、残りを根として置く（印つき）
      for (const p of members) if (!seen.has(p.id)) place(p, 0, true);
      col.groups.push(group);
      y += B.groupGap;
    }
    height = Math.max(height, y);
    columns.push(col);
  });
  const edges = [];
  for (const p of people) {
    if (!p.reportsTo || !byId.has(p.reportsTo) || p.reportsTo === p.id) continue;
    const a = pos.get(p.reportsTo), b = pos.get(p.id);
    if (!a || !b) continue;
    edges.push({ from: p.reportsTo, to: p.id, cross: a.item.side !== b.item.side || orgOf(a.item) !== orgOf(b.item) });
  }
  const width = B.left * 2 + sides.length * (B.w + B.indent * 3 + B.colGap);
  return { columns, edges, width, height: Math.max(height, B.top + 60) };
}
