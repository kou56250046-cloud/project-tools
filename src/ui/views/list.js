// 一覧画面: 全種別の項目を絞り込み・並べ替えして表で出す

import { KINDS, KIND_IDS, LEDGER_KINDS, CONFIDENCE, kindLabel, statusLabel, isOpen, afterBaselineIds, riskScore } from '../../core/schema.js';
import { h } from '../dom.js';
import { store } from '../store.js';
import { confBadge, statusBadge, itemTitle } from '../detail.js';

const PRIORITIES = ['Must', 'Should', 'Could', 'Wont'];
const SEVERITY_LABEL = { high: '高', mid: '中', low: '低' };

const filter = { kind: '', confidence: '', status: '', openOnly: false, priority: '', q: '' };
const sort = { key: 'id', dir: 1 };

function personOf(it) {
  if (it.owner) return it.owner;
  if (it.askTo) return it.askTo;
  if (Array.isArray(it.decidedBy) && it.decidedBy.length) return it.decidedBy[0];
  return null;
}

function dateOf(it) { return it.due || it.decidedAt || null; }

function rankOf(it) {
  if (it.kind === 'risk') return `点数 ${riskScore(it)}`;
  if (it.priority) return it.priority;
  if (it.severity) return '重要度 ' + SEVERITY_LABEL[it.severity];
  return null;
}

// 並べ替えの値。null は常に末尾へ
const COLUMNS = [
  { key: 'id', label: 'ID', value: (it) => KIND_IDS.indexOf(it.kind) * 100000 + Number(it.id.split('-')[1]) },
  { key: 'kind', label: '種別', value: (it) => KIND_IDS.indexOf(it.kind) },
  { key: 'title', label: '題名', value: (it) => it.title },
  { key: 'status', label: '状態', value: (it) => statusLabel(it.kind, it.status) },
  { key: 'confidence', label: '確度', value: (it) => ['guess', 'fact', 'confirmed'].indexOf(it.confidence) },
  { key: 'rank', label: '優先度', value: (it) => { const p = PRIORITIES.indexOf(it.priority); if (p >= 0) return p; return it.severity ? ['high', 'mid', 'low'].indexOf(it.severity) : null; } },
  { key: 'person', label: '担当・相手', value: (it) => { const p = personOf(it); return p ? itemTitle(p, store.view()) || p : null; } },
  { key: 'date', label: '期限・決定日', value: dateOf },
  { key: 'updatedAt', label: '更新', value: (it) => it.updatedAt },
];

function compare(a, b) {
  if (a === null || a === undefined) return (b === null || b === undefined) ? 0 : 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === 'number' && typeof b === 'number') return (a - b) * sort.dir;
  return String(a).localeCompare(String(b), 'ja') * sort.dir;
}

export function setListFilter(opts) {
  Object.assign(filter, { kind: '', confidence: '', status: '', openOnly: false, priority: '', q: '' }, opts || {});
}

