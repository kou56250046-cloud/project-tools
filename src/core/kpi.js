// KPI の木: 目的 → ゴール（案件情報の goals の文）→ KPI（→ 子の KPI）→ 施策（KPI と関連でつながる要望）→ 要件。DOM に触れない。
// 子の KPI は親の下にだけ出し、どのゴールの下に置くかは、いちばん上の祖先の goal で決める。循環していても止まる

import { linkIndex } from './schema.js';

// 戻り値 { purpose, roots: [{ goal, nodes: [Node] }], unassigned: [Node], count }
// Node = { kpi, children: [Node], requests: [{ request, requirements: [要件] }], directRequirements: [要件] }
export function kpiTree(ledger) {
  const kpis = ledger.items.filter((it) => it.kind === 'kpi');
  const byId = new Map(ledger.items.map((it) => [it.id, it]));
  const links = linkIndex(ledger);
  const linked = (id, pred) => [...(links.get(id) || [])].map((x) => byId.get(x)).filter((x) => x && pred(x)).sort((a, b) => a.id.localeCompare(b.id));
  const isReq = (x) => x.kind === 'requirement' && x.status !== 'dropped';
  const kids = new Map();
  const kpiIds = new Set(kpis.map((k) => k.id));
  for (const k of kpis) if (k.parent && kpiIds.has(k.parent) && k.parent !== k.id) {
    if (!kids.has(k.parent)) kids.set(k.parent, []);
    kids.get(k.parent).push(k);
  }
  let count = 0;
  const seen = new Set();
  const build = (k) => {
    if (seen.has(k.id)) return null;   // 循環していても止まる（循環は検査が出す）
    seen.add(k.id);
    count++;
    const requests = linked(k.id, (x) => x.kind === 'request' && x.status !== 'rejected').map((request) => ({ request, requirements: linked(request.id, isReq) }));
    count += requests.reduce((a, r) => a + 1 + r.requirements.length, 0);
    const directRequirements = linked(k.id, isReq);
    count += directRequirements.length;
    const children = (kids.get(k.id) || []).sort((a, b) => a.id.localeCompare(b.id)).map(build).filter(Boolean);
    return { kpi: k, children, requests, directRequirements };
  };
  // 根: 親が無いか、親が KPI でないもの。循環だけでできた KPI も消えないよう、最後に残りを根として足す
  const rootKpis = kpis.filter((k) => !k.parent || !kpiIds.has(k.parent) || k.parent === k.id);
  const goalsList = (ledger.project.goals || []).map((g) => String(g).trim()).filter(Boolean);
  const roots = goalsList.map((goal) => ({ goal, nodes: [] }));
  const byGoal = new Map(roots.map((r) => [r.goal, r]));
  const unassigned = [];
  for (const k of rootKpis) {
    const n = build(k);
    if (!n) continue;
    const g = byGoal.get(String(k.goal || '').trim());
    (g ? g.nodes : unassigned).push(n);
  }
  for (const k of kpis) if (!seen.has(k.id)) { const n = build(k); if (n) unassigned.push(n); }
  return { purpose: ledger.project.purpose || '', roots, unassigned, count: count + roots.length };
}
