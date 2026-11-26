// リスク: 「リスクを足す」フォーム・見込み × 影響の 5 × 5 のヒートマップ・点数の高い順の一覧・課題へ移す
// 集計は core/risk.js。リスクは既定で社内のみ（説明用の表示では印を外したものだけが出る）

import { RISK_SCALE, KINDS, isOpen } from '../../core/schema.js';
import { riskMatrix, riskToIssueOps, canMoveToIssue, heatLevel } from '../../core/risk.js';
import { h, toast } from '../dom.js';
import { store } from '../store.js';
import { statusBadge } from '../detail.js';

let risksState = { cell: null, all: false };

function addForm(app) {
  const f = { title: '', prob: '3', impact: '3', strategy: '', response: '', trigger: '', owner: '', due: '' };
  const text = (key, label, attrs = {}) => { const el = h('input', { type: 'text', 'aria-label': label, 'data-fk': 'rk-' + key, ...attrs }); el.addEventListener('input', () => { f[key] = el.value; }); return h('label', { class: 'field' }, label, el); };
  const scale = (key, label) => { const el = h('select', { 'aria-label': label, 'data-fk': 'rk-' + key }, [1, 2, 3, 4, 5].map((n) => h('option', { value: String(n), selected: String(n) === f[key], text: `${n} ${RISK_SCALE[n]}` }))); el.addEventListener('change', () => { f[key] = el.value; }); return h('label', { class: 'field' }, label, el); };
  const strategy = h('select', { 'aria-label': '対応の方針', 'data-fk': 'rk-strategy' }, h('option', { value: '', text: '（未定）' }), KINDS.risk.fields.strategy.values.map((v) => h('option', { value: v.v, text: v.label })));
  strategy.addEventListener('change', () => { f.strategy = strategy.value; });
  const people = store.ledger.items.filter((it) => it.kind === 'stakeholder');
  const owner = h('select', { 'aria-label': '担当', 'data-fk': 'rk-owner' }, h('option', { value: '', text: '（未定）' }), people.map((p) => h('option', { value: p.id, text: `${p.title}（${p.id}）` })));
  owner.addEventListener('change', () => { f.owner = owner.value; });
  const due = h('input', { type: 'date', 'aria-label': '対策の期限', 'data-fk': 'rk-due' });
  due.addEventListener('change', () => { f.due = due.value; });
  return h('details', { class: 'card', id: 'risk-add' },
    h('summary', { text: 'リスクを足す' }),
    h('div', { class: 'row settings-row' }, text('title', '題名（起きると困ること）'), scale('prob', '起きる見込み'), scale('impact', '影響'), h('label', { class: 'field' }, '対応の方針', strategy)),
    h('div', { class: 'row settings-row' }, text('response', '対策'), text('trigger', 'きっかけ（兆し）'), h('label', { class: 'field' }, '担当', owner), h('label', { class: 'field' }, '対策の期限', due)),
    h('p', { class: 'small muted', text: '足したリスクは「社内のみ」になります（顧客に見せる表示では出ません。詳細で外せます）。見込み・影響・対策を後から変えるときは、指示文「リスクの洗い出し」で Gemini に更新させます。' }),
    h('button', { class: 'btn primary', type: 'button', id: 'risk-add-save', onclick: () => {
      if (!f.title.trim()) { toast('題名を入れてください'); return; }
      const item = { kind: 'risk', title: f.title.trim(), prob: +f.prob, impact: +f.impact };
      for (const k of ['strategy', 'response', 'trigger', 'owner', 'due']) if (String(f[k]).trim()) item[k] = String(f[k]).trim();
      const r = store.applyLocal([{ op: 'add', item }]);
      toast(r.ok ? 'リスクを足しました（取り消し可）' : r.errors.join(' / '));
    } }, '足す'));
}

