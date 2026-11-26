// 業務フロー: 現行・導入後の流れを、フロー記法（core/flow.js）からスイムレーンの図にする
// 左にフローの一覧と「新しいフロー」、右に図・記法の欄・誤り。関連でつながる反対側（現行 ⇔ 導入後）のフローを下に並べる

import { KINDS, enumLabel, BIZFLOW_NOTATION_MAX } from '../../core/schema.js';
import { flowGeometry } from '../../core/flowsafe.js';
import { renderFlowSvg } from '../flowsvg.js';
import { h, toast } from '../dom.js';
import { store } from '../store.js';
import { statusBadge } from '../detail.js';

const BF_TEMPLATE = 'title 業務の名前\nlane 担当\n\nstart S @担当 始まり\ntask A @担当 作業\nend Z @担当 終わり\n\nS -> A -> Z';
let bizflowState = { selectedId: '', drafts: new Map(), newTitle: '', newPhase: 'asis' };
export function clearBizflowState() {
  bizflowState = { selectedId: '', drafts: new Map(), newTitle: '', newPhase: 'asis' };
}

const bfPhases = () => KINDS.bizflow.fields.phase.values;

// 図と、誤り・警告の一覧
function flowFigure(f, notation) {
  const r = flowGeometry(notation);
  const box = h('div', { class: 'stack' });
  box.appendChild(r.geo ? h('div', { class: 'graph-wrap bf-figure', 'data-flow': f.id }, renderFlowSvg(r.geo)) : h('div', { class: 'empty small', text: '描ける行がありません。記法を確かめてください' }));
  if (r.errors.length) box.appendChild(h('div', { class: 'notice warn small', role: 'status' },
    h('strong', { text: `誤り ${r.errors.length} 件（この行は図に出ていません${r.dropped.length > r.errors.length ? '。消えた箱につながる行も外しています' : ''}）` }),
    h('ul', null, r.errors.map((e) => h('li', { text: `${e.line} 行目: ${e.message}` })))));
  if (r.warnings.length) box.appendChild(h('ul', { class: 'small muted' }, r.warnings.map((w) => h('li', { text: `${w.line ? w.line + ' 行目: ' : ''}${w.message}` }))));
  return box;
}

