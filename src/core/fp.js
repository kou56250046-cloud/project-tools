// ファンクションポイントの概算（NESMA 概算法）と、WBS の見積（BAC）との突き合わせ

import { settingOf } from './schema.js';
import { computeEvm } from './evm.js';

export const FP_TYPES = [
  { v: 'ILF', label: '内部論理ファイル（自システムのテーブル）', weight: 35 },
  { v: 'EIF', label: '外部インタフェースファイル（外部参照のテーブル）', weight: 15 },
  { v: 'EI', label: '外部入力（入力画面・受信連携・更新するバッチ）', weight: 4 },
  { v: 'EO', label: '外部出力（帳票・送信連携・参照だけのバッチ）', weight: 5 },
  { v: 'EQ', label: '外部照会（照会画面）', weight: 4 },
];
export const FP_GAP_ALERT = 0.3;

// 機能の種類を決める。数えないものは null と理由
export function fpTypeOf(it) {
  if (it.status === 'dropped') return { type: null, reason: '取り下げ' };
  if (it.kind === 'entity') return { type: it.fileType === 'external' ? 'EIF' : 'ILF' };
  if (it.kind === 'screen') return { type: { input: 'EI', report: 'EO', inquiry: 'EQ' }[it.screenType] || null, reason: '画面の区分が無い' };
  if (it.kind === 'interface') return { type: it.direction === 'in' ? 'EI' : it.direction === 'out' ? 'EO' : null, reason: '向きが無い' };
  if (it.kind === 'batch') {
    const ops = (it.crud || []).map((c) => c.ops || '').join('');
    if (!ops) return { type: null, reason: 'CRUD が無く、種類を決められない' };
    return { type: /[CUD]/.test(ops) ? 'EI' : 'EO' };
  }
  return null;
}

// 戻り値: { rows: [{ v, label, weight, items, count, fp }], total, uncounted: [{ item, reason }] }
export function countFp(ledger) {
  const rows = FP_TYPES.map((t) => ({ ...t, items: [], count: 0, fp: 0 }));
  const uncounted = [];
  for (const it of ledger.items) {
    const r = fpTypeOf(it);
    if (!r) continue;
    if (!r.type) { uncounted.push({ item: it, reason: r.reason }); continue; }
    rows.find((x) => x.v === r.type).items.push(it);
  }
  for (const r of rows) { r.count = r.items.length; r.fp = r.count * r.weight; }
  return { rows, total: rows.reduce((a, r) => a + r.fp, 0), uncounted };
}

// 見積の工数と BAC の比較。生産性が無ければ effort 以降は null
export function fpEstimate(ledger, today) {
  const fp = countFp(ledger);
  const productivity = settingOf(ledger, 'productivity');
  const bac = ledger.items.some((it) => it.kind === 'task') ? computeEvm(ledger, today).bac : 0;
  if (!productivity) return { ...fp, productivity: null, effort: null, bac, gap: null };
  const effort = Math.round(fp.total * productivity * 10) / 10;
  const gap = bac > 0 ? Math.round(((effort - bac) / bac) * 1000) / 1000 : null;
  return { ...fp, productivity, effort, bac, gap };
}
