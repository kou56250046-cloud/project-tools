// 種別・列挙値・参照フィールドの唯一の定義と、台帳・項目の検証。
// 指示文（prompts.js）もこの表から生成するので、ここを変えれば Gemini への説明も変わる。

export const SCHEMA_VERSION = 2;

// プロトタイプを持たない辞書。「constructor」「__proto__」などの名前が定義に紛れ込まないようにする
function dict(o) { return Object.assign(Object.create(null), o); }

export const CONFIDENCE = [
  { v: 'fact', label: '事実' },
  { v: 'guess', label: '推測' },
  { v: 'confirmed', label: '確認済み' },
];

export const SOURCE_TYPES = [
  { v: 'meeting', label: '会議' },
  { v: 'doc', label: '資料' },
  { v: 'mail', label: 'メール' },
  { v: 'chat', label: 'チャット' },
  { v: 'template', label: '案件の型' },
  { v: 'other', label: 'その他' },
];

// 範囲（スコープ）と、IPA 非機能要求グレードの 6 大項目
export const SCOPE = [
  { v: 'in', label: '範囲内' },
  { v: 'out', label: '範囲外' },
  { v: 'tbd', label: '未判断' },
];
export const NFR_CATEGORIES = [
  { v: 'availability', label: '可用性' },
  { v: 'performance', label: '性能・拡張性' },
  { v: 'operability', label: '運用・保守性' },
  { v: 'migration', label: '移行性' },
  { v: 'security', label: 'セキュリティ' },
  { v: 'environment', label: 'システム環境・エコロジー' },
];

// 設計の項目（P4）の状態と、列の論理型
const DESIGN_STATUSES = [{ v: 'draft', label: '案' }, { v: 'fixed', label: '確定' }, { v: 'dropped', label: '取り下げ' }];
export const LOGICAL_TYPES = [
  { v: 'string', label: '文字列' }, { v: 'text', label: '長い文章' }, { v: 'int', label: '整数' }, { v: 'bigint', label: '大きな整数' },
  { v: 'decimal', label: '小数' }, { v: 'date', label: '日付' }, { v: 'datetime', label: '日時' }, { v: 'boolean', label: '真偽' }, { v: 'code', label: 'コード' },
];

const PRIORITY = [
  { v: 'Must', label: 'Must' },
  { v: 'Should', label: 'Should' },
  { v: 'Could', label: 'Could' },
  { v: 'Wont', label: "Won't" },
];

