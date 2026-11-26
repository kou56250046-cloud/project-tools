// 健康診断。AIを使わない機械的な点検で、抜け漏れを重要度つきで返す。

import { refsOf, isOpen, kindLabel, refFieldLabel, linkIndex, checkIntegrity, dayNumber, localDayNumber, settingOf, afterBaselineIds, OWNER_FIELD, DUE_FIELD, fieldSpec, riskScore } from './schema.js';
import { nfrStatus } from './nfr.js';
import { computeEvm, EVM_ALERT } from './evm.js';
import { fpEstimate, FP_GAP_ALERT } from './fp.js';
import { traceRows } from './trace.js';
import { ballOf, waitDays } from './ball.js';
import { effectiveRaci } from './raci.js';
import { FLOWCHART } from './flow.js';

export const SEVERITY = [
  { v: 'high', label: '高' },
  { v: 'mid', label: '中' },
  { v: 'low', label: '低' },
];
const RANK = { high: 0, mid: 1, low: 2 };
export const STALE_GUESS_DAYS = 7;
// 出典なし・推測のままの点検をしない種別（PM が自分で起こすもの）
const SELF_MADE = new Set(['risk', 'kpi']);
export const RISK_HIGH = 15;

const fieldLabelOf = (kind, f) => { const sp = fieldSpec(kind, f); return sp ? sp.label : f; };

// 期限を点検する対象: 未完了・担当と期限を持つ種別・子を持つ作業（親）を除く・期限がある。
// 健康診断の「期限切れ」と、概要の期限の分布の両方がこれを使う（件数をそろえるため）
export function dueTargets(ledger) {
  const parents = new Set(ledger.items.filter((it) => it.kind === 'task' && it.parent).map((it) => it.parent));
  return ledger.items
    .filter((it) => isOpen(it) && OWNER_FIELD[it.kind] && DUE_FIELD[it.kind] && it[DUE_FIELD[it.kind]] && !(it.kind === 'task' && parents.has(it.id)))
    .map((it) => ({ item: it, due: it[DUE_FIELD[it.kind]] }));
}

