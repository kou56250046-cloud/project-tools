// P5 T3: 横断の計算
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crossSummary } from '../src/core/cross.js';
import { emptyWorkspace } from '../src/core/workspace.js';
import { runHealth } from '../src/core/health.js';

const load = (n) => JSON.parse(readFileSync(new URL(`../samples/${n}`, import.meta.url), 'utf8'));
const TODAY = '2026-11-26';

function ws() {
  const w = emptyWorkspace();
  w.ledgers.a = load('sample-ledger.json');
  w.ledgers.b = load('sample-ledger-2.json');
  w.activeId = 'a';
  return w;
}

test('2 案件の横断: 自分の作業・自分のボール・顧客待ち・高の件数', () => {
  const [a, b] = crossSummary(ws(), TODAY);
  // 案件 A の自分は SH-006（小野 PM）。非機能要件の定義（終了 12/11）は 11/26 から 14 日（12/10）の外、11/27 からなら内
  assert.deepEqual(a.myTasks, []);
  assert.deepEqual(crossSummary(ws(), '2026-11-27')[0].myTasks.map((x) => x.item.title), ['非機能要件の定義']);
  // 自分が担当の未完了の課題: IS-003（見積の取り直し）と社内のみの課題
  assert.deepEqual(a.myBalls.map((x) => x.item.id).sort(), ['IS-003', 'IS-005']);
  // 顧客待ち 7 日以上: QA-001（askedAt 10/28）・IS-001（担当 石田、作成 10/28）
  assert.deepEqual(a.waiting.map((x) => x.item.id).sort(), ['IS-001', 'QA-001']);
  assert.equal(a.high, runHealth(load('sample-ledger.json'), TODAY).filter((f) => f.severity === 'high').length);
  // 案件 B: Fit & Gap 分析（12/4）と、自分が担当の課題・顧客待ちの質問（11/10 から 16 日）
  assert.deepEqual(b.myTasks.map((x) => x.item.title), ['Fit & Gap 分析']);
  assert.equal(b.myBalls.length, 1);
  assert.equal(b.waiting.length, 1);
  assert.equal(b.waiting[0].wait, 16);
});

test('自分が未設定の案件は「自分」の欄を出さない', () => {
  const w = ws();
  w.ledgers.b.settings.me = null;
  const b = crossSummary(w, TODAY)[1];
  assert.equal(b.me, null);
  assert.equal(b.myTasks, null);
  assert.equal(b.myBalls, null);
  assert.equal(b.waiting.length, 1);
});
