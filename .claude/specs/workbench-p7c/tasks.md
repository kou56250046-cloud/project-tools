# 案件ワークベンチ P7c — タスク

## T1 フローの部品と図
- 触るファイル: `src/core/flow.js` `src/ui/flowsvg.js` `src/styles.css` `test/flow.test.mjs` `test/ui-colors.test.mjs` `build.mjs`
- **完了条件:** gemini-kit の flow のテスト（parse・誤りの行番号・全角・日本語のキーワード・連続矢印・点線・配置で箱が重ならない・線が箱を通らない・区分の引き継ぎと警告）が通る（色のテストは palette を写さないので、design.md の変数の表に置き換える）。参照の ID に台帳の接頭辞と JDG・TBL が使え、Q・H・F・D は参照にならない。誤りのある行を外して描ける。design.md の変数の組み合わせのコントラストが 4.5 以上

## T2 業務フロー
- 触るファイル: `src/core/schema.js` `src/core/flow-format.js` `src/core/health.js` `src/core/prompts.js` `src/ui/views/prompts.js`（対象のフローを選ぶ欄） `src/ui/views/bizflow.js` `src/core/screens.js` `src/app.js` `src/core/guide-text.js` `test/flow.test.mjs`
- **完了条件:** テストで、bizflow を差分でも画面の操作でも足せ、notation の上限・flow-error・指示文の目的（選んだフローの記法が全文載る・ほかの目的の一覧に記法が出ない）を確かめる。ブラウザで、図が出て、記法を直して保存・取り消しでき、現行と導入後が並ぶ

## T3 構成図
- 触るファイル: `src/core/arch.js` `src/ui/views/arch.js` `src/core/screens.js` `src/app.js` `src/styles.css` `src/core/guide-text.js` `test/arch.test.mjs`
- **完了条件:** テストで、受信元が左・送信先が右・両方向の相手が左右に出る・同じ相手と向きの連携が 1 本にまとまる・新規予定と廃止の印・取り下げを出さない・連携の無いシステム・バッチの一覧・0 件を確かめる。ブラウザで図が出る

## T4 判断・データの部品
- 触るファイル: `src/core/mdblocks.js` `src/core/table-def.js` `src/core/judge.js` `src/core/judge-sample.js` `test/judge.test.mjs` `test/fixtures/judge/`
- **完了条件:** gemini-kit の judge のテストのうち、写した部分（テーブル定義の読み取り・判断マスタの読み取り・漏れと矛盾・512 の上限・突き合わせ・デモ・まとめ保存）が通る。台帳の ID の状態の判定（design.md の表の全種別）と、questionPatch（題名・質問先の照合・既存の未回答だけを指すものと同じ題名を除く）・toEntityPatch（物理名なし・区分の既定・内部名なしの列・number の判定・fk の column・同じ物理名は飛ばして既存の EN を指す・根拠の links と note）が通る

## T5 判断・データの画面と指示文
- 触るファイル: `src/ui/views/judge.js` `src/ui/views/import.js` `src/core/prompts.js` `src/core/screens.js` `src/app.js` `src/core/guide-text.js` `src/ui/flowsvg.js`（当たり判定）
- **完了条件:** ブラウザで、サンプルを読み込んで図・点検（列定義表つき）・デモが動き、箱を押せ、確認事項を質問として取込に渡せ（2 回押しても二重にならない）、テーブル定義を台帳のテーブルとして取込に渡せる（下書きがあれば確認が出る）。ロックと案件の切り替えで消える。目的が 4 つ増える。使い方の説明が出る
