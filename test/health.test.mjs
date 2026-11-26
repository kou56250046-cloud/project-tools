import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyLedger } from '../src/core/schema.js';
import { runHealth } from '../src/core/health.js';
import { readFileSync } from 'node:fs';

const TODAY = '2026-11-25';
const T = '2026-11-25T09:00:00.000Z';
const OLD = '2026-11-10T09:00:00.000Z';
const SRC = [{ type: 'meeting', ref: '定例' }];
const SH = { id: 'SH-001', kind: 'stakeholder', title: '青木', side: 'customer', status: 'active', confidence: 'fact', sources: SRC, links: [], createdAt: T, updatedAt: T };

const ledger = (...items) => ({ ...emptyLedger('t', T), items: [SH, ...items] });
const base = (o) => ({ status: 'open', confidence: 'fact', sources: SRC, links: [], createdAt: T, updatedAt: T, ...o });
const codes = (l) => runHealth(l, TODAY).map((f) => f.code);
const count = (l, code) => codes(l).filter((c) => c === code).length;

// 各点検: [コード, 該当する項目, 該当しない項目]
const CASES = [
  ['dangling',
    base({ id: 'IS-001', kind: 'issue', title: 'x', owner: 'SH-099', due: '2026-12-01' }),
    base({ id: 'IS-001', kind: 'issue', title: 'x', owner: 'SH-001', due: '2026-12-01' })],
  ['overdue',
    base({ id: 'IS-001', kind: 'issue', title: 'x', owner: 'SH-001', due: '2026-11-20' }),
    base({ id: 'IS-001', kind: 'issue', title: 'x', owner: 'SH-001', due: '2026-11-20', status: 'closed' })],
  ['no-owner',
    base({ id: 'QA-001', kind: 'question', title: 'x', due: '2026-12-01' }),
    base({ id: 'QA-001', kind: 'question', title: 'x', askTo: 'SH-001', due: '2026-12-01' })],
  ['no-source',
    base({ id: 'CN-001', kind: 'constraint', title: 'x', status: 'active', category: 'budget', sources: [] }),
    base({ id: 'CN-001', kind: 'constraint', title: 'x', status: 'active', category: 'budget', sources: [{ type: 'template', ref: '業務システム新規' }] })],
  ['must-guess',
    base({ id: 'RE-001', kind: 'requirement', title: 'x', status: 'draft', category: 'functional', priority: 'Must', confidence: 'guess' }),
    base({ id: 'RE-001', kind: 'requirement', title: 'x', status: 'draft', category: 'functional', priority: 'Should', confidence: 'guess' })],
  ['stale-guess',
    base({ id: 'CN-001', kind: 'constraint', title: 'x', status: 'active', category: 'budget', confidence: 'guess', updatedAt: OLD }),
    base({ id: 'QA-001', kind: 'question', title: 'x', askTo: 'SH-001', due: '2026-12-01', confidence: 'guess', updatedAt: OLD })],
  ['unlinked-request',
    base({ id: 'RQ-001', kind: 'request', title: 'x' }),
    base({ id: 'RQ-001', kind: 'request', title: 'x', status: 'rejected' })],
];

for (const [code, hit, miss] of CASES) {
  test(`${code}: 該当で1件、非該当で0件`, () => {
    assert.equal(count(ledger(hit), code), 1);
    assert.equal(count(ledger(miss), code), 0);
  });
}

test('要件から参照されている要望は検出しない', () => {
  const rq = base({ id: 'RQ-001', kind: 'request', title: 'x' });
  const re = base({ id: 'RE-001', kind: 'requirement', title: 'y', status: 'draft', category: 'functional', links: ['RQ-001'] });
  assert.equal(count(ledger(rq, re), 'unlinked-request'), 0);
});

test('関係の参照切れも検出する', () => {
  const l = { ...ledger(), relations: [{ id: 'RL-001', from: 'SH-001', to: 'SY-009', label: '利用' }] };
  assert.equal(count(l, 'dangling'), 1);
});

test('並び順は 重要度 → 期限 → ID', () => {
  const l = JSON.parse(readFileSync(new URL('../samples/sample-ledger.json', import.meta.url), 'utf8'));
  const f = runHealth(l, TODAY);
  const rank = { high: 0, mid: 1, low: 2 };
  for (let i = 1; i < f.length; i++) {
    const a = f[i - 1]; const b = f[i];
    assert.ok(rank[a.severity] <= rank[b.severity], '重要度順');
    if (a.severity === b.severity && a.due && b.due) assert.ok(a.due <= b.due, '期限順');
    if (a.severity === b.severity && !a.due) assert.ok(!b.due, '期限なしは後ろ');
  }
  assert.equal(f[0].code, 'overdue');
});
