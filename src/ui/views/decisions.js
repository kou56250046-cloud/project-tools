// 決定ログ: 決定を日付の新しい順に並べる

import { buildBackrefs } from '../../core/schema.js';
import { h } from '../dom.js';
import { store } from '../store.js';
import { idButton, statusBadge, confBadge } from '../detail.js';

const opt = { showSuperseded: true };

export function renderDecisions(root, app) {
  const ledger = store.view();
  const back = buildBackrefs(ledger);
  const all = ledger.items.filter((it) => it.kind === 'decision');
  const list = all
    .filter((d) => opt.showSuperseded || d.status !== 'superseded')
    .sort((a, b) => (b.decidedAt || '').localeCompare(a.decidedAt || '') || b.id.localeCompare(a.id));

  root.appendChild(h('div', { class: 'row' },
    h('h2', { text: '決定ログ' }),
    h('span', { class: 'spacer' }),
    h('label', { class: 'row small' },
      h('input', { type: 'checkbox', checked: opt.showSuperseded, id: 'dec-show-superseded', onchange: (e) => { opt.showSuperseded = e.target.checked; app.refresh(); } }),
      '置き換え済みも表示')));
  root.appendChild(h('p', { class: 'muted small', text: `有効 ${all.filter((d) => d.status === 'valid').length}件 ／ 置き換え済み ${all.filter((d) => d.status === 'superseded').length}件` }));
  if (!list.length) { root.appendChild(h('div', { class: 'empty', text: 'まだ決定がありません。議事録を取り込むと、ここに並びます' })); return; }

  root.appendChild(h('div', { class: 'stack' }, list.map((d) => {
    const replacedBy = (back.get(d.id) || []).filter((b) => b.field === 'supersedes').map((b) => b.from);
    return h('article', {
      class: ['decision', d.status === 'superseded' && 'superseded'], tabindex: '0', role: 'button', 'data-id': d.id, 'aria-label': `${d.decidedAt || ''} ${d.title}`,
      onclick: () => app.openItem(d.id), onkeydown: (e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); app.openItem(d.id); } },
    },
    h('div', { class: 'row' },
      h('span', { class: 'date', text: d.decidedAt || '日付不明' }),
      h('span', { class: 'mono small muted', text: d.id }),
      statusBadge(d.kind, d.status), confBadge(d.confidence)),
    h('div', { class: 'decision-title', text: d.title }),
    d.reason ? h('div', { class: 'small' }, h('span', { class: 'muted', text: '理由: ' }), d.reason) : null,
    Array.isArray(d.alternatives) && d.alternatives.length
      ? h('div', { class: 'small' }, h('span', { class: 'muted', text: '検討した他の案:' }), h('ul', { class: 'alts' }, d.alternatives.map((a) => h('li', { text: a }))))
      : null,
    h('div', { class: 'small row' },
      h('span', { class: 'muted', text: '決めた人:' }),
      Array.isArray(d.decidedBy) && d.decidedBy.length ? d.decidedBy.map((id) => idButton(id, app, { withTitle: true })) : h('span', { class: 'muted', text: '不明' }),
      d.supersedes ? [h('span', { class: 'muted', text: '　置き換えた決定:' }), idButton(d.supersedes, app, { withTitle: true })] : null,
      replacedBy.length ? [h('span', { class: 'muted', text: '　この決定を置き換えた決定:' }), replacedBy.map((id) => idButton(id, app, { withTitle: true }))] : null));
  })));
}