export function renderRisks(root, app) {
  const ledger = store.view();
  const m = riskMatrix(ledger);
  const pres = store.presentation;
  root.appendChild(h('h2', { text: 'リスク' }));
  root.appendChild(h('p', { class: 'muted small', text: 'まだ起きていないが、起きると困ることです。点数は 起きる見込み × 影響（1〜25）。起きたら「課題へ移す」で課題にします。' }));
  if (!pres) {
    root.appendChild(addForm(app));
    root.appendChild(h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => app.go('prompts', { purpose: 'risks' }) }, '指示文「リスクの洗い出し」を開く')));
  }

  // ヒートマップ（縦: 影響 5 → 1、横: 見込み 1 → 5）
  const sel = risksState.cell;
  const head = h('tr', null, h('th', { scope: 'col', text: '影響 ＼ 見込み' }), [1, 2, 3, 4, 5].map((p) => h('th', { scope: 'col', class: 'num', text: `${p} ${RISK_SCALE[p]}` })));
  const body = [5, 4, 3, 2, 1].map((i) => h('tr', null, h('th', { scope: 'row', text: `${i} ${RISK_SCALE[i]}` }),
    [1, 2, 3, 4, 5].map((p) => {
      const n = m.cells[p - 1][i - 1];
      const on = sel && sel.p === p && sel.i === i;
      return h('td', { class: 'rk-cell' }, h('button', {
        type: 'button', class: ['rk-heat', 'rk-heat-' + heatLevel(p * i), on && 'is-on'], 'data-fk': `rk-cell-${p}-${i}`,
        'aria-label': `見込み ${p}・影響 ${i}・点数 ${p * i}・${n} 件`, 'aria-pressed': String(!!on),
        onclick: () => { risksState.cell = on ? null : { p, i }; app.refresh(); },
      }, n ? String(n) : '·'));
    })));
  root.appendChild(h('section', { class: 'card stack', id: 'risk-heat' },
    h('h3', { text: '見込み × 影響（監視中・対策中のリスクの件数）' }),
    h('div', { class: 'table-wrap' }, h('table', { class: 'list rk-matrix' }, h('thead', null, head), h('tbody', null, body))),
    h('p', { class: 'small muted', text: '色の段: 点数 1〜4・5〜9・10〜14・15〜25。セルを押すと、そのリスクだけを下の一覧に出します。' })));

  // 一覧
  let items = m.items;
  if (sel) items = items.filter((x) => isOpen(x.risk) && Number(x.risk.prob) === sel.p && Number(x.risk.impact) === sel.i);
  else if (!risksState.all) items = items.filter((x) => isOpen(x.risk));
  const toggle = h('label', { class: 'row small' }, (() => { const el = h('input', { type: 'checkbox', checked: risksState.all, id: 'rk-all' }); el.addEventListener('change', () => { risksState.all = el.checked; app.refresh(); }); return el; })(), '発生・解消も出す');
  root.appendChild(h('section', { class: 'card stack', id: 'risk-list' },
    h('div', { class: 'row' }, h('h3', { text: `リスクの一覧（${items.length} 件）` }), h('span', { class: 'spacer' }), sel ? h('button', { class: 'btn small', type: 'button', onclick: () => { risksState.cell = null; app.refresh(); } }, '絞り込みを外す') : toggle),
    items.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
      h('thead', null, h('tr', null, ['点数', 'ID', 'リスク', '見込み', '影響', '対策', '状態', ''].map((x) => h('th', { scope: 'col', text: x })))),
      h('tbody', null, items.map(({ risk: r, score }) => h('tr', { class: [store.selectedId === r.id && 'selected'], 'data-id': r.id, onclick: (e) => { if (!e.target.closest('button')) store.select(r.id); } },
        h('td', null, h('span', { class: ['rk-score', 'rk-heat-' + heatLevel(score)], text: String(score) })),
        h('td', { class: 'mono small', text: r.id }),
        h('td', { class: 'title', text: r.title + (r.internal ? '' : '（共有）') }),
        h('td', { class: 'num', text: String(r.prob) }),
        h('td', { class: 'num', text: String(r.impact) }),
        h('td', { class: 'wrap small', text: r.response || '（なし）' }),
        h('td', null, statusBadge('risk', r.status)),
        h('td', null, !pres && canMoveToIssue(r) ? h('button', { class: 'btn small', type: 'button', 'data-fk': 'rk-move-' + r.id, onclick: () => {
          const res = store.applyLocal(riskToIssueOps(r));
          toast(res.ok ? '課題を足し、リスクを「発生」にしました（取り消し可）' : res.errors.join(' / '));
        } }, '課題へ移す') : null)))))) : h('div', { class: 'empty small', text: 'まだありません' })));
}
