// EVM（工数・人日）: BAC / PV / EV / AC / SPI / CPI / EAC と S カーブの点
// EV と AC の推移は、変更の記録（changelog の values）から日ごとの値を復元する

import { dayNumber, localDayNumber } from './schema.js';
import { elapsedRatio, dayToYmd } from './wbs.js';

export const EVM_ALERT = 0.9;

// 対象の作業: 末端・中止以外・見積と開始と終了がそろったもの
export function evmTargets(ledger) {
  const parents = new Set(ledger.items.filter((it) => it.kind === 'task' && it.parent).map((it) => it.parent));
  const leaves = ledger.items.filter((it) => it.kind === 'task' && !parents.has(it.id) && it.status !== 'cancelled' && !it.milestone);
  const ok = leaves.filter((t) => typeof t.estimate === 'number' && t.estimate > 0 && t.start && t.end);
  return { targets: ok, missing: leaves.length - ok.length };
}

// 作業ごとの値の時系列: id → [{ day, values }]（古い順）。起点の記録の日（S カーブを描き始める日）も返す
function timelines(ledger) {
  const map = new Map();
  let snapshotDay = null;
  for (const e of ledger.changelog || []) {
    const day = localDayNumber(e.at);
    if (e.source === 'snapshot') snapshotDay = snapshotDay === null ? day : Math.max(snapshotDay, day);
    for (const c of e.changes || []) {
      if (!c.values) continue;
      if (!map.has(c.id)) map.set(c.id, []);
      map.get(c.id).push({ day, values: c.values });
    }
  }
  return { map, snapshotDay };
}

// day の日の終わり時点の進捗と実績
function valueAt(task, tl, day) {
  const list = tl.get(task.id);
  if (!list) {
    // 記録が無い作業（記録の仕組みより前に作られた等）は、作成日以降は今の値とみなす
    return localDayNumber(task.createdAt) <= day ? { progress: task.progress || 0, actual: task.actual || 0 } : { progress: 0, actual: 0 };
  }
  let progress = 0;
  let actual = 0;
  for (const r of list) {
    if (r.day > day) break;
    if (r.values.progress !== undefined) progress = r.values.progress;
    if (r.values.actual !== undefined) actual = r.values.actual;
  }
  return { progress, actual };
}

const ratioOrNull = (a, b) => (b > 0 ? a / b : null);

// 戻り値: { bac, pv, ev, ac, spi, cpi, eac, missing, curve: [{ date, pv, ev, ac }], curveStart }
export function computeEvm(ledger, today) {
  const todayNum = dayNumber(today);
  const { targets, missing } = evmTargets(ledger);
  const bac = targets.reduce((a, t) => a + t.estimate, 0);
  const pvAt = (d) => targets.reduce((a, t) => a + t.estimate * elapsedRatio(t, d), 0);
  const pv = pvAt(todayNum);
  const ev = targets.reduce((a, t) => a + t.estimate * (t.progress || 0) / 100, 0);
  const ac = targets.reduce((a, t) => a + (t.actual || 0), 0);
  const spi = ratioOrNull(ev, pv);
  const cpi = ratioOrNull(ev, ac);
  const eac = cpi ? bac / cpi : null;

  const curve = [];
  const { map, snapshotDay } = timelines(ledger);
  if (targets.length) {
    const first = Math.min(...targets.map((t) => dayNumber(t.start)));
    const last = Math.max(...targets.map((t) => dayNumber(t.end)), todayNum);
    // 週の初め（月曜）に合わせる。1970-01-01 は木曜なので (d + 3) % 7 === 0 が月曜
    let d = first - ((first + 3) % 7 + 7) % 7;
    const days = [];
    for (; d <= last; d += 7) days.push(d);
    if (!days.includes(todayNum)) days.push(todayNum);
    days.sort((a, b) => a - b);
    for (const day of days) {
      const recorded = day <= todayNum && (snapshotDay === null || day >= snapshotDay);
      let evD = null;
      let acD = null;
      if (recorded) {
        evD = 0; acD = 0;
        for (const t of targets) {
          const v = valueAt(t, map, day);
          evD += t.estimate * v.progress / 100;
          acD += v.actual;
        }
      }
      curve.push({ date: dayToYmd(day), pv: round(pvAt(day)), ev: evD === null ? null : round(evD), ac: acD === null ? null : round(acD), today: day === todayNum });
    }
  }
  return {
    bac: round(bac), pv: round(pv), ev: round(ev), ac: round(ac),
    spi: spi === null ? null : round2(spi), cpi: cpi === null ? null : round2(cpi), eac: eac === null ? null : round(eac),
    missing, targets: targets.length, curve, curveStart: snapshotDay === null ? null : dayToYmd(snapshotDay),
  };
}

function round(x) { return Math.round(x * 10) / 10; }
function round2(x) { return Math.round(x * 100) / 100; }
