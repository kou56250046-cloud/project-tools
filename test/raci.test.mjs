// P7b: 体制（上長・体制上の役割）と RACI
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateLedger, checkIntegrity, refsOf } from '../src/core/schema.js';
import { applyLocalOps, validatePatch, planPatch, applyPatch, removedElements } from '../src/core/patch.js';
import { runHealth } from '../src/core/health.js';
import { buildPrompt, itemsText, schemaText } from '../src/core/prompts.js';
import { effectiveRaci, cycleRole, setRaciOp, raciRows, raciColumns } from '../src/core/raci.js';
import { orgLayout } from '../src/core/org.js';

const NOW = '2026-11-26T00:00:00.000Z';
const TODAY = '2026-11-26';
const load = () => JSON.parse(readFileSync(new URL('../samples/sample-ledger.json', import.meta.url), 'utf8'));
const sh = (l) => l.items.filter((it) => it.kind === 'stakeholder');

test('上長・体制上の役割・RACI を差分でも画面の操作でも足せ、検査を通る', () => {
  const l = load();
  const [a, b] = sh(l);
  const r = applyLocalOps(l, [
    { op: 'update', id: b.id, set: { reportsTo: a.id, teamRole: 'pm' } },
    { op: 'update', id: 'TK-001', set: { raci: [{ who: a.id, role: 'A' }, { who: b.id, role: 'R' }] } },
  ], NOW);
  assert.equal(r.ok, true, r.errors && r.errors.join());
  assert.deepEqual(validateLedger(r.ledger), []);
  // refsOf が raci の who を返す
  assert.ok(refsOf(r.ledger.items.find((it) => it.id === 'TK-001')).some((x) => x.field === 'raci' && x.id === a.id));
});

test('RACI の誤り（関係者でない ID・役の誤り・同じ人の重複）と上長の循環', () => {
  const l = load();
  const [a, b] = sh(l);
  const v = validatePatch({ type: 'ledger-patch', ops: [
    { op: 'update', id: 'TK-001', set: { raci: [{ who: 'TK-002', role: 'R' }] } },
    { op: 'update', id: 'TK-001', set: { raci: [{ who: a.id, role: 'X' }] } },
    { op: 'update', id: 'TK-001', set: { raci: [{ who: a.id, role: 'R' }, { who: a.id, role: 'A' }] } },
  ] }, l);
  assert.deepEqual(v.ops.map((p) => p.errors.length > 0), [true, true, true]);
  const cyc = structuredClone(l);
  cyc.items.find((it) => it.id === a.id).reportsTo = b.id;
  cyc.items.find((it) => it.id === b.id).reportsTo = a.id;
  assert.ok(checkIntegrity(cyc).errors.some((e) => /上長をたどると/.test(e.message)));
});

test('仮 ID の関係者: 採用すれば置き換わり、却下すれば RACI の要素ごと外れる', () => {
  const l = load();
  const patch = { type: 'ledger-patch', ops: [
    { op: 'add', tempId: 'new:p', item: { kind: 'stakeholder', title: '新しい承認者', side: 'customer' } },
    { op: 'update', id: 'TK-001', set: { raci: [{ who: 'new:p', role: 'A' }, { who: sh(l)[0].id, role: 'R' }] } },
  ] };
  const v = validatePatch(patch, l);
  assert.deepEqual(v.ops.flatMap((p) => p.errors), []);
  const both = applyPatch(l, v, new Set([0, 1]), NOW).ledger;
  const newId = both.items.find((it) => it.title === '新しい承認者').id;
  assert.deepEqual(both.items.find((it) => it.id === 'TK-001').raci.map((e) => e.who), [newId, sh(l)[0].id]);
  const plan = planPatch(v, new Set([1]));
  assert.ok([...plan.warnings.values()].flat().some((w) => /RACI|raci/.test(w)), '却下で外れる警告');
  const onlyUpdate = applyPatch(l, v, new Set([1]), NOW).ledger;
  assert.deepEqual(onlyUpdate.items.find((it) => it.id === 'TK-001').raci, [{ who: sh(l)[0].id, role: 'R' }]);
});

