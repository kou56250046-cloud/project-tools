// Gemini / NotebookLM に貼る指示文を作る。種別と値の説明は schema.js の表から生成する。

import { KINDS, LEDGER_KINDS, CONFIDENCE, SOURCE_TYPES, SCHEMA_VERSION, kindLabel, statusLabel, enumLabel, NFR_CATEGORIES, LOGICAL_TYPES, linkIndex } from './schema.js';
import { runHealth } from './health.js';
import { NFR, nfrStatus, NFR_STATES } from './nfr.js';
import { impactOf } from './impact.js';

export const MATERIAL_MARK = '--- ここから資料 ---';

export const PURPOSES = [
  { id: 'initial', group: '作る', label: '初期作成', desc: '提案依頼書・メモなどから、関係者・要望・制約などを洗い出す' },
  { id: 'minutes', group: '作る', label: '議事録の取込', desc: '議事録・文字起こしから、決定・課題・質問を足し、既存の質問の回答や課題の状態を更新する' },
  { id: 'memo', group: '作る', label: 'メモからの取込', desc: '選んだメモ（チャット・文字起こし）から、決定・課題・質問を足し、既存の質問の回答や課題の状態を更新する（メモを選ぶ）' },
  { id: 'material', group: '作る', label: '資料からの追加', desc: '資料や NotebookLM の要点整理から、台帳に無い項目を足す' },
  { id: 'hearing-questions', group: '要件定義', label: 'ヒヤリング質問の生成', desc: '未確定・空欄・矛盾から、次のヒヤリングで聞くべき質問を作らせる', kinds: ['stakeholder', 'request', 'constraint', 'requirement', 'decision', 'question', 'meeting'] },
  { id: 'nfr', group: '要件定義', label: '非機能の洗い出し', desc: 'IPA 非機能要求グレードの 6 大項目に沿って、非機能要件の案と確認すべき質問を作らせる', kinds: ['requirement', 'question', 'constraint', 'system'] },
  { id: 'wbs', group: '計画・進捗', label: 'WBS の作成', desc: '要件・決定・制約から作業を洗い出し、要件とつないだ WBS を作らせる', kinds: ['requirement', 'decision', 'constraint', 'task', 'stakeholder'] },
  { id: 'progress', group: '計画・進捗', label: '進捗の更新', desc: '週次の報告文やメモから、作業の進捗・実績・状態の更新を作らせる', kinds: ['task', 'stakeholder'] },
  { id: 'change-review', group: '計画・進捗', label: '変更の影響レビュー', desc: '変更要求と影響範囲から、見落としと追加工数の見立てを返させる（変更要求を選ぶ）', kinds: [] },
  { id: 'report-polish', group: '計画・進捗', label: '週報の清書', desc: '定例会資料から作った週報の文面を、Gemini に読みやすく整えさせる（差分は返させない）', plain: true },
  { id: 'data-design', group: '設計', label: 'データ設計', desc: '要件・決定からテーブルと列（主キー・外部キー・型・桁）を作らせる', kinds: ['requirement', 'decision', 'constraint', 'entity', 'system'] },
  { id: 'functions', group: '設計', label: '画面・連携の洗い出し', desc: '要件から画面・連携・バッチと、それぞれがどのテーブルを作成・参照・更新・削除するか（CRUD）を作らせる', kinds: ['requirement', 'entity', 'system', 'screen', 'interface', 'batch'] },
  { id: 'test-viewpoints', group: 'テスト', label: 'テスト観点の生成', desc: '選んだ要件・画面の詳細から、正常・境界値・異常系・権限などの観点でテストを作らせる（対象を選ぶ）', kinds: [] },
  { id: 'review-eng', group: 'レビュー（作る側）', label: 'レビュー: エンジニア', desc: '技術的に実現できるか、非機能・連携・移行・テストの前提に抜けがないかを指摘させる' },
  { id: 'review-pl', group: 'レビュー（作る側）', label: 'レビュー: PL', desc: '設計や作業指示に落とせるだけ要件が細かいか、矛盾や抜け、作業の分け方を指摘させる' },
  { id: 'review-pm', group: 'レビュー（作る側）', label: 'レビュー: PM', desc: '予算・期間・範囲、顧客との合意、意思決定の遅れ、体制の危うさを指摘させる' },
  { id: 'review-user', group: 'レビュー（使う側）', label: 'レビュー: 利用者', desc: '毎日画面を使う業務担当の立場で、入力の手間・例外業務・繁忙期の抜けを指摘させる' },
  { id: 'review-ops', group: 'レビュー（使う側）', label: 'レビュー: 運用者', desc: '稼働後にシステムを運用・保守する立場で、障害対応・保守作業・問い合わせの抜けを指摘させる' },
  { id: 'free', group: 'その他', label: '自由指示', desc: '自分で書いた指示に、台帳の状態と差分の形式を添える' },
  { id: 'notebooklm', group: 'その他', label: 'NotebookLM 用の要点整理', desc: 'NotebookLM に資料を読ませて要点を箇条書きにさせる。出力は「資料からの追加」の資料欄に貼る' },
];

