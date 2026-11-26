// 詳細パネルと、値の表示に使う共通の部品

import { KINDS, CONFIDENCE, SOURCE_TYPES, SCOPE, kindLabel, statusLabel, enumLabel, fieldSpec, buildBackrefs, refFieldLabel, TEMP_ID_RE } from '../core/schema.js';
import { h, clear, toast, fmtDateTime, copyText } from './dom.js';
import { impactOf, changeRequestText } from '../core/impact.js';
import { store } from './store.js';

export function itemTitle(id, ledger) {
  if (store.isHidden(id)) return '（社内のみ）';
  const it = ledger.items.find((x) => x.id === id);
  return it ? it.title : null;
}

// ID のボタン。台帳に無い ID は取り消し線で表示する
export function idButton(id, app, opts = {}) {
  if (TEMP_ID_RE.test(id)) return h('span', { class: 'mono small badge', text: id });
  if (store.isHidden(id)) return h('span', { class: 'muted small', text: '（社内のみ）' });
  const exists = !!store.item(id);
  if (!exists) return h('span', { class: 'idlink dangling', text: id, title: '台帳にない ID' });
  const title = opts.withTitle ? itemTitle(id, store.ledger) : null;
  return h('span', { class: 'idref' },
    h('button', { class: 'idlink', type: 'button', onclick: (e) => { e.stopPropagation(); app.openItem(id); }, text: id }),
    title ? h('span', { text: ' ' + title }) : null);
}

export function confBadge(conf) {
  return h('span', { class: `badge conf-${conf}`, text: enumLabel(CONFIDENCE, conf) });
}

export function statusBadge(kind, status) {
  const done = ['closed', 'answered', 'resolved', 'agreed', 'accepted', 'valid'].includes(status);
  const off = ['rejected', 'dropped', 'superseded', 'inactive', 'retired', 'deferred'].includes(status);
  return h('span', { class: ['badge', done ? 'ok' : off ? '' : 'accent'], text: statusLabel(kind, status) });
}

export function kindBadge(kind) {
  return h('span', { class: 'badge', text: kindLabel(kind) });
}

export function sourceText(src, ledger) {
  const parts = [enumLabel(SOURCE_TYPES, src.type) + ': ' + src.ref];
  if (src.date) parts.push(src.date);
  if (src.speaker) {
    const n = itemTitle(src.speaker, ledger);
    parts.push('発言者: ' + (n ? `${n}（${src.speaker}）` : src.speaker));
  }
  if (src.note) parts.push(src.note);
  return parts.join(' ／ ');
}

// フィールドの値を表示用の要素にする（ID はボタンになる）
export function fieldValue(kind, name, value, app) {
  const spec = fieldSpec(kind, name);
  if (value === undefined || value === null || value === '') return h('span', { class: 'muted', text: '—' });
  if (!spec) return h('span', { text: typeof value === 'string' ? value : JSON.stringify(value) });
  switch (spec.type) {
    case 'enum': return h('span', { text: enumLabel(spec.values, value) });
    case 'status': return statusBadge(kind, value);
    case 'ref': return idButton(value, app, { withTitle: true });
    case 'refs':
      if (!Array.isArray(value) || !value.length) return h('span', { class: 'muted', text: '—' });
      return h('span', { class: 'refs' }, value.map((id, i) => [i ? '、' : null, idButton(id, app, { withTitle: true })]));
    case 'strings': return h('span', { text: Array.isArray(value) ? value.join(' / ') : String(value) });
    case 'sources':
      return h('div', null, (Array.isArray(value) ? value : []).map((sx) => h('div', { class: 'source small', text: sourceText(sx, store.ledger) })));
    case 'text': return h('span', { class: 'body-text', text: String(value) });
    case 'boolean': return h('span', { text: value ? 'はい' : 'いいえ' });
    case 'crud':
      return h('div', { class: 'small' }, (Array.isArray(value) ? value : []).map((c) => h('div', null, idButton(c.entity, app, { withTitle: true }), ` … ${c.ops}`)));
    case 'columns':
    case 'fields':
      return h('div', { class: 'small nested-lines' }, (Array.isArray(value) ? value : []).map((el) => h('div', { text: nestedLine(spec.type, el) })));
    default: return h('span', { text: String(value) });
  }
}

// 列・項目の1行の説明（例: customer_code 得意先コード code(8) 主キー 必須 → EN-001.customer_code）
export function nestedLine(type, el) {
  if (!el || typeof el !== 'object') return String(el);
  const ref = type === 'columns' ? el.fk : el.source;
  return [
    el.name, el.logical, el.type ? `${el.type}${el.length ? `(${el.length}${el.scale ? ',' + el.scale : ''})` : ''}` : null,
    el.pk ? '主キー' : null, el.required ? '必須' : null,
    ref && ref.entity ? `→ ${ref.entity}.${ref.column || ''}` : null,
    el.pattern ? `形 ${el.pattern}` : null,
  ].filter(Boolean).join(' ');
}

