# 案件ワークベンチ P6c — タスク

## T1 前処理とチャットの読み取り
- 触るファイル: `src/core/transcript.js` `src/core/chat.js` `build.mjs` `test/transcript.test.mjs` `test/chat.test.mjs` `test/fixtures/minutes/` `test/fixtures/chat/`
- やること: clean.js を写す。parseChat を書く
- **完了条件:** テストで次を確かめる
  - 前処理: 5 つの形式と Shift_JIS のダミーが 1 行 1 発言になり、割合が 0.8 以上で、つなぎ言葉が残らない
  - チャット: design.md の例の表の 5 つの入力が、期待する lines・dropped・format になる
  - 「今日」「昨日」・年の無い日付・12 月から 1 月をまたぐ日付が today から正しく決まる。午前・午後が 24 時間になる
  - 「話者:本文」の形でないチャットの本文の「注意：…」が発言の始まりにならない
  - 1 行 1 発言の本文から lines に分け直す決まり（空白のある名前・日時・時刻なし・本文の中の ｜）

## T2 種別 memo（版は 2 のまま）
- 触るファイル: `src/core/schema.js` `src/core/patch.js` `src/core/impact.js` `src/core/health.js` `src/core/prompts.js` `test/memo.test.mjs`
- やること: memo・LEDGER_KINDS・上限・remove の操作・visibleLedger・design.md の表の各所から外す
- **完了条件:** テストで次を確かめる
  - memo の add（ローカルの操作）が通り、50,000 字を超える本文は誤りになる。remove で消え、取り消しで戻り、メモを指す links が外れる
  - Gemini の差分（validatePatch）で memo の add・update・relate が誤りになる
  - 指示文の種別の説明・台帳の一覧・NotebookLM の指示文・変更の影響（変更要求書）・健康診断の項目ごとの点検・gemini-kit 用カルテ・ダッシュボード・使い方の進み具合・説明用の表示に memo が出ない
  - 存在しない ID への参照の点検は memo の links も見る
  - 前のツールの検査（版 2）で、memo を持つ台帳は誤りになり、持たない台帳は通る
  - 既存のテストが全部通る（版・サンプルは変えない）

## T3 メモの画面と指示文
- 触るファイル: `src/ui/views/memos.js` `src/ui/views/prompts.js` `src/ui/views/list.js` `src/ui/views/overview.js` `src/ui/views/settings.js`（メモの合計） `src/core/screens.js` `src/app.js` `.gitignore`
- やること: 貼り付けからのメモ作成・一覧・書き出し・メモからの取込
- **完了条件:**
  - ブラウザで、ダミーのチャットを貼ってメモにし、取り消しで消せる
  - 2 つのメモを選んで JSON と md で書き出し、JSON が design.md の形になる
  - メモからの取込の指示文に、選んだメモの本文が入る
  - 一覧・概要の件数にメモが出ない
  - メモを消せ、取り消しで戻る。合計が 300,000 字を超えると警告が出る
  - メモからの取込の指示文で、選んだメモの合計が 60,000 字を超えると作らずに理由が出る

## T4 前処理とマスキングの画面
- 触るファイル: `src/core/mask.js` `src/ui/views/preprocess.js` `src/ui/views/mask.js` `src/core/screens.js` `src/app.js` `src/styles.css` `src/core/guide-text.js` `test/mask.test.mjs`
- やること: mask.js を写す。2 つの画面。使い方の更新
- **完了条件:**
  - テスト（gemini-kit の 5 件と同じ中身）:
    - 規則の推定（10 列）
    - 同じ値に同じ仮名
    - 文中の置き換えと警告
    - 基準日が 1 つ
    - 引用符・改行・タブ入りのセル
  - ブラウザで、前処理の結果を保存・メモにでき（複数のファイル・50,000 字を超えるときの分割・台帳が無いとき押せない）、ロックで消える
  - ブラウザで、マスキングの列の伏せ方を変えて保存し、対応表を保存・空にできる。CSV のファイルと貼り付けで同じ結果になる。style 属性が無い
  - P6b の実装の後に行う（xlsx の読み取りを使うため）
  - 説明用の表示で 3 つの画面が出ない
