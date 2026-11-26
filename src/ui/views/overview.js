// 概要: 案件情報・種別ごとの件数・次にやること（健康診断の上位5件）

import { KIND_IDS, kindLabel, isOpen } from '../../core/schema.js';
import { h } from '../dom.js';
import { store } from '../store.js';
import { findingRow } from './health.js';

export function renderOverview(root, app) {
  const ledger = store.view();
  const p = ledger.project;

  const kv = h('dl', { class: 'kv wide' });
  const row = (k, v) => { if (v) { kv.appendChild(h('dt', { text: k })); kv.appendChild(h('dd', { class: 'body-text', text: v })); } };
  row('顧客', p.customer);
  row('目的', p.purpose);
  row('期間', p.periodStart || p.periodEnd ? `${p.periodStart || '?'} 〜 ${p.periodEnd || '?'}` : '');
  row('概要', p.summary);
  const goals = Array.isArray(p.goals) && p.goals.length ? h('ul', { class: 'goals' }, p.goals.map((g) => h('li', { text: g }))) : null;

  root.appendChild(h('section', { class: 'card stack' },
    h('h2', { text: p.name }),
    kv.childNodes.length ? kv : h('p', { class: 'muted', text: '案件の目的や期間はまだありません。「指示文」の「初期作成」で資料から設定できます。' }),
    goals ? h('div', null, h('h3', { text: 'ゴール' }), goals) : null));

  // 種別ごとの件数（押すと一覧をその種別で開く）
  const stats = KIND_IDS.map((k) => {
    const items = ledger.items.filter((it) => it.kind === k);
    const open = items.filter(isOpen).length;
    return h('button', {
      class: 'card stat', type: 'button', 'data-kind': k,
      onclick: () => app.go('list', { filter: { kind: k } }),
    },
    h('span', { class: 'num', text: String(items.length) }),
    h('span', { class: 'lab', text: kindLabel(k) + (k === 'issue' || k === 'question' ? `（未完了 ${open}）` : '') }));
  });
  root.appendChild(h('h3', { text: '件数' }));
  root.appendChild(h('div', { class: 'grid cols-4' }, stats));

  const findings = app.health();
  if (store.presentation) return;  // 説明用の表示では「次にやること」と始め方を出さない
  root.appendChild(h('div', { class: 'row' },
    h('h3', { text: '次にやること' }),
    h('span', { class: 'spacer' }),
    findings.length > 5 ? h('button', { class: 'btn small', type: 'button', onclick: () => app.go('health') }, `健康診断をすべて見る（${findings.length}件）`) : null));
  root.appendChild(findings.length
    ? h('div', { class: 'card next-actions' }, findings.slice(0, 5).map((f) => findingRow(f, app)))
    : h('div', { class: 'card empty', text: '健康診断の指摘はありません' }));

  if (ledger.items.length < 10) {
    root.appendChild(h('div', { class: 'notice stack' },
      h('strong', { text: '始め方' }),
      h('ol', null,
        h('li', { text: '「指示文」で「初期作成」を選んでコピーし、提案依頼書やメモと一緒に Gemini に貼る' }),
        h('li', { text: 'Gemini の返答を「取込」に貼って確認し、適用する' }),
        h('li', { text: '会議のあとは「議事録の取込」、節目ごとに「レビュー」を回す' }))));
  }
}
