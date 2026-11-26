import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateFields, validateLedger, emptyLedger, makeResolver, kindOfId, isDate, withDefaults, normalizeCounters, buildBackrefs,
} from '../src/core/schema.js';

const NOW = '2026-11-25T10:00:00.000Z';

function ledgerWith(items, relations = []) {
  const l = emptyLedger('テスト案件', NOW);
  return normalizeCounters({ ...l, items, relations });
}
const item = (o) => ({ status: 'open', confidence: 'fact', sources: [], links: [], createdAt: NOW, updatedAt: NOW, ...o });

const SH1 = item({ id: 'SH-001', kind: 'stakeholder', title: '山田 部長', side: 'customer', status: 'active' });

test('正しい項目は通る', () => {
  const l = ledgerWith([SH1]);
  const r = validateFields('issue', withDefaults('issue', { title: '帳票の件', owner: 'SH-001', due: '2026-12-01' }), { resolve: makeResolver(l) });
  assert.deepEqual(r.errors, []);
});

test('使えない kind は日本語のエラー', () => {
  const r = validateFields('requirment', { title: 'x' }, { resolve: () => null });
  assert.match(r.errors[0], /種別（kind）「requirment」は使えません/);
});

test('使えない status は使える値つきのエラー', () => {
  const r = validateFields('issue', { title: 'x', status: 'done' }, { resolve: () => null });
  assert.match(r.errors.join('\n'), /「done」は使えません。使える値: open, in_progress, closed/);
});

test('日付の形式と実在しない日付はエラー', () => {
  assert.equal(isDate('2026-02-30'), false);
  assert.equal(isDate('2026/12/01'), false);
  assert.equal(isDate('2026-12-01'), true);
  const r = validateFields('issue', { title: 'x', due: '12月1日' }, { resolve: () => null });
  assert.match(r.errors.join('\n'), /YYYY-MM-DD/);
});

test('ID の形式・存在・参照先の種別を検査する', () => {
  const l = ledgerWith([SH1, item({ id: 'RE-001', kind: 'requirement', title: 'x', status: 'draft', category: 'functional' })]);
  const resolve = makeResolver(l);
  assert.match(validateFields('issue', { title: 'x', owner: 'abc' }, { resolve }).errors[0], /ID の形式ではありません/);
  assert.match(validateFields('issue', { title: 'x', owner: 'SH-009' }, { resolve }).errors[0], /台帳にありません/);
  assert.match(validateFields('issue', { title: 'x', owner: 'RE-001' }, { resolve }).errors[0], /要件です/);
  assert.equal(kindOfId('QA-012'), 'question');
  assert.equal(kindOfId('QA-12'), null);
});

test('必須の欠けと不明な項目', () => {
  const r = validateFields('stakeholder', { title: '佐藤', foo: 1 }, { resolve: () => null });
  assert.match(r.errors.join('\n'), /立場（side）がありません/);
  assert.deepEqual(r.unknown, ['foo']);
});

test('出典の日付と発言者を検査する', () => {
  const l = ledgerWith([SH1]);
  const ok = validateFields('request', { title: 'x', sources: [{ type: 'meeting', ref: '第1回定例', date: '2026-11-20', speaker: 'SH-001' }] }, { resolve: makeResolver(l) });
  assert.deepEqual(ok.errors, []);
  const ng = validateFields('request', { title: 'x', sources: [{ type: 'talk', ref: '', speaker: 'SH-002' }] }, { resolve: makeResolver(l) });
  assert.equal(ng.errors.length, 3);
});

test('台帳の検査: 正しい台帳は通り、参照切れは allowDanglingRefs で許す', () => {
  const issue = item({ id: 'IS-001', kind: 'issue', title: 'x', owner: 'SH-099' });
  const l = ledgerWith([SH1, issue], [{ id: 'RL-001', from: 'SH-001', to: 'SH-001', label: '兼務' }]);
  assert.match(validateLedger(l).join('\n'), /SH-099/);
  assert.deepEqual(validateLedger(l, { allowDanglingRefs: true }), []);
  assert.match(validateLedger({ type: 'x' }).join('\n'), /ledger/);
});

test('台帳の検査: ID の重複と接頭辞の食い違い', () => {
  const l = ledgerWith([SH1, SH1, item({ id: 'IS-001', kind: 'question', title: 'x' })]);
  const errs = validateLedger(l).join('\n');
  assert.match(errs, /重複/);
  assert.match(errs, /接頭辞/);
});

test('逆参照は links 以外の参照フィールドと関係も含む', () => {
  const l = ledgerWith([
    SH1,
    item({ id: 'IS-001', kind: 'issue', title: 'x', owner: 'SH-001' }),
    item({ id: 'RQ-001', kind: 'request', title: 'y', sources: [{ type: 'meeting', ref: 'm', speaker: 'SH-001' }] }),
  ]);
  const b = buildBackrefs(l).get('SH-001').map((x) => x.from + ':' + x.field).sort();
  assert.deepEqual(b, ['IS-001:owner', 'RQ-001:speaker']);
});
