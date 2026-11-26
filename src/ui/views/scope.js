// スコープ: ベースラインの記録、ベースラインと今の差、要望・要件の範囲の一覧

import { SCOPE, enumLabel, kindLabel, afterBaselineIds } from '../../core/schema.js';
import { baselineDiff } from '../../core/hearing.js';
import { h, toast, todayStr } from '../dom.js';
import { store } from '../store.js';
import { idButton, statusBadge } from '../detail.js';

const scopeState = { baselineId: null };
const SCOPE_TONE = { in: 'ok', out: 'high', tbd: 'mid' };

export function scopeBadge(scope) {
  const v = scope || 'tbd';
  return h('span', { class: `badge ${SCOPE_TONE[v]}`, text: enumLabel(SCOPE, v) });
}

function diffSection(title, rows, empty) {
  return h('section', { class: 'card' },
    h('h3', { text: `${title}（${rows.length}件）` }),
    rows.length ? h('ul', { class: 'ref-list' }, rows) : h('p', { class: 'muted small', text: empty }));
}

export function renderScope(root, app) {
  const ledger = store.view();
  const bls = ledger.baselines || [];
  if (!scopeState.baselineId || !bls.some((b) => b.id === scopeState.baselineId)) scopeState.baselineId = bls.length ? bls[bls.length - 1].id : null;

  root.appendChild(h('h2', { text: 'スコープ' }));

  const name = h('input', { type: 'text', id: 'bl-name', placeholder: '例: 要件定義 合意版', 'aria-label': 'ベースラインの名前' });
  const date = h('input', { type: 'date', id: 'bl-date', value: todayStr(), 'aria-label': 'ベースラインの日付' });
  root.appendChild(h('section', { class: 'card stack' },
    h('h3', { text: 'ベースラインを記録する' }),
    h('p', { class: 'small muted', text: '今の要望・要件の ID・題名・範囲・状態を、名前と日付をつけて残します。合意した時点で記録すると、その後に増えた要望が分かります。' }),
    h('div', { class: 'row' }, name, date, h('button', { class: 'btn primary', type: 'button', id: 'bl-record', onclick: () => {
      if (!name.value.trim()) { toast('名前を入れてください'); name.focus(); return; }
      const id = store.recordBaseline(name.value.trim(), date.value || todayStr());
      scopeState.baselineId = id;
      toast(`ベースライン ${id} を記録しました（取り消し可）`);
    } }, '記録する'))));

  if (!bls.length) {
    root.appendChild(h('p', { class: 'notice', text: 'まだベースラインがありません。要望・要件を顧客と合意したら記録してください。' }));
  } else {
    const sel = h('select', { id: 'bl-select', 'aria-label': '比べるベースライン' }, bls.slice().reverse().map((b) => h('option', { value: b.id, selected: b.id === scopeState.baselineId, text: `${b.date}　${b.name}（${b.id}・${b.items.length}件）` })));
    sel.addEventListener('change', () => { scopeState.baselineId = sel.value; app.refresh(); });
    const b = bls.find((x) => x.id === scopeState.baselineId);
    const d = baselineDiff(b, ledger);
    const line = (it, extra) => h('li', null, idButton(it.id, app), h('span', { class: 'badge', text: kindLabel(it.kind) }), h('span', { text: it.title }), extra);
    root.appendChild(h('div', { class: 'row' }, h('label', { class: 'row' }, '比べるベースライン', sel)));
    root.appendChild(h('div', { class: 'grid cols-3', id: 'bl-diff' },
      diffSection('ベースライン後の追加', d.added.map((it) => line(it, scopeBadge(it.scope))), 'ありません'),
      diffSection('範囲の変更', d.scopeChanged.map((x) => line(x.item, h('span', { class: 'small' }, enumLabel(SCOPE, x.from), ' → ', scopeBadge(x.to)))), 'ありません'),
      diffSection('取り下げ・不採用', d.dropped.map((it) => line(it, statusBadge(it.kind, it.status))), 'ありません')));
  }

  // 範囲の一覧
  const after = afterBaselineIds(ledger);
  const rows = ledger.items.filter((it) => it.kind === 'request' || it.kind === 'requirement');
  root.appendChild(h('h3', { text: `要望・要件の範囲（${rows.length}件）` }));
  const thead = h('thead', null, h('tr', null, ['ID', '種別', '題名', '状態', '範囲', '判断の理由'].map((t) => h('th', { scope: 'col', text: t }))));
  const tbody = h('tbody', null, rows.map((it) => h('tr', {
    tabindex: '0', 'data-id': it.id, class: store.selectedId === it.id ? 'selected' : null, 'aria-label': `${it.id} ${it.title}`,
    onclick: () => app.openItem(it.id),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); app.openItem(it.id); } },
  },
  h('td', { class: 'mono small', text: it.id }),
  h('td', null, h('span', { class: 'badge', text: kindLabel(it.kind) })),
  h('td', { class: 'title' }, it.title, after.has(it.id) ? h('span', { class: 'badge accent after-bl', text: 'ベースライン後' }) : null),
  h('td', null, statusBadge(it.kind, it.status)),
  h('td', null, scopeBadge(it.scope)),
  h('td', { class: 'small wrap', text: it.scopeReason || (it.scope === 'out' ? '（理由なし）' : '') }))));
  root.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'list', id: 'scope-table' }, thead, tbody)));
  root.appendChild(h('p', { class: 'muted small', text: '範囲と理由は、行を押して開く詳細パネルで変えられます。' }));
}
