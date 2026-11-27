// 業務フロー・判断の図を SVG の DOM として組む（gemini-kit flow.js の toSVG を、文字列ではなく s() で写したもの）
// 配置は core/flow.js の FLOWCHART.layout。色はすべて styles.css の変数（.fl-* のクラス）で決め、ここでは色を持たない
// overlay（判断・データの画面）: { marks: {ID: 'ok'|'open'|'none'}, visited: [ID], taken: ['A>B'], current: ID, focus: ID（選んでいる箱）, titles: {ID: 文字}, onSelect(id) }

import { FLOWCHART } from '../core/flow.js';
import { flowGeometry } from '../core/flowsafe.js';
import { s, h } from './dom.js';


function flShape(n, attrs) {
  const { x, y, w, h } = n;
  switch (n.type) {
    case 'start':
    case 'end': return s('rect', { x, y, width: w, height: h, rx: h / 2, ...attrs });
    case 'decision': return s('polygon', { points: `${n.cx},${y} ${x + w},${n.cy} ${n.cx},${y + h} ${x},${n.cy}`, ...attrs });
    case 'data': { const k = 12; return s('polygon', { points: `${x + k},${y} ${x + w},${y} ${x + w - k},${y + h} ${x},${y + h}`, ...attrs }); }
    case 'doc': { const b = y + h - 8; return s('path', { d: `M${x},${y} H${x + w} V${b} C${x + w * 0.75},${b - 10} ${x + w * 0.5},${b + 12} ${x + w * 0.25},${b + 4} S${x + 4},${b - 4} ${x},${b + 2} Z`, ...attrs }); }
    default: return s('rect', { x, y, width: w, height: h, rx: 4, ...attrs });
  }
}