test('補いは役ごと: 担当 → R、決めた人が 1 人なら A（2 人なら補わない）、明示の役を持つ人には補わない', () => {
  const task = { id: 'TK-9', kind: 'task', assignee: 'SH-1' };
  assert.deepEqual(effectiveRaci(task), [{ who: 'SH-1', role: 'R', derived: true }]);
  assert.deepEqual(effectiveRaci({ ...task, raci: [{ who: 'SH-2', role: 'R' }] }), [{ who: 'SH-2', role: 'R', derived: false }]);
  assert.deepEqual(effectiveRaci({ ...task, raci: [{ who: 'SH-1', role: 'C' }] }), [{ who: 'SH-1', role: 'C', derived: false }]);
  assert.deepEqual(effectiveRaci({ ...task, raci: [] }), [{ who: 'SH-1', role: 'R', derived: true }]);
  const dec = { id: 'DC-9', kind: 'decision', decidedBy: ['SH-3'] };
  assert.deepEqual(effectiveRaci(dec), [{ who: 'SH-3', role: 'A', derived: true }]);
  assert.deepEqual(effectiveRaci({ ...dec, decidedBy: ['SH-3', 'SH-4'] }), []);
  assert.deepEqual(effectiveRaci({ id: 'IS-9', kind: 'issue', owner: 'SH-5' }), [{ who: 'SH-5', role: 'R', derived: true }]);
});

test('押したときの役の順と、明示の要素だけを書き直すこと', () => {
  assert.deepEqual(['', 'R', 'A', 'C', 'I'].map(cycleRole), ['R', 'A', 'C', 'I', '']);
  const task = { id: 'TK-9', kind: 'task', assignee: 'SH-1', raci: [{ who: 'SH-2', role: 'C' }] };
  // 補いの R（SH-1）を押す → SH-1 は明示の A になり、SH-2 の C は残る
  assert.deepEqual(setRaciOp(task, 'SH-1').set.raci, [{ who: 'SH-2', role: 'C' }, { who: 'SH-1', role: 'A' }]);
  // 明示の I を押す → 外れる
  assert.deepEqual(setRaciOp({ ...task, raci: [{ who: 'SH-2', role: 'I' }] }, 'SH-2').set.raci, []);
  // 補いを書き写さない（SH-3 を押しても、担当 SH-1 の R は保存されない）
  assert.deepEqual(setRaciOp({ id: 'TK-9', kind: 'task', assignee: 'SH-1' }, 'SH-3').set.raci, [{ who: 'SH-3', role: 'R' }]);
});

test('Gemini の update で RACI から人が消えるとき、消える人を返す', () => {
  const l = load();
  const t = l.items.find((it) => it.id === 'TK-001');
  t.raci = [{ who: 'SH-001', role: 'R' }, { who: 'SH-002', role: 'A' }];
  const gone = removedElements(l, { op: 'update', id: 'TK-001', set: { raci: [{ who: 'SH-001', role: 'R' }] } });
  assert.deepEqual(gone, [{ field: 'raci', names: ['SH-002'] }]);
});

test('健康診断: 承認者のいない工程・決める人のいない高い課題・A が 2 人以上（明示だけ）・上長が関与なし', () => {
  const l = load();
  const phase = l.items.find((it) => it.kind === 'task' && !it.parent && l.items.some((c) => c.parent === it.id));
  assert.ok(phase, 'サンプルに工程がある');
  let h = runHealth(l, TODAY);
  assert.ok(h.some((f) => f.code === 'task-no-a' && f.itemId === phase.id));
  const ok = applyLocalOps(l, [{ op: 'update', id: phase.id, set: { raci: [{ who: 'SH-001', role: 'A' }, { who: 'SH-002', role: 'A' }] } }], NOW).ledger;
  h = runHealth(ok, TODAY);
  assert.ok(!h.some((f) => f.code === 'task-no-a' && f.itemId === phase.id));
  assert.ok(h.some((f) => f.code === 'multiple-a' && f.itemId === phase.id));
  // 決めた人 2 人の決定は補わないので multiple-a は出ない
  assert.ok(!h.some((f) => f.code === 'multiple-a' && f.itemId.startsWith('DC-')));
  const [a, b] = sh(l);
  const inact = applyLocalOps(l, [{ op: 'update', id: a.id, set: { status: 'inactive' } }, { op: 'update', id: b.id, set: { reportsTo: a.id } }], NOW).ledger;
  assert.ok(runHealth(inact, TODAY).some((f) => f.code === 'reports-to-inactive' && f.itemId === b.id));
});

