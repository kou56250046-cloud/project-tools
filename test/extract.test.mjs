import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractJson } from '../src/core/extract.js';

const sample = (name) => readFileSync(new URL(`../samples/${name}`, import.meta.url), 'utf8');

test('囲み記号と前後の説明文', () => {
  const r = extractJson(sample('broken-fenced.txt'));
  assert.equal(r.ok, true);
  assert.equal(r.value.ops[0].item.title, '帳票の出力形式が未定');
  assert.match(r.notes.join(), /囲み記号/);
});

test('囲み無しで前後に説明文', () => {
  const r = extractJson(sample('broken-prose.txt'));
  assert.equal(r.ok, true);
  assert.equal(r.value.ops[0].id, 'QA-001');
  assert.match(r.notes.join(), /説明文/);
});

test('末尾のカンマ', () => {
  const r = extractJson(sample('broken-trailing-comma.txt'));
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.ops[0].item.links, ['RQ-001']);
});

test('全角の引用符', () => {
  const r = extractJson(sample('broken-fullwidth-quotes.txt'));
  assert.equal(r.ok, true);
  assert.equal(r.value.ops[0].item.category, 'schedule');
});

test('配列だけの返答は ops とみなす', () => {
  const r = extractJson(sample('broken-array-only.txt'));
  assert.equal(r.ok, true);
  assert.equal(r.value.type, 'ledger-patch');
  assert.equal(r.value.ops.length, 2);
});

test('文字列の中の括弧やカンマは壊さない', () => {
  const r = extractJson('{"ops":[{"op":"add","item":{"title":"a, } ] \\"b\\""}}]}');
  assert.equal(r.ok, true);
  assert.equal(r.value.ops[0].item.title, 'a, } ] "b"');
});

test('読めない文字列は位置つきのエラー', () => {
  const r = extractJson('```json\n{\n  "ops": [\n    { "op": "add" \n    { "x": 1 }\n  ]\n}\n```');
  assert.equal(r.ok, false);
  assert.match(r.error, /行目/);
  assert.equal(extractJson('').ok, false);
  assert.match(extractJson('JSON はありません').error, /見つかりません/);
});

test('途中で切れた返答はエラー', () => {
  const r = extractJson('```json\n{ "ops": [ { "op": "add", "item": { "title": "途中');
  assert.equal(r.ok, false);
});
