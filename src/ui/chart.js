// 描画部品: 日付軸の折れ線（S カーブ）とガント。実行時に SVG を組む（style 属性・外部参照を使わない）

import { dayNumber } from '../core/schema.js';
import { dayToYmd } from '../core/wbs.js';
import { s, h } from './dom.js';

function textW(str, size) {
  let w = 0;
  for (const ch of String(str)) w += ch.charCodeAt(0) > 0xff ? size : size * 0.56;
  return w;
}
function clip(str, maxW, size) {
  if (textW(str, size) <= maxW) return str;
  let out = '';
  for (const ch of String(str)) { if (textW(out + ch + '…', size) > maxW) break; out += ch; }
  return out + '…';
}

// 日付の目盛り。週なら月曜、月なら 1 日
function ticks(d0, d1, unit) {
  const out = [];
  if (unit === 'week') {
    let d = d0 - ((d0 + 3) % 7 + 7) % 7;
    for (; d <= d1; d += 7) if (d >= d0) out.push(d);
  } else {
    const a = new Date(d0 * 86400000);
    let y = a.getUTCFullYear();
    let m = a.getUTCMonth();
    for (;;) {
      const d = Date.UTC(y, m, 1) / 86400000;
      if (d > d1) break;
      if (d >= d0) out.push(d);
      m++; if (m > 11) { m = 0; y++; }
    }
  }
  return out;
}

const md = (d) => { const x = dayToYmd(d); return `${Number(x.slice(5, 7))}/${Number(x.slice(8, 10))}`; };

