// メモ: チャット（Teams・Google Chat の貼り付け）や会議の文字起こしを、台帳の「メモ」として保管する。
// 一覧・絞り込み・選んだメモの書き出し（JSON・md）・「メモからの取込」の指示文へ。メモは社内のもの（説明用の表示では出さない）

import { MEMO_BODY_MAX, MEMO_TOTAL_WARN, enumLabel, KINDS } from '../../core/schema.js';
import { parseChat, linesToBody, bodyToLines, CHAT_FORMAT_LABEL } from '../../core/chat.js';
import { h, toast, download, confirmDialog, todayStr, nowIso } from '../dom.js';
import { store } from '../store.js';

let memosState = { draft: { title: '', memoType: 'chat', channel: '', tags: '', text: '' }, parsed: null, selected: new Set(), filter: { memoType: '', channel: '', from: '', to: '', tag: '' } };
export function clearMemosState() {
  memosState = { draft: { title: '', memoType: 'chat', channel: '', tags: '', text: '' }, parsed: null, selected: new Set(), filter: { memoType: '', channel: '', from: '', to: '', tag: '' } };
}

const memoTypes = () => KINDS.memo.fields.memoType.values;
const memoTotal = (ledger) => ledger.items.filter((it) => it.kind === 'memo').reduce((a, it) => a + String(it.body || '').length, 0);
const fileSafeName = (s) => String(s || '案件').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
const ymd = () => todayStr().replace(/-/g, '');

// メモを台帳に足す（前処理の画面からも使う）。戻り値 { ok, id? }
export async function saveMemo(app, { title, memoType, channel, tags, body, from, to }) {
  if (!store.ledger) { toast('案件を開くとメモにできます'); return { ok: false }; }
  if (!String(title || '').trim()) { toast('題名を入れてください'); return { ok: false }; }
  if (body.length > MEMO_BODY_MAX) { toast(`本文が ${body.length.toLocaleString()} 字あります。メモは ${MEMO_BODY_MAX.toLocaleString()} 字までです。期間を分けてください`); return { ok: false }; }
  const total = memoTotal(store.ledger) + body.length;
  if (total > MEMO_TOTAL_WARN && !(await confirmDialog(`この案件のメモの本文が合計 ${total.toLocaleString()} 字になります。`, 'それでも保存する',
    `目安の ${MEMO_TOTAL_WARN.toLocaleString()} 字を超えます。保存の中ではおよそ 4 倍の大きさになり、ブラウザの保存の上限（5MB）に近づきます。要らないメモを書き出してから消してください。`))) return { ok: false };
  const item = { kind: 'memo', title: String(title).trim(), memoType, body, status: 'active' };
  if (channel) item.channel = String(channel).trim();
  if (from) item.from = from;
  if (to) item.to = to;
  const tg = String(tags || '').split(/[,、\s]+/).map((x) => x.trim()).filter(Boolean);
  if (tg.length) item.tags = tg;
  const r = store.applyLocal([{ op: 'add', tempId: 'new:memo', item }], 'local');
  if (!r.ok) { toast(r.errors.join(' / ')); return { ok: false }; }
  const id = r.idMap.get('new:memo') || null;
  toast('メモにしました（取り消し可）');
  return { ok: true, id };
}

function exportJson(ledger, memos) {
  return JSON.stringify({
    type: 'memo-export', from: '案件ワークベンチ', project: ledger.project.name, exportedAt: nowIso(),
    memos: memos.map((m) => ({ id: m.id, title: m.title, memoType: m.memoType, channel: m.channel || '', from: m.from || '', to: m.to || '', tags: m.tags || [], lines: bodyToLines(m.body) })),
  }, null, 2) + '\n';
}
function exportMd(ledger, memos) {
  return [`# メモ: ${ledger.project.name}`, '', `（案件ワークベンチから ${todayStr()} に書き出し。社外へ持ち出さないでください）`, '',
    ...memos.flatMap((m) => [`## ${m.title}（${[m.channel, m.from || m.to ? `${m.from || '?'}〜${m.to || '?'}` : ''].filter(Boolean).join('・') || enumLabel(memoTypes(), m.memoType)}）`, '', String(m.body || ''), ''])].join('\n');
}

