// 取込画面: Gemini の返答を貼る → 差分をカードで確認 → 採用分だけ適用

import { KINDS, kindLabel, fieldSpec } from '../../core/schema.js';
import { extractJson } from '../../core/extract.js';
import { validatePatch, planPatch, previewPatch, opLabel, updateRows } from '../../core/patch.js';
import { buildFixPrompt } from '../../core/prompts.js';
import { h, toast, copyText, nowIso } from '../dom.js';
import { store } from '../store.js';
import { valueText, idButton, itemTitle } from '../detail.js';

// 取込の下書き（画面を切り替えても残す。再読み込みでは消える）
const draft = {
  text: '',
  extracted: null,   // extractJson の結果
  validated: null,   // validatePatch の結果
  gen: null,         // 検証したときの台帳の世代（revision は重なることがあるので使わない）
  token: null,       // 検証したときの台帳の印。台帳が置き換わったら下書きを捨てる
  accepted: new Set(),
  result: null,      // 直前の適用結果
  justRead: false,   // 読み取った直後（結果へスクロールする）
};

function clearDraft(keepText) {
  if (!keepText) draft.text = '';
  draft.extracted = null; draft.validated = null; draft.result = null; draft.accepted = new Set();
}

function runExtract(text) {
  draft.text = text;
  draft.result = null;
  draft.validated = null;
  try {
    draft.extracted = extractJson(text);
    if (draft.extracted.ok) revalidate(true);
  } catch (e) {
    draft.extracted = { ok: false, error: '読み取り中に問題が起きました（' + String(e && e.message || e) + '）' };
    draft.validated = null;
  }
  draft.justRead = true;
}

function revalidate(resetAccepted) {
  draft.validated = validatePatch(draft.extracted.value, store.ledger);
  draft.gen = store.gen;
  draft.token = store.token;
  if (resetAccepted) draft.accepted = new Set(draft.validated.ops.filter((p) => !p.errors.length).map((p) => p.index));
}

// 読み取った直後だけ、結果を読み上げ、結果の位置へスクロールしてフォーカスを移す
function announce(root, message, targetId) {
  if (!draft.justRead) return;
  draft.justRead = false;
  root.appendChild(h('p', { class: 'sr-only', role: 'status', 'aria-live': 'polite', text: message }));
  setTimeout(() => {
    const t = document.getElementById(targetId);
    if (t) { t.scrollIntoView({ block: 'start' }); t.focus({ preventScroll: true }); }
  }, 0);
}

function opTitle(p, ledger) {
  const op = p.op;
  if (!op || typeof op !== 'object') return '（読めない操作）';
  if (op.op === 'add') return op.item && typeof op.item.title === 'string' ? op.item.title : '（題名なし）';
  if (op.op === 'update') return `${op.id || '?'} ${itemTitle(op.id, ledger) || ''}`.trim();
  if (op.op === 'relate') {
    const n = (id) => itemTitle(id, ledger) || id;
    return `${n(op.from)} → ${n(op.to)}：${op.label || ''}`;
  }
  if (op.op === 'project') return '案件情報';
  return `op: ${String(op.op)}`;
}

function errorLines(v) {
  const lines = [...v.errors];
  for (const p of v.ops) {
    for (const e of p.errors) lines.push(`操作${p.index + 1}（${opLabel(p.type)}${p.kind && KINDS[p.kind] ? '・' + kindLabel(p.kind) : ''}）: ${e}`);
  }
  return lines;
}

function addBody(p, ledger) {
  const item = p.op.item || {};
  const kind = item.kind;
  const rows = h('div', { class: 'diff add' });
  const names = ['body', 'status', 'confidence', ...Object.keys(KINDS[kind] ? KINDS[kind].fields : {}), 'links', 'sources', 'tags'];
  for (const name of names) {
    if (item[name] === undefined) continue;
    const spec = KINDS[kind] ? fieldSpec(kind, name) : null;
    rows.appendChild(h('div', { class: 'k', text: spec ? spec.label : name }));
    rows.appendChild(h('div', { class: 'after span3', text: valueText(kind, name, item[name], ledger) }));
  }
  if (p.tempId) {
    rows.appendChild(h('div', { class: 'k', text: '仮ID' }));
    rows.appendChild(h('div', { class: 'after span3 mono', text: p.tempId }));
  }
  return rows;
}