test('指示文: RACI が読める形で出る（[object Object] にならない）。体制の整理では今の RACI が載る', () => {
  const l = load();
  l.items.find((it) => it.id === 'TK-001').raci = [{ who: 'SH-001', role: 'R' }, { who: 'SH-002', role: 'A' }];
  assert.ok(itemsText(l, true).includes('RACI: SH-001:R, SH-002:A'));
  assert.ok(!itemsText(l, true).includes('[object Object]'));
  assert.ok(schemaText().includes('"role": "R"'));
  assert.ok(buildPrompt('org', l, { today: TODAY }).includes('RACI: SH-001:R, SH-002:A'));
});

test('RACI 表の行と列', () => {
  const l = load();
  const top = raciRows(l, { tasks: 'top', issues: 'open' });
  assert.ok(top.every((r) => r.item.kind !== 'task' || !r.item.parent));
  assert.ok(top.filter((r) => r.item.kind === 'issue').every((r) => ['open', 'in_progress'].includes(r.item.status)));
  assert.ok(!top.some((r) => r.item.status === 'superseded'));
  assert.ok(raciRows(l, { tasks: 'all', issues: 'all', all: true }).length > top.length);
  const [a] = sh(l);
  const l2 = structuredClone(l);
  l2.items.find((it) => it.id === a.id).status = 'inactive';
  assert.ok(!raciColumns(l2).some((p) => p.id === a.id));
  l2.items.find((it) => it.id === 'TK-001').raci = [{ who: a.id, role: 'I' }];
  assert.ok(raciColumns(l2).some((p) => p.id === a.id), '関与なしでも明示の役があれば列に出る');
});

test('体制図: 列は立場の順、所属のまとまり、木の字下げ、別の列への線、所属なし、上長の循環でも消えない', () => {
  const l = load();
  const [a, b, c] = sh(l);
  const l2 = structuredClone(l);
  const set = (id, patch) => Object.assign(l2.items.find((it) => it.id === id), patch);
  set(b.id, { reportsTo: a.id, org: a.org, side: a.side });
  set(c.id, { org: '' });
  const g = orgLayout(l2);
  assert.deepEqual(g.columns.map((x) => x.side), ['customer', 'own', 'vendor']);
  const all = g.columns.flatMap((x) => x.groups.flatMap((gr) => gr.nodes));
  assert.equal(all.length, sh(l2).length);
  const nb = all.find((n) => n.id === b.id);
  assert.equal(nb.depth, 1);
  assert.ok(g.columns.some((x) => x.groups.some((gr) => gr.org === '（所属なし）')));
  // 別の列の上長
  const l3 = structuredClone(l2);
  const other = sh(l3).find((p) => p.side !== a.side);
  Object.assign(l3.items.find((it) => it.id === other.id), { reportsTo: a.id });
  assert.ok(orgLayout(l3).edges.some((e) => e.to === other.id && e.cross));
  // 循環
  const l4 = structuredClone(l2);
  Object.assign(l4.items.find((it) => it.id === a.id), { reportsTo: b.id });
  const g4 = orgLayout(l4);
  const nodes4 = g4.columns.flatMap((x) => x.groups.flatMap((gr) => gr.nodes));
  assert.equal(nodes4.length, sh(l4).length, '循環でも箱が消えない');
  assert.ok(nodes4.some((n) => n.cycle));
});
