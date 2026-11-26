// P6a T1: 色は :root の変数だけで決め、文字と背景のコントラスト比は 4.5:1 以上にする
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const rootStart = css.indexOf(':root {');
const rootEnd = css.indexOf('}', rootStart) + 1;
const rootBlock = css.slice(rootStart, rootEnd);
const vars = Object.fromEntries([...rootBlock.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,6})\s*;/g)].map((m) => [m[1], m[2]]));

function hex(v) {
  const c = v.startsWith('--') ? vars[v.slice(2)] : v;
  assert.ok(c, `色 ${v} が :root にありません`);
  const h = c.slice(1);
  const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
}
function lum(v) {
  const [r, g, b] = hex(v).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const PAIRS = [
  // 本文
  ['--ink', '--panel'], ['--ink', '--bg'], ['--ink-2', '--panel'], ['--ink-2', '--bg'], ['--ink-2', '--surface'],
  // 色の文字
  ['--accent', '--panel'], ['--high', '--panel'], ['--mid', '--panel'], ['--ok', '--panel'], ['--low', '--panel'], ['--side-customer', '--panel'],
  // 上のバー
  ['--head-text', '--accent-strong'], ['#fff', '--accent-strong'], ['--accent', '#fff'], ['--accent', '--accent-soft'],
  // バッジ
  ['--high', '--high-soft'], ['--mid', '--mid-soft'], ['--ok', '--ok-soft'], ['--low', '--low-soft'], ['--accent', '--accent-soft'],
  // リスクのヒートマップ（P7a）
  ['--ink', '--heat-1'], ['--ink', '--heat-2'], ['--ink', '--heat-3'], ['--ink', '--heat-4'],
  // 業務フロー・判断の図（P7c）: 区分名は白地とレーンの帯、分岐のラベルは白地、箱の文字は箱の面、印の記号は白
  ['--role-ai', '#fff'], ['--role-rule', '#fff'], ['--role-human', '#fff'], ['--role-ext', '#fff'],
  ['--role-ai', '--lane-a'], ['--role-rule', '--lane-a'], ['--role-human', '--lane-a'], ['--role-ext', '--lane-a'],
  ['--fl-branch-yes', '#fff'], ['--fl-branch-no', '#fff'], ['--fl-branch-yes', '--lane-a'], ['--fl-branch-no', '--lane-a'],
  ['--ink', '--lane-a'], ['--ink', '--lane-b'], ['--ink', '--lane-head'], ['--ink', '--mid-soft'], ['--ink-2', '--lane-a'],
  ['#fff', '--ok'], ['#fff', '--mid'], ['#fff', '--high'], ['--mid', '--lane-a'],
  // dashboard スキルの部品（dash.css・dash.js）が文字に使う組み合わせ
  ['--d-text', '--d-card'], ['--d-label', '--d-card'], ['--d-label', '--d-bg'], ['--d-s1', '--d-card'], ['--d-neg-text', '--d-card'], ['--d-s1', '--d-hl'],
];

for (const [fg, bg] of PAIRS) {
  test(`コントラスト ${fg} / ${bg} が 4.5 以上`, () => {
    const r = ratio(fg, bg);
    assert.ok(r >= 4.5, `${r.toFixed(2)} しかありません`);
  });
}

test(':root の外に #fff 以外の直書きの色が無い', () => {
  const rest = css.slice(0, rootStart) + css.slice(rootEnd);
  const found = [...rest.matchAll(/#[0-9a-fA-F]{3,6}\b/g)].map((m) => m[0]).filter((c) => c.toLowerCase() !== '#fff');
  assert.deepEqual(found, []);
});

test('写した dash.css にも #fff 以外の直書きの色が無い', () => {
  const dash = readFileSync(new URL('../src/vendor/dash.css', import.meta.url), 'utf8');
  assert.equal(dash.includes(':root'), true);   // 移したことを書いたコメントだけ
  assert.equal(/:root\s*\{/.test(dash), false);
  const found = [...dash.matchAll(/#[0-9a-fA-F]{3,6}\b/g)].map((m) => m[0]).filter((c) => c.toLowerCase() !== '#fff');
  assert.deepEqual(found, []);
});

test('配色は gemini-kit（dash.css）の値', () => {
  assert.equal(vars.accent, '#0017C1');
  assert.equal(vars['accent-strong'], '#000060');
  assert.equal(vars.gold, '#A58000');
  assert.equal(vars.bg, '#F8F8FB');
  assert.match(rootBlock, /--font: Arial, "メイリオ"/);
});
