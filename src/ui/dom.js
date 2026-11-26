// DOM の小道具。外部由来の文字列は必ず textContent / setAttribute で入れる（innerHTML を使わない）

const SVG_NS = 'http://www.w3.org/2000/svg';

function setAttrs(el, attrs) {
  if (!attrs) return;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.setAttribute('class', Array.isArray(v) ? v.filter(Boolean).join(' ') : v);
    else if (k === 'text') el.textContent = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'value' && 'value' in el) el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') { el[k] = !!v; }
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  setAttrs(el, attrs);
  append(el, children);
  return el;
}

export function s(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  setAttrs(el, attrs);
  append(el, children);
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

let toastTimer = 0;
export function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

export function download(filename, text, type) {
  const blob = new Blob([text], { type: type || 'application/json;charset=utf-8' });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

function fallbackCopy(text) {
  const ta = h('textarea', { class: 'offscreen', 'aria-hidden': 'true' });
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove();
  return ok;
}

// クリップボードへコピー。file:// では isSecureContext が偽のことがあるので代替経路を持つ
export async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* 代替へ */ }
  }
  return fallbackCopy(text);
}

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function nowIso() { return new Date().toISOString(); }

// ブラウザの confirm() の代わり（自動操作を止めないよう <dialog> を使う）
export function confirmDialog(message, okLabel, detail) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'dialog' },
      h('p', { class: 'dialog-msg', text: message }),
      detail ? h('p', { class: 'muted small', text: detail }) : null,
      h('div', { class: 'row dialog-actions' },
        h('button', { class: 'btn', type: 'button', 'data-act': 'cancel', onclick: () => done(false) }, 'やめる'),
        h('button', { class: 'btn primary', type: 'button', 'data-act': 'ok', onclick: () => done(true) }, okLabel || 'OK')));
    function done(v) { dlg.close(); dlg.remove(); resolve(v); }
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(false); });
    document.body.appendChild(dlg);
    dlg.showModal();
  });
}

export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// 3 つ以上の選択肢を出すダイアログ。choices: [{ value, label, primary? }]。やめたら null
export function choiceDialog(message, choices, detail) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'dialog' },
      h('p', { class: 'dialog-msg', text: message }),
      detail ? h('p', { class: 'muted small', text: detail }) : null,
      h('div', { class: 'row dialog-actions' },
        h('button', { class: 'btn', type: 'button', 'data-act': 'cancel', onclick: () => done(null) }, 'やめる'),
        choices.map((c) => h('button', { class: ['btn', c.primary && 'primary'], type: 'button', 'data-act': c.value, onclick: () => done(c.value) }, c.label))));
    function done(v) { dlg.close(); dlg.remove(); resolve(v); }
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
    document.body.appendChild(dlg);
    dlg.showModal();
  });
}
