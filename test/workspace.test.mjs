// P5 T2: 複数案件（workspace）の移行・案件ごとの検査・切り替えと取り消し
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { migrateWorkspace, openWorkspace, findByName, emptyWorkspace } from '../src/core/workspace.js';
import { migrateLedger, validateLedger, normalizeCounters } from '../src/core/schema.js';
import { store } from '../src/ui/store.js';

const load = (n) => JSON.parse(readFileSync(new URL(`../samples/${n}`, import.meta.url), 'utf8'));
const check = (obj) => {
  const m = migrateLedger(obj);
  if (m.error) return { ok: false, errors: [m.error] };
  const errs = validateLedger(m.ledger, { allowDanglingRefs: true });
  return errs.length ? { ok: false, errors: errs } : { ok: true, ledger: normalizeCounters(m.ledger), migrated: m.migrated };
};

test('P4 までの中身（台帳1件）は workspace に包まれ、書き出し状態を引き継ぐ', () => {
  const l = load('sample-ledger.json');
  const m = migrateWorkspace(l, { revision: 12, at: '2026-11-20T00:00:00.000Z' });
  assert.equal(m.wrapped, true);
  const ws = m.workspace;
  assert.equal(Object.keys(ws.ledgers).length, 1);
  assert.equal(ws.ledgers[ws.activeId], l);
  assert.deepEqual(ws.exported[ws.activeId], { revision: 12, at: '2026-11-20T00:00:00.000Z' });
});

test('P1 の平文（版 1 の台帳）も包めて、開くと版 2 に移行され未書き出しになる', () => {
  const v1 = load('sample-ledger-v1.json');
  const m = migrateWorkspace(v1, { revision: 12, at: null });
  const o = openWorkspace(m.workspace, check);
  const id = o.workspace.activeId;
  assert.equal(o.workspace.ledgers[id].schemaVersion, 2);
  assert.deepEqual(o.migratedIds, [id]);
  assert.equal(o.workspace.exported[id].revision, null);
});

test('未知の形は移行しない', () => {
  assert.ok(migrateWorkspace({ type: 'something' }).error);
  assert.ok(migrateWorkspace(null).error);
});

test('2 案件のうち 1 件だけ壊れていたら、その案件だけ退避して残りは開く', () => {
  const ws = emptyWorkspace();
  ws.ledgers.a = load('sample-ledger.json');
  ws.ledgers.b = { ...load('sample-ledger-2.json'), items: 'broken' };
  ws.activeId = 'b';
  ws.exported = { a: { revision: 12, at: null }, b: { revision: 1, at: null } };
  const o = openWorkspace(ws, check);
  assert.deepEqual(Object.keys(o.workspace.ledgers), ['a']);
  assert.deepEqual(Object.keys(o.broken), ['b']);
  assert.equal(o.workspace.activeId, 'a');
  assert.match(o.broken.b, /"broken"/);
});

test('案件名で同じ案件を探す', () => {
  const ws = emptyWorkspace();
  ws.ledgers.a = load('sample-ledger.json');
  assert.equal(findByName(ws, '【ダミー】みなと物産 受発注システム刷新'), 'a');
  assert.equal(findByName(ws, '別の案件'), null);
});

test('store: 案件の追加・切り替え・案件ごとの取り消し・同名の置き換え・外す', () => {
  store.workspace = emptyWorkspace();
  store.undoById.clear();
  const a = store.addProject(load('sample-ledger.json'), { exported: true });
  const b = store.addProject(load('sample-ledger-2.json'), { exported: true });
  assert.equal(store.activeId, b);
  assert.equal(store.projects().length, 2);
  // A で変更 → B に切り替え → 取り消しは押せない → A に戻ると取り消せる
  store.switchProject(a);
  assert.equal(store.applyLocal([{ op: 'update', id: 'IS-001', set: { status: 'closed' } }]).ok, true);
  assert.equal(store.isDirty(), true);
  store.switchProject(b);
  assert.equal(store.canUndo(), false);
  assert.equal(store.isDirty(), false);
  store.switchProject(a);
  assert.equal(store.canUndo(), true);
  store.undo();
  assert.equal(store.ledger.items.find((x) => x.id === 'IS-001').status, 'open');
  // 同名のファイルを「置き換え」で読むと案件数が増えない
  const same = store.findProjectByName(load('sample-ledger.json').project.name);
  assert.equal(same, a);
  store.replaceProject(same, load('sample-ledger.json'), { exported: true });
  assert.equal(store.projects().length, 2);
  // 外す
  store.removeProject(a);
  assert.equal(store.projects().length, 1);
  assert.equal(store.activeId, b);
  store.removeProject(b);
  assert.equal(store.ledger, null);
});
