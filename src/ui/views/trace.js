// トレーサビリティ: 要件ごとの 要望・設計・テストと判定。判定と工程で絞り込む

import { KINDS, enumLabel, statusLabel } from '../../core/schema.js';
import { traceRows, VERDICTS } from '../../core/trace.js';
import { h } from '../dom.js';
import { store } from '../store.js';
import { idButton } from '../detail.js';

const traceState = { verdict: '', level: '' };
const TONE = { none: 'high', failed: 'high', pending: 'mid', passed: 'ok' };
const LEVELS = KINDS.test.fields.level.values;

// 工程で絞ったときは、その工程のテストだけで判定し直す
function judge(tests) {
  if (!tests.length) return 'none';
  if (tests.some((t) => t.status === 'failed')) return 'failed';
  if (tests.some((t) => t.status !== 'passed')) return 'pending';
  return 'passed';
}

export function renderTrace(root, app) {
  const ledger = store.view();
  const rows = traceRows(ledger).map((r) => {
    const tests = traceState.level ? r.tests.filter((t) => t.level === traceState.level) : r.tests;
    return { ...r, tests, verdict: judge(tests) };
  });
  root.appendChild(h('div', { class: 'row' },
    h('h2', { text: 'トレーサビリティ（要件 → 設計 → テスト）' }),
    h('span', { class: 'spacer' }),
    store.presentation ? null : h('button', { class: 'btn', type: 'button', onclick: () => app.go('prompts', { purpose: 'test-viewpoints' }) }, 'テスト観点の生成の指示文へ')));
  root.appendChild(h('p', { class: 'muted small', text: '要件とつながる設計の項目（画面・連携・バッチ・テーブル）に結びついたテストも、その要件のテストとして数えます。' }));
  const counts = Object.fromEntries(VERDICTS.map((v) => [v.v, rows.filter((r) => r.verdict === v.v).length]));
  const sel = (id, label, value, options, on) => {
    const el = h('select', { id, 'aria-label': label }, options.map(([v, t]) => h('option', { value: v, selected: v === value, text: t })));
    el.addEventListener('change', () => on(el.value));
    return el;
  };
  root.appendChild(h('div', { class: 'row filters' },
    VERDICTS.map((v) => h('button', {
      type: 'button', class: ['btn small', traceState.verdict === v.v && 'primary'], 'aria-pressed': String(traceState.verdict === v.v), 'data-fk': 'verdict-' + v.v,
      onclick: () => { traceState.verdict = traceState.verdict === v.v ? '' : v.v; app.refresh(); },
    }, `${v.label}（${counts[v.v]}）`)),
    h('span', { class: 'spacer' }),
    h('label', { class: 'row small' }, '工程', sel('trace-level', '工程', traceState.level, [['', 'すべて'], ...LEVELS.map((l) => [l.v, l.label])], (v) => { traceState.level = v; app.refresh(); }))));
  const shown = traceState.verdict ? rows.filter((r) => r.verdict === traceState.verdict) : rows;
  if (!shown.length) { root.appendChild(h('div', { class: 'empty', text: '該当する要件はありません' })); return; }
  const refs = (list) => list.length ? h('div', null, list.map((x) => h('div', null, idButton(x.id, app, { withTitle: true })))) : h('span', { class: 'muted', text: '—' });
  const thead = h('thead', null, h('tr', null, ['要件', '状態', '要望', '設計', 'テスト', '判定'].map((t) => h('th', { scope: 'col', text: t }))));
  const tbody = h('tbody', null, shown.map((r) => h('tr', { class: 'nocursor', 'data-id': r.req.id },
    h('td', { class: 'title' }, idButton(r.req.id, app), ' ', r.req.title),
    h('td', { class: 'small', text: statusLabel('requirement', r.req.status) }),
    h('td', { class: 'wrap small' }, refs(r.requests)),
    h('td', { class: 'wrap small' }, refs(r.design)),
    h('td', { class: 'wrap small' }, r.tests.length
      ? h('div', null, r.tests.map((t) => h('div', null, idButton(t.id, app), ` ${statusLabel('test', t.status)}`)))
      : h('span', { class: 'muted', text: '—' })),
    h('td', null, h('span', { class: `badge ${TONE[r.verdict]}`, text: enumLabel(VERDICTS, r.verdict) })))));
  root.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'list', id: 'trace-table' }, thead, tbody)));
}