// フィールドの型: string（1行）/ text（複数行）/ date（YYYY-MM-DD）/ enum / ref（単一 ID）/ refs（ID 配列）/ strings（文字列配列）
const KINDS_RAW = {
  stakeholder: {
    prefix: 'SH', label: '関係者',
    statuses: [{ v: 'active', label: '関与中' }, { v: 'inactive', label: '関与なし' }],
    fields: {
      side: { type: 'enum', required: true, label: '立場', values: [
        { v: 'customer', label: '顧客' }, { v: 'own', label: '自社' }, { v: 'vendor', label: '協力会社' }] },
      org: { type: 'string', label: '所属' },
      role: { type: 'string', label: '役割' },
    },
  },
  system: {
    prefix: 'SY', label: 'システム',
    statuses: [{ v: 'existing', label: '既存' }, { v: 'planned', label: '新規予定' }, { v: 'retired', label: '廃止' }],
    fields: {
      owner: { type: 'ref', label: '管理者', kinds: ['stakeholder'] },
    },
  },
  request: {
    prefix: 'RQ', label: '要望',
    statuses: [{ v: 'open', label: '検討中' }, { v: 'accepted', label: '採用' }, { v: 'rejected', label: '不採用' }, { v: 'deferred', label: '保留' }],
    fields: {
      owner: { type: 'ref', label: '要望者', kinds: ['stakeholder'] },
      priority: { type: 'enum', label: '優先度', values: PRIORITY },
      scope: { type: 'enum', label: '範囲', values: SCOPE },
      scopeReason: { type: 'text', label: '範囲の判断理由' },
    },
  },
  constraint: {
    prefix: 'CN', label: '制約',
    statuses: [{ v: 'active', label: '有効' }, { v: 'resolved', label: '解消' }],
    fields: {
      category: { type: 'enum', required: true, label: '分類', values: [
        { v: 'budget', label: '予算' }, { v: 'schedule', label: '期間' }, { v: 'technical', label: '技術' },
        { v: 'legal', label: '法令・規程' }, { v: 'operation', label: '運用' }, { v: 'other', label: 'その他' }] },
    },
  },
  requirement: {
    prefix: 'RE', label: '要件',
    statuses: [{ v: 'draft', label: '案' }, { v: 'agreed', label: '合意' }, { v: 'dropped', label: '取り下げ' }],
    fields: {
      priority: { type: 'enum', label: '優先度', values: PRIORITY },
      category: { type: 'enum', required: true, label: '分類', values: [
        { v: 'functional', label: '機能' }, { v: 'nonfunctional', label: '非機能' }] },
      nfrCategory: { type: 'enum', label: '非機能の大項目', values: NFR_CATEGORIES },
      scope: { type: 'enum', label: '範囲', values: SCOPE },
      scopeReason: { type: 'text', label: '範囲の判断理由' },
    },
  },
  decision: {
    prefix: 'DC', label: '決定',
    statuses: [{ v: 'valid', label: '有効' }, { v: 'superseded', label: '置き換え済み' }],
    fields: {
      decidedAt: { type: 'date', required: true, label: '決定日' },
      decidedBy: { type: 'refs', label: '決めた人', kinds: ['stakeholder'] },
      reason: { type: 'text', label: '理由' },
      alternatives: { type: 'strings', label: '検討した他の案' },
      supersedes: { type: 'ref', label: '置き換える決定', kinds: ['decision'] },
    },
  },
  issue: {
    prefix: 'IS', label: '課題',
    statuses: [{ v: 'open', label: '未着手' }, { v: 'in_progress', label: '対応中' }, { v: 'closed', label: '完了' }],
    fields: {
      owner: { type: 'ref', label: '担当', kinds: ['stakeholder'] },
      due: { type: 'date', label: '期限' },
      severity: { type: 'enum', label: '重要度', values: [
        { v: 'high', label: '高' }, { v: 'mid', label: '中' }, { v: 'low', label: '低' }] },
    },
  },
  question: {
    prefix: 'QA', label: '質問',
    statuses: [{ v: 'open', label: '未回答' }, { v: 'answered', label: '回答済み' }, { v: 'closed', label: 'クローズ' }],
    fields: {
      askTo: { type: 'ref', label: '質問先', kinds: ['stakeholder'] },
      due: { type: 'date', label: '期限' },
      answer: { type: 'text', label: '回答' },
      meeting: { type: 'ref', label: '聞く会議', kinds: ['meeting'] },
      askedAt: { type: 'date', label: '聞いた日' },
      nfrCategory: { type: 'enum', label: '非機能の大項目', values: NFR_CATEGORIES },
    },
  },
  meeting: {
    prefix: 'MT', label: '会議',
    statuses: [{ v: 'planned', label: '予定' }, { v: 'held', label: '開催済み' }, { v: 'cancelled', label: '中止' }],
    fields: {
      date: { type: 'date', required: true, label: '日付' },
      meetingType: { type: 'enum', required: true, label: '種類', values: [
        { v: 'regular', label: '定例' }, { v: 'hearing', label: 'ヒヤリング' }, { v: 'review', label: 'レビュー' }, { v: 'other', label: 'その他' }] },
      attendees: { type: 'refs', label: '出席者', kinds: ['stakeholder'] },
      agenda: { type: 'strings', label: '議題' },
    },
  },
  task: {
    prefix: 'TK', label: '作業',
    statuses: [{ v: 'todo', label: '未着手' }, { v: 'doing', label: '進行中' }, { v: 'done', label: '完了' }, { v: 'cancelled', label: '中止' }],
    fields: {
      parent: { type: 'ref', label: '親の作業', kinds: ['task'] },
      estimate: { type: 'number', label: '見積（人日）', min: 0, max: 100000 },
      actual: { type: 'number', label: '実績（人日）', min: 0, max: 100000 },
      assignee: { type: 'ref', label: '担当', kinds: ['stakeholder'] },
      start: { type: 'date', label: '開始日' },
      end: { type: 'date', label: '終了日' },
      progress: { type: 'number', label: '進捗（%）', min: 0, max: 100, integer: true },
      dependsOn: { type: 'refs', label: '前の作業', kinds: ['task'] },
      milestone: { type: 'boolean', label: 'マイルストーン' },
    },
  },
  change: {
    prefix: 'CR', label: '変更要求',
    statuses: [{ v: 'proposed', label: '起票' }, { v: 'approved', label: '承認' }, { v: 'rejected', label: '却下' }, { v: 'withdrawn', label: '取り下げ' }],
    fields: {
      requestedBy: { type: 'ref', label: '依頼者', kinds: ['stakeholder'] },
      extraEstimate: { type: 'number', label: '追加工数の見込み（人日）', min: 0, max: 100000 },
    },
  },
  entity: {
    prefix: 'EN', label: 'テーブル',
    statuses: DESIGN_STATUSES,
    fields: {
      physicalName: { type: 'string', required: true, label: '物理名' },
      fileType: { type: 'enum', required: true, label: '区分', values: [{ v: 'internal', label: '自システム' }, { v: 'external', label: '外部参照' }] },
      master: { type: 'boolean', label: 'マスタ' },
      columns: { type: 'columns', label: '列' },
    },
  },
  screen: {
    prefix: 'SC', label: '画面',
    statuses: DESIGN_STATUSES,
    fields: {
      screenType: { type: 'enum', required: true, label: '画面の区分', values: [{ v: 'input', label: '入力' }, { v: 'inquiry', label: '照会' }, { v: 'report', label: '帳票' }] },
      fields: { type: 'fields', label: '項目' },
      crud: { type: 'crud', label: 'CRUD' },
    },
  },
  interface: {
    prefix: 'IF', label: '連携',
    statuses: DESIGN_STATUSES,
    fields: {
      system: { type: 'ref', required: true, label: '相手のシステム', kinds: ['system'] },
      direction: { type: 'enum', required: true, label: '向き', values: [{ v: 'in', label: '受信' }, { v: 'out', label: '送信' }] },
      method: { type: 'enum', label: '方式', values: [{ v: 'file', label: 'ファイル' }, { v: 'api', label: 'API' }, { v: 'db', label: 'DB' }, { v: 'other', label: 'その他' }] },
      frequency: { type: 'string', label: '頻度' },
      fields: { type: 'fields', label: '項目' },
      crud: { type: 'crud', label: 'CRUD' },
    },
  },
  batch: {
    prefix: 'BT', label: 'バッチ',
    statuses: DESIGN_STATUSES,
    fields: {
      trigger: { type: 'string', label: '実行の契機' },
      frequency: { type: 'string', label: '頻度' },
      crud: { type: 'crud', label: 'CRUD' },
    },
  },
  test: {
    prefix: 'TS', label: 'テスト',
    statuses: [{ v: 'draft', label: '作成中' }, { v: 'ready', label: '準備完了' }, { v: 'passed', label: '合格' }, { v: 'failed', label: '不合格' }, { v: 'onhold', label: '保留' }],
    fields: {
      level: { type: 'enum', required: true, label: '工程', values: [{ v: 'unit', label: '単体' }, { v: 'integration', label: '結合' }, { v: 'system', label: '総合' }, { v: 'acceptance', label: '受入' }] },
      viewpoint: { type: 'enum', required: true, label: '観点', values: [{ v: 'normal', label: '正常' }, { v: 'boundary', label: '境界値' }, { v: 'error', label: '異常系' }, { v: 'authority', label: '権限' }, { v: 'performance', label: '性能' }, { v: 'other', label: 'その他' }] },
      steps: { type: 'text', label: '手順' },
      expected: { type: 'text', label: '期待結果' },
      executedAt: { type: 'date', label: '実施日' },
    },
  },
  // メモ（P6c）: チャット・会議の文字起こしなどの保管。社内のものとして扱い、台帳の項目としては出さない（LEDGER_KINDS に入れない）
  memo: {
    prefix: 'MM', label: 'メモ',
    statuses: [{ v: 'active', label: '使用中' }, { v: 'archived', label: '保管' }],
    fields: {
      memoType: { type: 'enum', required: true, label: '種類', values: [{ v: 'chat', label: 'チャット' }, { v: 'transcript', label: '会議の文字起こし' }, { v: 'other', label: 'その他' }] },
      channel: { type: 'string', label: '場所（チャンネル名など）' },
      from: { type: 'date', label: '期間の始め' },
      to: { type: 'date', label: '期間の終わり' },
    },
  },
};

