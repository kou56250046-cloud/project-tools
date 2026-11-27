// 質問箱（qa-box）との連携（P6e・道具）
// 1. 台帳の未回答の質問を、qa-box のブロック形式で NotebookLM に聞く文にする（返事は qa-box に貼る）
// 2. qa-box の書き出し（JSON）を読み、台帳の質問への差分にして取込へ渡す
// 読んだ内容は画面のモジュールの中だけに持ち、ロックと案件の切り替えで消す

import { qaAskParts, parseQaBox, qaBoxToPatch } from '../../core/qabox.js';
import { QA_BOX_PROMPT } from '../../core/qabox-prompt.js';
import { h, toast, copyText } from '../dom.js';
import { store } from '../store.js';
import { sendPatchToImport } from './to-import.js';

const freshQabox = () => ({ picked: null, text: '', parsed: null, result: null, token: null });
let qaboxState = freshQabox();
export function clearQaboxState() { qaboxState = freshQabox(); }

function askCard(app, ledger) {
  const open = ledger.items.filter((it) => it.kind === 'question' && it.status === 'open');
  const st = qaboxState;
  if (st.picked) st.picked = new Set([...st.picked].filter((id) => open.some((q) => q.id === id)));
  const picked = st.picked || new Set(open.map((q) => q.id));
  const chosen = open.filter((q) => picked.has(q.id));
  const { parts, warnings } = qaAskParts(chosen, ledger.project.name);
  const toggle = (id, on) => { const s = new Set(picked); if (on) s.add(id); else s.delete(id); st.picked = s; app.refresh(); };
  return h('section', { class: 'card stack', id: 'qa-ask' },
    h('h3', { text: '1. 未回答の質問を NotebookLM に聞く' }),
    h('p', { class: 'small muted', text: 'NotebookLM に、先に「回答の形式」を一度貼っておきます（質問箱の「NotebookLM に貼る指示」と同じ文）。そのあと、下の聞く文を順に貼ります。返事は質問箱（qa-box）に貼ってください。質問の先頭の【QA-…】の印で、あとで台帳の質問と突き合わせます。' }),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', id: 'qa-copy-format', onclick: async () => toast((await copyText(QA_BOX_PROMPT)) ? '回答の形式の指示をコピーしました' : 'コピーできませんでした') }, '回答の形式の指示をコピー')),
    open.length ? h('div', { class: 'stack' },
      h('div', { class: 'row small' }, h('span', { text: `未回答の質問 ${open.length} 件のうち ${chosen.length} 件を聞く` }),
        h('button', { class: 'btn small', type: 'button', onclick: () => { st.picked = null; app.refresh(); } }, 'すべて選ぶ'),
        h('button', { class: 'btn small', type: 'button', onclick: () => { st.picked = new Set(); app.refresh(); } }, 'すべて外す')),
      h('div', { class: 'target-list', role: 'group', 'aria-label': '聞く質問' }, open.map((q) => h('label', { class: 'row small' },
        h('input', { type: 'checkbox', checked: picked.has(q.id), 'data-fk': 'qa-pick-' + q.id, onchange: (e) => toggle(q.id, e.target.checked) }),
        h('span', { class: 'mono', text: q.id }), q.title))),
      warnings.length ? h('ul', { class: 'notice warn small' }, warnings.map((w) => h('li', { text: w }))) : null,
      parts.length ? h('div', { class: 'row' }, parts.map((p, i) => h('button', { class: 'btn primary', type: 'button', 'data-fk': `qa-part-${i}`, title: `${p.length.toLocaleString()} 字`, onclick: async () => toast((await copyText(p)) ? `${i + 1}/${parts.length} をコピーしました（${p.length.toLocaleString()} 字）` : 'コピーできませんでした') }, parts.length > 1 ? `${i + 1}/${parts.length} をコピー` : '聞く文をコピー'))) : h('p', { class: 'small muted', text: '聞く質問を選んでください' }))
      : h('div', { class: 'empty small', text: '未回答の質問はありません' }));
}

function importCard(app, ledger) {
  const st = qaboxState;
  const ta = h('textarea', { rows: '5', id: 'qa-json', 'aria-label': '質問箱の JSON', placeholder: '質問箱（qa-box）で「JSON を書き出す」か「AI 用 JSON」で保存したファイルを選ぶか、中身を貼ります', 'data-fk': 'qa-json' });
  ta.value = st.text;
  ta.addEventListener('input', () => { st.text = ta.value; });
  const read = (text) => {
    st.text = text;
    st.parsed = parseQaBox(text);
    st.result = st.parsed.ok ? qaBoxToPatch(st.parsed.items, store.ledger) : null;
    app.refresh();
  };
  const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true, id: 'qa-file' });
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    if (!f) return;
    const tok = store.token;
    const text = await f.text();
    if (tok !== store.token) return;   // 読んでいる間に案件が替わったら捨てる
    read(text);
  });
  const p = st.parsed, r = st.result;
  return h('section', { class: 'card stack', id: 'qa-import' },
    h('h3', { text: '2. 質問箱（qa-box）の回答を台帳に取り込む' }),
    h('p', { class: 'small muted', text: '確定の回答は、台帳の質問を回答済みにして回答を入れます。未確定・提案・対応中・要確認は質問のまま残し、本文の「NotebookLM の回答案」の節に案と要確認の理由を入れます（前の案は置き換え。提案は確度「推測」）。台帳に無い質問は新しく足します。取込の画面のカードで確かめてから適用します。' }),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => file.click() }, 'ファイルを選ぶ'), file),
    ta,
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', id: 'qa-read', onclick: () => { if (!ta.value.trim()) { toast('貼るかファイルを選んでください'); return; } read(ta.value); } }, '読み込む')),
    p && !p.ok ? h('p', { class: 'notice error small', role: 'alert', text: p.error }) : null,
    p && p.ok && r ? h('div', { class: 'notice small stack', id: 'qa-result' },
      h('p', { text: `${p.format}・${p.items.length} 件を読みました${p.bad ? `（質問の無い ${p.bad} 件は読めませんでした）` : ''}。` }),
      h('p', { text: `台帳の質問と一致 ${r.summary.matched} 件・新しい質問 ${r.summary.added} 件・回答済みにする ${r.summary.confirmed} 件・回答案を入れる ${r.summary.draft} 件・変化なし ${r.summary.unchanged} 件${r.summary.duplicate ? `・同じ質問の重なり ${r.summary.duplicate} 件` : ''}` }),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', id: 'qa-to-import', disabled: !r.patch.ops.length, onclick: () => sendPatchToImport(app, r.patch) }, r.patch.ops.length ? `差分 ${r.patch.ops.length} 件を取込へ` : '取り込む変化はありません'))) : null);
}

export function renderQabox(root, app) {
  if (qaboxState.token !== null && qaboxState.token !== store.token) clearQaboxState();
  qaboxState.token = store.token;
  const ledger = store.ledger;
  root.appendChild(h('h2', { text: '質問箱（qa-box）' }));
  root.appendChild(h('p', { class: 'muted small', text: '質問箱（qa-box）は、NotebookLM に決まった形で回答させ、状態（確定・未確定・提案・対応中・要確認）つきで管理する別の HTML です。ここでは、台帳の未回答の質問を質問箱の形で聞く文にし、質問箱の書き出し（JSON）を台帳の質問に取り込みます。' }));
  root.appendChild(askCard(app, ledger));
  root.appendChild(importCard(app, ledger));
}