function pasteSection(app) {
  const d = memosState.draft;
  const inp = (key, label, attrs = {}) => {
    const el = h('input', { type: 'text', 'aria-label': label, value: d[key], 'data-fk': 'memo-' + key, ...attrs });
    el.addEventListener('input', () => { d[key] = el.value; });
    return h('label', { class: 'field' }, label, el);
  };
  const type = h('select', { 'aria-label': '種類', 'data-fk': 'memo-type' }, memoTypes().map((t) => h('option', { value: t.v, selected: d.memoType === t.v, text: t.label })));
  type.addEventListener('change', () => { d.memoType = type.value; });
  const ta = h('textarea', { rows: '8', id: 'memo-paste', 'aria-label': 'チャットの貼り付け', placeholder: 'Teams や Google Chat のやりとりを選んでコピーし、ここに貼ります。日付の行・発言者・時刻・本文に分け、「編集済み」やリアクションの行は落とします。', 'data-fk': 'memo-text' });
  ta.value = d.text;
  ta.addEventListener('input', () => { d.text = ta.value; });
  const p = memosState.parsed;
  const preview = p ? h('div', { class: 'stack' },
    h('p', { class: ['small', p.format === 'unknown' || p.unparsed ? 'notice warn' : 'notice'], id: 'memo-parse-result',
      text: `形: ${CHAT_FORMAT_LABEL[p.format]}・発言 ${p.lines.filter((l) => !l.raw).length} 件・落とした飾りの行 ${p.dropped} 件・読めなかった行 ${p.unparsed} 件${p.from ? `・期間 ${p.from}〜${p.to}` : ''}・本文 ${p.body.length.toLocaleString()} 字${p.body.length > MEMO_BODY_MAX ? `（${MEMO_BODY_MAX.toLocaleString()} 字を超えています。期間を分けて貼ってください）` : ''}` }),
    h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
      h('thead', null, h('tr', null, ['日時', '発言者', '本文'].map((t) => h('th', { scope: 'col', text: t })))),
      h('tbody', null, p.lines.slice(0, 50).map((l) => h('tr', { class: ['nocursor', l.raw && 'memo-raw'] },
        h('td', { class: 'mono small', text: l.at || '' }), h('td', { text: l.raw ? '（読めない行）' : l.speaker }), h('td', { class: 'wrap', text: l.text })))))),
    p.lines.length > 50 ? h('p', { class: 'small muted', text: `ほか ${p.lines.length - 50} 行` }) : null,
    h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', id: 'memo-save', disabled: p.body.length > MEMO_BODY_MAX, onclick: async () => {
      const r = await saveMemo(app, { title: d.title, memoType: d.memoType, channel: d.channel, tags: d.tags, body: p.body, from: p.from, to: p.to });
      if (r.ok) { memosState.draft = { title: '', memoType: 'chat', channel: '', tags: '', text: '' }; memosState.parsed = null; app.refresh(); }
    } }, 'メモとして保存'))) : null;
  return h('section', { class: 'card stack', id: 'memo-new' },
    h('h3', { text: 'チャットを貼り付けてメモにする' }),
    h('div', { class: 'row settings-row' }, inp('title', '題名', { placeholder: '例: 11 月の #要件 チャンネル' }), h('label', { class: 'field' }, '種類', type), inp('channel', '場所（チャンネル名など）'), inp('tags', 'タグ（、で区切る）')),
    ta,
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', id: 'memo-parse', onclick: () => {
      if (!d.text.trim()) { toast('貼り付けてください'); return; }
      const r = parseChat(d.text, { today: todayStr() });
      memosState.parsed = { ...r, body: linesToBody(r.lines) };
      app.refresh();
    } }, '読み取る')),
    preview);
}