export const KINDS = dict(Object.fromEntries(Object.entries(KINDS_RAW).map(([k, d]) => [k, { ...d, fields: dict(d.fields) }])));
export const KIND_IDS = Object.keys(KINDS);
export const ALL_KINDS = KIND_IDS;
// 台帳の項目として扱う種別（メモを除く）。指示文・一覧・件数・影響範囲・健康診断の項目ごとの点検はこれを使う
export const LEDGER_KINDS = KIND_IDS.filter((k) => k !== 'memo');
// メモの本文の上限（JS の文字列の長さ）と、案件ごとのメモの本文の合計の目安
export const MEMO_BODY_MAX = 50000;
export const MEMO_TOTAL_WARN = 300000;
export const RELATION_PREFIX = 'RL';
export const RELATION_NODE_KINDS = ['stakeholder', 'system'];

// 未完了とみなす状態
export const OPEN_STATUSES = dict({ issue: ['open', 'in_progress'], question: ['open'], task: ['todo', 'doing'], change: ['proposed'] });

// 担当と期限のフィールドは種別ごとに名前が違う（健康診断・ボールはこの表を使う）
export const OWNER_FIELD = dict({ issue: 'owner', question: 'askTo', task: 'assignee' });
export const DUE_FIELD = dict({ issue: 'due', question: 'due', task: 'end' });

// 共通フィールド（項目の種別によらない）
export const COMMON_FIELDS = dict({
  title: { type: 'string', required: true, label: '題名' },
  body: { type: 'text', label: '内容' },
  status: { type: 'status', label: '状態' },
  confidence: { type: 'enum', label: '確度', values: CONFIDENCE },
  sources: { type: 'sources', label: '出典' },
  links: { type: 'refs', label: '関連', kinds: ALL_KINDS },
  tags: { type: 'strings', label: 'タグ' },
  internal: { type: 'boolean', label: '社内のみ' },
});

// 参照フィールド（design.md の表と同じ）。逆参照・健康診断・tempId の後始末はすべてこれを使う
// shape: 'one' 単一 / 'many' 配列 / 'source' 出典ごとの speaker
export const REF_FIELDS = [
  { field: 'links', shape: 'many', kinds: ALL_KINDS, on: ALL_KINDS },
  { field: 'speaker', shape: 'source', kinds: ['stakeholder'], on: ALL_KINDS },
  { field: 'owner', shape: 'one', kinds: ['stakeholder'], on: ['system', 'request', 'issue'] },
  { field: 'askTo', shape: 'one', kinds: ['stakeholder'], on: ['question'] },
  { field: 'decidedBy', shape: 'many', kinds: ['stakeholder'], on: ['decision'] },
  { field: 'supersedes', shape: 'one', kinds: ['decision'], on: ['decision'] },
  { field: 'meeting', shape: 'one', kinds: ['meeting'], on: ['question'] },
  { field: 'attendees', shape: 'many', kinds: ['stakeholder'], on: ['meeting'] },
  { field: 'parent', shape: 'one', kinds: ['task'], on: ['task'] },
  { field: 'assignee', shape: 'one', kinds: ['stakeholder'], on: ['task'] },
  { field: 'dependsOn', shape: 'many', kinds: ['task'], on: ['task'] },
  { field: 'requestedBy', shape: 'one', kinds: ['stakeholder'], on: ['change'] },
  { field: 'system', shape: 'one', kinds: ['system'], on: ['interface'] },
  // 配列の中のオブジェクトの参照（P4）。path の先の ID を見る。dropElement なら参照先が無くなったとき要素ごと外す
  { field: 'columns', shape: 'nested', path: ['fk', 'entity'], kinds: ['entity'], on: ['entity'] },
  { field: 'fields', shape: 'nested', path: ['source', 'entity'], kinds: ['entity'], on: ['screen', 'interface'] },
  { field: 'crud', shape: 'nested', path: ['entity'], kinds: ['entity'], on: ['screen', 'interface', 'batch'], dropElement: true },
];

// 台帳ごとの設定（store.updateSettings で変える。Gemini には変えさせない）
export const SETTINGS = dict({
  ballWaitDays: { label: '顧客待ちを知らせる日数', type: 'int', min: 1, max: 90, default: 7 },
  productivity: { label: '生産性（人日 / FP）', type: 'number', min: 0.01, max: 100, default: null, nullable: true },
  ddlDialect: { label: 'DDL の方言', type: 'enum', default: 'postgres', values: [{ v: 'postgres', label: 'PostgreSQL' }, { v: 'sqlserver', label: 'SQL Server' }, { v: 'oracle', label: 'Oracle' }] },
  me: { label: '自分（この案件での関係者）', type: 'ref', kinds: ['stakeholder'], default: null, nullable: true },
  namingCase: { label: '物理名の大文字・小文字', type: 'enum', default: 'lower', values: [{ v: 'lower', label: '小文字（例: order_item）' }, { v: 'upper', label: '大文字（例: ORDER_ITEM）' }] },
});

export function defaultSettings() {
  const out = {};
  for (const [k, d] of Object.entries(SETTINGS)) out[k] = d.default;
  return out;
}

