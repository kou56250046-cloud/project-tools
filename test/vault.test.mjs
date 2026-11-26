import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cryptoAvailable, newSalt, deriveKey, sealText, parseBox, openBox } from '../src/core/vault.js';

const ITER = 1000; // テストは速さのため回数を減らす

test('暗号化した箱は合言葉で開け、中身に平文が出ない', async () => {
  assert.ok(cryptoAvailable());
  const salt = newSalt();
  const key = await deriveKey('みなと-2026', salt, ITER);
  const text = JSON.stringify({ name: '青木 部長' });
  const boxText = await sealText(key, salt, ITER, text);
  assert.doesNotMatch(boxText, /青木/);
  const box = parseBox(boxText);
  assert.equal(box.iter, ITER);
  assert.equal(await openBox(key, box), text);
});

test('合言葉が違うと開けない', async () => {
  const salt = newSalt();
  const boxText = await sealText(await deriveKey('right', salt, ITER), salt, ITER, 'secret');
  const wrong = await deriveKey('wrong', salt, ITER);
  await assert.rejects(openBox(wrong, parseBox(boxText)));
});

test('同じ内容でも毎回違う暗号文になる（iv を使い回さない）', async () => {
  const salt = newSalt();
  const key = await deriveKey('p', salt, ITER);
  const a = parseBox(await sealText(key, salt, ITER, 'x'));
  const b = parseBox(await sealText(key, salt, ITER, 'x'));
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ct, b.ct);
});

test('壊れた箱は null', () => {
  assert.equal(parseBox('{'), null);
  assert.equal(parseBox('{"v":2}'), null);
});
