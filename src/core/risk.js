// リスクのヒートマップと「課題へ移す」。DOM に触れない

import { isOpen, riskScore } from './schema.js';

// 点数の段（1〜4: 1、5〜9: 2、10〜14: 3、15〜25: 4）。ヒートマップの色に使う
export function heatLevel(score) {
  return score >= 15 ? 4 : score >= 10 ? 3 : score >= 5 ? 2 : 1;
}

// 戻り値 { cells: number[5][5]（[見込み-1][影響-1]。監視中・対策中だけを数える）, items: [{ risk, score }]（全状態。点数の高い順） }
export function riskMatrix(ledger) {
  const risks = ledger.items.filter((it) => it.kind === 'risk');
  const cells = Array.from({ length: 5 }, () => Array(5).fill(0));
  for (const r of risks) {
    if (!isOpen(r)) continue;
    const p = Number(r.prob), i = Number(r.impact);
    if (p >= 1 && p <= 5 && i >= 1 && i <= 5) cells[p - 1][i - 1]++;
  }
  const items = risks.map((risk) => ({ risk, score: riskScore(risk) })).sort((a, b) => b.score - a.score || a.risk.id.localeCompare(b.risk.id));
  return { cells, items };
}

// 課題へ移せるか（監視中・対策中だけ。発生・解消では出さない＝二重に課題ができないように）
export const canMoveToIssue = (r) => r && r.kind === 'risk' && isOpen(r);

// 1 回の操作で、リスクを指す課題を足し、リスクを「発生」にする
export function riskToIssueOps(r) {
  const s = riskScore(r);
  const body = [r.trigger ? `きっかけ: ${r.trigger}` : '', r.response ? `対策: ${r.response}` : '', r.body || ''].filter(Boolean).join('\n');
  const item = { kind: 'issue', title: `（発生）${r.title}`, severity: s >= 15 ? 'high' : s >= 8 ? 'mid' : 'low', links: [r.id], internal: !!r.internal, confidence: 'fact' };
  if (body) item.body = body;
  if (r.owner) item.owner = r.owner;
  return [{ op: 'add', tempId: 'new:1', item }, { op: 'update', id: r.id, set: { status: 'occurred' } }];
}
