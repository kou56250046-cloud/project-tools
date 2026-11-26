import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateLedger } from '../src/core/schema.js';
import { validatePatch, planPatch, applyPatch, applyLocalOps, updateRows } from '../src/core/patch.js';

const NOW = '2026-11-25T12:00:00.000Z';
const load = (name) => JSON.parse(readFileSync(new URL(`../samples/${name}`, import.meta.url), 'utf8'));
const all = (v) => new Set(v.ops.map((p) => p.index));
const errorsOf = (v) => v.ops.flatMap((p) => p.errors);

test('(9) サンプル台帳は検証を通る', () => {
  assert.deepEqual(validateLedger(load('sample-ledger.json')), []);
});

test('サンプル差分は誤りなく通り、適用後も台帳が正しい', () => {
  const l = load('sample-ledger.json');
  const v = validatePatch(load('sample-patch.json'), l);
  assert.deepEqual(v.errors, []);
  assert.deepEqual(errorsOf(v), []);
  const r = applyPatch(l, v, all(v), NOW);
  assert.equal(r.applied, 7);
  assert.deepEqual(validateLedger(r.ledger), []);
  assert.equal(r.ledger.revision, 13);
});

test('(1)(2) 採番は既存と重複せず、仮IDは本IDに置き換わる', () => {
  const l = load('sample-ledger.json');
  const v = validatePatch(load('sample-patch.json'), l);
  const { ledger, idMap } = applyPatch(l, v, all(v), NOW);
  assert.equal(idMap.get('new:1'), 'SH-011');
  assert.equal(idMap.get('new:2'), 'QA-006');
  const qa = ledger.items.find((it) => it.id === 'QA-006');
  assert.equal(qa.askTo, 'SH-011');
  const dc = ledger.items.find((it) => it.id === 'DC-004');
  assert.deepEqual(dc.links, ['RE-001', 'QA-006']);
  assert.equal(ledger.relations.at(-1).id, 'RL-013');
  assert.equal(ledger.relations.at(-1).from, 'SH-011');
  assert.equal(new Set(ledger.items.map((it) => it.id)).size, ledger.items.length);
});

test('(3) 却下した追加を参照する値は表どおりに後始末され、警告が出る', () => {
  const l = load('sample-ledger.json');
  const v = validatePatch(load('sample-patch.json'), l);
  const accepted = all(v);
  accepted.delete(0); // new:1（関係者）を却下
  const plan = planPatch(v, accepted);
  assert.ok(plan.autoRejected.has(5), 'relate は自動で却下');
  assert.match(plan.warnings.get(1).join(), /質問先を外します/);
  const { ledger } = applyPatch(l, v, accepted, NOW);
  const qa = ledger.items.find((it) => it.title === '得意先へのアカウント発行は誰が行うか');
  assert.equal(qa.askTo, undefined);
  assert.equal(ledger.relations.length, 12);

  accepted.delete(1); // new:2（質問）も却下 → 決定の links から外れる
  const plan2 = planPatch(v, accepted);
  assert.match(plan2.warnings.get(2).join(), /関連から外します/);
  const r2 = applyPatch(l, v, accepted, NOW);
  const dc = r2.ledger.items.find((it) => it.kind === 'decision' && it.title.startsWith('Web 発注'));
  assert.deepEqual(dc.links, ['RE-001']);
});

test('却下した関係者が出典の発言者なら speaker だけ外れる', () => {
  const l = load('sample-ledger.json');
  const v = validatePatch({ type: 'ledger-patch', ops: [
    { op: 'add', tempId: 'new:a', item: { kind: 'stakeholder', title: 'x', side: 'own' } },
    { op: 'add', item: { kind: 'request', title: 'y', sources: [{ type: 'meeting', ref: 'm', speaker: 'new:a' }] } },
  ] }, l);
  const { ledger } = applyPatch(l, v, new Set([1]), NOW);
  const rq = ledger.items.at(-1);
  assert.deepEqual(rq.sources, [{ type: 'meeting', ref: 'm' }]);
});

test('(4) 存在しない ID への更新と参照はエラー', () => {
  const l = load('sample-ledger.json');
  const v = validatePatch({ type: 'ledger-patch', ops: [
    { op: 'update', id: 'IS-099', set: { status: 'closed' } },
    { op: 'add', item: { kind: 'issue', title: 'x', owner: 'SH-099' } },
    { op: 'relate', from: 'SH-001', to: 'RQ-001', label: '要望' },
    { op: 'add', item: { kind: 'question', title: 'y', askTo: 'new:9' } },
  ] }, l);
  assert.match(v.ops[0].errors.join(), /台帳にありません/);
  assert.match(v.ops[1].errors.join(), /SH-099/);
  assert.match(v.ops[2].errors.join(), /関係者とシステムの間/);
  assert.match(v.ops[3].errors.join(), /仮ID「new:9」/);
});

