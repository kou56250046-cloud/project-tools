// P2 T5: ヒヤリングの候補・ベースラインの差・非機能の状態・健康診断の追加
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hearingCandidates, baselineDiff } from '../src/core/hearing.js';
import { latestBaseline, afterBaselineIds } from '../src/core/schema.js';
import { nfrStatus } from '../src/core/nfr.js';
import { runHealth } from '../src/core/health.js';
import { applyLocalOps } from '../src/core/patch.js';

const load = () => JSON.parse(readFileSync(new URL('../samples/sample-ledger.json', import.meta.url), 'utf8'));
const NOW = '2026-11-25T12:00:00.000Z';
const TODAY = '2026-11-25';
const codes = (l, code) => runHealth(l, TODAY).filter((f) => f.code === code);
// 会議が決まっていない未回答の質問を1件足した台帳
const withUnassigned = () => applyLocalOps(load(), [{ op: 'add', item: { kind: 'question', title: '帳票の部数は', askTo: 'SH-003' } }], NOW).ledger;

test('候補の3種類が出る', () => {
  const c = hearingCandidates(withUnassigned(), TODAY);
  const types = new Set(c.map((x) => x.type));
  assert.deepEqual([...types].sort(), ['gap', 'nfr', 'question']);
  assert.ok(c.some((x) => x.type === 'question' && x.ref === 'QA-004') === false, '回答済みは候補にしない');
});

test('割り当てた候補は候補から消える（質問・空欄・非機能）', () => {
  let l = withUnassigned();
  const c = hearingCandidates(l, TODAY);
  const pick = (type) => c.find((x) => x.type === type);
  for (const cand of [pick('question'), pick('gap'), pick('nfr')]) {
    const r = applyLocalOps(l, cand.ops('MT-003'), NOW, 'hearing');
    assert.equal(r.ok, true, cand.key + ' ' + (r.errors || []).join());
    l = r.ledger;
    assert.equal(hearingCandidates(l, TODAY).some((x) => x.key === cand.key), false, cand.key);
  }
});

test('非機能の状態の判定', () => {
  const l = load();
  const st = Object.fromEntries(nfrStatus(l).map((c) => [c.id, c.state]));
  assert.equal(st.security, 'agreed');        // RE-005（合意）
  assert.equal(st.performance, 'defined');    // RE-004（案）
  assert.equal(st.availability, 'asking');    // 未回答の質問のみ
  assert.equal(st.migration, 'none');
  // 回答済みの質問だけ → 未着手
  const r = applyLocalOps(l, [{ op: 'add', item: { kind: 'question', title: 'x', nfrCategory: 'migration', status: 'answered' } }], NOW);
  assert.equal(nfrStatus(r.ledger).find((c) => c.id === 'migration').state, 'none');
});

test('健康診断 nfr-missing は未着手の大項目だけ', () => {
  const l = load();
  const f = codes(l, 'nfr-missing').map((x) => x.message);
  assert.equal(f.length, 3);  // 移行性・運用・保守性・システム環境
  assert.ok(f.every((m) => !m.includes('セキュリティ')));
});

test('ベースライン後の追加と、範囲の健康診断', () => {
  const l = load();
  const after = afterBaselineIds(l);
  assert.ok(after.has('RQ-005'));
  assert.ok(after.has('RE-005'));
  assert.ok(!after.has('RQ-001'));
  assert.deepEqual(codes(l, 'scope-undecided').map((x) => x.itemId), ['RQ-005']);
  assert.deepEqual(codes(l, 'scope-no-reason').map((x) => x.itemId), ['RQ-003']);
  const r = applyLocalOps(l, [{ op: 'update', id: 'RQ-003', set: { scopeReason: '次期フェーズで検討' } }], NOW);
  assert.equal(codes(r.ledger, 'scope-no-reason').length, 0);
});

test('ベースラインとの差: 追加・範囲の変更・取り下げ', () => {
  const l = load();
  const r = applyLocalOps(l, [
    { op: 'update', id: 'RQ-004', set: { scope: 'in' } },
    { op: 'update', id: 'RE-002', set: { status: 'dropped' } },
  ], NOW);
  const d = baselineDiff(latestBaseline(r.ledger), r.ledger);
  assert.deepEqual(d.added.map((x) => x.id).sort(), ['RE-005', 'RQ-005']);
  assert.deepEqual(d.scopeChanged.map((x) => [x.item.id, x.from, x.to]), [['RQ-004', 'tbd', 'in']]);
  assert.deepEqual(d.dropped.map((x) => x.id), ['RE-002']);
});
