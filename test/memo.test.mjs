// P6c T2: 種別 memo（版は 2 のまま）。メモは社内のものとして、台帳の項目としては出さない
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SCHEMA_VERSION, LEDGER_KINDS, KIND_IDS, MEMO_BODY_MAX, validateLedger, validateFields, visibleLedger } from '../src/core/schema.js';
import { applyLocalOps, validatePatch, MEMO_PATCH_ERROR } from '../src/core/patch.js';
import { buildPrompt, itemsText, memoMaterial, MEMO_PROMPT_MAX } from '../src/core/prompts.js';
import { runHealth } from '../src/core/health.js';
import { impactOf, changeRequestText } from '../src/core/impact.js';
import { ledgerToKarte } from '../src/core/karte.js';
import { dashboardData } from '../src/core/dashboard.js';
import { stepStatus } from '../src/core/guide-flow.js';
import { createLedger } from '../src/core/starter.js';
import { emptyWorkspace } from '../src/core/workspace.js';
import { store } from '../src/ui/store.js';

const NOW = '2026-11-26T00:00:00.000Z';
const load = () => JSON.parse(readFileSync(new URL('../samples/sample-ledger.json', import.meta.url), 'utf8'));
const memoOp = (body, extra = {}) => ({ op: 'add', item: { kind: 'memo', title: 'チャット 11 月', memoType: 'chat', channel: '#案件', from: '2026-11-01', to: '2026-11-20', body, ...extra } });

// サンプル台帳にメモを 1 件足し、課題 IS-001 の links からメモを指す
function withMemo() {
  const r = applyLocalOps(load(), [memoOp('2026-11-20 10:23 山田 太郎｜社内だけの話')], NOW);
  assert.equal(r.ok, true, r.errors && r.errors.join());
  const l = r.ledger;
  const memo = l.items.find((it) => it.kind === 'memo');
  const issue = l.items.find((it) => it.id === 'IS-001');
  issue.links = [...(issue.links || []), memo.id];
  return { l, memo };
}

test('版は 2 のまま。memo は KINDS にあり、LEDGER_KINDS には無い', () => {
  assert.equal(SCHEMA_VERSION, 2);
  assert.ok(KIND_IDS.includes('memo'));
  assert.ok(!LEDGER_KINDS.includes('memo'));
  // 知らない種別は誤りになる（前のツールがメモを持つ台帳を読めず、退避に回すのはこの検査による）
  assert.ok(validateFields('nosuchkind', {}, {}).errors.length > 0);
});

test('画面の操作でメモを足せる。ID は MM、本文は 50,000 字まで', () => {
  const { l, memo } = withMemo();
  assert.match(memo.id, /^MM-\d{3}$/);
  assert.deepEqual(validateLedger(l), []);
  const big = applyLocalOps(load(), [memoOp('あ'.repeat(MEMO_BODY_MAX + 1))], NOW);
  assert.equal(big.ok, false);
  assert.match(big.errors.join(), /50,000 字まで/);
  assert.equal(applyLocalOps(load(), [memoOp('あ'.repeat(MEMO_BODY_MAX))], NOW).ok, true);
});

test('Gemini の差分ではメモを足したり変えたりできない', () => {
  const { l, memo } = withMemo();
  const v1 = validatePatch({ type: 'ledger-patch', ops: [memoOp('x')] }, l);
  assert.deepEqual(v1.ops[0].errors, [MEMO_PATCH_ERROR]);
  const v2 = validatePatch({ type: 'ledger-patch', ops: [{ op: 'update', id: memo.id, set: { title: '変える' } }] }, l);
  assert.deepEqual(v2.ops[0].errors, [MEMO_PATCH_ERROR]);
});