export function settingOf(ledger, key) {
  const v = ledger.settings ? ledger.settings[key] : undefined;
  return v === undefined ? SETTINGS[key].default : v;
}

export function validateSettings(partial) {
  const errors = [];
  for (const [k, v] of Object.entries(partial || {})) {
    const d = SETTINGS[k];
    if (!d) { errors.push(`設定「${k}」はありません`); continue; }
    if (d.type === 'int' && (!Number.isInteger(v) || v < d.min || v > d.max)) errors.push(`${d.label}は ${d.min}〜${d.max} の整数で指定してください`);
    if (v === null && d.nullable) continue;
    if (d.type === 'number' && (typeof v !== 'number' || !Number.isFinite(v) || v < d.min || v > d.max)) errors.push(`${d.label}は ${d.min}〜${d.max} の数で指定してください`);
    if (d.type === 'enum' && !d.values.some((e) => e.v === v)) errors.push(`${d.label}の値「${String(v)}」は使えません`);
    if (d.type === 'ref' && v !== null && typeof v !== 'string') errors.push(`${d.label}は ID で指定してください`);
  }
  return errors;
}

const ID_RE = new RegExp('^(' + KIND_IDS.map((k) => KINDS[k].prefix).join('|') + ')-(\\d{3,})$');
const REL_ID_RE = /^RL-(\d{3,})$/;
const BL_ID_RE = /^BL-(\d{3,})$/;
export const TEMP_ID_RE = /^new:[A-Za-z0-9_-]+$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function kindOfId(id) {
  if (typeof id !== 'string') return null;
  const m = ID_RE.exec(id);
  if (!m) return null;
  return KIND_IDS.find((k) => KINDS[k].prefix === m[1]) || null;
}

export function idNumber(id) {
  const m = ID_RE.exec(id) || REL_ID_RE.exec(id);
  return m ? Number(m[m.length - 1]) : 0;
}

export function formatId(prefix, n) {
  return prefix + '-' + String(n).padStart(3, '0');
}

export function isDate(s) {
  if (typeof s !== 'string') return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

// 日付の通し番号（日単位）。YYYY-MM-DD はそのまま、ISO 日時は端末のローカル日付にそろえる
export function dayNumber(ymd) {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

// ISO 日時（UTC）を、端末のローカル日付の通し番号にする（今日の日付はローカルなので合わせる）
export function localDayNumber(iso) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return NaN;
  return Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()) / 86400000;
}

export function kindLabel(kind) { return KINDS[kind] ? KINDS[kind].label : kind; }

export function statusLabel(kind, v) {
  const s = KINDS[kind] && KINDS[kind].statuses.find((x) => x.v === v);
  return s ? s.label : v;
}

export function enumLabel(values, v) {
  const x = values.find((e) => e.v === v);
  return x ? x.label : v;
}

export function fieldSpec(kind, name) {
  return COMMON_FIELDS[name] || (KINDS[kind] && KINDS[kind].fields[name]) || null;
}

export function isOpen(item) {
  const s = OPEN_STATUSES[item.kind];
  return !!s && s.includes(item.status);
}

const vlist = (values) => values.map((e) => e.v).join(', ');

// 参照の解決。resolve(id) は参照先の kind を返す。見つからなければ null
function checkRef(id, spec, where, resolve, out, allowDangling) {
  if (typeof id !== 'string' || id === '') { out.push(`${where}: ID を文字列で指定してください`); return; }
  const k = resolve(id);
  if (!k) {
    if (TEMP_ID_RE.test(id)) out.push(`${where}: 仮ID「${id}」はこの差分の中にありません`);
    else if (!kindOfId(id)) out.push(`${where}: 「${id}」は ID の形式ではありません（例: SH-001 / new:1）`);
    else if (!allowDangling) out.push(`${where}: ID「${id}」は台帳にありません`);
    return;
  }
  if (!spec.kinds.includes(k)) {
    out.push(`${where}: 「${id}」は${kindLabel(k)}です。ここには${spec.kinds.map(kindLabel).join('・')}の ID を指定してください`);
  }
}

// 1つのフィールド値を検査する
function checkField(kind, name, spec, value, ctx, out) {
  const where = `${spec.label}（${name}）`;
  switch (spec.type) {
    case 'string':
    case 'text':
      if (typeof value !== 'string') out.push(`${where}: 文字列で指定してください`);
      else if (spec.required && value.trim() === '') out.push(`${where}: 空にできません`);
      break;
    case 'date':
      if (!isDate(value)) out.push(`${where}: 日付は YYYY-MM-DD の形で指定してください（「${String(value)}」）`);
      break;
    case 'enum':
      if (!spec.values.some((e) => e.v === value)) out.push(`${where}: 「${String(value)}」は使えません。使える値: ${vlist(spec.values)}`);
      break;
    case 'status': {
      const st = KINDS[kind].statuses;
      if (!st.some((e) => e.v === value)) out.push(`${where}: 「${String(value)}」は使えません。使える値: ${vlist(st)}`);
      break;
    }
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) out.push(`${where}: 数で指定してください`);
      else if (spec.integer && !Number.isInteger(value)) out.push(`${where}: 整数で指定してください`);
      else if ((spec.min !== undefined && value < spec.min) || (spec.max !== undefined && value > spec.max)) out.push(`${where}: ${spec.min}〜${spec.max} の範囲で指定してください（${value}）`);
      break;
    case 'boolean':
      if (typeof value !== 'boolean') out.push(`${where}: true か false で指定してください`);
      break;
    case 'columns':
    case 'fields':
    case 'crud':
      checkNested(spec.type, value, where, ctx, out);
      break;
    case 'strings':
      if (!Array.isArray(value) || value.some((x) => typeof x !== 'string')) out.push(`${where}: 文字列の配列で指定してください`);
      break;
    case 'ref':
      checkRef(value, spec, where, ctx.resolve, out, ctx.allowDangling);
      break;
    case 'refs':
      if (!Array.isArray(value)) { out.push(`${where}: ID の配列で指定してください`); break; }
      value.forEach((id, i) => checkRef(id, spec, `${where}[${i}]`, ctx.resolve, out, ctx.allowDangling));
      break;
    case 'sources':
      if (!Array.isArray(value)) { out.push(`${where}: 配列で指定してください`); break; }
      value.forEach((s, i) => {
        const w = `出典[${i}]`;
        if (!s || typeof s !== 'object' || Array.isArray(s)) { out.push(`${w}: オブジェクトで指定してください`); return; }
        if (!SOURCE_TYPES.some((e) => e.v === s.type)) out.push(`${w}.type: 「${String(s.type)}」は使えません。使える値: ${vlist(SOURCE_TYPES)}`);
        if (typeof s.ref !== 'string' || s.ref.trim() === '') out.push(`${w}.ref: 会議名や資料名を文字列で指定してください`);
        if (s.date !== undefined && !isDate(s.date)) out.push(`${w}.date: 日付は YYYY-MM-DD の形で指定してください（「${String(s.date)}」）`);
        if (s.note !== undefined && typeof s.note !== 'string') out.push(`${w}.note: 文字列で指定してください`);
        if (s.speaker !== undefined) checkRef(s.speaker, { kinds: ['stakeholder'] }, `${w}.speaker`, ctx.resolve, out, ctx.allowDangling);
        for (const k of Object.keys(s)) {
          if (!['type', 'ref', 'date', 'speaker', 'note'].includes(k)) ctx.warnings.push(`${w}: 不明な項目「${k}」は無視します`);
        }
      });
      break;
    default:
      out.push(`${where}: 定義の誤り（型 ${spec.type}）`);
  }
}