// today: YYYY-MM-DD
export function runHealth(fullLedger, today) {
  const out = [];
  // 存在しない ID への参照はメモも含めて見る。それ以外の項目ごとの点検は、メモを除いた台帳で行う
  const ids = new Set(fullLedger.items.map((it) => it.id));
  const ledger = fullLedger.items.some((it) => it.kind === 'memo') ? { ...fullLedger, items: fullLedger.items.filter((it) => it.kind !== 'memo') } : fullLedger;
  const t = dayNumber(today);
  const push = (severity, code, item, message) => {
    const due = item && DUE_FIELD[item.kind] ? item[DUE_FIELD[item.kind]] || null : null;
    out.push({ severity, code, itemId: item ? item.id : null, due, message });
  };

  // 存在しない ID への参照（高）
  for (const it of fullLedger.items) {
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
    // 出典なし（中）。PM が自分で起こすリスク・KPI は対象外
    if (!SELF_MADE.has(it.kind) && (!it.sources || !it.sources.length)) push('mid', 'no-source', it, `${kindLabel(it.kind)}「${it.title}」に出典がありません`);
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
    if (it.kind !== 'question' && !SELF_MADE.has(it.kind) && it.confidence === 'guess' && it.updatedAt && t - localDayNumber(it.updatedAt) >= STALE_GUESS_DAYS) {
      push('low', 'stale-guess', it, `${kindLabel(it.kind)}「${it.title}」が推測のまま${t - localDayNumber(it.updatedAt)}日たっています`);
    }
  }

  // KPI（P7a）
  const links = linkIndex(ledger);
  const byIdK = new Map(ledger.items.map((it) => [it.id, it]));
  const linked = (id, pred) => [...(links.get(id) || [])].map((x) => byIdK.get(x)).filter((x) => x && pred(x));
  const liveKpi = (x) => x.kind === 'kpi' && x.status !== 'dropped';
  const goals = new Set((ledger.project.goals || []).map((g) => String(g).trim()));
  for (const k of ledger.items.filter((it) => it.kind === 'kpi' && it.status === 'active')) {
    if (!String(k.measure || '').trim() || !String(k.target || '').trim()) push('mid', 'kpi-no-measure', k, `KPI「${k.title}」に${!String(k.measure || '').trim() ? '測り方' : '目標値'}がありません`);
    if (!k.parent && !goals.has(String(k.goal || '').trim())) push('low', 'kpi-goal-unknown', k, `KPI「${k.title}」の対応するゴールが${k.goal ? `案件情報のゴールにありません（「${k.goal}」）` : '決まっていません'}`);
  }
  if (ledger.items.some(liveKpi)) {
    for (const r of ledger.items.filter((it) => it.kind === 'requirement' && it.status !== 'dropped')) {
      const reqs = linked(r.id, (x) => x.kind === 'request' && x.status !== 'rejected');
      if (!reqs.length) continue;   // 要望とつながっていない要件は別の点検の範囲
      const ok = linked(r.id, liveKpi).length || reqs.some((q) => linked(q.id, liveKpi).length);
      if (!ok) push('low', 'req-no-kpi', r, `要件「${r.title}」が、どの KPI にもつながっていません（要望を通しても）`);
    }
  }
  // リスク（P7a）: 点数が高いのに対策が無い
  for (const r of ledger.items.filter((it) => it.kind === 'risk' && isOpen(it))) {
    if (riskScore(r) >= RISK_HIGH && !String(r.response || '').trim()) push('mid', 'risk-high-no-response', r, `リスク「${r.title}」は点数 ${riskScore(r)}（見込み ${r.prob} × 影響 ${r.impact}）で、対策がありません`);
  }

  // 業務フロー（P7c）: 記法に誤りがある（誤りの行を外して描いているので、図が欠けている）
  for (const f of ledger.items.filter((it) => it.kind === 'bizflow')) {
    const errs = FLOWCHART.parse(String(f.notation || '')).errors;
    if (errs.length) push('mid', 'flow-error', f, `業務フロー「${f.title}」の記法に誤りが ${errs.length} 件あります（${errs[0].line} 行目: ${errs[0].message}${errs.length > 1 ? ' ほか' : ''}）。誤りの行は図に出ていません`);
  }

  // 体制・RACI（P7b）
  for (const p of ledger.items.filter((it) => it.kind === 'stakeholder' && it.status !== 'inactive' && it.reportsTo)) {
    const boss = byIdK.get(p.reportsTo);
    if (boss && boss.status === 'inactive') push('low', 'reports-to-inactive', p, `関係者「${p.title}」の上長「${boss.title}」が関与なしです`);
  }
  const hasChild = new Set(ledger.items.filter((it) => it.kind === 'task' && it.parent).map((it) => it.parent));
  const hasA = (it) => effectiveRaci(it).some((e) => e.role === 'A');
  for (const t of ledger.items.filter((it) => it.kind === 'task' && !it.parent && hasChild.has(it.id) && it.status !== 'done' && it.status !== 'cancelled')) {
    if (!hasA(t)) push('low', 'task-no-a', t, `工程「${t.title}」に A（承認者）がいません`);
  }
  for (const i of ledger.items.filter((it) => it.kind === 'issue' && isOpen(it) && it.severity === 'high')) {
    if (!hasA(i)) push('low', 'issue-no-a', i, `重要度が高の課題「${i.title}」に、決める人（A）がいません`);
  }
  for (const it of ledger.items.filter((x) => ['task', 'decision', 'issue'].includes(x.kind) && Array.isArray(x.raci))) {
    const a = it.raci.filter((e) => e && e.role === 'A').length;
    if (a >= 2) push('mid', 'multiple-a', it, `${kindLabel(it.kind)}「${it.title}」に A（承認者）が ${a} 人います（1 人にしてください）`);
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
  'req-no-kpi': 'KPI につながらない要件',
  'kpi-no-measure': '測り方か目標の無い KPI',
  'kpi-goal-unknown': 'ゴールの決まらない KPI',
  'risk-high-no-response': '対策の無い高いリスク',
  'multiple-a': 'A が 2 人以上',
  'task-no-a': '承認者のいない工程',
  'issue-no-a': '決める人のいない課題',
  'reports-to-inactive': '上長が関与なし',
};

