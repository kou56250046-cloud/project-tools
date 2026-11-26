// P7a: KPI（種別・健康診断・木）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateLedger, checkIntegrity } from '../src/core/schema.js';
import { applyLocalOps, validatePatch } from '../src/core/patch.js';
import { runHealth } from '../src/core/health.js';
import { kpiTree } from '../src/core/kpi.js';
import { createLedger } from '../src/core/starter.js';

const NOW = '2026-11-26T00:00:00.000Z';
const TODAY = '2026-11-26';
const load = () => JSON.parse(readFileSync(new URL('../samples/sample-ledger.json', import.meta.url), 'utf8'));
const codes = (l, code) => runHealth(l, TODAY).filter((f) => f.code === code).map((f) => f.itemId);

// ゴール 2 つ・KPI（親子）・要望・要件のつながった台帳
function base() {
  const l = createLedger('KPI の案件', null, NOW);
  l.project.purpose = '受発注を速くする';
  l.project.goals = ['処理時間を半分にする', '入力の誤りをなくす'];
  const r = applyLocalOps(l, [
    { op: 'add', tempId: 'new:k1', item: { kind: 'kpi', title: '処理時間', metric: '1 件の処理時間', baseline: '10 分', target: '5 分', measure: 'ログから集計', goal: '処理時間を半分にする' } },
    { op: 'add', tempId: 'new:k2', item: { kind: 'kpi', title: '入力画面の時間', metric: '入力の時間', target: '3 分', measure: '計測', parent: 'new:k1', goal: '入力の誤りをなくす' } },
    { op: 'add', tempId: 'new:k3', item: { kind: 'kpi', title: '誤り件数', metric: '月の誤り', target: '0 件', measure: '' } },
    { op: 'add', tempId: 'new:q1', item: { kind: 'request', title: 'FAX をなくしたい', links: ['new:k1'] } },
    { op: 'add', tempId: 'new:q2', item: { kind: 'request', title: '不採用の要望', status: 'rejected', links: ['new:k1'] } },
    { op: 'add', tempId: 'new:r1', item: { kind: 'requirement', title: 'Web で受注', category: 'functional', links: ['new:q1'] } },
    { op: 'add', tempId: 'new:r2', item: { kind: 'requirement', title: '直接の要件', category: 'functional', links: ['new:k2'] } },
    { op: 'add', tempId: 'new:q3', item: { kind: 'request', title: 'KPI に効かない要望' } },
    { op: 'add', tempId: 'new:r3', item: { kind: 'requirement', title: 'つながらない要件', category: 'functional', links: ['new:q3'] } },
    { op: 'add', tempId: 'new:r4', item: { kind: 'requirement', title: '要望の無い要件', category: 'functional' } },
  ], NOW);
  assert.equal(r.ok, true, r.errors && r.errors.join());
  return r.ledger;
}
const byTitle = (l, t) => l.items.find((it) => it.title === t);

test('KPI を差分で足せ、台帳の検査を通る。親の循環は誤りになる', () => {
  const l = base();
  assert.deepEqual(validateLedger(l), []);
  const k1 = byTitle(l, '処理時間'), k2 = byTitle(l, '入力画面の時間');
  assert.match(k1.id, /^KP-\d{3}$/);
  assert.equal(k2.parent, k1.id);
  const cyc = structuredClone(l);
  cyc.items.find((it) => it.id === k1.id).parent = k2.id;
  assert.ok(checkIntegrity(cyc).errors.some((e) => /親の KPI/.test(e.message)));
  // kpi の parent は kpi だけ（作業は指せない）
  const t = applyLocalOps(load(), [{ op: 'add', item: { kind: 'kpi', title: 'x', metric: 'x', parent: 'TK-001' } }], NOW);
  assert.equal(t.ok, false);
});

test('健康診断: 測り方・目標・ゴール・KPI につながらない要件の境界', () => {
  const l = base();
  const k3 = byTitle(l, '誤り件数');
  assert.deepEqual(codes(l, 'kpi-no-measure'), [k3.id]);
  assert.deepEqual(codes(l, 'kpi-goal-unknown'), [k3.id]);   // 根でゴールが空。子（入力画面の時間）は対象外
  const noKpi = codes(l, 'req-no-kpi');
  assert.deepEqual(noKpi, [byTitle(l, 'つながらない要件').id]);   // 要望とつながらない要件・直接つないだ要件は出ない
  // 取り下げの KPI しか無ければ出さない
  const dropped = structuredClone(l);
  for (const it of dropped.items) if (it.kind === 'kpi') it.status = 'dropped';
  assert.deepEqual(codes(dropped, 'req-no-kpi'), []);
  // KPI が 0 件なら出さない
  assert.deepEqual(codes(load(), 'req-no-kpi'), []);
  // KPI は出典なし・推測のままの対象外
  assert.ok(!runHealth(l, TODAY).some((f) => (f.code === 'no-source' || f.code === 'stale-guess') && f.itemId.startsWith('KP-')));
});

test('KPI の木: ゴールごと・子は親の下だけ（祖先のゴールで置く）・不採用を除く・直接の要件・ゴール未設定', () => {
  const l = base();
  const t = kpiTree(l);
  assert.equal(t.purpose, '受発注を速くする');
  assert.deepEqual(t.roots.map((r) => r.goal), ['処理時間を半分にする', '入力の誤りをなくす']);
  const g1 = t.roots[0].nodes;
  assert.equal(g1.length, 1);
  assert.equal(g1[0].kpi.title, '処理時間');
  assert.deepEqual(g1[0].requests.map((x) => x.request.title), ['FAX をなくしたい']);
  assert.deepEqual(g1[0].requests[0].requirements.map((x) => x.title), ['Web で受注']);
  assert.equal(g1[0].children[0].kpi.title, '入力画面の時間');
  assert.deepEqual(g1[0].children[0].directRequirements.map((x) => x.title), ['直接の要件']);
  assert.equal(t.roots[1].nodes.length, 0, '子の goal では置かない');
  assert.deepEqual(t.unassigned.map((n) => n.kpi.title), ['誤り件数']);
  // 循環していても止まり、消えない
  const cyc = structuredClone(l);
  const k1 = byTitle(cyc, '処理時間'), k2 = byTitle(cyc, '入力画面の時間');
  k1.parent = k2.id;
  const t2 = kpiTree(cyc);
  const all = [...t2.roots.flatMap((r) => r.nodes), ...t2.unassigned];
  const titles = [];
  const walk = (n) => { titles.push(n.kpi.title); n.children.forEach(walk); };
  all.forEach(walk);
  assert.ok(titles.includes('処理時間') && titles.includes('入力画面の時間'));
  assert.equal(new Set(titles).size, titles.length, '2 回出ない');
});

test('Gemini の差分でも KPI を足せる（parent に仮 ID）', () => {
  const l = base();
  const v = validatePatch({ type: 'ledger-patch', ops: [
    { op: 'add', tempId: 'new:1', item: { kind: 'kpi', title: '新', metric: 'm' } },
    { op: 'add', item: { kind: 'kpi', title: '新の子', metric: 'm', parent: 'new:1' } },
  ] }, l);
  assert.deepEqual(v.ops.flatMap((p) => p.errors), []);
});