// 列・項目・CRUD の配列の検査（P4）
const isObjLike = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const NESTED_KEYS = {
  columns: ['name', 'logical', 'type', 'length', 'scale', 'pk', 'required', 'fk', 'pattern', 'note'],
  fields: ['name', 'type', 'required', 'source'],
  crud: ['entity', 'ops'],
};
function checkNested(type, value, where, ctx, out) {
  if (!Array.isArray(value)) { out.push(`${where}: 配列で指定してください`); return; }
  const entitySpec = { kinds: ['entity'] };
  value.forEach((el, i) => {
    const w = `${where}[${i}]`;
    if (!isObjLike(el)) { out.push(`${w}: オブジェクトで指定してください`); return; }
    for (const k of Object.keys(el)) if (!NESTED_KEYS[type].includes(k)) ctx.warnings.push(`${w}: 不明な項目「${k}」は無視します`);
    if (type === 'crud') {
      checkRef(el.entity, entitySpec, `${w}.entity`, ctx.resolve, out, ctx.allowDangling);
      if (typeof el.ops !== 'string' || !/^[CRUD]+$/.test(el.ops) || new Set(el.ops).size !== el.ops.length) out.push(`${w}.ops: C・R・U・D の組み合わせで、同じ文字を重ねずに指定してください（例: "CRU"）。「${String(el.ops)}」`);
      return;
    }
    if (typeof el.name !== 'string' || el.name.trim() === '') out.push(`${w}.name: 名前がありません`);
    if (type === 'columns') {
      if (!LOGICAL_TYPES.some((t) => t.v === el.type)) out.push(`${w}.type: 「${String(el.type)}」は使えません。使える値: ${LOGICAL_TYPES.map((t) => t.v).join(', ')}`);
      if (el.length !== undefined && (!Number.isInteger(el.length) || el.length <= 0)) out.push(`${w}.length: 1 以上の整数で指定してください`);
      if (el.scale !== undefined && (!Number.isInteger(el.scale) || el.scale < 0)) out.push(`${w}.scale: 0 以上の整数で指定してください`);
      for (const b of ['pk', 'required']) if (el[b] !== undefined && typeof el[b] !== 'boolean') out.push(`${w}.${b}: true か false で指定してください`);
      if (el.fk !== undefined) {
        if (!isObjLike(el.fk)) out.push(`${w}.fk: { "entity": テーブルの ID, "column": 列名 } で指定してください`);
        else {
          checkRef(el.fk.entity, entitySpec, `${w}.fk.entity`, ctx.resolve, out, ctx.allowDangling);
          if (typeof el.fk.column !== 'string' || !el.fk.column) out.push(`${w}.fk.column: 参照先の列名がありません`);
        }
      }
      if (el.pattern !== undefined) {
        try { new RegExp(el.pattern); } catch (e) { out.push(`${w}.pattern: 正規表現として読めません`); }
      }
    } else if (el.source !== undefined) {
      if (!isObjLike(el.source)) out.push(`${w}.source: { "entity": テーブルの ID, "column": 列名 } で指定してください`);
      else checkRef(el.source.entity, entitySpec, `${w}.source.entity`, ctx.resolve, out, ctx.allowDangling);
    }
  });
}

const META_FIELDS = ['id', 'kind', 'createdAt', 'updatedAt'];

// 項目のフィールドを検査する。
// opts.partial: true なら update の set として検査（必須の欠けを見ない）
// 戻り値: { errors, warnings, unknown }（unknown は無視するフィールド名）
export function validateFields(kind, obj, opts) {
  const errors = [];
  const warnings = [];
  const unknown = [];
  const ctx = { resolve: opts.resolve, allowDangling: !!opts.allowDangling, warnings };
  if (!KINDS[kind]) {
    errors.push(`種別（kind）「${String(kind)}」は使えません。使える値: ${KIND_IDS.join(', ')}`);
    return { errors, warnings, unknown };
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    errors.push('項目はオブジェクトで指定してください');
    return { errors, warnings, unknown };
  }
  const specs = Object.assign(Object.create(null), COMMON_FIELDS, KINDS[kind].fields);
  if (!opts.partial) {
    for (const [name, spec] of Object.entries(specs)) {
      if (spec.required && (obj[name] === undefined || obj[name] === null || obj[name] === '')) {
        errors.push(`${spec.label}（${name}）がありません`);
      }
    }
  }
  for (const [name, value] of Object.entries(obj)) {
    if (META_FIELDS.includes(name) || value === undefined) continue;
    const spec = specs[name];
    if (!spec) { unknown.push(name); warnings.push(`不明な項目「${name}」は無視します`); continue; }
    // 任意項目に null が来たら「消す」とみなす（update で値を外すため）
    if (value === null) {
      // sources と links は配列であることを前提に描画・検査するので、消せない（空にするなら []）
      if (spec.required || ['status', 'confidence', 'sources', 'links'].includes(name)) errors.push(`${spec.label}（${name}）は空にできません${name === 'sources' || name === 'links' ? '。空にするときは [] を指定してください' : ''}`);
      continue;
    }
    checkField(kind, name, spec, value, ctx, errors);
  }
  if (kind === 'memo' && typeof obj.body === 'string' && obj.body.length > MEMO_BODY_MAX) {
    errors.push(`メモの本文は ${MEMO_BODY_MAX.toLocaleString()} 字までです（${obj.body.length.toLocaleString()} 字）。期間を分けてください`);
  }
  return { errors, warnings, unknown };
}

