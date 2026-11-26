# 案件ワークベンチ P4 — タスク

## T1 種別と型・nested の参照
- 触るファイル: `src/core/schema.js` `src/core/patch.js` `src/ui/views/import.js` `build.mjs` `samples/sample-ledger.json` `samples/sample-master-*.csv` `test/schema.test.mjs` `test/patch.test.mjs`
- やること: entity / screen / interface / batch、columns / fields / crud、nested の参照と後始末、AC-02 の検査（checkIntegrity）、配列の要素が消える警告。build.mjs に P4 のファイル。サンプルにテーブル 6・画面 5・連携 2・バッチ 1、点検用の CSV（UTF-8 と Shift_JIS）
- **完了条件:** 物理名の重複・存在しない外部キー・主キーなし（警告）・crud の ops 誤り（"X"）がテストで検出される。却下したテーブルを参照する crud の要素が外れ、列の fk が外れる。列を2つ減らすテーブルの update で、取込のカードに消える列の名前が警告として出る

## T2 FP・DDL・名前の点検
- 触るファイル: `src/core/fp.js` `src/core/ddl.js` `test/fp.test.mjs` `test/ddl.test.mjs`
- やること: NESMA 概算、3 方言の DDL、循環する外部キー、予約語と長さの点検
- **完了条件:** 手で数えた FP と一致する。3 方言それぞれの DDL が期待する文字列と一致する（スナップショット）。user という名前のテーブルで予約語の警告が出る。外部キーが循環する 2 テーブルで ALTER が出る

## T3 ER 図の配置
- 触るファイル: `src/core/erlayout.js` `test/erlayout.test.mjs`
- やること: 層割り・並べ替え・箱の大きさ・線の経路
- **完了条件:** サンプルの 6 テーブルで箱どうしが重ならず、すべての外部キーの線の両端が箱の辺上にあることをテストで確かめる

## T4 CSV とマスタの点検
- 触るファイル: `src/core/csv.js` `src/core/mastercheck.js` `samples/sample-master-*.csv` `test/csv.test.mjs` `test/mastercheck.test.mjs`
- やること: 状態機械の読み取り・区切りの判定・点検の6種類
- **完了条件:** 引用符の中の改行・カンマ・`""`・BOM・CRLF の例が正しく読める。Shift_JIS のサンプルが自動判定で文字化けせずに読める。違反入りのサンプルで6種類の違反がそれぞれ期待の行番号で出る

## T5 健康診断と指示文
- 触るファイル: `src/core/health.js` `src/core/prompts.js` `test/health.test.mjs` `test/prompts.test.mjs`
- やること: 健康診断4種、目的2つ
- **完了条件:** 各点検の該当 / 非該当のテストが通る。指示文に columns・crud の書き方の例が入る

## T6 データ設計の画面
- 触るファイル: `src/ui/views/data.js` `src/ui/detail.js`
- やること: ER 図・テーブル定義・DDL（方言の選択とコピー）・名前の点検
- **完了条件:** ブラウザでサンプルの ER 図が出て、テーブルを押すと定義が出る。方言を変えると DDL が変わり、コピーできる

## T7 画面・連携・CRUD の画面
- 触るファイル: `src/ui/views/functions.js` `src/ui/views/crud.js`
- やること: 機能の一覧、CRUD 表と印
- **完了条件:** サンプルで CRUD 表の行列が機能数×テーブル数になり、作成されないテーブルに印と文字が出る

## T8 見積とマスタ点検の画面
- 触るファイル: `src/ui/views/estimate.js` `src/ui/views/master.js`
- やること: FP の内訳・生産性の入力・BAC との比較、CSV の貼り付けと点検結果
- **完了条件:** 生産性を入れると工数と差が出て、再読み込み後も生産性が残る。違反入りのサンプル CSV を貼ると件数と一覧が出て、画面を離れて戻ると元データが消えている（localStorage にも無い）

## T9 README・通しの確認
- 触るファイル: `samples/sample-ledger.json` `README.md`
- やること: 設計のダミー、使い方の追記、受入条件の確認表
- **完了条件:** AC-01〜15 の結果表ができ、未達は理由つきで残る
