// P7c T3: 構成図の配置（core/arch.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archLayout, archGraph, ARCH_LABEL_MAX } from '../src/core/arch.js';

const sys = (id, title, status = 'existing') => ({ id, kind: 'system', title, status });
const itf = (id, system, direction, extra = {}) => ({ id, kind: 'interface', title: `連携${id}`, system, direction, status: 'draft', ...extra });
const ledgerOf = (items) => ({ project: { name: '受注システム刷新' }, items, relations: [] });

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('受信元は左、送信先は右、両方向の相手は左右の両方に出る。箱は重ならない', () => {
  const L = archLayout(ledgerOf([
    sys('SY-1', '会計'), sys('SY-2', '倉庫'), sys('SY-3', 'EC'),
    itf('IF-1', 'SY-1', 'out'), itf('IF-2', 'SY-3', 'in'), itf('IF-3', 'SY-2', 'in'), itf('IF-4', 'SY-2', 'out'),
  ]));
  assert.deepEqual(L.left.map((b) => b.system.id), ['SY-3', 'SY-2']);
  assert.deepEqual(L.right.map((b) => b.system.id), ['SY-1', 'SY-2']);
  for (const b of L.left) assert.ok(b.x + b.w < L.self.x);
  for (const b of L.right) assert.ok(b.x > L.self.x + L.self.w);
  const all = [...L.left, ...L.right, L.self];
  all.forEach((a, i) => all.slice(i + 1).forEach((b) => assert.ok(!overlap(a, b))));
  assert.equal(L.self.label, '受注システム刷新');
  // 線の向き: 受信は相手 → 真ん中、送信は真ん中 → 相手
  const e2 = L.edges.find((e) => e.interfaces.includes('IF-2'));
  assert.ok(e2.from[0] < e2.to[0] && e2.to[0] === L.self.x);
  const e1 = L.edges.find((e) => e.interfaces.includes('IF-1'));
  assert.ok(e1.from[0] === L.self.x + L.self.w && e1.to[0] > e1.from[0]);
});

test('同じ相手・同じ向きの連携は 1 本にまとめ、方式・頻度をラベルに並べる。多いときは「ほか N 件」', () => {
  const items = [sys('SY-1', '会計')];
  for (let i = 1; i <= ARCH_LABEL_MAX + 2; i++) items.push(itf(`IF-${i}`, 'SY-1', 'out', { method: 'file', frequency: '日次' }));
  const L = archLayout(ledgerOf(items));
  assert.equal(L.edges.length, 1);
  assert.equal(L.edges[0].labels.length, ARCH_LABEL_MAX);
  assert.equal(L.edges[0].more, 2);
  assert.equal(L.edges[0].labels[0], '連携IF-1（ファイル・日次）');
  assert.equal(L.edges[0].interfaces.length, ARCH_LABEL_MAX + 2);
});

test('新規予定・廃止の印（廃止は破線）、取り下げの連携・バッチを出さない、連携の無いシステム、バッチの一覧', () => {
  const L = archLayout(ledgerOf([
    sys('SY-1', '新基盤', 'planned'), sys('SY-2', '旧基盤', 'retired'), sys('SY-3', '人事'), sys('SY-4', '経費'),
    itf('IF-1', 'SY-1', 'out'), itf('IF-2', 'SY-2', 'in'), itf('IF-3', 'SY-3', 'in', { status: 'dropped' }),
    { id: 'BT-1', kind: 'batch', title: '夜間集計', status: 'fixed', frequency: '日次' },
    { id: 'BT-2', kind: 'batch', title: '取り下げた処理', status: 'dropped' },
  ]));
  assert.equal(L.right[0].mark, '（新規予定）');
  assert.equal(L.left[0].mark, '（廃止）');
  assert.equal(L.left[0].dashed, true);
  assert.equal(L.right[0].dashed, false);
  assert.ok(!L.edges.some((e) => e.interfaces.includes('IF-3')));
  assert.deepEqual(L.unlinked.map((u) => u.system.id), ['SY-3', 'SY-4'], '取り下げの連携だけの相手は連携の無いシステム');
  assert.deepEqual(L.batches.map((b) => b.id), ['BT-1']);
  assert.ok(L.batchTop > L.self.y + L.self.h);
  assert.ok(L.height >= L.batchTop + 30, 'バッチの一覧が図の高さに入る');
});

test('0 件: システムも連携も無ければ empty。相手のシステムが無い連携は線にしない', () => {
  assert.equal(archLayout(ledgerOf([])).empty, true);
  assert.equal(archLayout(ledgerOf([{ id: 'BT-1', kind: 'batch', title: 'x', status: 'draft' }])).empty, true);
  const g = archGraph(ledgerOf([sys('SY-1', 'a'), itf('IF-1', 'SY-9', 'in')]));
  assert.equal(g.empty, false);
  assert.deepEqual(g.inbound, []);
});
