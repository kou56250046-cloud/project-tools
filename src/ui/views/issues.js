// 課題と質問: ボール（誰の対応待ちか）ごとの件数と一覧。待ち日数の長い順

import { isOpen, kindLabel, settingOf } from '../../core/schema.js';
import { BALL, ballOf, waitDays, notAskedYet } from '../../core/ball.js';
import { h, todayStr } from '../dom.js';
import { store } from '../store.js';
import { itemTitle, statusBadge } from '../detail.js';

const issuesState = { ball: '' };

export function openItemsByBall(ledger, today) {
  const rows = ledger.items
    .filter((it) => (it.kind === 'issue' || it.kind === 'question') && isOpen(it))
    .map((it) => ({ it, ball: ballOf(it, ledger), wait: waitDays(it, ledger, today), notAsked: notAskedYet(it, ledger) }));
  // 待ち日数の長い順。待ち日数の無いもの（まだ聞いていない）は後ろ
  rows.sort((a, b) => (b.wait ?? -1) - (a.wait ?? -1) || a.it.id.localeCompare(b.it.id));
  return rows;
}

export function renderIssues(root, app) {
  const ledger = store.view();
  const today = todayStr();
  const rows = openItemsByBall(ledger, today);
  const limit = settingOf(ledger, 'ballWaitDays');

  root.appendChild(h('h2', { text: '課題と質問' }));
  root.appendChild(h('p', { class: 'muted small', text: `未完了の課題・質問を「誰の対応待ちか」で分けています。質問は質問先、課題は担当の立場で決まります。顧客待ちが ${limit} 日以上のものは健康診断にも出ます（日数は設定で変えられます）。` }));

  const counts = Object.fromEntries(BALL.map((b) => [b.v, rows.filter((r) => r.ball === b.v).length]));
  root.appendChild(h('div', { class: 'grid cols-4', id: 'ball-counts' }, BALL.map((b) => h('button', {
    class: ['card stat', issuesState.ball === b.v && 'active'], type: 'button', 'data-ball': b.v, 'aria-pressed': String(issuesState.ball === b.v),
    onclick: () => { issuesState.ball = issuesState.ball === b.v ? '' : b.v; app.refresh(); },
  }, h('span', { class: 'num', text: String(counts[b.v]) }), h('span', { class: 'lab', text: b.label })))));

  const shown = issuesState.ball ? rows.filter((r) => r.ball === issuesState.ball) : rows;
  root.appendChild(h('p', { class: 'muted small', id: 'issues-count', text: issuesState.ball ? `${BALL.find((b) => b.v === issuesState.ball).label}: ${shown.length}件（もう一度押すと全件）` : `全 ${rows.length}件` }));
  if (!shown.length) { root.appendChild(h('div', { class: 'empty', text: '該当する課題・質問はありません' })); return; }

  const thead = h('thead', null, h('tr', null, ['ID', '種別', '題名', '状態', '誰の対応待ちか', '相手', '待ち日数', '期限'].map((t) => h('th', { scope: 'col', text: t }))));
  const tbody = h('tbody', null, shown.map((r) => {
    const who = r.it.kind === 'question' ? r.it.askTo : r.it.owner;
    const over = r.ball === 'customer' && r.wait !== null && r.wait >= limit;
    return h('tr', {
      tabindex: '0', 'data-id': r.it.id, class: store.selectedId === r.it.id ? 'selected' : null, 'aria-label': `${r.it.id} ${r.it.title}`,
      onclick: () => app.openItem(r.it.id),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); app.openItem(r.it.id); } },
    },
    h('td', { class: 'mono small', text: r.it.id }),
    h('td', null, h('span', { class: 'badge', text: kindLabel(r.it.kind) })),
    h('td', { class: 'title', text: r.it.title }),
    h('td', null, statusBadge(r.it.kind, r.it.status)),
    h('td', null, h('span', { class: ['badge', r.ball === 'customer' ? 'mid' : r.ball === 'unknown' ? 'high' : 'accent'], text: r.notAsked ? '自社（まだ聞いていない）' : BALL.find((b) => b.v === r.ball).label })),
    h('td', { class: 'small wrap', text: who ? (itemTitle(who, ledger) || who) : '未定' }),
    h('td', { class: ['small mono', over && 'over'], text: r.wait === null ? '—' : `${r.wait}日${over ? '（長い）' : ''}` }),
    h('td', { class: 'small mono', text: r.it.due || '' }));
  }));
  root.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'list', id: 'issues-table' }, thead, tbody)));
}
