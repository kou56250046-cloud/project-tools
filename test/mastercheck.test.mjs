// P4 T4: CSV の読み取りとマスタの点検
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDelimited, detectDelimiter, decodeBytes } from '../src/core/csv.js';
import { checkMaster } from '../src/core/mastercheck.js';

const sample = (n) => new URL(`../samples/${n}`, import.meta.url);
const load = () => JSON.parse(readFileSync(sample('sample-ledger.json'), 'utf8'));
const ent = (l, name) => l.items.find((x) => x.kind === 'entity' && x.physicalName === name);

test('CSV: 引用符の中の改行・カンマ・"" と BOM・CRLF', () => {
  const rows = parseDelimited('﻿a,b\r\n"x, y","1\n2"\r\n"say ""hi""",z\r\n');
  assert.deepEqual(rows, [['a', 'b'], ['x, y', '1\n2'], ['say "hi"', 'z']]);
  assert.equal(detectDelimiter('a\tb\tc\n1,2'), '\t');
  assert.equal(detectDelimiter('"a\tb",c,d'), ',');
});

test('文字コード: Shift_JIS のファイルが自動判定で読める', () => {
  const utf = decodeBytes(readFileSync(sample('sample-master-customer.csv')));
  const sj = decodeBytes(readFileSync(sample('sample-master-customer-sjis.csv')));
  assert.equal(utf.encoding, 'utf-8');
  assert.equal(sj.encoding, 'shift_jis');
  assert.deepEqual(parseDelimited(sj.text), parseDelimited(utf.text));
  assert.equal(parseDelimited(sj.text)[3][1], 'さくら食品\n（旧 さくら商店）');
});

test('正常なマスタは違反 0 件', () => {
  const l = load();
  const rows = parseDelimited(decodeBytes(readFileSync(sample('sample-master-customer.csv'))).text);
  const r = checkMaster(ent(l, 'customer'), rows);
  assert.equal(r.total, 0);
  assert.equal(r.dataRows, 3);
});

test('違反入りのマスタ: 見出し・主キー・必須・長さ・形がそれぞれ期待の行で出る', () => {
  const l = load();
  const rows = parseDelimited(readFileSync(sample('sample-master-customer-ng.csv'), 'utf8'));
  const r = checkMaster(ent(l, 'customer'), rows);
  const at = (type) => r.issues.filter((x) => x.type === type).map((x) => [x.row, x.column]);
  assert.deepEqual(at('header').map((x) => x[1]).sort(), ['created_at', 'memo']);
  assert.deepEqual(at('pk'), [[3, 'customer_code']]);
  assert.deepEqual(at('required'), [[4, 'customer_name']]);
  assert.deepEqual(at('type'), [[5, 'price_rank']]);
  assert.deepEqual(at('pattern'), [[6, 'customer_code']]);
});

test('型と外部キー: 参照先の元データがあるときだけ外部キーを見る', () => {
  const l = load();
  const cusRows = parseDelimited(decodeBytes(readFileSync(sample('sample-master-customer.csv'))).text);
  const priceRows = parseDelimited(readFileSync(sample('sample-master-price.tsv'), 'utf8'));
  const price = ent(l, 'customer_price');
  const cus = ent(l, 'customer');
  const without = checkMaster(price, priceRows);
  assert.equal(without.summary.fk, 0);
  const r = checkMaster(price, priceRows, new Map([[cus.id, { header: cusRows[0], rows: cusRows.slice(1) }]]), l.items.filter((x) => x.kind === 'entity'));
  assert.deepEqual(r.issues.filter((x) => x.type === 'fk').map((x) => [x.row, x.value]), [[3, 'C0000009']]);
  assert.deepEqual(r.issues.filter((x) => x.type === 'type').map((x) => [x.row, x.column]), [[4, 'unit_price'], [5, 'valid_from']]);
  // 2026/04/01 は日付として受け付ける
  assert.ok(!r.issues.some((x) => x.row === 4 && x.column === 'valid_from'));
});
