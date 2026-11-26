// gemini-kit の案件カルテ（anken.v2）への書き出し。台帳は読むだけで変えない。
// 形は ~/projects/bunsekiya-manage/gemini-kit/src/js/schema.js（normalize・validate）に合わせる。
// カルテの ID は台帳の ID から決める（書き出すたびに同じ ID になり、gemini-kit の版の引き継ぎがずれない）。
// 項目は消さずに状態で表す（gemini-kit の「ID は消さずに状態を変える」決まり）。引用（quote）は台帳に原文が無いので常に空。

import { visibleLedger, idNumber } from './schema.js';

export const KARTE_SCHEMA = 'anken.v2';
// gemini-kit の VIEWPOINTS のうち、この書き出しで使うもの
export const KARTE_VIEWPOINTS = ['機能', '性能・可用性', 'セキュリティ', '移行', '運用・保守', '予算・契約', '日程', '現行システム'];
const FACT_BANDS = { requirement: 10000, request: 20000, constraint: 30000, answer: 40000 };
const BAND_SIZE = 10000;
const KARTE_KINDS = new Set(['requirement', 'request', 'constraint', 'question', 'decision', 'issue', 'task', 'stakeholder']);

const NFR_VIEWPOINT = { availability: '性能・可用性', performance: '性能・可用性', security: 'セキュリティ', migration: '移行', operability: '運用・保守', environment: '運用・保守' };
const CONSTRAINT_VIEWPOINT = { budget: '予算・契約', legal: '予算・契約', schedule: '日程', technical: '現行システム', operation: '運用・保守' };

const pad2 = (n) => String(n).padStart(2, '0');
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function factViewpoint(it) {
  if (it.kind === 'request') return '機能';
  if (it.kind === 'requirement') return it.category === 'functional' ? '機能' : (NFR_VIEWPOINT[it.nfrCategory] || '');
  if (it.kind === 'constraint') return CONSTRAINT_VIEWPOINT[it.category] || '';
  return '';
}

function factStatus(it) {
  if (it.confidence === 'guess') return '推測';
  if (it.confidence === 'fact' || it.confidence === 'confirmed') return '確定';
  return it.kind === 'requirement' && it.status === 'agreed' ? '確定' : '推測';
}

// 状態の印（消さずに状態で表す）
const FACT_MARK = { requirement: { dropped: '（取り下げ）' }, request: { rejected: '（不採用）', deferred: '（保留）' }, constraint: { resolved: '（解消）' } };
const OUT_STATUS = { requirement: 'dropped', request: 'rejected' };
const TODO_STATUS = { todo: '未着手', doing: '対応中', done: '完了', cancelled: 'クローズ' };
const PENDING_STATUS = { open: '未着手', in_progress: '対応中', closed: '完了' };