// 立場別レビュー。作る側（エンジニア・PL・PM）と使う側（利用者・運用者）
const REVIEWERS = {
  'review-eng': {
    role: 'この案件を設計・開発するベテランのエンジニア',
    points: ['技術的に実現できるか、実現に未確定の前提が残っていないか', '非機能要件（性能・可用性・セキュリティ・社内規程）の抜けと、数値の無い要件', '既存システムとの連携の方式・頻度・データの持ち主・相手側の改修', 'データ移行の範囲・件数・品質', 'テストに必要な情報（データ量・環境・権限）の不足'],
  },
  'review-pl': {
    role: '開発チームを率いるプロジェクトリーダー（PL）',
    points: ['設計書や作業指示に落とせるだけ、要件が具体的か（画面・帳票・連携・権限）', '要件どうし・要件と制約・決定との矛盾', '要望に対応する要件の抜け、要件に対応する根拠（出典）の抜け', '担当や期限が決まっていない課題・質問', '作業の分け方と、手戻りになりそうな未確定事項'],
  },
  'review-pm': {
    role: '予算と納期に責任を持つプロジェクトマネージャー（PM）',
    points: ['予算・期間に対して範囲が広すぎないか', '顧客と合意できていない事項と、範囲外の線引き', '決まっていない重要事項と、その決定期限・決定者', '前提が崩れたときの影響（決定の置き換えなど）', '体制の穴と、自社・顧客・委託先の役割分担のあいまいさ'],
  },
  'review-user': {
    role: '新しいシステムの画面を毎日使う顧客の業務担当者',
    points: ['毎日の入力の手間（二重入力・手作業の残り・入力項目の多さ）', '例外的な業務（取消・訂正・差し戻し・代理入力・締め後の修正）', '繁忙期や締め日の処理量と待ち時間', '画面・帳票・出力が実際の業務でどう使われるか', '操作を覚えるための教育・マニュアル'],
  },
  'review-ops': {
    role: '稼働後にシステムを運用・保守する担当者（顧客の情報システム部門や運用チーム）',
    points: ['監視と障害時の対応手順、業務を止めずに続ける方法', 'バックアップと復旧（どこまで戻せるか、どれだけで戻せるか）', 'マスタ・権限・利用者の追加や変更を、誰がどう行うか', '夜間処理や他システムとの連携が失敗したときの扱い', '問い合わせ窓口と、保守契約・ライセンスの範囲'],
  },
};

function enumText(values) {
  return values.map((e) => `${e.v}=${e.label}`).join(', ');
}

// 種別と値の一覧
export function schemaText() {
  const lines = [];
  lines.push('### 共通の項目（全種別）');
  lines.push('- title*: 題名（1行。体言止めで短く）');
  lines.push('- body: 内容（詳細。複数行可）');
  lines.push('- status: 状態（種別ごとに下記。省略すると最初の値）');
  lines.push(`- confidence: 確度（${enumText(CONFIDENCE)}）。省略すると guess`);
  lines.push(`- sources: 出典の配列。各要素は { "type": 種類, "ref": 会議名や資料名, "date": "YYYY-MM-DD", "speaker": 発言した関係者のID, "note": 補足 }。type は ${enumText(SOURCE_TYPES)}`);
  lines.push('- links: 関係する項目の ID の配列（例: 要件 → もとになった要望、課題 → 関係する要件）');
  lines.push('- tags: 文字列の配列（任意）');
  lines.push('- internal: true にすると社内のみの項目になり、顧客に見せる表示で隠れる（任意。社内向けのメモやリスクに使う）');
  lines.push('');
  lines.push('### 種別（kind）ごとの項目。* は必須');
  for (const k of LEDGER_KINDS) {
    const d = KINDS[k];
    const fields = Object.entries(d.fields).map(([name, f]) => {
      let t = `${name}${f.required ? '*' : ''}（${f.label}`;
      if (f.type === 'enum') t += `: ${enumText(f.values)}`;
      if (f.type === 'date') t += ': YYYY-MM-DD';
      if (f.type === 'ref') t += `: ${f.kinds.map(kindLabel).join('・')}の ID`;
      if (f.type === 'refs') t += `: ${f.kinds.map(kindLabel).join('・')}の ID の配列`;
      if (f.type === 'strings') t += ': 文字列の配列';
      if (f.type === 'number') t += `: 数値 ${f.min}〜${f.max}${f.integer ? 'の整数' : ''}`;
      if (f.type === 'boolean') t += ': true / false';
      return t + '）';
    });
    lines.push(`- ${k}（${d.label}。ID は ${d.prefix}-001 の形）状態: ${enumText(d.statuses)}` + (fields.length ? `。項目: ${fields.join(', ')}` : ''));
  }
  lines.push('');
  lines.push('### 配列の項目の書き方（テーブル・画面・連携・バッチ）');
  lines.push(`- columns（列）: [{ "name": 物理名, "logical": 論理名, "type": ${LOGICAL_TYPES.map((t) => t.v).join(' / ')}, "length": 桁数, "scale": 小数の桁数, "pk": true, "required": true, "fk": { "entity": テーブルの ID か tempId, "column": 参照先の列名 }, "pattern": コードの形の正規表現, "note": 補足 }]`);
  lines.push('- fields（画面・連携の項目）: [{ "name": 項目名, "type": 論理型, "required": true, "source": { "entity": テーブルの ID, "column": 列名 } }]');
  lines.push('- crud: [{ "entity": テーブルの ID か tempId, "ops": "C" "R" "U" "D" の組み合わせ（例 "CRU"） }]');
  lines.push('- 配列は update で丸ごと置き換わる。テーブルを更新するときは、変えない列も含めて columns を全部返す（fields・crud も同じ）');
  return lines.join('\n');
}

