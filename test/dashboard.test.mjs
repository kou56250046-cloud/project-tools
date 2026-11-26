// 概要画面のダッシュボードの集計
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dashboardData, seriesTotal, DASH_TEXT } from '../src/core/dashboard.js';
import { runHealth } from '../src/core/health.js';
import { createLedger } from '../src/core/starter.js';

const load = (n) => JSON.parse(readFileSync(new URL(`../samples/${n}`, import.meta.url), 'utf8'));
const TODAY = '2026-11-26';   // 木曜。今週は 11-29（日）まで、来週は 12-06（日）まで
const NOW = '2026-11-26T00:00:00.000Z';
const sum = (a) => a.reduce((x, y) => x + y, 0);
const byName = (chart, name) => chart.series.find((s) => s.name === name).values;

test('サンプル台帳: 期限切れの件数は健康診断の overdue と一致する', () => {
  const l = load('sample-ledger.json');
  const d = dashboardData(l, { today: TODAY });
  const health = runHealth(l, TODAY).filter((f) => f.code === 'overdue');
  assert.equal(d.kpi.overdue.count, health.length);
  assert.equal(sum(Object.values(d.kpi.overdue.byKind)), health.length);
  assert.equal(d.due.series.reduce((a, s) => a + s.values[0], 0), health.length);   // 期限の分布の「期限切れ」も同じ
});

test('サンプル台帳: 要件の合意率・要件の状態・確度の内訳を手で数えた値と一致する', () => {
  const l = load('sample-ledger.json');
  const d = dashboardData(l, { today: TODAY });
  const reqs = l.items.filter((it) => it.kind === 'requirement');
  const live = reqs.filter((r) => r.status !== 'dropped');
  assert.equal(d.kpi.agreement.total, live.length);
  assert.equal(d.kpi.agreement.agreed, live.filter((r) => r.status === 'agreed').length);
  assert.equal(d.kpi.agreement.rate, d.kpi.agreement.agreed / live.length);
  assert.equal(seriesTotal(d.requirements), reqs.length);
  assert.deepEqual(d.requirements.series.map((s) => s.name), ['合意', '案', '取り下げ']);
  // 確度の系列は CONFIDENCE の順の後に「未設定」
  assert.deepEqual(d.confidence.series.map((s) => s.name), ['事実', '推測', '確認済み', DASH_TEXT.noConfidence]);
  assert.deepEqual(d.confidence.categories, ['要望', '要件', '制約']);
  const reqIdx = 1;
  assert.equal(d.confidence.series.reduce((a, s) => a + s.values[reqIdx], 0), live.length);
  assert.ok(d.kpi.agreement.baselineRate !== null);   // サンプルにはベースラインがある
});

test('サンプル台帳: 顧客待ちとボールの状況が一致し、区切りは設定の日数に従う', () => {
  const l = load('sample-ledger.json');
  const d = dashboardData(l, { today: TODAY });
  const ci = d.ball.categories.indexOf('顧客待ち');
  assert.equal(d.ball.series.reduce((a, s) => a + s.values[ci], 0), d.kpi.customerWait.count);
  assert.equal(d.ball.series[0].name, `${d.ballWaitDays} 日以内`);
  l.settings.ballWaitDays = 3;
  const d2 = dashboardData(l, { today: TODAY });
  assert.deepEqual(d2.ball.series.slice(0, 3).map((s) => s.name), ['3 日以内', '3 日超', '6 日超']);
  assert.equal(seriesTotal(d2.ball), seriesTotal(d.ball));
});

test('まだ聞いていない質問と、作成日の無い課題', () => {
  const l = createLedger('ボール', null, NOW);
  l.items.push(
    { id: 'SH-001', kind: 'stakeholder', title: '顧客の担当', status: 'active', side: 'customer' },
    { id: 'MT-001', kind: 'meeting', title: '次の会議', status: 'planned', date: '2026-12-01', meetingType: 'hearing' },
    { id: 'QA-001', kind: 'question', title: 'まだ聞いていない', status: 'open', askTo: 'SH-001', meeting: 'MT-001', createdAt: NOW },
    { id: 'IS-001', kind: 'issue', title: '作成日の無い課題', status: 'open', owner: 'SH-001' },
  );
  const d = dashboardData(l, { today: TODAY });
  assert.equal(byName(d.ball, DASH_TEXT.notAsked)[d.ball.categories.indexOf('自社待ち')], 1);
  assert.equal(byName(d.ball, DASH_TEXT.unknownDays)[d.ball.categories.indexOf('顧客待ち')], 1);
});

test('作業が無い・見積の無い作業だけ・開始前', () => {
  const l = createLedger('作業', null, NOW);
  let d = dashboardData(l, { today: TODAY });
  assert.equal(d.kpi.spi.hasTasks, false);
  assert.equal(d.curve, null);
  l.items.push({ id: 'TK-001', kind: 'task', title: '見積なし', status: 'todo' });
  d = dashboardData(l, { today: TODAY });
  assert.equal(d.kpi.spi.hasTasks, true);
  assert.equal(d.kpi.spi.hasTargets, false);
  assert.equal(d.kpi.spi.value, null);
  assert.equal(d.curve, null);
  Object.assign(l.items[0], { estimate: 5, start: '2026-12-10', end: '2026-12-20' });
  d = dashboardData(l, { today: TODAY });
  assert.equal(d.kpi.spi.hasTargets, true);
  assert.equal(d.kpi.spi.value, null);   // 開始前は PV が 0
});

test('期限の無い台帳と、要件が全部取り下げの台帳', () => {
  const l = createLedger('空', null, NOW);
  l.items.push({ id: 'RE-001', kind: 'requirement', title: '取り下げ', status: 'dropped', category: 'functional' });
  const d = dashboardData(l, { today: TODAY });
  assert.equal(d.kpi.overdue.count, 0);
  assert.equal(seriesTotal(d.due), 0);
  assert.equal(d.kpi.agreement.rate, null);
});

test('週の境目: 日曜は今週、月曜は来週、翌々週の月曜はそれ以降', () => {
  const l = createLedger('週', null, NOW);
  const add = (id, due) => l.items.push({ id, kind: 'issue', title: id, status: 'open', due, owner: 'SH-001' });
  l.items.push({ id: 'SH-001', kind: 'stakeholder', title: '担当', status: 'active', side: 'own' });
  add('IS-001', '2026-11-25');   // 期限切れ
  add('IS-002', '2026-11-26');   // 今日 → 今週
  add('IS-003', '2026-11-29');   // 日曜 → 今週
  add('IS-004', '2026-11-30');   // 月曜 → 来週
  add('IS-005', '2026-12-06');   // 来週の日曜 → 来週
  add('IS-006', '2026-12-07');   // それ以降
  const d = dashboardData(l, { today: TODAY });
  assert.deepEqual(byName(d.due, '課題'), [1, 2, 2, 1]);
});

test('説明用の表示では、社内のみの項目を数えず、ベースラインと比べない', () => {
  const l = load('sample-ledger.json');
  const internal = l.items.find((it) => it.internal);
  assert.ok(internal);
  const a = dashboardData(l, { today: TODAY });
  const b = dashboardData(l, { today: TODAY, presentation: true });
  assert.equal(b.kpi.agreement.baselineRate, null);
  const due = (d) => seriesTotal(d.due);
  if (internal.kind === 'issue' && internal.due) assert.equal(due(b), due(a) - 1);
  assert.ok(seriesTotal(b.ball) <= seriesTotal(a.ball));
});
