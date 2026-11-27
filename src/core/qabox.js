// qa-box（質問箱）との連携（P6e）。DOM に触れない
// 台帳 → NotebookLM: 未回答の質問を qa-box のブロック形式で聞く文にする（返事は qa-box に貼る）
// qa-box → 台帳: qa-box の書き出し（控えの JSON v1・v2 と AI 用の qa-box.ai.v1）を読み、台帳の質問への差分にする
// 突き合わせ: 質問文の【QA-004】の印 → 印が無ければ qa-box と同じ規則で正規化した質問文と台帳の質問の題名の完全一致

import { KINDS } from './schema.js';
import { safeParse } from './extract.js';

export const QA_INPUT_MAX = 3000;   // NotebookLM の入力欄に 1 通で貼る上限（qa-box の INPUT_MAX と同じ）
export const QA_STATES = ['確定', '未確定', '提案', '対応中', '要確認'];
const QA_TITLE_MAX = 120;

// qa-box の parse.qkey と同じ正規化（NFKC・小文字・** と ` を除く・空白と句読点と括弧を除く）
export const qaKey = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/\*\*|`/g, '').replace(/[\s?？。、．.,，!！「」『』()（）[\]【】:：;；・"'”“’‘]/g, '');
const qaPrefix = () => KINDS.question.prefix;
const tagRe = () => new RegExp(`[【[]\\s*(${qaPrefix()}-\\d{1,4})\\s*[】\\]]`);
// 質問文から台帳の ID の印を取り出す。戻り値 { id, text（印を外した文） }
export function qaTag(question) {
  const s = String(question || '');
  const m = tagRe().exec(s);
  return { id: m ? m[1] : null, text: (m ? s.replace(m[0], '') : s).trim() };
}

// ---------- 台帳 → NotebookLM ----------
const qaBlock = (q) => `## 新規\n### 質問\n【${q.id}】${String(q.title).trim()}\n`;
function qaCompose(list, projectName) {
  return [
    `次の質問に、指定の形式で答えてください（案件: ${projectName || '（案件名なし）'}）。`,
    '見出しは「## 新規」のままにし、質問の先頭の【QA-…】の印は、質問の文にそのまま残してください。',
    '',
    list.map(qaBlock).join('\n'),
  ].join('\n');
}
// 質問（台帳の項目）の並び → { parts: [文], warnings: [文] }。1 通 max 字以内に質問の切れ目で分ける
export function qaAskParts(questions, projectName, max = QA_INPUT_MAX) {
  const parts = [], warnings = [];
  let cur = [];
  for (const q of questions) {
    if (qaCompose([q], projectName).length > max) {
      if (cur.length) { parts.push(qaCompose(cur, projectName)); cur = []; }
      parts.push(qaCompose([q], projectName));
      warnings.push(`${q.id} は 1 件で ${max} 字を超えています。質問の題名を短くしてください`);
      continue;
    }
    if (cur.length && qaCompose([...cur, q], projectName).length > max) { parts.push(qaCompose(cur, projectName)); cur = []; }
    cur.push(q);
  }
  if (cur.length) parts.push(qaCompose(cur, projectName));
  return { parts, warnings };
}

// ---------- qa-box → 台帳 ----------
// 戻り値 { ok, items: [{ qid, status, question, answer, source, reason, date }], format, error }
export function parseQaBox(text) {
  let d;
  try { d = safeParse(String(text || '').replace(/^﻿/, '')); } catch (e) { return { ok: false, items: [], error: 'JSON として読めません（質問箱の「JSON を書き出す」か「AI 用 JSON」のファイルを選んでください）' }; }
  let raw, format;
  if (d && d.app === 'qa-box' && Array.isArray(d.items)) { raw = d.items; format = `qa-box の控え（version ${d.version || 1}）`; }
  else if (d && d.format === 'qa-box.ai.v1' && Array.isArray(d.items)) { raw = d.items; format = 'qa-box の AI 用 JSON（qa-box.ai.v1）'; }
  else return { ok: false, items: [], error: '質問箱（qa-box）の書き出しファイルではありません' };
  const items = [];
  let bad = 0;
  for (const x of raw) {
    if (!x || typeof x.question !== 'string' || !x.question.trim()) { bad++; continue; }
    const st = String(x.status || '').trim();
    items.push({
      qid: typeof x.id === 'string' ? x.id : '',
      status: QA_STATES.includes(st) ? st : '要確認',
      question: x.question,
      answer: typeof x.answer === 'string' ? x.answer : '',
      source: typeof x.source === 'string' ? x.source : '',
      reason: typeof x.reason === 'string' ? x.reason : '',
      date: typeof x.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.date) ? x.date : '',
    });
  }
  return { ok: true, items, format, bad };
}

