// WBS: 作業の階層の表。親は子から集計。末端の作業は進捗と実績をその場で入力できる

import { visibleLedger } from '../../core/schema.js';
import { buildTree, DELAY_POINTS } from '../../core/wbs.js';
import { h, toast, todayStr } from '../dom.js';
import { store } from '../store.js';
import { itemTitle, statusBadge } from '../detail.js';

function numInput(id, field, value, label, max) {
  const el = h('input', { type: 'number', class: 'num-in', min: '0', max: String(max), step: field === 'progress' ? '5' : '0.5', 'data-fk': `${field}-${id}`, 'aria-label': label, value: value == null ? '' : String(value) });
  el.addEventListener('change', () => {
    const v = el.value === '' ? null : Number(el.value);
    if (v !== null && (!Number.isFinite(v) || v < 0 || v > max || (field === 'progress' && !Number.isInteger(v)))) { toast(`${label}は 0〜${max}${field === 'progress' ? ' の整数' : ''}で入れてください`); el.value = value == null ? '' : String(value); return; }
    const r = store.applyLocal([{ op: 'update', id, set: { [field]: v } }]);
    toast(r.ok ? `${label}を更新しました（取り消し可）` : r.errors.join(' / '));
  });
  return el;
}

export function renderWbs(root, app) {
  const ledger = visibleLedger(store.ledger, store.presentation);
  const tree = buildTree(ledger, todayStr());
  const hideActual = store.presentation;
  root.appendChild(h('div', { class: 'row' },
    h('h2', { text: 'WBS' }),
    h('span', { class: 'spacer' }),
    store.presentation ? null : h('button', { class: 'btn', type: 'button', onclick: () => app.go('prompts', { purpose: 'wbs' }) }, 'WBS の作成の指示文へ'),
    store.presentation ? null : h('button', { class: 'btn', type: 'button', onclick: () => app.go('prompts', { purpose: 'progress' }) }, '進捗の更新の指示文へ')));
  if (!tree.flat.length) {
    root.appendChild(h('div', { class: 'empty', text: 'まだ作業がありません。「WBS の作成」の指示文で、要件から作業を洗い出せます。' }));
    return;
  }
  root.appendChild(h('p', { class: 'muted small', text: `親の作業の見積・実績・進捗は子から自動で集計します（進捗は見積で重みづけ）。期間の経過割合より進捗が ${DELAY_POINTS} ポイント以上遅れている作業に「遅れ」と出します。末端の作業は進捗と実績をこの表で直接入力できます。` }));
  const cols = ['作業', '担当', '開始', '終了', '見積（人日）', ...(hideActual ? [] : ['実績（人日）']), '進捗（%）', '状態'];
  const thead = h('thead', null, h('tr', null, cols.map((c) => h('th', { scope: 'col', text: c }))));
  const tbody = h('tbody', null, tree.flat.map((n) => {
    const it = n.item;
    const editable = n.leaf && !it.milestone && !store.presentation;
    return h('tr', { 'data-id': it.id, class: [store.selectedId === it.id && 'selected', !n.leaf && 'wbs-parent', n.delayed && 'wbs-delayed'] },
      h('td', { class: 'title' },
        h('span', { class: 'indent', 'aria-hidden': 'true', text: '　'.repeat(n.depth) }),
        h('button', { class: 'linklike', type: 'button', 'data-fk': 'open-' + it.id, onclick: () => app.openItem(it.id) }, (it.milestone ? '◆ ' : '') + it.title),
        h('span', { class: 'mono small muted', text: ' ' + it.id }),
        n.delayed ? h('span', { class: 'badge high', text: '遅れ' }) : null),
      h('td', { class: 'small wrap', text: it.assignee ? (itemTitle(it.assignee, ledger) || it.assignee) : '' }),
      h('td', { class: 'small mono', text: it.start || '' }),
      h('td', { class: 'small mono', text: it.end || '' }),
      h('td', { class: 'small num', text: n.leaf ? (it.estimate ?? '') : String(n.rollup.estimate) }),
      hideActual ? null : h('td', { class: 'small num' }, editable ? numInput(it.id, 'actual', it.actual, `${it.title}の実績`, 100000) : (n.leaf ? (it.actual ?? '') : String(n.rollup.actual))),
      h('td', { class: 'small num' }, editable ? numInput(it.id, 'progress', it.progress, `${it.title}の進捗`, 100) : (it.milestone ? '' : String(n.rollup.progress))),
      h('td', null, statusBadge(it.kind, it.status)));
  }));
  root.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'list wbs-table', id: 'wbs-table' }, thead, tbody)));
}
