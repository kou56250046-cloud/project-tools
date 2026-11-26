// ガント: 作業を日付の横棒で出す。今日の線・進捗・マイルストーン・前の作業からの矢印・遅れ

import { visibleLedger } from '../../core/schema.js';
import { buildTree } from '../../core/wbs.js';
import { h, todayStr } from '../dom.js';
import { store } from '../store.js';
import { ganttChart } from '../chart.js';

const ganttState = { unit: 'week' };

export function renderGantt(root, app) {
  const ledger = visibleLedger(store.ledger, store.presentation);
  const today = todayStr();
  const tree = buildTree(ledger, today);
  root.appendChild(h('div', { class: 'row' },
    h('h2', { text: 'ガント' }),
    h('span', { class: 'spacer' }),
    h('div', { class: 'toggle', role: 'group', 'aria-label': '表示の幅' },
      h('button', { type: 'button', class: 'accept', id: 'gantt-week', 'aria-pressed': String(ganttState.unit === 'week'), onclick: () => { ganttState.unit = 'week'; app.refresh(); } }, '週'),
      h('button', { type: 'button', class: 'accept', id: 'gantt-month', 'aria-pressed': String(ganttState.unit === 'month'), onclick: () => { ganttState.unit = 'month'; app.refresh(); } }, '月'))));
  if (!tree.flat.length) { root.appendChild(h('div', { class: 'empty', text: 'まだ作業がありません。' })); return; }
  const rows = tree.flat.map((n) => ({
    id: n.item.id, label: n.item.title, depth: n.depth, start: n.item.start, end: n.item.end,
    progress: n.leaf ? n.item.progress : n.rollup.progress, milestone: !!n.item.milestone, leaf: n.leaf, delayed: n.delayed,
    dependsOn: n.item.dependsOn || [],
  }));
  const delayed = rows.filter((r) => r.delayed).length;
  root.appendChild(h('p', { class: 'muted small', text: `棒の濃い部分が進捗、◆ がマイルストーン、赤い点線が今日、矢印が前の作業です。${delayed ? `遅れている作業: ${delayed}件（赤枠と「遅れ」の文字）。` : ''}行を押すと詳細が開きます。` }));
  const chart = ganttChart({ rows, unit: ganttState.unit, today, selectedId: store.selectedId, onSelect: (id) => app.openItem(id) });
  const wrap = h('div', { class: 'chart-wrap graph-wrap', id: 'gantt-wrap' }, chart);
  root.appendChild(wrap);
  // 初めて表示したときは今日の少し手前まで送る（描き直しではスクロール位置を保つので、0 のときだけ）
  setTimeout(() => {
    const tx = Number(chart.dataset ? chart.dataset.todayX : '');
    if (wrap.scrollLeft === 0 && tx > 240) wrap.scrollLeft = tx - 240;
  }, 0);
}
