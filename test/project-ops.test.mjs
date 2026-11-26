// 案件の操作 T1: 取り消しの段（20 段・undoTo・切り替えで残る・段の種類）と、案件の中身を空に戻す
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyWorkspace } from '../src/core/workspace.js';
import { validatePatch } from '../src/core/patch.js';
import { createLedger } from '../src/core/starter.js';
import { store, UNDO_LIMIT } from '../src/ui/store.js';

const load = (n) => JSON.parse(readFileSync(new URL(`../samples/${n}`, import.meta.url), 'utf8'));
const fresh = () => { store.workspace = emptyWorkspace(); store.undoById.clear(); store.selectedId = null; };
const addIssue = (title) => store.applyLocal([{ op: 'add', item: { kind: 'issue', title } }]);

test('25 回変更しても取り消せるのは 20 段まで。1段ずつ戻る', () => {
  fresh();
  store.addProject(load('sample-ledger.json'), { exported: true });
  const start = store.ledger;
  const revs = [];
  for (let i = 0; i < 25; i++) { revs.push(store.ledger.revision); assert.equal(addIssue('課題' + i).ok, true); }
  assert.equal(UNDO_LIMIT, 20);
  assert.equal(store.history().length, 20);
  for (let i = 24; i >= 5; i--) {
    assert.equal(store.undo(), true);
    assert.equal(store.ledger.revision, revs[i]);
  }
  assert.equal(store.canUndo(), false);
  assert.equal(store.undo(), false);
  assert.notEqual(store.ledger, start);   // 最初の 5 回分は戻れない
});

test('undoTo(i) は i 番目以降を捨てて一度に戻る。書き出しより前に戻ると revision だけ消える', () => {
  fresh();
  store.addProject(load('sample-ledger.json'), { exported: true });
  const at = store.exportedAt;
  const r0 = store.ledger.revision;
  for (let i = 0; i < 5; i++) addIssue('課題' + i);
  const h = store.history();
  assert.deepEqual(h.map((x) => x.index), [4, 3, 2, 1, 0]);   // 新しい順
  assert.equal(store.undoTo(2), true);
  assert.equal(store.ledger.revision, r0 + 2);
  assert.equal(store.history().length, 2);
  assert.equal(store.undoTo(5), false);
  assert.equal(store.undoTo(0), true);
  assert.equal(store.ledger.revision, r0);
  assert.equal(store.canUndo(), false);
  // 書き出した revision の台帳に戻っただけなので、書き出し状態は残る
  assert.equal(store.exportedRevision, r0);
  // 書き出しより前に戻ったときは revision を消し、日時は残す
  store.markExported();
  const at2 = store.exportedAt;
  assert.ok(at2 && at);
  addIssue('a'); store.markExported(); addIssue('b');
  store.undoTo(0);
  assert.equal(store.exportedRevision, null);
  assert.equal(store.exportedAt !== null, true);
});

test('案件を切り替えて戻っても段は残る', () => {
  fresh();
  const a = store.addProject(load('sample-ledger.json'), { exported: true });
  const b = store.addProject(load('sample-ledger-2.json'), { exported: true });
  store.switchProject(a);
  addIssue('x'); addIssue('y'); addIssue('z');
  store.switchProject(b);
  assert.equal(store.canUndo(), false);
  store.switchProject(a);
  assert.equal(store.history().length, 3);
});

test('段の種類: 取込・画面・ヒヤリング・設定・ベースライン・リセット', () => {
  fresh();
  store.addProject(load('sample-ledger.json'), { exported: true });
  const v = validatePatch({ type: 'ledger-patch', ops: [{ op: 'add', item: { kind: 'issue', title: '取込の課題' } }] }, store.ledger);
  store.applyValidated(v, new Set([0]));
  addIssue('画面の課題');
  store.applyLocal([{ op: 'add', item: { kind: 'question', title: 'ヒヤリングの質問' } }], 'hearing');
  store.updateSettings({ ballWaitDays: 10 });
  store.recordBaseline('要件確定', '2026-11-26');
  store.resetProject('business-system-new');
  const kinds = store.history().map((x) => x.kind).reverse();
  assert.deepEqual(kinds, ['import', 'local', 'hearing', 'settings', 'baseline', 'reset']);
  assert.deepEqual(store.history().reverse().map((x) => x.count), [1, 1, 1, 1, 1, 1]);
});

test('中身を空に戻すと、項目は型の質問だけになり、案件情報・設定は残る。取り消しで戻る', () => {
  fresh();
  store.addProject(load('sample-ledger.json'), { exported: true });
  store.updateSettings({ ballWaitDays: 12 });
  const before = store.ledger;
  const token = store.token;
  store.selectedId = before.items[0].id;
  const next = store.resetProject('package');
  const tmpl = createLedger('x', 'package', '2026-11-26T00:00:00.000Z');
  assert.equal(next.items.length, tmpl.items.length);
  assert.deepEqual(next.items.map((i) => i.id), tmpl.items.map((i) => i.id));   // 採番は 001 から
  assert.deepEqual(next.relations, []);
  assert.deepEqual(next.baselines, []);
  assert.equal(next.changelog.length, 1);
  assert.equal(next.changelog[0].changes[0].op, 'reset');
  assert.equal(next.project.name, before.project.name);
  assert.equal(next.project.customer, before.project.customer);
  assert.equal(next.project.starter, 'package');
  assert.equal(next.settings.ballWaitDays, 12);
  assert.equal(next.revision, before.revision + 1);
  assert.notEqual(store.token, token);
  assert.equal(store.selectedId, null);
  assert.equal(store.isDirty(), true);
  // 型を使わない
  store.resetProject(null);
  assert.equal(store.ledger.items.length, 0);
  assert.equal(store.ledger.project.starter, null);
  store.undo(); store.undo();
  assert.equal(store.ledger, before);
});

test('取り消しの段の大きさの目安: 500 項目の台帳 ×20 が 20MB 未満', () => {
  const l = createLedger('大きい案件', 'business-system-new', '2026-11-26T00:00:00.000Z');
  for (let i = 0; i < 500; i++) {
    l.items.push({ id: 'RQ-' + String(i + 100).padStart(3, '0'), kind: 'request', title: '要望の題名をそれなりの長さで書いたもの ' + i, status: 'open',
      summary: '要望の概要。業務の流れと困りごとを二、三文で書いたくらいの長さを想定した説明文です。'.repeat(2), certainty: 'fact', source: '議事録 2026-11-01' });
  }
  const size = JSON.stringify(l).length;
  assert.ok(size * UNDO_LIMIT < 20 * 1024 * 1024, `1 段 ${size} 文字`);
});

test('中身を空に戻すと、無くなった項目を指す「自分」の設定は外れる', () => {
  fresh();
  store.addProject(load('sample-ledger.json'), { exported: true });
  const sh = store.ledger.items.find((it) => it.kind === 'stakeholder');
  store.updateSettings({ me: sh.id });
  store.resetProject(null);
  assert.equal(store.ledger.settings.me, null);
});
