// 概要画面のダッシュボードの集計。DOM に触れない。描画は ui/views/overview.js（dash.js）。
// 分類・系列の名前は schema.js・ball.js の表から引く。ここだけが持つ文言は下の DASH_TEXT に置く。

import { KINDS, CONFIDENCE, NFR_CATEGORIES, DUE_FIELD, visibleLedger, isOpen, dayNumber, settingOf, latestBaseline, statusLabel } from './schema.js';

// 期限を持つ種別（課題・質問・作業・リスク）。DUE_FIELD から作る（種別を足しても決め打ちの直し漏れで落ちないように）
const DUE_KINDS = Object.keys(DUE_FIELD);
import { BALL, ballOf, waitDays, notAskedYet } from './ball.js';
import { computeEvm } from './evm.js';
import { dueTargets } from './health.js';

export const DASH_TEXT = {
  noConfidence: '未設定',
  nfrNone: '非機能（大項目なし）',
  notAsked: 'まだ聞いていない',
  unknownDays: '日数不明',
  dueBuckets: ['期限切れ', '今週', '来週', 'それ以降'],
};

const fieldValueLabel = (kind, field, v) => { const f = KINDS[kind].fields[field]; const e = f && f.values ? f.values.find((x) => x.v === v) : null; return e ? e.label : v; };
const ratio = (a, b) => (b ? a / b : null);

// today: YYYY-MM-DD。presentation: 説明用の表示（社内のみの項目を数えない）
export function dashboardData(ledger, { today, presentation = false } = {}) {
  const l = visibleLedger(ledger, presentation);
  const items = l.items;
  const t = dayNumber(today);
  const of = (kind) => items.filter((it) => it.kind === kind);

  // ---- KPI ----
  const customer = items.filter((it) => ballOf(it, l) === 'customer');
  const days = customer.map((it) => waitDays(it, l, today)).filter((d) => d !== null);
  const dues = dueTargets(l);
  const overdueList = dues.filter((d) => dayNumber(d.due) < t);
  const reqs = of('requirement').filter((r) => r.status !== 'dropped');
  const agreed = reqs.filter((r) => r.status === 'agreed').length;
  const bl = presentation ? null : latestBaseline(l);
  const blReqs = bl ? bl.items.filter((x) => x.kind === 'requirement' && x.status !== 'dropped') : [];
  const e = computeEvm(l, today);
  const hasTasks = items.some((it) => it.kind === 'task');
  const hasTargets = e.targets > 0;
  const kpi = {
    customerWait: { count: customer.length, maxDays: days.length ? Math.max(...days) : null },
    overdue: { count: overdueList.length, byKind: Object.fromEntries(DUE_KINDS.map((k) => [k, 0])) },
    agreement: { rate: ratio(agreed, reqs.length), agreed, total: reqs.length, baselineRate: bl && blReqs.length ? ratio(blReqs.filter((x) => x.status === 'agreed').length, blReqs.length) : null },
    spi: { value: hasTargets ? e.spi : null, hasTasks, hasTargets, pv: e.pv },
  };
  for (const d of overdueList) kpi.overdue.byKind[d.item.kind]++;

  // ---- 要件の状態（分類ごと・合意 / 案 / 取り下げ） ----
  const reqCats = [];
  const addCat = (label, list) => { if (list.length) reqCats.push({ label, list }); };
  const allReqs = of('requirement');
  addCat(fieldValueLabel('requirement', 'category', 'functional'), allReqs.filter((r) => r.category === 'functional'));
  for (const c of NFR_CATEGORIES) addCat(c.label, allReqs.filter((r) => r.category === 'nonfunctional' && r.nfrCategory === c.v));
  addCat(DASH_TEXT.nfrNone, allReqs.filter((r) => r.category === 'nonfunctional' && !NFR_CATEGORIES.some((c) => c.v === r.nfrCategory)));
  const cnt = (list, st) => list.filter((r) => r.status === st).length;
  reqCats.sort((a, b) => cnt(b.list, 'draft') - cnt(a.list, 'draft'));
  const requirements = {
    categories: reqCats.map((c) => c.label),
    series: ['agreed', 'draft', 'dropped'].map((st) => ({ name: statusLabel('requirement', st), values: reqCats.map((c) => cnt(c.list, st)) })),
  };

  // ---- ボールの状況（待ち先 × 待ち日数。区切りは設定の「顧客待ちを知らせる日数」） ----
  const n = settingOf(l, 'ballWaitDays');
  const open = items.filter((it) => (it.kind === 'issue' || it.kind === 'question') && isOpen(it));
  const bucketOf = (it) => {
    if (notAskedYet(it, l)) return 3;
    const d = waitDays(it, l, today);
    if (d === null) return 4;
    return d <= n ? 0 : d <= 2 * n ? 1 : 2;
  };
  const ballNames = [`${n} 日以内`, `${n} 日超`, `${2 * n} 日超`, DASH_TEXT.notAsked, DASH_TEXT.unknownDays];
  const ballVals = ballNames.map(() => BALL.map(() => 0));
  for (const it of open) {
    const b = ballOf(it, l);
    const i = BALL.findIndex((x) => x.v === b);
    if (i >= 0) ballVals[bucketOf(it)][i]++;
  }
  const ball = {
    categories: BALL.map((x) => x.label),
    series: ballNames.map((name, i) => ({ name, values: ballVals[i] })).filter((s, i) => i < 4 || s.values.some((v) => v > 0)),
  };

  // ---- 確度の内訳（要望・要件・制約） ----
  const confKinds = [['request', 'rejected'], ['requirement', 'dropped'], ['constraint', 'resolved']];
  const confLists = confKinds.map(([k, ex]) => of(k).filter((it) => it.status !== ex));
  const confidence = {
    categories: confKinds.map(([k]) => KINDS[k].label),
    series: [
      ...CONFIDENCE.map((c) => ({ name: c.label, values: confLists.map((list) => list.filter((it) => it.confidence === c.v).length) })),
      { name: DASH_TEXT.noConfidence, values: confLists.map((list) => list.filter((it) => !CONFIDENCE.some((c) => c.v === it.confidence)).length) },
    ],
  };

  // ---- 期限の分布（週は月曜始まり。1970-01-01 は木曜なので (d + 3) % 7 が 0 の日が月曜） ----
  const weekEnd = t + (6 - (((t + 3) % 7) + 7) % 7);
  const dueBucket = (d) => (d < t ? 0 : d <= weekEnd ? 1 : d <= weekEnd + 7 ? 2 : 3);
  const dueKinds = DUE_KINDS;
  const dueVals = dueKinds.map(() => [0, 0, 0, 0]);
  for (const d of dues) dueVals[dueKinds.indexOf(d.item.kind)][dueBucket(dayNumber(d.due))]++;
  const due = {
    categories: DASH_TEXT.dueBuckets.slice(),
    series: dueKinds.map((k, i) => ({ name: KINDS[k].label, values: dueVals[i] })),
  };

  return { kpi, requirements, ball, curve: hasTargets ? e.curve : null, confidence, due, ballWaitDays: n };
}

// グラフの合計（0 なら空の表示にする）
export function seriesTotal(chart) {
  return chart.series.reduce((a, s) => a + s.values.reduce((x, y) => x + y, 0), 0);
}