function updateBody(p, ledger) {
  const t = ledger.items.find((x) => x.id === p.op.id);
  if (!t) return null;
  const rows = h('div', { class: 'diff' });
  for (const r of updateRows(ledger, p.op)) {
    rows.appendChild(h('div', { class: 'k', text: r.label }));
    rows.appendChild(h('div', { class: 'before', text: valueText(t.kind, r.field, r.before, ledger) }));
    rows.appendChild(h('div', { class: 'arrow', text: '→' }));
    rows.appendChild(h('div', { class: 'after', text: valueText(t.kind, r.field, r.after, ledger) }));
  }
  if (typeof p.op.reason === 'string') {
    rows.appendChild(h('div', { class: 'k', text: '理由' }));
    rows.appendChild(h('div', { class: 'after span3', text: p.op.reason }));
  }
  return rows;
}

const PROJECT_LABELS = { name: '案件名', customer: '顧客', purpose: '目的', periodStart: '開始日', periodEnd: '終了日', goals: 'ゴール', summary: '概要', starter: '案件の型' };

function projectBody(p, ledger) {
  const rows = h('div', { class: 'diff' });
  for (const [k, v] of Object.entries(p.op.set || {})) {
    const fmt = (x) => (x === undefined ? '（なし）' : x === null ? '（消す）' : Array.isArray(x) ? x.join(' / ') : String(x));
    rows.appendChild(h('div', { class: 'k', text: PROJECT_LABELS[k] || k }));
    rows.appendChild(h('div', { class: 'before', text: fmt(ledger.project[k]) }));
    rows.appendChild(h('div', { class: 'arrow', text: '→' }));
    rows.appendChild(h('div', { class: 'after', text: fmt(v) }));
  }
  return rows;
}

function card(p, plan, rerender, app) {
  const ledger = store.ledger;
  const hasError = p.errors.length > 0;
  const accepted = draft.accepted.has(p.index) && !hasError;
  const auto = plan.autoRejected.has(p.index);
  const willApply = plan.apply.has(p.index);
  const toggle = h('div', { class: 'toggle', role: 'group', 'aria-label': `操作${p.index + 1}を採用するか` },
    h('button', { class: 'accept', type: 'button', 'data-fk': `op-${p.index}-accept`, 'aria-pressed': String(accepted), disabled: hasError, onclick: () => { draft.accepted.add(p.index); rerender(); } }, '採用'),
    h('button', { class: 'reject', type: 'button', 'data-fk': `op-${p.index}-reject`, 'aria-pressed': String(!accepted), disabled: hasError, onclick: () => { draft.accepted.delete(p.index); rerender(); } }, '却下'));

  let body = null;
  if (!hasError || (p.op && p.op.op === 'update' && store.item(p.op.id))) {
    if (p.type === 'add' && p.op.item) body = addBody(p, ledger);
    else if (p.type === 'update') body = updateBody(p, ledger);
    else if (p.type === 'project') body = projectBody(p, ledger);
  }
  const msgs = [
    ...p.errors.map((e) => h('li', { class: 'error', text: e })),
    ...p.warnings.map((w) => h('li', { class: 'warning', text: w })),
    ...((plan.warnings.get(p.index) || []).map((w) => h('li', { class: 'warning', text: w }))),
  ];
  return h('article', { class: ['op-card', hasError && 'has-error', !willApply && 'rejected'], 'data-index': String(p.index) },
    h('div', { class: 'op-head' },
      h('span', { class: 'muted small mono', text: `#${p.index + 1}` }),
      h('span', { class: ['badge', p.type === 'add' ? 'ok' : p.type === 'update' ? 'accent' : ''], text: opLabel(p.type) }),
      p.kind && KINDS[p.kind] ? h('span', { class: 'badge', text: kindLabel(p.kind) }) : null,
      h('span', { class: 'op-title', text: opTitle(p, ledger) }),
      p.type === 'update' && store.item(p.op.id) ? idButton(p.op.id, app) : null,
      auto ? h('span', { class: 'badge mid', text: '自動で却下' }) : null,
      toggle),
    body,
    msgs.length ? h('ul', { class: 'msgs' }, msgs) : null);
}