// 分岐の出口の色は「はい」「いいえ」の 2 色だけ。ほかの出口は灰色の線（design.md の決めごと）
const flTone = (e) => (e.tone === 'pos' || e.tone === 'neg' ? `tone-${e.tone}` : null);
const flPath = (pts) => pts.map((p, k) => `${k ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');

// 図ごとに矢じりの id を変える（同じ画面に 2 枚出しても衝突しない）
let flSeq = 0;

export function renderFlowSvg(geo, overlay) {
  const ov = overlay || null;
  const marks = (ov && ov.marks) || {};
  const visited = new Set((ov && ov.visited) || []);
  const taken = new Set((ov && ov.taken) || []);
  const { ROLES, MARK, LANE_BAR, nodeLineW, roleLabel, roleLabelPos, textW } = FLOWCHART;
  const uid = `fl${++flSeq}`;
  const svg = s('svg', { class: 'bfl-svg', viewBox: `0 0 ${geo.width} ${geo.height}`, width: geo.width, height: geo.height, role: ov ? 'group' : 'img', 'aria-label': geo.title || '業務フロー' });
  const tones = ['plain', 'tone-pos', 'tone-neg'];
  svg.appendChild(s('defs', null, tones.map((t) => s('marker', { id: `${uid}-${t}`, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 8, markerHeight: 8, orient: 'auto-start-reverse' }, s('path', { class: ['bfl-arrowhead', t !== 'plain' && t], d: 'M0,1 L10,5 L0,9 z' })))));
  svg.appendChild(s('rect', { class: 'bfl-bg', x: 0, y: 0, width: geo.width, height: geo.height }));
  if (geo.title) svg.appendChild(s('text', { class: 'bfl-title', x: geo.left, y: geo.titleY }, geo.title));
  geo.lanes.forEach((ln, i) => {
    const alt = i % 2 ? 'is-b' : 'is-a';
    svg.appendChild(s('rect', { class: ['bfl-lane', alt], x: geo.left, y: ln.y, width: geo.right - geo.left, height: ln.h }));
    svg.appendChild(s('rect', { class: 'bfl-lane-head', x: geo.left, y: ln.y, width: geo.laneHeaderW, height: ln.h }));
    svg.appendChild(s('rect', { class: 'bfl-lane-bar', x: geo.left, y: ln.y, width: LANE_BAR, height: ln.h }));
    const ty = ln.y + ln.h / 2 - ((ln.lines.length - 1) * 17) / 2 + 5;
    ln.lines.forEach((l, k) => svg.appendChild(s('text', { class: 'bfl-lane-name', x: geo.left + (geo.laneHeaderW + LANE_BAR) / 2, y: ty + k * 17 }, l)));
  });
  // 通った線は下に太い淡い線を敷く。線は白い縁取りの上に描き、分岐の色の線を灰色の線より後に描く
  if (ov) for (const e of geo.edges) if (taken.has(`${e.from}>${e.to}`)) svg.appendChild(s('path', { class: 'bfl-taken', d: flPath(e.points) }));
  const order = geo.edges.map((e, i) => i).sort((a, b) => (flTone(geo.edges[a]) ? 1 : 0) - (flTone(geo.edges[b]) ? 1 : 0) || a - b);
  for (const i of order) {
    const e = geo.edges[i];
    const t = flTone(e);
    const d = flPath(e.points);
    svg.appendChild(s('path', { class: 'bfl-edge-under', d }));
    svg.appendChild(s('path', { class: ['bfl-edge', t, e.dashed && 'is-dashed'], d, 'marker-end': `url(#${uid}-${t || 'plain'})` }));
  }
  for (const n of geo.nodes) {
    const role = n.role && ROLES[n.role] ? n.role : null;
    const cls = ['bfl-node', `type-${n.type}`, role && `role-${role}`];
    svg.appendChild(flShape(n, { class: cls, 'stroke-width': nodeLineW(n) * 1.2 }));
    if (n.type === 'sub') svg.appendChild(s('path', { class: ['bfl-sub-line', role && `role-${role}`], d: `M${n.x + 9},${n.y} V${n.y + n.h} M${n.x + n.w - 9},${n.y} V${n.y + n.h}` }));
    const lh = geo.lineH;
    const ty = n.cy - ((n.lines.length - 1) * lh) / 2 + geo.fontSize * 0.36 - (n.type === 'doc' ? 4 : 0);
    n.lines.forEach((l, k) => svg.appendChild(s('text', { class: ['bfl-node-text', n.type === 'decision' && 'is-bold'], x: n.cx, y: ty + k * lh, 'font-size': geo.fontSize }, l)));
    if (ov) {
      const mk = marks[n.id];
      if (MARK[mk] && mk !== 'ok') svg.appendChild(flShape(n, { class: ['bfl-mark-frame', `mark-${mk}`] }));
      if (ov.current === n.id) svg.appendChild(flShape(n, { class: 'bfl-current' }));
      else if (visited.has(n.id)) svg.appendChild(flShape(n, { class: 'bfl-visited' }));
    }
    if (n.notes.length) svg.appendChild(s('text', { class: 'bfl-note-no', x: n.x + n.w - (ov && MARK[marks[n.id]] ? 22 : 0), y: n.y - 3 }, n.notes.map((x) => '※' + x).join(' ')));
    const rl = roleLabel(n);
    if (rl) {
      const p = roleLabelPos(n);
      svg.appendChild(s('text', { class: ['bfl-role-label', `role-${n.role}`], x: p.x, y: p.y }, rl));
    }
  }
  for (const e of geo.edges) {
    if (!e.label || !e.labelPos) continue;
    svg.appendChild(s('text', { class: ['bfl-edge-label', flTone(e)], x: e.labelPos.x, y: e.labelPos.y, 'text-anchor': e.labelPos.anchor, 'font-size': geo.labelSize }, e.label));
  }
  if (geo.roles && geo.roles.length) {
    const yy = geo.roleY;
    let lx = geo.left;
    svg.appendChild(s('text', { class: 'bfl-legend', x: lx, y: yy + 11 }, '区分：'));
    lx += textW('区分：', 12) + 4;
    for (const r of geo.roles) {
      svg.appendChild(s('rect', { class: ['bfl-legend-box', `role-${r.key}`], x: lx, y: yy, width: 14, height: 14, rx: 2 }));
      svg.appendChild(s('text', { class: ['bfl-legend-role', `role-${r.key}`], x: lx + 19, y: yy + 11 }, r.name));
      lx += 19 + textW(r.name, 12) + 18;
    }
  }
  let ly = geo.legendY;
  for (const nt of geo.notes) for (const l of nt.text) { ly += 17; svg.appendChild(s('text', { class: 'bfl-legend', x: geo.left, y: ly }, l)); }
  if (ov) {
    // 状態の印（色だけに頼らず記号でも区別する）
    for (const n of geo.nodes) {
      const mk = MARK[marks[n.id]];
      if (!mk) continue;
      const cx = n.type === 'decision' ? n.x + n.w * 0.75 + 4 : n.x + n.w - 6, cy = n.type === 'decision' ? n.y + n.h * 0.25 - 4 : n.y + 2;
      svg.appendChild(s('circle', { class: ['bfl-mark', `mark-${marks[n.id]}`], cx, cy, r: 9 }));
      svg.appendChild(s('text', { class: 'bfl-mark-sym', x: cx, y: cy + 4.5 }, mk.sym));
    }
    // 当たり判定は箱と同じ形。どの箱にも Tab で止まり、Enter・Space で選ぶ
    for (const n of geo.nodes) {
      const t = (ov.titles && ov.titles[n.id]) || n.lines.join('');
      const mk = MARK[marks[n.id]];
      const el = flShape(n, { class: ['bfl-hit', ov.focus === n.id && 'is-focus'], 'data-node': n.id, tabindex: 0, role: 'button', 'aria-pressed': ov.focus ? String(ov.focus === n.id) : null, 'aria-label': `${n.id} ${t}${mk ? '（' + mk.word + '）' : ''}` });
      el.appendChild(s('title', null, `${n.id} ${t}${mk ? '：' + mk.word : ''}`));
      const pick = () => { if (ov.onSelect) ov.onSelect(n.id); };
      el.addEventListener('click', pick);
      el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(); } });
      svg.appendChild(el);
    }
  }
  return svg;
}