test('(5) 元の台帳オブジェクトは変わらない', () => {
  const l = load('sample-ledger.json');
  const before = JSON.stringify(l);
  const v = validatePatch(load('sample-patch.json'), l);
  applyPatch(l, v, all(v), NOW);
  assert.equal(JSON.stringify(l), before);
});

test('(6) id・kind・createdAt の更新はエラー', () => {
  const l = load('sample-ledger.json');
  const v = validatePatch({ type: 'ledger-patch', ops: [
    { op: 'update', id: 'IS-001', set: { kind: 'question' } },
    { op: 'update', id: 'IS-001', set: { id: 'IS-100', title: 'x' } },
  ] }, l);
  assert.match(v.ops[0].errors.join(), /kind は変更できません/);
  assert.match(v.ops[1].errors.join(), /id は変更できません/);
});

test('(7) supersedes つきの決定を足すと古い決定が superseded になる', () => {
  const l = load('sample-ledger.json');
  const r = applyLocalOps(l, [
    { op: 'add', item: { kind: 'decision', title: '専用単価は廃止', decidedAt: '2026-11-25', supersedes: 'DC-002' } },
  ], NOW);
  assert.equal(r.ok, true);
  assert.equal(r.ledger.items.find((it) => it.id === 'DC-002').status, 'superseded');
  assert.equal(r.ledger.items.find((it) => it.id === 'DC-004').status, 'valid');
});

test('(8) 誤りのある操作が混ざっても、正しい操作だけ適用できる', () => {
  const l = load('sample-ledger.json');
  const v = validatePatch({ type: 'ledger-patch', ops: [
    { op: 'add', item: { kind: 'issue', title: '正しい課題' } },
    { op: 'add', item: { kind: 'issue', title: '誤り', status: 'done' } },
    { op: 'remove', id: 'IS-001' },
  ] }, l);
  assert.equal(v.ops[0].errors.length, 0);
  assert.ok(v.ops[1].errors.length > 0);
  assert.match(v.ops[2].errors.join(), /op「remove」は使えません/);
  const r = applyPatch(l, v, all(v), NOW);
  assert.equal(r.applied, 1);
  assert.equal(r.ledger.items.at(-1).title, '正しい課題');
});

test('update で null を渡すと任意項目を外す。addLinks は追記', () => {
  const l = load('sample-ledger.json');
  const r = applyLocalOps(l, [{ op: 'update', id: 'IS-001', set: { due: null }, addLinks: ['RQ-001', 'DC-002'] }], NOW);
  const it = r.ledger.items.find((x) => x.id === 'IS-001');
  assert.equal(it.due, undefined);
  assert.deepEqual(it.links, ['DC-002', 'RQ-001']);
  assert.equal(applyLocalOps(l, [{ op: 'update', id: 'IS-001', set: { title: null } }], NOW).ok, false);
});

test('同じ関係の重複と、台帳全体を差分として貼った場合はエラー', () => {
  const l = load('sample-ledger.json');
  const v = validatePatch({ type: 'ledger-patch', ops: [{ op: 'relate', from: 'SH-005', to: 'SH-008', label: '発注' }] }, l);
  assert.match(v.ops[0].errors.join(), /すでにあります/);
  assert.match(validatePatch(l, l).errors.join(), /台帳全体/);
});

test('revision の食い違いは警告、未知の項目は警告して捨てる', () => {
  const l = load('sample-ledger.json');
  const v = validatePatch({ type: 'ledger-patch', basedOnRevision: 3, ops: [{ op: 'add', item: { kind: 'issue', title: 'x', memo: 'y' } }] }, l);
  assert.match(v.warnings.join(), /revision 3/);
  assert.match(v.ops[0].warnings.join(), /memo/);
  const r = applyPatch(l, v, all(v), NOW);
  assert.equal(r.ledger.items.at(-1).memo, undefined);
});

test('変更前 → 変更後の行', () => {
  const l = load('sample-ledger.json');
  const rows = updateRows(l, { op: 'update', id: 'QA-001', set: { status: 'answered' } });
  assert.deepEqual(rows[0], { field: 'status', label: '状態', before: 'open', after: 'answered' });
});
