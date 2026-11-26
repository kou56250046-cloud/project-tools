// 関係図: 関係者とシステムを立場ごとの列に並べ、関係を線とラベルで描く（実行時に SVG を描く）

import { h, s } from '../dom.js';
import { store } from '../store.js';

const COLS = [
  { key: 'customer', label: '顧客' },
  { key: 'own', label: '自社' },
  { key: 'vendor', label: '協力会社' },
  { key: 'system', label: 'システム' },
];
const NODE_W = 160;
const NODE_H = 40;
const GAP_Y = 64;
const COL_GAP = 96;
const PAD_X = 40;
const TOP = 56;
const LABEL_STEP = 16;
const LABEL_TRIES = 6;

function colOf(it) { return it.kind === 'system' ? 'system' : it.side; }

// 文字幅の概算（全角 12.5px・半角 7px）。SVG の getBBox を使わずに配置を決めるため
function textWidth(str, size) {
  let w = 0;
  for (const ch of str) w += ch.charCodeAt(0) > 0xff ? size : size * 0.56;
  return w;
}

function truncate(str, maxW, size) {
  if (textWidth(str, size) <= maxW) return str;
  let out = '';
  for (const ch of str) {
    if (textWidth(out + ch + '…', size) > maxW) break;
    out += ch;
  }
  return out + '…';
}

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// レイアウトを計算する（DOM に依存しない）
export function layoutGraph(ledger) {
  const nodes = ledger.items.filter((it) => it.kind === 'stakeholder' || it.kind === 'system');
  const pos = new Map();
  let maxRows = 0;
  COLS.forEach((c, ci) => {
    const inCol = nodes.filter((n) => colOf(n) === c.key).sort((a, b) => a.id.localeCompare(b.id));
    maxRows = Math.max(maxRows, inCol.length);
    inCol.forEach((n, ri) => pos.set(n.id, { x: PAD_X + ci * (NODE_W + COL_GAP), y: TOP + ri * GAP_Y, col: ci, node: n }));
  });
  const width = PAD_X * 2 + COLS.length * NODE_W + (COLS.length - 1) * COL_GAP;
  const height = TOP + Math.max(1, maxRows) * GAP_Y + 20;

  const placed = [];       // 置いたラベルの矩形
  const nodeRects = [...pos.values()].map((p) => ({ x: p.x, y: p.y, w: NODE_W, h: NODE_H }));
  const edges = [];
  let hidden = 0;
  for (const r of ledger.relations) {
    const a = pos.get(r.from);
    const b = pos.get(r.to);
    if (!a || !b) continue;
    let d;
    let mx;
    let my;
    if (a.col === b.col) {
      // 同じ列: 列の外側へ弧を描く
      const right = a.col < COLS.length - 1;
      const x0 = right ? a.x + NODE_W : a.x;
      const bulge = (right ? 1 : -1) * (40 + Math.abs(b.y - a.y) * 0.25);
      const y1 = a.y + NODE_H / 2;
      const y2 = b.y + NODE_H / 2;
      d = `M${x0},${y1} C${x0 + bulge},${y1} ${x0 + bulge},${y2} ${x0},${y2}`;
      mx = x0 + bulge * 0.75;
      my = (y1 + y2) / 2;
    } else {
      const leftToRight = a.x < b.x;
      const x1 = leftToRight ? a.x + NODE_W : a.x;
      const x2 = leftToRight ? b.x : b.x + NODE_W;
      const y1 = a.y + NODE_H / 2;
      const y2 = b.y + NODE_H / 2;
      const cx = (x1 + x2) / 2;
      d = `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`;
      mx = cx;
      my = (y1 + y2) / 2;
    }
    // ラベルの重なりを避ける: 縦に 16px ずつずらし、だめなら省略
    const lw = textWidth(r.label, 11) + 8;
    const lh = 16;
    let rect = null;
    for (let t = 0; t <= LABEL_TRIES; t++) {
      const offset = t === 0 ? 0 : (t % 2 ? 1 : -1) * Math.ceil(t / 2) * LABEL_STEP;
      const cand = { x: mx - lw / 2, y: my - lh / 2 + offset, w: lw, h: lh };
      if (!placed.some((p) => overlap(p, cand)) && !nodeRects.some((p) => overlap(p, cand))) { rect = cand; break; }
    }
    if (rect) placed.push(rect); else hidden++;
    edges.push({ rel: r, d, label: rect });
  }
  return { pos, edges, width, height, hidden };
}

