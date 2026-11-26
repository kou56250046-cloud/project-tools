// P5 T1: テストとトレーサビリティ
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { traceRows, passRates } from '../src/core/trace.js';
import { runHealth } from '../src/core/health.js';
import { applyLocalOps } from '../src/core/patch.js';
import { KINDS } from '../src/core/schema.js';

const load = () => JSON.parse(readFileSync(new URL('../samples/sample-ledger.json', import.meta.url), 'utf8'));
const NOW = '2026-11-26T09:00:00.000Z';
const row = (rows, id) => rows.find((r) => r.req.id === id);

test('判定の4種類: 不合格あり・すべて合格・未実施あり・テストなし', () => {
  const rows = traceRows(load());
  assert.equal(row(rows, 'RE-001').verdict, 'failed');
  assert.equal(row(rows, 'RE-005').verdict, 'passed');
  assert.equal(row(rows, 'RE-002').verdict, 'pending');
  assert.equal(row(rows, 'RE-003').verdict, 'none');
});

test('設計の項目につながるテストも要件のテストとして数える（重複させない）', () => {
  const r = row(traceRows(load()), 'RE-001');
  // 画面 Web 発注入力 経由の 2 件と、要件に直接つながる 1 件
  assert.equal(r.tests.length, 3);
  assert.deepEqual(r.counts, { passed: 1, failed: 1, draft: 1 });
  assert.ok(r.design.some((d) => d.title === 'Web 発注入力'));
  assert.ok(r.requests.some((q) => q.id === 'RQ-001'));
});

test('工程ごとの合格率', () => {
  const rates = passRates(load(), KINDS.test.fields.level.values);
  const sys = rates.find((x) => x.level === 'system');
  assert.deepEqual([sys.total, sys.passed, sys.failed, sys.rate], [4, 2, 1, 50]);
  assert.equal(rates.find((x) => x.level === 'unit').rate, null);
});

test('健康診断: 不合格のテスト（高）と、テストの無い合意済みの要件（中）', () => {
  const l = load();
  const f = (led, c) => runHealth(led, '2026-11-26').filter((x) => x.code === c);
  assert.equal(f(l, 'test-failed').length, 1);
  assert.equal(f(l, 'test-failed')[0].severity, 'high');
  assert.equal(f(l, 'req-no-test').length, 0);
  const r = applyLocalOps(l, [{ op: 'update', id: 'RE-003', set: { status: 'agreed' } }], NOW);
  assert.deepEqual(f(r.ledger, 'req-no-test').map((x) => x.itemId), ['RE-003']);
});