function exampleJson(revision) {
  return [
    '```json',
    '{',
    '  "type": "ledger-patch",',
    `  "schemaVersion": ${SCHEMA_VERSION},`,
    `  "basedOnRevision": ${revision},`,
    '  "ops": [',
    '    { "op": "add", "tempId": "new:1", "item": { "kind": "stakeholder", "title": "田中 課長", "side": "customer", "org": "購買部", "confidence": "fact", "sources": [{ "type": "meeting", "ref": "第2回定例", "date": "2026-12-01" }] } },',
    '    { "op": "add", "tempId": "new:2", "item": { "kind": "question", "title": "承認は何段階か", "askTo": "new:1", "due": "2026-12-08", "confidence": "fact", "sources": [{ "type": "meeting", "ref": "第2回定例", "date": "2026-12-01", "speaker": "new:1" }] } },',
    '    { "op": "update", "id": "IS-003", "set": { "status": "closed" }, "reason": "第2回定例で解決を確認" },',
    '    { "op": "relate", "from": "new:1", "to": "SY-001", "label": "利用" }',
    '  ]',
    '}',
    '```',
  ].join('\n');
}

function rulesText(ledger, today) {
  return [
    '## 出力の規則（必ず守る）',
    '1. 出力は ```json で囲んだ JSON を1つだけ。前後に説明を書かない',
    `2. 形は { "type": "ledger-patch", "schemaVersion": ${SCHEMA_VERSION}, "basedOnRevision": ${ledger.revision}, "ops": [ ... ] }`,
    '3. 操作（op）は4種類だけ:',
    '   - add: 項目を足す。{ "op": "add", "tempId": "new:1", "item": { "kind": …, "title": …, … } }。id は書かない（取り込み時に振られる）',
    '   - update: 既存の項目を変える。{ "op": "update", "id": "既存のID", "set": { 変える項目だけ }, "reason": "理由" }。links に追記するときは "addLinks": ["ID"] を使う。値を消すときは null',
    '   - relate: 関係者・システムどうしの関係を足す。{ "op": "relate", "from": ID, "to": ID, "label": "発注・利用・連携などの短い語" }',
    '   - project: 案件情報を変える。{ "op": "project", "set": { "name", "customer", "purpose", "periodStart", "periodEnd", "goals", "summary" のうち変えるもの } }',
    '4. 新しく足す項目どうしで参照するときは tempId（new:1, new:2 …）を使う。既存の項目は下の一覧の ID で参照する',
    '5. 一覧にすでにある内容は足さない。内容が変わったら update にする',
    '6. 削除はできない。誤りや不要になった項目は status を変える（例: 要望は rejected、要件は dropped）',
    '7. 資料に書かれていることは confidence "fact"、資料から推し量ったことは "guess"。"confirmed" は使わない（人が確認したときに付ける）',
    '8. 出典（sources）には会議名・資料名、日付、発言者（関係者の ID か tempId）を、分かる範囲で必ず入れる',
    `9. 日付は YYYY-MM-DD。今日は ${today}`,
    '10. 操作は1回の出力で40件まで。多いときは重要なものを先に出す',
  ].join('\n');
}