export function renderGraph(root, app) {
  const ledger = store.view();
  const sel = store.selectedId;
  const L = layoutGraph(ledger);

  root.appendChild(h('h2', { text: '関係図' }));
  root.appendChild(h('div', { class: 'legend' },
    COLS.map((c) => h('span', null, h('span', { class: `sw sw-${c.key}` }), c.label)),
    h('span', { class: 'muted', text: '点線の枠: システム ／ 細い点線: 関与なし・廃止 ／ 矢印: 関係の向き（例: 発注する側 → される側）' }),
    L.hidden ? h('span', { class: 'badge mid', id: 'graph-hidden', text: `重なるためラベルを省略した線 ${L.hidden}本（線を押すと読めます）` }) : null));

  if (!L.pos.size) {
    root.appendChild(h('div', { class: 'empty', text: '関係者もシステムもまだありません。「指示文」の「初期作成」で洗い出せます' }));
    return;
  }

  // 強調: 選択ノードとつながるノード・線
  const neighbors = new Set();
  const hlEdges = new Set();
  const selIsNode = sel && L.pos.has(sel);
  if (selIsNode) {
    neighbors.add(sel);
    for (const e of L.edges) {
      if (e.rel.from === sel || e.rel.to === sel) { neighbors.add(e.rel.from); neighbors.add(e.rel.to); hlEdges.add(e.rel.id); }
    }
  }

  const svg = s('svg', { class: 'graph', width: L.width, height: L.height, viewBox: `0 0 ${L.width} ${L.height}`, role: 'img', 'aria-label': '関係者とシステムの関係図' });
  // 線の向き（from → to）を矢印で示す。強調時は色を変えた矢印を使う
  const arrow = (id, cls) => s('marker', { id, viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' },
    s('path', { d: 'M0,0 L10,5 L0,10 z', class: cls }));
  svg.appendChild(s('defs', null, arrow('wb-arrow', 'arrowhead'), arrow('wb-arrow-hl', 'arrowhead hl-head')));
  svg.appendChild(s('rect', { x: 0, y: 0, width: L.width, height: L.height, fill: 'transparent', onclick: () => { if (selIsNode) app.closeDetail(); } }));
  COLS.forEach((c, ci) => {
    svg.appendChild(s('text', { class: 'col-title', x: PAD_X + ci * (NODE_W + COL_GAP) + NODE_W / 2, y: 28, 'text-anchor': 'middle' }, c.label));
  });

  const edgeLayer = s('g', { class: 'edges' });
  for (const e of L.edges) {
    const dim = selIsNode && !hlEdges.has(e.rel.id);
    const title = `${e.rel.id}: ${e.rel.label}`;
    const g = s('g', { class: ['edge', dim && 'dim', hlEdges.has(e.rel.id) && 'hl'], 'data-rel': e.rel.id },
      s('title', null, title),
      s('path', { d: e.d, 'marker-end': hlEdges.has(e.rel.id) ? 'url(#wb-arrow-hl)' : 'url(#wb-arrow)' }),
      s('path', { d: e.d, class: 'hit', onclick: (ev) => { ev.stopPropagation(); app.openItem(e.rel.from); } }));
    if (e.label) {
      g.appendChild(s('rect', { class: 'elabel-bg', x: e.label.x, y: e.label.y, width: e.label.w, height: e.label.h, rx: 3 }));
      g.appendChild(s('text', { x: e.label.x + e.label.w / 2, y: e.label.y + 12, 'text-anchor': 'middle' }, e.rel.label));
    }
    edgeLayer.appendChild(g);
  }
  svg.appendChild(edgeLayer);

  for (const [id, p] of L.pos) {
    const n = p.node;
    const dim = selIsNode && !neighbors.has(id);
    const inactive = n.status === 'inactive' || n.status === 'retired';
    const sub = n.kind === 'system' ? (n.status === 'planned' ? '新規予定' : n.status === 'retired' ? '廃止' : '既存') : [n.org, n.role].filter(Boolean).join(' ');
    svg.appendChild(s('g', {
      class: ['node', `side-${colOf(n)}`, dim && 'dim', id === sel && 'selected', inactive && 'inactive'],
      transform: `translate(${p.x},${p.y})`, tabindex: '0', role: 'button', 'aria-label': `${n.title}（${id}）`, 'data-id': id,
      onclick: (ev) => { ev.stopPropagation(); if (id === sel) app.closeDetail(); else app.openItem(id); },
      onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); if (id === sel) app.closeDetail(); else app.openItem(id); } },
    },
    s('title', null, `${id} ${n.title}${sub ? ' / ' + sub : ''}`),
    s('rect', { width: NODE_W, height: NODE_H }),
    s('text', { x: 10, y: 17 }, truncate(n.title, NODE_W - 20, 12.5)),
    s('text', { class: 'sub', x: 10, y: 32 }, truncate(sub || id, NODE_W - 20, 11))));
  }
  root.appendChild(h('div', { class: 'graph-wrap' }, svg));
  root.appendChild(h('p', { class: 'muted small', text: `関係者・システム ${L.pos.size}件 ／ 関係 ${L.edges.length}本。四角を押すと、つながる相手以外が薄くなり、右に関係する項目が出ます。` }));
}
