// 指示文画面: 目的を選ぶ → 指示文を作る → コピーして Gemini / NotebookLM に貼る

import { PURPOSES, buildPrompt, memoMaterial, MEMO_PROMPT_MAX } from '../../core/prompts.js';
import { KINDS, enumLabel } from '../../core/schema.js';
import { h, toast, copyText, todayStr } from '../dom.js';
import { store } from '../store.js';

const freshPromptState = () => ({ purpose: 'minutes', freeText: '', meetingId: '', changeId: '', reportText: '', targetIds: [], memoIds: [], flowId: '' });
const promptState = freshPromptState();
// ロックで自由記述・報告の貼り付け・選んだ項目を消す
export function clearPromptsState() { Object.assign(promptState, freshPromptState()); }

const GUIDE = {
  notebooklm: 'NotebookLM に資料を入れたうえで、この文を質問欄に貼ります。返ってきた箇条書きは、「資料からの追加」の指示文と一緒に Gemini に貼ってください（指示文の末尾の「ここから資料」の下に貼ります）。',
  default: 'コピーした指示文を Gemini に貼り、末尾の「--- ここから資料 ---」の下に資料・議事録を貼って送ります。返答は「取込」画面に貼ります。',
  review: 'レビューは台帳そのものが材料です。補足の資料が無ければ、そのまま送ってかまいません。返答は「取込」画面に貼ります。',
};

