// 定例会資料: 期間の変更・EVM・遅れ・顧客待ち・決定・次回までの作業を1画面に。週報の文面をコピーできる

import { kindLabel, statusLabel } from '../../core/schema.js';
import { buildReport, reportText, previousMeetingDate, NEXT_DAYS } from '../../core/report.js';
import { h, toast, copyText, todayStr } from '../dom.js';
import { store } from '../store.js';
import { idButton } from '../detail.js';

const reportState = { from: null, to: null };

function block(title, rows, empty, id) {
  return h('section', { class: 'card', id },
    h('h3', { text: `${title}（${rows.length}件）` }),
    rows.length ? h('ul', { class: 'ref-list' }, rows) : h('p', { class: 'muted small', text: empty }));
}

export function renderMeetingReport(root, app) {
  const ledger = store.ledger;
  const today = todayStr();
  if (!reportState.to) reportState.to = today;
  if (!reportState.from) reportState.from = previousMeetingDate(ledger, today);
  const r = buildReport(ledger, { from: reportState.from, to: reportState.to, today, presentation: store.presentation });

  const from = h('input', { type: 'date', id: 'rep-from', value: reportState.from, 'aria-label': '期間の開始' });
  const to = h('input', { type: 'date', id: 'rep-to', value: reportState.to, 'aria-label': '期間の終わり' });
  from.addEventListener('change', () => { if (from.value) { reportState.from = from.value; app.refresh(); } });
  to.addEventListener('change', () => { if (to.value) { reportState.to = to.value; app.refresh(); } });

  root.appendChild(h('h2', { text: '定例会資料' }));
  root.appendChild(h('div', { class: 'row' },
    h('label', { class: 'row' }, '期間', from, '〜', to),
    h('button', { class: 'btn small', type: 'button', id: 'rep-prev', onclick: () => { reportState.from = previousMeetingDate(ledger, today); reportState.to = today; app.refresh(); } }, '前回の定例から今日まで'),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn primary', type: 'button', id: 'rep-copy', onclick: async () => {
      const ok = await copyText(reportText(r, ledger.project.name));
      toast(ok ? '週報の文面をコピーしました' : 'コピーできませんでした');
    } }, '週報の文面をコピー'),
    store.presentation ? null : h('button', { class: 'btn', type: 'button', id: 'rep-polish', onclick: () => app.go('prompts', { purpose: 'report-polish', reportText: reportText(r, ledger.project.name) }) }, '週報を清書する指示文へ')));
  root.appendChild(h('p', { class: 'muted small', text: '前回の定例は「開催済みの定例のうち今日より前で最も新しいもの」です。無ければ 7 日前からにします。' + (store.presentation ? ' 説明用の表示のため、社内のみの項目と実績の値は出していません。' : '') }));

  if (r.evm) {
    const e = r.evm;
    root.appendChild(h('div', { class: 'grid cols-4', id: 'rep-evm' },
      h('div', { class: 'card stat' }, h('span', { class: 'num', text: `${e.ev} / ${e.pv}` }), h('span', { class: 'lab', text: '出来高 / 計画（人日）' })),
      h('div', { class: ['card stat', e.spi !== null && e.spi < 0.9 && 'kpi alert'] }, h('span', { class: 'num', text: e.spi === null ? '—' : String(e.spi) }), h('span', { class: 'lab', text: 'SPI' })),
      store.presentation ? null : h('div', { class: ['card stat', e.cpi !== null && e.cpi < 0.9 && 'kpi alert'] }, h('span', { class: 'num', text: e.cpi === null ? '—' : String(e.cpi) }), h('span', { class: 'lab', text: 'CPI' })),
      h('div', { class: 'card stat' }, h('span', { class: 'num', text: String(r.delayed.length) }), h('span', { class: 'lab', text: '遅れている作業' }))));
  }

  const item = (it, extra) => h('li', null, idButton(it.id, app), h('span', { class: 'badge', text: kindLabel(it.kind) }), h('span', { text: it.title }), extra);
  root.appendChild(h('div', { class: 'grid cols-2 report-grid' },
    block('期間中に完了したもの', r.completed.map((c) => item(c.item, h('span', { class: 'small muted', text: `${statusLabel(c.item.kind, c.from)} → ${statusLabel(c.item.kind, c.to)}` }))), '期間中に完了したものはありません', 'rep-completed'),
    block('期間中に追加したもの', r.added.map((it) => item(it)), '期間中の追加はありません', 'rep-added'),
    block('決まったこと', r.decisions.map((d) => item(d, h('span', { class: 'small mono', text: d.decidedAt }))), '期間中の決定はありません', 'rep-decisions'),
    block('顧客の返事待ち', r.waiting.map((w) => item(w.item, h('span', { class: 'small', text: w.wait === null ? '' : `${w.wait}日` }))), '顧客待ちはありません', 'rep-waiting'),
    block('遅れている作業', r.delayed.map((it) => item(it, h('span', { class: 'small', text: `${it.end} まで・${it.progress || 0}%` }))), '遅れている作業はありません', 'rep-delayed'),
    block(`次回まで（${NEXT_DAYS}日以内に終わる予定）`, r.next.map((it) => item(it, h('span', { class: 'small mono', text: it.end }))), '予定の作業はありません', 'rep-next'),
    r.statusChanged.length ? block('そのほかの状態の変化', r.statusChanged.map((c) => item(c.item, h('span', { class: 'small muted', text: `${statusLabel(c.item.kind, c.from)} → ${statusLabel(c.item.kind, c.to)}` }))), '', 'rep-changed') : null));
}