export function renderBizflow(root, app, opts) {
  const ledger = store.view();
  const pres = store.presentation;
  if (opts && opts.flowId) { bizflowState.selectedId = opts.flowId; app.viewOpts = {}; }
  const flows = ledger.items.filter((it) => it.kind === 'bizflow');
  if (!flows.some((f) => f.id === bizflowState.selectedId)) bizflowState.selectedId = flows.length ? flows[0].id : '';
  for (const id of [...bizflowState.drafts.keys()]) if (!flows.some((f) => f.id === id)) bizflowState.drafts.delete(id);

  root.appendChild(h('h2', { text: '業務フロー' }));
  root.appendChild(h('p', { class: 'muted small', text: '現行（As-Is）と導入後（To-Be）の業務の流れを、フロー記法で持ちます。図は記法から自動で配置します。フローは指示文「業務フローの作成」で Gemini に書かせて取り込むか、ここで記法を直して保存します。' }));

  // 左: 一覧と新しいフロー
  const left = h('div', { class: 'stack' });
  left.appendChild(flows.length ? h('ul', { class: 'bf-list', role: 'list' }, flows.map((f) => h('li', null,
    h('button', { type: 'button', class: ['bf-item', f.id === bizflowState.selectedId && 'is-selected'], 'aria-pressed': String(f.id === bizflowState.selectedId), 'data-flow-id': f.id, onclick: () => { bizflowState.selectedId = f.id; app.refresh(); } },
      h('span', { class: ['badge', f.phase === 'tobe' ? 'accent' : 'low'], text: enumLabel(bfPhases(), f.phase) }), ' ',
      h('span', { class: 'mono small', text: f.id + ' ' }), f.title)))) : h('div', { class: 'empty small', text: 'まだ業務フローはありません' }));
  if (!pres) {
    const title = h('input', { type: 'text', 'aria-label': '新しいフローの題名', placeholder: '例: 受注処理（現行）', value: bizflowState.newTitle, 'data-fk': 'bf-new-title' });
    title.addEventListener('input', () => { bizflowState.newTitle = title.value; });
    const phase = h('select', { 'aria-label': '現行・導入後', 'data-fk': 'bf-new-phase' }, bfPhases().map((p) => h('option', { value: p.v, selected: p.v === bizflowState.newPhase, text: p.label })));
    phase.addEventListener('change', () => { bizflowState.newPhase = phase.value; });
    left.appendChild(h('section', { class: 'card stack', id: 'bf-new' },
      h('h3', { text: '新しいフロー' }), h('label', { class: 'field' }, '題名', title), h('label', { class: 'field' }, '現行・導入後', phase),
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', id: 'bf-create', onclick: () => {
          if (!bizflowState.newTitle.trim()) { toast('題名を入れてください'); return; }
          const r = store.applyLocal([{ op: 'add', tempId: 'new:bf', item: { kind: 'bizflow', title: bizflowState.newTitle.trim(), phase: bizflowState.newPhase, notation: BF_TEMPLATE, status: 'draft' } }]);
          if (!r.ok) { toast(r.errors.join(' / ')); return; }
          bizflowState.selectedId = r.idMap.get('new:bf') || '';
          bizflowState.newTitle = '';
          toast('業務フローを足しました（取り消し可）');
        } }, 'ひな形で作る'),
        h('button', { class: 'btn', type: 'button', onclick: () => app.go('prompts', { purpose: 'bizflow', flowId: '' }) }, 'Gemini に作らせる'))));
  }

  // 右: 選んだフロー
  const right = h('div', { class: 'stack' });
  const f = flows.find((x) => x.id === bizflowState.selectedId);
  if (f) {
    const notation = bizflowState.drafts.has(f.id) ? bizflowState.drafts.get(f.id) : String(f.notation || '');
    right.appendChild(h('div', { class: 'row' },
      h('h3', null, h('span', { class: ['badge', f.phase === 'tobe' ? 'accent' : 'low'], text: enumLabel(bfPhases(), f.phase) }), ' ', h('button', { class: 'linklike', type: 'button', onclick: () => store.select(f.id) }, `${f.id} ${f.title}`)),
      statusBadge(f.kind, f.status)));
    right.appendChild(flowFigure(f, notation));
    if (!pres) {
      const ta = h('textarea', { class: 'mono', rows: '14', id: 'bf-notation', 'aria-label': 'フロー記法', spellcheck: 'false', 'data-fk': 'bf-notation-' + f.id });
      ta.value = notation;
      const count = h('span', { class: 'small muted', text: `${notation.length.toLocaleString()} / ${BIZFLOW_NOTATION_MAX.toLocaleString()} 字` });
      ta.addEventListener('input', () => { bizflowState.drafts.set(f.id, ta.value); count.textContent = `${ta.value.length.toLocaleString()} / ${BIZFLOW_NOTATION_MAX.toLocaleString()} 字${ta.value !== f.notation ? '（未保存）' : ''}`; });
      const dirty = bizflowState.drafts.has(f.id) && bizflowState.drafts.get(f.id) !== f.notation;
      right.appendChild(h('div', { class: 'stack' }, ta, h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', id: 'bf-preview', onclick: () => app.refresh() }, '図を描き直す'),
        h('button', { class: 'btn primary', type: 'button', id: 'bf-save', onclick: () => {
          const text = bizflowState.drafts.has(f.id) ? bizflowState.drafts.get(f.id) : f.notation;
          if (!String(text).trim()) { toast('記法が空です'); return; }
          const r = store.applyLocal([{ op: 'update', id: f.id, set: { notation: text } }]);
          if (!r.ok) { toast(r.errors.join(' / ')); return; }
          bizflowState.drafts.delete(f.id);
          toast('記法を保存しました（取り消し可）');
        } }, '保存'),
        dirty ? h('button', { class: 'btn', type: 'button', id: 'bf-discard', onclick: () => { bizflowState.drafts.delete(f.id); app.refresh(); } }, '保存せずに戻す') : null,
        h('button', { class: 'btn', type: 'button', onclick: () => app.go('prompts', { purpose: 'bizflow', flowId: f.id }) }, 'Gemini に直させる'),
        h('span', { class: 'spacer' }), count)));
    }
    // 関連でつながる反対側のフロー（現行 ⇔ 導入後）を下に並べる
    const other = flows.filter((x) => x.id !== f.id && x.phase !== f.phase && ((f.links || []).includes(x.id) || (x.links || []).includes(f.id)));
    for (const o of other) {
      right.appendChild(h('section', { class: 'card stack bf-pair', 'data-pair': o.id },
        h('h3', null, h('span', { class: ['badge', o.phase === 'tobe' ? 'accent' : 'low'], text: enumLabel(bfPhases(), o.phase) }), ' ', h('button', { class: 'linklike', type: 'button', onclick: () => { bizflowState.selectedId = o.id; app.refresh(); } }, `${o.id} ${o.title}`)),
        flowFigure(o, String(o.notation || ''))));
    }
    if (!other.length) right.appendChild(h('p', { class: 'small muted', text: `関連でつながる${f.phase === 'asis' ? '導入後' : '現行'}のフローはありません（項目の詳細の「関連」でつなぐと、ここに並びます）` }));
  } else {
    right.appendChild(h('div', { class: 'empty', text: 'フローを選ぶか、新しいフローを作ってください' }));
  }
  root.appendChild(h('div', { class: 'bf-layout' }, left, right));
}
