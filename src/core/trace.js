// トレーサビリティ: 要件ごとに、つながる要望・設計の項目・テストと判定を出す
// つながりは links（向きなし。linkIndex）で見る。設計の項目につながるテストも、その要件のテストとして数える

import { linkIndex } from './schema.js';

export const VERDICTS = [
  { v: 'none', label: 'テストなし' },
  { v: 'failed', label: '不合格あり' },
  { v: 'pending', label: '未実施あり' },
  { v: 'passed', label: 'すべて合格' },
];
const DESIGN = new Set(['screen', 'interface', 'batch', 'entity']);

// 戻り値: [{ req, requests, design, tests, counts: Record<status, n>, verdict }]
export function traceRows(ledger) {
  const idx = linkIndex(ledger);
  const byId = new Map(ledger.items.map((it) => [it.id, it]));
  const near = (id) => [...(idx.get(id) || [])].map((x) => byId.get(x)).filter(Boolean);
  return ledger.items
    .filter((it) => it.kind === 'requirement' && it.status !== 'dropped')
    .map((req) => {
      const linked = near(req.id);
      const requests = linked.filter((x) => x.kind === 'request');
      const design = linked.filter((x) => DESIGN.has(x.kind) && x.status !== 'dropped');
      const tests = new Map();
      for (const t of linked.filter((x) => x.kind === 'test')) tests.set(t.id, t);
      for (const d of design) for (const t of near(d.id)) if (t.kind === 'test') tests.set(t.id, t);
      const list = [...tests.values()];
      const counts = {};
      for (const t of list) counts[t.status] = (counts[t.status] || 0) + 1;
      let verdict = 'passed';
      if (!list.length) verdict = 'none';
      else if (counts.failed) verdict = 'failed';
      else if (list.some((t) => t.status !== 'passed')) verdict = 'pending';
      return { req, requests, design, tests: list, counts, verdict };
    });
}

// 工程ごとの合格率。戻り値: [{ level, total, passed, failed, rate }]
export function passRates(ledger, levels) {
  const tests = ledger.items.filter((it) => it.kind === 'test');
  return levels.map((lv) => {
    const t = tests.filter((x) => x.level === lv.v);
    const passed = t.filter((x) => x.status === 'passed').length;
    const failed = t.filter((x) => x.status === 'failed').length;
    return { level: lv.v, label: lv.label, total: t.length, passed, failed, rate: t.length ? Math.round((passed / t.length) * 1000) / 10 : null };
  });
}
