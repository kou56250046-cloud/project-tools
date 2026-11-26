// テスト: 工程・観点・状態で絞り込める一覧、工程ごとの合格率。状態と実施日はその場で変えられる

import { KINDS, enumLabel } from '../../core/schema.js';
import { passRates } from '../../core/trace.js';
import { h, toast, todayStr } from '../dom.js';
import { store } from '../store.js';
import { statusBadge } from '../detail.js';

const testState = { level: '', viewpoint: '', status: '' };
const F = KINDS.test.fields;

export function renderTests(root, app) {
  const ledger = store.view();
  const all = ledger.items.filter((it) => it.kind === 'test');
  root.appendChild(h('div', { class: 'row' },
    h('h2', { text: 'テスト' }),
    h('span', { class: 'spacer' }),
    store.presentation ? null : h('button', { class: 'btn', type: 'button', onclick: () => app.go('prompts', { purpose: 'test-viewpoints' }) }, 'テスト観点の生成の指示文へ')));
  if (!all.length) { root.appendChild(h('div', { class: 'empty', text: 'まだテストがありません。「テスト観点の生成」の指示文で、要件や画面からテストを作らせてください。' })); return; }

  root.appendChild(h('div', { class: 'grid cols-4', id: 'pass-rates' }, passRates(ledger, F.level.values).map((r) => h('div', { class: 'card stat', 'data-level': r.level },
    h('span', { class: 'num', text: r.rate === null ? '—' : `${r.rate}%` }),
    h('span', { class: 'lab', text: `${r.label}テストの合格率（${r.passed} / ${r.total}${r.failed ? `・不合格 ${r.failed}` : ''}）` })))));

  const sel = (id, label, key, values) => {
    const el = h('select', { id, 'aria-label': label }, [['', `すべての${label}`], ...values.map((v) => [v.v, v.label])].map(([v, t]) => h('option', { value: v, selected: v === testState[key], text: t })));
    el.addEventListener('change', () => { testState[key] = el.value; app.refresh(); });
    return el;
  };
  root.appendChild(h('div', { class: 'filters' },
    sel('test-level', '工程', 'level', F.level.values),
    sel('test-viewpoint', '観点', 'viewpoint', F.viewpoint.values),
    sel('test-status', '状態', 'status', KINDS.test.statuses)));
  const list = all.filter((t) => (!testState.level || t.level === testState.level) && (!testState.viewpoint || t.viewpoint === testState.viewpoint) && (!testState.status || t.status === testState.status));
  root.appendChild(h('p', { class: 'muted small', id: 'tests-count', text: `${list.length}件 ／ 全${all.length}件。状態と実施日はこの表で直接変えられます（取り消し可）。` }));

  const thead = h('thead', null, h('tr', null, ['ID', 'テスト', '工程', '観点', '状態', '実施日'].map((t) => h('th', { scope: 'col', text: t }))));
  const tbody = h('tbody', null, list.map((t) => {
    const st = h('select', { 'data-fk': 'status-' + t.id, 'aria-label': `${t.title}の状態`, disabled: store.presentation }, KINDS.test.statuses.map((s) => h('option', { value: s.v, selected: s.v === t.status, text: s.label })));
    st.addEventListener('change', () => {
      const set = { status: st.value };
      // 合格・不合格にしたとき、実施日が空なら今日を入れる
      if ((st.value === 'passed' || st.value === 'failed') && !t.executedAt) set.executedAt = todayStr();
      const r = store.applyLocal([{ op: 'update', id: t.id, set }]);
      toast(r.ok ? '状態を変えました（取り消し可）' : r.errors.join(' / '));
    });
    const dt = h('input', { type: 'date', 'data-fk': 'exec-' + t.id, 'aria-label': `${t.title}の実施日`, value: t.executedAt || '', disabled: store.presentation });
    dt.addEventListener('change', () => {
      const r = store.applyLocal([{ op: 'update', id: t.id, set: { executedAt: dt.value || null } }]);
      toast(r.ok ? '実施日を変えました（取り消し可）' : r.errors.join(' / '));
    });
    return h('tr', { 'data-id': t.id, class: store.selectedId === t.id ? 'selected' : null },
      h('td', { class: 'mono small' }, h('button', { class: 'linklike', type: 'button', onclick: () => app.openItem(t.id) }, t.id)),
      h('td', { class: 'title' }, t.title, ' ', statusBadge(t.kind, t.status)),
      h('td', { class: 'small', text: enumLabel(F.level.values, t.level) }),
      h('td', { class: 'small', text: enumLabel(F.viewpoint.values, t.viewpoint) }),
      h('td', null, st),
      h('td', null, dt));
  }));
  root.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'list', id: 'tests-table' }, thead, tbody)));
}
