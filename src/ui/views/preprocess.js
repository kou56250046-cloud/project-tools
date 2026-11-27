// 議事録の前処理: 文字起こし（Teams の VTT・txt、Meet、話者:本文）を 1 行 1 発言に整える（gemini-kit の前処理と同じ規則）。
// 結果は保存しない（ロックで消す）。「メモとして台帳に入れる」で台帳のメモにできる（50,000 字を超えるときは分ける）

import { TRANSCRIPT } from '../../core/transcript.js';
import { decodeText, baseName } from '../../core/convert.js';
import { MEMO_BODY_MAX } from '../../core/schema.js';
import { h, toast, download, copyText, confirmDialog, todayStr } from '../dom.js';
import { store } from '../store.js';
import { saveMemo } from './memos.js';

let preprocessState = { items: [], seq: 0, paste: '' };
export function clearPreprocessState() { preprocessState = { items: [], seq: 0, paste: '' }; }

const PREVIEW = 200;
const RATE_WARN = 0.8;

function addResult(name, text) {
  const r = TRANSCRIPT.clean(text);
  preprocessState.items.push({ id: ++preprocessState.seq, name, result: r, title: name ? baseName(name) : `貼り付け ${todayStr()}` });
}

// 行の区切りで、上限を超えないように分ける
function splitBody(body, max) {
  const parts = [];
  let cur = '';
  for (const line of body.split('\n')) {
    const add = cur ? `${cur}\n${line}` : line;
    if (add.length > max && cur) { parts.push(cur); cur = line; } else cur = add;
  }
  if (cur) parts.push(cur);
  return parts;
}

async function toMemo(app, it) {
  const body = it.result.out.replace(/\n+$/, '');
  const parts = body.length > MEMO_BODY_MAX ? splitBody(body, MEMO_BODY_MAX) : [body];
  if (parts.length > 1 && !(await confirmDialog(`${body.length.toLocaleString()} 字あり、メモの上限（${MEMO_BODY_MAX.toLocaleString()} 字）を超えています。`, `${parts.length} 件のメモに分けて保存する`,
    `行の区切りで分け、題名を「${it.title}（1/${parts.length}）」のようにします。`))) return;
  for (let i = 0; i < parts.length; i++) {
    const title = parts.length > 1 ? `${it.title}（${i + 1}/${parts.length}）` : it.title;
    const r = await saveMemo(app, { title, memoType: 'transcript', channel: '', tags: '', body: parts[i], from: '', to: '' });
    if (!r.ok) return;
  }
}

function resultCard(app, it) {
  const r = it.result;
  const s = r.stats;
  const lines = r.out.split('\n');
  const title = h('input', { type: 'text', value: it.title, 'aria-label': 'メモにするときの題名', 'data-fk': `pp-${it.id}-title` });
  title.addEventListener('input', () => { it.title = title.value; });
  const chart = h('div', { class: 'pp-chart' });
  const card = h('section', { class: 'card stack', 'data-pp': it.id },
    h('div', { class: 'row' },
      h('strong', { text: it.name || '貼り付け' }),
      h('span', { class: 'badge accent', text: r.format }),
      h('span', { class: 'small muted', text: `発言 ${s.utterances} 件・読めなかった行 ${s.unparsed} 件・読めた割合 ${Math.round(s.rate * 100)}%・${r.out.length.toLocaleString()} 字` }),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn small', type: 'button', 'data-fk': `pp-${it.id}-save`, onclick: () => download(`${it.name ? baseName(it.name) : `前処理_${todayStr().replace(/-/g, '')}`}.clean.txt`, r.out, 'text/plain;charset=utf-8') }, '.clean.txt を保存'),
      h('button', { class: 'btn small', type: 'button', 'data-fk': `pp-${it.id}-copy`, onclick: async () => toast((await copyText(r.out)) ? 'コピーしました' : 'コピーできませんでした') }, 'コピー'),
      h('button', { class: 'btn small', type: 'button', 'data-fk': `pp-${it.id}-remove`, onclick: () => { preprocessState.items = preprocessState.items.filter((x) => x !== it); app.refresh(); } }, '一覧から外す')),
    s.rate < RATE_WARN ? h('p', { class: 'notice warn small', text: '形式が想定と違う可能性があります（読めた行が 8 割未満）。読めなかった行は本文のまま残しています。' }) : null,
    chart,
    h('details', { class: 'cv-preview' }, h('summary', { text: `本文の先頭（${Math.min(PREVIEW, lines.length)} / ${lines.length} 行）` }), h('pre', { class: 'cv-pre', text: lines.slice(0, PREVIEW).join('\n') })),
    h('div', { class: 'row' },
      h('label', { class: 'field' }, 'メモにするときの題名', title),
      h('button', { class: 'btn', type: 'button', 'data-fk': `pp-${it.id}-memo`, disabled: !store.ledger, title: store.ledger ? '' : '案件を開くとメモにできます', onclick: () => toMemo(app, it) }, 'メモとして台帳に入れる'),
      store.ledger ? null : h('span', { class: 'small muted', text: '案件を開くとメモにできます' })));
  return { card, chart, stats: s };
}