export function renderMemos(root, app) {
  const ledger = store.ledger;
  root.appendChild(h('h2', { text: 'メモ' }));
  root.appendChild(h('p', { class: 'muted small', text: 'チャットや会議の文字起こしを、1 行 1 発言に整えて保管します。メモは社内のもので、顧客に見せる表示・一覧・gemini-kit 用カルテには出ません。台帳と同じく合言葉で暗号化して保存します。' }));
  root.appendChild(pasteSection(app));

  const all = ledger.items.filter((it) => it.kind === 'memo');
  const f = memosState.filter;
  memosState.selected = new Set([...memosState.selected].filter((id) => all.some((m) => m.id === id)));
  const matches = (m) => (!f.memoType || m.memoType === f.memoType)
    && (!f.channel || String(m.channel || '').includes(f.channel))
    && (!f.tag || (m.tags || []).some((t) => t.includes(f.tag)))
    && (!f.from || !m.to || m.to >= f.from)
    && (!f.to || !m.from || m.from <= f.to);
  const rows = all.filter(matches);
  const total = memoTotal(ledger);
  const filterInput = (key, label, type = 'text') => {
    const el = h('input', { type, 'aria-label': label, value: f[key], 'data-fk': 'mf-' + key });
    el.addEventListener('change', () => { f[key] = el.value; app.refresh(); });
    return h('label', { class: 'field' }, label, el);
  };
  const typeSel = h('select', { 'aria-label': '種類で絞る', 'data-fk': 'mf-type' }, h('option', { value: '', text: 'すべての種類' }), memoTypes().map((t) => h('option', { value: t.v, selected: f.memoType === t.v, text: t.label })));
  typeSel.addEventListener('change', () => { f.memoType = typeSel.value; app.refresh(); });
  const sel = [...memosState.selected].map((id) => all.find((m) => m.id === id)).filter(Boolean);
  root.appendChild(h('section', { class: 'card stack', id: 'memo-list' },
    h('h3', { text: `メモの一覧（${all.length} 件・本文 合計 ${total.toLocaleString()} 字）` }),
    total > MEMO_TOTAL_WARN ? h('p', { class: 'notice warn small', text: `メモの本文が目安の ${MEMO_TOTAL_WARN.toLocaleString()} 字を超えています。要らないメモを書き出してから消してください。` }) : null,
    h('div', { class: 'filters' }, h('label', { class: 'field' }, '種類', typeSel), filterInput('channel', '場所'), filterInput('tag', 'タグ'), filterInput('from', '期間（から）', 'date'), filterInput('to', '期間（まで）', 'date')),
    rows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
      h('thead', null, h('tr', null, ['', 'ID', '題名', '種類', '場所', '期間', '字数', ''].map((t) => h('th', { scope: 'col', text: t })))),
      h('tbody', null, rows.map((m) => h('tr', { class: [store.selectedId === m.id && 'selected'], 'data-id': m.id, onclick: (e) => { if (!e.target.closest('input,button')) store.select(m.id); } },
        h('td', null, h('input', { type: 'checkbox', 'aria-label': `${m.title} を選ぶ`, 'data-fk': 'msel-' + m.id, checked: memosState.selected.has(m.id), onchange: (e) => { if (e.target.checked) memosState.selected.add(m.id); else memosState.selected.delete(m.id); app.refresh(); } })),
        h('td', { class: 'mono small', text: m.id }),
        h('td', { class: 'title', text: m.title }),
        h('td', { text: enumLabel(memoTypes(), m.memoType) }),
        h('td', { text: m.channel || '' }),
        h('td', { class: 'small', text: m.from || m.to ? `${m.from || '?'}〜${m.to || '?'}` : '' }),
        h('td', { class: 'num', text: String(m.body || '').length.toLocaleString() }),
        h('td', null, h('button', { class: 'btn small danger', type: 'button', 'data-fk': 'mdel-' + m.id, onclick: async () => {
          if (!(await confirmDialog(`メモ「${m.title}」を消します。`, '消す', '「取り消し」で戻せます（再読み込みやロックの後は戻せません）。残したいときは先に書き出してください。'))) return;
          const r = store.applyLocal([{ op: 'remove', id: m.id }], 'local');
          toast(r.ok ? 'メモを消しました（取り消し可）' : r.errors.join(' / '));
        } }, '消す'))))))) : h('div', { class: 'empty small', text: all.length ? '条件に合うメモはありません' : 'まだメモはありません' }),
    h('div', { class: 'row' },
      h('span', { class: 'small muted', text: `${sel.length} 件選択中` }),
      h('button', { class: 'btn', type: 'button', id: 'memo-export-json', disabled: !sel.length, onclick: () => download(`${fileSafeName(ledger.project.name)}_memo_${ymd()}.json`, exportJson(ledger, sel)) }, 'JSON で書き出す'),
      h('button', { class: 'btn', type: 'button', id: 'memo-export-md', disabled: !sel.length, onclick: () => download(`${fileSafeName(ledger.project.name)}_memo_${ymd()}.md`, exportMd(ledger, sel), 'text/markdown;charset=utf-8') }, 'md で書き出す'),
      h('button', { class: 'btn primary', type: 'button', id: 'memo-to-prompt', disabled: !sel.length, onclick: () => app.go('prompts', { purpose: 'memo', memoIds: sel.map((m) => m.id) }) }, 'メモからの取込の指示文を開く'))));
}
