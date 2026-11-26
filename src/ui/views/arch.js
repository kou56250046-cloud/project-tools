// 構成図: 台帳のシステム・連携・バッチから、データの流れを自動で描く（配置は core/arch.js）
// 真ん中に案件のシステム、左に受信元、右に送信先。バッチは真ん中の箱の下、連携の無いシステムは図の下

import { archLayout, ARCH_BOX } from '../../core/arch.js';
import { h, s } from '../dom.js';
import { store } from '../store.js';

function archBox(box, label, sub, opts = {}) {
  const g = s('g', { class: ['arch-node', opts.self && 'is-self', box.dashed && 'is-retired', opts.id && store.selectedId === opts.id && 'is-selected'], 'data-id': opts.id || null,
    tabindex: opts.id ? '0' : null, role: opts.id ? 'button' : null, 'aria-label': opts.id ? label + (sub ? `（${sub}）` : '') : null });
  g.appendChild(s('rect', { x: box.x, y: box.y, width: box.w, height: box.h, rx: 6 }));
  g.appendChild(s('text', { class: 'arch-name', x: box.x + box.w / 2, y: box.y + (sub ? 23 : 33) }, label));
  if (sub) g.appendChild(s('text', { class: 'arch-sub', x: box.x + box.w / 2, y: box.y + 41 }, sub));
  if (opts.id) {
    const go = () => store.select(opts.id);
    g.addEventListener('click', go);
    g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } });
  }
  return g;
}

export function renderArch(root, app) {
  const ledger = store.view();
  const L = archLayout(ledger);
  root.appendChild(h('h2', { text: '構成図' }));
  root.appendChild(h('p', { class: 'muted small', text: '台帳のシステム・連携・バッチから自動で描きます。左が受信元、右が送信先です。同じ相手・同じ向きの連携は 1 本の線にまとめています。直すときは「画面・連携」や項目の詳細で連携の相手・向きを変えます。' }));
  if (L.empty) { root.appendChild(h('div', { class: 'empty', text: 'まだありません（システムと連携を足すと、ここに描きます）' })); return; }

  const svg = s('svg', { class: 'arch-svg', viewBox: `0 0 ${L.width} ${L.height}`, width: L.width, height: L.height, role: 'img', 'aria-label': '構成図' });
  svg.appendChild(s('defs', null, s('marker', { id: 'arch-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, s('path', { class: 'arch-arrowhead', d: 'M0,1 L10,5 L0,9 z' }))));
  svg.appendChild(s('text', { class: 'arch-col', x: ARCH_BOX.margin, y: 22 }, '受信元（こちらへ送ってくる）'));
  svg.appendChild(s('text', { class: 'arch-col', x: L.width - ARCH_BOX.margin, y: 22, 'text-anchor': 'end' }, '送信先（こちらから送る）'));
  for (const e of L.edges) {
    svg.appendChild(s('path', { class: 'arch-edge', d: `M${e.from[0]},${e.from[1]} L${e.to[0]},${e.to[1]}`, 'marker-end': 'url(#arch-arrow)' }));
    // ラベルは相手の箱の側に寄せて縦に並べる
    const lines = [...e.labels, ...(e.more ? [`ほか ${e.more} 件`] : [])];
    const x = e.direction === 'in' ? e.from[0] + 8 : e.to[0] - 8;
    const y0 = e.from[1] - 6 - (lines.length - 1) * ARCH_BOX.labelH;
    lines.forEach((t, k) => svg.appendChild(s('text', { class: 'arch-label', x, y: y0 + k * ARCH_BOX.labelH, 'text-anchor': e.direction === 'in' ? 'start' : 'end' }, t)));
  }
  for (const b of [...L.left, ...L.right]) svg.appendChild(archBox(b, b.system.title + b.mark, b.system.id, { id: b.system.id }));
  svg.appendChild(archBox(L.self, L.self.label, 'この案件', { self: true }));
  if (L.batches.length) {
    svg.appendChild(s('text', { class: 'arch-col', x: L.self.x, y: L.batchTop + 12 }, `バッチ（${L.batches.length} 件）`));
    L.batches.forEach((b, k) => svg.appendChild(s('text', { class: 'arch-batch', x: L.self.x + 6, y: L.batchTop + 30 + k * 17 }, `・${b.title}${b.frequency ? `（${b.frequency}）` : ''}`)));
  }
  root.appendChild(h('div', { class: 'graph-wrap', id: 'arch-chart' }, svg));
  if (L.unlinked.length) root.appendChild(h('section', { class: 'card stack', id: 'arch-unlinked' },
    h('h3', { text: `連携の無いシステム（${L.unlinked.length} 件）` }),
    h('div', { class: 'row' }, L.unlinked.map((u) => h('button', { class: ['btn', 'small', u.system.status === 'retired' && 'is-retired'], type: 'button', onclick: () => store.select(u.system.id) }, `${u.system.id} ${u.system.title}${u.mark}`)))));
}
