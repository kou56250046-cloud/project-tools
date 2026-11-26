// P3 T4: 影響範囲と定例会資料・週報
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { impactOf } from '../src/core/impact.js';
import { buildReport, reportText, previousMeetingDate } from '../src/core/report.js';
import { visibleLedger } from '../src/core/schema.js';

const load = () => JSON.parse(readFileSync(new URL('../samples/sample-ledger.json', import.meta.url), 'utf8'));
const titleOf = (l, id) => l.items.find((x) => x.id === id).title;

test('影響範囲: RE-002 からつながる作業・課題が入り、見積の合計が手計算と一致する', () => {
  const l = load();
  const r = impactOf(l, ['RE-002']);
  const tasks = r.byKind.task.map((t) => t.title).sort();
  // RE-002 を links に持つ作業（要件定義書の作成 15・連携設計 15・連携機能の開発 30）と、
  // それらと前後関係でつながる作業（2段目）
  assert.ok(tasks.includes('要件定義書の作成'));
  assert.ok(tasks.includes('連携設計（倉庫・会計）'));
  assert.ok(tasks.includes('連携機能の開発'));
  assert.ok(r.byKind.issue.some((x) => x.id === 'IS-002'));
  const expected = r.tasks.filter((t) => !l.items.some((c) => c.parent === t.id)).reduce((a, t) => a + (t.estimate || 0), 0);
  assert.equal(r.taskEstimate, expected);
});

test('影響範囲: 担当者を経由した無関係な作業は入らず、親から兄弟へも広がらない', () => {
  const l = load();
  const r = impactOf(l, ['RE-002']);
  const titles = r.byKind.task.map((t) => t.title);
  // 担当 SH-007 つながりの「現行業務の調査」「画面設計」「Web 発注画面の開発」は入らない
  assert.deepEqual(titles.sort(), ['基本設計レビュー', '総合テスト', '要件定義 合意', '要件定義書の作成', '連携機能の開発', '連携設計（倉庫・会計）'].sort());
  assert.equal(r.taskEstimate, 94);   // 15 + 15 + 30 + 4 + 30（マイルストーンは 0）
  assert.ok(r.byKind.stakeholder.some((s) => s.id === 'SH-007'), '担当者は終点として入る');
});

test('影響範囲: 親の作業が直接つながっていれば、子の見積も数える', () => {
  const l = load();
  const p = l.items.find((x) => x.kind === 'task' && x.title === '基本設計');
  p.links = ['RE-005'];
  const r = impactOf(l, ['RE-005']);
  const titles = r.byKind.task.map((t) => t.title);
  for (const t of ['画面設計', '連携設計（倉庫・会計）', '基盤設計（クラウド）', '基本設計レビュー']) assert.ok(titles.includes(t), t);
  assert.ok(r.taskEstimate >= 51);
});

test('前回の会議は開催済みの定例のうち最新', () => {
  assert.equal(previousMeetingDate(load(), '2026-11-26'), '2026-11-11');
  assert.equal(previousMeetingDate(load(), '2026-11-05'), '2026-10-28');
  assert.equal(previousMeetingDate(load(), '2026-10-01'), '2026-09-24');
});

test('定例会資料: 期間内の変更だけが入る', () => {
  const l = load();
  const r = buildReport(l, { from: '2026-11-11', to: '2026-11-26', today: '2026-11-26' });
  const addedTitles = r.added.map((x) => x.title);
  assert.ok(addedTitles.includes('スマホで受注状況を見られるようにする'));
  assert.ok(!addedTitles.includes('現行業務の調査'), '10/01 の追加は期間外');
  assert.ok(r.decisions.some((d) => d.id === 'DC-003'));
  assert.ok(r.waiting.some((w) => w.item.id === 'QA-001'));
  const text = reportText(r, l.project.name);
  assert.match(text, /■ 決まったこと/);
  assert.doesNotMatch(text, /現行業務の調査（/);
});

test('説明用の表示では、社内のみの項目と実績が文面に入らない', () => {
  const l = load();
  const internal = l.items.find((x) => x.internal);
  const normal = buildReport(l, { from: '2026-11-11', to: '2026-11-26', today: '2026-11-26' });
  assert.ok(normal.added.some((x) => x.id === internal.id));
  const pres = buildReport(l, { from: '2026-11-11', to: '2026-11-26', today: '2026-11-26', presentation: true });
  assert.ok(!pres.added.some((x) => x.id === internal.id));
  const text = reportText(pres, l.project.name);
  assert.doesNotMatch(text, new RegExp(titleOf(l, internal.id)));
  assert.doesNotMatch(text, /CPI|実績/);
  assert.equal(visibleLedger(l, true).items.some((x) => x.internal), false);
});