function projectText(ledger) {
  const p = ledger.project;
  const lines = [`- 案件名: ${p.name}`];
  if (p.customer) lines.push(`- 顧客: ${p.customer}`);
  if (p.purpose) lines.push(`- 目的: ${p.purpose}`);
  if (p.periodStart || p.periodEnd) lines.push(`- 期間: ${p.periodStart || '?'} 〜 ${p.periodEnd || '?'}`);
  if (p.goals && p.goals.length) lines.push(`- ゴール: ${p.goals.join(' / ')}`);
  if (p.summary) lines.push(`- 概要: ${p.summary}`);
  lines.push(`- 台帳の revision: ${ledger.revision}`);
  return lines.join('\n');
}

const oneLine = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

// 今の項目一覧。detailed なら本文や主要な項目も含める（レビュー用）。kinds を渡すとその種別だけ載せる
export function itemsText(ledger, detailed, kinds, ids) {
  const base = ledger.items.filter((it) => it.kind !== 'memo');   // メモは指示文の台帳の一覧に出さない
  const items = ids ? base.filter((it) => ids.has(it.id)) : kinds ? base.filter((it) => kinds.includes(it.kind)) : base;
  if (!items.length) return '（まだ項目はありません）';
  const shown = new Set(items.map((it) => it.id));
  const lines = ['ID | 種別 | 状態 | 題名' + (detailed ? ' | 詳細' : '')];
  for (const it of items) {
    let line = `${it.id} | ${kindLabel(it.kind)} | ${statusLabel(it.kind, it.status)} | ${oneLine(it.title)}`;
    if (detailed) {
      const extra = [];
      for (const name of Object.keys(KINDS[it.kind].fields)) {
        const v = it[name];
        if (v === undefined || v === null || (Array.isArray(v) && !v.length)) continue;
        extra.push(`${KINDS[it.kind].fields[name].label}: ${Array.isArray(v) ? v.join(',') : oneLine(v)}`);
      }
      extra.push(`確度: ${it.confidence}`);
      if (it.links && it.links.length) extra.push(`関連: ${it.links.join(',')}`);
      if (it.body) extra.push(`内容: ${oneLine(it.body)}`);
      line += ' | ' + extra.join(' / ');
    }
    lines.push(line);
  }
  const rels = ledger.relations.filter((r) => shown.has(r.from) && shown.has(r.to));
  if (rels.length) {
    lines.push('', '関係（from → to: label）');
    for (const r of rels) lines.push(`${r.from} → ${r.to}: ${oneLine(r.label)}`);
  }
  return lines.join('\n');
}

// 会議を指定した議事録の取込に入れる、会議の情報とヒヤリングシート
function meetingText(ledger, meetingId) {
  const m = ledger.items.find((it) => it.id === meetingId && it.kind === 'meeting');
  if (!m) return '';
  const name = (id) => { const s = ledger.items.find((it) => it.id === id); return s ? `${s.title}（${id}）` : id; };
  const sheet = ledger.items.filter((it) => it.kind === 'question' && it.meeting === m.id);
  return [
    '',
    `## この議事録の会議: ${m.id} ${m.title}（${m.date}）`,
    `- 出席者: ${(m.attendees || []).map(name).join('、') || '（未登録）'}`,
    `- 議題: ${(m.agenda || []).join(' / ') || '（未登録）'}`,
    '- この会議で聞いた質問（回答が出たものは、この ID への update で status を answered、answer に回答、askedAt に会議の日付を入れる）:',
    ...(sheet.length ? sheet.map((q) => `  - ${q.id} ${oneLine(q.title)}`) : ['  - （なし）']),
    `- 会議が開催されたので、${m.id} を update で status: "held" にする`,
    '- 出典の ref には会議名、date には会議の日付を入れる',
  ].join('\n');
}

// ヒヤリング質問の生成に入れる、未確定・空欄の一覧
function gapsText(ledger, today) {
  const open = ledger.items.filter((it) => it.kind === 'question' && it.status === 'open');
  const gaps = runHealth(ledger, today).filter((f) => ['no-owner', 'no-source', 'must-guess', 'stale-guess', 'nfr-missing', 'scope-undecided'].includes(f.code));
  return [
    '## 未回答の質問（重複して作らない）',
    ...(open.length ? open.map((q) => `- ${q.id} ${oneLine(q.title)}`) : ['- （なし）']),
    '',
    '## 台帳の空欄・未確定（機械的な点検の結果）',
    ...(gaps.length ? gaps.map((f) => `- ${f.message}`) : ['- （なし）']),
  ].join('\n');
}

