// P4 T1: テーブル・画面・連携・バッチ、列・項目・CRUD、配列の中の参照と後始末
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateFields, makeResolver, checkIntegrity, refsOf } from '../src/core/schema.js';
import { validatePatch, planPatch, applyPatch, applyLocalOps, previewPatch } from '../src/core/patch.js';

const load = () => JSON.parse(readFileSync(new URL('../samples/sample-ledger.json', import.meta.url), 'utf8'));
const NOW = '2026-11-26T09:00:00.000Z';
const ent = (l, name) => l.items.find((x) => x.kind === 'entity' && x.physicalName === name);

test('サンプルの設計には項目をまたぐ誤りが無い', () => {
  assert.deepEqual(checkIntegrity(load()).errors, []);
});

test('列・CRUD の要素の検査', () => {
  const l = load();
  const resolve = makeResolver(l);
  const cus = ent(l, 'customer').id;
  assert.deepEqual(validateFields('screen', { title: 'x', screenType: 'input', crud: [{ entity: cus, ops: 'CRU' }] }, { resolve }).errors, []);
  assert.match(validateFields('screen', { title: 'x', screenType: 'input', crud: [{ entity: cus, ops: 'X' }] }, { resolve }).errors.join(), /C・R・U・D/);
  assert.match(validateFields('screen', { title: 'x', screenType: 'input', crud: [{ entity: cus, ops: 'CC' }] }, { resolve }).errors.join(), /重ねず/);
  assert.match(validateFields('entity', { title: 'x', physicalName: 'x', fileType: 'internal', columns: [{ name: 'a', type: 'varchar' }] }, { resolve }).errors.join(), /「varchar」は使えません/);
  assert.match(validateFields('entity', { title: 'x', physicalName: 'x', fileType: 'internal', columns: [{ name: 'a', type: 'code', fk: { entity: 'EN-099', column: 'a' } }] }, { resolve }).errors.join(), /EN-099/);
  assert.match(validateFields('entity', { title: 'x', physicalName: 'x', fileType: 'internal', columns: [{ name: 'a', type: 'code', pattern: '([' }] }, { resolve }).errors.join(), /正規表現/);
});

test('物理名の重複・外部キーの列が無い・主キーなし（警告）', () => {
  const l = load();
  const cus = ent(l, 'customer').id;
  const r1 = applyLocalOps(l, [{ op: 'add', item: { kind: 'entity', title: '得意先2', physicalName: 'CUSTOMER', fileType: 'internal', columns: [{ name: 'id', type: 'int', pk: true }] } }], NOW);
  assert.equal(r1.ok, false);
  assert.match(r1.errors.join(), /物理名「CUSTOMER」が/);
  const r2 = applyLocalOps(l, [{ op: 'add', item: { kind: 'entity', title: 'x', physicalName: 'x', fileType: 'internal', columns: [{ name: 'c', type: 'code', pk: true, fk: { entity: cus, column: 'nope' } }] } }], NOW);
  assert.equal(r2.ok, false);
  assert.match(r2.errors.join(), /列「nope」がありません/);
  const r3 = applyLocalOps(l, [{ op: 'add', item: { kind: 'entity', title: '主キーなし', physicalName: 'no_pk', fileType: 'internal', columns: [{ name: 'a', type: 'int' }] } }], NOW);
  assert.equal(r3.ok, true);
  assert.ok(checkIntegrity(r3.ledger).warnings.some((w) => /主キーがありません/.test(w.message)));
});