test('メモを消すと、メモを指す関連も外れる。取り消しで戻る', () => {
  const { l, memo } = withMemo();
  store.workspace = emptyWorkspace(); store.undoById.clear();
  store.addProject(l, { exported: true });
  const before = store.ledger;
  const r = store.applyLocal([{ op: 'remove', id: memo.id }]);
  assert.equal(r.ok, true);
  assert.equal(store.ledger.items.some((it) => it.id === memo.id), false);
  assert.equal((store.ledger.items.find((it) => it.id === 'IS-001').links || []).includes(memo.id), false);
  assert.equal(store.ledger.revision, before.revision + 1);
  assert.equal(store.ledger.changelog.at(-1).changes[0].op, 'remove');
  store.undo();
  assert.equal(store.ledger, before);
  // メモ以外は消せない。ほかの操作と混ぜられない
  assert.equal(applyLocalOps(l, [{ op: 'remove', id: 'IS-001' }], NOW).ok, false);
  assert.equal(applyLocalOps(l, [{ op: 'remove', id: memo.id }, memoOp('x')], NOW).ok, false);
});

test('指示文: 種別の説明・台帳の一覧・NotebookLM の指示文にメモが出ない', () => {
  const { l, memo } = withMemo();
  for (const purpose of ['initial', 'minutes', 'review-pm', 'free', 'memo']) {
    const s = buildPrompt(purpose, l, { today: '2026-11-26' });
    assert.ok(!s.includes('- memo'), purpose);
    assert.ok(!s.includes(`${memo.id} |`), `${purpose} の一覧にメモ`);
  }
  assert.ok(!buildPrompt('notebooklm', l).includes('チャット 11 月'));
  assert.ok(!itemsText(l, true).includes('社内だけの話'));
});

test('メモからの取込: 選んだメモの本文が入り、台帳の一覧はメモを除く全種別。60,000 字を超えると over', () => {
  const { l, memo } = withMemo();
  const s = buildPrompt('memo', l, { today: '2026-11-26', memoIds: [memo.id] });
  assert.ok(s.includes('社内だけの話'));
  assert.ok(s.includes('### メモ「チャット 11 月」'));
  assert.ok(s.includes('IS-001 |') && s.includes('QA-001 |'));
  assert.ok(buildPrompt('memo', l, { today: '2026-11-26' }).includes('メモが選ばれていません'));
  const r = applyLocalOps(l, [memoOp('い'.repeat(40000)), memoOp('う'.repeat(30000))], NOW);
  const ids = r.ledger.items.filter((it) => it.kind === 'memo' && it.body.length > 1000).map((it) => it.id);
  const mm = memoMaterial(r.ledger, ids);
  assert.equal(mm.total, 70000);
  assert.equal(mm.over, true);
  assert.equal(MEMO_PROMPT_MAX, 60000);
});

test('健康診断・影響範囲・カルテ・ダッシュボード・使い方の進み具合・説明用の表示にメモが出ない', () => {
  const { l, memo } = withMemo();
  const h = runHealth(l, '2026-11-26');
  assert.ok(!h.some((f) => f.itemId === memo.id), '健康診断にメモ');
  // 存在しない ID への参照の点検はメモの links も見る
  const broken = structuredClone(l);
  broken.items.find((it) => it.id === memo.id).links = ['IS-999'];
  assert.ok(runHealth(broken, '2026-11-26').some((f) => f.code === 'dangling' && f.itemId === memo.id));
  // 影響範囲（変更要求書）
  const cr = { id: 'CR-099', kind: 'change', title: '変更', status: 'proposed', links: ['IS-001', memo.id] };
  const imp = impactOf(l, ['IS-001']);
  assert.ok(!imp.items.some((x) => x.item.kind === 'memo'));
  assert.ok(!changeRequestText(l, cr, imp).includes('チャット 11 月'));
  // カルテ・ダッシュボード
  assert.ok(!JSON.stringify(ledgerToKarte(l, { includeInternal: true, today: '2026-11-26' }).karte).includes('社内だけの話'));
  assert.deepEqual(dashboardData(l, { today: '2026-11-26' }).kpi, dashboardData(load(), { today: '2026-11-26' }).kpi);
  // 使い方の進み具合: メモだけの台帳は初期作成が済にならない
  const only = applyLocalOps(createLedger('メモだけ', null, NOW), [memoOp('x')], NOW).ledger;
  assert.equal(stepStatus(only).status.initial, 'active');
  // 説明用の表示
  assert.ok(!visibleLedger(l, true).items.some((it) => it.kind === 'memo'));
});