function nfrText(ledger) {
  const st = nfrStatus(ledger);
  return NFR.map((c) => {
    const s = st.find((x) => x.id === c.id);
    return `- ${c.id}（${c.label}）今の状態: ${enumLabel(NFR_STATES, s.state)}
  確認点: ${c.points.join(' / ')}`;
  }).join('\n');
}

function taskText(purpose, opts) {
  switch (purpose) {
    case 'test-viewpoints':
      return 'あなたはテスト設計に詳しい品質保証の担当者です。下の「テストの対象」の詳細を読み、テストを test の add で返してください。観点（viewpoint）は 正常 normal・境界値 boundary・異常系 error・権限 authority・性能 performance を、対象の内容に合わせて選び、境界値は入力項目の必須・型・桁から具体的な値で作ってください。level は対象に合わせて結合 integration か総合 system にしてください。title は「何を確かめるか」を一文で、steps に手順、expected に期待結果を書きます。対象の ID を links に入れてください。「既にあるテスト」と同じものは作らないでください。status は "draft"、confidence は "guess" にしてください。\n\n' + (opts.targets || '');
    case 'data-design':
      return 'あなたは業務システムのデータ設計に詳しい SE です。下の台帳の要件・決定・制約から、必要なテーブルを entity の add で返してください。physicalName は英小文字と下線（例: order_line）、title は日本語の論理名、fileType は自システムのテーブルなら "internal"、他のシステムが持つデータを参照するだけなら "external" にします。columns には主キー（pk）・必須（required）・型・桁・外部キー（fk）を入れ、コード値の列には pattern（正規表現）を入れてください。マスタのテーブルは master: true にします。テーブルを実現する要件の ID を links に入れてください。既にあるテーブルを直すときは update にし、変えない列も含めて columns を全部返してください。confidence は "guess" にしてください。';
    case 'functions':
      return 'あなたは業務システムの基本設計に詳しい SE です。下の台帳の要件とテーブルから、必要な画面（screen。screenType は入力 input・照会 inquiry・帳票 report）、他システムとの連携（interface。system に相手のシステムの ID、direction は受信 in・送信 out）、バッチ（batch）を add で返してください。それぞれ crud に、どのテーブルを作成（C）・参照（R）・更新（U）・削除（D）するかを入れ、画面と連携には fields（項目）も入れてください。実現する要件の ID を links に入れてください。confidence は "guess" にしてください。';
    case 'wbs':
      return 'あなたは SIer のベテラン PM です。下の台帳の要件・決定・制約から、この案件の WBS（作業の分解）を作ってください。作業は task の add で返し、工程の親の作業（例: 要件定義・基本設計・開発・テスト・移行）の下に、1 件 1〜10 人日程度の末端の作業を置いてください。親子は parent に親の tempId を入れます。末端の作業には estimate（人日）・start / end（YYYY-MM-DD）・assignee（分かれば関係者の ID）・dependsOn（前の作業）を入れ、実現する要件の ID を links に入れてください。進捗 progress と実績 actual は 0 にしてください。工程の区切りにはマイルストーン（milestone: true、開始と終了は同じ日）を置いてください。既にある作業と同じものは作らないでください。出典は { "type": "doc", "ref": "WBS 案（Gemini）" } とし、confidence は "guess" にしてください。';
    case 'progress':
      return 'あなたは PM の補佐役です。下の資料（週次の報告文・メモ）を読み、作業の進捗を台帳に反映する差分を作ってください。一覧にある作業の update だけを返し、progress（0〜100 の整数）・actual（実績の人日の累計）・status（todo / doing / done）を、資料に書かれている範囲で変えてください。完了した作業は progress 100・status done にしてください。資料に無い作業は変えないでください。新しい作業が必要なら task の add で返してかまいません。';
    case 'change-review':
      return 'あなたは SIer のベテラン PM です。下の変更要求と、台帳から機械的に求めた影響範囲を読み、(1) 影響範囲の見落とし（影響を受けるのに一覧に無い作業・設計・関係者）を課題（issue）か質問（question）の add で、(2) 追加工数の見立てを変更要求の update（extraEstimate に人日、body に根拠）で返してください。指摘の対象の ID は links に入れてください。confidence は "guess" にしてください。\n\n' + (opts.change || '');
    case 'hearing-questions':
      return 'あなたは SIer のベテラン PM です。下の台帳と「空欄・未確定」の一覧を読み、次のヒヤリングで聞くべき質問を作ってください。質問は question の add で返し、askTo に聞く相手の関係者、links に質問の元になった項目の ID を入れてください。1問は1つのことだけを聞く形にし、Yes/No で終わらない聞き方にしてください。未回答の質問と同じことは作らないでください。重要なものから最大 15 問にしてください。\n\n' + (opts.gaps || '');
    case 'nfr':
      return 'あなたは非機能要件に詳しい SIer のアーキテクトです。IPA 非機能要求グレードの 6 大項目ごとに、下の確認点を参考に、この案件で決めるべき非機能要件の案（requirement。category は "nonfunctional"、nfrCategory に大項目の ID、confidence は "guess"）と、顧客に確認すべき質問（question。nfrCategory に大項目の ID）を返してください。すでに定義のある大項目は、抜けている確認点だけを足してください。数値で決める要件（応答時間・停止許容時間など）は、数値の案を書き、確認する質問も添えてください。\n\n## 6 大項目と確認点\n' + (opts.nfr || '');
    case 'initial':
      return 'あなたは SIer のベテラン PM です。下の資料（提案依頼書・メモなど）を読み、案件台帳の最初の項目を洗い出してください。関係者（顧客・自社・協力会社）、システム、要望、制約、決まっていること（決定）、課題、確認すべきこと（質問）を、資料に根拠があるものから足してください。関係者とシステムの関係（relate）も足してください。案件名・目的・期間が分かれば project で設定してください。';
    case 'minutes':
      return 'あなたは SIer の PM の補佐役です。下の議事録・文字起こしを読み、次を差分にしてください: (1) 新たに決まったこと（decision。理由・検討した他の案・決めた人を入れる。以前の決定を覆したときは supersedes に古い決定の ID） (2) 新たな課題（issue。担当と期限が分かれば入れる） (3) 新たな確認事項（question） (4) 新たな要望・制約 (5) 一覧にある質問に回答が出たら update で status を answered にし answer に回答を書く (6) 一覧にある課題が片付いたら update で status を closed にする。発言者は出典の speaker に入れてください。';
    case 'memo':
      return 'あなたは SIer の PM の補佐役です。下の「メモ」（チャットのやりとりや会議の文字起こし。1 行が「日時 発言者｜本文」）を読み、次を差分にしてください: (1) 新たに決まったこと（decision。理由・決めた人を入れる。以前の決定を覆したときは supersedes に古い決定の ID） (2) 新たな課題（issue。担当と期限が分かれば入れる） (3) 新たな確認事項（question） (4) 新たな要望・制約 (5) 一覧にある質問に回答が出たら update で status を answered にし answer に回答を書く (6) 一覧にある課題が片付いたら update で status を closed にする。出典（sources）は type を "chat"、ref をメモの題名、date を発言の日にし、発言者は speaker に入れてください。メモの ID（MM-）は links に入れないでください。';
    case 'material':
      return 'あなたは SIer の SE です。下の資料を読み、台帳の一覧に無い項目（関係者・システム・要望・制約・要件・決定・課題・質問）を足してください。一覧の項目と内容が食い違うところは、update で直すか、食い違いを課題（issue）として足してください。';
    case 'free':
      return 'あなたは SIer の PM の補佐役です。次の指示に従い、結果を差分で返してください。\n\n【指示】\n' + (opts.freeText && opts.freeText.trim() ? opts.freeText.trim() : '（ここに指示を書いてください）');
    default: {
      const r = REVIEWERS[purpose];
      return `あなたは「${r.role}」です。その立場で、下の案件台帳を厳しくレビューしてください。特に次の観点で、抜け・あいまいさ・危うさを探してください:\n${r.points.map((x) => '- ' + x).join('\n')}\n\n指摘は課題（issue。severity を付ける）か質問（question。askTo に聞くべき関係者）として add で返してください。title は指摘の要点、body に理由と、どうすればよいかを書いてください。指摘の対象になった項目の ID を links に入れてください。出典は { "type": "other", "ref": "レビュー（${r.role}）" } としてください。confidence は "guess" にしてください。台帳の項目そのものは変えないでください（update しない）。`;
    }
  }
}

