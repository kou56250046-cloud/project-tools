// 進捗（EVM）: 今日の BAC・PV・EV・AC・SPI・CPI・EAC と S カーブ

import { visibleLedger } from '../../core/schema.js';
import { computeEvm, EVM_ALERT } from '../../core/evm.js';
import { h, todayStr } from '../dom.js';
import { store } from '../store.js';
import { lineChart } from '../chart.js';

function kpi(label, value, note, tone) {
  return h('div', { class: ['card stat kpi', tone] }, h('span', { class: 'num', text: value }), h('span', { class: 'lab', text: label }), note ? h('span', { class: 'small muted', text: note }) : null);
}

export function renderProgress(root) {
  const ledger = visibleLedger(store.ledger, store.presentation);
  const today = todayStr();
  root.appendChild(h('h2', { text: '進捗（EVM・工数）' }));
  if (!ledger.items.some((it) => it.kind === 'task')) { root.appendChild(h('div', { class: 'empty', text: 'まだ作業がありません。WBS を作ると EVM が出ます。' })); return; }
  const e = computeEvm(ledger, today);
  const hide = store.presentation;
  const fmt = (v) => (v === null ? '—' : String(v));
  const tone = (v) => (v !== null && v < EVM_ALERT ? 'alert' : null);
  root.appendChild(h('div', { class: 'grid cols-4', id: 'evm-kpis' },
    kpi('BAC 総見積', `${e.bac} 人日`, `対象の作業 ${e.targets}件`),
    kpi('PV 計画', `${e.pv} 人日`, '今日までに終わっている予定の量'),
    kpi('EV 出来高', `${e.ev} 人日`, '見積 × 進捗'),
    hide ? null : kpi('AC 実績', `${e.ac} 人日`, 'かかった工数'),
    kpi('SPI', fmt(e.spi), 'EV ÷ PV（1 未満は遅れ）', tone(e.spi)),
    hide ? null : kpi('CPI', fmt(e.cpi), 'EV ÷ AC（1 未満は超過）', tone(e.cpi)),
    hide ? null : kpi('EAC 完了時の見込み', e.eac === null ? '—' : `${e.eac} 人日`, 'BAC ÷ CPI')));
  if (e.missing) root.appendChild(h('p', { class: 'notice warn small', text: `見積・開始日・終了日のどれかが無い末端の作業が ${e.missing} 件あり、EVM に入っていません。` }));
  const series = [
    { key: 'pv', label: 'PV 計画', points: e.curve.map((p) => ({ date: p.date, value: p.pv })) },
    { key: 'ev', label: 'EV 出来高', points: e.curve.map((p) => ({ date: p.date, value: p.ev })) },
  ];
  if (!hide) series.push({ key: 'ac', label: 'AC 実績', points: e.curve.map((p) => ({ date: p.date, value: p.ac })) });
  root.appendChild(h('h3', { text: 'S カーブ（週ごと・人日の累計）' }));
  root.appendChild(h('p', { class: 'muted small', text: 'PV は予定から、EV と AC は取り込んだ進捗の記録から日ごとに復元しています。線の形（破線・実線・点線）でも区別できます。' + (e.curveStart ? ` 古い記録を整理したため、${e.curveStart} より前は描いていません（記録の始まり）。` : '') }));
  root.appendChild(h('div', { class: 'chart-wrap', id: 'scurve' }, lineChart({ series, today, ariaLabel: 'EVM の S カーブ' })));
  // 代わりの表（数値を読みたいとき用）
  root.appendChild(h('details', { class: 'small' }, h('summary', { text: '数値の表を見る' }),
    h('table', { class: 'list' },
      h('thead', null, h('tr', null, ['週', 'PV', 'EV', ...(hide ? [] : ['AC'])].map((t) => h('th', { text: t })))),
      h('tbody', null, e.curve.map((p) => h('tr', { class: 'nocursor' }, h('td', { class: 'mono', text: p.date + (p.today ? '（今日）' : '') }), h('td', { text: String(p.pv) }), h('td', { text: fmt(p.ev) }), hide ? null : h('td', { text: fmt(p.ac) })))))));
}
