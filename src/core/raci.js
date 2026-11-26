// RACI: 明示（台帳の raci）と、表示のときだけの補い。DOM に触れない。
// 補いは役ごと: 明示に R が無ければ担当（task.assignee・issue.owner）を R、明示に A が無く決めた人（decision.decidedBy）が 1 人ならその人を A。
// 明示で別の役を持つ人には補わない。補いは保存しない（表で押したときに、明示の役だけを書き直す）

import { RACI_ROLES, isOpen } from './schema.js';

export const RACI_KINDS = ['task', 'decision', 'issue'];
const ORDER = ['', ...RACI_ROLES.map((r) => r.v)];   // '' → R → A → C → I → ''

// 戻り値 [{ who, role, derived }]
export function effectiveRaci(item) {
  const explicit = Array.isArray(item.raci) ? item.raci.filter((e) => e && e.who && e.role) : [];
  const out = explicit.map((e) => ({ who: e.who, role: e.role, derived: false }));
  const has = (role) => out.some((e) => e.role === role);
  const taken = (who) => out.some((e) => e.who === who);
  const resp = item.kind === 'task' ? item.assignee : item.kind === 'issue' ? item.owner : null;
  if (!has('R') && resp && !taken(resp)) out.push({ who: resp, role: 'R', derived: true });
  if (item.kind === 'decision' && !has('A') && Array.isArray(item.decidedBy) && item.decidedBy.length === 1 && !taken(item.decidedBy[0])) {
    out.push({ who: item.decidedBy[0], role: 'A', derived: true });
  }
  return out;
}

export const cycleRole = (role) => ORDER[(ORDER.indexOf(role || '') + 1) % ORDER.length];

// 表で押したとき: その人の今の役（明示か補い）の次の役を、明示の要素として書き直す。補いは書き写さない
export function setRaciOp(item, who) {
  const cur = effectiveRaci(item).find((e) => e.who === who);
  const next = cycleRole(cur ? cur.role : '');
  const explicit = (Array.isArray(item.raci) ? item.raci : []).filter((e) => e && e.who !== who);
  if (next) explicit.push({ who, role: next });
  return { op: 'update', id: item.id, set: { raci: explicit } };
}

// RACI 表の行。tasks: 'top'（親を持たない作業。中止を除く）か 'all'。issues: 'open' か 'all'。決定は置き換え済みを除く（all のときは含める）
export function raciRows(ledger, { tasks = 'top', issues = 'open', all = false } = {}) {
  const rows = [];
  const push = (item) => {
    const cells = new Map();
    for (const e of effectiveRaci(item)) cells.set(e.who, { role: e.role, derived: e.derived });
    rows.push({ item, cells });
  };
  for (const t of ledger.items.filter((it) => it.kind === 'task')) {
    if (tasks === 'top' && (t.parent || t.status === 'cancelled')) continue;
    push(t);
  }
  for (const d of ledger.items.filter((it) => it.kind === 'decision')) if (all || d.status !== 'superseded') push(d);
  for (const i of ledger.items.filter((it) => it.kind === 'issue')) if (issues === 'all' || isOpen(i)) push(i);
  return rows;
}

// 表の列: 関与中の関係者と、関与なしでも明示の役を持つ人
export function raciColumns(ledger) {
  const used = new Set(ledger.items.flatMap((it) => (Array.isArray(it.raci) ? it.raci.map((e) => e && e.who) : [])));
  return ledger.items.filter((it) => it.kind === 'stakeholder' && (it.status !== 'inactive' || used.has(it.id)));
}
