import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripModule, findCollisions, build } from '../build.mjs';
import { readFileSync } from 'node:fs';

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
  // アプリ自身の CSP（meta）に unsafe-inline が無いこと。書き出す HTML 用の CSP の文字列（mdhtml.js の EXPORT_CSP。script なし）は対象外
  const csp = (html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/) || [])[1];
  assert.ok(csp, 'CSP の meta がある');
  assert.doesNotMatch(csp, /unsafe-inline/);
  assert.doesNotMatch(html.replace(/const EXPORT_CSP = "[^"]*";/, ''), /unsafe-inline/, 'EXPORT_CSP のほかに unsafe-inline が無い');
  assert.match(html, /<link rel="icon" href="data:,">/);
});

test('写した部品 dash.js は Dash だけを作り、innerHTML・fetch・eval・new Function を使わない', () => {
  const html = build({ write: false });
  const defs = html.match(/root\.Dash\s*=/g) || [];
  assert.equal(defs.length, 1);
  const vendor = readFileSync(new URL('../src/vendor/dash.js', import.meta.url), 'utf8');
  for (const bad of ['innerHTML', 'fetch(', 'eval(', 'new Function', 'insertAdjacentHTML', 'document.write']) assert.equal(vendor.includes(bad), false, bad);
});