function notebookPrompt(ledger) {
  const items = ledger.items.filter((it) => it.kind !== 'memo');
  const known = items.length
    ? items.map((it) => `- ${kindLabel(it.kind)}: ${oneLine(it.title)}`).join('\n')
    : '（まだありません）';
  return [
    `案件「${ledger.project.name}」について、アップロードした資料から要点を整理してください。`,
    '',
    '## 出力の形',
    '次の見出しの下に、1行に1件ずつ箇条書きで書いてください。',
    '',
    '## 関係者',
    '## 要望',
    '## 制約',
    '## 決定',
    '## 課題',
    '## 未確定の点',
    '',
    '各行の形: `- 内容 ／ 発言者: 名前（所属） ／ 日付: YYYY-MM-DD ／ 出典: 資料名`',
    '',
    '## 守ること',
    '- 資料に書かれていないことは書かない。推測で補わない',
    '- 発言者・日付・出典が分からないときは「不明」と書く',
    '- 決定には、理由と、検討された他の案があれば併せて書く',
    '- 下の「把握済みの事項」と同じものは書かなくてよい。内容が変わっていたら書く',
    '',
    '## 把握済みの事項',
    known,
  ].join('\n');
}

// 変更の影響レビューに入れる、変更要求と影響範囲
function changeText(cr, imp) {
  const lines = [
    `## 変更要求: ${cr.id} ${cr.title}`,
    cr.body ? `- 内容: ${oneLine(cr.body)}` : null,
    `- 対象: ${(cr.links || []).join(', ') || '（未指定）'}`,
    `- 追加工数の見込み（今の値）: ${cr.extraEstimate ?? '未入力'} 人日`,
    '',
    '## 機械的に求めた影響範囲（2 段まで。関係者とシステムから先はたどっていない）',
  ];
  const byKind = Object.entries(imp.byKind).filter(([, v]) => v.length);
  if (!byKind.length) lines.push('- （つながる項目はありません）');
  for (const [k, list] of byKind) lines.push(`- ${kindLabel(k)}: ${list.map((it) => `${it.id} ${oneLine(it.title)}`).join(' / ')}`);
  lines.push(`- 影響する作業の見積の合計: ${imp.taskEstimate} 人日`);
  return lines.filter((x) => x !== null).join('\n');
}