test('却下したテーブルを参照する CRUD の要素は外れ、列の外部キーは参照ごと外れる', () => {
  const l = load();
  const v = validatePatch({ type: 'ledger-patch', ops: [
    { op: 'add', tempId: 'new:t', item: { kind: 'entity', title: '新テーブル', physicalName: 'new_table', fileType: 'internal', columns: [{ name: 'id', type: 'int', pk: true }] } },
    { op: 'add', item: { kind: 'entity', title: '子', physicalName: 'child', fileType: 'internal', columns: [{ name: 'id', type: 'int', pk: true }, { name: 'parent_id', type: 'int', fk: { entity: 'new:t', column: 'id' } }] } },
    { op: 'add', item: { kind: 'batch', title: '取込', crud: [{ entity: 'new:t', ops: 'C' }, { entity: ent(l, 'product').id, ops: 'R' }] } },
  ] }, l);
  assert.deepEqual(v.ops.flatMap((p) => p.errors), []);
  const accepted = new Set([1, 2]);
  const plan = planPatch(v, accepted);
  assert.match(plan.warnings.get(1).join(), /「parent_id」の参照（fk）を外します/);
  assert.match(plan.warnings.get(2).join(), /CRUDからその行を外します/);
  const r = applyPatch(l, v, accepted, NOW);
  const child = r.ledger.items.find((x) => x.physicalName === 'child');
  assert.equal(child.columns[1].fk, undefined);
  const batch = r.ledger.items.at(-1);
  assert.deepEqual(batch.crud.map((c) => c.entity), [ent(l, 'product').id]);
});

test('仮IDのテーブルを参照する CRUD は本IDに置き換わり、逆参照に出る', () => {
  const l = load();
  const r = applyLocalOps(l, [
    { op: 'add', tempId: 'new:t', item: { kind: 'entity', title: 'T', physicalName: 't', fileType: 'internal', columns: [{ name: 'id', type: 'int', pk: true }] } },
    { op: 'add', item: { kind: 'screen', title: 'S', screenType: 'inquiry', crud: [{ entity: 'new:t', ops: 'R' }] } },
  ], NOW);
  const t = r.ledger.items.find((x) => x.physicalName === 't');
  const sc = r.ledger.items.at(-1);
  assert.equal(sc.crud[0].entity, t.id);
  assert.deepEqual(refsOf(sc).map((x) => [x.field, x.id]), [['crud', t.id]]);
});

test('列を減らす update は、消える列の名前を警告する', () => {
  const l = load();
  const cus = ent(l, 'customer');
  const v = validatePatch({ type: 'ledger-patch', ops: [{ op: 'update', id: cus.id, set: { columns: cus.columns.slice(0, 2) } }] }, l);
  assert.match(v.ops[0].warnings.join(), /次が消えます: price_rank、created_at/);
});

test('取込の仮適用で物理名の重複が止まる', () => {
  const l = load();
  const v = validatePatch({ type: 'ledger-patch', ops: [{ op: 'add', item: { kind: 'entity', title: 'x', physicalName: 'product', fileType: 'internal', columns: [{ name: 'a', type: 'int', pk: true }] } }] }, l);
  assert.ok(previewPatch(l, v, new Set([0]), NOW).integrityErrors.length > 0);
});

// P4 T5: 健康診断
import { runHealth } from '../src/core/health.js';
const codes = (l, c) => runHealth(l, '2026-11-26').filter((f) => f.code === c);

test('健康診断: 要件とつながらない設計・作成されないテーブル・作業の無い要件・見積の差', () => {
  const l = load();
  // 要件とつながらない設計: 倉庫在庫・在庫取込のバッチ、それに決定（DC-002）にだけつながる得意先別単価と単価の保守画面
  assert.deepEqual(codes(l, 'unlinked-design').map((f) => f.itemId).sort(), ['BT-001', 'EN-003', 'EN-006', 'SC-004']);
  assert.equal(codes(l, 'entity-no-create').length, 0);
  const r = applyLocalOps(l, [{ op: 'add', item: { kind: 'entity', title: '作られない', physicalName: 'orphan', fileType: 'internal', columns: [{ name: 'id', type: 'int', pk: true }] } }], NOW);
  assert.equal(codes(r.ledger, 'entity-no-create').length, 1);
  assert.equal(codes(l, 'req-no-task').length, 0);
  const r2 = applyLocalOps(l, [{ op: 'add', item: { kind: 'requirement', title: '作業なし', category: 'functional', status: 'agreed' } }], NOW);
  assert.equal(codes(r2.ledger, 'req-no-task').length, 1);
  l.settings.productivity = 1;
  assert.equal(codes(l, 'fp-gap').length, 0);    // 225 と 181 で 24%
  l.settings.productivity = 2;
  assert.equal(codes(l, 'fp-gap').length, 1);    // 450 と 181
});
