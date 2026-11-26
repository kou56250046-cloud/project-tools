// 写した部品: ~/.claude/skills/dashboard/assets/dash.js（2026-11-26 に写す。gemini-kit も同じ部品を使う）
// 変えたところ: なし（この 2 行の頭書きだけ）。直すときはスキルの側を直して写し直す
/* dashboard スキルの部品。依存ゼロ。file:// でも動く。
   デジタル庁「ダッシュボードデザインの実践ガイドブック」の原則を既定値にしている。
   - 棒の原点は常に 0。折れ線で 0 を外すと注記が付く
   - 系列は色に加えてマーカーの形・線種・塗りの模様で区別する
   - 系列名はできるだけ線の端に直接書く。凡例はグラフに隣接させ、順番を揃える
   - どのグラフにも「表で見る」と CSV、読み上げ用の要約が付く
   使い方は references/components.md。 */
(function (root) {
  'use strict';

  const SVGNS = 'http://www.w3.org/2000/svg';
  const SHAPES = ['circle', 'square', 'triangle', 'diamond'];
  const DASHES = [null, '7 4', '2 3', '10 3 2 3'];
  const FALLBACK = {
    '--d-s1': '#0017C1', '--d-s2': '#000060', '--d-s3': '#3460FB', '--d-s4': '#A58000',
    '--d-ref': '#666666', '--d-mute': '#999999', '--d-pos': '#3460FB', '--d-neg': '#FE3939',
    '--d-neg-text': '#CE0000', '--d-card': '#FFFFFF', '--d-text': '#000000', '--d-label': '#626264',
    '--d-line': '#CCCCCC', '--d-link-flow': '#C5D7FB', '--d-hl': '#E8F1FE',
  };
  const ALT_ROWS = 300;
  let seq = 0;

  // ---------------------------------------------------------------- 基本

  function setAttrs(n, attrs) {
    if (!attrs) return;
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'text') n.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : String(v));
    }
  }
  function append(n, kids) {
    for (const k of kids.flat(Infinity)) {
      if (k == null || k === false) continue;
      n.appendChild(typeof k === 'object' ? k : document.createTextNode(String(k)));
    }
  }
  function el(tag, attrs, ...kids) { const n = document.createElement(tag); setAttrs(n, attrs); append(n, kids); return n; }
  function sv(tag, attrs, ...kids) { const n = document.createElementNS(SVGNS, tag); setAttrs(n, attrs); append(n, kids); return n; }

  function cssVar(name) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || FALLBACK[name];
  }
  function palette() { return ['--d-s1', '--d-s2', '--d-s3', '--d-s4'].map(cssVar); }

  function lum(color) {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color).trim());
    if (!m) return null;
    const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
    const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  /** WCAG のコントラスト比。色が #RRGGBB で無ければ null */
  function contrast(a, b) {
    const x = lum(a), y = lum(b);
    if (x == null || y == null) return null;
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  /** 文字として読める色。背景に 4.5:1 届かない系列色は本文色に替える */
  function textColor(color) {
    const r = contrast(color, cssVar('--d-card'));
    return r == null || r >= 4.5 ? color : cssVar('--d-text');
  }

  function fmt(v, digits) {
    if (v == null || Number.isNaN(v)) return '—';
    const d = digits != null ? digits : (Number.isInteger(v) || Math.abs(v) >= 100 ? 0 : 1);
    return new Intl.NumberFormat('ja-JP', { maximumFractionDigits: d, minimumFractionDigits: digits != null ? digits : 0 }).format(v);
  }
  function withUnit(v, unit, digits) { const s = fmt(v, digits); return unit && s !== '—' ? s + unit : s; }
  function pct(v, digits = 1) { return v == null || !isFinite(v) ? '—' : fmt(v * 100, digits) + '%'; }

  /** 文字幅の見積もり。全角は size、半角は 0.6 倍 */
  function textW(str, size = 12) {
    let w = 0;
    for (const ch of String(str)) w += ch.codePointAt(0) > 0x2E7F ? size : size * 0.6;
    return w;
  }
  function clip(str, maxW, size = 12) {
    str = String(str);
    if (textW(str, size) <= maxW) return str;
    let out = '';
    for (const ch of str) { if (textW(out + ch + '…', size) > maxW) break; out += ch; }
    return out + '…';
  }
  function wrap(str, maxW, size = 12, maxLines = 3) {
    const lines = []; let cur = '';
    for (const ch of String(str)) {
      if (ch === '\n') { lines.push(cur); cur = ''; continue; }
      if (textW(cur + ch, size) > maxW && cur) { lines.push(cur); cur = ch; } else cur += ch;
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = clip(lines[maxLines - 1] + '……', maxW, size); }
    return lines.length ? lines : [''];
  }

  function extent(arr) {
    let lo = Infinity, hi = -Infinity;
    for (const v of arr) { if (v == null || Number.isNaN(v)) continue; if (v < lo) lo = v; if (v > hi) hi = v; }
    return [lo, hi];
  }

  function niceStep(span, n) {
    if (!(span > 0)) return 1;
    const raw = span / n, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  }
  /** 目盛り。1・2・2.5・5 の倍数に丸める。zero なら必ず 0 を含む */
  function scale(min, max, n = 4, zero = true) {
    let lo = zero ? Math.min(0, min) : min, hi = zero ? Math.max(0, max) : max;
    if (!isFinite(lo) || !isFinite(hi)) { lo = 0; hi = 1; }
    if (lo === hi) { const d = Math.abs(lo) * 0.1 || 1; lo -= zero && lo === 0 ? 0 : d; hi += d; }
    const step = niceStep(hi - lo, n);
    lo = Math.floor(lo / step + 1e-9) * step;
    hi = Math.ceil(hi / step - 1e-9) * step;
    if (hi <= lo) hi = lo + step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
    const digits = Math.min(3, (String(+step.toFixed(10)).split('.')[1] || '').length);
    return { lo, hi, step, ticks, digits };
  }

  /** Largest-Triangle-Three-Buckets。形を保ったまま threshold 点に間引き、残す添字を返す */
  function lttb(values, threshold) {
    const n = values.length;
    if (threshold >= n || threshold < 3) return values.map((_, i) => i);
    const idx = [0], every = (n - 2) / (threshold - 2);
    let a = 0;
    for (let i = 0; i < threshold - 2; i++) {
      const s = Math.floor((i + 1) * every) + 1, e = Math.min(Math.floor((i + 2) * every) + 1, n);
      let ax = 0, ay = 0;
      for (let j = s; j < e; j++) { ax += j; ay += values[j]; }
      const len = e - s || 1; ax /= len; ay /= len;
      const rs = Math.floor(i * every) + 1, re = Math.floor((i + 1) * every) + 1;
      let best = -1, pick = rs;
      for (let j = rs; j < re; j++) {
        const area = Math.abs((a - ax) * (values[j] - values[a]) - (a - j) * (ay - values[a]));
        if (area > best) { best = area; pick = j; }
      }
      idx.push(pick); a = pick;
    }
    idx.push(n - 1);
    return idx;
  }

  function resolveHost(host) {
    const h = typeof host === 'string' ? document.querySelector(host) : host;
    if (!h) throw new Error('Dash: 描画先が見つかりません: ' + host);
    return h;
  }

  // ---------------------------------------------------------------- 枠

  /** タイトル・単位・図・凡例・注記・代替の表を持つ figure を作る */
  function frame(host, spec, kind) {
    host = resolveHost(host);
    if (host._dashRO) host._dashRO.disconnect();
    host.textContent = '';
    if (!spec.title) console.warn(`Dash.${kind}: title がありません。中身とデータ種別を書いてください（例：出荷台数（月次推移））`);
    const id = 'd-t' + (++seq);
    const fig = el('figure', { class: 'd-fig', 'aria-labelledby': id });
    const head = el(spec.level ? 'h' + spec.level : 'h3', { class: 'd-title', id, text: spec.title || '' });
    const sub = [spec.sub, spec.unit ? `単位：${spec.unit}` : null].filter(Boolean).join('　');
    const top = el('div'), plot = el('div', { class: 'd-plot' }), bottom = el('div');
    const tip = el('div', { class: 'd-tip', 'aria-hidden': 'true' });
    const meta = el('p', { class: 'd-meta' }), alt = el('div');
    plot.append(tip);
    append(fig, [head, sub ? el('p', { class: 'd-sub', text: sub }) : null, top, plot, bottom, meta, alt]);
    host.append(fig);
    const notes = new Map();
    const base = [spec.asOf ? `${spec.asOf}時点` : null, spec.source ? `出典：${spec.source}` : null, spec.note || null];
    const f = {
      host, fig, plot, tip, top, bottom, alt, title: spec.title || '',
      /** 注記を key ごとに足す・消す（再描画で重ならないように） */
      note(key, text) {
        if (text) notes.set(key, text); else notes.delete(key);
        meta.replaceChildren(...[...base, ...notes.values()].filter(Boolean).map((t) => el('span', { text: t })));
        meta.hidden = !meta.childNodes.length;
      },
    };
    f.note('_', null);
    return f;
  }

  function mount(f, node) {
    f.plot.querySelectorAll(':scope > :not(.d-tip)').forEach((n) => n.remove());
    f.plot.append(node);
  }

  /** 幅が変わったら描き直す */
  function responsive(f, draw) {
    let last = -1;
    const run = () => {
      const w = Math.floor(f.plot.clientWidth);
      if (w <= 0 || w === last) return;
      last = w; draw(w);
    };
    run();
    if (last < 0) draw(600);
    if ('ResizeObserver' in root) {
      let raf = 0;
      const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(run); });
      ro.observe(f.plot);
      f.host._dashRO = ro;
    }
  }

  function svgRoot(f, w, h, summary) {
    return sv('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}`, role: 'img', 'aria-label': `${f.title}。${summary}` });
  }

  function showTip(f, x, y, text) {
    const w = f.plot.clientWidth || 600;
    f.tip.textContent = text;
    const half = Math.min(f.tip.offsetWidth / 2 || 60, w / 2);
    f.tip.style.left = Math.max(half, Math.min(w - half, x)) + 'px';
    f.tip.style.top = Math.max(0, y) + 'px';
    f.tip.classList.add('is-on');
  }
  function hideTip(f) { f.tip.classList.remove('is-on'); }
  /** 要素にホバー・フォーカスで値を出す */
  function tipOn(f, node, text, focusable) {
    const at = () => {
      const p = f.plot.getBoundingClientRect(), b = node.getBoundingClientRect();
      showTip(f, b.left - p.left + b.width / 2, b.top - p.top, typeof text === 'function' ? text() : text);
    };
    node.addEventListener('mouseenter', at);
    node.addEventListener('mouseleave', () => hideTip(f));
    if (focusable) {
      node.setAttribute('tabindex', '0');
      node.setAttribute('aria-label', typeof text === 'function' ? text() : text);
      node.classList.add('d-pt');
      node.addEventListener('focus', at);
      node.addEventListener('blur', () => hideTip(f));
    }
  }

  function csvLink(headers, rows, name) {
    const esc = (v) => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const text = '﻿' + [headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
    return el('a', { class: 'd-csv', href: URL.createObjectURL(new Blob([text], { type: 'text/csv' })), download: (name || 'data') + '.csv', text: 'CSV をダウンロード' });
  }

  /** 「表で見る」。rows は生の値。数値は表示時に整形し、CSV には生の値を書く */
  function altTable(f, headers, rows, opt = {}) {
    const shown = rows.slice(0, ALT_ROWS);
    const cell = (v, i) => (typeof v === 'number' ? fmt(v, opt.digits) : v == null ? '—' : String(v));
    const isNum = headers.map((_, i) => i > 0 && rows.some((r) => typeof r[i] === 'number'));
    const table = el('table', { class: 'd-table' },
      el('thead', null, el('tr', null, headers.map((h, i) => el('th', { scope: 'col', class: isNum[i] ? 'd-r' : null, text: h })))),
      el('tbody', null, shown.map((r) => el('tr', null, r.map((v, i) => (i === 0
        ? el('th', { scope: 'row', text: cell(v, i) })
        : el('td', { class: isNum[i] ? 'd-r' : null, text: cell(v, i) })))))));
    f.alt.replaceChildren(el('details', { class: 'd-alt' },
      el('summary', { text: '表で見る' }),
      rows.length > ALT_ROWS ? el('p', { class: 'd-sub', text: `先頭 ${ALT_ROWS} 行を表示（全 ${fmt(rows.length)} 行は CSV）` }) : null,
      el('div', { class: 'd-table-wrap' }, table),
      csvLink(headers, rows, opt.name || f.title)));
  }

  function empty(f, spec) {
    mount(f, el('p', { class: 'd-empty', text: spec.empty || 'データがありません' }));
    return { summary: 'データがありません' };
  }

  function marker(shape, x, y, r, fill, extra) {
    const a = Object.assign({ fill }, extra);
    switch (shape) {
      case 'square': return sv('rect', Object.assign({ x: x - r * 0.9, y: y - r * 0.9, width: r * 1.8, height: r * 1.8 }, a));
      case 'triangle': return sv('path', Object.assign({ d: `M${x},${y - r * 1.15}L${x + r * 1.05},${y + r * 0.75}L${x - r * 1.05},${y + r * 0.75}Z` }, a));
      case 'diamond': return sv('path', Object.assign({ d: `M${x},${y - r * 1.25}L${x + r * 1.25},${y}L${x},${y + r * 1.25}L${x - r * 1.25},${y}Z` }, a));
      default: return sv('circle', Object.assign({ cx: x, cy: y, r }, a));
    }
  }

  /** 系列 2 つ目以降は塗りに模様を付ける（色だけで区別しない） */
  function patterner(defs) {
    const cache = new Map();
    return (k, color) => {
      const kind = k % 4;
      if (kind === 0) return color;
      const key = kind + color;
      if (!cache.has(key)) {
        const id = 'd-p' + (++seq);
        const p = sv('pattern', { id, patternUnits: 'userSpaceOnUse', width: 6, height: 6, patternTransform: kind === 1 ? 'rotate(45)' : null });
        p.append(sv('rect', { width: 6, height: 6, fill: color }));
        if (kind === 1) p.append(sv('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: '#fff', 'stroke-width': 1.6 }));
        else if (kind === 2) p.append(sv('circle', { cx: 3, cy: 3, r: 1.2, fill: '#fff' }));
        else p.append(sv('path', { d: 'M0 3H6M3 0V6', stroke: '#fff', 'stroke-width': 1.1 }));
        defs.append(p);
        cache.set(key, `url(#${id})`);
      }
      return cache.get(key);
    };
  }

  /** 直接ラベルの重なりを解く。items: [{y}] を y 順に最小間隔 gap で押し広げる */
  function spread(items, gap, lo, hi) {
    const s = items.slice().sort((a, b) => a.y - b.y);
    for (let i = 1; i < s.length; i++) if (s[i].y - s[i - 1].y < gap) s[i].y = s[i - 1].y + gap;
    const over = s.length ? s[s.length - 1].y - hi : 0;
    if (over > 0) for (const it of s) it.y -= over;
    for (let i = 0; i < s.length; i++) if (s[i].y < lo + i * gap) s[i].y = lo + i * gap;
    return items;
  }

  function legend(items, list) {
    return el('ul', { class: 'd-legend' + (list ? ' d-legend--list' : '') }, items.map((it) => el('li', null,
      el('span', { class: 'd-legend-key' }, it.swatch, el('span', { text: it.label })),
      it.value != null ? el('span', { class: 'd-num', text: it.value }) : null)));
  }
  function swatchRect(fill) { const s = sv('svg', { width: 12, height: 12, 'aria-hidden': 'true' }); s.append(sv('rect', { width: 12, height: 12, fill, rx: 2 })); return s; }
  function swatchLine(color, shape, dash) {
    const s = sv('svg', { width: 24, height: 12, 'aria-hidden': 'true' });
    s.append(sv('line', { x1: 0, y1: 6, x2: 24, y2: 6, stroke: color, 'stroke-width': 2, 'stroke-dasharray': dash }));
    if (shape) s.append(marker(shape, 12, 6, 3.5, color, { stroke: '#fff', 'stroke-width': 1 }));
    return s;
  }

  function yAxis(g, sc, x0, x1, yAt) {
    for (const t of sc.ticks) {
      const y = yAt(t);
      g.append(sv('line', { x1: x0, x2: x1, y1: y, y2: y, class: t === 0 ? 'd-zero' : 'd-gridline' }));
      g.append(sv('text', { x: x0 - 6, y, 'text-anchor': 'end', 'dominant-baseline': 'middle', class: 'd-tick', text: fmt(t, sc.digits) }));
    }
  }

  function xLabels(g, labels, xAt, y, pw) {
    const n = labels.length;
    if (!n) return;
    const maxW = Math.max(...labels.map((l) => textW(l))) + 12;
    const gapPx = n > 1 ? pw / (n - 1) : pw;
    const step = Math.max(1, Math.ceil(maxW / gapPx));
    const show = [];
    for (let i = 0; i < n; i += step) show.push(i);
    const lastShown = show[show.length - 1];
    if (lastShown !== n - 1) { if ((n - 1 - lastShown) * gapPx >= maxW) show.push(n - 1); else show[show.length - 1] = n - 1; }
    for (const i of show) g.append(sv('text', { x: xAt(i), y, 'text-anchor': 'middle', class: 'd-tick', text: labels[i] }));
  }

  /** 横軸方向に動く読み取り線。マウスと左右キーで値を出す */
  function scrubber(f, svg, box, n, xAt, textAt) {
    const guide = sv('line', { y1: box.t, y2: box.t + box.h, class: 'd-guide', visibility: 'hidden' });
    const hit = sv('rect', { x: box.l, y: box.t, width: box.w, height: box.h, fill: 'transparent', tabindex: 0, class: 'd-pt',
      'aria-label': '値を読む。左右キーで移動' });
    let cur = n - 1;
    const show = (i) => {
      cur = Math.max(0, Math.min(n - 1, i));
      const x = xAt(cur);
      guide.setAttribute('x1', x); guide.setAttribute('x2', x); guide.setAttribute('visibility', 'visible');
      const t = textAt(cur);
      showTip(f, x, box.t, t);
      hit.setAttribute('aria-label', t);
    };
    const near = (px) => (n === 1 ? 0 : Math.round(((px - box.l) / box.w) * (n - 1)));
    hit.addEventListener('mousemove', (e) => { const r = svg.getBoundingClientRect(); show(near(e.clientX - r.left)); });
    hit.addEventListener('mouseleave', () => { guide.setAttribute('visibility', 'hidden'); hideTip(f); });
    hit.addEventListener('focus', () => show(cur));
    hit.addEventListener('blur', () => { guide.setAttribute('visibility', 'hidden'); hideTip(f); });
    hit.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? Math.max(1, Math.round(n / 10)) : 1;
      if (e.key === 'ArrowRight') show(cur + step);
      else if (e.key === 'ArrowLeft') show(cur - step);
      else if (e.key === 'Home') show(0);
      else if (e.key === 'End') show(n - 1);
      else return;
      e.preventDefault();
    });
    svg.append(guide, hit);
  }

  // ---------------------------------------------------------------- KPI

  /**
   * 指標。比較対象（目標・前期比など）を必ず添える。
   * { title, value, unit, digits, compare:[{label, delta, unit, digits, better:'up'|'down'|'none'}], spark:[…], asOf, source, note }
   */
  function kpi(host, spec) {
    const f = frame(host, Object.assign({}, spec, { unit: null }), 'kpi');
    f.plot.classList.add('d-plot--kpi');
    const cmp = spec.compare || [];
    if (!cmp.length) console.warn(`Dash.kpi「${spec.title}」: 比較対象がありません。目標値・前期比・平均のどれかを compare に入れてください`);
    const words = [];
    const list = el('ul', { class: 'd-kpi-compare' }, cmp.map((c) => {
      const d = +c.delta;
      const dir = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
      const better = c.better || 'up';
      const good = dir === 'flat' || better === 'none' ? null : (dir === better);
      const cls = good == null ? 'd-flat' : good ? 'd-good' : 'd-bad';
      const sym = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '→';
      const txt = `${sym} ${d > 0 ? '+' : ''}${withUnit(d, c.unit, c.digits)}`;
      const judge = good == null ? '' : good ? '（良化）' : '（悪化）';
      words.push(`${c.label} ${txt}${judge}`);
      return el('li', null, el('span', { class: 'd-k', text: c.label }), el('span', { class: cls, text: txt }), el('span', { class: 'd-sr', text: judge }));
    }));
    const value = el('p', { class: 'd-kpi-value' }, fmt(spec.value, spec.digits), spec.unit ? el('small', { text: spec.unit }) : null);
    const nodes = [value, list];
    if (Array.isArray(spec.spark) && spec.spark.length > 1) {
      const w = 160, h = 36, [lo, hi] = extent(spec.spark), sc = scale(lo, hi, 2, spec.sparkZero !== false);
      const xs = (i) => 2 + (i / (spec.spark.length - 1)) * (w - 8), ys = (v) => h - 3 - ((v - sc.lo) / (sc.hi - sc.lo)) * (h - 6);
      let d = '', pen = false;
      spec.spark.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + xs(i) + ',' + ys(v); pen = true; });
      const s = sv('svg', { width: w, height: h, class: 'd-spark', 'aria-hidden': 'true' });
      const last = spec.spark.length - 1;
      s.append(sv('path', { d, fill: 'none', stroke: cssVar('--d-s1'), 'stroke-width': 1.5 }));
      if (spec.spark[last] != null) s.append(sv('circle', { cx: xs(last), cy: ys(spec.spark[last]), r: 2.5, fill: cssVar('--d-s1') }));
      nodes.push(s);
    }
    mount(f, el('div', null, nodes));
    const summary = `${withUnit(spec.value, spec.unit, spec.digits)}。${words.join('、')}`;
    value.setAttribute('aria-label', `${spec.title} ${withUnit(spec.value, spec.unit, spec.digits)}`);
    return { summary: `${spec.title}は${summary}` };
  }

  // ---------------------------------------------------------------- 折れ線

  /**
   * 時間変化。横軸は時間に限る。
   * { title, unit, x:[…], series:[{name, values, role:'target'|'reference', focus}], zero, height, digits, legend }
   */
  function line(host, spec) {
    const f = frame(host, spec, 'line');
    const X = (spec.x || []).map(String), n = X.length;
    const series = (spec.series || []).map((s) => Object.assign({}, s, { values: (s.values || []).map((v) => (v == null || v === '' ? null : +v)) }));
    if (!n || !series.length) return empty(f, spec);
    const zero = spec.zero !== false;
    // domain:[下限, 上限] で軸の範囲を広げる。small multiples で全図の軸を揃えるときに使う
    const [mn, mx] = extent(series.flatMap((s) => s.values).concat(spec.domain || []));
    const sc = scale(mn, mx, 4, zero);
    f.note('zero', !zero && sc.lo > 0 ? `縦軸は ${fmt(sc.lo, sc.digits)} から始まっています` : null);
    const pal = palette(), focusAny = series.some((s) => s.focus);
    let k = 0;
    for (const s of series) {
      if (s.role === 'target' || s.role === 'reference') {
        s.color = cssVar('--d-ref'); s.dash = s.role === 'target' ? '6 4' : '2 3'; s.shape = null; s.width = 1.5;
      } else {
        s.color = focusAny && !s.focus ? cssVar('--d-mute') : pal[k % pal.length];
        s.shape = SHAPES[k % SHAPES.length]; s.k = k; s.width = s.focus ? 3 : 2.25; k++;
      }
      s.last = -1;
      for (let i = n - 1; i >= 0; i--) if (s.values[i] != null) { s.last = i; break; }
      const muted = s.color === cssVar('--d-mute');
      s.label = (s.name || '') + (muted && s.last >= 0 ? ` ${withUnit(s.values[s.last], spec.unit, spec.digits)}` : '');
    }
    const hasNull = series.some((s) => s.values.some((v) => v == null));

    const parts = series.filter((s) => s.last >= 0).map((s) => {
      const [, hi] = extent(s.values);
      const at = s.values.indexOf(hi);
      return `${s.name}は最新 ${withUnit(s.values[s.last], spec.unit, spec.digits)}（${X[s.last]}）、最大 ${withUnit(hi, spec.unit, spec.digits)}（${X[at]}）`;
    });
    const summary = `折れ線グラフ。${X[0]}〜${X[n - 1]}。${parts.join('。')}`;

    responsive(f, (w) => {
      const H = spec.height || 240;
      const tickW = Math.max(...sc.ticks.map((t) => textW(fmt(t, sc.digits))));
      const labW = Math.max(...series.map((s) => textW(s.label, 12))) + 12;
      const direct = spec.legend !== true && labW < w * 0.3;
      const m = { l: tickW + 10, r: direct ? labW + 6 : 14, t: 10, b: 26 };
      const pw = Math.max(40, w - m.l - m.r), ph = H - m.t - m.b;
      const xAt = (i) => m.l + (n === 1 ? pw / 2 : (i / (n - 1)) * pw);
      const yAt = (v) => m.t + ph - ((v - sc.lo) / (sc.hi - sc.lo)) * ph;

      let idx = X.map((_, i) => i);
      const maxPts = Math.max(60, Math.floor(pw * 2));
      const thin = n > maxPts && !hasNull;
      if (thin) {
        const keep = new Set();
        for (const s of series) for (const j of lttb(s.values, maxPts)) keep.add(j);
        idx = [...keep].sort((a, b) => a - b);
      }
      f.note('thin', thin ? `${fmt(n)} 点を形を保って ${fmt(idx.length)} 点に間引いて表示（表と CSV は全点）` : null);
      const sparse = idx.length <= pw / 12;

      const svg = svgRoot(f, w, H, summary);
      const g = sv('g', { class: 'd-axis' });
      yAxis(g, sc, m.l, m.l + pw, yAt);
      xLabels(g, X, xAt, H - 8, pw);
      svg.append(g);

      for (const s of series) {
        let d = '', pen = false;
        for (const i of idx) {
          const v = s.values[i];
          if (v == null) { pen = false; continue; }
          d += (pen ? 'L' : 'M') + xAt(i).toFixed(1) + ',' + yAt(v).toFixed(1);
          pen = true;
        }
        const dash = s.dash || (sparse ? null : DASHES[(s.k || 0) % DASHES.length]);
        svg.append(sv('path', { d, fill: 'none', stroke: s.color, 'stroke-width': s.width, 'stroke-dasharray': dash, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
        if (!s.shape) continue;
        idx.forEach((i, p) => {
          const v = s.values[i];
          if (v == null) return;
          const lone = (p === 0 || s.values[idx[p - 1]] == null) && (p === idx.length - 1 || s.values[idx[p + 1]] == null);
          if (sparse || lone) svg.append(marker(s.shape, xAt(i), yAt(v), s.focus ? 4.5 : 3.8, s.color, { stroke: '#fff', 'stroke-width': 1.5 }));
        });
      }

      if (direct) {
        const labs = series.filter((s) => s.last >= 0).map((s) => ({ s, y: yAt(s.values[s.last]) }));
        spread(labs, 14, m.t + 4, m.t + ph);
        for (const { s, y } of labs) {
          svg.append(sv('text', { x: m.l + pw + 6, y, 'dominant-baseline': 'middle', class: 'd-direct', fill: textColor(s.color), text: s.label }));
        }
        f.bottom.replaceChildren();
      } else {
        f.bottom.replaceChildren(legend(series.map((s) => ({ label: s.label, swatch: swatchLine(s.color, s.shape, s.dash || (sparse ? null : DASHES[(s.k || 0) % 4])) }))));
      }

      scrubber(f, svg, { l: m.l, t: m.t, w: pw, h: ph }, n, xAt,
        (i) => `${X[i]}　` + series.map((s) => `${s.name} ${withUnit(s.values[i], spec.unit, spec.digits)}`).join(' / '));
      mount(f, svg);
    });

    altTable(f, [spec.xLabel || '時点', ...series.map((s) => s.name + (spec.unit ? `（${spec.unit}）` : ''))],
      X.map((x, i) => [x, ...series.map((s) => s.values[i])]), { digits: spec.digits });
    return { summary: `${f.title}。${summary}` };
  }

  // ---------------------------------------------------------------- 棒

  /**
   * 分類ごとの数量比較。原点は常に 0。
   * 1系列: { title, unit, items:[{label, value}], sort:'desc'|'asc'|'none', highlight:[label], reference:{value, label} }
   * 複数: { categories:[…], series:[{name, values}], mode:'group'|'stack', orientation:'h'|'v' }
   */
  function bar(host, spec) {
    const f = frame(host, spec, 'bar');
    let cats, series;
    if (spec.items) {
      cats = spec.items.map((d) => String(d.label));
      series = [{ name: spec.seriesName || spec.title || '値', values: spec.items.map((d) => (d.value == null ? null : +d.value)) }];
    } else {
      cats = (spec.categories || []).map(String);
      series = (spec.series || []).map((s) => Object.assign({}, s, { values: (s.values || []).map((v) => (v == null ? null : +v)) }));
    }
    if (!cats.length || !series.length) return empty(f, spec);
    const stack = spec.mode === 'stack' && series.length > 1;
    if (stack && series.some((s) => s.values.some((v) => v < 0))) console.warn('Dash.bar: 積み上げに負の値があります。集合棒にしてください');

    const sortDir = spec.sort || (spec.items ? 'desc' : 'none');
    const total = (i) => series.reduce((a, s) => a + (s.values[i] || 0), 0);
    let order = cats.map((_, i) => i);
    if (sortDir !== 'none') order.sort((a, b) => (sortDir === 'asc' ? total(a) - total(b) : total(b) - total(a)));
    cats = order.map((i) => cats[i]);
    series = series.map((s) => Object.assign({}, s, { values: order.map((i) => s.values[i]) }));
    const totals = cats.map((_, i) => total(i));

    const vals = stack ? totals : series.flatMap((s) => s.values);
    const [mn, mx] = extent(vals.concat(spec.reference ? [spec.reference.value] : []));
    const sc = scale(mn, mx, 4, true);
    const hl = new Set([].concat(spec.highlight || []).map(String));
    const pal = palette(), mute = cssVar('--d-mute');
    const color = (k, cat) => (hl.size && !hl.has(cat) ? mute : series.length === 1 ? pal[0] : pal[k % pal.length]);
    const single = series.length === 1;

    const top = cats.map((c, i) => [c, totals[i]]).sort((a, b) => b[1] - a[1]);
    const summary = single
      ? `棒グラフ。${cats.length}項目。最大は${top[0][0]} ${withUnit(top[0][1], spec.unit, spec.digits)}、最小は${top[top.length - 1][0]} ${withUnit(top[top.length - 1][1], spec.unit, spec.digits)}`
      : `${stack ? '積み上げ' : '集合'}棒グラフ。${cats.length}項目×${series.length}系列（${series.map((s) => s.name).join('・')}）。合計の最大は${top[0][0]} ${withUnit(top[0][1], spec.unit, spec.digits)}`;

    const catW = Math.max(...cats.map((c) => textW(c)));
    responsive(f, (w) => {
      let orient = spec.orientation || (cats.length > 6 || catW > 72 ? 'h' : 'v');
      const tickW = Math.max(...sc.ticks.map((t) => textW(fmt(t, sc.digits))));
      if (orient === 'v' && (w - tickW - 24) / cats.length < catW + 8) orient = 'h';
      const svg = sv('svg');
      const defs = sv('defs'); svg.append(defs);
      const fillOf = patterner(defs);
      const g = sv('g', { class: 'd-axis' }); svg.append(g);
      const valW = textW(withUnit(sc.hi, '', spec.digits)) + 10;
      const refPad = spec.reference ? 18 : 0;
      let H;
      const focusable = cats.length * series.length <= 80;
      const label = (ci, si) => `${cats[ci]}${single ? '' : '・' + series[si].name} ${withUnit(series[si].values[ci], spec.unit, spec.digits)}`;

      if (orient === 'h') {
        const barH = single || stack ? 18 : Math.max(8, Math.min(14, 36 / series.length));
        const groupH = single || stack ? barH : barH * series.length;
        const rowH = groupH + 12;
        const labW = Math.min(catW, w * 0.35) + 10;
        const m = { l: labW, r: valW, t: 4 + refPad, b: 22 };
        const pw = Math.max(40, w - m.l - m.r);
        H = m.t + cats.length * rowH + m.b;
        const xAt = (v) => m.l + ((v - sc.lo) / (sc.hi - sc.lo)) * pw;
        for (const t of sc.ticks) {
          g.append(sv('line', { x1: xAt(t), x2: xAt(t), y1: m.t, y2: H - m.b, class: t === 0 ? 'd-zero' : 'd-gridline' }));
          g.append(sv('text', { x: xAt(t), y: H - 6, 'text-anchor': 'middle', class: 'd-tick', text: fmt(t, sc.digits) }));
        }
        cats.forEach((c, ci) => {
          const y0 = m.t + ci * rowH + (rowH - groupH) / 2;
          const t = sv('text', { x: m.l - 8, y: y0 + groupH / 2, 'text-anchor': 'end', 'dominant-baseline': 'middle', class: 'd-tick d-cat', text: clip(c, labW - 10) });
          t.append(sv('title', { text: c }));
          g.append(t);
          let acc = 0;
          series.forEach((s, si) => {
            const v = s.values[ci];
            if (v == null) return;
            const a = stack ? acc : 0, b = stack ? acc + v : v;
            const y = stack ? y0 : y0 + (single ? 0 : si * barH);
            const r = sv('rect', { x: Math.min(xAt(a), xAt(b)), y, width: Math.max(0.5, Math.abs(xAt(b) - xAt(a))), height: barH - (stack || single ? 0 : 2), fill: fillOf(stack || !single ? si : 0, color(si, c)), class: 'd-bar' });
            if (stack) r.setAttribute('stroke', '#fff');
            tipOn(f, r, label(ci, si), focusable);
            svg.append(r);
            if (!stack) svg.append(sv('text', { x: xAt(Math.max(0, v)) + 4, y: y + (barH - 2) / 2, 'dominant-baseline': 'middle', class: 'd-value', text: fmt(v, spec.digits) }));
            acc += v;
          });
          if (stack) svg.append(sv('text', { x: xAt(totals[ci]) + 4, y: y0 + barH / 2, 'dominant-baseline': 'middle', class: 'd-value', text: fmt(totals[ci], spec.digits) }));
        });
        if (spec.reference) {
          const x = xAt(spec.reference.value);
          svg.append(sv('line', { x1: x, x2: x, y1: m.t - 4, y2: H - m.b, class: 'd-refline' }));
          svg.append(sv('text', { x, y: m.t - 8, 'text-anchor': 'middle', class: 'd-note-svg', text: `${spec.reference.label || '基準'} ${fmt(spec.reference.value, spec.digits)}` }));
        }
        f.top.replaceChildren(single ? '' : legend(series.map((s, si) => ({ label: s.name, swatch: swatchRect(fillOf(si, pal[si % pal.length])) }))));
        f.bottom.replaceChildren();
      } else {
        const nameW = Math.max(...series.map((s) => textW(s.name))) + 12;
        const directStack = stack && nameW < w * 0.25;
        const m = { l: tickW + 10, r: directStack ? nameW + 6 : 12, t: 18 + refPad, b: 26 };
        const pw = Math.max(40, w - m.l - m.r);
        H = spec.height || 240;
        const ph = H - m.t - m.b;
        const yAt = (v) => m.t + ph - ((v - sc.lo) / (sc.hi - sc.lo)) * ph;
        yAxis(g, sc, m.l, m.l + pw, yAt);
        const band = pw / cats.length;
        const bw = single || stack ? Math.min(band * 0.6, 56) : Math.min((band * 0.75) / series.length, 32);
        const showVal = single || stack || bw >= textW(fmt(sc.hi, spec.digits)) - 2;
        cats.forEach((c, ci) => {
          const cx = m.l + band * (ci + 0.5);
          g.append(sv('text', { x: cx, y: H - 8, 'text-anchor': 'middle', class: 'd-tick', text: c }));
          let acc = 0;
          series.forEach((s, si) => {
            const v = s.values[ci];
            if (v == null) return;
            const a = stack ? acc : 0, b = stack ? acc + v : v;
            const x = stack || single ? cx - bw / 2 : cx - (bw * series.length) / 2 + si * bw;
            const r = sv('rect', { x: x + (stack || single ? 0 : 1), y: Math.min(yAt(a), yAt(b)), width: bw - (stack || single ? 0 : 2), height: Math.max(0.5, Math.abs(yAt(a) - yAt(b))), fill: fillOf(stack || !single ? si : 0, color(si, c)), class: 'd-bar' });
            if (stack) r.setAttribute('stroke', '#fff');
            tipOn(f, r, label(ci, si), focusable);
            svg.append(r);
            if (!stack && showVal) svg.append(sv('text', { x: x + bw / 2, y: yAt(Math.max(0, v)) - 4, 'text-anchor': 'middle', class: 'd-value', text: fmt(v, spec.digits) }));
            acc += v;
          });
          if (stack) svg.append(sv('text', { x: cx, y: yAt(totals[ci]) - 4, 'text-anchor': 'middle', class: 'd-value', text: fmt(totals[ci], spec.digits) }));
        });
        if (directStack) {
          const ci = cats.length - 1;
          let acc = 0;
          const labs = series.map((s) => { const v = s.values[ci] || 0; const y = yAt(acc + v / 2); acc += v; return { s, y }; });
          spread(labs, 14, m.t, m.t + ph);
          for (const { s, y } of labs) svg.append(sv('text', { x: m.l + pw + 6, y, 'dominant-baseline': 'middle', class: 'd-direct', fill: textColor(color(series.indexOf(s), cats[ci])), text: s.name }));
        }
        if (spec.reference) {
          const y = yAt(spec.reference.value);
          svg.append(sv('line', { x1: m.l, x2: m.l + pw, y1: y, y2: y, class: 'd-refline' }));
          svg.append(sv('text', { x: m.l + pw, y: y - 4, 'text-anchor': 'end', class: 'd-note-svg', text: `${spec.reference.label || '基準'} ${fmt(spec.reference.value, spec.digits)}` }));
        }
        f.top.replaceChildren(single || directStack ? '' : legend(series.map((s, si) => ({ label: s.name, swatch: swatchRect(fillOf(si, pal[si % pal.length])) }))));
        f.bottom.replaceChildren();
      }
      setAttrs(svg, { width: w, height: H, viewBox: `0 0 ${w} ${H}`, role: 'img', 'aria-label': `${f.title}。${summary}` });
      mount(f, svg);
    });

    altTable(f, [spec.catLabel || '分類', ...series.map((s) => s.name + (spec.unit ? `（${spec.unit}）` : '')), ...(stack ? ['合計'] : [])],
      cats.map((c, i) => [c, ...series.map((s) => s.values[i]), ...(stack ? [totals[i]] : [])]), { digits: spec.digits });
    return { summary: `${f.title}。${summary}` };
  }

  // ---------------------------------------------------------------- 面

  /**
   * 数量と構成比の時間変化（積み上げ面）。percent:true で 100% 積み上げ。
   * { title, unit, x:[…], series:[{name, values}], percent, height }
   */
  function area(host, spec) {
    const f = frame(host, spec, 'area');
    const X = (spec.x || []).map(String), n = X.length;
    const series = (spec.series || []).map((s) => Object.assign({}, s, { values: (s.values || []).map((v) => (v == null ? 0 : +v)) }));
    if (!n || !series.length) return empty(f, spec);
    if (series.length > 5) console.warn('Dash.area: 系列が多すぎます（6以上）。棒グラフか、上位だけにしてください');
    const totals = X.map((_, i) => series.reduce((a, s) => a + s.values[i], 0));
    const share = (s, i) => (totals[i] ? s.values[i] / totals[i] : 0);
    const val = (s, i) => (spec.percent ? share(s, i) * 100 : s.values[i]);
    const sc = spec.percent ? { lo: 0, hi: 100, step: 25, ticks: [0, 25, 50, 75, 100], digits: 0 } : scale(0, Math.max(...totals), 4, true);
    const pal = palette();
    const last = n - 1;
    const summary = `${spec.percent ? '100%積み上げ' : '積み上げ'}面グラフ。${X[0]}〜${X[last]}。${X[last]}は` +
      series.map((s) => `${s.name} ${withUnit(s.values[last], spec.unit, spec.digits)}（${pct(share(s, last))}）`).join('、') +
      `、合計 ${withUnit(totals[last], spec.unit, spec.digits)}`;

    responsive(f, (w) => {
      const H = spec.height || 240;
      const tickW = Math.max(...sc.ticks.map((t) => textW(fmt(t, sc.digits) + (spec.percent ? '%' : ''))));
      const nameW = Math.max(...series.map((s) => textW(s.name))) + 12;
      const direct = nameW < w * 0.28;
      const m = { l: tickW + 10, r: direct ? nameW + 6 : 14, t: 10, b: 26 };
      const pw = Math.max(40, w - m.l - m.r), ph = H - m.t - m.b;
      const xAt = (i) => m.l + (n === 1 ? pw / 2 : (i / (n - 1)) * pw);
      const yAt = (v) => m.t + ph - ((v - sc.lo) / (sc.hi - sc.lo)) * ph;
      let idx = X.map((_, i) => i);
      const thin = n > pw * 2;
      if (thin) idx = lttb(totals, Math.floor(pw * 2));
      f.note('thin', thin ? `${fmt(n)} 点を ${fmt(idx.length)} 点に間引いて表示（表と CSV は全点）` : null);

      const svg = svgRoot(f, w, H, summary);
      const defs = sv('defs'); svg.append(defs);
      const fillOf = patterner(defs);
      const g = sv('g', { class: 'd-axis' });
      for (const t of sc.ticks) {
        const y = yAt(t);
        g.append(sv('line', { x1: m.l, x2: m.l + pw, y1: y, y2: y, class: t === 0 ? 'd-zero' : 'd-gridline' }));
        g.append(sv('text', { x: m.l - 6, y, 'text-anchor': 'end', 'dominant-baseline': 'middle', class: 'd-tick', text: fmt(t, sc.digits) + (spec.percent ? '%' : '') }));
      }
      xLabels(g, X, xAt, H - 8, pw);
      const base = X.map(() => 0);
      const labs = [];
      series.forEach((s, k) => {
        const topLine = idx.map((i) => [xAt(i), yAt(base[i] + val(s, i))]);
        const botLine = idx.map((i) => [xAt(i), yAt(base[i])]).reverse();
        const d = 'M' + topLine.concat(botLine).map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L') + 'Z';
        svg.append(sv('path', { d, fill: fillOf(k, pal[k % pal.length]), stroke: '#fff', 'stroke-width': 1 }));
        labs.push({ s, k, y: yAt(base[last] + val(s, last) / 2) });
        X.forEach((_, i) => { base[i] += val(s, i); });
      });
      svg.append(g);
      if (direct) {
        spread(labs, 14, m.t + 4, m.t + ph);
        for (const { s, k, y } of labs) svg.append(sv('text', { x: m.l + pw + 6, y, 'dominant-baseline': 'middle', class: 'd-direct', fill: textColor(pal[k % pal.length]), text: s.name }));
        f.bottom.replaceChildren();
      } else {
        // 積み上げは下から順。凡例は上の系列を先に並べて、見た目の上下と揃える
        f.bottom.replaceChildren(legend(series.map((s, k) => ({ label: s.name, swatch: swatchRect(fillOf(k, pal[k % pal.length])) })).reverse(), true));
      }
      scrubber(f, svg, { l: m.l, t: m.t, w: pw, h: ph }, n, xAt, (i) => `${X[i]}　` + series.slice().reverse()
        .map((s) => `${s.name} ${withUnit(s.values[i], spec.unit, spec.digits)}（${pct(share(s, i))}）`).join(' / ') + `　合計 ${withUnit(totals[i], spec.unit, spec.digits)}`);
      mount(f, svg);
    });

    altTable(f, [spec.xLabel || '時点', ...series.map((s) => s.name + (spec.unit ? `（${spec.unit}）` : '')), '合計'],
      X.map((x, i) => [x, ...series.map((s) => s.values[i]), totals[i]]), { digits: spec.digits });
    return { summary: `${f.title}。${summary}` };
  }

  // ---------------------------------------------------------------- 円・ドーナツ

  function arcPath(cx, cy, r0, r1, a0, a1) {
    const big = a1 - a0 > Math.PI ? 1 : 0;
    const p = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const [x0, y0] = p(r1, a0), [x1, y1] = p(r1, a1);
    if (r0 <= 0) return `M${cx},${cy}L${x0},${y0}A${r1},${r1} 0 ${big} 1 ${x1},${y1}Z`;
    const [x2, y2] = p(r0, a1), [x3, y3] = p(r0, a0);
    return `M${x0},${y0}A${r1},${r1} 0 ${big} 1 ${x1},${y1}L${x2},${y2}A${r0},${r0} 0 ${big} 0 ${x3},${y3}Z`;
  }

  /**
   * 構成比。総量が明らかで項目が 5 以下のときだけ。それ以外は棒にする。
   * { title, unit, items:[{label, value}], hole:0.6（0で円グラフ）, totalLabel, size, sort }
   */
  function donut(host, spec) {
    const f = frame(host, spec, 'donut');
    let items = (spec.items || []).filter((d) => d.value > 0).map((d) => ({ label: String(d.label), value: +d.value }));
    if (!items.length) return empty(f, spec);
    if (spec.sort !== 'none') items.sort((a, b) => b.value - a.value);
    if (items.length > 5) {
      const rest = items.slice(4).reduce((a, d) => a + d.value, 0);
      items = items.slice(0, 4).concat([{ label: 'その他', value: rest, other: true }]);
      f.note('other', '上位 4 項目以外を「その他」にまとめた');
    }
    const total = items.reduce((a, d) => a + d.value, 0);
    const pal = palette(), mute = cssVar('--d-mute');
    const size = spec.size || 180, hole = spec.hole == null ? 0.6 : spec.hole;
    const svg = sv('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, role: 'img' });
    const defs = sv('defs'); svg.append(defs);
    const fillOf = patterner(defs);
    const cx = size / 2, cy = size / 2, r1 = size / 2 - 2, r0 = r1 * hole;
    let a = -Math.PI / 2;
    items.forEach((d, k) => {
      d.color = d.other || k > 3 ? mute : pal[k];
      d.fill = fillOf(k, d.color);
      d.share = d.value / total;
      const a1 = a + d.share * Math.PI * 2;
      const node = items.length === 1
        ? sv('path', { d: arcPath(cx, cy, r0, r1, -Math.PI / 2, Math.PI * 1.4999) + arcPath(cx, cy, r0, r1, Math.PI * 1.4999, Math.PI * 1.5), fill: d.fill })
        : sv('path', { d: arcPath(cx, cy, r0, r1, a, a1), fill: d.fill, stroke: '#fff', 'stroke-width': 1.5 });
      tipOn(f, node, `${d.label} ${withUnit(d.value, spec.unit, spec.digits)}（${pct(d.share)}）`, true);
      svg.append(node);
      a = a1;
    });
    if (hole > 0) {
      svg.append(sv('text', { x: cx, y: cy - 4, 'text-anchor': 'middle', class: 'd-center-value', text: fmt(total, spec.digits) }));
      svg.append(sv('text', { x: cx, y: cy + 16, 'text-anchor': 'middle', class: 'd-center-label', text: `${spec.totalLabel || '全体'}${spec.unit ? `（${spec.unit}）` : ''}` }));
    }
    const summary = `${hole > 0 ? 'ドーナツ' : '円'}グラフ。全体 ${withUnit(total, spec.unit, spec.digits)}。` + items.map((d) => `${d.label} ${pct(d.share)}`).join('、');
    svg.setAttribute('aria-label', `${f.title}。${summary}`);
    const leg = legend(items.map((d) => ({ label: d.label, swatch: swatchRect(d.fill), value: `${fmt(d.value, spec.digits)}　${pct(d.share)}` })), true);
    mount(f, el('div', { class: 'd-donut' }, svg, leg));
    altTable(f, [spec.catLabel || '分類', `値${spec.unit ? `（${spec.unit}）` : ''}`, '割合'],
      items.map((d) => [d.label, d.value, pct(d.share)]), { digits: spec.digits });
    return { summary: `${f.title}。${summary}` };
  }

  // ---------------------------------------------------------------- 表

  /**
   * 多くの値の一覧。見出しを押すと並び替え。bar:true の列は 0 起点のデータバーを付ける。
   * { title, columns:[{key, label, unit, digits, bar, align}], rows:[{…}], sort:{key, dir:'desc'|'asc'} }
   */
  function table(host, spec) {
    const f = frame(host, spec, 'table');
    const cols = spec.columns || [], rows = (spec.rows || []).slice();
    if (!rows.length) return empty(f, spec);
    let sort = spec.sort ? Object.assign({}, spec.sort) : null;
    const isNum = (c) => rows.some((r) => typeof r[c.key] === 'number');
    const maxOf = {};
    for (const c of cols) if (c.bar) maxOf[c.key] = Math.max(0, ...rows.map((r) => +r[c.key] || 0));
    const wrapEl = el('div', { class: 'd-table-wrap' });
    const render = () => {
      if (sort) {
        const dir = sort.dir === 'asc' ? 1 : -1;
        rows.sort((a, b) => {
          const x = a[sort.key], y = b[sort.key];
          if (x == null) return 1; if (y == null) return -1;
          return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'ja')) * dir;
        });
      }
      const thead = el('thead', null, el('tr', null, cols.map((c) => {
        const on = sort && sort.key === c.key;
        return el('th', { scope: 'col', class: isNum(c) ? 'd-r' : null, 'aria-sort': on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : null },
          el('button', { type: 'button', class: 'd-sort', onclick: () => {
            sort = { key: c.key, dir: on && sort.dir === 'desc' ? 'asc' : 'desc' }; render();
          } }, c.label + (c.unit ? `（${c.unit}）` : ''), on ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''));
      })));
      const tbody = el('tbody', null, rows.map((r) => el('tr', null, cols.map((c, i) => {
        const v = r[c.key];
        const text = typeof v === 'number' ? fmt(v, c.digits) : v == null ? '—' : String(v);
        let content = text;
        if (c.bar && typeof v === 'number') {
          const s = sv('svg', { width: 64, height: 10, class: 'd-databar', 'aria-hidden': 'true' });
          s.append(sv('rect', { width: maxOf[c.key] ? (Math.max(0, v) / maxOf[c.key]) * 64 : 0, height: 10, fill: cssVar('--d-s1') }));
          content = el('span', { class: 'd-barcell' }, s, el('span', { text }));
        }
        return i === 0 ? el('th', { scope: 'row', text }) : el('td', { class: isNum(c) ? 'd-r' : null }, content);
      }))));
      wrapEl.replaceChildren(el('table', { class: 'd-table' }, thead, tbody));
    };
    render();
    mount(f, wrapEl);
    f.alt.replaceChildren(csvLink(cols.map((c) => c.label + (c.unit ? `（${c.unit}）` : '')), rows.map((r) => cols.map((c) => r[c.key])), spec.title));
    return { summary: `${f.title}。表。${rows.length}行×${cols.length}列` };
  }

  // ---------------------------------------------------------------- ファネル

  /**
   * 段階ごとの残り数。中央寄せの逆三角にせず、0 起点の横棒で長さを正しく比べる。
   * { title, unit, steps:[{label, value}] }
   */
  function funnel(host, spec) {
    const f = frame(host, spec, 'funnel');
    const steps = (spec.steps || []).map((s) => ({ label: String(s.label), value: +s.value }));
    if (!steps.length) return empty(f, spec);
    const first = steps[0].value || 0;
    const summary = `ファネル。${steps.map((s, i) => `${s.label} ${withUnit(s.value, spec.unit, spec.digits)}${i ? `（前段から ${pct(steps[i - 1].value ? s.value / steps[i - 1].value : null)}）` : ''}`).join('、')}。最初から最後まで ${pct(first ? steps[steps.length - 1].value / first : null)}`;
    responsive(f, (w) => {
      const labW = Math.min(Math.max(...steps.map((s) => textW(s.label))), w * 0.3) + 10;
      const valW = textW(fmt(first, spec.digits)) + 10;
      const rowH = 46, H = steps.length * rowH + 4;
      const pw = Math.max(40, w - labW - valW);
      const mx = Math.max(...steps.map((s) => s.value)) || 1;
      const svg = svgRoot(f, w, H, summary);
      svg.append(sv('line', { x1: labW, x2: labW, y1: 0, y2: H, class: 'd-zero' }));
      steps.forEach((s, i) => {
        const y = i * rowH + 4;
        svg.append(sv('text', { x: labW - 8, y: y + 9, 'text-anchor': 'end', 'dominant-baseline': 'middle', class: 'd-tick d-cat', text: clip(s.label, labW - 10) }));
        const r = sv('rect', { x: labW, y, width: Math.max(0.5, (s.value / mx) * pw), height: 18, fill: cssVar('--d-s1'), class: 'd-bar' });
        tipOn(f, r, `${s.label} ${withUnit(s.value, spec.unit, spec.digits)}`, true);
        svg.append(r);
        svg.append(sv('text', { x: labW + (s.value / mx) * pw + 4, y: y + 9, 'dominant-baseline': 'middle', class: 'd-value', text: fmt(s.value, spec.digits) }));
        if (i) svg.append(sv('text', { x: labW, y: y + 32, class: 'd-note-svg',
          text: `前段から ${pct(steps[i - 1].value ? s.value / steps[i - 1].value : null)}・最初から ${pct(first ? s.value / first : null)}` }));
      });
      mount(f, svg);
    });
    altTable(f, ['段階', `数${spec.unit ? `（${spec.unit}）` : ''}`, '前段から', '最初から'],
      steps.map((s, i) => [s.label, s.value, i ? pct(steps[i - 1].value ? s.value / steps[i - 1].value : null) : '—', pct(first ? s.value / first : null)]), { digits: spec.digits });
    return { summary: `${f.title}。${summary}` };
  }

  // ---------------------------------------------------------------- 階層レイアウト（サンキーとフロー図で共用）

  /** 有向グラフを層に分ける。逆向きの辺（循環）を見つけ、最長経路で層を決め、重心法で並び替える */
  function layering(ids, edges, alignSinks) {
    const out = new Map(ids.map((id) => [id, []]));
    edges.forEach((e, i) => out.get(e.s).push(i));
    const state = new Map(), back = new Set();
    const visit = (u) => {
      state.set(u, 1);
      for (const i of out.get(u)) {
        const v = edges[i].t, st = state.get(v);
        if (st === 1) back.add(i); else if (!st) visit(v);
      }
      state.set(u, 2);
    };
    ids.forEach((id) => { if (!state.get(id)) visit(id); });
    const fwd = edges.map((_, i) => i).filter((i) => !back.has(i));
    const indeg = new Map(ids.map((id) => [id, 0]));
    for (const i of fwd) indeg.set(edges[i].t, indeg.get(edges[i].t) + 1);
    const rank = new Map(ids.map((id) => [id, 0]));
    const queue = ids.filter((id) => !indeg.get(id));
    while (queue.length) {
      const u = queue.shift();
      for (const i of out.get(u)) {
        if (back.has(i)) continue;
        const v = edges[i].t;
        rank.set(v, Math.max(rank.get(v), rank.get(u) + 1));
        indeg.set(v, indeg.get(v) - 1);
        if (!indeg.get(v)) queue.push(v);
      }
    }
    let maxRank = Math.max(0, ...rank.values());
    if (alignSinks) for (const id of ids) if (!fwd.some((i) => edges[i].s === id)) rank.set(id, maxRank);
    maxRank = Math.max(0, ...rank.values());
    const layers = Array.from({ length: maxRank + 1 }, () => []);
    ids.forEach((id) => layers[rank.get(id)].push(id));
    const pos = new Map();
    const index = () => layers.forEach((L) => L.forEach((id, i) => pos.set(id, i)));
    index();
    const preds = new Map(ids.map((id) => [id, []])), succs = new Map(ids.map((id) => [id, []]));
    for (const i of fwd) { preds.get(edges[i].t).push(edges[i].s); succs.get(edges[i].s).push(edges[i].t); }
    const bary = (id, nb) => { const ns = nb.get(id); return ns.length ? ns.reduce((a, x) => a + pos.get(x), 0) / ns.length : pos.get(id); };
    for (let it = 0; it < 6; it++) {
      for (let r = 1; r <= maxRank; r++) { const b = new Map(layers[r].map((id) => [id, bary(id, preds)])); layers[r].sort((x, y) => b.get(x) - b.get(y)); index(); }
      for (let r = maxRank - 1; r >= 0; r--) { const b = new Map(layers[r].map((id) => [id, bary(id, succs)])); layers[r].sort((x, y) => b.get(x) - b.get(y)); index(); }
    }
    return { rank, layers, back, maxRank };
  }

  // ---------------------------------------------------------------- サンキー

  /**
   * 量の流れ（どこから来てどこへ行くか）。循環があると描けない。
   * { title, unit, nodes:[{id, label}], links:[{source, target, value}], height }
   */
  function sankey(host, spec) {
    const f = frame(host, spec, 'sankey');
    const nodes = (spec.nodes || []).map((n) => ({ id: String(n.id), label: String(n.label ?? n.id) }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links = (spec.links || []).filter((l) => +l.value > 0).map((l) => ({ s: String(l.source), t: String(l.target), value: +l.value }));
    for (const l of links) for (const id of [l.s, l.t]) if (!byId.has(id)) { const n = { id, label: id }; nodes.push(n); byId.set(id, n); }
    if (!links.length) return empty(f, spec);
    const L = layering(nodes.map((n) => n.id), links, true);
    if (L.back.size) { mount(f, el('p', { class: 'd-empty', text: '流れに循環があるためサンキーでは描けません。Dash.flow（フロー図）を使ってください' })); return { summary: '循環あり' }; }
    for (const n of nodes) {
      n.in = links.filter((l) => l.t === n.id).reduce((a, l) => a + l.value, 0);
      n.out = links.filter((l) => l.s === n.id).reduce((a, l) => a + l.value, 0);
      n.value = Math.max(n.in, n.out);
    }
    const sources = nodes.filter((n) => !n.in), total = sources.reduce((a, n) => a + n.value, 0);
    const big = links.slice().sort((a, b) => b.value - a.value).slice(0, 3);
    const summary = `サンキー図。${nodes.length}個の区分、${links.length}本の流れ。流入の合計 ${withUnit(total, spec.unit, spec.digits)}。大きい流れは` +
      big.map((l) => `${byId.get(l.s).label}→${byId.get(l.t).label} ${withUnit(l.value, spec.unit, spec.digits)}`).join('、');

    responsive(f, (w) => {
      const maxCount = Math.max(...L.layers.map((x) => x.length));
      const H = spec.height || Math.max(220, maxCount * 44);
      const nodeW = 12, pad = 14;
      const labW = Math.min(Math.max(...nodes.map((n) => textW(`${n.label} ${fmt(n.value, spec.digits)}`))) + 8, w * 0.28);
      // ラベルは最終列だけ左、それ以外は右に出す。左右の端はノード幅だけ空ければよい
      const x0 = 0, x1 = w - nodeW;
      const colX = (r) => (L.maxRank ? x0 + (r / L.maxRank) * (x1 - x0) : x0);
      const ky = Math.min(...L.layers.map((ids) => (H - (ids.length - 1) * pad) / ids.reduce((a, id) => a + byId.get(id).value, 0)));
      L.layers.forEach((ids, r) => {
        const sum = ids.reduce((a, id) => a + byId.get(id).value * ky, 0) + (ids.length - 1) * pad;
        let y = (H - sum) / 2;
        for (const id of ids) { const n = byId.get(id); n.x = colX(r); n.y = y; n.h = Math.max(1, n.value * ky); y += n.h + pad; n.r = r; }
      });
      const svg = svgRoot(f, w, H, summary);
      const g = sv('g');
      const outOff = new Map(), inOff = new Map();
      const sorted = links.slice().sort((a, b) => (byId.get(a.s).y - byId.get(b.s).y) || (byId.get(a.t).y - byId.get(b.t).y));
      const bySrc = sorted.slice().sort((a, b) => byId.get(a.t).y - byId.get(b.t).y);
      const flow = cssVar('--d-link-flow');
      for (const l of bySrc) {
        const s = byId.get(l.s), t = byId.get(l.t), th = Math.max(1, l.value * ky);
        const so = outOff.get(l.s) || 0; outOff.set(l.s, so + th);
        l.y0 = s.y + so + th / 2; l.th = th;
      }
      for (const l of sorted) {
        const t = byId.get(l.t), io = inOff.get(l.t) || 0; inOff.set(l.t, io + l.th);
        l.y1 = t.y + io + l.th / 2;
      }
      for (const l of links) {
        const s = byId.get(l.s), t = byId.get(l.t);
        const xa = s.x + nodeW, xb = t.x, xm = (xa + xb) / 2;
        const p = sv('path', { d: `M${xa},${l.y0}C${xm},${l.y0} ${xm},${l.y1} ${xb},${l.y1}`, fill: 'none', stroke: flow, 'stroke-width': l.th, class: 'd-flow', 'stroke-opacity': 0.75 });
        tipOn(f, p, `${s.label} → ${t.label} ${withUnit(l.value, spec.unit, spec.digits)}（${s.label}の ${pct(s.out ? l.value / s.out : null)}）`, links.length <= 60);
        g.append(p);
      }
      for (const n of nodes) {
        g.append(sv('rect', { x: n.x, y: n.y, width: nodeW, height: n.h, fill: cssVar('--d-s1') }));
        const right = n.r < L.maxRank;
        g.append(sv('text', { x: right ? n.x + nodeW + 6 : n.x - 6, y: n.y + n.h / 2, 'text-anchor': right ? 'start' : 'end', 'dominant-baseline': 'middle', class: 'd-direct d-halo', fill: cssVar('--d-text'),
          text: clip(`${n.label} ${fmt(n.value, spec.digits)}`, labW) }));
      }
      svg.append(g);
      mount(f, svg);
    });
    altTable(f, ['流れ元', '流れ先', `量${spec.unit ? `（${spec.unit}）` : ''}`], links.map((l) => [byId.get(l.s).label, byId.get(l.t).label, l.value]), { digits: spec.digits });
    return { summary: `${f.title}。${summary}` };
  }

  // ---------------------------------------------------------------- フロー図

  const STATUS = {
    done: { sym: '✓', word: '完了' },
    active: { sym: '●', word: '進行中' },
    todo: { sym: '○', word: '未着手' },
    blocked: { sym: '✕', word: '停止' },
  };

  /**
   * 工程・分岐・状態の流れ。逆向きの辺（差し戻し）は破線で回り込ませる。
   * { title, nodes:[{id, label, kind:'start'|'step'|'decision'|'end', status, value, unit}], edges:[{from, to, label}], direction:'LR'|'TB' }
   */
  function flow(host, spec) {
    const f = frame(host, spec, 'flow');
    const nodes = (spec.nodes || []).map((n) => Object.assign({}, n, { id: String(n.id), label: String(n.label ?? n.id), kind: n.kind || 'step' }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges = (spec.edges || []).map((e) => ({ s: String(e.from), t: String(e.to), label: e.label || '' }));
    for (const e of edges) for (const id of [e.s, e.t]) if (!byId.has(id)) { const n = { id, label: id, kind: 'step' }; nodes.push(n); byId.set(id, n); }
    if (!nodes.length) return empty(f, spec);
    if (nodes.length > 40) console.warn('Dash.flow: 工程が 40 を超えています。段階ごとに図を分けてください');
    const L = layering(nodes.map((n) => n.id), edges, false);
    const FS = 13, BOX = 150;
    for (const n of nodes) {
      n.lines = wrap(n.label, BOX - 28, FS, 3);
      n.w = n.kind === 'decision' ? BOX + 30 : BOX;
      n.h = 18 + n.lines.length * 17 + (n.value != null ? 17 : 0) + (n.kind === 'decision' ? 26 : 0);
    }
    const gapMain = 64 + Math.min(80, Math.max(0, ...edges.map((e) => textW(e.label, 11))) * 0.6), gapCross = 22;
    const counts = {};
    nodes.forEach((n) => { if (n.status) counts[n.status] = (counts[n.status] || 0) + 1; });
    const stat = Object.entries(counts).map(([k, v]) => `${(STATUS[k] || { word: k }).word} ${v}`).join('、');
    const summary = `フロー図。${nodes.length}個の工程、${edges.length}本のつながり。${stat}`;

    /** LR=true で左から右、false で上から下。描いた幅を返す */
    const render = (LR) => {
    const sizeMain = (n) => (LR ? n.w : n.h), sizeCross = (n) => (LR ? n.h : n.w);
    const mainMax = L.layers.map((ids) => Math.max(...ids.map((id) => sizeMain(byId.get(id)))));
    const crossLen = L.layers.map((ids) => ids.reduce((a, id) => a + sizeCross(byId.get(id)), 0) + (ids.length - 1) * gapCross);
    const crossMax = Math.max(...crossLen);
    const backPad = L.back.size ? 48 : 0;
    let main = 8;
    L.layers.forEach((ids, r) => {
      let c = 8 + (crossMax - crossLen[r]) / 2;
      for (const id of ids) {
        const n = byId.get(id);
        const m0 = main + (mainMax[r] - sizeMain(n)) / 2;
        if (LR) { n.x = m0; n.y = c; } else { n.x = c; n.y = m0; }
        c += sizeCross(n) + gapCross;
      }
      main += mainMax[r] + gapMain;
    });
    const W = LR ? main - gapMain + 8 : crossMax + 16 + backPad;
    const H = LR ? crossMax + 16 + backPad : main - gapMain + 8;

    const svg = sv('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${f.title}。${summary}`, class: 'd-flowchart' });
    const defs = sv('defs');
    const arrowId = 'd-a' + (++seq);
    defs.append(sv('marker', { id: arrowId, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' },
      sv('path', { d: 'M0,0L10,5L0,10Z', fill: cssVar('--d-label') })));
    svg.append(defs);
    const gE = sv('g'), gN = sv('g');
    const lab = cssVar('--d-label');
    edges.forEach((e, i) => {
      const a = byId.get(e.s), b = byId.get(e.t);
      let d, mid;
      if (L.back.has(i)) {
        if (LR) {
          const y = H - backPad / 2, ax = a.x + a.w / 2, bx = b.x + b.w / 2;
          d = `M${ax},${a.y + a.h}C${ax},${y} ${bx},${y} ${bx},${b.y + b.h}`; mid = [(ax + bx) / 2, y - 6];
        } else {
          const x = W - backPad / 2, ay = a.y + a.h / 2, by = b.y + b.h / 2;
          d = `M${a.x + a.w},${ay}C${x},${ay} ${x},${by} ${b.x + b.w},${by}`; mid = [x - 4, (ay + by) / 2];
        }
      } else if (LR) {
        const x0 = a.x + a.w, y0 = a.y + a.h / 2, x1 = b.x, y1 = b.y + b.h / 2, xm = (x0 + x1) / 2;
        d = `M${x0},${y0}C${xm},${y0} ${xm},${y1} ${x1 - 2},${y1}`; mid = [xm, (y0 + y1) / 2];
      } else {
        const x0 = a.x + a.w / 2, y0 = a.y + a.h, x1 = b.x + b.w / 2, y1 = b.y, ym = (y0 + y1) / 2;
        d = `M${x0},${y0}C${x0},${ym} ${x1},${ym} ${x1},${y1 - 2}`; mid = [(x0 + x1) / 2, ym];
      }
      gE.append(sv('path', { d, fill: 'none', stroke: lab, 'stroke-width': 1.5, 'stroke-dasharray': L.back.has(i) ? '5 4' : null, 'marker-end': `url(#${arrowId})` }));
      if (e.label) {
        const tw = textW(e.label, 11) + 8;
        gE.append(sv('rect', { x: mid[0] - tw / 2, y: mid[1] - 9, width: tw, height: 18, rx: 4, fill: cssVar('--d-card') }));
        gE.append(sv('text', { x: mid[0], y: mid[1], 'text-anchor': 'middle', 'dominant-baseline': 'middle', class: 'd-note-svg', text: e.label }));
      }
    });
    const s1 = cssVar('--d-s1'), neg = cssVar('--d-neg-text'), mute = cssVar('--d-mute');
    for (const n of nodes) {
      const st = n.status;
      const stroke = st === 'blocked' ? neg : st === 'todo' ? mute : st ? s1 : lab;
      const fill = st === 'active' ? cssVar('--d-hl') : st === 'blocked' ? '#FDEEEE' : cssVar('--d-card');
      const sw = st === 'active' ? 3 : 1.5;
      const g = sv('g', { class: 'd-node' });
      if (n.kind === 'decision') {
        g.append(sv('path', { d: `M${n.x + n.w / 2},${n.y}L${n.x + n.w},${n.y + n.h / 2}L${n.x + n.w / 2},${n.y + n.h}L${n.x},${n.y + n.h / 2}Z`, fill, stroke, 'stroke-width': sw }));
      } else {
        g.append(sv('rect', { x: n.x, y: n.y, width: n.w, height: n.h, rx: n.kind === 'start' || n.kind === 'end' ? n.h / 2 : 6, fill, stroke, 'stroke-width': sw, 'stroke-dasharray': st === 'todo' ? '4 3' : null }));
      }
      const textH = n.lines.length * 17 + (n.value != null ? 17 : 0);
      let ty = n.y + (n.h - textH) / 2 + 12;
      const cx = n.x + n.w / 2;
      n.lines.forEach((ln, i) => {
        const pre = i === 0 && st && STATUS[st] ? STATUS[st].sym + ' ' : '';
        g.append(sv('text', { x: cx, y: ty, 'text-anchor': 'middle', class: 'd-node-label', fill: st === 'blocked' ? neg : cssVar('--d-text'), text: pre + ln }));
        ty += 17;
      });
      if (n.value != null) g.append(sv('text', { x: cx, y: ty, 'text-anchor': 'middle', class: 'd-value', text: withUnit(+n.value, n.unit, spec.digits) }));
      const word = st && STATUS[st] ? `（${STATUS[st].word}）` : '';
      tipOn(f, g, `${n.label}${word}${n.value != null ? ' ' + withUnit(+n.value, n.unit, spec.digits) : ''}`, true);
      gN.append(g);
    }
    svg.append(gE, gN);
    mount(f, el('div', { class: 'd-scroll' }, svg));
    return W;
    };
    // 向きの指定が無ければ、横向きで収まる幅なら左→右、収まらなければ上→下にする
    responsive(f, (w) => {
      if (spec.direction) { render(spec.direction !== 'TB'); return; }
      if (render(true) > w) render(false);
    });
    if (Object.keys(counts).length) {
      f.bottom.replaceChildren(el('ul', { class: 'd-legend' }, Object.keys(STATUS).filter((k) => counts[k]).map((k) => el('li', { text: `${STATUS[k].sym} ${STATUS[k].word} ${counts[k]}` }))));
    }
    if (L.back.size) f.note('back', '破線は前の工程へ戻る流れ');
    const nexts = (id) => edges.filter((e) => e.s === id).map((e) => byId.get(e.t).label + (e.label ? `（${e.label}）` : '')).join('、');
    altTable(f, ['工程', '種類', '状態', '値', '次の工程'],
      nodes.map((n) => [n.label, { start: '開始', step: '工程', decision: '分岐', end: '終了' }[n.kind] || n.kind, n.status && STATUS[n.status] ? STATUS[n.status].word : '—', n.value != null ? +n.value : null, nexts(n.id) || '—']));
    return { summary: `${f.title}。${summary}` };
  }

  // ---------------------------------------------------------------- ネットワーク図

  /** Fruchterman–Reingold。初期配置は黄金角で決め打ちにし、毎回同じ図になるようにする。単位正方形の座標を返す */
  function forceLayout(n, E, iters) {
    const pos = Array.from({ length: n }, (_, i) => { const a = i * 2.399963, r = Math.sqrt((i + 0.5) / n) * 0.5; return [0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)]; });
    if (n < 2) return pos.map(() => [0.5, 0.5]);
    const k = Math.sqrt(1 / n) * 0.9;
    let temp = 0.1;
    const dx = new Float64Array(n), dy = new Float64Array(n);
    for (let it = 0; it < iters; it++) {
      dx.fill(0); dy.fill(0);
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        let x = pos[i][0] - pos[j][0], y = pos[i][1] - pos[j][1];
        const d = Math.max(1e-4, Math.hypot(x, y)), fr = (k * k) / d;
        x /= d; y /= d;
        dx[i] += x * fr; dy[i] += y * fr; dx[j] -= x * fr; dy[j] -= y * fr;
      }
      for (const [a, b, wgt] of E) {
        let x = pos[a][0] - pos[b][0], y = pos[a][1] - pos[b][1];
        const d = Math.max(1e-4, Math.hypot(x, y)), fa = ((d * d) / k) * wgt;
        x /= d; y /= d;
        dx[a] -= x * fa; dy[a] -= y * fa; dx[b] += x * fa; dy[b] += y * fa;
      }
      for (let i = 0; i < n; i++) {
        dx[i] -= (pos[i][0] - 0.5) * 0.08; dy[i] -= (pos[i][1] - 0.5) * 0.08;
        const d = Math.max(1e-9, Math.hypot(dx[i], dy[i])), s = Math.min(d, temp) / d;
        pos[i][0] += dx[i] * s; pos[i][1] += dy[i] * s;
      }
      temp = Math.max(0.002, temp * 0.97);
    }
    const [x0, x1] = extent(pos.map((p) => p[0])), [y0, y1] = extent(pos.map((p) => p[1]));
    return pos.map((p) => [(p[0] - x0) / (x1 - x0 || 1), (p[1] - y0) / (y1 - y0 || 1)]);
  }

  /**
   * 関係のつながり（誰と誰が・何と何が）。ノード 150 以下を目安にする。
   * { title, nodes:[{id, label, group, value}], links:[{source, target, value}], height, labels:'auto'|'all'|'none' }
   */
  function network(host, spec) {
    const f = frame(host, spec, 'network');
    const nodes = (spec.nodes || []).map((n) => Object.assign({}, n, { id: String(n.id), label: String(n.label ?? n.id) }));
    const index = new Map(nodes.map((n, i) => [n.id, i]));
    const links = (spec.links || []).map((l) => ({ s: String(l.source), t: String(l.target), value: l.value == null ? 1 : +l.value }))
      .filter((l) => index.has(l.s) && index.has(l.t) && l.s !== l.t);
    if (!nodes.length) return empty(f, spec);
    const n = nodes.length;
    if (n > 300) console.warn('Dash.network: ノードが 300 を超えています。集約するか、隣接行列（Dash.table や heat）にしてください');
    nodes.forEach((d) => { d.deg = 0; d.nb = new Set(); });
    for (const l of links) { const a = nodes[index.get(l.s)], b = nodes[index.get(l.t)]; a.deg++; b.deg++; a.nb.add(b.id); b.nb.add(a.id); }
    const maxW = Math.max(1, ...links.map((l) => l.value));
    const layout = forceLayout(n, links.map((l) => [index.get(l.s), index.get(l.t), 0.5 + (0.5 * l.value) / maxW]), n > 300 ? 80 : 300);
    const groups = [...new Set(nodes.map((d) => d.group).filter((g) => g != null))];
    if (groups.length > 4) console.warn('Dash.network: グループが 4 を超えています。5 つ目以降は灰色の丸になります');
    const pal = palette(), mute = cssVar('--d-mute');
    const gi = (d) => (d.group == null ? -1 : groups.indexOf(d.group));
    const colorOf = (d) => { const i = gi(d); return i < 0 ? pal[0] : i < 4 ? pal[i] : mute; };
    const shapeOf = (d) => { const i = gi(d); return i < 0 || i >= 4 ? 'circle' : SHAPES[i]; };
    const sizeVal = (d) => (d.value != null ? +d.value : d.deg);
    const maxV = Math.max(1, ...nodes.map(sizeVal));
    const ranked = nodes.slice().sort((a, b) => sizeVal(b) - sizeVal(a));
    const mode = spec.labels || 'auto';
    const labelled = new Set(mode === 'all' || (mode === 'auto' && n <= 20) ? nodes.map((d) => d.id) : mode === 'none' ? [] : ranked.slice(0, 10).map((d) => d.id));
    if (mode === 'auto' && n > 20) f.note('labels', '名前は大きい上位 10 だけ表示（他は触れると出る）');
    const hubs = nodes.slice().sort((a, b) => b.deg - a.deg).slice(0, 3);
    const summary = `ネットワーク図。${n}個の点、${links.length}本のつながり。つながりが多いのは` + hubs.map((d) => `${d.label}（${d.deg}）`).join('、');

    responsive(f, (w) => {
      const H = spec.height || Math.min(520, Math.max(260, w * 0.6));
      const pad = 28;
      const svg = svgRoot(f, w, H, summary);
      const gL = sv('g'), gN = sv('g');
      const P = layout.map((p) => [pad + p[0] * (w - pad * 2), pad + p[1] * (H - pad * 2)]);
      const lineEls = links.map((l) => {
        const a = P[index.get(l.s)], b = P[index.get(l.t)];
        const e = sv('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: cssVar('--d-line'), 'stroke-width': 1 + (2.5 * l.value) / maxW, class: 'd-edge' });
        gL.append(e);
        return { l, e };
      });
      const nodeEls = nodes.map((d, i) => {
        const [x, y] = P[i], r = 4 + 8 * Math.sqrt(sizeVal(d) / maxV);
        const g = sv('g', { class: 'd-node' });
        g.append(marker(shapeOf(d), x, y, r, colorOf(d), { stroke: '#fff', 'stroke-width': 1.5 }));
        if (labelled.has(d.id)) g.append(sv('text', { x: x + r + 3, y, 'dominant-baseline': 'middle', class: 'd-direct d-halo', fill: cssVar('--d-text'), text: clip(d.label, 120) }));
        tipOn(f, g, `${d.label}${d.group != null ? `（${d.group}）` : ''} つながり ${d.deg}${d.value != null ? `・値 ${fmt(+d.value, spec.digits)}` : ''}`, n <= 150);
        const focus = () => {
          nodeEls.forEach(({ d: o, g: og }) => og.classList.toggle('is-dim', o.id !== d.id && !d.nb.has(o.id)));
          lineEls.forEach(({ l, e }) => e.classList.toggle('is-dim', l.s !== d.id && l.t !== d.id));
        };
        const clear = () => { nodeEls.forEach(({ g: og }) => og.classList.remove('is-dim')); lineEls.forEach(({ e }) => e.classList.remove('is-dim')); };
        g.addEventListener('mouseenter', focus); g.addEventListener('focus', focus);
        g.addEventListener('mouseleave', clear); g.addEventListener('blur', clear);
        gN.append(g);
        return { d, g };
      });
      svg.append(gL, gN);
      mount(f, svg);
    });
    if (groups.length) f.bottom.replaceChildren(legend(groups.map((g, i) => {
      const s = sv('svg', { width: 14, height: 14, 'aria-hidden': 'true' });
      s.append(marker(i < 4 ? SHAPES[i] : 'circle', 7, 7, 5, i < 4 ? pal[i] : mute));
      return { label: String(g), swatch: s };
    })));
    altTable(f, ['名前', 'グループ', 'つながりの数', '値'], nodes.slice().sort((a, b) => b.deg - a.deg).map((d) => [d.label, d.group ?? '—', d.deg, d.value != null ? +d.value : null]), { digits: spec.digits });
    return { summary: `${f.title}。${summary}` };
  }

  // ---------------------------------------------------------------- 要約

  /** 各部品が返した summary を並べ、画面全体の要約テキストにする（アクセシビリティ A-04） */
  function describe(host, results, heading) {
    host = resolveHost(host);
    host.replaceChildren(el('h2', { class: 'd-title', text: heading || 'このダッシュボードの要約' }),
      el('ul', { class: 'd-summary' }, results.filter(Boolean).map((r) => el('li', { text: r.summary }))));
  }

  root.Dash = { kpi, line, bar, area, donut, table, funnel, sankey, flow, network, describe, lttb, scale, contrast, fmt };
})(typeof window !== 'undefined' ? window : globalThis);