// 取込のカードなどで使う、値の短い文字列表現
export function valueText(kind, name, value, ledger) {
  if (value === undefined) return '（なし）';
  if (value === null) return '（消す）';
  const spec = fieldSpec(kind, name);
  const ref = (id) => { const t = itemTitle(id, ledger); return t ? `${id} ${t}` : id; };
  if (!spec) return typeof value === 'string' ? value : JSON.stringify(value);
  switch (spec.type) {
    case 'enum': return enumLabel(spec.values, value);
    case 'status': return statusLabel(kind, value);
    case 'ref': return ref(value);
    case 'refs': return Array.isArray(value) && value.length ? value.map(ref).join('、') : '（なし）';
    case 'strings': return Array.isArray(value) ? value.join(' / ') : String(value);
    case 'sources': return Array.isArray(value) && value.length ? value.map((sx) => sourceText(sx, ledger)).join('\n') : '（なし）';
    case 'boolean': return value ? 'はい' : 'いいえ';
    case 'crud': return Array.isArray(value) && value.length ? value.map((c) => `${ref(c.entity)} … ${c.ops}`).join('\n') : '（なし）';
    case 'columns':
    case 'fields': return Array.isArray(value) && value.length ? value.map((el) => nestedLine(spec.type, el)).join('\n') : '（なし）';
    default: return String(value);
  }
}

function section(title, ...children) {
  return h('section', null, h('h3', { text: title }), ...children);
}

