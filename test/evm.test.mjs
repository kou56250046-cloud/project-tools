// P3 T3: WBS の集計と EVM（手計算した小さな例で確かめる）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyLedger } from '../src/core/schema.js';
import { applyLocalOps } from '../src/core/patch.js';
import { buildTree } from '../src/core/wbs.js';
import { computeEvm } from '../src/core/evm.js';
import { runHealth } from '../src/core/health.js';

// 日本時間の正午（端末のローカル日付と UTC の日付がずれないように）
const at = (ymd) => new Date(`${ymd}T12:00:00+09:00`).toISOString();

function example() {
  let l = emptyLedger('EVM 例', at('2026-11-01'));
  const step = (ops, ymd) => { const r = applyLocalOps(l, ops, at(ymd)); if (!r.ok) throw new Error(r.errors.join()); l = r.ledger; };
  step([
    { op: 'add', tempId: 'new:p', item: { kind: 'task', title: 'P' } },
    { op: 'add', tempId: 'new:1', item: { kind: 'task', title: 'T1', parent: 'new:p', estimate: 10, start: '2026-11-02', end: '2026-11-11', progress: 0, actual: 0 } },
    { op: 'add', tempId: 'new:2', item: { kind: 'task', title: 'T2', parent: 'new:p', estimate: 20, start: '2026-11-09', end: '2026-11-28', progress: 0, actual: 0 } },
    { op: 'add', tempId: 'new:3', item: { kind: 'task', title: 'T3', estimate: 5, start: '2026-11-16', end: '2026-11-20', progress: 0, actual: 0 } },
  ], '2026-11-01');
  const id = (t) => l.items.find((x) => x.title === t).id;
  step([{ op: 'update', id: id('T1'), set: { progress: 40, actual: 3 } }], '2026-11-05');
  step([{ op: 'update', id: id('T1'), set: { progress: 100, actual: 9, status: 'done' } }], '2026-11-11');
  step([{ op: 'update', id: id('T2'), set: { progress: 10, actual: 2 } }], '2026-11-13');
  return { l, id };
}

test('WBS: 親は子の見積・実績を合計し、進捗は見積で重みづけ', () => {
  const { l, id } = example();
  const { byId } = buildTree(l, '2026-11-16');
  assert.deepEqual(byId.get(id('P')).rollup, { estimate: 30, actual: 11, progress: 40 });
});

test('WBS: 遅れの判定（経過割合 − 進捗 ≥ 20 ポイント、完了は対象外）', () => {
  const { l, id } = example();
  const { byId } = buildTree(l, '2026-11-16');
  assert.equal(byId.get(id('T1')).delayed, false);  // 完了
  assert.equal(byId.get(id('T2')).delayed, true);   // 40% 経過 − 10% = 30
  assert.equal(byId.get(id('T3')).delayed, true);   // 20% 経過 − 0% = 20
});

test('EVM: 今日の値', () => {
  const { l } = example();
  const e = computeEvm(l, '2026-11-16');
  assert.equal(e.bac, 35);
  assert.equal(e.pv, 19);   // 10 + 20×0.4 + 5×0.2
  assert.equal(e.ev, 12);   // 10 + 20×0.1
  assert.equal(e.ac, 11);
  assert.equal(e.spi, 0.63);
  assert.equal(e.cpi, 1.09);
  assert.equal(e.eac, 32.1); // 35 / (12/11)
});

test('EVM: S カーブの週ごとの点（記録から復元。未来は PV だけ）', () => {
  const { l } = example();
  const c = computeEvm(l, '2026-11-16').curve;
  assert.deepEqual(c.map((p) => p.date), ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23']);
  assert.deepEqual(c[0], { date: '2026-11-02', pv: 1, ev: 0, ac: 0, today: false });
  assert.deepEqual(c[1], { date: '2026-11-09', pv: 9, ev: 4, ac: 3, today: false });
  assert.deepEqual(c[2], { date: '2026-11-16', pv: 19, ev: 12, ac: 11, today: true });
  assert.equal(c[3].ev, null);
  assert.equal(c[3].ac, null);
});

test('EVM: AC が 0 なら CPI と EAC は null、PV が 0 なら SPI は null', () => {
  const { l } = example();
  const e = computeEvm(l, '2026-10-20');
  assert.equal(e.pv, 0);
  assert.equal(e.spi, null);
  const l2 = emptyLedger('x', at('2026-11-01'));
  const r = applyLocalOps(l2, [{ op: 'add', item: { kind: 'task', title: 'a', estimate: 5, start: '2026-11-02', end: '2026-11-06', progress: 0 } }], at('2026-11-01'));
  const e2 = computeEvm(r.ledger, '2026-11-04');
  assert.equal(e2.cpi, null);
  assert.equal(e2.eac, null);
});

test('健康診断 evm-low（SPI 0.63 < 0.9）', () => {
  const { l } = example();
  const f = runHealth(l, '2026-11-16').filter((x) => x.code === 'evm-low');
  assert.equal(f.length, 1);
  assert.match(f[0].message, /SPI が 0.63/);
});
