// 健康診断。AIを使わない機械的な点検で、抜け漏れを重要度つきで返す。

import { refsOf, isOpen, kindLabel, refFieldLabel, linkIndex, checkIntegrity, dayNumber, localDayNumber, settingOf, afterBaselineIds, OWNER_FIELD, DUE_FIELD, fieldSpec } from './schema.js';
import { nfrStatus } from './nfr.js';
import { computeEvm, EVM_ALERT } from './evm.js';
import { fpEstimate, FP_GAP_ALERT } from './fp.js';
import { traceRows } from './trace.js';
import { ballOf, waitDays } from './ball.js';

export const SEVERITY = [
  { v: 'high', label: '高' },
  { v: 'mid', label: '中' },
  { v: 'low', label: '低' },
];
const RANK = { high: 0, mid: 1, low: 2 };
export const STALE_GUESS_DAYS = 7;

const fieldLabelOf = (kind, f) => { const sp = fieldSpec(kind, f); return sp ? sp.label : f; };

// today: YYYY-MM-DD
export function runHealth(ledger, today) {
  const out = [];
  const ids = new Set(ledger.items.map((it) => it.id));
  const t = dayNumber(today);
  const push = (severity, code, item, message) => {
    const due = item && DUE_FIELD[item.kind] ? item[DUE_FIELD[item.kind]] || null : null;
    out.push({ severity, code, itemId: item ? item.id : null, due, message });
  };

  // 存在しない ID への参照（高）
  for (const it of ledger.items) {
    for (const r of refsOf(it)) {
      if (!ids.has(r.id)) push('high', 'dangling', it, `${it.id} の${refFieldLabel(r.field, it.kind)}が、台帳にない ${r.id} を指しています`);
    }
  }
  for (const rel of ledger.relations) {
    for (const end of ['from', 'to']) {
      if (!ids.has(rel[end])) {
        const other = ledger.items.find((it) => it.id === rel[end === 'from' ? 'to' : 'from']);
        push('high', 'dangling', other || null, `関係 ${rel.id}（${rel.label}）の${end === 'from' ? '始点' : '終点'}が、台帳にない ${rel[end]} を指しています`);
      }
    }
  }

  // 子を持つ作業（親）は担当・期限の点検の対象外（子で管理する）
  const parents = new Set(ledger.items.filter((it) => it.kind === 'task' && it.parent).map((it) => it.parent));
  for (const it of ledger.items) {
    const open = isOpen(it);
    const dueField = DUE_FIELD[it.kind];
    const ownerField = OWNER_FIELD[it.kind];
    const due = dueField ? it[dueField] : null;
    const tracked = !!ownerField && !(it.kind === 'task' && parents.has(it.id));
    // 期限切れ（高）
    if (open && tracked && due && dayNumber(due) < t) {
      push('high', 'overdue', it, `${kindLabel(it.kind)}「${it.title}」の${it.kind === 'task' ? '終了日' : '期限'}（${due}）を${t - dayNumber(due)}日過ぎています`);
    }
    // 担当・期限なし（中）
    if (open && tracked) {
      const missing = [];
      if (!it[ownerField]) missing.push(fieldLabelOf(it.kind, ownerField));
      if (!due) missing.push(fieldLabelOf(it.kind, dueField));
      if (missing.length) push('mid', 'no-owner', it, `${kindLabel(it.kind)}「${it.title}」に${missing.join('と')}がありません`);
    }
    // 出典なし（中）
    if (!it.sources || !it.sources.length) push('mid', 'no-source', it, `${kindLabel(it.kind)}「${it.title}」に出典がありません`);
    // Must で推測（中）
    if ((it.kind === 'request' || it.kind === 'requirement') && it.priority === 'Must' && it.confidence === 'guess') {
      push('mid', 'must-guess', it, `優先度 Must の${kindLabel(it.kind)}「${it.title}」が推測のままです`);
    }
    // 顧客待ちが設定日数以上（中）
    if (ballOf(it, ledger) === 'customer') {
      const w = waitDays(it, ledger, today);
      if (w !== null && w >= settingOf(ledger, 'ballWaitDays')) push('mid', 'ball-wait', it, `${kindLabel(it.kind)}「${it.title}」が顧客の返事を${w}日待っています`);
    }
    // 推測のまま7日以上（低）。質問は対象外
    if (it.kind !== 'question' && it.confidence === 'guess' && it.updatedAt && t - localDayNumber(it.updatedAt) >= STALE_GUESS_DAYS) {
      push('low', 'stale-guess', it, `${kindLabel(it.kind)}「${it.title}」が推測のまま${t - localDayNumber(it.updatedAt)}日たっています`);
    }
  }

  // 範囲（中）: 範囲外なのに理由が無い / ベースライン後に追加されて範囲が未判断
  const after = afterBaselineIds(ledger);
  for (const it of ledger.items) {
    if (it.kind !== 'request' && it.kind !== 'requirement') continue;
    if (it.scope === 'out' && !(it.scopeReason && it.scopeReason.trim())) push('mid', 'scope-no-reason', it, `${kindLabel(it.kind)}「${it.title}」は範囲外ですが、判断の理由がありません`);
    const closed = it.status === 'rejected' || it.status === 'dropped';
    if (after.has(it.id) && !closed && (!it.scope || it.scope === 'tbd')) push('mid', 'scope-undecided', it, `${kindLabel(it.kind)}「${it.title}」はベースラインの後に追加されましたが、範囲内か範囲外かが決まっていません`);
  }

  // 非機能の大項目で、要件も未回答の質問も無いもの（中）
  for (const c of nfrStatus(ledger)) {
    if (c.state === 'none') push('mid', 'nfr-missing', null, `非機能「${c.label}」について、要件も確認中の質問もありません`);
  }

  // EVM（高）: SPI か CPI が基準未満
  if (ledger.items.some((it) => it.kind === 'task')) {
    const e = computeEvm(ledger, today);
    if (e.pv > 0 && e.spi !== null && e.spi < EVM_ALERT) push('high', 'evm-low', null, `スケジュール効率 SPI が ${e.spi} です（${EVM_ALERT} 未満。予定より遅れています）`);
    if (e.cpi !== null && e.cpi < EVM_ALERT) push('high', 'evm-low', null, `コスト効率 CPI が ${e.cpi} です（${EVM_ALERT} 未満。見積より工数がかかっています）`);
  }

  const idx = linkIndex(ledger);

  // 設計（P4）: 要件とつながらない設計の項目（低）・作業の無い合意済みの要件（低）・作成されないテーブル（中）・見積の差（中）
  const DESIGN = ['entity', 'screen', 'interface', 'batch'];
  const kindOf = new Map(ledger.items.map((it) => [it.id, it.kind]));
  const linkedKind = (id, k) => [...(idx.get(id) || [])].some((x) => kindOf.get(x) === k);
  for (const it of ledger.items) {
    if (DESIGN.includes(it.kind) && it.status !== 'dropped' && !linkedKind(it.id, 'requirement')) {
      push('low', 'unlinked-design', it, `${kindLabel(it.kind)}「${it.title}」に対応する要件がありません`);
    }
  }
  if (ledger.items.some((it) => it.kind === 'task')) {
    for (const it of ledger.items) {
      if (it.kind === 'requirement' && it.status === 'agreed' && !linkedKind(it.id, 'task')) push('low', 'req-no-task', it, `合意済みの要件「${it.title}」を実現する作業がありません`);
    }
  }
  const funcs = ledger.items.filter((it) => ['screen', 'interface', 'batch'].includes(it.kind) && it.status !== 'dropped');
  if (funcs.length) {
    const created = new Set(funcs.flatMap((f) => (f.crud || []).filter((c) => c && /C/.test(c.ops || '')).map((c) => c.entity)));
    for (const it of ledger.items) {
      if (it.kind === 'entity' && it.status !== 'dropped' && it.fileType !== 'external' && !created.has(it.id)) push('mid', 'entity-no-create', it, `テーブル「${it.title}」を作成（C）する機能がありません`);
    }
  }
  const fe = fpEstimate(ledger, today);
  if (fe.gap !== null && Math.abs(fe.gap) > FP_GAP_ALERT) {
    push('mid', 'fp-gap', null, `FP からの見積 ${fe.effort} 人日と WBS の見積 ${fe.bac} 人日の差が ${Math.round(fe.gap * 100)}% あります（±${FP_GAP_ALERT * 100}% を超えています）`);
  }

  // テスト（P5）: 不合格のテスト（高）・テストの無い合意済みの要件（中。テストを書き始めてから点検する）
  for (const it of ledger.items) {
    if (it.kind === 'test' && it.status === 'failed') push('high', 'test-failed', it, `テスト「${it.title}」が不合格です`);
  }
  if (ledger.items.some((it) => it.kind === 'test')) {
    for (const r of traceRows(ledger)) {
      if (r.req.status === 'agreed' && r.verdict === 'none') push('mid', 'req-no-test', r.req, `合意済みの要件「${r.req.title}」を確かめるテストがありません`);
    }
  }

  // 項目をまたぐ誤り（高）。取込では止めるので、主に読み込んだ台帳で起こる
  for (const e of checkIntegrity(ledger).errors) {
    push('high', 'integrity', ledger.items.find((it) => it.id === e.itemId) || null, `${e.itemId}: ${e.message}`);
  }

  // どの要件ともつながっていない要望（低）。不採用の要望は除く。links は向きを持たない
  const kindById = new Map(ledger.items.map((it) => [it.id, it.kind]));
  const hasReq = (id) => [...(idx.get(id) || [])].some((x) => kindById.get(x) === 'requirement');
  for (const it of ledger.items) {
    if (it.kind === 'request' && it.status !== 'rejected' && !hasReq(it.id)) {
      push('low', 'unlinked-request', it, `要望「${it.title}」に対応する要件がありません`);
    }
  }

  out.sort((a, b) => RANK[a.severity] - RANK[b.severity]
    || (a.due ? 0 : 1) - (b.due ? 0 : 1)
    || (a.due && b.due ? a.due.localeCompare(b.due) : 0)
    || String(a.itemId).localeCompare(String(b.itemId)));
  return out;
}

export const HEALTH_CODES = {
  dangling: '存在しない ID への参照',
  integrity: '項目をまたぐ誤り',
  'ball-wait': '顧客待ちが長い',
  'scope-no-reason': '範囲外の理由なし',
  'scope-undecided': '範囲が未判断',
  'nfr-missing': '非機能の未着手',
  'evm-low': 'EVM の悪化',
  'unlinked-design': '要件のない設計',
  'req-no-task': '作業のない要件',
  'entity-no-create': '作成されないテーブル',
  'fp-gap': '見積の差',
  'test-failed': '不合格のテスト',
  'req-no-test': 'テストのない要件',
  overdue: '期限切れ',
  'no-owner': '担当・期限なし',
  'no-source': '出典なし',
  'must-guess': 'Must が推測のまま',
  'stale-guess': '推測のまま放置',
  'unlinked-request': '要件のない要望',
};

