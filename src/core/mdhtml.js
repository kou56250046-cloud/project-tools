// md → 人が読む 1 枚の HTML（ツールが組む）と、Gemini が書いた HTML の仕上げ（P6d）
// どちらも文字列を作ってダウンロードするだけ（画面の中には入れない）。外から来た文字はすべてエスケープする
// フロー記法の図は、呼ぶ側から flowSvg(notation) → SVG の文字列 をもらう（DOM を使うのは画面側）

import { MDBLOCKS } from './mdblocks.js';
import { HTML_STYLE } from './gemini-convert.js';

// 書き出す HTML の CSP: script なし・外部の読み込みなし。書式はこの文書の <style> だけ
export const EXPORT_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";
const mhEsc = (s) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const mhUnesc = (s) => String(s).replace(/&(lt|gt|amp|quot|#39|apos|#x[0-9a-f]+|#\d+);/gi, (m, k) => {
  const l = k.toLowerCase();
  if (l === 'lt') return '<'; if (l === 'gt') return '>'; if (l === 'amp') return '&'; if (l === 'quot') return '"'; if (l === '#39' || l === 'apos') return "'";
  const n = l[1] === 'x' ? parseInt(l.slice(2), 16) : +l.slice(1);
  return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
});
// 行内: エスケープしてから **太字**・`コード`・[文字](ページ内か相対のリンク) だけを書式にする
function mhInline(s) {
  let t = mhEsc(s);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, href) => (/^(#|\.{0,2}\/?[\w%.-][\w%./#-]*$)/.test(href) && !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('//') ? `<a href="${href}">${label}</a>` : `${label}（${href}）`));
  return t.replace(/ {2}\n|\n/g, '<br>');
}
const FLOW_CSS_NOTE = '/* 図の書式 */';

function mhHead(title, css) {
  return ['<!DOCTYPE html>', '<html lang="ja">', '<head>', '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${EXPORT_CSP}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">', '<meta name="referrer" content="no-referrer">',
    `<title>${mhEsc(title)}</title>`,
    `<style>${HTML_STYLE}nav.toc{background:#F8F8FB;border:1px solid #ccc;padding:8px 16px}nav.toc ol{margin:4px 0}.fig{overflow-x:auto;border:1px solid #ccc;padding:8px;margin:8px 0}.fig svg{max-width:100%;height:auto}.src{color:#626264;font-size:12px}${css ? FLOW_CSS_NOTE + css : ''}</style>`,
    '</head>'].join('\n');
}

// md → HTML。opts: { title, flowSvg(notation) → SVG の文字列（無い・空ならフロー記法をそのまま見せる）, css: 図の書式 }
export function mdToHtml(md, opts = {}) {
  const blocks = MDBLOCKS.parse(String(md || ''));
  const body = [];
  const toc = [];
  let sec = 0, flows = 0;
  const list = (items, ordered) => `<${ordered ? 'ol' : 'ul'}>${items.map((it) => `<li>${it.check == null ? '' : it.check ? '☑ ' : '☐ '}${mhInline(it.text)}${it.children && it.children.length ? list(it.children, it.children[0].ordered) : ''}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`;
  for (const b of blocks) {
    if (b.type === 'heading') {
      const lv = Math.min(4, Math.max(1, b.level));
      if (lv === 2) { sec++; toc.push({ id: `sec-${sec}`, text: b.text }); body.push(`<h2 id="sec-${sec}">${mhInline(b.text)}</h2>`); }
      else body.push(`<h${lv}>${mhInline(b.text)}</h${lv}>`);
    } else if (b.type === 'para') {
      // 出典・ページの印（<!-- … -->）は小さな注記にする
      const m = /^<!--\s*([\s\S]*?)\s*-->$/.exec(b.text.trim());
      body.push(m ? `<p class="src">${mhEsc(m[1])}</p>` : `<p>${mhInline(b.text)}</p>`);
    } else if (b.type === 'table') {
      body.push(`<table><thead><tr>${b.head.map((c) => `<th>${mhInline(c.replace(/<br>/g, '\n'))}</th>`).join('')}</tr></thead><tbody>${b.rows.map((r) => `<tr>${b.head.map((_, i) => `<td>${mhInline(String(r[i] || '').replace(/<br>/g, '\n'))}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    } else if (b.type === 'list') body.push(list(b.items, b.items[0] && b.items[0].ordered));
    else if (b.type === 'quote') body.push(`<blockquote>${mhInline(b.text)}</blockquote>`);
    else if (b.type === 'hr') body.push('<hr>');
    else if (b.type === 'code') {
      if (b.lang === 'flow') {
        flows++;
        const svg = opts.flowSvg ? opts.flowSvg(b.text) : '';
        body.push(svg ? `<div class="fig">${svg}</div>` : '');
        // 元のフロー記法を残す（このツールで md に戻すと ```flow に戻る）
        body.push(`<pre class="flow-src"${svg ? ' hidden' : ''}>${mhEsc(b.text)}</pre>`);
      } else body.push(`<pre${b.lang ? ` class="${mhEsc(b.lang)}"` : ''}>${mhEsc(b.text)}</pre>`);
    }
  }
  const title = opts.title || (blocks.find((b) => b.type === 'heading') || {}).text || '資料';
  const nav = toc.length >= 2 ? `<nav class="toc"><strong>目次</strong><ol>${toc.map((t) => `<li><a href="#${t.id}">${mhInline(t.text)}</a></li>`).join('')}</ol></nav>` : '';
  const html = [mhHead(title, opts.css || ''), '<body>', nav, ...body.filter(Boolean), '</body>', '</html>', ''].join('\n');
  return { html, flows, sections: sec };
}

// Gemini が書いた HTML の仕上げ: script・イベント属性・外部への URL・危ないタグを外し、CSP を入れ、<pre class="flow"> を図にする
// 戻り値 { html, removed: { scripts, handlers, urls, others }, flows }
export function finishHtml(src, opts = {}) {
  let h = String(src || '').replace(/^﻿/, '');
  // ```html の囲みが残っていれば外す
  h = h.replace(/^\s*```[\w-]*\s*\n/, '').replace(/\n\s*```\s*$/, '');
  const removed = { scripts: 0, handlers: 0, urls: 0, others: 0 };
  h = h.replace(/<script\b[\s\S]*?(?:<\/script\s*>|$)/gi, () => { removed.scripts++; return ''; });
  h = h.replace(/<\/?(?:iframe|object|embed|link|base|form|frame|frameset|applet)\b[^>]*>/gi, () => { removed.others++; return ''; });
  h = h.replace(/<meta\b[^>]*http-equiv[^>]*>/gi, () => { removed.others++; return ''; });
  // タグの中の属性だけを直す
  h = h.replace(/<([a-zA-Z][\w-]*)(\s[^<>]*?)?(\/?)>/g, (m, tag, attrs, slash) => {
    if (!attrs) return m;
    let a = attrs.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, () => { removed.handlers++; return ''; });
    a = a.replace(/\s+(href|src|srcset|action|formaction|xlink:href|poster|background)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi, (mm, name, _v, d1, d2, d3) => {
      const v = (d1 ?? d2 ?? d3 ?? '').trim();
      const external = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(v) && !/^#/.test(v);
      if (!external) return mm;
      removed.urls++;
      return name.toLowerCase() === 'href' ? ' href="#"' : '';
    });
    return `<${tag}${a}${slash}>`;
  });
  // フロー記法を図に（元の記法は flow-src として残す）
  let flows = 0;
  h = h.replace(/<pre\b[^>]*class\s*=\s*["'][^"']*\bflow\b[^"']*["'][^>]*>([\s\S]*?)<\/pre\s*>/gi, (m, inner) => {
    const notation = mhUnesc(inner.replace(/<[^>]*>/g, ''));
    const svg = opts.flowSvg ? opts.flowSvg(notation) : '';
    flows++;
    return `${svg ? `<div class="fig">${svg}</div>` : ''}<pre class="flow-src"${svg ? ' hidden' : ''}>${mhEsc(notation)}</pre>`;
  });
  // CSP と図の書式を head の先頭に入れる（head が無ければ作る）
  const inject = `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${EXPORT_CSP}">\n<meta name="referrer" content="no-referrer">${opts.css ? `\n<style>.fig{overflow-x:auto;margin:8px 0}.fig svg{max-width:100%;height:auto}${opts.css}</style>` : ''}`;
  if (/<head\b[^>]*>/i.test(h)) h = h.replace(/<head\b[^>]*>/i, (m) => `${m}\n${inject}`);
  else if (/<html\b[^>]*>/i.test(h)) h = h.replace(/<html\b[^>]*>/i, (m) => `${m}\n<head>\n${inject}\n</head>`);
  else h = `<!DOCTYPE html>\n<html lang="ja">\n<head>\n${inject}\n</head>\n<body>\n${h}\n</body>\n</html>\n`;
  return { html: h, removed, flows };
}
