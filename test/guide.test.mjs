// 使い方: 画面の表と説明・流れ図の段・進み具合
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SCREENS, GROUPS, NO_LEDGER_OK } from '../src/core/screens.js';
import { SCREEN_HELP, FLOW_STEPS, FLOW_EDGES, MEETING_TIMELINE, WHERE, FLOW_TEXT, GUIDE_CHAPTERS, FAQ, TERMS } from '../src/core/guide-text.js';
import { stepStatus } from '../src/core/guide-flow.js';
import { PURPOSES } from '../src/core/prompts.js';
import { createLedger } from '../src/core/starter.js';

const ids = new Set(SCREENS.map((s) => s.id));
const purposeIds = new Set(PURPOSES.map((p) => p.id));
const NOW = '2026-11-26T00:00:00.000Z';
const load = (n) => JSON.parse(readFileSync(new URL(`../samples/${n}`, import.meta.url), 'utf8'));

test('すべての画面に説明がある（説明だけ残った画面も無い）', () => {
  for (const s of SCREENS) assert.ok(SCREEN_HELP[s.id], `説明が無い: ${s.id}`);
  for (const id of Object.keys(SCREEN_HELP)) assert.ok(ids.has(id), `画面に無い説明: ${id}`);
});

test('画面の分類はすべて定義されている', () => {
  const g = new Set(GROUPS.map((x) => x.id));
  for (const s of SCREENS) assert.ok(g.has(s.group), s.id);
  for (const id of NO_LEDGER_OK) assert.ok(ids.has(id), id);
});

test('流れの段の画面・指示文が実在し、全段に 4 つの枠と手順がある', () => {
  const stepIds = new Set(FLOW_STEPS.map((s) => s.id));
  assert.equal(stepIds.size, FLOW_STEPS.length);
  for (const s of FLOW_STEPS) {
    for (const id of s.screens) assert.ok(ids.has(id), `${s.id}: 画面 ${id}`);
    for (const id of s.purposes) assert.ok(purposeIds.has(id), `${s.id}: 指示文 ${id}`);
    assert.ok(WHERE[s.where], `${s.id}: 使う場所 ${s.where}`);
    assert.ok(['start', 'step', 'end'].includes(s.kind), s.id);
    assert.ok(s.in.length && s.out.length && s.to && s.how.length, `${s.id}: 枠か手順が足りない`);
  }
  for (const e of FLOW_EDGES) assert.ok(stepIds.has(e.from) && stepIds.has(e.to), `${e.from} → ${e.to}`);
  for (const col of MEETING_TIMELINE) for (const [w] of col.items) assert.ok(WHERE[w], col.when);
  for (const k of Object.keys(WHERE)) assert.ok(FLOW_TEXT.legend[k], k);
  assert.equal(GUIDE_CHAPTERS.length, 8);
});

test('今の文章で伝えていたことが、どれかの段の手順に入っている', () => {
  const how = FLOW_STEPS.flatMap((s) => s.how).join('\n');
  for (const w of ['合言葉', '型', 'ここから資料', '却下', '適用', '取り消し', '履歴', 'NotebookLM', '健康診断', '横断']) {
    assert.ok(how.includes(w), `手順に「${w}」が無い`);
  }
});

test('前の「案件の進め方」と「最初の 10 分」が案内していた画面・指示文は、すべてどれかの段にある', () => {
  // 消す前の PHASES・FIRST_STEPS の一覧
  const OLD_SCREENS = ['overview', 'graph', 'list', 'hearing', 'issues', 'nfr', 'scope', 'decisions', 'wbs', 'gantt', 'progress', 'changes', 'meeting-report',
    'data', 'functions', 'crud', 'estimate', 'master', 'trace', 'tests', 'health', 'cross', 'settings', 'import'];
  const OLD_PURPOSES = ['initial', 'material', 'notebooklm', 'hearing-questions', 'minutes', 'nfr', 'review-pm', 'review-user', 'wbs', 'progress', 'change-review',
    'report-polish', 'data-design', 'functions', 'review-eng', 'test-viewpoints', 'review-pl', 'review-ops', 'free'];
  const sc = new Set(FLOW_STEPS.flatMap((s) => s.screens));
  const pu = new Set(FLOW_STEPS.flatMap((s) => s.purposes));
  for (const id of OLD_SCREENS) assert.ok(sc.has(id), `画面 ${id} がどの段にも無い`);
  for (const id of OLD_PURPOSES) assert.ok(pu.has(id), `指示文 ${id} がどの段にも無い`);
});

test('よくある困りごと 10 件以上・用語 10 語以上', () => {
  assert.ok(FAQ.length >= 10);
  assert.ok(TERMS.length >= 10);
});

// ---- 進み具合（design.md の「端の場合」の表） ----
const linear = (r) => ['setup', 'initial', 'baseline', 'plan', 'design', 'test'].map((id) => r.status[id]);
const actives = (r) => Object.entries(r.status).filter(([, v]) => v === 'active').map(([k]) => k);

test('台帳が無いと null', () => {
  assert.equal(stepStatus(null), null);
});

test('型だけの台帳: 初期作成が今ここ', () => {
  const r = stepStatus(createLedger('型だけ', 'business-system-new', NOW));
  assert.deepEqual(linear(r), ['done', 'active', 'todo', 'todo', 'todo', 'todo']);
  assert.equal(r.loopActive, false);
  assert.equal(r.status.import, 'loop');
  assert.equal(r.status.digest, 'optional');
  assert.equal(r.status.docs, 'optional');
});

test('型の質問に会議の出典を足すと、初期作成は済で繰り返しが今ここ', () => {
  const l = createLedger('出典つき', 'business-system-new', NOW);
  l.items[0].sources = [...l.items[0].sources, { type: 'meeting', ref: '第1回', date: '2026-11-01' }];
  const r = stepStatus(l);
  assert.equal(r.status.initial, 'done');
  assert.equal(r.status.baseline, 'todo');
  assert.equal(r.loopActive, true);
  assert.deepEqual(actives(r), []);
});

test('型を使わない空の台帳: 初期作成が今ここ', () => {
  const r = stepStatus(createLedger('空', null, NOW));
  assert.equal(r.status.initial, 'active');
  assert.equal(r.loopActive, false);
});

test('要件 1 件とベースライン: 計画が今ここ', () => {
  const l = createLedger('合意済み', null, NOW);
  l.items.push({ id: 'RE-001', kind: 'requirement', title: '要件', status: 'agreed', category: 'functional' });
  l.baselines.push({ id: 'BL-001', name: '要件確定', date: '2026-11-20', items: [] });
  const r = stepStatus(l);
  assert.deepEqual(linear(r), ['done', 'done', 'done', 'active', 'todo', 'todo']);
  assert.equal(r.loopActive, false);
});

test('ベースライン無しで作業あり（sample-ledger-2 と同じ形）: 計画は済のまま繰り返しが今ここ', () => {
  const l = load('sample-ledger-2.json');
  assert.equal(l.baselines.length, 0);
  assert.ok(l.items.some((it) => it.kind === 'task'));
  const r = stepStatus(l);
  assert.equal(r.status.plan, 'done');
  assert.equal(r.status.baseline, 'todo');
  assert.equal(r.loopActive, true);
  assert.deepEqual(actives(r), []);
});

test('サンプル台帳（全部ある）: 直線の段はすべて済で、今ここは無い', () => {
  const r = stepStatus(load('sample-ledger.json'));
  assert.deepEqual(linear(r), ['done', 'done', 'done', 'done', 'done', 'done']);
  assert.equal(r.loopActive, false);
  assert.deepEqual(actives(r), []);
});
