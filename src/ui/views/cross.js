// 横断: 全案件の 自分の作業・自分が持つボール・顧客待ち・案件ごとの健康診断の高の件数と SPI
// 項目を押すと、その案件に切り替えて詳細を開く（この画面では編集しない）

import { kindLabel } from '../../core/schema.js';
import { crossSummary, CROSS_DAYS } from '../../core/cross.js';
import { h, todayStr } from '../dom.js';
import { store } from '../store.js';

function jump(app, projectId, itemId) {
  store.switchProject(projectId);
  app.go('list');
  app.openItem(itemId);
}

export function renderCross(root, app) {
  const rows = crossSummary(store.workspace, todayStr());
  root.appendChild(h('h2', { text: '横断（すべての案件）' }));
  root.appendChild(h('p', { class: 'muted small', text: `ブラウザの中の全案件をまとめて見ます。「自分」は案件ごとに「設定」の「この案件の設定」で選びます。自分の作業は ${CROSS_DAYS} 日以内に終わる予定か期限を過ぎたものです。項目を押すと、その案件に切り替えて詳細を開きます。` }));

  // 案件ごとの状態
  root.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'list', id: 'cross-projects' },
    h('thead', null, h('tr', null, ['案件', '健康診断の高', 'SPI', '自分の作業', '自分が持つボール', '顧客待ち'].map((t) => h('th', { scope: 'col', text: t })))),
    h('tbody', null, rows.map((r) => h('tr', { class: ['nocursor', r.id === store.activeId && 'selected'], 'data-project': r.id },
      h('td', { class: 'title' }, h('button', { class: 'linklike', type: 'button', 'data-fk': 'proj-' + r.id, onclick: () => { store.switchProject(r.id); app.go('overview'); } }, r.name)),
      h('td', null, h('span', { class: ['badge', r.high ? 'high' : 'ok'], text: String(r.high) })),
      h('td', { class: 'num small', text: r.spi === null ? '—' : String(r.spi) }),
      h('td', { class: 'num small', text: r.myTasks === null ? '自分が未設定' : String(r.myTasks.length) }),
      h('td', { class: 'num small', text: r.myBalls === null ? '自分が未設定' : String(r.myBalls.length) }),
      h('td', { class: 'num small', text: String(r.waiting.length) })))))));

  const section = (title, id, entries, empty, render) => {
    root.appendChild(h('section', { class: 'card stack', id },
      h('h3', { text: `${title}（${entries.length}件）` }),
      entries.length ? h('ul', { class: 'ref-list' }, entries.map(render)) : h('p', { class: 'muted small', text: empty })));
  };
  const line = (r, it, extra) => h('li', null,
    h('span', { class: 'badge', text: r.name.length > 16 ? r.name.slice(0, 16) + '…' : r.name }),
    h('button', { class: 'idlink', type: 'button', 'data-fk': `x-${r.id}-${it.id}`, onclick: () => jump(app, r.id, it.id) }, it.id),
    h('span', { class: 'badge', text: kindLabel(it.kind) }),
    h('span', { text: it.title }),
    extra);

  const myTasks = rows.flatMap((r) => (r.myTasks || []).map((x) => ({ r, ...x }))).sort((a, b) => a.item.end.localeCompare(b.item.end));
  section('自分の作業', 'cross-tasks', myTasks, '期限が近い自分の作業はありません', (x) => line(x.r, x.item,
    h('span', { class: ['small mono', x.overdue && 'over'], text: `${x.item.end}${x.overdue ? '（期限切れ）' : ''}・${x.item.progress || 0}%` })));
  const balls = rows.flatMap((r) => (r.myBalls || []).map((x) => ({ r, ...x })));
  section('自分が持つボール（自分が担当・質問先の課題と質問）', 'cross-balls', balls, 'ありません', (x) => line(x.r, x.item,
    h('span', { class: 'small muted', text: x.item.due ? `期限 ${x.item.due}` : '期限なし' })));
  const waiting = rows.flatMap((r) => r.waiting.map((x) => ({ r, ...x }))).sort((a, b) => b.wait - a.wait);
  section('顧客の返事待ち（設定の日数以上）', 'cross-waiting', waiting, 'ありません', (x) => line(x.r, x.item,
    h('span', { class: 'small over', text: `${x.wait}日` })));
}
