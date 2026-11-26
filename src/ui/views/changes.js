// 変更管理: 変更要求の一覧と、影響する作業の見積の合計

import { visibleLedger } from '../../core/schema.js';
import { impactOf } from '../../core/impact.js';
import { h } from '../dom.js';
import { store } from '../store.js';
import { itemTitle, statusBadge } from '../detail.js';

export function renderChanges(root, app) {
  const ledger = visibleLedger(store.ledger, store.presentation);
  const list = ledger.items.filter((it) => it.kind === 'change');
  root.appendChild(h('h2', { text: '変更管理' }));
  root.appendChild(h('p', { class: 'muted small', text: '変更要求を押すと、詳細パネルに影響範囲（対象から 2 段までたどった作業・決定・課題など）と、影響する作業の見積の合計が出ます。変更要求書の下書きもそこからコピーできます。変更要求は議事録や自由指示の取込で足せます。' }));
  if (!list.length) { root.appendChild(h('div', { class: 'empty', text: 'まだ変更要求がありません。' })); return; }
  const thead = h('thead', null, h('tr', null, ['ID', '変更要求', '状態', '依頼者', '対象', '影響する作業の見積', '追加工数の見込み'].map((t) => h('th', { scope: 'col', text: t }))));
  const tbody = h('tbody', null, list.map((cr) => {
    const imp = impactOf(ledger, [cr.id]);
    return h('tr', {
      tabindex: '0', 'data-id': cr.id, class: store.selectedId === cr.id ? 'selected' : null, 'aria-label': `${cr.id} ${cr.title}`,
      onclick: () => app.openItem(cr.id),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); app.openItem(cr.id); } },
    },
    h('td', { class: 'mono small', text: cr.id }),
    h('td', { class: 'title', text: cr.title }),
    h('td', null, statusBadge(cr.kind, cr.status)),
    h('td', { class: 'small wrap', text: cr.requestedBy ? (itemTitle(cr.requestedBy, ledger) || cr.requestedBy) : '' }),
    h('td', { class: 'small wrap', text: (cr.links || []).join(', ') }),
    h('td', { class: 'small num', text: `${imp.taskEstimate} 人日（${imp.tasks.length}件）` }),
    h('td', { class: 'small num', text: typeof cr.extraEstimate === 'number' ? `${cr.extraEstimate} 人日` : '未見積' }));
  }));
  root.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'list', id: 'changes-table' }, thead, tbody)));
}
