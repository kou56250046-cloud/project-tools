// P2 T1: 版 2 への移行と共通の決まり
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { migrateLedger, validateLedger, emptyLedger, linkedIds, settingOf, validateSettings, SCHEMA_VERSION } from '../src/core/schema.js';
import { applyLocalOps } from '../src/core/patch.js';
import { createLedger } from '../src/core/starter.js';
import { extractJson } from '../src/core/extract.js';
import { runHealth } from '../src/core/health.js';

const load = (n) => JSON.parse(readFileSync(new URL(`../samples/${n}`, import.meta.url), 'utf8'));
const NOW = '2026-11-25T12:00:00.000Z';

test('版 1 の台帳は版 2 に移行され、項目は変わらない', () => {
  const v1 = load('sample-ledger-v1.json');
  const before = JSON.stringify(v1);
  const m = migrateLedger(v1);
  assert.equal(m.migrated, true);
  assert.equal(m.ledger.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(validateLedger(m.ledger), []);
  assert.deepEqual(m.ledger.items, v1.items);
  assert.deepEqual(m.ledger.relations, v1.relations);
  assert.deepEqual(m.ledger.baselines, []);
  assert.equal(settingOf(m.ledger, 'ballWaitDays'), 7);
  assert.equal(JSON.stringify(v1), before, '元のオブジェクトは変えない');
});

test('版 2 はそのまま、未知の版は移行しない', () => {
  const v2 = load('sample-ledger.json');
  assert.equal(migrateLedger(v2).migrated, false);
  assert.match(migrateLedger({ ...v2, schemaVersion: 3 }).error, /schemaVersion 3/);
  assert.ok(migrateLedger({ type: 'x' }).error);
});

test('changelog や settings に不明なキーがあっても読める', () => {
  const l = load('sample-ledger.json');
  l.settings.futureKey = 1;
  l.changelog.push({ rev: 99, at: NOW, source: 'future', changes: [], extra: true });
  assert.deepEqual(validateLedger(l), []);
});

test('新規の台帳は版 2 の形', () => {
  const l = emptyLedger('x', NOW);
  assert.deepEqual(validateLedger(l), []);
  assert.deepEqual(l.changelog, []);
});

test('案件の型で作った台帳は revision 0 で記録が空', () => {
  const l = createLedger('x', 'business-system-new', NOW);
  assert.equal(l.revision, 0);
  assert.deepEqual(l.changelog, []);
  assert.deepEqual(validateLedger(l), []);
});

test('配列だけの返答に今の版が入る', () => {
  const r = extractJson('[{"op":"add","item":{"kind":"issue","title":"x"}}]');
  assert.equal(r.value.schemaVersion, SCHEMA_VERSION);
});

test('適用すると変更の記録が残る（追加・更新・状態の変化）', () => {
  const l = load('sample-ledger.json');
  const n = l.changelog.length;
  const r = applyLocalOps(l, [
    { op: 'add', item: { kind: 'issue', title: '記録のテスト' } },
    { op: 'update', id: 'IS-001', set: { status: 'closed' } },
  ], NOW);
  const e = r.ledger.changelog.at(-1);
  assert.equal(r.ledger.changelog.length, n + 1);
  assert.equal(e.rev, r.ledger.revision);
  assert.equal(e.source, 'local');
  assert.deepEqual(e.changes.map((c) => c.op), ['add', 'update']);
  assert.equal(e.changes[1].statusFrom, 'open');
  assert.equal(e.changes[1].statusTo, 'closed');
});

test('記録は 2,000 件で古いものから捨てる', () => {
  let l = emptyLedger('x', NOW);
  l.changelog = Array.from({ length: 2000 }, (_, i) => ({ rev: i, at: NOW, source: 'local', changes: [] }));
  const r = applyLocalOps(l, [{ op: 'add', item: { kind: 'issue', title: 'x' } }], NOW);
  assert.equal(r.ledger.changelog.length, 2000);
  assert.equal(r.ledger.changelog[0].rev, 1);
});

test('links は向きを持たない: 要望側の links だけでも要件とつながる', () => {
  const l = load('sample-ledger.json');
  // RQ-004 は要件から参照されていないが、RQ-004 の links に RE-003 を足すと「要件のない要望」から外れる
  const has = (led) => runHealth(led, '2026-11-25').some((f) => f.code === 'unlinked-request' && f.itemId === 'RQ-004');
  assert.equal(has(l), true);
  const r = applyLocalOps(l, [{ op: 'update', id: 'RQ-004', addLinks: ['RE-003'] }], NOW);
  assert.equal(has(r.ledger), false);
  assert.ok(linkedIds(r.ledger, 'RE-003').has('RQ-004'));
});

test('設定の検査', () => {
  assert.deepEqual(validateSettings({ ballWaitDays: 10 }), []);
  assert.equal(validateSettings({ ballWaitDays: 0 }).length, 1);
  assert.equal(validateSettings({ nope: 1 }).length, 1);
});
