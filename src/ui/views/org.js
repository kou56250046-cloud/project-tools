// 体制: 体制図（立場の列 → 所属 → 上長と部下の木）と RACI 表（作業・決定・課題 × 関係者）
// 配置は core/org.js、補いと表は core/raci.js。セルを押すと 空 → R → A → C → I → 空（明示の役だけを保存）

import { kindLabel, enumLabel, TEAM_ROLES, RACI_ROLES } from '../../core/schema.js';
import { orgLayout } from '../../core/org.js';
import { raciRows, raciColumns, setRaciOp } from '../../core/raci.js';
import { h, s, toast } from '../dom.js';
import { store } from '../store.js';

let orgState = { tasks: 'top', issues: 'open' };

function orgSvg(ledger) {
  const g = orgLayout(ledger);
  const svg = s('svg', { class: 'org-svg', viewBox: `0 0 ${g.width} ${g.height}`, width: String(g.width), height: String(g.height), role: 'img', 'aria-label': '体制図' });
  svg.appendChild(s('defs', null, s('marker', { id: 'org-arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '6', markerHeight: '6', orient: 'auto-start-reverse' }, s('path', { class: 'org-arrowhead', d: 'M0,0L10,5L0,10Z' }))));
  const pos = new Map();
  for (const col of g.columns) {
    svg.appendChild(s('text', { class: 'org-col-title', x: String(col.x), y: '18' }, col.label));
    for (const gr of col.groups) {
      svg.appendChild(s('text', { class: 'org-group', x: String(col.x), y: String(gr.y + 14) }, gr.org));
      for (const n of gr.nodes) pos.set(n.id, n);
    }
  }
  // 線（上長 → 部下）。同じまとまりの中は左の縦線から、別のまとまり・列への線は破線
  for (const e of g.edges) {
    const a = pos.get(e.from), b = pos.get(e.to);
    if (!a || !b) continue;
    const d = e.cross
      ? `M${a.x + a.w},${a.y + a.h / 2}C${a.x + a.w + 30},${a.y + a.h / 2} ${b.x - 30},${b.y + b.h / 2} ${b.x},${b.y + b.h / 2}`
      : `M${a.x + 8},${a.y + a.h}V${b.y + b.h / 2}H${b.x}`;
    svg.appendChild(s('path', { class: ['org-edge', e.cross && 'is-cross'], d, 'marker-end': 'url(#org-arrow)' }));
  }
  for (const n of pos.values()) {
    const p = n.item;
    const gEl = s('g', { class: ['org-node', p.status === 'inactive' && 'is-inactive', store.selectedId === p.id && 'is-selected'], tabindex: '0', role: 'button', 'aria-label': `${p.title}（${p.role || '役割なし'}）`, 'data-id': p.id });
    gEl.appendChild(s('rect', { x: String(n.x), y: String(n.y), width: String(n.w), height: String(n.h), rx: '6' }));
    gEl.appendChild(s('text', { class: 'org-name', x: String(n.x + 10), y: String(n.y + 19) }, p.title + (n.cycle ? '（上長が循環）' : '')));
    gEl.appendChild(s('text', { class: 'org-sub', x: String(n.x + 10), y: String(n.y + 36) }, [p.role, p.teamRole ? enumLabel(TEAM_ROLES, p.teamRole) : ''].filter(Boolean).join('・') || '—'));
    const go = () => store.select(p.id);
    gEl.addEventListener('click', go);
    gEl.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } });
    svg.appendChild(gEl);
  }
  return svg;
}

export function renderOrg(root, app) {
  const ledger = store.view();
  const pres = store.presentation;
  root.appendChild(h('h2', { text: '体制' }));
  root.appendChild(h('p', { class: 'muted small', text: '立場ごとの列に、所属ごとのまとまりで、上長 → 部下の順に並べます。上長と体制上の役割は、関係者の詳細で選ぶか、指示文「体制の整理」で Gemini に整理させます。' }));
  if (!pres) root.appendChild(h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => app.go('prompts', { purpose: 'org' }) }, '指示文「体制の整理」を開く')));
  root.appendChild(h('div', { class: 'graph-wrap', id: 'org-chart' }, orgSvg(ledger)));

  // RACI 表
  const cols = raciColumns(ledger);
  const rows = raciRows(ledger, { tasks: orgState.tasks, issues: orgState.issues, all: orgState.tasks === 'all' });
  const sw = (key, a, b, labA, labB) => {
    const el = h('select', { 'aria-label': key === 'tasks' ? '作業の行' : '課題の行', 'data-fk': 'org-' + key }, h('option', { value: a, selected: orgState[key] === a, text: labA }), h('option', { value: b, selected: orgState[key] === b, text: labB }));
    el.addEventListener('change', () => { orgState[key] = el.value; app.refresh(); });
    return el;
  };
  const head = h('tr', null, h('th', { scope: 'col', text: '項目' }), cols.map((p) => h('th', { scope: 'col', class: ['raci-col', p.status === 'inactive' && 'is-inactive'], text: p.title })));
  const body = rows.map(({ item, cells }) => h('tr', { class: 'nocursor', 'data-id': item.id },
    h('th', { scope: 'row', class: 'raci-row' }, h('span', { class: 'badge', text: kindLabel(item.kind) }), ' ', h('button', { class: 'linklike', type: 'button', onclick: () => store.select(item.id) }, `${item.id} ${item.title}`)),
    cols.map((p) => {
      const c = cells.get(p.id);
      const label = c ? c.role : '';
      return h('td', { class: 'raci-cell' }, h('button', {
        type: 'button', class: ['raci-btn', c && 'role-' + c.role, c && c.derived && 'is-derived'], disabled: pres, 'data-fk': `raci-${item.id}-${p.id}`,
        'aria-label': `${item.title} × ${p.title}: ${c ? `${c.role}（${enumLabel(RACI_ROLES, c.role)}）${c.derived ? '・補い' : ''}` : 'なし'}`,
        onclick: () => {
          const r = store.applyLocal([setRaciOp(item, p.id)]);
          if (!r.ok) toast(r.errors.join(' / '));
        },
      }, label || '·'));
    })));
  root.appendChild(h('section', { class: 'card stack', id: 'raci' },
    h('div', { class: 'row' }, h('h3', { text: 'RACI 表' }), h('span', { class: 'spacer' }),
      h('label', { class: 'row small' }, '作業', sw('tasks', 'top', 'all', '根の作業だけ', 'すべて（中止・置き換え済みの決定も）')),
      h('label', { class: 'row small' }, '課題', sw('issues', 'open', 'all', '未完了だけ', 'すべて'))),
    h('p', { class: 'small muted', text: `R 実行・A 承認（1 人）・C 相談・I 報告。薄い文字は、担当・決めた人から補ったもの（保存していない）。${pres ? '' : 'セルを押すと 空 → R → A → C → I → 空 と変わります（取り消し可）。担当・決めた人から補った役（薄い字）がある人は、空にすると補いの役に戻ります。'}` }),
    rows.length && cols.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'list raci-table' }, h('thead', null, head), h('tbody', null, body))) : h('div', { class: 'empty small', text: 'まだありません' })));
}
