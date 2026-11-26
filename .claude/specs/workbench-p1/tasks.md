# 案件ワークベンチ P1 — タスク

上から順に行う。各タスクの完了条件を満たしてから次へ進む。

## T1 プロジェクトの土台
- 触るファイル: `.claude/CLAUDE.md` `package.json` `.gitignore` `build.mjs` `src/shell.html` `src/styles.css` `src/app.js`
- やること: static-zero テンプレから CLAUDE.md を作る。その際、制約2（静的 SVG）は「図は実行時に SVG を描く。台帳が実行時に変わるため」に、制約4（ホスティング）は「GitHub Pages は配布にだけ使う。実行時の通信はしない」に書き換える。`build.mjs` は data/ からの生成ではなく、src の連結・import と export の除去・名前の衝突の検出・CSP ハッシュの埋め込みを行う。shell.html に `<link rel="icon" href="data:,">` を入れる
- **完了条件:** `node build.mjs` で `index.html` ができる。簡易サーバー経由で Playwright で開くと「案件ワークベンチ」の見出しとタブが出て、コンソールに CSP 違反が出ない。2つのファイルで同じトップレベルの名前を定義するとビルドが失敗する

## T2 schema.js（種別定義と検証）
- 触るファイル: `src/core/schema.js` `test/schema.test.mjs`
- やること: KINDS 表・列挙値・`validateItem`・`validateLedger`・`emptyLedger`
- **完了条件:** `node --test` で、正しい項目が通り、使えない kind・status・日付形式・ID 形式がそれぞれ日本語のエラーになるテストが通る

## T3 extract.js（寛容なパーサ）
- 触るファイル: `src/core/extract.js` `test/extract.test.mjs` `samples/broken-*.txt`
- やること: 囲み記号・前後の文章・末尾のカンマ・全角の引用符・配列だけの返答への対応
- **完了条件:** samples の5種類（囲みあり / 前後に説明文 / 末尾カンマ / 全角引用符 / 配列のみ）が読め、読めない文字列では位置つきのエラーになるテストが通る

## T4 patch.js（差分の検証・適用）
- 触るファイル: `src/core/patch.js` `test/patch.test.mjs` `samples/sample-patch.json` `samples/sample-ledger.json`
- やること: `validatePatch`・`planPatch`・`applyPatch`。採番・tempId の置き換え・参照フィールド表に従う後始末・supersedes の自動更新・revision の更新。ダミーのサンプル台帳（関係者10・システム4・関係12・各種別の項目）もここで作る
- **完了条件:** テストで次が通る。(1) add の採番が既存と重複しない (2) tempId が本 ID に置き換わる (3) 却下した add を参照する links の要素・owner・relate がそれぞれ表どおりに外れ／自動却下され、警告が出る (4) 存在しない ID への update と参照がエラーになる (5) 元の台帳オブジェクトが変わっていない (6) id・kind の update がエラーになる (7) supersedes つきの決定を足すと古い決定が superseded になる (8) 誤りのある操作が混ざっても、正しい操作だけ適用できる (9) sample-ledger.json が validateLedger を通る

## T5 health.js（健康診断）
- 触るファイル: `src/core/health.js` `test/health.test.mjs`
- やること: AC-20 の7種の検出。`today` を引数で受け取る
- **完了条件:** 7種それぞれ、該当する台帳で1件検出され、該当しない台帳で0件になるテストが通る

## T6 prompts.js と starter.js
- 触るファイル: `src/core/prompts.js` `src/core/starter.js` `test/prompts.test.mjs`
- やること: 目的10種の指示文と修正依頼文。業務システム新規の型（ヒヤリング質問15件以上・典型的な制約の確認項目）
- **完了条件:** 各指示文に KINDS 表の全 kind、台帳の全 ID、資料を貼る位置の目印が入っていることをテストで確かめる。NotebookLM 用には「JSON」の出力指定が入っていない。starter を適用した台帳が `validateLedger` を通る

## T7 store と共通部品
- 触るファイル: `src/ui/dom.js` `src/ui/store.js`
- やること: `h()`（textContent のみ）、状態・購読、localStorage 保存、1段の取り消し、未書き出しの印、書き出しと読み込み、コピー
- **完了条件:** Playwright の `browser_evaluate` で store を直接呼んで確かめる。sample-patch を apply → 再読み込み → 台帳が残っている。undo で適用前に戻る。書き出し用の文字列を作り、それを読み込み処理に渡すと同じ台帳になる。壊れた JSON を読み込み処理に渡すと台帳が変わらない

## T8 取込画面と指示文画面
- 触るファイル: `src/ui/views/import.js` `src/ui/views/prompts.js`
- やること: 貼り付け → カード表示（変更前→変更後）→ 採用/却下 → 適用。誤りの表示と修正依頼文のコピー。指示文の目的の選択とコピー
- **完了条件:** sample-patch を貼ると全カードが出て、2枚を却下して適用すると残りだけ台帳に入る。壊れた差分ではエラーが出て「適用」で台帳が変わらない

## T9 一覧・詳細パネル・決定ログ
- 触るファイル: `src/ui/views/list.js` `src/ui/detail.js` `src/ui/views/decisions.js`
- やること: 絞り込みと並べ替えのある一覧、逆参照つきの詳細パネル、確認済み・状態の変更、決定ログ
- **完了条件:** 種別「課題」と文字列で絞り込める。詳細パネルにリンク元が出て、ID を押すと移る。「確認済みにする」が反映され、取り消せる

## T10 関係図・概要・健康診断の画面
- 触るファイル: `src/ui/views/graph.js` `src/ui/views/overview.js` `src/ui/views/health.js`
- やること: 列レイアウトの SVG 関係図と強調表示、概要カード、健康診断の一覧
- **完了条件:** サンプル台帳（関係者10・システム4・関係12）で、14ノードが出てノードどうしの矩形が重ならない（`browser_evaluate` で getBBox を比べて確かめる）。ラベルは重なりを避けるルールどおりに置かれ、省略されたものは件数がわかる。ノードを押すと隣接以外が薄くなり、詳細パネルが開く。概要に上位5件が健康診断と同じ順で出る

## T11 設定画面・配布・サンプル・README
- 触るファイル: `src/ui/views/settings.js` `samples/sample-ledger.json` `README.md`
- やること: 新規案件（型を選ぶ）・読み込み・書き出し・HTMLのダウンロード（http(s) のときだけ表示）。会社PCでの使い方と Gem の作り方
- **完了条件:** 新規案件で型を選ぶと質問15件以上の台帳ができ、既存の台帳があるときは置き換え前に確認が出る。サンプル台帳を読み込むと全画面が埋まる。壊れたファイルを読み込むと理由が出て台帳が変わらない

## T12 通しの確認
- 触るファイル: なし（不具合があれば該当ファイル）
- やること: 簡易サーバーと Playwright で全画面を操作し、ネットワーク記録を確認する（Playwright は file:// を開けない）。AC-24（file://）は claude-in-chrome で開いて確かめる。拡張がつながらなければ、ユーザーが確かめる項目として結果表に残す
- **完了条件:** 受入条件 AC-01〜AC-26 を1つずつ確かめ、結果を表にする。ネットワーク記録に index.html 以外の要求が無い（favicon を含む）