// 図の枠: 「幅に合わせる／実寸」の切り替えと、右に続きがあるときの一言（切れた図を全体と読み違えないように）
// 切り替えは画面をまたいで覚える（業務フロー・判断・データで共通）
let flowFit = false;
export function flowFrame(svg, cls) {
  const wrap = h('div', { class: ['graph-wrap', 'bfl-frame', cls, flowFit && 'is-fit'] }, svg);
  const hint = h('p', { class: 'small muted bfl-more', hidden: true, text: '→ 図は右に続きます（横にスクロールするか「幅に合わせる」）' });
  const btn = h('button', { class: 'btn small', type: 'button', 'aria-pressed': String(flowFit), onclick: () => {
    flowFit = !flowFit;
    wrap.classList.toggle('is-fit', flowFit);
    btn.setAttribute('aria-pressed', String(flowFit));
    btn.textContent = flowFit ? '実寸で見る' : '幅に合わせる';
    check();
  } }, flowFit ? '実寸で見る' : '幅に合わせる');
  // 画面に置かれてから、はみ出しているかを測る
  const check = () => { hint.hidden = !(wrap.isConnected && wrap.scrollWidth > wrap.clientWidth + 2); };
  setTimeout(check, 0);
  return h('div', { class: 'stack bfl-figure-box' }, h('div', { class: 'row' }, btn, hint), wrap);
}

// フロー記法 → SVG の文字列（書き出す HTML に入れる。描けなければ ''）（P6d）
export function flowSvgString(notation) {
  const r = flowGeometry(notation);
  if (!r.geo) return '';
  return new XMLSerializer().serializeToString(renderFlowSvg(r.geo));
}
// 図の書式（:root の色の変数と .bfl- の規則）を、この画面の CSS から集める（書き出す HTML に入れる）
export function flowCssText() {
  const out = [];
  for (const sh of document.styleSheets) {
    let rules;
    try { rules = sh.cssRules; } catch (e) { continue; }
    for (const r of rules) if (r.selectorText && (r.selectorText === ':root' || r.selectorText.includes('bfl-'))) out.push(r.cssText);
  }
  return out.join('\n');
}
