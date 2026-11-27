// P6d T5: md → HTML（ツールが組む）と、Gemini の HTML の仕上げ
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mdToHtml, finishHtml, EXPORT_CSP } from '../src/core/mdhtml.js';
import { htmlToMd } from '../src/core/convert.js';

const fakeSvg = (n) => `<svg class="bfl-svg"><text>${n.split('\n').length} 行</text></svg>`;

test('md → HTML: 見出し・目次・表・箇条書き・フローの図と元の記法・CSP・script なし', () => {
  const md = '<!-- 出典: a.pptx / 変換: 2026-11-27 -->\n# 資料\n\n## 第1章\n\n本文 **太字** と `code`\n\n| 項目 | 値 |\n|---|---|\n| 金額 | 1,000 |\n\n- 一\n  - 二\n\n## 第2章\n\n```flow\ntask A 一\ntask B 二\nA -> B\n```\n';
  const r = mdToHtml(md, { flowSvg: fakeSvg });
  assert.equal(r.flows, 1);
  assert.equal(r.sections, 2);
  assert.ok(r.html.includes(`content="${EXPORT_CSP}"`));
  assert.ok(!/<script/i.test(r.html));
  assert.match(r.html, /<nav class="toc">[\s\S]*href="#sec-1"[\s\S]*href="#sec-2"/);
  assert.match(r.html, /<td>1,000<\/td>/);
  assert.match(r.html, /<strong>太字<\/strong>/);
  assert.match(r.html, /<ul><li>一<ul><li>二<\/li><\/ul><\/li><\/ul>/);
  assert.match(r.html, /<div class="fig"><svg class="bfl-svg">/);
  assert.match(r.html, /<pre class="flow-src" hidden>task A 一\ntask B 二\nA -&gt; B<\/pre>/);
  assert.match(r.html, /<p class="src">出典: a.pptx/);
  // md に戻すと ```flow に戻る
  assert.match(htmlToMd(r.html).body, /```flow\ntask A 一\ntask B 二\nA -> B\n```/);
});

test('md → HTML: 外から来た文字はエスケープし、外部へのリンクは文字だけにする', () => {
  const r = mdToHtml('# <script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[外](https://example.com) [中](#sec-1)\n\n| <b>x</b> |\n|---|\n| "q" |\n');
  assert.ok(!/<script>|<img|<b>/.test(r.html.replace(/<meta[^>]*>/g, '')));
  assert.match(r.html, /&lt;script&gt;/);
  assert.match(r.html, /外（https:\/\/example.com）/);
  assert.match(r.html, /<a href="#sec-1">中<\/a>/);
});

test('Gemini の HTML の仕上げ: script・on 属性・外部 URL・危ないタグを外し、CSP を入れ、pre.flow を図にする', () => {
  const src = '```html\n<!DOCTYPE html><html><head><title>t</title><script src="https://x/a.js"></script><link rel="stylesheet" href="https://x/a.css"><meta http-equiv="refresh" content="0;url=https://x"></head><body onload="go()"><h1>表題</h1><a href="https://example.com">外</a><a href="#c">中</a><img src="https://x/i.png"><iframe src="https://x"></iframe><pre class="flow">task A 見積-&gt;受注\ntask B 次\nA -&gt; B</pre><script>alert(1)</script></body></html>\n```';
  const r = finishHtml(src, { flowSvg: fakeSvg, css: '.bfl-node{fill:#fff}' });
  assert.equal(r.removed.scripts, 2);
  assert.equal(r.removed.handlers, 1);
  assert.ok(r.removed.urls >= 2);
  assert.ok(r.removed.others >= 3);
  assert.equal(r.flows, 1);
  assert.ok(!/<script|onload=|https:\/\/x|<iframe|<link|```/i.test(r.html));
  assert.match(r.html, /<head>\n<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy"/);
  assert.match(r.html, /<a href="#">外<\/a>/);
  assert.match(r.html, /<a href="#c">中<\/a>/);
  assert.match(r.html, /<div class="fig"><svg class="bfl-svg"><text>3 行<\/text><\/svg><\/div><pre class="flow-src" hidden>task A 見積-&gt;受注/);
  // head も html も無い断片でも、1 枚の HTML に包む
  assert.match(finishHtml('<p>だけ</p>').html, /^<!DOCTYPE html>[\s\S]*<meta http-equiv="Content-Security-Policy"[\s\S]*<p>だけ<\/p>/);
});
