// P7a: リスク（種別・既定で社内のみ・健康診断・ヒートマップ・課題へ移す・カルテ）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyLocalOps, validatePatch } from '../src/core/patch.js';
import { runHealth } from '../src/core/health.js';
import { buildPrompt } from '../src/core/prompts.js';
import { hearingCandidates } from '../src/core/hearing.js';
import { impactOf, changeRequestText } from '../src/core/impact.js';
import { dashboardData } from '../src/core/dashboard.js';
import { ledgerToKarte } from '../src/core/karte.js';
import { riskMatrix, riskToIssueOps, canMoveToIssue, heatLevel } from '../src/core/risk.js';
import { emptyWorkspace } from '../src/core/workspace.js';
import { store } from '../src/ui/store.js';

const NOW = '2026-11-26T00:00:00.000Z';
const TODAY = '2026-11-26';
const load = () => JSON.parse(readFileSync(new URL('../samples/sample-ledger.json', import.meta.url), 'utf8'));
const risk = (title, prob, impact, extra = {}) => ({ op: 'add', item: { kind: 'risk', title, prob, impact, ...extra } });

function withRisks() {
  const r = applyLocalOps(load(), [
    risk('稼働が遅れる', 5, 4, { owner: 'SH-001', due: '2026-11-01', links: ['IS-001'] }),
    risk('担当者の退職', 2, 3, { response: '引き継ぎ資料', status: 'mitigating' }),
    risk('もう起きた', 4, 4, { status: 'occurred' }),
    risk('共有してよい', 1, 1, { internal: false }),
  ], NOW);
  assert.equal(r.ok, true, r.errors && r.errors.join());
  return r.ledger;
}
const byTitle = (l, t) => l.items.find((it) => it.title === t);

test('リスクは既定で社内のみ。見込み・影響は 1〜5 の整数（数の 3 は通り、0・6・小数は誤り）', () => {
  const l = withRisks();
  assert.equal(byTitle(l, '稼働が遅れる').internal, true);
  assert.equal(byTitle(l, '共有してよい').internal, false);
  assert.match(byTitle(l, '稼働が遅れる').id, /^RK-\d{3}$/);
  const v = validatePatch({ type: 'ledger-patch', ops: [risk('三', 3, 3), risk('零', 0, 3), risk('六', 6, 3), risk('小数', 2.5, 3)] }, load());
  assert.deepEqual(v.ops.map((p) => p.errors.length > 0), [false, true, true, true]);
});

test('健康診断: リスクの担当・期限・期限切れ・点数 15 以上で対策なし。出典なし・推測のままは出ない', () => {
  const l = withRisks();
  const h = runHealth(l, TODAY);
  const late = byTitle(l, '稼働が遅れる').id;
  assert.ok(h.some((f) => f.code === 'overdue' && f.itemId === late));
  assert.ok(h.some((f) => f.code === 'risk-high-no-response' && f.itemId === late));
  assert.ok(h.some((f) => f.code === 'no-owner' && f.itemId === byTitle(l, '担当者の退職').id));
  assert.ok(!h.some((f) => f.code === 'risk-high-no-response' && f.itemId === byTitle(l, 'もう起きた').id), '発生したリスクは対象外');
  assert.ok(!h.some((f) => (f.code === 'no-source' || f.code === 'stale-guess') && f.itemId.startsWith('RK-')));
});

test('ダッシュボード: 期限切れの件数と内訳・期限の分布にリスクが入り、健康診断と一致する', () => {
  const l = withRisks();
  const d = dashboardData(l, { today: TODAY });
  const overdue = runHealth(l, TODAY).filter((f) => f.code === 'overdue').length;
  assert.equal(d.kpi.overdue.count, overdue);
  assert.equal(d.kpi.overdue.byKind.risk, 1);
  assert.equal(d.due.series.reduce((a, s) => a + s.values[0], 0), overdue);
  assert.ok(d.due.series.some((s) => s.name === 'リスク'));
});

