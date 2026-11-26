import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripModule, findCollisions, build } from '../build.mjs';

test('トップレベルの名前の衝突を検出する', () => {
  const errs = findCollisions([
    { file: 'a.js', code: 'export function foo() {}\nconst bar = 1;' },
    { file: 'b.js', code: 'function foo() {}\n  const bar = 2;' },
  ]);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /foo/);
});

test('import 行を消し export を外す', () => {
  const out = stripModule("import { a, b } from './x.js';\nexport const c = a + b;\nexport function d() {}", 't.js');
  assert.equal(out, 'const c = a + b;\nfunction d() {}');
});

test('複数行の import や export default は止める', () => {
  assert.throws(() => stripModule('import {\n a } from "./x.js";', 't.js'));
  assert.throws(() => stripModule('export default 1;', 't.js'));
});

test('ビルドすると CSP にハッシュが入り unsafe-inline を使わない', () => {
  const html = build({ write: false });
  assert.match(html, /script-src 'sha256-[A-Za-z0-9+/=]+'/);
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /unsafe-inline/);
  assert.match(html, /<link rel="icon" href="data:,">/);
});