// 戻り値: { karte, counts, notes }
export function ledgerToKarte(ledger, { includeInternal = false, now, today } = {}) {
  const src = includeInternal ? ledger : visibleLedger(ledger, true);
  const items = src.items;
  const byId = new Map(ledger.items.map((it) => [it.id, it]));
  const nameOf = (id) => { const p = id && byId.get(id); return p && p.kind === 'stakeholder' ? p.title : ''; };
  const names = (ids) => (ids || []).map(nameOf).filter(Boolean).join('、');
  const firstSource = (it) => (it.sources || []).find((s) => s && s.type !== 'template') || null;
  const tooBig = [];
  const num = (it) => { const n = idNumber(it.id); if (n >= BAND_SIZE) { tooBig.push(it.id); return null; } return n; };

  // 書き出す項目
  const factItems = items.filter((it) => it.kind === 'requirement' || it.kind === 'request' || it.kind === 'constraint');
  const questions = items.filter((it) => it.kind === 'question');
  const decisionItems = items.filter((it) => it.kind === 'decision');
  const issueItems = items.filter((it) => it.kind === 'issue');
  const taskItems = items.filter((it) => it.kind === 'task');
  const exported = [...factItems, ...questions, ...decisionItems, ...issueItems, ...taskItems];

  // 出典: 書き出す項目の最初の出典（案件の型を除く）を (type, ref, date) でまとめ、日付・名前の順に S を振る
  const srcKey = (s) => [s.type, s.ref, s.date || ''].join('\u0000');
  const srcMap = new Map();
  for (const it of exported) {
    const s = firstSource(it);
    if (s && !srcMap.has(srcKey(s))) srcMap.set(srcKey(s), s);
  }
  const srcList = [...srcMap.values()].sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.ref.localeCompare(b.ref));
  const srcId = new Map(srcList.map((s, i) => [srcKey(s), 'S-' + pad2(i + 1)]));
  const sources = srcList.map((s, i) => ({ id: 'S-' + pad2(i + 1), name: s.ref, kind: s.type === 'meeting' ? '議事録' : 'その他', date: s.date || '', round: '', summary: '' }));
  const sourceOf = (it) => { const s = firstSource(it); return s ? srcId.get(srcKey(s)) : ''; };
  const speakerOf = (it) => { const s = firstSource(it); return s ? nameOf(s.speaker) : ''; };

  const idMap = {};
  const facts = [];
  for (const it of factItems) {
    const n = num(it);
    if (n === null) continue;
    const id = 'F-' + (FACT_BANDS[it.kind] + n);
    const mark = (FACT_MARK[it.kind] || {})[it.status] || '';
    const out = it.scope === 'out' || OUT_STATUS[it.kind] === it.status;
    const text = cut(it.body ? `${it.title}。${it.body}` : it.title, 200) + mark;
    const f = { id, viewpoint: factViewpoint(it), text, status: factStatus(it), source: sourceOf(it), at: '', speaker: speakerOf(it), quote: '', wbId: it.id };
    if (out) f.scope = '対象外';
    facts.push(f);
    idMap[id] = it.id;
  }

  const unknowns = [];
  let answerFacts = 0;
  for (const q of questions) {
    const n = num(q);
    if (n === null) continue;
    const qid = 'Q-' + pad2(n);
    const viewpoint = NFR_VIEWPOINT[q.nfrCategory] || '';
    const done = q.status === 'answered' || q.status === 'closed';
    let answeredBy = '';
    if (done && q.answer && String(q.answer).trim()) {
      const fid = 'F-' + (FACT_BANDS.answer + n);
      facts.push({ id: fid, viewpoint, text: cut(String(q.answer).trim(), 200), status: '確定', source: '', at: qid, speaker: nameOf(q.askTo), quote: '', answers: qid, wbId: q.id + '#answer' });
      idMap[fid] = q.id + '#answer';
      answeredBy = fid;
      answerFacts++;
    }
    const overdue = !done && q.due && today && q.due < today;
    unknowns.push({
      id: qid, viewpoint, question: q.title, why: q.body || '', priority: overdue ? '高' : '中', askTo: nameOf(q.askTo), raisedIn: sourceOf(q),
      status: done ? '回答済' : (q.askedAt ? '依頼中' : '未回答'), answeredBy, estimateImpact: '', assumption: '',
      askedOn: q.askedAt || '', answeredOn: '', wbId: q.id,
    });
    idMap[qid] = q.id;
  }

  const decisions = [];
  for (const d of decisionItems) {
    const n = num(d);
    if (n === null) continue;
    const id = 'D-' + pad2(n);
    const text = (d.status === 'superseded' ? '（置き換え済み）' : '') + d.title + (d.reason ? `。理由: ${d.reason}` : '');
    decisions.push({ id, text, owner: names(d.decidedBy), source: sourceOf(d), quote: '', wbId: d.id });
    idMap[id] = d.id;
  }

  const pending = [];
  for (const it of issueItems) {
    const n = num(it);
    if (n === null) continue;
    const id = 'H-' + pad2(n);
    pending.push({ id, text: it.title, owner: nameOf(it.owner), due: it.due || '', status: PENDING_STATUS[it.status] || '', source: sourceOf(it), quote: '', wbId: it.id });
    idMap[id] = it.id;
  }

  const todos = [];
  for (const t of taskItems) {
    const n = num(t);
    if (n === null) continue;
    const id = 'T-' + pad2(n);
    todos.push({ id, text: t.title, owner: nameOf(t.assignee), due: t.end || '', status: TODO_STATUS[t.status] || '', source: sourceOf(t), quote: '', wbId: t.id });
    idMap[id] = t.id;
  }

  const people = items.filter((it) => it.kind === 'stakeholder').map((p) => ({ name: p.title, org: p.org || '', role: p.side === 'own' ? '自社' : '', note: p.role || '' }));

  const karte = {
    schema: KARTE_SCHEMA,
    project: { name: ledger.project.name, client: ledger.project.customer || '', phase: '', updated: today || '', version: 0 },
    sources, facts, unknowns, decisions, pending, todos,
    conflicts: [], issues: [], proposals: [], people, asis: [], risks: [], reviews: [],
    workbench: { from: '案件ワークベンチ', project: ledger.project.name, revision: ledger.revision, exportedAt: now || '', includeInternal: !!includeInternal, idMap },
  };

  // 書き出しの対象になる種別のうち、社内のみの項目の数（含める・含めないに関係なく元の台帳で数える）
  const internalCount = ledger.items.filter((it) => it.internal && KARTE_KINDS.has(it.kind)).length;
  const counts = {
    facts: facts.length, answerFacts, unknowns: unknowns.length, openUnknowns: unknowns.filter((u) => u.status !== '回答済').length,
    decisions: decisions.length, pending: pending.length, todos: todos.length, people: people.length, sources: sources.length, internal: internalCount,
  };
  const notes = [];
  const noQuote = facts.length + decisions.length;
  if (noQuote) notes.push(`事実と決定の ${noQuote} 件は、台帳に資料の原文が無いため、gemini-kit で「引用がありません」と表示されます`);
  if (includeInternal && internalCount) notes.push(`社内のみの項目 ${internalCount} 件を含めます。顧客に見せる文書に載らないよう注意してください`);
  if (!includeInternal && internalCount) {
    notes.push(`社内のみの項目 ${internalCount} 件は書き出しません`);
    notes.push('前に社内のみを含めて書き出した版があると、gemini-kit で「消えています」と表示されることがあります');
  }
  if (tooBig.length) notes.push(`番号が ${BAND_SIZE} 以上の項目 ${tooBig.length} 件は書き出せません（${tooBig.slice(0, 5).join('、')}${tooBig.length > 5 ? ' ほか' : ''}）`);
  if ((ledger.changelog || []).some((e) => (e.changes || []).some((c) => c.op === 'reset'))) notes.push('この案件は中身を空に戻したことがあります。gemini-kit では別の案件名として読み込んでください');
  return { karte, counts, notes };
}
