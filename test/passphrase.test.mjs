// 案件の操作 T2: 合言葉の変更。localStorage の偽物で、部分失敗・保存の列・開けない退避を確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyWorkspace } from '../src/core/workspace.js';
import { newSalt, deriveKey, sealText, PBKDF2_ITERATIONS } from '../src/core/vault.js';
import { store } from '../src/ui/store.js';

const KEY_VAULT = 'anken-workbench:v1:vault';
const KEY_RECOVERY = 'anken-workbench:v1:recovery';
const load = (n) => JSON.parse(readFileSync(new URL(`../samples/${n}`, import.meta.url), 'utf8'));

// failOn: この キーへの setItem を失敗させる
function fakeStorage() {
  const m = new Map();
  return {
    failOn: null,
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { if (this.failOn === k) throw new Error('QuotaExceededError'); m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
  };
}

async function setup() {
  const ls = fakeStorage();
  globalThis.window = { localStorage: ls };
  store.workspace = emptyWorkspace(); store.undoById.clear(); store.recovery = {};
  store.key = null; store.salt = null; store.keyRef = null; store.saving = Promise.resolve();
  store.vaultState = 'empty';
  await store.setPassphrase('old-pass-123');
  store.addProject(load('sample-ledger.json'), { exported: true });
  await store.saving;
  return ls;
}

test('違う今の合言葉では失敗し、保存は変わらない', async () => {
  const ls = await setup();
  const v = ls.getItem(KEY_VAULT);
  const r = await store.changePassphrase('wrong-pass', 'new-pass-456');
  assert.deepEqual(r, { ok: false, error: '今の合言葉が違います' });
  assert.equal(ls.getItem(KEY_VAULT), v);
});

test('変えた後は新しい合言葉で開け、古い合言葉では開けない。退避も新しい合言葉で開ける', async () => {
  const ls = await setup();
  store.recovery = { broken: '{"壊れた":' };
  await store.saveRecovery();
  const name = store.ledger.project.name;
  assert.deepEqual(await store.changePassphrase('old-pass-123', 'new-pass-456'), { ok: true });
  store.lock();
  assert.equal(store.vaultState, 'locked');
  assert.equal((await store.unlock('old-pass-123')).ok, false);
  assert.equal((await store.unlock('new-pass-456')).ok, true);
  assert.equal(store.ledger.project.name, name);
  assert.deepEqual(store.recovery, { broken: '{"壊れた":' });
  assert.ok(ls.getItem(KEY_RECOVERY));
});

test('退避の書き込みに失敗すると、箱と退避は元の文字列のままで ok:false', async () => {
  const ls = await setup();
  store.recovery = { broken: 'x' };
  await store.saveRecovery();
  const v = ls.getItem(KEY_VAULT);
  const rec = ls.getItem(KEY_RECOVERY);
  ls.failOn = KEY_RECOVERY;
  const r = await store.changePassphrase('old-pass-123', 'new-pass-456');
  ls.failOn = null;
  assert.equal(r.ok, false);
  assert.match(r.error, /合言葉は変わっていません/);
  assert.equal(ls.getItem(KEY_VAULT), v);
  assert.equal(ls.getItem(KEY_RECOVERY), rec);
  store.lock();
  assert.equal((await store.unlock('old-pass-123')).ok, true);
});

test('変更中に呼ばれた保存は、変更後の鍵で書く', async () => {
  await setup();
  const p = store.changePassphrase('old-pass-123', 'new-pass-456');
  store.applyLocal([{ op: 'add', item: { kind: 'issue', title: '変更中に足した課題' } }]);   // persist が列の後ろに並ぶ
  assert.equal((await p).ok, true);
  await store.saving;
  store.lock();
  assert.equal((await store.unlock('new-pass-456')).ok, true);
  assert.ok(store.ledger.items.some((it) => it.title === '変更中に足した課題'));
});

test('今の合言葉で開けない退避があると、変更を止める', async () => {
  const ls = await setup();
  const salt = newSalt();
  const other = await deriveKey('another-pass', salt);
  ls.setItem(KEY_RECOVERY, await sealText(other, salt, PBKDF2_ITERATIONS, '{"type":"recovery","items":{"a":"b"}}'));
  const v = ls.getItem(KEY_VAULT);
  const r = await store.changePassphrase('old-pass-123', 'new-pass-456');
  assert.equal(r.ok, false);
  assert.match(r.error, /開けない退避データ/);
  assert.equal(ls.getItem(KEY_VAULT), v);
});

test('変更中にロックすると、変更をやめて保存は元のまま（空の入れ物を書かない）', async () => {
  const ls = await setup();
  const v = ls.getItem(KEY_VAULT);
  const p = store.changePassphrase('old-pass-123', 'new-pass-456');
  assert.equal(store.passChanging, true);
  await Promise.resolve();
  store.lock();
  const r = await p;
  assert.equal(r.ok, false);
  assert.equal(store.passChanging, false);
  assert.equal(ls.getItem(KEY_VAULT), v);
  assert.equal((await store.unlock('old-pass-123')).ok, true);
  assert.equal(store.projects().length, 1);
});
