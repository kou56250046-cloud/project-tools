# 案件ワークベンチ P2 — タスク

## T1 版 2 と移行・共通の決まり
- 触るファイル: `src/core/schema.js` `src/core/starter.js` `src/core/extract.js` `src/core/health.js` `src/ui/store.js` `build.mjs` `samples/sample-ledger-v1.json` `samples/sample-ledger.json` `test/migrate.test.mjs` `test/integrity.test.mjs`
- やること: `migrateLedger`・版 2 の検査（不明キーは警告）・`emptyLedger` の版 2 化・`createLedger` の記録の除去・extract の版・移行時は未書き出し・store の3つの読み込み経路で移行を通す。`checkIntegrity` と取込・画面変更での仮適用検査、読み込み時は健康診断 integrity。`linkedIds` と unlinked-request の置き換え。`SETTINGS` 表と `store.updateSettings`。build.mjs に P2 の新しいファイルを足す。サンプルを版 2 にして P2 のダミーを足す
- **完了条件:** 版 1 のサンプルを移行すると版 2 の検査を通り、項目数と内容が変わらない。未知の版（3）は移行せず読めない扱いになる。changelog に不明なキーがある台帳が読める（警告のみ）。型から作った台帳の revision が 0 で changelog が空。版 1 のファイルを読み込むと「未書き出し」になる。要望側の links だけでつながる要件でも unlinked-request が出ない。updateSettings で revision が上がり、取り消しで戻る。以上をテストで確かめる

## T2 種別・項目の追加
- 触るファイル: `src/core/schema.js` `src/core/nfr.js` `test/schema.test.mjs`
- やること: meeting 種別、question / request / requirement の項目、REF_FIELDS、非機能の表
- **完了条件:** 追加した項目の正しい値が通り、誤った値（meetingType の誤り、存在しない会議 ID、nfrCategory の誤り）が日本語のエラーになるテストが通る

## T3 変更の記録
- 触るファイル: `src/core/patch.js` `src/ui/store.js` `test/patch.test.mjs`
- やること: applyPatch が ChangeEntry を足す。2,000 件で切る
- **完了条件:** 追加・更新・状態の変化が記録され、2,001 件目で最古が消えるテストが通る

## T4 ボールと待ち日数
- 触るファイル: `src/core/ball.js` `src/core/health.js` `test/ball.test.mjs`
- やること: ballOf・waitDays・健康診断 ball-wait
- **完了条件:** 顧客 / 自社 / 協力会社 / 未定のそれぞれ、待ち日数の起点（askedAt あり・なし）、7 日の境界をテストで確かめる

## T5 ヒヤリングの候補・スコープの差・健康診断の追加
- 触るファイル: `src/core/hearing.js` `src/core/health.js` `test/hearing.test.mjs`
- やること: hearingCandidates・baselineDiff・nfr-missing / scope-no-reason / scope-undecided
- **完了条件:** 各候補の種類と、差の3種（追加・範囲変更・取り下げ）、健康診断の3種が、該当で検出・非該当で0件になるテストが通る

## T6 指示文
- 触るファイル: `src/core/prompts.js` `test/prompts.test.mjs`
- やること: 目的「ヒヤリング質問の生成」「非機能の洗い出し」、会議つきの議事録、目的ごとの対象種別
- **完了条件:** 会議つき議事録に会議の出席者・シートの質問 ID が入る。非機能の指示文に 6 大項目すべてと確認点が入る。対象種別を絞った目的（ヒヤリング質問の生成・非機能の洗い出し）では、対象外の種別の ID が入らない。ヒヤリング質問の生成の指示文に、未回答の質問と健康診断の空欄の項目が入る（AC-06）

## T7 画面の分類と画面の骨組み
- 触るファイル: `src/app.js` `src/styles.css` `build.mjs`
- やること: 2段の切り替え。P1 の画面を分類に入れる。新しい画面4つの入口
- **完了条件:** ブラウザで、全分類と全画面に行き来でき、URL の # で直接開ける。P1 の画面がすべて今までどおり動く

## T8 ヒヤリング画面
- 触るファイル: `src/ui/views/hearing.js` `src/ui/store.js`
- やること: 会議の選択、シート、候補と割り当て、その場での回答入力
- **完了条件:** ブラウザで、候補を会議に割り当て → 回答を入力 → 質問が回答済みになり、取り消しで戻る。割り当てた空欄・非機能の候補は候補から消える。会議を選んだ議事録の指示文に、その会議の質問 ID が入る

## T9 課題と質問の画面
- 触るファイル: `src/ui/views/issues.js`
- やること: ボールごとの件数と一覧（待ち日数の長い順）
- **完了条件:** サンプル台帳で、4つの分け方の件数の合計が未完了の課題・質問の数と一致し、並び順が待ち日数の降順になる

## T10 非機能・スコープの画面と詳細パネル
- 触るファイル: `src/ui/views/nfr.js` `src/ui/views/scope.js` `src/ui/detail.js` `src/ui/views/list.js`
- やること: 大項目の表、ベースラインの記録と差、範囲の変更、一覧の「ベースライン後」
- **完了条件:** ブラウザで、ベースラインを記録 → 要望を1件取り込む → スコープ画面と一覧に「ベースライン後」と出る。範囲を「範囲外」にして理由が空なら健康診断に出る

## T11 README
- 触るファイル: `README.md`
- やること: P2 の使い方を追記
- **完了条件:** README に P2 の4画面と設定の使い方がある。サンプルを読み込むと P2 の4画面がすべて埋まる

## T12 通しの確認
- 触るファイル: なし（不具合があれば該当ファイル）
- やること: 受入条件を1つずつ確かめて表にする
- **完了条件:** AC-C1〜C4・AC-01〜21 の結果表ができ、未達は理由つきで残る