// テスト観点の生成に入れる、対象の詳細・関係する制約と非機能要件・既にあるテスト
function targetsText(ledger, ids) {
  const byId = new Map(ledger.items.map((it) => [it.id, it]));
  const idx = linkIndex(ledger);
  const targets = ids.map((id) => byId.get(id)).filter(Boolean);
  if (!targets.length) return '（テストの対象が選ばれていません。指示文の画面で要件か画面を選んでください）';
  const L = ['## テストの対象'];
  const related = new Set();
  const tests = new Set();
  for (const t of targets) {
    L.push(`### ${t.id} ${kindLabel(t.kind)}「${oneLine(t.title)}」`);
    if (t.body) L.push(`- 内容: ${oneLine(t.body)}`);
    for (const [name, spec] of Object.entries(KINDS[t.kind].fields)) {
      const v = t[name];
      if (v === undefined || v === null || (Array.isArray(v) && !v.length)) continue;
      if (spec.type === 'fields') {
        L.push('- 項目:');
        for (const f of v) L.push(`  - ${f.name}（型 ${f.type || '不明'}${f.required ? '・必須' : ''}${f.source ? `・元 ${f.source.entity}.${f.source.column || ''}` : ''}）`);
      } else if (spec.type === 'crud') {
        L.push(`- CRUD: ${v.map((c) => `${c.entity} ${c.ops}`).join(' / ')}`);
      } else if (spec.type === 'columns') {
        L.push(`- 列: ${v.map((c) => `${c.name}(${c.type}${c.length ? ' ' + c.length : ''}${c.required || c.pk ? ' 必須' : ''})`).join(' / ')}`);
      } else {
        L.push(`- ${spec.label}: ${Array.isArray(v) ? v.join(', ') : oneLine(v)}`);
      }
    }
    for (const x of idx.get(t.id) || []) {
      const it = byId.get(x);
      if (!it) continue;
      if (it.kind === 'constraint' || (it.kind === 'requirement' && it.category === 'nonfunctional')) related.add(it);
      if (it.kind === 'test') tests.add(it);
    }
  }
  L.push('', '## 関係する制約・非機能要件');
  L.push(...(related.size ? [...related].map((it) => `- ${it.id} ${oneLine(it.title)}`) : ['- （なし）']));
  L.push('', '## 既にあるテスト（同じものは作らない）');
  L.push(...(tests.size ? [...tests].map((it) => `- ${it.id} ${oneLine(it.title)}`) : ['- （なし）']));
  return L.join('\n');
}

// 週報の清書（差分を返させない）
function reportPolishPrompt(ledger, text) {
  return [
    `案件「${ledger.project.name}」の週次報告の下書きです。顧客と社内の関係者に送る文面として、読みやすく整えてください。`,
    '',
    '## 守ること',
    '- 書かれている事実・数値・日付・件名を変えない。足さない',
    '- 見出し（■）の構成は残す。箇条書きは 1 行 1 件',
    '- 敬体（です・ます）で、1 文を短く',
    '- 「お願い」の項目は、相手が何をすればよいかが分かる書き方にする',
    '- 出力は整えた文面だけ。前置きや説明は書かない',
    '',
    '## 下書き',
    text || '（定例会資料の画面で「週報を清書する指示文」を押すと、ここに下書きが入ります）',
  ].join('\n');
}