// 折れ線。series: [{ key, label, points: [{ date, value | null }] }]
export function lineChart({ series, width = 760, height = 300, today, unit = 'week', ariaLabel = '折れ線グラフ' }) {
  const pad = { l: 48, r: 96, t: 16, b: 32 };
  const all = series.flatMap((sr) => sr.points.filter((p) => p.value !== null && p.value !== undefined));
  const svg = s('svg', { class: 'chart line-chart', width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': ariaLabel });
  if (!all.length) return svg;
  const days = series.flatMap((sr) => sr.points.map((p) => dayNumber(p.date)));
  const d0 = Math.min(...days);
  const d1 = Math.max(...days);
  const vmax = Math.max(1, ...all.map((p) => p.value)) * 1.08;
  const x = (d) => pad.l + (d1 === d0 ? 0 : (d - d0) / (d1 - d0)) * (width - pad.l - pad.r);
  const y = (v) => height - pad.b - (v / vmax) * (height - pad.t - pad.b);

  // 目盛り（縦は 5 本、横は週か月）
  for (let i = 0; i <= 4; i++) {
    const v = (vmax / 1.08) * i / 4;
    svg.appendChild(s('line', { class: 'grid', x1: pad.l, x2: width - pad.r, y1: y(v), y2: y(v) }));
    svg.appendChild(s('text', { class: 'axis', x: pad.l - 6, y: y(v) + 4, 'text-anchor': 'end' }, String(Math.round(v))));
  }
  const tk = ticks(d0, d1, (d1 - d0) > 120 ? 'month' : unit);
  const step = Math.max(1, Math.ceil(tk.length / 10));
  tk.forEach((d, i) => { if (i % step === 0) svg.appendChild(s('text', { class: 'axis', x: x(d), y: height - pad.b + 18, 'text-anchor': 'middle' }, md(d))); });
  svg.appendChild(s('line', { class: 'axis-line', x1: pad.l, x2: width - pad.r, y1: height - pad.b, y2: height - pad.b }));
  if (today) {
    const td = dayNumber(today);
    if (td >= d0 && td <= d1) {
      svg.appendChild(s('line', { class: 'today', x1: x(td), x2: x(td), y1: pad.t, y2: height - pad.b }));
      svg.appendChild(s('text', { class: 'today-label', x: x(td) + 4, y: pad.t + 10 }, '今日'));
    }
  }
  // 系列（線の端に名前を置く。色だけに頼らず線の形も変える）
  const used = [];
  for (const sr of series) {
    const pts = sr.points.filter((p) => p.value !== null && p.value !== undefined);
    if (!pts.length) continue;
    const dAttr = pts.map((p, i) => `${i ? 'L' : 'M'}${x(dayNumber(p.date)).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
    svg.appendChild(s('path', { class: `series s-${sr.key}`, d: dAttr }, s('title', null, sr.label)));
    for (const p of pts) svg.appendChild(s('circle', { class: `pt s-${sr.key}`, cx: x(dayNumber(p.date)), cy: y(p.value), r: 2.5 }, s('title', null, `${sr.label} ${p.date}: ${p.value}`)));
    const last = pts[pts.length - 1];
    let ly = y(last.value) + 4;
    while (used.some((u) => Math.abs(u - ly) < 13)) ly += 13;
    used.push(ly);
    svg.appendChild(s('text', { class: `end-label s-${sr.key}`, x: x(dayNumber(last.date)) + 6, y: ly }, `${sr.label} ${last.value}`));
  }
  return svg;
}

// ガント。rows: [{ id, label, depth, start, end, progress, milestone, leaf, delayed, dependsOn }]
export function ganttChart({ rows, unit = 'week', today, onSelect, selectedId }) {
  const ROW = 26;
  const LABEL = 280;
  const pxDay = unit === 'week' ? 14 : 3.2;
  const dated = rows.filter((r) => r.start && r.end);
  const svg = s('svg', { class: 'chart gantt', role: 'img', 'aria-label': 'ガントチャート' });
  if (!dated.length) { svg.setAttribute('width', 400); svg.setAttribute('height', 40); return svg; }
  const td = today ? dayNumber(today) : null;
  let d0 = Math.min(...dated.map((r) => dayNumber(r.start)));
  let d1 = Math.max(...dated.map((r) => dayNumber(r.end)));
  if (td !== null) { d0 = Math.min(d0, td); d1 = Math.max(d1, td); }
  d0 -= 3; d1 += 7;
  const top = 34;
  // 作業名は左に固定した別の SVG に描く（横に送っても名前が見えるように）
  const width = (d1 - d0 + 1) * pxDay + 20;
  const height = top + rows.length * ROW + 10;
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const labels = s('svg', { class: 'chart gantt gantt-labels', width: LABEL, height, viewBox: `0 0 ${LABEL} ${height}`, 'aria-hidden': 'true' },
    s('rect', { class: 'label-bg', x: 0, y: 0, width: LABEL, height }));
  const x = (d) => (d - d0) * pxDay;

  svg.appendChild(s('defs', null, s('marker', { id: 'gt-arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '6', markerHeight: '6', orient: 'auto-start-reverse' }, s('path', { d: 'M0,0 L10,5 L0,10 z', class: 'dep-head' }))));
  // 目盛り
  const tk = ticks(d0, d1, unit);
  for (const d of tk) {
    svg.appendChild(s('line', { class: 'grid', x1: x(d), x2: x(d), y1: top - 6, y2: height }));
    svg.appendChild(s('text', { class: 'axis', x: x(d) + 2, y: top - 12 }, unit === 'week' ? md(d) : dayToYmd(d).slice(0, 7)));
  }
  // 行
  const rowY = new Map();
  rows.forEach((r, i) => {
    const yy = top + i * ROW;
    rowY.set(r.id, yy);
    const g = s('g', {
      class: ['grow', r.delayed && 'delayed', r.id === selectedId && 'selected', !r.leaf && 'summary'].filter(Boolean).join(' '),
      'data-id': r.id, tabindex: '0', role: 'button', 'aria-label': `${r.label}${r.delayed ? '（遅れ）' : ''}`,
      onclick: () => onSelect && onSelect(r.id),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (onSelect) onSelect(r.id); } },
    });
    g.appendChild(s('rect', { class: 'row-bg', x: 0, y: yy, width, height: ROW }));
    labels.appendChild(s('g', {
      class: ['grow', r.delayed && 'delayed', r.id === selectedId && 'selected', !r.leaf && 'summary'].filter(Boolean).join(' '),
      onclick: () => onSelect && onSelect(r.id),
    },
    s('rect', { class: 'row-bg', x: 0, y: yy, width: LABEL, height: ROW }),
    s('text', { class: 'row-label', x: 8 + r.depth * 14, y: yy + 17 }, clip(r.label, LABEL - 16 - r.depth * 14, 12.5)),
    s('title', null, `${r.id} ${r.label}`)));
    if (r.start && r.end) {
      const xs = x(dayNumber(r.start));
      const xe = x(dayNumber(r.end) + 1);
      if (r.milestone) {
        const cx = x(dayNumber(r.start)) + pxDay / 2;
        const cy = yy + ROW / 2;
        g.appendChild(s('path', { class: 'milestone', d: `M${cx},${cy - 7} L${cx + 7},${cy} L${cx},${cy + 7} L${cx - 7},${cy} z` }));
        g.appendChild(s('text', { class: 'bar-note', x: cx + 10, y: cy + 4 }, r.start));
      } else if (!r.leaf) {
        g.appendChild(s('rect', { class: 'bar-summary', x: xs, y: yy + 9, width: Math.max(2, xe - xs), height: 8 }));
      } else {
        g.appendChild(s('rect', { class: 'bar', x: xs, y: yy + 6, width: Math.max(2, xe - xs), height: 14, rx: 3 }));
        const pw = Math.max(0, (xe - xs) * Math.min(100, r.progress || 0) / 100);
        if (pw > 0) g.appendChild(s('rect', { class: 'bar-progress', x: xs, y: yy + 6, width: pw, height: 14, rx: 3 }));
        g.appendChild(s('text', { class: 'bar-note', x: xe + 4, y: yy + 17 }, `${r.progress || 0}%${r.delayed ? '　遅れ' : ''}`));
      }
    }
    g.appendChild(s('title', null, `${r.id} ${r.label}${r.start ? `\n${r.start}〜${r.end}` : ''}${r.leaf && !r.milestone ? `\n進捗 ${r.progress || 0}%` : ''}${r.delayed ? '\n予定より遅れています' : ''}`));
    svg.appendChild(g);
  });
  // 前の作業からの矢印（終了 → 開始）
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const r of rows) {
    for (const p of r.dependsOn || []) {
      const a = byId.get(p);
      if (!a || !a.end || !r.start) continue;
      const x1 = a.milestone ? x(dayNumber(a.start)) + pxDay / 2 + 7 : x(dayNumber(a.end) + 1);
      const y1 = rowY.get(a.id) + ROW / 2;
      const x2 = r.milestone ? x(dayNumber(r.start)) + pxDay / 2 - 7 : x(dayNumber(r.start));
      const y2 = rowY.get(r.id) + ROW / 2;
      const mx = Math.max(x1 + 6, Math.min(x2 - 6, x1 + 12));
      svg.appendChild(s('path', { class: 'dep', d: `M${x1},${y1} H${mx} V${y2} H${x2}`, 'marker-end': 'url(#gt-arrow)' }));
    }
  }
  if (td !== null) {
    svg.appendChild(s('line', { class: 'today', x1: x(td) + pxDay / 2, x2: x(td) + pxDay / 2, y1: top - 6, y2: height }));
    svg.appendChild(s('text', { class: 'today-label', x: x(td) + pxDay / 2 + 3, y: top - 22 }, '今日'));
  }
  return h('div', { class: 'gantt-split', 'data-today-x': td === null ? '' : String(Math.round(x(td))) }, labels, svg);
}