// 省略された共通フィールドを既定値で補う（新しいオブジェクトを返す）
export function withDefaults(kind, obj) {
  const out = { ...obj };
  if (out.status === undefined) out.status = KINDS[kind].statuses[0].v;
  if (out.confidence === undefined) out.confidence = 'guess';
  if (out.sources === undefined) out.sources = [];
  if (out.links === undefined) out.links = [];
  return out;
}

// 台帳から id → kind の解決関数を作る（関係の ID も含む）
export function makeResolver(ledger, extra) {
  const map = new Map();
  for (const it of ledger.items || []) if (it && typeof it.id === 'string') map.set(it.id, it.kind);
  return (id) => map.get(id) || (extra ? extra(id) : null) || null;
}

export function emptyLedger(name, now) {
  const counters = {};
  for (const k of KIND_IDS) counters[KINDS[k].prefix] = 0;
  counters[RELATION_PREFIX] = 0;
  counters[BASELINE_PREFIX] = 0;
  return {
    schemaVersion: SCHEMA_VERSION,
    type: 'ledger',
    revision: 0,
    project: { name: name || '新しい案件', goals: [], starter: null },
    items: [],
    relations: [],
    baselines: [],
    changelog: [],
    settings: defaultSettings(),
    counters,
    updatedAt: now,
  };
}

export const BASELINE_PREFIX = 'BL';
export const CHANGELOG_LIMIT = 2000;

// 古い版の台帳を今の版にそろえる。戻り値: { ledger, migrated } / { error }
// 移行はここ1か所で行う。元のオブジェクトは変えない
export function migrateLedger(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || obj.type !== 'ledger') return { error: '台帳ではありません' };
  if (obj.schemaVersion === SCHEMA_VERSION) return { ledger: obj, migrated: false };
  if (obj.schemaVersion === 1) {
    const out = {
      ...obj,
      schemaVersion: 2,
      baselines: [],
      changelog: [],
      settings: defaultSettings(),
      counters: { ...(obj.counters || {}), [BASELINE_PREFIX]: 0 },
    };
    return { ledger: out, migrated: true };
  }
  return { error: `この版（schemaVersion ${String(obj.schemaVersion)}）の台帳は、このツールでは開けません。新しい版のツールで開いてください` };
}

// 案件の型の ID（starter.js が登録する。schema.js から starter.js は import できないため）
const STARTER_IDS = new Set(['business-system-new']);
export function registerStarters(ids) {
  for (const id of ids) STARTER_IDS.add(id);
}

const PROJECT_FIELDS = dict({
  name: 'string', customer: 'string', purpose: 'text', periodStart: 'date', periodEnd: 'date',
  goals: 'strings', summary: 'text', starter: 'starter',
});

export function validateProject(p, partial) {
  const errors = [];
  const warnings = [];
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { errors: ['案件情報（project）はオブジェクトで指定してください'], warnings };
  if (!partial && (typeof p.name !== 'string' || p.name.trim() === '')) errors.push('案件名（project.name）がありません');
  for (const [k, v] of Object.entries(p)) {
    const t = PROJECT_FIELDS[k];
    if (!t) { warnings.push(`案件情報の不明な項目「${k}」は無視します`); continue; }
    if (v === null) { if (k === 'name') errors.push('案件名（name）は空にできません'); continue; }
    if ((t === 'string' || t === 'text') && typeof v !== 'string') errors.push(`案件情報 ${k}: 文字列で指定してください`);
    if (t === 'date' && !isDate(v)) errors.push(`案件情報 ${k}: 日付は YYYY-MM-DD の形で指定してください（「${String(v)}」）`);
    if (t === 'strings' && (!Array.isArray(v) || v.some((x) => typeof x !== 'string'))) errors.push(`案件情報 ${k}: 文字列の配列で指定してください`);
    if (t === 'starter' && !STARTER_IDS.has(v)) errors.push(`案件情報 ${k}: 「${String(v)}」は使えません`);
  }
  if (p.name !== undefined && typeof p.name === 'string' && p.name.trim() === '') errors.push('案件名（name）は空にできません');
  return { errors, warnings };
}

