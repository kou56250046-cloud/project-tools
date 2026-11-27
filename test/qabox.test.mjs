// P6e: qa-box（質問箱）との連携
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { qaAskParts, parseQaBox, qaBoxToPatch, qaReplaceSection, qaKey, qaTag, QA_INPUT_MAX } from '../src/core/qabox.js';
import { QA_BOX_PROMPT } from '../src/core/qabox-prompt.js';
import { validatePatch, applyPatch } from '../src/core/patch.js';
import { validateLedger } from '../src/core/schema.js';

const fx = (f) => readFileSync(new URL(`./fixtures/qabox/${f}`, import.meta.url), 'utf8');
const loadLedger = () => JSON.parse(readFileSync(new URL('../samples/sample-ledger.json', import.meta.url), 'utf8'));
const NOW = '2026-11-27T00:00:00.000Z';
const applyAll = (l, patch) => {
  const v = validatePatch(patch, l);
  assert.deepEqual(v.ops.flatMap((o) => o.errors), []);
  return applyPatch(l, v, new Set(v.ops.map((_, i) => i)), NOW).ledger;
};

test('聞く文: 【QA-xxx】の印・## 新規・1 通 3000 字以内に分ける・1 件で超えるものは単独で警告', () => {
  const l = loadLedger();
  const open = l.items.filter((it) => it.kind === 'question' && it.status === 'open');
  const r = qaAskParts(open, l.project.name);
  assert.equal(r.parts.length, 1);
  for (const q of open) assert.ok(r.parts[0].includes(`## 新規\n### 質問\n【${q.id}】${q.title}`), q.id);
  assert.deepEqual(r.warnings, []);
  const many = Array.from({ length: 80 }, (_, i) => ({ id: `QA-${String(i + 1).padStart(3, '0')}`, title: `質問${i}`.padEnd(60, 'あ') }));
  const m = qaAskParts(many, 'x');
  assert.ok(m.parts.length >= 2);
  assert.ok(m.parts.every((p) => p.length <= QA_INPUT_MAX));
  assert.equal(m.parts.join('').match(/【QA-\d+】/g).length, 80, 'すべての質問がどれかの 1 通に入る');
  const long = qaAskParts([{ id: 'QA-900', title: 'あ'.repeat(QA_INPUT_MAX) }], 'x');
  assert.equal(long.parts.length, 1);
  assert.match(long.warnings[0], /QA-900 は 1 件で 3000 字を超えています/);
  assert.ok(QA_BOX_PROMPT.includes('## 新規') && QA_BOX_PROMPT.includes('要確認'));
});

test('qa-box の JSON（控え v2・AI 用 ai.v1）を読む。形が違えば理由を出す', () => {
  const v2 = parseQaBox(fx('qa-box-v2.json'));
  assert.equal(v2.ok, true);
  assert.equal(v2.items.length, 4);
  assert.equal(v2.bad, 1, '質問の無い行は読めない件数に');
  const ai = parseQaBox(fx('qa-box-ai.json'));
  assert.equal(ai.ok, true);
  assert.deepEqual(ai.items.map((x) => x.qid), ['Q-001', 'Q-002', 'Q-003', 'Q-004']);
  assert.match(parseQaBox('{').error, /JSON として読めません/);
  assert.match(parseQaBox('{"app":"other","items":[]}').error, /書き出しファイルではありません/);
  assert.equal(parseQaBox('{"app":"qa-box","version":2,"items":[{"id":"Q-1","question":"q","status":"謎"}]}').items[0].status, '要確認');
});

test('突き合わせと差分: 印 → 回答済み、正規化した題名 → 回答案の節、新しいものは add。検査を通り、2 回目は差分 0', () => {
  const l = loadLedger();
  const { items } = parseQaBox(fx('qa-box-v2.json'));
  const { patch, summary } = qaBoxToPatch(items, l);
  assert.deepEqual(summary, { confirmed: 2, draft: 2, added: 2, matched: 2, unchanged: 0, duplicate: 0 });
  const after = applyAll(l, patch);
  assert.deepEqual(validateLedger(after), []);
  const q = (id) => after.items.find((it) => it.id === id);
  // 印【QA-001】で一致し、確定なので回答済み
  assert.equal(q('QA-001').status, 'answered');
  assert.equal(q('QA-001').answer, '約 120 社（得意先一覧の「Web 利用」欄）');
  assert.ok(q('QA-001').sources.some((s) => s.ref === 'NotebookLM（qa-box Q-001）' && /根拠: 得意先一覧.xlsx/.test(s.note)));
  // 句読点の違う題名で一致し、提案なので質問のまま・本文に案と表・確度は推測
  const q2 = q('QA-002');
  assert.equal(q2.status, 'open');
  assert.equal(q2.confidence, 'guess');
  assert.match(q2.body, /--- NotebookLM の回答案（qa-box Q-002・提案・2026-11-25）---/);
  assert.match(q2.body, /\| 頻度 \| 日次 \| 提案 \|/, '回答の表は本文にそのまま残る');
  assert.match(q2.body, /要確認の理由: ソースに決まりが無いため/);
  // 新しい質問
  const added = after.items.filter((it) => it.kind === 'question' && !l.items.some((o) => o.id === it.id));
  assert.deepEqual(added.map((x) => [x.title, x.status]), [['返品の受付は誰が行うか', 'open'], ['受注の締め時刻は何時か', 'answered']]);
  // もう一度読んでも変化なし
  const again = qaBoxToPatch(items, after);
  assert.equal(again.patch.ops.length, 0);
  assert.equal(again.summary.unchanged, 4);
});

test('回答案の節だけを置き換え、それ以外の本文は残す。同じ JSON の中の重複は 1 つ目だけ', () => {
  const body = '顧客に確認する前提メモ\n\n--- NotebookLM の回答案（qa-box Q-9・提案）---\n古い案\n--- ここまで ---\n\n後ろのメモ';
  const r = qaReplaceSection(body, '--- NotebookLM の回答案（qa-box Q-9・未確定）---\n新しい案\n--- ここまで ---');
  assert.ok(r.startsWith('顧客に確認する前提メモ') && r.endsWith('後ろのメモ'));
  assert.ok(r.includes('新しい案') && !r.includes('古い案'));
  assert.equal(qaReplaceSection('', 'X'), 'X');
  const l = loadLedger();
  const it = { qid: 'Q-1', status: '確定', question: '【QA-001】x', answer: 'a', source: '', reason: '', date: '' };
  const { summary } = qaBoxToPatch([it, { ...it, qid: 'Q-2' }], l);
  assert.equal(summary.duplicate, 1);
  assert.equal(qaKey('「会計」の取込は？ 日次'), qaKey('会計の取込は日次'));
  assert.deepEqual(qaTag('【QA-012】 返品は？'), { id: 'QA-012', text: '返品は？' });
});
