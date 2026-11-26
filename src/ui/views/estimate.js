// 見積（FP）: NESMA 概算法の内訳、生産性からの工数、WBS の見積（BAC）との比較

import { kindLabel } from '../../core/schema.js';
import { fpEstimate, FP_GAP_ALERT } from '../../core/fp.js';
import { h, toast, todayStr } from '../dom.js';
import { store } from '../store.js';
import { idButton } from '../detail.js';

export function renderEstimate(root, app) {
  const ledger = store.view();
  const e = fpEstimate(ledger, todayStr());
  root.appendChild(h('h2', { text: '見積（ファンクションポイントの概算）' }));
  root.appendChild(h('p', { class: 'muted small', text: 'NESMA 概算法で数えています。自システムのテーブル 35・外部参照のテーブル 15・外部入力 4・外部出力 5・外部照会 4 を件数に掛けます。画面の区分・連携の向き・バッチの CRUD で種類を決めます。' }));
  const thead = h('thead', null, h('tr', null, ['種類', '内容', '重み', '件数', 'FP', '対象'].map((t) => h('th', { scope: 'col', text: t }))));
  const tbody = h('tbody', null, e.rows.map((r) => h('tr', { class: 'nocursor', 'data-fp': r.v },
    h('td', { class: 'mono', text: r.v }),
    h('td', { class: 'small wrap', text: r.label }),
    h('td', { class: 'num small', text: String(r.weight) }),
    h('td', { class: 'num small', text: String(r.count) }),
    h('td', { class: 'num', text: String(r.fp) }),
    h('td', { class: 'small wrap' }, r.items.map((it, i) => [i ? '、' : '', idButton(it.id, app, { withTitle: true })])))));
  const tfoot = h('tfoot', null, h('tr', null, h('th', { colspan: '4', text: '合計' }), h('th', { class: 'num', id: 'fp-total', text: `${e.total} FP` }), h('th')));
  root.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'list', id: 'fp-table' }, thead, tbody, tfoot)));
  if (e.uncounted.length) {
    root.appendChild(h('section', { class: 'card', id: 'fp-uncounted' },
      h('h3', { text: `数えていない機能（${e.uncounted.length}件）` }),
      h('ul', { class: 'ref-list' }, e.uncounted.map((u) => h('li', null, idButton(u.item.id, app), h('span', { class: 'badge', text: kindLabel(u.item.kind) }), h('span', { text: u.item.title }), h('span', { class: 'small muted', text: u.reason }))))));
  }
  const prod = h('input', { type: 'number', id: 'fp-productivity', min: '0.01', max: '100', step: '0.01', value: e.productivity == null ? '' : String(e.productivity), 'aria-label': '生産性（人日 / FP）', disabled: store.presentation });
  prod.addEventListener('change', () => {
    const v = prod.value === '' ? null : Number(prod.value);
    const r = store.updateSettings({ productivity: v });
    toast(r.ok ? '生産性を保存しました（取り消し可）' : r.errors.join(' / '));
  });
  const gapTone = e.gap !== null && Math.abs(e.gap) > FP_GAP_ALERT ? 'alert' : null;
  root.appendChild(h('section', { class: 'card stack' },
    h('h3', { text: 'WBS の見積との比較' }),
    h('label', { class: 'row' }, '生産性（人日 / FP）', prod, h('span', { class: 'muted small', text: '自社の実績値を入れてください。案件の設定として保存します' })),
    e.productivity == null
      ? h('p', { class: 'muted', text: '生産性を入れると、FP からの工数と WBS の見積（BAC）を比べます。' })
      : h('div', { class: 'grid cols-3', id: 'fp-compare' },
        h('div', { class: 'card stat' }, h('span', { class: 'num', text: `${e.effort} 人日` }), h('span', { class: 'lab', text: `FP からの工数（${e.total} FP × ${e.productivity}）` })),
        h('div', { class: 'card stat' }, h('span', { class: 'num', text: `${e.bac} 人日` }), h('span', { class: 'lab', text: 'WBS の見積（BAC）' })),
        h('div', { class: ['card stat', gapTone && 'kpi alert'] }, h('span', { class: 'num', text: e.gap === null ? '—' : `${e.gap > 0 ? '+' : ''}${Math.round(e.gap * 1000) / 10}%` }), h('span', { class: 'lab', text: `差（±${FP_GAP_ALERT * 100}% を超えると健康診断に出ます）` })))));
}
