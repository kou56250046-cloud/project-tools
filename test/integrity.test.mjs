// P3 T1（作業・変更要求・数値の検査・項目をまたぐ検査）と T2（記録の values）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateFields, makeResolver, checkIntegrity, emptyLedger, CHANGELOG_LIMIT } from '../src/core/schema.js';
import { validatePatch, previewPatch, applyLocalOps } from '../src/core/patch.js';
import { runHealth } from '../src/core/health.js';

const load = () => JSON.parse(readFileSync(new URL('../samples/sample-ledger.json', import.meta.url), 'utf8'));
const NOW = '2026-11-26T09:00:00.000Z';
const task = (l, title) => l.items.find((x) => x.kind === 'task' && x.title === title);

test('作業の数値の検査', () => {
  const resolve = makeResolver(load());
  assert.deepEqual(validateFields('task', { title: 'x', progress: 50, estimate: 1.5, milestone: false }, { resolve }).errors, []);
  assert.match(validateFields('task', { title: 'x', progress: 120 }, { resolve }).errors.join(), /0〜100/);
  assert.match(validateFields('task', { title: 'x', progress: 12.5 }, { resolve }).errors.join(), /整数/);
  assert.match(validateFields('task', { title: 'x', estimate: -1 }, { resolve }).errors.join(), /0〜100000/);
  assert.match(validateFields('task', { title: 'x', estimate: '3' }, { resolve }).errors.join(), /数で/);
  assert.match(validateFields('task', { title: 'x', milestone: 'yes' }, { resolve }).errors.join(), /true か false/);
});

test('サンプルには項目をまたぐ誤りが無い', () => {
  assert.deepEqual(checkIntegrity(load()).errors, []);
});

test('親の循環は仮適用の検査で止まり、画面の変更でも適用できない', () => {
  const l = load();
  const p1 = task(l, '要件定義');
  const a = task(l, '現行業務の調査');
  const v = validatePatch({ type: 'ledger-patch', ops: [{ op: 'update', id: p1.id, set: { parent: a.id } }] }, l);
  assert.deepEqual(v.ops[0].errors, []);  // 1件ずつの検査は通る
  const pr = previewPatch(l, v, new Set([0]), NOW);
  assert.ok(pr.integrityErrors.some((e) => /親子が循環/.test(e.message)));
  assert.equal(applyLocalOps(l, [{ op: 'update', id: p1.id, set: { parent: a.id } }], NOW).ok, false);
});

test('前の作業の循環と、終了日だけの部分更新で開始 > 終了になる差分は止まる', () => {
  const l = load();
  const d = task(l, '画面設計');
  const g = task(l, '基本設計レビュー');
  assert.equal(applyLocalOps(l, [{ op: 'update', id: d.id, addLinks: [], set: { dependsOn: [g.id] } }], NOW).ok, false);
  const r = applyLocalOps(l, [{ op: 'update', id: d.id, set: { end: '2026-12-01' } }], NOW);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /開始日/);
});

test('読み込んだ台帳の循環は開いたうえで健康診断に出る', () => {
  const l = load();
  const p1 = task(l, '要件定義');
  p1.parent = task(l, '現行業務の調査').id;
  assert.ok(runHealth(l, '2026-11-26').some((f) => f.code === 'integrity' && f.severity === 'high'));
});

test('担当の無い作業は「担当」と出し、「質問先」とは出さない。親の作業は対象外', () => {
  const l = load();
  const r = applyLocalOps(l, [{ op: 'add', item: { kind: 'task', title: '担当なし作業', end: '2027-01-10', sources: [{ type: 'other', ref: 't' }] } }], NOW);
  const f = runHealth(r.ledger, '2026-11-26').filter((x) => x.code === 'no-owner' && x.itemId === r.ledger.items.at(-1).id);
  assert.equal(f.length, 1);
  assert.match(f[0].message, /担当がありません/);
  assert.equal(runHealth(r.ledger, '2026-11-26').some((x) => x.code === 'no-owner' && x.itemId === task(l, '要件定義').id), false);
});

test('作業の進捗の変化が記録に残る（追加時と更新時）', () => {
  let l = load();
  let r = applyLocalOps(l, [{ op: 'add', item: { kind: 'task', title: '記録用', estimate: 3, progress: 10 } }], NOW);
  const id = r.ledger.items.at(-1).id;
  r = applyLocalOps(r.ledger, [{ op: 'update', id, set: { progress: 50, actual: 1 } }], NOW);
  r = applyLocalOps(r.ledger, [{ op: 'update', id, set: { title: '題名だけ変更' } }], NOW);
  const vals = r.ledger.changelog.flatMap((e) => e.changes).filter((c) => c.id === id && c.values).map((c) => c.values);
  assert.deepEqual(vals, [{ progress: 10, estimate: 3, status: 'todo' }, { progress: 50, actual: 1 }]);
});

test('記録を切り詰めても、起点の記録に作業の最後の値が残る', () => {
  let l = emptyLedger('x', NOW);
  let r = applyLocalOps(l, [{ op: 'add', item: { kind: 'task', title: 't', estimate: 5, progress: 0 } }], NOW);
  const id = r.ledger.items[0].id;
  r = applyLocalOps(r.ledger, [{ op: 'update', id, set: { progress: 30 } }], NOW);
  l = r.ledger;
  for (let i = 0; i < CHANGELOG_LIMIT; i++) l.changelog.push({ rev: 100 + i, at: NOW, source: 'local', changes: [] });
  r = applyLocalOps(l, [{ op: 'add', item: { kind: 'issue', title: 'x' } }], NOW);
  const first = r.ledger.changelog[0];
  assert.equal(r.ledger.changelog.length, CHANGELOG_LIMIT);
  assert.equal(first.source, 'snapshot');
  assert.deepEqual(first.changes.find((c) => c.id === id).values, { estimate: 5, progress: 30, status: 'todo' });
});
