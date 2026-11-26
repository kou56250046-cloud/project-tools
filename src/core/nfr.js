// IPA 非機能要求グレードの 6 大項目と、確認点（中項目の例）。指示文と非機能画面はこの表から作る。
// 大項目の ID と表示名は schema.js の NFR_CATEGORIES が正。ここは確認点だけを持つ。

import { NFR_CATEGORIES } from './schema.js';

const NFR_POINTS = {
  availability: ['継続性（稼働時間帯・計画停止の可否・停止してよい時間）', '耐障害性（冗長化の要否）', '災害対策（遠隔地バックアップ・復旧拠点）', '回復性（復旧までの時間 RTO・どの時点まで戻すか RPO）'],
  performance: ['業務処理量（利用者数・同時利用数・件数とその伸び）', '性能目標（画面の応答時間・バッチの処理時間）', '繁忙期と締め日のピーク', '将来の拡張（利用者・データ量の増加の見込み）'],
  operability: ['運用時間と監視（誰が何を見るか）', 'バックアップの方式と保管期間', '保守の体制と問い合わせ窓口', 'マスタ・権限・利用者の追加変更の手順'],
  migration: ['移行の方式（一括・段階）と切り替えの日程', '移行するデータの範囲・件数・品質', '並行稼働の要否', '移行のリハーサルと戻し手順'],
  security: ['認証と権限（だれが何をできるか）', '社内のセキュリティ規程・監査への対応', 'ログの取得と保管', 'データの暗号化・個人情報の扱い・外部公開の有無'],
  environment: ['利用する端末・ブラウザ・ネットワーク', '設置場所（クラウド・社内）と制約', '使ってよいソフトウェア・ライセンスの制約', '省エネ・機器の設置条件（オンプレミスの場合）'],
};

export const NFR = NFR_CATEGORIES.map((c) => ({ id: c.v, label: c.label, points: NFR_POINTS[c.v] || [] }));

export function nfrLabel(id) {
  const c = NFR_CATEGORIES.find((x) => x.v === id);
  return c ? c.label : id;
}

// 大項目ごとの状態。判定は design.md の表のとおり（上から順に当てはめる）
// 戻り値: [{ id, label, points, requirements, openQuestions, answeredQuestions, state }]
export const NFR_STATES = [
  { v: 'agreed', label: '合意済み' },
  { v: 'defined', label: '定義あり' },
  { v: 'asking', label: '質問中' },
  { v: 'none', label: '未着手' },
];

export function nfrStatus(ledger) {
  return NFR.map((c) => {
    const requirements = ledger.items.filter((it) => it.kind === 'requirement' && it.category === 'nonfunctional' && it.nfrCategory === c.id && it.status !== 'dropped');
    const questions = ledger.items.filter((it) => it.kind === 'question' && it.nfrCategory === c.id);
    const openQuestions = questions.filter((q) => q.status === 'open');
    let state = 'none';
    if (requirements.length && requirements.every((r) => r.status === 'agreed')) state = 'agreed';
    else if (requirements.length) state = 'defined';
    else if (openQuestions.length) state = 'asking';
    return { ...c, requirements, openQuestions, answeredQuestions: questions.filter((q) => q.status !== 'open'), state };
  });
}
