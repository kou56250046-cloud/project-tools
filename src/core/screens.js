// 画面の分類と画面の一覧（唯一の定義）。app.js の画面の切り替えも、使い方の画面もここから作る
// DOM に触れないので、テストから読める

export const GROUPS = [
  { id: 'grasp', label: '把握' },
  { id: 'req', label: '要件定義' },
  { id: 'plan', label: '計画・進捗' },
  { id: 'design', label: '設計' },
  { id: 'test', label: 'テスト' },
  { id: 'tools', label: '道具' },
  { id: 'help', label: '使い方' },
];

export const SCREENS = [
  { id: 'cross', group: 'grasp', label: '横断' },
  { id: 'overview', group: 'grasp', label: '概要' },
  { id: 'graph', group: 'grasp', label: '関係図' },
  { id: 'list', group: 'grasp', label: '一覧' },
  { id: 'decisions', group: 'grasp', label: '決定ログ' },
  { id: 'health', group: 'grasp', label: '健康診断' },
  { id: 'memos', group: 'grasp', label: 'メモ' },
  { id: 'hearing', group: 'req', label: 'ヒヤリング' },
  { id: 'issues', group: 'req', label: '課題と質問' },
  { id: 'nfr', group: 'req', label: '非機能' },
  { id: 'scope', group: 'req', label: 'スコープ' },
  { id: 'wbs', group: 'plan', label: 'WBS' },
  { id: 'gantt', group: 'plan', label: 'ガント' },
  { id: 'progress', group: 'plan', label: '進捗（EVM）' },
  { id: 'changes', group: 'plan', label: '変更管理' },
  { id: 'meeting-report', group: 'plan', label: '定例会資料' },
  { id: 'data', group: 'design', label: 'データ設計' },
  { id: 'functions', group: 'design', label: '画面・連携' },
  { id: 'crud', group: 'design', label: 'CRUD' },
  { id: 'estimate', group: 'design', label: '見積（FP）' },
  { id: 'master', group: 'design', label: 'マスタ点検' },
  { id: 'trace', group: 'test', label: 'トレーサビリティ' },
  { id: 'tests', group: 'test', label: 'テスト' },
  { id: 'prompts', group: 'tools', label: '指示文' },
  { id: 'import', group: 'tools', label: '取込' },
  { id: 'convert', group: 'tools', label: '資料の変換' },
  { id: 'preprocess', group: 'tools', label: '議事録の前処理' },
  { id: 'mask', group: 'tools', label: 'マスキング' },
  { id: 'settings', group: 'tools', label: '設定' },
  { id: 'guide', group: 'help', label: '使い方' },
];

// 台帳が無くても開ける画面
export const NO_LEDGER_OK = ['settings', 'guide', 'convert', 'preprocess', 'mask'];

// 説明用の表示で隠す画面（社内向けの点検・道具・他の案件が見える画面・社内のメモ）
export function hiddenScreenInPresentation(s) {
  return !!s && (s.group === 'tools' || s.id === 'health' || s.id === 'cross' || s.id === 'memos');
}

export function screenById(id) {
  return SCREENS.find((s) => s.id === id) || null;
}