export function renderPreprocess(root, app) {
  root.appendChild(h('h2', { text: '議事録の前処理' }));
  root.appendChild(h('p', { class: 'muted small', text: 'Teams（VTT・txt）・Meet の文字起こしを、1 行 1 発言（時刻 話者｜本文）に整え、つなぎ言葉（えー・あのー など）を除きます。結果は保存しません（ロックすると消えます）。整えた本文を「議事録の取込」の指示文に貼るか、メモにします。' }));
  const input = h('input', { type: 'file', multiple: true, accept: '.txt,.vtt,text/plain,text/vtt', id: 'pp-file', 'aria-label': '文字起こしのファイルを選ぶ' });
  input.addEventListener('change', async () => {
    const st = preprocessState;   // ロックで替わったら、読んだ結果を捨てる
    for (const f of [...input.files]) {
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        if (st !== preprocessState) return;
        addResult(f.name, decodeText(bytes).text);
      } catch (e) { toast(`${f.name} を読めませんでした`); }
    }
    input.value = '';
    app.refresh();
  });
  const ta = h('textarea', { rows: '5', id: 'pp-paste', 'aria-label': '文字起こしの貼り付け', placeholder: 'または、文字起こしをここに貼ります' });
  ta.value = preprocessState.paste;
  ta.addEventListener('input', () => { preprocessState.paste = ta.value; });
  root.appendChild(h('section', { class: 'card stack' },
    h('div', { class: 'row' }, h('span', { class: 'small', text: 'ファイル（複数可・UTF-8 / Shift_JIS）' }), input),
    ta,
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', type: 'button', id: 'pp-run', onclick: () => { if (!preprocessState.paste.trim()) { toast('貼り付けてください'); return; } addResult('', preprocessState.paste); preprocessState.paste = ''; app.refresh(); } }, '貼り付けを整える'),
      h('button', { class: 'btn', type: 'button', onclick: () => app.go('prompts', { purpose: 'minutes' }) }, '「議事録の取込」の指示文を開く'),
      preprocessState.items.length ? h('button', { class: 'btn', type: 'button', id: 'pp-clear', onclick: () => { clearPreprocessState(); app.refresh(); } }, '結果を空にする') : null)));
  const Dash = window.Dash;
  for (const it of preprocessState.items) {
    const { card, chart, stats } = resultCard(app, it);
    root.appendChild(card);
    // 話者ごとの発言数（描く前に文書に入れておく。dash.js は幅を測って描く）
    if (Dash && stats.bySpeaker.length) {
      Dash.bar(chart, { title: '話者ごとの発言', unit: '件', items: stats.bySpeaker.slice(0, 15).map((b) => ({ label: b.speaker, value: b.count })), sort: 'desc', empty: 'まだありません', asOf: todayStr(), source: it.name || '貼り付け' });
    }
  }
}