// ほかの画面（判断・データ）から差分の文を渡すとき、置き換える前に下書きがあるかを確かめるのに使う
export function importDraftText() { return draft.text; }

export function renderImport(root, app, opts) {
  const ledger = store.ledger;
  // ほかの画面から渡された文（app.go('import', { text })）。呼ぶ側が下書きの置き換えを確かめてから渡す
  if (opts && typeof opts.text === 'string') {
    clearDraft(false);
    runExtract(opts.text);
    app.viewOpts = {};
  }
  // 台帳が置き換わっていたら下書きを捨てる。同じ台帳が変わっただけなら検証し直す
  if (draft.validated && draft.token !== store.token) clearDraft(true);
  else if (draft.validated && draft.gen !== store.gen) revalidate(false);

  root.appendChild(h('h2', { text: '取込' }));
  root.appendChild(h('ol', { class: 'steps muted small' },
    h('li', { text: '「指示文」画面で指示文をコピーし、資料と一緒に Gemini に貼る' }),
    h('li', { text: 'Gemini の返答をまるごとコピーして、下の欄に貼る（```json の囲みや説明文が付いていてもかまいません）' }),
    h('li', { text: '1件ずつ内容を確かめ、要らないものは「却下」にしてから「適用」を押す' })));

  const ta = h('textarea', { rows: '9', id: 'import-text', 'aria-label': 'Gemini の返答', placeholder: 'ここに Gemini の返答を貼り付けます' });
  ta.value = draft.text;
  // 読み取る前でも、貼った内容を画面の切り替えで失わない
  ta.addEventListener('input', () => { draft.text = ta.value; });
  root.appendChild(ta);
  root.appendChild(h('div', { class: 'row' },
    h('button', { class: 'btn primary', type: 'button', id: 'import-read', onclick: () => { runExtract(ta.value); app.refresh(); } }, '読み取る'),
    h('button', { class: 'btn', type: 'button', id: 'import-clear', onclick: () => { clearDraft(false); app.refresh(); } }, 'クリア')));

  if (draft.result) {
    const r = draft.result;
    root.appendChild(h('div', { class: 'notice', id: 'import-result', tabindex: '-1', role: 'status' },
      h('strong', { text: `${r.applied}件を取り込みました（rev ${r.revision}）。` }),
      ' 間違えたときは上部の「取り消し」で戻せます。',
      r.idMap.length ? h('div', { class: 'small' }, '振られた ID: ', r.idMap.map(([t, id], i) => [i ? '、' : '', `${t} → `, idButton(id, app)])) : null));
  }

  const ex = draft.extracted;
  if (!ex) return;
  if (!ex.ok) {
    announce(root, ex.error, 'import-error');
    root.appendChild(h('div', { class: 'notice error stack', id: 'import-error', tabindex: '-1' },
      h('p', { text: ex.error }),
      h('button', { class: 'btn', type: 'button', onclick: async () => {
        const ok = await copyText(buildFixPrompt([ex.error + '。JSON の文法（括弧・カンマ・引用符）を直し、途中で切れないように出力してください'], ledger));
        toast(ok ? '修正依頼文をコピーしました。Gemini に貼ってください' : 'コピーできませんでした');
      } }, 'Gemini への修正依頼文をコピー')));
    return;
  }
  if (ex.notes.length) root.appendChild(h('ul', { class: 'muted small' }, ex.notes.map((n) => h('li', { text: n }))));

  const v = draft.validated;
  if (v.warnings.length) root.appendChild(h('div', { class: 'notice warn' }, v.warnings.map((w) => h('div', { text: w }))));
  if (v.errors.length) root.appendChild(h('div', { class: 'notice error' }, v.errors.map((e) => h('div', { text: e }))));

  const plan = planPatch(v, draft.accepted);
  // 採用した操作を仮に適用し、項目をまたぐ誤り（循環など）が新しく出ないか確かめる
  const integ = plan.apply.size ? previewPatch(ledger, v, draft.accepted, nowIso()).integrityErrors : [];
  if (integ.length) {
    root.appendChild(h('div', { class: 'notice error', id: 'import-integrity' },
      h('strong', { text: 'このまま適用すると、項目をまたぐ誤りが出るため適用できません。関係する操作を却下するか、Gemini に直させてください。' }),
      h('ul', null, integ.map((e) => h('li', { text: `${e.itemId}: ${e.message}` })))));
  }
  const errCount = v.ops.filter((p) => p.errors.length).length;
  const lines = errorLines(v);
  for (const e of integ) lines.push(`項目をまたぐ誤り ${e.itemId}: ${e.message}`);
  const rerender = () => app.refresh();

  root.appendChild(h('div', { class: 'row import-summary', id: 'import-summary', tabindex: '-1' },
    h('strong', { text: `操作 ${v.ops.length}件` }),
    h('span', { class: 'badge ok', text: `適用 ${plan.apply.size}` }),
    h('span', { class: 'badge', text: `却下 ${v.ops.length - plan.apply.size - errCount}` }),
    errCount ? h('span', { class: 'badge high', text: `誤り ${errCount}` }) : null,
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn small', type: 'button', 'data-fk': 'accept-all', onclick: () => { draft.accepted = new Set(v.ops.filter((p) => !p.errors.length).map((p) => p.index)); rerender(); } }, 'すべて採用'),
    h('button', { class: 'btn small', type: 'button', 'data-fk': 'reject-all', onclick: () => { draft.accepted = new Set(); rerender(); } }, 'すべて却下')));

  root.appendChild(h('div', { class: 'stack op-list' }, v.ops.map((p) => card(p, plan, rerender, app))));
  announce(root, `操作 ${v.ops.length}件を読み取りました。適用 ${plan.apply.size}件${errCount ? `、誤り ${errCount}件` : ''}`, 'import-summary');

  root.appendChild(h('div', { class: 'sticky-bar row' },
    h('button', {
      class: 'btn primary', type: 'button', id: 'import-apply', disabled: plan.apply.size === 0 || integ.length > 0,
      onclick: () => {
        const r = store.applyValidated(v, draft.accepted);
        draft.result = { applied: r.applied, revision: r.ledger.revision, idMap: [...r.idMap.entries()] };
        draft.text = ''; draft.extracted = null; draft.validated = null;
        toast(`${r.applied}件を取り込みました`);
        app.refresh();
        document.getElementById('view').scrollTop = 0;
        const res = document.getElementById('import-result');
        if (res) res.focus({ preventScroll: true });
      },
    }, `適用（${plan.apply.size}件）`),
    lines.length ? h('button', { class: 'btn', type: 'button', id: 'import-fix', onclick: async () => {
      const ok = await copyText(buildFixPrompt(lines, ledger));
      toast(ok ? '修正依頼文をコピーしました。Gemini に貼ってください' : 'コピーできませんでした');
    } }, `修正依頼文をコピー（誤り ${lines.length}件）`) : null,
    plan.apply.size === 0 ? h('span', { class: 'muted small', text: '採用できる操作がないため、適用できません' }) : null));
}
