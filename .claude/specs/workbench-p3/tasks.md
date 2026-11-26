# 案件ワークベンチ P3 — タスク

## T1 種別・型・検査の追加・サンプル
- 触るファイル: `src/core/schema.js` `src/core/health.js` `src/core/ball.js` `build.mjs` `samples/sample-ledger.json` `test/schema.test.mjs` `test/integrity.test.mjs`
- やること: task / change、internal、number / boolean 型、OPEN_STATUSES・OWNER_FIELD・DUE_FIELD、checkIntegrity に循環と日付。build.mjs に P3 のファイル。サンプルに作業 15 件前後・変更要求 2 件・進捗の記録を足す
- **完了条件:** 正しい作業が通り、進捗 120・見積 −1 が日本語の誤りになる。親の循環・前の作業の循環・終了だけの部分更新で開始 > 終了になる差分が、仮適用の検査で適用できなくなる。担当の無い作業に「質問先」の文言が出ず「担当」と出る。以上をテストで確かめる

## T2 記録の values
- 触るファイル: `src/core/patch.js` `test/patch.test.mjs`
- やること: 作業の add と update で progress / actual / estimate / status を values に残す。2,000 件で切るときの起点の記録
- **完了条件:** 進捗つきで追加して 2 回更新すると、記録に 3 つの値が時系列で残る。切り詰めた後も起点の記録から最後の値が分かる。以上をテストで確かめる

## T3 WBS の集計と EVM
- 触るファイル: `src/core/wbs.js` `src/core/evm.js` `src/core/health.js` `test/wbs.test.mjs` `test/evm.test.mjs`
- やること: buildTree・遅れ判定・BAC / PV / EV / AC / SPI / CPI / EAC・S カーブの点・evm-low
- **完了条件:** 手計算した小さな例（作業 3 件・記録 4 件）と、各値・各週の点が一致するテストが通る。AC 0 で CPI が null、PV 0 で SPI が null

## T4 影響範囲と定例会資料
- 触るファイル: `src/core/impact.js` `src/core/report.js` `test/impact.test.mjs` `test/report.test.mjs`
- やること: impactOf（2段・子孫の作業を含む）、期間の変更の分類と文面
- **完了条件:** サンプルで要件 RE-002 の影響範囲に、つながる作業・課題が入り、見積の合計が手計算と一致する。担当者経由の無関係な作業が入らない。期間外の記録が文面に入らない。説明用の表示では社内のみの項目が文面に入らない

## T5 指示文
- 触るファイル: `src/core/prompts.js` `test/prompts.test.mjs`
- やること: 目的4つ
- **完了条件:** 各目的で対象種別以外の ID が入らない。週報の清書には JSON の出力指定が入らない

## T6 描画部品
- 触るファイル: `src/ui/chart.js`
- やること: 日付軸の折れ線（3系列・凡例を線の端に・週の目盛）、ガントの横棒（階層の字下げ・今日線・進捗・菱形・矢印）
- **完了条件:** サンプルで描いた SVG に、外部の参照（href / style 属性）が無く、要素数が作業数と一致することを Playwright の evaluate で確かめる

## T7 WBS・ガント・進捗の画面
- 触るファイル: `src/ui/views/wbs.js` `gantt.js` `progress.js` `src/app.js`
- やること: 階層の表とその場での進捗・実績の入力、ガント（週 / 月）、EVM の数値と S カーブ
- **完了条件:** ブラウザで末端の作業の進捗を変えると、親の進捗・EVM・S カーブが変わり、取り消しで戻る。遅れている作業に印と文字が出る

## T8 変更要求と影響範囲の画面
- 触るファイル: `src/ui/views/changes.js` `src/ui/detail.js`
- やること: 変更要求の一覧、詳細の影響範囲と下書きのコピー
- **完了条件:** サンプルの変更要求で、影響範囲と見積の合計が T4 のテストの値と一致し、下書きをコピーできる

## T9 定例会資料・週報
- 触るファイル: `src/ui/views/meeting-report.js`
- やること: 期間の選択、まとめの表示、週報のコピー
- **完了条件:** 期間を前回の会議から今日にすると、その間に取り込んだ項目がまとめに出て、週報の文面をコピーできる

## T10 説明用の表示
- 触るファイル: `src/ui/store.js` `src/app.js` `src/ui/detail.js` 既存の画面
- やること: 社内のみの切り替え、visibleItems を全画面に通す、道具の分類を隠す
- **完了条件:** 社内のみの課題を1件作り、それを links に持つ要件も用意する。説明用の表示にすると、一覧・関係図・概要・定例会資料・週報のどこにもその課題が出ず、要件の詳細パネルでは「（社内のみ）」とだけ出る。WBS の実績の列が出ない。健康診断と道具の分類が出ず、#prompts を直接開くと概要に戻る。再読み込みすると通常の表示に戻る

## T11 README・通しの確認
- 触るファイル: `README.md`
- やること: 使い方の追記、受入条件の確認表
- **完了条件:** AC-01〜22 の結果表ができ、未達は理由つきで残る
