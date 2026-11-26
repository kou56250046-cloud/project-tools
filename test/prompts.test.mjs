import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LEDGER_KINDS, COMMON_FIELDS, validateLedger } from '../src/core/schema.js';
import { PURPOSES, MATERIAL_MARK, buildPrompt, buildFixPrompt, schemaText } from '../src/core/prompts.js';
import { createLedger, STARTERS } from '../src/core/starter.js';

const ledger = JSON.parse(readFileSync(new URL('../samples/sample-ledger.json', import.meta.url), 'utf8'));
const opts = { today: '2026-11-25', freeText: '課題の重要度を見直して' };

test('目的は28種（P6c メモ・P7a KPI とリスク・P7b 体制・P7c 業務フローと判断・データ 4 つ）', () => {
  assert.equal(PURPOSES.length, 28);
});

for (const p of PURPOSES.filter((x) => x.id !== 'notebooklm' && !x.kinds && !x.plain)) {
  test(`指示文（${p.label}）に全 kind（メモを除く）・全 ID・資料の位置・revision が入る`, () => {
    const s = buildPrompt(p.id, ledger, opts);
    for (const k of LEDGER_KINDS) assert.ok(s.includes(k), k);
    assert.ok(!s.includes('- memo'), 'メモの種別が指示文に出ている');
    for (const it of ledger.items) assert.ok(s.includes(it.id), it.id);
    assert.ok(s.includes(MATERIAL_MARK));
    assert.ok(s.includes('"basedOnRevision": 12'));
    assert.ok(s.includes('ledger-patch'));
  });
}

test('自由指示には書いた指示が入る', () => {
  assert.ok(buildPrompt('free', ledger, opts).includes('課題の重要度を見直して'));
});

test('NotebookLM 用は JSON を求めず、見出し構成を指示する', () => {
  const s = buildPrompt('notebooklm', ledger, opts);
  assert.doesNotMatch(s, /JSON/i);
  for (const h of ['## 関係者', '## 要望', '## 制約', '## 決定', '## 課題', '## 未確定の点']) assert.ok(s.includes(h), h);
  assert.match(s, /発言者/);
  assert.match(s, /日付/);
});

test('種別の説明には共通項目がすべて入る', () => {
  const s = schemaText();
  for (const f of Object.keys(COMMON_FIELDS)) assert.ok(s.includes(`- ${f}`), f);
});

test('修正依頼文には誤りの一覧が入る', () => {
  const s = buildFixPrompt(['操作3（追加・課題）: status「done」は使えません'], ledger);
  assert.match(s, /操作3/);
  assert.match(s, /basedOnRevision は 12/);
});

test('案件の型で質問15件以上の台帳ができ、検証を通る', () => {
  const l = createLedger('テスト', 'business-system-new', '2026-11-25T00:00:00.000Z');
  assert.deepEqual(validateLedger(l), []);
  assert.ok(l.items.filter((it) => it.kind === 'question').length >= 20);
  assert.equal(l.project.starter, 'business-system-new');
  assert.equal(l.revision, 0);
  assert.equal(l.items[0].id, 'QA-001');
  assert.ok(STARTERS['business-system-new'].label);
});

test('型なしは空の台帳', () => {
  const l = createLedger('空', null, '2026-11-25T00:00:00.000Z');
  assert.equal(l.items.length, 0);
  assert.deepEqual(validateLedger(l), []);
});

// P2 T6
import { NFR } from '../src/core/nfr.js';

test('対象種別を絞った目的では、対象外の種別の ID が入らない', () => {
  for (const p of PURPOSES.filter((x) => x.kinds)) {
    const s = buildPrompt(p.id, ledger, opts);
    for (const it of ledger.items) {
      const listed = s.includes(`${it.id} | `);
      assert.equal(listed, p.kinds.includes(it.kind), `${p.id} ${it.id}`);
    }
    assert.ok(s.includes(MATERIAL_MARK));
    assert.doesNotMatch(s, /^null$/m);
  }
});

