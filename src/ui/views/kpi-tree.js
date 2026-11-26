// KPI の木: 目的 → ゴール → KPI（→ 子の KPI）→ 施策（要望）→ 要件。字下げの表と、Dash.flow（上から下）の図
// 組み立ては core/kpi.js。KPI は Gemini の差分（指示文「目的と KPI の整理」）で足す

import { kindLabel } from '../../core/schema.js';
import { kpiTree } from '../../core/kpi.js';
import { h, todayStr } from '../dom.js';
import { store } from '../store.js';
import { statusBadge } from '../detail.js';

const FLOW_MAX = 40;

export function renderKpiTree(root, app) {
  const ledger = store.view();
  const t = kpiTree(ledger);
  root.appendChild(h('h2', { text: 'KPI の木' }));
  root.appendChild(h('p', { class: 'muted small', text: '目的 → ゴール → KPI → 施策（KPI と関連でつながる要望）→ 要件 のつながりです。ゴールは案件情報のゴールの文です。KPI は「指示文」の「目的と KPI の整理」で Gemini に作らせて取り込みます。' }));
  root.appendChild(h('div', { class: 'row' },
    h('button', { class: 'btn', type: 'button', onclick: () => app.go('prompts', { purpose: 'kpi' }) }, '指示文「目的と KPI の整理」を開く')));

  // 字下げの表
  const rows = [];
  const row = (depth, kind, item, extra, cls) => rows.push(h('tr', { class: ['kt-row', cls, item && store.selectedId === item.id && 'selected'], 'data-id': item ? item.id : null, onclick: item ? () => store.select(item.id) : null },
    h('td', { class: 'kt-name' }, h('span', { class: 'kt-indent', 'data-depth': String(depth) }), h('span', { class: 'badge', text: kind }), ' ', item ? h('span', { class: 'mono small', text: item.id + ' ' }) : null, h('span', { text: item ? item.title : extra.title })),
    h('td', { class: 'small', text: extra.metric || '' }),
    h('td', { class: 'small', text: extra.value || '' }),
    h('td', null, item ? statusBadge(item.kind, item.status) : null)));
  const kpiRows = (n, depth) => {
    const k = n.kpi;
    row(depth, 'KPI', k, { metric: [k.metric, k.unit ? `（${k.unit}）` : ''].join(''), value: `${k.baseline || '?'} → ${k.target || '?'}` });
    for (const r of n.requests) {
      row(depth + 1, '施策', r.request, {});
      for (const q of r.requirements) row(depth + 2, '要件', q, {});
    }
    for (const q of n.directRequirements) row(depth + 1, '要件（直接）', q, {});
    for (const c of n.children) kpiRows(c, depth + 1);
  };
  rows.push(h('tr', { class: 'kt-row kt-purpose nocursor' }, h('td', { colspan: '4' }, h('strong', { text: '目的: ' }), t.purpose || '（案件情報に目的がありません）')));
  for (const r of t.roots) {
    rows.push(h('tr', { class: 'kt-row kt-goal nocursor' }, h('td', { colspan: '4' }, h('span', { class: 'kt-indent', 'data-depth': '1' }), h('span', { class: 'badge accent', text: 'ゴール' }), ' ', r.goal)));
    if (!r.nodes.length) rows.push(h('tr', { class: 'nocursor' }, h('td', { colspan: '4', class: 'small muted' }, h('span', { class: 'kt-indent', 'data-depth': '2' }), 'このゴールの KPI はまだありません')));
    for (const n of r.nodes) kpiRows(n, 2);
  }
  if (t.unassigned.length) {
    rows.push(h('tr', { class: 'kt-row kt-goal nocursor' }, h('td', { colspan: '4' }, h('span', { class: 'kt-indent', 'data-depth': '1' }), h('span', { class: 'badge', text: 'ゴール' }), ' （ゴール未設定）')));
    for (const n of t.unassigned) kpiRows(n, 2);
  }
  root.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'list kt-table' },
    h('thead', null, h('tr', null, ['項目', '指標', '現状値 → 目標値', '状態'].map((x) => h('th', { scope: 'col', text: x })))),
    h('tbody', null, rows))));

  // 図（Dash.flow・上から下）。項目が多いときは表だけ
  const Dash = window.Dash;
  if (!Dash) return;
  if (t.count > FLOW_MAX) { root.appendChild(h('p', { class: 'small muted', text: `項目が ${t.count} 件あり多いため、表だけ出しています（図は ${FLOW_MAX} 件まで）` })); return; }
  const nodes = [];
  const edges = [];
  const seen = new Set();
  const add = (id, label, kind) => { if (!seen.has(id)) { seen.add(id); nodes.push({ id, label, kind }); } };
  const walk = (n, from) => {
    const k = n.kpi;
    add(k.id, `${k.title}（${k.target || '?'}）`, 'step');
    edges.push({ from, to: k.id });
    for (const r of n.requests) {
      add(r.request.id, `${kindLabel('request')}: ${r.request.title}`, 'step');
      edges.push({ from: k.id, to: r.request.id });
      for (const q of r.requirements) { add(q.id, `${kindLabel('requirement')}: ${q.title}`, 'end'); edges.push({ from: r.request.id, to: q.id }); }
    }
    for (const q of n.directRequirements) { add(q.id, `${kindLabel('requirement')}: ${q.title}`, 'end'); edges.push({ from: k.id, to: q.id }); }
    for (const c of n.children) walk(c, k.id);
  };
  t.roots.forEach((r, i) => { const gid = 'goal-' + i; add(gid, `ゴール: ${r.goal}`, 'start'); for (const n of r.nodes) walk(n, gid); });
  if (t.unassigned.length) { add('goal-none', 'ゴール未設定', 'start'); for (const n of t.unassigned) walk(n, 'goal-none'); }
  if (!nodes.length) return;
  const host = h('section', { class: 'card dash-card', id: 'kt-flow' });
  root.appendChild(host);
  Dash.flow(host, { title: 'KPI の木（図）', nodes, edges, direction: 'TB', asOf: todayStr(), source: `台帳 rev ${ledger.revision}`, empty: 'まだありません' });
}
