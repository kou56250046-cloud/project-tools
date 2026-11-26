// 使い方の流れ図の進み具合。台帳から毎回求める（保存しない）。DOM に触れない。
// 戻り値: { status: { 段の id: 'done' | 'active' | 'todo' | 'loop' | 'optional' }, loopActive } / 台帳が無ければ null

import { FLOW_STEPS } from './guide-text.js';

// 直線の段と「済」の条件（状態は問わない。取り下げた項目も数える。手が付いたかを見るため）
const has = (ledger, kinds) => ledger.items.some((it) => kinds.includes(it.kind));
const onlyTemplate = (it) => !!(it.sources && it.sources.length && it.sources.every((s) => s && s.type === 'template'));
const LINEAR = [
  { id: 'setup', done: () => true },
  { id: 'initial', done: (l) => l.items.some((it) => it.kind !== 'memo' && !onlyTemplate(it)) },
  { id: 'baseline', done: (l) => (l.baselines || []).length > 0 },
  { id: 'plan', done: (l) => has(l, ['task']) },
  { id: 'design', done: (l) => has(l, ['entity', 'screen', 'interface', 'batch']) },
  { id: 'test', done: (l) => has(l, ['test']) },
];

export function stepStatus(ledger) {
  if (!ledger) return null;
  const status = {};
  for (const s of FLOW_STEPS) {
    if (s.loop) status[s.id] = 'loop';
    else if (s.optional) status[s.id] = 'optional';
  }
  for (const s of LINEAR) status[s.id] = s.done(ledger) ? 'done' : 'todo';
  let loopActive = false;
  const first = LINEAR.find((s) => status[s.id] === 'todo');
  if (first) {
    if (first.id === 'baseline') loopActive = true;
    else status[first.id] = 'active';
  }
  return { status, loopActive };
}