test('会議を指定した議事録には、出席者とその会議の質問 ID が入る', () => {
  const s = buildPrompt('minutes', ledger, { ...opts, meetingId: 'MT-003' });
  assert.match(s, /この議事録の会議: MT-003/);
  assert.match(s, /上野 主任（SH-003）/);
  for (const id of ['QA-002', 'QA-003', 'QA-005']) assert.match(s, new RegExp(`  - ${id} `));
  assert.match(s, /MT-003 を update で status: "held"/);
});

test('非機能の洗い出しに 6 大項目と確認点が入る', () => {
  const s = buildPrompt('nfr', ledger, opts);
  for (const c of NFR) {
    assert.ok(s.includes(`${c.id}（${c.label}）`), c.id);
    assert.ok(s.includes(c.points[0]), c.id);
  }
  assert.match(s, /security（セキュリティ）今の状態: 合意済み/);
});

test('ヒヤリング質問の生成に未回答の質問と空欄が入る（AC-06）', () => {
  const s = buildPrompt('hearing-questions', ledger, opts);
  assert.match(s, /## 未回答の質問/);
  assert.match(s, /- QA-002 /);
  assert.match(s, /## 台帳の空欄・未確定/);
  assert.match(s, /非機能「移行性」について/);
});

// P3 T5
test('変更の影響レビュー: 変更要求と影響範囲の項目だけが載る', () => {
  const cr = ledger.items.find((x) => x.kind === 'change' && x.title.startsWith('会計への取込'));
  const s = buildPrompt('change-review', ledger, { ...opts, changeId: cr.id });
  assert.match(s, new RegExp(`変更要求: ${cr.id}`));
  assert.match(s, /影響する作業の見積の合計/);
  assert.ok(s.includes('RE-003 | '));
  assert.ok(!s.includes('SH-008 | '), '影響範囲の外の関係者は載らない');
});

test('WBS の作成と進捗の更新は対象種別だけ', () => {
  const s = buildPrompt('progress', ledger, opts);
  assert.ok(s.includes('TK-002 | '));
  assert.ok(!s.includes('RE-001 | '));
});

test('週報の清書は JSON を求めず、下書きが入る', () => {
  const s = buildPrompt('report-polish', ledger, { ...opts, reportText: '■ 今週の進捗\n・テスト' });
  assert.doesNotMatch(s, /JSON|ledger-patch/);
  assert.match(s, /■ 今週の進捗/);
});

// P4 T5
test('データ設計と画面・連携の洗い出しの指示文に、配列の書き方の例が入る', () => {
  for (const id of ['data-design', 'functions']) {
    const s = buildPrompt(id, ledger, opts);
    assert.match(s, /columns（列）: \[\{ "name"/);
    assert.match(s, /crud: \[\{ "entity"/);
    assert.match(s, /丸ごと置き換わる/);
  }
  assert.match(buildPrompt('data-design', ledger, opts), /columns を全部返して/);
});

// P5 T4: 案件の型
import { nfrStatus } from '../src/core/nfr.js';
for (const id of ['business-system-new', 'core-replacement', 'package']) {
  test(`案件の型「${id}」: 質問 20 件以上、非機能の 6 大項目すべてが質問中、検証を通る`, () => {
    const l = createLedger('型の確認', id, '2026-11-26T00:00:00.000Z');
    assert.deepEqual(validateLedger(l), []);
    assert.ok(l.items.filter((it) => it.kind === 'question').length >= 20);
    assert.deepEqual(nfrStatus(l).map((c) => [c.id, c.state]).filter(([, st]) => st !== 'asking'), []);
    assert.equal(l.project.starter, id);
  });
}

// P5 T5
test('テスト観点の生成: 画面の項目名・必須・型と既存テストの題名が入る', () => {
  const sc = ledger.items.find((x) => x.kind === 'screen' && x.title === 'Web 発注入力');
  const s = buildPrompt('test-viewpoints', ledger, { ...opts, targetIds: [sc.id] });
  assert.match(s, new RegExp(`### ${sc.id} 画面「Web 発注入力」`));
  assert.match(s, /  - 数量（型 int・必須）/);
  assert.match(s, /Web 発注: 数量 0 は入力エラーになる/);
  assert.match(s, /## 既にあるテスト/);
  assert.ok(s.includes(`${sc.id} | `));
});
