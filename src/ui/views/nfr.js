// 非機能: IPA 非機能要求グレードの 6 大項目ごとの状態

import { enumLabel } from '../../core/schema.js';
import { nfrStatus, NFR_STATES } from '../../core/nfr.js';
import { h } from '../dom.js';
import { store } from '../store.js';
import { idButton } from '../detail.js';

const STATE_TONE = { agreed: 'ok', defined: 'accent', asking: 'mid', none: 'high' };

export function renderNfr(root, app) {
  const rows = nfrStatus(store.view());
  root.appendChild(h('div', { class: 'row' },
    h('h2', { text: '非機能（IPA 非機能要求グレードの大項目）' }),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn', type: 'button', id: 'nfr-prompt', onclick: () => app.go('prompts', { purpose: 'nfr' }) }, '非機能の洗い出しの指示文へ')));
  root.appendChild(h('p', { class: 'muted small', text: '状態の決め方: 非機能要件がすべて合意済み → 合意済み ／ 非機能要件がある → 定義あり ／ 要件は無いが未回答の質問がある → 質問中 ／ それ以外 → 未着手。要件と質問は「非機能の大項目」で大項目に結びつきます。' }));
  const refs = (list) => list.length ? h('div', { class: 'refs' }, list.map((x) => h('div', null, idButton(x.id, app), ' ', x.title))) : h('span', { class: 'muted', text: '—' });
  const thead = h('thead', null, h('tr', null, ['大項目', '状態', '非機能要件', '未回答の質問', '回答済みの質問', '確認点（例）'].map((t) => h('th', { scope: 'col', text: t }))));
  const tbody = h('tbody', null, rows.map((c) => h('tr', { 'data-nfr': c.id, class: 'nocursor' },
    h('td', null, h('strong', { text: c.label })),
    h('td', null, h('span', { class: `badge ${STATE_TONE[c.state]}`, text: enumLabel(NFR_STATES, c.state) })),
    h('td', { class: 'wrap' }, refs(c.requirements)),
    h('td', { class: 'wrap' }, refs(c.openQuestions)),
    h('td', { class: 'wrap' }, refs(c.answeredQuestions)),
    h('td', { class: 'wrap small' }, h('ul', { class: 'points' }, c.points.map((p) => h('li', { text: p })))))));
  root.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'list nfr-table', id: 'nfr-table' }, thead, tbody)));
}