export function renderDetail(root, app) {
  clear(root);
  const it = store.selectedId && !store.isHidden(store.selectedId) ? store.item(store.selectedId) : null;
  if (!it) { root.hidden = true; return; }
  root.hidden = false;
  // 説明用の表示では、社内のみの項目を除いた台帳で影響範囲・逆参照を求める
  const ledger = store.view();
  const pres = store.presentation;
  const spec = KINDS[it.kind];

  root.appendChild(h('div', { class: 'detail-head' },
    h('div', null, kindBadge(it.kind), ' ', h('span', { class: 'mono small', text: it.id })),
    h('button', { class: 'btn small', type: 'button', 'aria-label': '詳細を閉じる（Esc）', onclick: () => app.closeDetail() }, '閉じる')));
  root.appendChild(h('h2', { class: 'detail-title', id: 'detail-title', tabindex: '-1', text: it.title }));
  root.appendChild(h('div', { class: 'row' }, statusBadge(it.kind, it.status), confBadge(it.confidence),
    ...(it.tags || []).map((t) => h('span', { class: 'badge', text: '#' + t }))));

  // 操作: 確認済みにする・状態の変更（AC-18）
  const sel = h('select', { 'aria-label': '状態を変える', id: 'detail-status' },
    spec.statuses.map((st) => h('option', { value: st.v, selected: st.v === it.status, text: st.label })));
  sel.addEventListener('change', () => {
    const r = store.applyLocal([{ op: 'update', id: it.id, set: { status: sel.value } }]);
    toast(r.ok ? `状態を「${statusLabel(it.kind, sel.value)}」にしました（取り消し可）` : r.errors.join(' / '));
  });
  root.appendChild(h('div', { class: 'row detail-actions' },
    it.confidence !== 'confirmed' ? h('button', {
      class: 'btn', type: 'button', id: 'detail-confirm',
      onclick: () => { const r = store.applyLocal([{ op: 'update', id: it.id, set: { confidence: 'confirmed' } }]); toast(r.ok ? '確認済みにしました（取り消し可）' : r.errors.join(' / ')); },
    }, '確認済みにする') : null,
    h('label', { class: 'row small' }, '状態', sel),
    // 社内のみの切り替え（P3 AC-19）。説明用の表示中は出さない
    pres ? null : h('label', { class: 'row small' },
      h('input', { type: 'checkbox', id: 'detail-internal', checked: !!it.internal, onchange: (e) => {
        const r = store.applyLocal([{ op: 'update', id: it.id, set: { internal: e.target.checked ? true : null } }]);
        toast(r.ok ? (e.target.checked ? '社内のみにしました（説明用の表示で隠れます）' : '社内のみを外しました') : r.errors.join(' / '));
      } }), '社内のみ')));

  // 範囲の変更（要望・要件のみ。P2 AC-21）
  if (it.kind === 'request' || it.kind === 'requirement') {
    const scopeSel = h('select', { id: 'detail-scope', 'aria-label': '範囲' }, SCOPE.map((sc) => h('option', { value: sc.v, selected: sc.v === (it.scope || 'tbd'), text: sc.label })));
    const reason = h('textarea', { id: 'detail-scope-reason', rows: '2', 'aria-label': '範囲の判断理由', placeholder: '範囲外・範囲内と判断した理由（例: 見積の前提に含まない、第5回定例で合意）' });
    reason.value = it.scopeReason || '';
    root.appendChild(h('div', { class: 'stack scope-edit' },
      h('div', { class: 'row small' }, h('label', { class: 'row' }, '範囲', scopeSel),
        h('button', { class: 'btn small', type: 'button', id: 'detail-scope-save', onclick: () => {
          const set = { scope: scopeSel.value, scopeReason: reason.value.trim() || null };
          const r = store.applyLocal([{ op: 'update', id: it.id, set }]);
          toast(r.ok ? '範囲を変えました（取り消し可）' : r.errors.join(' / '));
        } }, '範囲を保存')),
      reason));
  }

  const kv = h('dl', { class: 'kv' });
  for (const name of Object.keys(spec.fields)) {
    if (it[name] === undefined) continue;
    // 説明用の表示では、課題の重要度と作業の実績を出さない
    if (pres && (name === 'severity' || name === 'actual')) continue;
    kv.appendChild(h('dt', { text: spec.fields[name].label }));
    kv.appendChild(h('dd', null, fieldValue(it.kind, name, it[name], app)));
  }
  kv.appendChild(h('dt', { text: '作成' }));
  kv.appendChild(h('dd', { class: 'small', text: fmtDateTime(it.createdAt) }));
  kv.appendChild(h('dt', { text: '更新' }));
  kv.appendChild(h('dd', { class: 'small', text: fmtDateTime(it.updatedAt) }));
  root.appendChild(kv);

  if (it.body) root.appendChild(section('内容', h('p', { class: 'body-text', text: it.body })));

  // 変更要求: 影響範囲と下書き（P3）
  if (it.kind === 'change') {
    const imp = impactOf(ledger, [it.id]);
    const groups = Object.entries(imp.byKind).filter(([, v]) => v.length);
    root.appendChild(section('影響範囲（2 段まで）',
      h('p', { class: 'small', id: 'impact-estimate' }, '影響する作業の見積の合計: ', h('strong', { text: `${imp.taskEstimate} 人日` }), `（作業 ${imp.tasks.length}件）`),
      groups.length
        ? h('div', null, groups.map(([k, list]) => h('div', { class: 'small impact-group' },
          h('span', { class: 'badge', text: `${kindLabel(k)} ${list.length}` }), ' ',
          list.map((x, i) => [i ? '、' : '', idButton(x.id, app, { withTitle: true })]))))
        : h('p', { class: 'muted small', text: 'つながる項目がありません。対象（関連）を入れてください' }),
      h('div', { class: 'row' },
        pres ? null : h('button', { class: 'btn', type: 'button', id: 'change-draft', onclick: async () => {
          const ok = await copyText(changeRequestText(ledger, it, imp));
          toast(ok ? '変更要求書の下書きをコピーしました' : 'コピーできませんでした');
        } }, '変更要求書の下書きをコピー'),
        store.presentation ? null : h('button', { class: 'btn', type: 'button', onclick: () => app.go('prompts', { purpose: 'change-review', changeId: it.id }) }, '影響レビューの指示文へ'))));
  }

  root.appendChild(section('出典',
    it.sources.length
      ? h('div', null, it.sources.map((sx) => h('div', { class: 'source' },
        h('div', { text: `${enumLabel(SOURCE_TYPES, sx.type)}: ${sx.ref}` }),
        h('div', { class: 'small muted' },
          sx.date ? '日付 ' + sx.date : '日付 不明', ' ／ 発言者 ', sx.speaker ? idButton(sx.speaker, app, { withTitle: true }) : '不明',
          sx.note ? ' ／ ' + sx.note : ''))))
      : h('p', { class: 'muted', text: '出典がありません' })));

  root.appendChild(section('関連（この項目から）',
    it.links.length
      ? h('ul', { class: 'ref-list' }, it.links.map((id) => {
        const t = store.isHidden(id) ? null : store.item(id);
        return h('li', null, idButton(id, app), t ? kindBadge(t.kind) : null, h('span', { text: t ? t.title : store.isHidden(id) ? '' : '台帳にありません' }));
      }))
      : h('p', { class: 'muted', text: 'なし' })));

  const back = (buildBackrefs(ledger).get(it.id) || []).filter((b) => !store.isHidden(b.from));
  root.appendChild(section('この項目を参照している項目',
    back.length
      ? h('ul', { class: 'ref-list' }, back.map((b) => {
        const t = store.item(b.from);
        return h('li', null, idButton(b.from, app), h('span', { class: 'badge', text: refFieldLabel(b.field, t && t.kind) + (b.label ? '：' + b.label : '') }),
          h('span', { text: t ? t.title : '台帳にありません' }));
      }))
      : h('p', { class: 'muted', text: 'なし' })));
}
