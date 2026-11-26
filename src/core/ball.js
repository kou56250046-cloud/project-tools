// ボール（誰の対応待ちか）と待ち日数。未完了の課題・質問だけが対象。

import { isOpen, dayNumber, localDayNumber, OWNER_FIELD } from './schema.js';

export const BALL = [
  { v: 'customer', label: '顧客待ち' },
  { v: 'own', label: '自社待ち' },
  { v: 'vendor', label: '協力会社待ち' },
  { v: 'unknown', label: '未定' },
];

const ownerField = (it) => OWNER_FIELD[it.kind];

// まだ聞いていない質問: 予定の会議に割り当て済みで、聞いた日が無い
export function notAskedYet(it, ledger) {
  if (it.kind !== 'question' || it.askedAt || !it.meeting) return false;
  const m = ledger.items.find((x) => x.id === it.meeting);
  return !!m && m.status === 'planned';
}

// 戻り値: 'customer' | 'own' | 'vendor' | 'unknown'。未完了でなければ null
export function ballOf(it, ledger) {
  if ((it.kind !== 'issue' && it.kind !== 'question') || !isOpen(it)) return null;
  if (notAskedYet(it, ledger)) return 'own';
  const who = it[ownerField(it)];
  if (!who) return 'unknown';
  const sh = ledger.items.find((x) => x.id === who);
  return sh && sh.kind === 'stakeholder' && ['customer', 'own', 'vendor'].includes(sh.side) ? sh.side : 'unknown';
}

// 待ち日数。質問は聞いた日（無ければ作成日）から、課題は作成日から。まだ聞いていない質問は null
export function waitDays(it, ledger, today) {
  if (notAskedYet(it, ledger)) return null;
  const start = it.kind === 'question' && it.askedAt ? dayNumber(it.askedAt) : localDayNumber(it.createdAt);
  if (Number.isNaN(start)) return null;
  return Math.max(0, dayNumber(today) - start);
}
