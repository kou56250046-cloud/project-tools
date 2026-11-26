// P1 レビュー（FIX-001〜018）の再発防止テスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateLedger, validateFields } from '../src/core/schema.js';
import { validatePatch, applyPatch, applyLocalOps } from '../src/core/patch.js';
import { extractJson, safeParse } from '../src/core/extract.js';
import { runHealth } from '../src/core/health.js';

const NOW = '2026-11-25T12:00:00.000Z';
const load = () => JSON.parse(readFileSync(new URL('../samples/sample-ledger.json', import.meta.url), 'utf8'));
const all = (v) => new Set(v.ops.map((p) => p.index));

test('FIX-001 sources / links を null にする更新は誤り', () => {
  const l = load();
  for (const f of ['sources', 'links']) {
    const r = applyLocalOps(l, [{ op: 'update', id: 'QA-001', set: { [f]: null } }], NOW);
    assert.equal(r.ok, false, f);
    assert.match(r.errors.join(), /\[\]/);
  }
  const ok = applyLocalOps(l, [{ op: 'update', id: 'QA-001', set: { sources: [] } }], NOW);
  assert.equal(ok.ok, true);
  assert.deepEqual(validateLedger(ok.ledger), []);
});

test('FIX-003 検証後に対象が消えた update は飛ばし、例外にしない', () => {
  const l = load();
  const v = validatePatch({ type: 'ledger-patch', ops: [{ op: 'update', id: 'IS-001', set: { status: 'closed' } }, { op: 'add', item: { kind: 'issue', title: 'x' } }] }, l);
  const other = { ...l, items: l.items.filter((it) => it.id !== 'IS-001') };
  const r = applyPatch(other, v, all(v), NOW);
  assert.equal(r.applied, 1);
});

test('FIX-006 同じ差分の中の重複関係と、末尾の空白つきラベルは誤り', () => {
  const l = load();
  const v = validatePatch({ type: 'ledger-patch', ops: [
    { op: 'relate', from: 'SH-003', to: 'SY-002', label: '利用' },
    { op: 'relate', from: 'SH-003', to: 'SY-002', label: '利用 ' },
    { op: 'relate', from: 'SH-005', to: 'SH-008', label: '発注 ' },
  ] }, l);
  assert.equal(v.ops[0].errors.length, 0);
  assert.match(v.ops[1].errors.join(), /すでにあります/);
  assert.match(v.ops[2].errors.join(), /すでにあります/);
});

test('FIX-012 kind に constructor / __proto__ / toString を入れても落ちずに誤りになる', () => {
  const l = load();
  for (const k of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    const v = validatePatch({ type: 'ledger-patch', ops: [{ op: 'add', item: { kind: k, title: 'x' } }] }, l);
    assert.match(v.ops[0].errors.join(), /種別（kind）/, k);
  }
  const bad = load();
  bad.items[0].kind = 'constructor';
  assert.ok(validateLedger(bad).length > 0);
});

test('FIX-012 constructor という名前の項目は「不明な項目」として扱う', () => {
  const r = validateFields('issue', { title: 'x', constructor: 1 }, { resolve: () => null });
  assert.deepEqual(r.unknown, ['constructor']);
});

test('FIX-012 外部の JSON から __proto__ / constructor / prototype のキーを捨てる', () => {
  const o = safeParse('{"a":1,"__proto__":{"polluted":true},"constructor":{"x":1},"b":{"prototype":2}}');
  assert.deepEqual(Object.keys(o), ['a', 'b']);
  assert.deepEqual(Object.keys(o.b), []);
  assert.equal({}.polluted, undefined);
  const e = extractJson('```json\n{"type":"ledger-patch","ops":[{"op":"project","set":{"__proto__":{"x":1},"name":"n"}}]}\n```');
  assert.deepEqual(Object.keys(e.value.ops[0].set), ['name']);
});

test('FIX-015 推測のまま7日は、端末のローカル日付で数える', () => {
  const l = load();
  // 2026-11-18 08:30（日本時間）= 2026-11-17T23:30Z。11-24 時点では 6 日なので出ない（日本時間で実行した場合）
  const it = l.items.find((x) => x.id === 'CN-003');
  it.updatedAt = new Date(2026, 10, 18, 8, 30).toISOString();
  const f = runHealth(l, '2026-11-24').filter((x) => x.code === 'stale-guess' && x.itemId === 'CN-003');
  assert.equal(f.length, 0);
  const g = runHealth(l, '2026-11-25').filter((x) => x.code === 'stale-guess' && x.itemId === 'CN-003');
  assert.equal(g.length, 1);
});