export function renderPrompts(root, app, opts) {
  const ledger = store.ledger;
  // 他の画面から目的と会議を指定して開かれたとき
  if (opts && opts.purpose) {
    promptState.purpose = opts.purpose;
    if (opts.meetingId) promptState.meetingId = opts.meetingId;
    if (opts.changeId) promptState.changeId = opts.changeId;
    if (Array.isArray(opts.targetIds)) promptState.targetIds = opts.targetIds;
    if (Array.isArray(opts.memoIds)) promptState.memoIds = opts.memoIds;
    if (opts.flowId !== undefined) promptState.flowId = opts.flowId;
    if (opts.reportText !== undefined) promptState.reportText = opts.reportText;
    app.viewOpts = {};
  }
  if (promptState.meetingId && !ledger.items.some((it) => it.id === promptState.meetingId)) promptState.meetingId = '';
  if (promptState.flowId && !ledger.items.some((it) => it.id === promptState.flowId && it.kind === 'bizflow')) promptState.flowId = '';
  root.appendChild(h('h2', { text: '指示文' }));

  const list = h('div', { class: 'purpose-list', role: 'group', 'aria-label': '指示文の目的' });
  let group = null;
  for (const p of PURPOSES) {
    if (p.group !== group) { group = p.group; list.appendChild(h('div', { class: 'muted small group-title', text: group })); }
    list.appendChild(h('button', {
      class: 'purpose', type: 'button', 'aria-pressed': String(promptState.purpose === p.id), 'data-purpose': p.id,
      onclick: () => { promptState.purpose = p.id; app.refresh(); },
    }, h('span', { class: 't', text: p.label }), h('span', { class: 'd', text: p.desc })));
  }

  const right = h('div', { class: 'stack' });
  const isJudge = ['judge-flow', 'table-def', 'judge-master', 'judge-cases'].includes(promptState.purpose);
  const guide = isJudge ? 'Gemini に要件定義書などを添付した会話で、この文を送ります。返ってきた囲み（flow か markdown）は「判断・データ」の画面の欄に貼ります。差分ではないので「取込」には貼りません。' : promptState.purpose === 'report-polish' ? '返ってきた文面をそのままメールや Chat に使います。差分ではないので「取込」には貼りません。' : promptState.purpose === 'notebooklm' ? GUIDE.notebooklm : promptState.purpose.startsWith('review-') ? GUIDE.review : GUIDE.default;
  right.appendChild(h('p', { class: 'notice', text: guide }));

  const preview = h('textarea', { class: 'prompt-preview', id: 'prompt-text', readonly: true, 'aria-label': '生成された指示文', rows: '24' });
  const refresh = () => { preview.value = buildPrompt(promptState.purpose, ledger, { today: todayStr(), freeText: promptState.freeText, meetingId: promptState.purpose === 'minutes' ? promptState.meetingId : '', changeId: promptState.changeId, reportText: promptState.reportText, targetIds: promptState.targetIds, memoIds: promptState.memoIds, flowId: promptState.flowId }); };

  if (promptState.purpose === 'minutes') {
    const ms = ledger.items.filter((it) => it.kind === 'meeting').sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const sel = h('select', { id: 'prompt-meeting', 'aria-label': 'どの会議の議事録か' },
      h('option', { value: '', text: '会議を指定しない' }),
      ms.map((m) => h('option', { value: m.id, selected: m.id === promptState.meetingId, text: `${m.date}　${m.title}` })));
    sel.addEventListener('change', () => { promptState.meetingId = sel.value; refresh(); });
    right.appendChild(h('label', { class: 'field' }, 'どの会議の議事録か（指定すると、出席者とヒヤリングシートの質問が指示文に入ります）', sel));
  }
  if (promptState.purpose === 'bizflow') {
    const fs = ledger.items.filter((it) => it.kind === 'bizflow');
    const phases = KINDS.bizflow.fields.phase.values;
    const sel = h('select', { id: 'prompt-flow', 'aria-label': 'どのフローを直すか' },
      h('option', { value: '', text: '新しいフローを作らせる' }),
      fs.map((f) => h('option', { value: f.id, selected: f.id === promptState.flowId, text: `${f.id} ${f.title}（${enumLabel(phases, f.phase)}）` })));
    sel.addEventListener('change', () => { promptState.flowId = sel.value; refresh(); });
    right.appendChild(h('label', { class: 'field' }, 'どのフローを直すか（選ぶと、そのフローの記法が全文入ります）', sel));
  }
  if (promptState.purpose === 'change-review') {
    const crs = ledger.items.filter((it) => it.kind === 'change');
    const sel = h('select', { id: 'prompt-change', 'aria-label': 'どの変更要求か' },
      h('option', { value: '', text: '変更要求を選ぶ' }),
      crs.map((c) => h('option', { value: c.id, selected: c.id === promptState.changeId, text: `${c.id} ${c.title}` })));
    sel.addEventListener('change', () => { promptState.changeId = sel.value; refresh(); });
    right.appendChild(h('label', { class: 'field' }, 'どの変更要求をレビューさせるか', sel));
  }
  if (promptState.purpose === 'test-viewpoints') {
    promptState.targetIds = promptState.targetIds.filter((id) => ledger.items.some((it) => it.id === id));
    const cands = ledger.items.filter((it) => (it.kind === 'requirement' && it.status !== 'dropped') || it.kind === 'screen');
    const box = h('div', { class: 'target-list', id: 'prompt-targets', role: 'group', 'aria-label': 'テストの対象' }, cands.map((it) => h('label', { class: 'row small' },
      h('input', { type: 'checkbox', 'data-fk': 'target-' + it.id, checked: promptState.targetIds.includes(it.id), onchange: (e) => {
        promptState.targetIds = e.target.checked ? [...promptState.targetIds, it.id] : promptState.targetIds.filter((x) => x !== it.id);
        app.refresh();
      } }),
      h('span', { class: 'mono', text: it.id }), it.title)));
    right.appendChild(h('div', { class: 'field' }, h('span', { text: `テストの対象（${promptState.targetIds.length}件選択中）` }), box));
  }
  // メモからの取込: メモを選ぶ（本文の合計が上限を超えたら指示文を作らない）
  let memoOver = false;
  if (promptState.purpose === 'memo') {
    promptState.memoIds = promptState.memoIds.filter((id) => ledger.items.some((it) => it.id === id && it.kind === 'memo'));
    const memos = ledger.items.filter((it) => it.kind === 'memo');
    const mm = memoMaterial(ledger, promptState.memoIds);
    memoOver = mm.over;
    const box = h('div', { class: 'target-list', id: 'prompt-memos', role: 'group', 'aria-label': '取り込むメモ' }, memos.length ? memos.map((it) => h('label', { class: 'row small' },
      h('input', { type: 'checkbox', 'data-fk': 'memo-' + it.id, checked: promptState.memoIds.includes(it.id), onchange: (e) => {
        promptState.memoIds = e.target.checked ? [...promptState.memoIds, it.id] : promptState.memoIds.filter((x) => x !== it.id);
        app.refresh();
      } }),
      h('span', { class: 'mono', text: it.id }), `${it.title}（${String(it.body || '').length.toLocaleString()} 字）`)) : h('span', { class: 'small muted', text: 'メモがありません。「メモ」の画面でチャットを貼ってメモにしてください' }));
    right.appendChild(h('div', { class: 'field' }, h('span', { text: `取り込むメモ（${promptState.memoIds.length} 件・${mm.total.toLocaleString()} 字選択中）` }), box));
    if (memoOver) right.appendChild(h('p', { class: 'notice error small', role: 'alert', id: 'memo-over', text: `選んだメモの本文が合計 ${mm.total.toLocaleString()} 字で、上限の ${MEMO_PROMPT_MAX.toLocaleString()} 字を超えています。Gemini に一度に貼れる量の目安を超えるため、メモを減らして分けて取り込んでください` }));
  }
  if (promptState.purpose === 'report-polish') {
    const ta = h('textarea', { rows: '6', id: 'prompt-report-text', 'aria-label': '週報の下書き', placeholder: '定例会資料の画面から開くと、週報の下書きが入ります。ここに直接貼ってもかまいません' });
    ta.value = promptState.reportText;
    ta.addEventListener('input', () => { promptState.reportText = ta.value; refresh(); });
    right.appendChild(h('label', { class: 'field' }, '週報の下書き', ta));
  }
  if (promptState.purpose === 'free') {
    const free = h('textarea', { rows: '4', 'aria-label': '自由指示', placeholder: '例: 課題の重要度を、期限と影響の大きさから見直してください' });
    free.value = promptState.freeText;
    free.addEventListener('input', () => { promptState.freeText = free.value; refresh(); });
    right.appendChild(h('label', { class: 'field' }, '指示', free));
  }
  refresh();

  right.appendChild(h('div', { class: 'row' },
    h('button', { class: 'btn primary', type: 'button', id: 'prompt-copy', disabled: memoOver, title: memoOver ? '選んだメモが多すぎます' : '', onclick: async () => {
      const ok = await copyText(preview.value);
      if (ok) toast('コピーしました');
      else { preview.select(); toast('コピーできませんでした。選択した状態にしたので Ctrl+C でコピーしてください'); }
    } }, '指示文をコピー'),
    h('span', { class: 'muted small', text: `${preview.value.length.toLocaleString()} 文字 ／ 台帳 rev ${ledger.revision}` }),
    promptState.purpose === 'notebooklm' ? h('button', { class: 'btn', type: 'button', onclick: () => { promptState.purpose = 'material'; app.refresh(); } }, '「資料からの追加」へ') : null,
    isJudge ? h('button', { class: 'btn', type: 'button', onclick: () => app.go('judge') }, '判断・データへ') : promptState.purpose !== 'notebooklm' && promptState.purpose !== 'report-polish' ? h('button', { class: 'btn', type: 'button', onclick: () => app.go('import') }, '取込へ') : null));
  right.appendChild(preview);

  root.appendChild(h('div', { class: 'prompt-layout' }, list, right));
}
