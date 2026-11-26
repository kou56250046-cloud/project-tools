# 案件ワークベンチ P6b 資料の変換 — タスク

## T1 zip と xlsx・表の下ごしらえ（写す）
- 触るファイル: `src/core/zip.js` `src/core/xlsx.js` `src/core/tableprep.js` `build.mjs` `package.json`（engines だけ） `tools/make-convert-samples.mjs` `test/fixtures/convert/` `test/convert.test.mjs`
- やること: gemini-kit から写して ES module にし、名前を付け替える。ダミーを作るスクリプトを書く
- **完了条件:** テストで次を確かめる
  - 圧縮した xlsx と無圧縮の xlsx を同じ表に読める
  - 日付の書式・共有文字列・空のシートを読める
  - .xls（古い形式）・zip でないファイルを理由つきで断る
  - zip に書いて読み戻すと中身が同じ
  - 表の下ごしらえの一式に、項目定義書・集計・サンプル・データがあり、データの分割に抜けも重なりも無い。1 ファイルにまとめる・まとめないの両方
  - `__proto__`・`constructor` のキーを含む JSON を読んでもプロトタイプが変わらない
  - ビルドで名前の衝突が無い

## T2 docx・pptx・html・csv・json の md 化と形式の判定
- 触るファイル: `src/core/convert.js` `test/convert.test.mjs`（ダミーを足す）
- やること: design.md の md 化の決まり
- **完了条件:** テストで次を確かめる
  - docx
    - 見出しの判定（日本語・英語・大文字小文字の違うスタイル名、basedOn の社内スタイル、outlineLvl、番号つきの見出し）
    - 箇条書き（段落とスタイルの numPr、numId=0、①などの番号）と表
    - 結合セル（gridSpan・vMerge）、表の中の表、テキストボックス（Choice と Fallback で二重にならない）、図の印
  - pptx
    - スライドの並び順（ファイル名の番号順ではない）、非表示のスライド
    - グループの中の図形、タイトルが本文に出ないこと、段の深さ
    - 表（結合あり）、ノート（番号の placeholder を含まない。`../` の rels）
  - html
    - 見出し・段落・入れ子の箇条書き・表（rowspan・colspan、セルの中の改行）・リンク・pre・img・文字参照
    - 閉じタグを省略した p・li・td・tr、tbody なし
    - script・style が消える
  - CSV（Shift_JIS）・TSV（UTF-16 の BOM つき）・JSON（キーが 2 つ）が md の表になる。.md・.txt はそのまま通る
  - 形式の判定が design.md の表のとおり（順番どおり。拡張子と中身が食い違う場合、CFB・ただの zip・.mht を断る理由、30MB）
  - 頭書きに、ファイル名・日付・方式と、design.md の表どおりの数が入る

## T3 PDF・画像の指示文と点検
- 触るファイル: `src/core/gemini-convert.js` `test/convert.test.mjs`
- やること: conversionPrompt・inspectMarkdown・pdfPageCount
- **完了条件:** テストで次を確かめる
  - 指示文に 5 つの確認の選択肢と「要約しない」が入る
  - 点検で、囲みつきで 2 回に分かれた返事をつなげても、抜けたページの番号・表（`| --- |`・`|:---|` の形も）・見出し・[読めない] の数が正しい。印が無い返事ではページを点検しない
  - pdfPageCount がダミーの PDF（/Count あり・増分で保存してページが二重のもの）で正しいページ数を返し、読めないときは null

## T4 画面
- 触るファイル: `src/ui/views/convert.js` `src/core/screens.js` `src/app.js` `src/ui/store.js`（lock の通知） `src/styles.css` `src/core/guide-text.js`
- やること: 資料の変換の画面、使い方の更新
- **完了条件:**
  - ブラウザで、ダミーの xlsx・docx・pptx・html・csv・pdf を一度に選び、それぞれのカードに結果か指示文が出る
  - md の保存・コピー・全部を zip で保存・NotebookLM 用の一式の保存ができる
  - 断ったファイルに理由が出る
  - ロックすると結果が消え、退避を捨てる・合言葉を変えるなどの操作では消えない（store の lock の通知だけで消す）
  - 台帳が無くても開ける。説明用の表示では出ない
  - test/guide.test.mjs（画面の説明）が通る
