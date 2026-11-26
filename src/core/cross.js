// 案件をまたいだ一覧（横断）: 自分の作業・自分が持つボール・顧客待ち・案件ごとの高の件数と SPI
// 新しい計算は持たず、既存の関数（ballOf / waitDays / runHealth / computeEvm）を案件ごとに呼んで集める

import { dayNumber, isOpen, settingOf } from './schema.js';
import { ballOf, waitDays } from './ball.js';
import { runHealth } from './health.js';
import { computeEvm } from './evm.js';

export const CROSS_DAYS = 14;

// 戻り値: [{ id, name, me, myTasks, myBalls, waiting, high, spi }]（me が未設定なら myTasks・myBalls は null）
export function crossSummary(workspace, today) {
  const t = dayNumber(today);
  return Object.entries(workspace.ledgers).map(([id, l]) => {
    const me = settingOf(l, 'me');
    const hasMe = !!(me && l.items.some((x) => x.id === me));
    const myTasks = hasMe
      ? l.items.filter((x) => x.kind === 'task' && x.assignee === me && isOpen(x) && x.end && dayNumber(x.end) <= t + CROSS_DAYS)
        .sort((a, b) => a.end.localeCompare(b.end))
        .map((x) => ({ item: x, overdue: dayNumber(x.end) < t }))
      : null;
    const myBalls = hasMe
      ? l.items.filter((x) => (x.kind === 'issue' && x.owner === me) || (x.kind === 'question' && x.askTo === me)).filter(isOpen)
        .map((x) => ({ item: x, wait: waitDays(x, l, today) }))
      : null;
    const limit = settingOf(l, 'ballWaitDays');
    const waiting = l.items.filter((x) => ballOf(x, l) === 'customer')
      .map((x) => ({ item: x, wait: waitDays(x, l, today) }))
      .filter((w) => w.wait !== null && w.wait >= limit)
      .sort((a, b) => b.wait - a.wait);
    const high = runHealth(l, today).filter((f) => f.severity === 'high').length;
    const spi = l.items.some((x) => x.kind === 'task') ? computeEvm(l, today).spi : null;
    return { id, name: l.project.name, me: hasMe ? me : null, myTasks, myBalls, waiting, high, spi };
  });
}
