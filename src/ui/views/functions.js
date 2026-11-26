// 画面・連携・バッチの一覧

import { kindLabel, fieldSpec, enumLabel } from '../../core/schema.js';
import { fpTypeOf } from '../../core/fp.js';
import { h } from '../dom.js';
import { store } from '../store.js';
import { itemTitle, statusBadge } from '../detail.js';

const FUNC_KINDS = ['screen', 'interface', 'batch'];

function typeText(it) {
  if (it.kind === 'screen') return enumLabel(fieldSpec('screen', 'screenType').values, it.screenType);
  if (it.kind === 'interface') return `${enumLabel(fieldSpec('interface', 'direction').values, it.direction)}・${it.method ? enumLabel(fieldSpec('interface', 'method').values, it.method) : '方式未定'}`;
  return it.trigger || '';
}

export function renderFunctions(root, app) {
  const ledger = store.view();
  const list = ledger.items.filter((it) => FUNC_KINDS.includes(it.kind));
  root.appendChild(h('div', { class: 'row' },
    h('h2', { text: '画面・連携・バッチ' }),
    h('span', { class: 'spacer' }),
    store.presentation ? null : h('button', { class: 'btn', type: 'button', onclick: () => app.go('prompts', { purpose: 'functions' }) }, '画面・連携の洗い出しの指示文へ')));
  if (!list.length) { root.appendChild(h('div', { class: 'empty', text: 'まだ画面・連携・バッチがありません。「画面・連携の洗い出し」の指示文で、要件から作らせてください。' })); return; }
  const thead = h('thead', null, h('tr', null, ['ID', '種別', '名前', '区分・向き', '相手', '頻度', '項目', 'CRUD', 'FP の種類', '状態'].map((t) => h('th', { scope: 'col', text: t }))));
  const tbody = h('tbody', null, list.map((it) => {
    const fp = fpTypeOf(it);
    return h('tr', {
      tabindex: '0', 'data-id': it.id, class: store.selectedId === it.id ? 'selected' : null, 'aria-label': `${it.id} ${it.title}`,
      onclick: () => app.openItem(it.id),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); app.openItem(it.id); } },
    },
    h('td', { class: 'mono small', text: it.id }),
    h('td', null, h('span', { class: 'badge', text: kindLabel(it.kind) })),
    h('td', { class: 'title', text: it.title }),
    h('td', { class: 'small', text: typeText(it) }),
    h('td', { class: 'small wrap', text: it.system ? (itemTitle(it.system, ledger) || it.system) : '' }),
    h('td', { class: 'small', text: it.frequency || '' }),
    h('td', { class: 'small num', text: Array.isArray(it.fields) ? String(it.fields.length) : '' }),
    h('td', { class: 'small wrap', text: (it.crud || []).map((c) => `${itemTitle(c.entity, ledger) || c.entity}:${c.ops}`).join(' ／ ') }),
    h('td', { class: 'small', text: fp && fp.type ? fp.type : '数えない' }),
    h('td', null, statusBadge(it.kind, it.status)));
  }));
  root.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'list', id: 'functions-table' }, thead, tbody)));
}