const QA_SEC_HEAD = '--- NotebookLM の回答案';
const QA_SEC_END = '--- ここまで ---';
const qaSection = (it) => [`${QA_SEC_HEAD}（qa-box ${it.qid || '番号なし'}・${it.status}${it.date ? '・' + it.date : ''}）---`,
  it.answer.trim() || '（回答なし）', it.reason.trim() ? `要確認の理由: ${it.reason.trim()}` : '', it.source.trim() ? `根拠: ${it.source.trim()}` : '', QA_SEC_END].filter(Boolean).join('\n');
// 本文の「NotebookLM の回答案」の節だけを置き換える（無ければ末尾に足す）。それ以外の本文は残す
export function qaReplaceSection(body, section) {
  const b = String(body || '');
  const re = /--- NotebookLM の回答案[^\n]*---\n[\s\S]*?\n--- ここまで ---/;
  if (re.test(b)) return b.replace(re, section);
  return b.trim() ? `${b.replace(/\s+$/, '')}\n\n${section}` : section;
}
const qaSource = (it) => {
  const s = { type: 'doc', ref: `NotebookLM（qa-box ${it.qid || '番号なし'}）`, note: [it.source.trim() ? `根拠: ${it.source.trim()}` : '', `状態: ${it.status}`].filter(Boolean).join(' / ') };
  if (it.date) s.date = it.date;
  return s;
};

// items → { patch, summary: { confirmed, draft, added, matched, unchanged, duplicate } }
export function qaBoxToPatch(items, ledger) {
  const questions = ledger.items.filter((it) => it.kind === 'question');
  const byId = new Map(questions.map((q) => [q.id, q]));
  const byKey = new Map();
  for (const q of questions) { const k = qaKey(qaTag(q.title).text); if (k && !byKey.has(k)) byKey.set(k, q); }
  const summary = { confirmed: 0, draft: 0, added: 0, matched: 0, unchanged: 0, duplicate: 0 };
  const ops = [];
  const seen = new Set();
  let n = 0;
  for (const it of items) {
    const tag = qaTag(it.question);
    const q = (tag.id && byId.get(tag.id)) || byKey.get(qaKey(tag.text)) || null;
    const key = q ? q.id : `new:${qaKey(tag.text)}`;
    if (seen.has(key)) { summary.duplicate++; continue; }
    seen.add(key);
    const done = it.status === '確定';
    const src = qaSource(it);
    if (q) {
      summary.matched++;
      const set = {};
      if (done) {
        if (q.status !== 'answered' || String(q.answer || '') !== it.answer.trim()) { set.status = 'answered'; set.answer = it.answer.trim(); }
      } else {
        const body = qaReplaceSection(q.body, qaSection(it));
        if (body !== String(q.body || '')) set.body = body;
        if (it.status === '提案' && q.confidence !== 'guess' && q.status === 'open') set.confidence = 'guess';
      }
      if (!Object.keys(set).length) { summary.unchanged++; continue; }
      if (!(q.sources || []).some((s) => s && s.ref === src.ref && s.note === src.note)) set.sources = [...(q.sources || []), src];
      ops.push({ op: 'update', id: q.id, set });
      if (done) summary.confirmed++; else summary.draft++;
    } else {
      const text = tag.text || it.question.trim();
      const title = [...text].length > QA_TITLE_MAX ? [...text].slice(0, QA_TITLE_MAX - 1).join('') + '…' : text;
      const item = { kind: 'question', title, status: done ? 'answered' : 'open', confidence: it.status === '提案' ? 'guess' : 'fact', sources: [src] };
      if (done) item.answer = it.answer.trim();
      const body = [title !== text ? `質問（全文）: ${text}` : '', done ? '' : qaSection(it)].filter(Boolean).join('\n\n');
      if (body) item.body = body;
      ops.push({ op: 'add', tempId: `new:qa${++n}`, item });
      summary.added++;
      if (done) summary.confirmed++; else summary.draft++;
    }
  }
  return { patch: { type: 'ledger-patch', basedOnRevision: ledger.revision, summary: 'qa-box（質問箱）の回答を台帳の質問へ', ops }, summary };
}