test('ヒヤリングの候補にも、ヒヤリング質問の生成の材料にもリスクが入らない', () => {
  const l = withRisks();
  assert.ok(!hearingCandidates(l, TODAY).some((c) => String(c.ref || '').startsWith('RK-')));
  const p = buildPrompt('hearing-questions', l, { today: TODAY });
  assert.ok(!p.includes('リスク「稼働が遅れる」'));
});

test('変更要求書の文面に社内のみの項目が出ない（影響範囲そのものは変わらない）', () => {
  const l = withRisks();
  const late = byTitle(l, '稼働が遅れる');
  const imp = impactOf(l, ['IS-001']);
  assert.ok(imp.items.some((x) => x.item.id === late.id), 'impactOf の結果は変えない');
  const cr = { id: 'CR-099', kind: 'change', title: '変更', status: 'proposed', links: ['IS-001', late.id] };
  assert.ok(!changeRequestText(l, cr, imp).includes('稼働が遅れる'));
});

test('ヒートマップは監視中・対策中だけを数え、一覧は全状態を点数順。点数の段', () => {
  const l = withRisks();
  const m = riskMatrix(l);
  assert.equal(m.cells[4][3], 1);   // 見込み 5・影響 4
  assert.equal(m.cells[1][2], 1);   // 見込み 2・影響 3（対策中）
  assert.equal(m.cells[3][3], 0);   // 発生したものは数えない
  assert.equal(m.cells.flat().reduce((a, b) => a + b, 0), 3);
  assert.deepEqual(m.items.map((x) => x.score), [20, 16, 6, 1]);
  assert.deepEqual([1, 4, 5, 9, 10, 14, 15, 25].map(heatLevel), [1, 1, 2, 2, 3, 3, 4, 4]);
});

test('課題へ移す: 1 回の操作で課題が足され、リスクが発生になり、取り消しで両方戻る。発生・解消には出ない', () => {
  const l = withRisks();
  store.workspace = emptyWorkspace(); store.undoById.clear();
  store.addProject(l, { exported: true });
  const before = store.ledger;
  const r = byTitle(before, '稼働が遅れる');
  assert.equal(canMoveToIssue(r), true);
  assert.equal(canMoveToIssue(byTitle(before, 'もう起きた')), false);
  const res = store.applyLocal(riskToIssueOps(r));
  assert.equal(res.ok, true, res.errors && res.errors.join());
  const issue = store.ledger.items.find((it) => it.kind === 'issue' && it.title === '（発生）稼働が遅れる');
  assert.ok(issue);
  assert.deepEqual(issue.links, [r.id]);
  assert.equal(issue.internal, true);
  assert.equal(issue.severity, 'high');
  assert.equal(store.ledger.items.find((it) => it.id === r.id).status, 'occurred');
  assert.equal(store.history().length, 1, '取り消し 1 段');
  store.undo();
  assert.equal(store.ledger, before);
});

test('カルテ: 全状態を書き出し、発生・解消に印。見込み・影響は高中低。社内のみは既定で除く', () => {
  const l = withRisks();
  const off = ledgerToKarte(l, { today: TODAY }).karte.risks;
  assert.deepEqual(off.map((x) => x.wbId), [byTitle(l, '共有してよい').id]);
  const on = ledgerToKarte(l, { today: TODAY, includeInternal: true }).karte.risks;
  assert.equal(on.length, 4);
  const late = on.find((x) => x.wbId === byTitle(l, '稼働が遅れる').id);
  assert.deepEqual([late.prob, late.impact], ['高', '高']);
  assert.match(late.id, /^R-\d{2,}$/);
  assert.match(on.find((x) => x.wbId === byTitle(l, 'もう起きた').id).text, /（発生）$/);
  assert.match(on.find((x) => x.wbId === byTitle(l, '担当者の退職').id).text, /対策: 引き継ぎ資料/);
});
