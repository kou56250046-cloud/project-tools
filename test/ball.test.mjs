// P2 T2（項目の追加）と T4（ボール・待ち日数）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateFields, makeResolver } from '../src/core/schema.js';
import { ballOf, waitDays, notAskedYet } from '../src/core/ball.js';
import { runHealth } from '../src/core/health.js';
import { applyLocalOps } from '../src/core/patch.js';

const load = () => JSON.parse(readFileSync(new URL('../samples/sample-ledger.json', import.meta.url), 'utf8'));
const item = (l, id) => l.items.find((x) => x.id === id);

test('T2 会議・質問・要件の新しい項目の検査', () => {
  const l = load();
  const resolve = makeResolver(l);
  assert.deepEqual(validateFields('meeting', { title: 'x', date: '2026-12-01', meetingType: 'hearing', attendees: ['SH-001'] }, { resolve }).errors, []);
  assert.match(validateFields('meeting', { title: 'x', date: '2026-12-01', meetingType: 'party' }, { resolve }).errors.join(), /「party」は使えません/);
  assert.match(validateFields('question', { title: 'x', meeting: 'MT-099' }, { resolve }).errors.join(), /台帳にありません/);
  assert.match(validateFields('question', { title: 'x', meeting: 'SH-001' }, { resolve }).errors.join(), /会議の ID/);
  assert.match(validateFields('requirement', { title: 'x', category: 'nonfunctional', nfrCategory: 'speed' }, { resolve }).errors.join(), /「speed」は使えません/);
  assert.match(validateFields('request', { title: 'x', scope: 'maybe' }, { resolve }).errors.join(), /「maybe」は使えません/);
});

test('ボール: 顧客・自社・未定、完了したものは対象外', () => {
  const l = load();
  assert.equal(ballOf(item(l, 'QA-001'), l), 'customer');   // 質問先 SH-002（顧客）
  assert.equal(ballOf(item(l, 'IS-003'), l), 'own');        // 担当 SH-006（自社）
  assert.equal(ballOf(item(l, 'IS-002'), l), 'unknown');    // 担当なし
  assert.equal(ballOf(item(l, 'IS-004'), l), null);         // 完了
  const r = applyLocalOps(l, [{ op: 'add', item: { kind: 'issue', title: 'v', owner: 'SH-009' } }], '2026-11-25T00:00:00.000Z');
  assert.equal(ballOf(r.ledger.items.at(-1), r.ledger), 'vendor');
});

test('まだ聞いていない質問（予定の会議に割り当て済み・聞いた日なし）は自社待ちで、待ち日数なし', () => {
  const l = load();
  const q = item(l, 'QA-002');   // MT-003（予定）に割り当て済み、質問先は顧客
  assert.equal(notAskedYet(q, l), true);
  assert.equal(ballOf(q, l), 'own');
  assert.equal(waitDays(q, l, '2026-11-25'), null);
});

test('待ち日数: 聞いた日があればそこから、無ければ作成日から', () => {
  const l = load();
  assert.equal(waitDays(item(l, 'QA-001'), l, '2026-11-25'), 28);  // askedAt 2026-10-28
  const q = { ...item(l, 'QA-001') };
  delete q.askedAt; delete q.meeting;
  q.createdAt = new Date(2026, 10, 20, 9, 0).toISOString();
  assert.equal(waitDays(q, l, '2026-11-25'), 5);
});

test('健康診断 ball-wait: 7 日の境界と設定の日数', () => {
  const l = load();
  const has = (led, today) => runHealth(led, today).some((f) => f.code === 'ball-wait' && f.itemId === 'QA-001');
  assert.equal(has(l, '2026-11-03'), false);  // 6 日
  assert.equal(has(l, '2026-11-04'), true);   // 7 日
  l.settings.ballWaitDays = 30;
  assert.equal(has(l, '2026-11-25'), false);  // 28 日 < 30
});