function matches(it) {
  if (filter.kind && it.kind !== filter.kind) return false;
  if (filter.confidence && it.confidence !== filter.confidence) return false;
  if (filter.status && it.status !== filter.status) return false;
  if (filter.openOnly && !isOpen(it)) return false;
  if (filter.priority) {
    if (filter.priority === 'none' ? !!it.priority : it.priority !== filter.priority) return false;
  }
  if (filter.q) {
    const q = filter.q.toLowerCase();
    const hay = [it.id, it.title, it.body, it.answer, it.reason, ...(it.tags || [])].filter(Boolean).join('\n').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function select(label, value, options, onChange) {
  const el = h('select', { 'aria-label': label, 'data-fk': 'filter-' + label }, options.map(([v, t]) => h('option', { value: v, selected: v === value, text: t })));
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

export function renderList(root, app, opts) {
  if (opts && opts.filter) { setListFilter(opts.filter); app.viewOpts = {}; }
  // メモは一覧に出さない（メモの画面で扱う）
  const view = store.view();
  const ledger = { ...view, items: view.items.filter((it) => it.kind !== 'memo') };
  const rerender = () => app.refresh();

  root.appendChild(h('h2', { text: '一覧' }));
  const statusOptions = filter.kind ? KINDS[filter.kind].statuses.map((s) => [s.v, s.label]) : [];
  const q = h('input', { type: 'search', placeholder: '題名・内容・ID・タグで探す', 'aria-label': '文字列で絞り込む', value: filter.q, id: 'list-q' });
  q.addEventListener('input', () => {
    filter.q = q.value;
    const pos = q.selectionStart;
    rerender();
    const again = document.getElementById('list-q');
    if (again) again.setSelectionRange(pos, pos);
  });
  root.appendChild(h('div', { class: 'filters' },
    select('種別', filter.kind, [['', 'すべての種別'], ...LEDGER_KINDS.map((k) => [k, kindLabel(k)])], (v) => { filter.kind = v; filter.status = ''; rerender(); }),
    filter.kind ? select('状態', filter.status, [['', 'すべての状態'], ...statusOptions], (v) => { filter.status = v; rerender(); }) : null,
    select('確度', filter.confidence, [['', 'すべての確度'], ...CONFIDENCE.map((c) => [c.v, c.label])], (v) => { filter.confidence = v; rerender(); }),
    select('優先度', filter.priority, [['', 'すべての優先度'], ...PRIORITIES.map((p) => [p, p]), ['none', '優先度なし']], (v) => { filter.priority = v; rerender(); }),
    h('label', { class: 'row small' },
      h('input', { type: 'checkbox', id: 'list-open-only', checked: filter.openOnly, onchange: (e) => { filter.openOnly = e.target.checked; rerender(); } }),
      '未完了の課題・質問だけ'),
    q));

  // 効いている絞り込みを見えるようにする（別の画面から戻ったときに気づけるように）
  const active = [
    filter.kind && `種別: ${kindLabel(filter.kind)}`,
    filter.status && `状態: ${statusLabel(filter.kind, filter.status)}`,
    filter.confidence && `確度: ${CONFIDENCE.find((c) => c.v === filter.confidence).label}`,
    filter.priority && `優先度: ${filter.priority === 'none' ? 'なし' : filter.priority}`,
    filter.openOnly && '未完了だけ',
    filter.q && `「${filter.q}」を含む`,
  ].filter(Boolean);
  if (active.length) {
    root.appendChild(h('div', { class: 'row active-filters', role: 'status' },
      h('span', { class: 'small', text: '絞り込み中:' }),
      active.map((a) => h('span', { class: 'badge accent', text: a })),
      h('button', { class: 'btn small', type: 'button', id: 'list-reset', onclick: () => { setListFilter({}); rerender(); } }, '絞り込みを解除')));
  }

  const rows = ledger.items.filter(matches);
  const after = afterBaselineIds(ledger);
  const col = COLUMNS.find((c) => c.key === sort.key) || COLUMNS[0];
  rows.sort((a, b) => compare(col.value(a), col.value(b)) || a.id.localeCompare(b.id));

  root.appendChild(h('p', { class: 'muted small', id: 'list-count', text: `${rows.length}件 ／ 全${ledger.items.length}件` }));
  if (!rows.length) { root.appendChild(h('div', { class: 'empty', text: '条件に合う項目がありません' })); return; }

  const thead = h('thead', null, h('tr', null, COLUMNS.map((c) => h('th', {
    'aria-sort': sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none', scope: 'col',
  }, h('button', { type: 'button', 'data-fk': 'sort-' + c.key, onclick: () => { if (sort.key === c.key) sort.dir *= -1; else { sort.key = c.key; sort.dir = 1; } rerender(); } },
    c.label, sort.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : '')))));

  const tbody = h('tbody', null, rows.map((it) => {
    const person = personOf(it);
    return h('tr', {
      class: store.selectedId === it.id ? 'selected' : null, tabindex: '0', 'data-id': it.id,
      onclick: () => app.openItem(it.id),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); app.openItem(it.id); } },
      'aria-label': `${it.id} ${it.title}`,
    },
    h('td', { class: 'mono small', text: it.id }),
    h('td', null, h('span', { class: 'badge', text: kindLabel(it.kind) })),
    h('td', { class: 'title' }, it.title, after.has(it.id) ? h('span', { class: 'badge accent after-bl', text: 'ベースライン後' }) : null),
    h('td', null, statusBadge(it.kind, it.status)),
    h('td', null, confBadge(it.confidence)),
    h('td', { class: 'small wrap', text: rankOf(it) || '' }),
    h('td', { class: 'small wrap', text: person ? (itemTitle(person, ledger) || person) : '' }),
    h('td', { class: 'small mono', text: dateOf(it) || '' }),
    h('td', { class: 'small muted mono', text: (it.updatedAt || '').slice(0, 10) }));
  }));
  root.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'list' }, thead, tbody)));
}
