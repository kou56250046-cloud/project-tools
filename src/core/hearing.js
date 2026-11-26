// ヒヤリングの候補と、ベースラインとの差

import { kindLabel, linkIndex } from './schema.js';
import { runHealth } from './health.js';
import { nfrStatus } from './nfr.js';

const GAP_CODES = { 'no-owner': '担当と期限', 'no-source': '根拠（誰がいつ言ったか）', 'must-guess': '内容（Must だが推測のまま）', 'stale-guess': '内容（推測のまま）' };

// 次のヒヤリングの候補。戻り値: { key, type: 'question' | 'gap' | 'nfr', ref, text, ops(meetingId) }[]
// ops は「この会議に割り当てる」ときの差分の操作（applyLocalOps に渡す）
export function hearingCandidates(ledger, today) {
  const out = [];
  const idx = linkIndex(ledger);
  const byId = new Map(ledger.items.map((it) => [it.id, it]));
  const hasOpenQuestion = (id) => [...(idx.get(id) || [])].some((x) => { const q = byId.get(x); return q && q.kind === 'question' && q.status === 'open'; });

  // 未回答で会議が決まっていない質問
  for (const q of ledger.items) {
    if (q.kind !== 'question' || q.status !== 'open' || q.meeting) continue;
    out.push({ key: 'q:' + q.id, type: 'question', ref: q.id, text: q.title, ops: (m) => [{ op: 'update', id: q.id, set: { meeting: m } }] });
  }

  // 健康診断の空欄。質問そのものの空欄は除く（質問を増やしても埋まらない）。既に未回答の質問でつながっていれば除く
  const seen = new Set();
  for (const f of runHealth(ledger, today)) {
    if (!GAP_CODES[f.code] || !f.itemId || seen.has(f.itemId)) continue;
    const it = byId.get(f.itemId);
    // リスク・KPI は社内で扱うもの（顧客に聞く質問にしない）
    if (!it || it.kind === 'question' || it.kind === 'meeting' || it.kind === 'risk' || it.kind === 'kpi' || hasOpenQuestion(it.id)) continue;
    seen.add(it.id);
    const text = `${kindLabel(it.kind)}「${it.title}」の${GAP_CODES[f.code]}を確認する`;
    out.push({
      key: 'g:' + it.id, type: 'gap', ref: it.id, text,
      ops: (m) => [{ op: 'add', item: { kind: 'question', title: text, meeting: m, links: [it.id], confidence: 'fact', sources: [{ type: 'other', ref: 'ヒヤリングの候補（健康診断）' }] } }],
    });
  }

  // 非機能の未着手の大項目
  for (const c of nfrStatus(ledger)) {
    if (c.state !== 'none') continue;
    const text = `${c.label}について確認する（${c.points.slice(0, 2).join('、')} など）`;
    out.push({
      key: 'n:' + c.id, type: 'nfr', ref: c.id, text,
      ops: (m) => [{ op: 'add', item: { kind: 'question', title: `${c.label}について確認する`, body: c.points.map((p) => '・' + p).join('\n'), meeting: m, nfrCategory: c.id, confidence: 'fact', sources: [{ type: 'other', ref: 'ヒヤリングの候補（非機能）' }] } }],
    });
  }
  return out;
}

const DROPPED = { requirement: 'dropped', request: 'rejected' };

// ベースラインと今の差。戻り値: { added: Item[], scopeChanged: { item, from, to }[], dropped: Item[] }
export function baselineDiff(baseline, ledger) {
  const base = new Map(baseline.items.map((x) => [x.id, x]));
  const added = [];
  const scopeChanged = [];
  const dropped = [];
  for (const it of ledger.items) {
    if (it.kind !== 'request' && it.kind !== 'requirement') continue;
    const b = base.get(it.id);
    if (!b) { added.push(it); continue; }
    const now = it.scope || 'tbd';
    if (b.scope !== now) scopeChanged.push({ item: it, from: b.scope, to: now });
    if (it.status === DROPPED[it.kind] && b.status !== DROPPED[it.kind]) dropped.push(it);
  }
  return { added, scopeChanged, dropped };
}
