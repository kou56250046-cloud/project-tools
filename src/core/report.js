// 定例会資料と週報の文面: 期間の変更・EVM・遅れ・顧客待ち・新しい決定・次回までの作業

import { dayNumber, localDayNumber, kindLabel, statusLabel, visibleLedger } from './schema.js';
import { buildTree, dayToYmd } from './wbs.js';
import { computeEvm } from './evm.js';
import { ballOf, waitDays } from './ball.js';

const DONE = new Set(['done', 'closed', 'answered', 'agreed', 'accepted', 'approved', 'achieved']);
export const NEXT_DAYS = 14;

// 前回の会議: 開催済みの定例のうち、今日より前で最も新しいもの。無ければ 7 日前
export function previousMeetingDate(ledger, today) {
  const t = dayNumber(today);
  const ms = ledger.items.filter((it) => it.kind === 'meeting' && it.meetingType === 'regular' && it.status === 'held' && it.date && dayNumber(it.date) < t)
    .sort((a, b) => b.date.localeCompare(a.date));
  return ms.length ? ms[0].date : dayToYmd(t - 7);
}

// 戻り値: { from, to, added, completed, statusChanged, decisions, evm, delayed, waiting, next }
export function buildReport(ledgerAll, { from, to, today, presentation }) {
  const ledger = visibleLedger(ledgerAll, presentation);
  const byId = new Map(ledger.items.map((it) => [it.id, it]));
  const f = dayNumber(from);
  const tt = dayNumber(to);
  const added = new Map();
  const completed = new Map();
  const statusChanged = new Map();
  for (const e of ledger.changelog || []) {
    if (e.source === 'snapshot') continue;
    const d = localDayNumber(e.at);
    if (d < f || d > tt) continue;
    for (const c of e.changes || []) {
      const it = byId.get(c.id);
      if (!it) continue;   // 社内のみで隠れた項目・関係など
      if (c.op === 'add') added.set(it.id, it);
      else if (c.statusTo && DONE.has(c.statusTo)) { completed.set(it.id, { item: it, from: c.statusFrom, to: c.statusTo }); statusChanged.delete(it.id); }
      else if (c.statusTo) statusChanged.set(it.id, { item: it, from: c.statusFrom, to: c.statusTo });
    }
  }
  const decisions = ledger.items.filter((it) => it.kind === 'decision' && it.decidedAt && dayNumber(it.decidedAt) >= f && dayNumber(it.decidedAt) <= tt);
  const hasTasks = ledger.items.some((it) => it.kind === 'task');
  const evm = hasTasks ? computeEvm(ledger, today) : null;
  const tree = buildTree(ledger, today);
  const delayed = tree.flat.filter((n) => n.delayed).map((n) => n.item);
  const waiting = ledger.items
    .filter((it) => ballOf(it, ledger) === 'customer')
    .map((it) => ({ item: it, wait: waitDays(it, ledger, today) }))
    .sort((a, b) => (b.wait ?? -1) - (a.wait ?? -1));
  const limit = dayNumber(to) + NEXT_DAYS;
  const next = tree.flat.filter((n) => n.leaf && n.item.end && !['done', 'cancelled'].includes(n.item.status) && dayNumber(n.item.end) <= limit && dayNumber(n.item.end) > tt)
    .map((n) => n.item).sort((a, b) => a.end.localeCompare(b.end));
  return {
    from, to, presentation: !!presentation,
    added: [...added.values()], completed: [...completed.values()], statusChanged: [...statusChanged.values()],
    decisions, evm, delayed, waiting, next,
  };
}

const line = (it) => `・${it.title}（${it.id}）`;

// 週報の平文（メールや Chat に貼る）。説明用の表示では実績（AC・CPI・EAC）を書かない
export function reportText(r, projectName) {
  const L = [];
  L.push(`【${projectName}】週次報告（${r.from}〜${r.to}）`, '');
  L.push('■ 今週の進捗');
  if (r.evm) {
    const base = `計画 ${r.evm.pv} 人日に対し出来高 ${r.evm.ev} 人日（SPI ${r.evm.spi ?? '—'}）`;
    L.push(r.presentation ? `・${base}` : `・${base}、実績 ${r.evm.ac} 人日（CPI ${r.evm.cpi ?? '—'}）`);
  }
  for (const c of r.completed) L.push(`・完了: ${c.item.title}（${kindLabel(c.item.kind)}）`);
  for (const it of r.added) L.push(`・追加: ${it.title}（${kindLabel(it.kind)}）`);
  if (!r.completed.length && !r.added.length) L.push('・期間中の追加・完了はありません');
  if (r.delayed.length) {
    L.push('', '■ 遅れている作業');
    for (const it of r.delayed) L.push(`${line(it)} 予定 ${it.start}〜${it.end}・進捗 ${it.progress || 0}%`);
  }
  L.push('', '■ 決まったこと');
  if (r.decisions.length) for (const d of r.decisions) L.push(`・${d.decidedAt} ${d.title}${d.reason ? '（理由: ' + d.reason + '）' : ''}`);
  else L.push('・期間中の決定はありません');
  L.push('', '■ お願い（ご回答・ご対応をお待ちしています）');
  if (r.waiting.length) for (const w of r.waiting) L.push(`・${w.item.title}${w.item.due ? '（期限 ' + w.item.due + '）' : ''}${w.wait !== null ? ' ' + w.wait + '日経過' : ''}`);
  else L.push('・ありません');
  L.push('', `■ 来週以降の予定（${NEXT_DAYS}日以内に終わる予定の作業）`);
  if (r.next.length) for (const it of r.next) L.push(`・${it.end} ${it.title}（${statusLabel('task', it.status)}・${it.progress || 0}%）`);
  else L.push('・ありません');
  return L.join('\n');
}