// 台帳全体の検査。opts.allowDanglingRefs: 存在しない ID への参照を許す（ファイル読み込み用）
export function validateLedger(obj, opts = {}) {
  const errors = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return ['台帳がオブジェクトではありません'];
  if (obj.type !== 'ledger') errors.push('type が "ledger" ではありません（台帳のファイルではない可能性があります）');
  if (obj.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion が ${SCHEMA_VERSION} ではありません（${String(obj.schemaVersion)}）`);
  if (!Number.isInteger(obj.revision) || obj.revision < 0) errors.push('revision が 0 以上の整数ではありません');
  errors.push(...validateProject(obj.project, false).errors);
  if (!Array.isArray(obj.items)) { errors.push('items が配列ではありません'); return errors; }
  if (!Array.isArray(obj.relations)) { errors.push('relations が配列ではありません'); return errors; }

  const seen = new Set();
  obj.items.forEach((it, i) => {
    const where = `items[${i}]`;
    if (!it || typeof it !== 'object') { errors.push(`${where}: オブジェクトではありません`); return; }
    const k = kindOfId(it.id);
    if (!k) { errors.push(`${where}: ID「${String(it.id)}」の形式が正しくありません`); return; }
    if (k !== it.kind) errors.push(`${where}（${it.id}）: ID の接頭辞と種別「${String(it.kind)}」が合いません`);
    if (seen.has(it.id)) errors.push(`${where}: ID「${it.id}」が重複しています`);
    seen.add(it.id);
  });
  const resolve = makeResolver(obj);
  obj.items.forEach((it, i) => {
    if (!it || !KINDS[it.kind]) return;
    const r = validateFields(it.kind, it, { resolve, allowDangling: !!opts.allowDanglingRefs });
    for (const e of r.errors) errors.push(`items[${i}]（${it.id}）: ${e}`);
    for (const f of ['status', 'confidence', 'sources', 'links']) {
      if (it[f] === undefined) errors.push(`items[${i}]（${it.id}）: ${f} がありません`);
    }
  });
  // 版 2 で足した入れ物。形だけ見て、不明なキーは誤りにしない（後の段階で足す値で読めなくならないように）
  if (!Array.isArray(obj.baselines)) errors.push('baselines が配列ではありません');
  else obj.baselines.forEach((b, i) => {
    if (!b || typeof b !== 'object' || !BL_ID_RE.test(b.id) || typeof b.name !== 'string' || !isDate(b.date) || !Array.isArray(b.items)) errors.push(`baselines[${i}]: 形が正しくありません（id・name・date・items が要ります）`);
  });
  if (!Array.isArray(obj.changelog)) errors.push('changelog が配列ではありません');
  else if (obj.changelog.some((c) => !c || typeof c !== 'object' || !Array.isArray(c.changes))) errors.push('changelog の要素の形が正しくありません');
  if (!obj.settings || typeof obj.settings !== 'object' || Array.isArray(obj.settings)) errors.push('settings がオブジェクトではありません');

  const relSeen = new Set();
  obj.relations.forEach((r, i) => {
    const where = `relations[${i}]`;
    if (!r || typeof r !== 'object') { errors.push(`${where}: オブジェクトではありません`); return; }
    if (!REL_ID_RE.test(r.id)) errors.push(`${where}: ID「${String(r.id)}」の形式が正しくありません（例: RL-001）`);
    if (relSeen.has(r.id)) errors.push(`${where}: ID「${r.id}」が重複しています`);
    relSeen.add(r.id);
    if (typeof r.label !== 'string') errors.push(`${where}: label を文字列で指定してください`);
    const spec = { kinds: RELATION_NODE_KINDS };
    const out = [];
    checkRef(r.from, spec, `${where}.from`, resolve, out, !!opts.allowDanglingRefs);
    checkRef(r.to, spec, `${where}.to`, resolve, out, !!opts.allowDanglingRefs);
    errors.push(...out);
  });
  return errors;
}

// counters を項目と関係の最大番号以上にそろえる（読み込んだ台帳の採番が重複しないように）
export function normalizeCounters(ledger) {
  const counters = { ...(ledger.counters || {}) };
  for (const k of KIND_IDS) {
    const p = KINDS[k].prefix;
    counters[p] = Math.max(Number(counters[p]) || 0, ...ledger.items.filter((it) => it.kind === k).map((it) => idNumber(it.id)), 0);
  }
  counters[RELATION_PREFIX] = Math.max(Number(counters[RELATION_PREFIX]) || 0, ...ledger.relations.map((r) => idNumber(r.id)), 0);
  counters[BASELINE_PREFIX] = Math.max(Number(counters[BASELINE_PREFIX]) || 0, ...(ledger.baselines || []).map((b) => { const m = BL_ID_RE.exec(b.id); return m ? Number(m[1]) : 0; }), 0);
  return { ...ledger, counters };
}

// ベースライン（P2）
export function latestBaseline(ledger) {
  const b = ledger.baselines || [];
  return b.length ? b[b.length - 1] : null;
}

// 最新のベースラインに無い要望・要件の ID
export function afterBaselineIds(ledger) {
  const b = latestBaseline(ledger);
  if (!b) return new Set();
  const inBase = new Set(b.items.map((x) => x.id));
  return new Set(ledger.items.filter((it) => (it.kind === 'request' || it.kind === 'requirement') && !inBase.has(it.id)).map((it) => it.id));
}

// 説明用の表示（P3）: 社内のみの項目と、それにつながる関係を除いた台帳を返す。全画面の一覧・集計はこれを通す
export function visibleLedger(ledger, presentation) {
  if (!presentation) return ledger;
  // 説明用の表示では、社内のみの項目とメモを除く
  const items = ledger.items.filter((it) => !it.internal && it.kind !== 'memo');
  const ids = new Set(items.map((it) => it.id));
  return { ...ledger, items, relations: ledger.relations.filter((r) => ids.has(r.from) && ids.has(r.to)) };
}

// links は向きを持たない。A と B がつながっている = A.links に B があるか、B.links に A があるか
export function linkIndex(ledger) {
  const map = new Map();
  const add = (a, b) => { if (!map.has(a)) map.set(a, new Set()); map.get(a).add(b); };
  for (const it of ledger.items) {
    for (const id of it.links || []) { add(it.id, id); add(id, it.id); }
  }
  return map;
}

export function linkedIds(ledger, id, index) {
  return (index || linkIndex(ledger)).get(id) || new Set();
}

// 項目をまたぐ検査（循環・重複など）。戻り値: { errors: { itemId, message }[], warnings }
// 段階ごとに INTEGRITY_RULES に規則を足す。取込と画面の変更では、仮に適用した台帳にかけて新しい誤りを止める
export const INTEGRITY_RULES = [];

// P3: 作業の親の循環・前の作業の循環・開始 > 終了
function findCycleNodes(nodes, nextOf) {
  // 深さ優先で、循環に含まれる ID を集める
  const state = new Map();
  const inCycle = new Set();
  const stack = [];
  const visit = (id) => {
    state.set(id, 1);
    stack.push(id);
    for (const n of nextOf(id)) {
      if (!nodes.has(n)) continue;
      if (state.get(n) === 1) { for (let i = stack.indexOf(n); i < stack.length; i++) inCycle.add(stack[i]); }
      else if (!state.has(n)) visit(n);
    }
    stack.pop();
    state.set(id, 2);
  };
  for (const id of nodes.keys()) if (!state.has(id)) visit(id);
  return inCycle;
}

// P4: テーブルの物理名の重複・同じテーブル内の列名の重複・外部キーの参照先の列・主キーの無いテーブル（警告）
INTEGRITY_RULES.push((ledger, errors, warnings) => {
  const ents = ledger.items.filter((it) => it.kind === 'entity' && it.status !== 'dropped');
  const byName = new Map();
  for (const e of ents) {
    const key = String(e.physicalName || '').toLowerCase();
    if (!key) continue;
    if (byName.has(key)) errors.push({ itemId: e.id, message: `テーブルの物理名「${e.physicalName}」が ${byName.get(key)} と重複しています` });
    else byName.set(key, e.id);
  }
  const byId = new Map(ledger.items.filter((it) => it.kind === 'entity').map((e) => [e.id, e]));
  for (const e of ents) {
    const cols = Array.isArray(e.columns) ? e.columns : [];
    const seen = new Set();
    for (const c of cols) {
      const n = String(c && c.name || '').toLowerCase();
      if (n && seen.has(n)) errors.push({ itemId: e.id, message: `列名「${c.name}」が重複しています` });
      seen.add(n);
      if (c && c.fk && c.fk.entity) {
        const ref = byId.get(c.fk.entity);
        if (ref && !(ref.columns || []).some((x) => x && String(x.name).toLowerCase() === String(c.fk.column).toLowerCase())) {
          errors.push({ itemId: e.id, message: `列「${c.name}」の外部キーの参照先 ${c.fk.entity} に列「${c.fk.column}」がありません` });
        }
      }
    }
    if (cols.length && !cols.some((c) => c && c.pk)) warnings.push({ itemId: e.id, message: `テーブル「${e.title}」に主キーがありません` });
  }
});

INTEGRITY_RULES.push((ledger, errors) => {
  const tasks = new Map(ledger.items.filter((it) => it.kind === 'task').map((it) => [it.id, it]));
  for (const id of findCycleNodes(tasks, (x) => (tasks.get(x).parent ? [tasks.get(x).parent] : []))) {
    errors.push({ itemId: id, message: '親の作業をたどると自分に戻ります（親子が循環しています）' });
  }
  for (const id of findCycleNodes(tasks, (x) => tasks.get(x).dependsOn || [])) {
    errors.push({ itemId: id, message: '前の作業をたどると自分に戻ります（前後関係が循環しています）' });
  }
  for (const t of tasks.values()) {
    if (t.start && t.end && t.start > t.end) errors.push({ itemId: t.id, message: `開始日（${t.start}）が終了日（${t.end}）より後です` });
  }
});

export function checkIntegrity(ledger) {
  const errors = [];
  const warnings = [];
  for (const rule of INTEGRITY_RULES) rule(ledger, errors, warnings);
  return { errors, warnings };
}

// 元の台帳に無かった誤りだけを返す（取込の判定用）
export function newIntegrityErrors(before, after) {
  const key = (e) => e.itemId + '|' + e.message;
  const had = new Set(checkIntegrity(before).errors.map(key));
  return checkIntegrity(after).errors.filter((e) => !had.has(key(e)));
}

// 配列の要素の中の参照（path をたどる）
export function nestedRef(el, path) {
  let v = el;
  for (const k of path) { if (!v || typeof v !== 'object') return null; v = v[k]; }
  return typeof v === 'string' ? v : null;
}

// 項目が参照している ID を列挙する: [{ field, id, index? }]
export function refsOf(item) {
  const out = [];
  for (const rf of REF_FIELDS) {
    if (!rf.on.includes(item.kind)) continue;
    if (rf.shape === 'source') {
      (item.sources || []).forEach((s, i) => { if (s && s.speaker) out.push({ field: 'speaker', id: s.speaker, index: i }); });
    } else if (rf.shape === 'nested') {
      (Array.isArray(item[rf.field]) ? item[rf.field] : []).forEach((el, i) => {
        const id = nestedRef(el, rf.path);
        if (id) out.push({ field: rf.field, id, index: i });
      });
    } else if (rf.shape === 'many') {
      (Array.isArray(item[rf.field]) ? item[rf.field] : []).forEach((id) => out.push({ field: rf.field, id }));
    } else if (item[rf.field]) {
      out.push({ field: rf.field, id: item[rf.field] });
    }
  }
  return out;
}

// 逆参照の索引: id → [{ from: 項目ID, field }]。関係（relations）も含める
export function buildBackrefs(ledger) {
  const map = new Map();
  const add = (to, entry) => { if (!map.has(to)) map.set(to, []); map.get(to).push(entry); };
  for (const it of ledger.items) {
    for (const r of refsOf(it)) add(r.id, { from: it.id, field: r.field });
  }
  for (const rel of ledger.relations) {
    add(rel.from, { from: rel.to, field: 'relation', relation: rel.id, label: rel.label });
    add(rel.to, { from: rel.from, field: 'relation', relation: rel.id, label: rel.label });
  }
  return map;
}

// kind を渡すとその種別でのラベルを返す（owner は種別により「担当」「要望者」「管理者」）
export function refFieldLabel(field, kind) {
  if (field === 'speaker') return '発言者';
  if (field === 'relation') return '関係';
  if (field === 'links') return '関連';
  if (kind && KINDS[kind] && KINDS[kind].fields[field]) return KINDS[kind].fields[field].label;
  for (const k of KIND_IDS) if (KINDS[k].fields[field]) return KINDS[k].fields[field].label;
  return field;
}