// 指示文を作る。opts: { today: 'YYYY-MM-DD', freeText?: string }
export const MEMO_PROMPT_MAX = 60000;

// 選んだメモを資料にする。戻り値 { text, total, over, count }（total は本文の字数の合計）
export function memoMaterial(ledger, memoIds) {
  const memos = (memoIds || []).map((id) => ledger.items.find((it) => it.id === id && it.kind === 'memo')).filter(Boolean);
  const total = memos.reduce((a, m) => a + String(m.body || '').length, 0);
  const text = memos.map((m) => [`### メモ「${m.title}」${m.channel ? `（${m.channel}）` : ''}${m.from || m.to ? `　期間: ${m.from || '?'}〜${m.to || '?'}` : ''}`, String(m.body || '')].join('\n')).join('\n\n');
  return { text, total, over: total > MEMO_PROMPT_MAX, count: memos.length };
}

export function buildPrompt(purpose, ledger, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const memo = purpose === 'memo' ? memoMaterial(ledger, opts.memoIds) : null;
  if (purpose === 'notebooklm') return notebookPrompt(ledger);
  if (purpose === 'report-polish') return reportPolishPrompt(ledger, opts.reportText || '');
  if (!PURPOSES.some((p) => p.id === purpose)) throw new Error('不明な目的: ' + purpose);
  const detailed = purpose.startsWith('review-');
  const def = PURPOSES.find((p) => p.id === purpose);
  const extra = { ...opts };
  if (purpose === 'hearing-questions') extra.gaps = gapsText(ledger, today);
  if (purpose === 'nfr') extra.nfr = nfrText(ledger);
  let ids = null;
  if (purpose === 'test-viewpoints') {
    const targetIds = Array.isArray(opts.targetIds) ? opts.targetIds : [];
    extra.targets = targetsText(ledger, targetIds);
    const idx = linkIndex(ledger);
    ids = new Set(targetIds);
    for (const id of targetIds) for (const x of idx.get(id) || []) ids.add(x);
  }
  if (purpose === 'change-review') {
    const cr = ledger.items.find((it) => it.id === opts.changeId && it.kind === 'change');
    if (cr) {
      const imp = impactOf(ledger, [cr.id]);
      ids = new Set([cr.id, ...(cr.links || []), ...imp.items.map((x) => x.item.id)]);
      extra.change = changeText(cr, imp);
    } else {
      extra.change = '（変更要求が選ばれていません。指示文の画面で変更要求を選んでください）';
      ids = new Set();
    }
  }
  return [
    taskText(purpose, extra) + (purpose === 'minutes' && opts.meetingId ? meetingText(ledger, opts.meetingId) : ''),
    '',
    rulesText(ledger, today),
    '',
    '## 種別と値の一覧',
    schemaText(),
    '',
    '## 出力の例',
    exampleJson(ledger.revision),
    '',
    '## 案件の概要',
    projectText(ledger),
    '',
    '## 今の台帳の項目一覧',
    ids ? (purpose === 'test-viewpoints' ? '（テストの対象と、それにつながる項目だけを載せています）' : '（変更要求とその影響範囲の項目だけを載せています）') : def.kinds ? `（${def.kinds.map(kindLabel).join('・')}だけを載せています）` : null,
    itemsText(ledger, detailed || purpose === 'change-review', ids ? null : def.kinds, ids),
    '',
    detailed ? '（レビュー対象は上の台帳です。補足の資料があれば下に貼ります）' : memo ? '（この下がメモです）' : '（この下に資料を貼ります）',
    MATERIAL_MARK,
    memo ? (memo.count ? memo.text : '（メモが選ばれていません。指示文の画面でメモを選んでください）') : '',
  ].filter((x) => x !== null).join('\n');
}

// 誤りの修正依頼文
export function buildFixPrompt(errorLines, ledger) {
  return [
    '先ほどの差分に、次の誤りがありました。誤りを直した差分を、同じ形式で全体をもう一度出力してください。',
    '誤りの無い操作もそのまま含めてください。出力は ```json で囲んだ JSON を1つだけにしてください。',
    '',
    '## 誤り',
    ...errorLines.map((e) => '- ' + e),
    '',
    '## 種別と値の一覧（再掲）',
    schemaText(),
    '',
    `basedOnRevision は ${ledger.revision} にしてください。`,
  ].join('\n');
}

