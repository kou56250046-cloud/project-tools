// 健康診断の画面と、概要で使う「次にやること」の部品

import { HEALTH_CODES, SEVERITY } from '../../core/health.js';
import { enumLabel } from '../../core/schema.js';
import { h } from '../dom.js';

export function findingRow(f, app) {
  return h('div', {
    class: 'finding', tabindex: f.itemId ? '0' : null, role: f.itemId ? 'button' : null, 'data-code': f.code,
    onclick: () => { if (f.itemId) app.openItem(f.itemId); },
    onkeydown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && f.itemId) { e.preventDefault(); app.openItem(f.itemId); } },
    'data-fk': f.itemId ? `finding-${f.code}-${f.itemId}` : null,
  },
  h('span', { class: `badge ${f.severity}`, text: enumLabel(SEVERITY, f.severity) }),
  h('span', { class: 'msg', text: f.message }),
  h('span', { class: 'muted small', text: HEALTH_CODES[f.code] || f.code }),
  f.itemId ? h('span', { class: 'mono small muted', text: f.itemId }) : null);
}

const healthState = { code: '' };

export function renderHealth(root, app) {
  const all = app.health();
  const list = healthState.code ? all.filter((f) => f.code === healthState.code) : all;
  root.appendChild(h('h2', { text: '健康診断' }));
  root.appendChild(h('p', { class: 'muted small', text: '台帳を機械的に点検した結果です（AIは使っていません）。押すとその項目の詳細が開きます。並びは 重要度 → 期限 → ID の順です。' }));

  const counts = {};
  for (const f of all) counts[f.code] = (counts[f.code] || 0) + 1;
  root.appendChild(h('div', { class: 'row filters' },
    SEVERITY.map((sv) => h('span', { class: `badge ${sv.v}`, text: `${sv.label} ${all.filter((f) => f.severity === sv.v).length}件` })),
    h('span', { class: 'spacer' }),
    h('button', { class: ['btn small', !healthState.code && 'primary'], type: 'button', 'data-fk': 'hf-all', 'aria-pressed': String(!healthState.code), onclick: () => { healthState.code = ''; app.refresh(); } }, `すべて（${all.length}）`),
    Object.keys(HEALTH_CODES).filter((c) => counts[c]).map((c) => h('button', {
      class: ['btn small', healthState.code === c && 'primary'], type: 'button', 'data-fk': 'hf-' + c, 'aria-pressed': String(healthState.code === c), onclick: () => { healthState.code = c; app.refresh(); },
    }, `${HEALTH_CODES[c]}（${counts[c]}）`))));

  if (!list.length) {
    root.appendChild(h('div', { class: 'empty', text: all.length ? 'この種類の指摘はありません' : '指摘はありません。良い状態です' }));
    return;
  }
  root.appendChild(h('div', { class: 'card health-list' }, list.map((f) => findingRow(f, app))));
}
