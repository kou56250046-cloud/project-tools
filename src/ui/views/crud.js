// CRUD 表: 機能（画面・連携・バッチ）× テーブル。作成されないテーブル・どの機能も触らないテーブルに印

import { kindLabel } from '../../core/schema.js';
import { h } from '../dom.js';
import { store } from '../store.js';

export function crudMatrix(ledger) {
  const funcs = ledger.items.filter((it) => ['screen', 'interface', 'batch'].includes(it.kind) && it.status !== 'dropped');
  const ents = ledger.items.filter((it) => it.kind === 'entity' && it.status !== 'dropped');
  const cell = new Map();
  for (const f of funcs) for (const c of f.crud || []) if (c && c.entity) cell.set(f.id + '|' + c.entity, c.ops);
  const created = new Set();
  const touched = new Set();
  for (const [k, ops] of cell) {
    const e = k.split('|')[1];
    touched.add(e);
    if (/C/.test(ops)) created.add(e);
  }
  return { funcs, ents, cell, created, touched };
}

export function renderCrud(root, app) {
  const ledger = store.view();
  const m = crudMatrix(ledger);
  root.appendChild(h('h2', { text: 'CRUD 表' }));
  if (!m.funcs.length || !m.ents.length) { root.appendChild(h('div', { class: 'empty', text: '画面・連携・バッチとテーブルがそろうと表が出ます。' })); return; }
  root.appendChild(h('p', { class: 'muted small', text: 'C 作成・R 参照・U 更新・D 削除。列の見出しの「作成なし」は、どの機能からも作られないテーブル（外部参照のテーブルを除く）、「未使用」はどの機能も触らないテーブルです。' }));
  const head = h('tr', null, h('th', { scope: 'col', text: '機能 ＼ テーブル' }), m.ents.map((e) => {
    const noCreate = e.fileType !== 'external' && !m.created.has(e.id);
    const unused = !m.touched.has(e.id);
    return h('th', { scope: 'col', class: ['crud-col', (noCreate || unused) && 'warn'], 'data-entity': e.id },
      h('button', { type: 'button', class: 'linklike', onclick: () => app.openItem(e.id) }, e.title),
      h('div', { class: 'mono small muted', text: e.physicalName }),
      unused ? h('span', { class: 'badge high', text: '未使用' }) : noCreate ? h('span', { class: 'badge mid', text: '作成なし' }) : null,
      e.fileType === 'external' ? h('span', { class: 'badge', text: '外部' }) : null);
  }));
  const body = m.funcs.map((f) => h('tr', { class: 'nocursor', 'data-id': f.id },
    h('th', { scope: 'row', class: 'crud-row' }, h('button', { type: 'button', class: 'linklike', onclick: () => app.openItem(f.id) }, f.title), h('span', { class: 'badge small', text: kindLabel(f.kind) })),
    m.ents.map((e) => {
      const ops = m.cell.get(f.id + '|' + e.id) || '';
      return h('td', { class: ['crud-cell', ops && 'on', /C/.test(ops) && 'c'], text: ops, 'aria-label': ops ? `${f.title} は ${e.title} を ${ops}` : null });
    })));
  root.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'list crud-table', id: 'crud-table' }, h('thead', null, head), h('tbody', null, body))));
}
