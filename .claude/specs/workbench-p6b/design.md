# 案件ワークベンチ P6b 資料の変換 — 設計

## ファイルの構成（src/core。すべて DOM に触れない）
| ファイル | 中身 | 元 |
|---|---|---|
| `core/zip.js` | zip の読み取り（中央ディレクトリ → 名前と中身。無圧縮と deflate を DecompressionStream('deflate-raw') で展開）と書き出し（無圧縮・crc32） | gemini-kit `xlsx.js` の entries/inflate と `pptx.js` の zip/crc32 を写して ES module にする |
| `core/xlsx.js` | xlsx → `[{ name, rows: string[][] }]` | gemini-kit `xlsx.js`（sheets・isDateCode・serialToDate・colIndex）。`dec` → `xlsxDecoder` などに付け替え |
| `core/tableprep.js` | 表 → NotebookLM 用の一式 `[{ name, data }]` | gemini-kit `tableprep.js`。`num` → `prepNum`、`TOP` → `PREP_TOP`。区切りの読み取りは csv.js の parseDelimited を使う。文言の「gemini-kit」は「案件ワークベンチ」に直す |
| `core/convert.js` | 形式の判定と、形式ごとの md 化（xlsx・csv・json・docx・pptx・html）・出典の頭書き・表の md 化 | 新規（docx・pptx・html は自作） |
| `core/gemini-convert.js` | PDF・画像の変換の指示文と、返ってきた md の点検 | 新規 |

画面は `src/ui/views/convert.js`（新規）。screens.js に `{ id: 'convert', group: 'tools', label: '資料の変換' }` を足し、NO_LEDGER_OK（台帳が無くても開ける画面）に入れる。説明用の表示では「道具」と同じく隠す。

## 形式の判定（convert.js の detectKind(name, bytes)）
| 判定 | 形式 |
|---|---|
| 先頭が `PK\x03\x04` で、中に `xl/workbook.xml` | xlsx |
| 同じく `word/document.xml` | docx |
| 同じく `ppt/presentation.xml` | pptx |
| 先頭が `%PDF-` | pdf |
| 先頭が PNG・JPEG の印 | image |
| 先頭が `D0 CF 11 E0`（古い Office） | 断る（.xls・.doc・.ppt は保存し直してもらう） |
| 拡張子が html・htm、または文字列の先頭（空白を除く）が `<!doctype html` か `<html` | html |
| 拡張子が json、または先頭が `[` か `{` で JSON として読める | json |
| 拡張子が csv・tsv・txt で区切りが読める | csv |
| それ以外 | 断る（理由つき） |
- 文字列の形式は csv.js の decodeBytes（UTF-8 → Shift_JIS）で読む
- 30MB を超えるファイルは読まずに断る

## md 化の決まり
共通:
- 頭書き（AC-04）:
  ```
  <!-- 出典: 元のファイル名 / 変換: YYYY-MM-DD / 方式: 案件ワークベンチ（ブラウザの中で変換） / シート 3・行 1,200 -->
  # 元のファイル名（拡張子なし）
  ```
- 表の md: 1 行目を見出しにする。セルの `|` は `\|`、改行は `<br>`。空の列は残す。行の長さは最長の行にそろえる
- 文字の整え: 連続する空行は 1 つ。前後の空白を落とす

xlsx・csv・json:
- シートごとに `## シート名` と表。空のシートは「（空のシート）」
- json はオブジェクトの配列を表にする（入れ子のキーは `a.b` でつなぐ。gemini-kit の fromJSON と同じ）

docx（`word/document.xml` を読む。`word/styles.xml` で見出しのスタイル名を引く）:
- 段落 `w:p` の文字 `w:t`（`w:tab` は空白、`w:br` は改行）
- 見出し: スタイル名が「heading N」「見出し N」「Title」「タイトル」→ `#` の数（Title は 1）。スタイル ID ではなく styles.xml の名前で判定する
- 箇条書き: `w:numPr` がある段落。段の深さは `w:ilvl`。番号の種類は `word/numbering.xml` の numFmt（decimal 系は `1.`、それ以外は `-`）
- 表 `w:tbl`: 行 `w:tr`・セル `w:tc` の中の段落を空白でつないで md の表
- 図 `w:drawing`・`w:pict`: `[図]`
- 本文の順は document.xml の順

pptx（`ppt/presentation.xml` の `p:sldIdLst` の順に、`ppt/_rels/presentation.xml.rels` でスライドのファイルを引く）:
- `## スライド N: タイトル`（タイトルは `p:ph` の type が title・ctrTitle の図形の文字。無ければ「（タイトルなし）」）
- 本文の図形の段落 `a:p` を `-` で。段の深さは `a:pPr` の lvl（0 起点）
- 表 `a:tbl`: md の表
- 図 `p:pic`: `[図]`
- ノート: スライドの rels から notesSlide を引き、本文の段落を `> ノート: …`

html（DOMParser を使わない小さな読み取り。タグを順に読む）:
- 捨てる: `<script>` `<style>` `<head>` `<noscript>` `<template>` とコメント
- `h1`〜`h6` → `#`〜`######`、`p`・`div`・`section` などの段落の終わりで改行、`br` → 改行
- `ul`・`ol` の `li` → `-` と `1.`（入れ子は 2 字ずつ下げる）
- `table`: `tr` ごとに `th`・`td` を md の表
- `a`: `[文字](href)`（href が `javascript:` のときは文字だけ）
- `pre`: ``` で囲む
- 文字参照: 名前つきの主なもの（amp・lt・gt・quot・apos・nbsp・copy など）と数値の参照を戻す

表の下ごしらえ（AC-10）:
- gemini-kit の bundle と同じ（00 項目定義書・01 集計・代表サンプル・10 データの分割）。保存は zip（core/zip.js の書き出し）
- 画面で選べるもの: まとめる列（集計の軸）・データの形式（md / json / csv）・分ける行数（既定 500）

## PDF・画像（gemini-convert.js）
```js
export function conversionPrompt({ fileName, kind, pages }) → string
export function inspectMarkdown(md, { pages }) → { pageMarks, pagesExpected, missing: [ページ番号], tables, headings, unreadable }
export function pdfPageCount(bytes) → number | null   // /Type /Page の数を数える（暗号化・圧縮されたオブジェクトの中は数えられないので null もある）
```
- 指示文の中身:
  1. 役割: 資料を一字一句そのまま Markdown に書き写す係。要約・言い換え・補足をしない
  2. 最初の返事では書き写さず、次の 5 つを選択肢つきで聞く（番号で答えられる形）:
     - 表: md の表にする / 箇条書きにする
     - 図・写真: 説明を `[図: …]` で書く / `[図]` の印だけ
     - 見出し: 文字の大きさから段を推定する / 見出しを付けない
     - ページの区切り: `<!-- p.N -->` を入れる / 入れない
     - 読めない文字: `[読めない]` と書く / 前後から推定して `[推定: …]` と書く
  3. 答えを受けたら、全ページを順に書き写す。途中で止めたら「続き」と言われてから続ける
  4. 出力の形: ```markdown の囲みの中に本文だけ
- 点検: ページの区切りの印 `<!-- p.N -->` を数え、1〜ページ数のうち無い番号を出す。表（`|---` の行）・見出し（`#`）・`[読めない]` を数える
- 点検の画面: ページ数（PDF なら pdfPageCount の値を初期値。画像は 1）を入れて、返事を貼る。結果を出し、「md を保存」で頭書きを付けて保存（方式: Gemini）

## 画面（ui/views/convert.js）
- 上: ファイルを選ぶ（multiple）とドロップの枠
- ファイルごとのカード: 形式・大きさ・結果（シート数・スライド数・表の数・文字数）、md の先頭 200 行（`pre`、textContent）、ボタン「md を保存」「コピー」、表の形式なら「NotebookLM 用の一式」（まとめる列・形式・行数を選んで zip で保存）、PDF・画像なら「変換の指示文をコピー」と点検の欄
- 「全部を zip で保存」: 変換できた md をまとめて zip に
- 断ったファイルは、カードに理由を出す
- 結果はこの画面のモジュールの中にだけ持つ（画面を離れても残すが、ロックしたら消す。app の vault の通知で消す。master.js の clearMasterState と同じやり方）

## 触るファイル
| ファイル | 変更内容 |
|---|---|
| `src/core/zip.js`（新規） | zip の読み書き |
| `src/core/xlsx.js`（新規） | xlsx の読み取り |
| `src/core/tableprep.js`（新規） | 表の下ごしらえ |
| `src/core/convert.js`（新規） | 判定と md 化 |
| `src/core/gemini-convert.js`（新規） | PDF・画像の指示文と点検 |
| `src/ui/views/convert.js`（新規） | 画面 |
| `src/core/screens.js` | convert を足す |
| `src/core/guide-text.js` | 画面の説明・FLOW_STEPS の digest の手順に資料の変換・よくある困りごと |
| `src/app.js` | RENDERERS に convert、ロックで結果を消す |
| `src/styles.css` | カードの並び（色は変数） |
| `build.mjs` | JS_FILES |
| `tools/make-convert-samples.mjs`（新規） | テスト用のダミー（xlsx・docx・pptx・html・pdf の先頭）を node:zlib で作る |
| `test/fixtures/convert/`（新規） | 上のスクリプトで作ったダミー。実案件のデータは入れない |
| `test/convert.test.mjs`（新規） | 形式ごとの md・判定・断る理由・表の下ごしらえ・zip の往復・点検 |

## 検討した代替案
| 案 | 採らなかった理由 |
|---|---|
| HTML を DOMParser で読む | node --test に DOMParser が無く、core で試せない。資料の HTML は単純なものが多いので、タグを順に読む作りで足りる |
| PDF の文字をブラウザで取り出す | 圧縮・フォントの対応表（CMap）・日本語の扱いが要り、依存ゼロでは正確にできない（非目標） |
| 変換した md を台帳に保存する | 資料はサイズが大きく、localStorage の 5MB に収まらない。台帳は差分で育てる方針 |
| 表は md の表だけにする | NotebookLM は大きな表の集計を間違えやすい。gemini-kit の一式（集計を先に計算して渡す）の方が正確 |

## レビューを受けて決めたこと（上の本文と食い違うときは、こちらが正）

### JSON の読み方（指摘 1）
- JSON はすべて extract.js の `safeParse` で読む（gemini-kit の fromJSON の JSON.parse は使わない）。入れ子のキーをつなぐ処理も、プロトタイプを持たない辞書に入れる
- テスト: `__proto__`・`constructor` のキーを含む JSON を読んでも `Object.prototype` が変わらない

### 形式の判定（指摘 2・10）。上から順に当てはめ、最初に当たったものにする。中身を拡張子より優先する
| 順 | 判定 | 結果 |
|---|---|---|
| 1 | 30MB を超える | 断る「30MB を超えるファイルは読めません」 |
| 2 | 先頭が `D0 CF 11 E0` | 断る「古い形式（.xls・.doc・.ppt）か、パスワード・秘密度ラベルで暗号化されたファイルです。古い形式なら新しい形式で保存し直してください。暗号化されたものは、暗号化を外せる場合だけ読めます」 |
| 3 | 先頭が `PK\x03\x04` | 中に `xl/workbook.xml` → xlsx、`word/document.xml` → docx、`ppt/presentation.xml` → pptx。どれも無い → 断る「対応していない zip 形式です（.xlsb・.vsdx・ただの zip など）」 |
| 4 | 先頭が `%PDF-` | pdf |
| 5 | 先頭が PNG・JPEG・GIF・BMP・WebP の印 | image |
| 6 | 文字として読む（UTF-8 の BOM・UTF-16 LE/BE の BOM を見て TextDecoder で読む。BOM が無ければ decodeBytes の UTF-8 → Shift_JIS） | 次の 7〜10 へ |
| 7 | 空白を除く先頭が `<!doctype html` か `<html`、または拡張子が html・htm | html |
| 8 | 拡張子が json、または先頭が `[` か `{` | safeParse で読めれば json。拡張子が json で読めなければ断る「JSON として読めません」。拡張子が json でなく読めなければ 9 へ |
| 9 | 空でない先頭 20 行のうち 2 行以上あり、区切り（タブ、無ければコンマ）を 1 つ以上含む行が 8 割以上で、その行どうしの区切りの数が同じ行が 8 割以上 | csv（タブなら tsv） |
| 10 | 拡張子が md・txt、または上のどれにも当たらない文字 | text（そのまま通す。頭書きだけ付ける） |
- .mht・.mhtml は 7 に当たらず text になるが、中身が MIME のまま出るので、拡張子が mht・mhtml なら断る「Web ページ（単一ファイル）形式は読めません。HTML で保存し直してください」

### 入れ子の決まり（指摘 3）
- docx
  - テキストボックス（`w:txbxContent`）の段落は、それを持つ段落の後ろに本文として出す
  - `mc:AlternateContent` は `mc:Choice` だけを読み、`mc:Fallback` は捨てる（同じ文字が 2 回出るのを防ぐ）
  - `w:sdt`（目次などの入れ物）の中の段落は本文として出す
  - 表のセルの段落は表にだけ出す（本文には出さない）。セルの中の段落の区切りは `<br>`
  - 表の中の表は、外の表のセルの中の文字として平らにする（行は `<br>`、セルは ` / ` でつなぐ）
- pptx
  - グループ（`p:grpSp`）は中を順にたどる
  - `p:graphicFrame` の表は表としてだけ出す（本文の `-` には出さない）。表でない graphicFrame（SmartArt・グラフ）は `[図]`
  - タイトルの図形は見出しにだけ使い、本文の `-` に出さない
- html（閉じタグの省略に対応する）
  - `p` は、次の塊の要素（p・div・ul・ol・table・h1〜h6・pre・blockquote・section・article・header・footer・hr）の開きタグか、親の閉じタグで閉じたとみなす
  - `li` は次の `li` か、`ul`・`ol` の閉じタグで閉じたとみなす。箇条書きの深さは開いている `ul`・`ol` の数で決める
  - `td`・`th` は次の `td`・`th`・`tr` か、`table` の閉じタグで、`tr` は次の `tr` か `table` の閉じタグで閉じたとみなす。`tbody`・`thead` は無くてもよい
  - セルの中の改行（`br`・`p`・`div`・`li` の区切り）は `<br>`。表の中の表は docx と同じく平らにする
  - `img` は `[図]`（alt があれば `[図: alt]`）（確認事項 106）

### 結合セル（指摘 4）
- docx: `w:gridSpan` の数だけ空のセルを足す。`w:vMerge`（restart 以外）は空のセル
- pptx: `a:tc` の gridSpan・hMerge・vMerge を docx と同じに扱う
- html: `colspan` は右に、`rowspan` は下の行の同じ列に、空のセルを入れて列の位置を保つ
- xlsx: 結合の範囲の左上以外は空（AC-05 のとおり）

### Word の見出しと箇条書き（指摘 5・確認事項 102）
- 見出しの判定は、次の順で最初に決まったもの
  1. 段落のスタイル名（大文字・小文字を区別しない）が `heading N`・`見出し N` → N、`title`・`タイトル` → 1
  2. スタイルの `w:basedOn` をたどり（10 段まで）、1 と同じ名前に当たれば その N
  3. `w:outlineLvl`（段落の pPr、無ければスタイルの側）の値 0〜5 → 1〜6
- 見出しは頭書きの `#`（ファイル名）の下にするため 1 段下げて出す（見出し 1 → `##`）。6 段より深いものは `######`
- 箇条書き: `w:numPr` を段落から、無ければスタイル（basedOn をたどる）から引く。`numId` が 0 なら箇条書きにしない。見出しと判定した段落は箇条書きにしない
- `1.` にする numFmt: decimal・decimalZero・decimalFullWidth・decimalHalfWidth・decimalEnclosedCircle・decimalEnclosedParen・decimalEnclosedFullstop・upperLetter・lowerLetter・upperRoman・lowerRoman・aiueo・aiueoFullWidth・iroha・irohaFullWidth・japaneseCounting・ideographDigital・chineseCounting。それ以外（bullet・none など）は `-`

### PowerPoint のノートと関係ファイル（指摘 6）
- ノートは、placeholder の type が body の図形の段落だけを読む（スライドの縮小図・番号は読まない）
- rels の Target は、その rels が属するファイルのフォルダからの相対パスとして `../` と `./` を解決する（xlsx の読み取りも同じ関数を使う）
- 非表示のスライド（`show="0"`）も出し、見出しに「（非表示）」を付ける

### 点検（指摘 7・確認事項 104）
- 貼った文から ```markdown・``` の囲みの行をすべて外す（何回分の返事をつなげて貼ってもよい）
- ページの区切りの印が 1 つも無ければ、ページの抜けは点検せず「ページの区切りの印がありません（印を入れない答えにした場合は点検しません）」と出す
- 表の数は、区切りの行（正規表現 `^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$`）の数
- 見出しは、行頭の `#`〜`######` と空白で始まる行
- pdfPageCount: ルートの `/Type /Pages` の中で最大の `/Count` を使う。見つからなければ `/Type /Page`（`/Pages` を除く）の数。どちらも無ければ null。画面の初期値は人が直せる

### 数える項目と書き方（指摘 8）
| 形式 | 頭書きの数 |
|---|---|
| xlsx | シート N・行 N（全シートの合計） |
| csv・tsv | 行 N・列 N |
| json | 表 N・行 N |
| docx | 見出し N・表 N・段落 N |
| pptx | スライド N（うち非表示 N）・表 N |
| html | 見出し N・表 N |
| text | 行 N |
| Gemini の返事 | ページ N（入力した数）・見出し N・表 N |
- 段の下げ幅は、どの形式も 1 段につき空白 2 字
- 戻す文字参照: amp・lt・gt・quot・apos・nbsp（空白にする）・copy・reg・trade・hellip・mdash・ndash・laquo・raquo・yen・times・divide・middot・bull と、`&#N;`・`&#xH;`。それ以外の名前はそのまま残す
- xlsx の日付: 日付だけなら YYYY-MM-DD、時刻もあれば YYYY-MM-DD HH:MM、時刻だけなら HH:MM（gemini-kit の serialToDate と同じ）

### 表を選ぶ（指摘 9）
- md 化: xlsx は全シート、json は配列を持つキーごとに `## キー名` の表（最上位が配列なら 1 つ）
- 表の下ごしらえ: シート（xlsx）か配列のキー（json）を 1 つ選ぶ。まとめる列・データの形式・分ける行数・「1 ファイルにまとめる」・「JSON の拡張子を .txt にする」を選べる。既定値は gemini-kit の画面と同じ

### 結果を消すとき（確認事項 101）
- ロックしたとき（store.lock）だけ消す。store に `emit('lock')` を足し、資料の変換の画面はそれを聞く。store.js を触るファイルに足す
- 画面を離れても消さない（何度も見返すため）。マスタ点検の「離れたら消す」とは違う扱いにする
- 合言葉をまだ決めていない状態・ブラウザに保存しない状態では、再読み込みまで残る

### テストの動く条件（確認事項 103）
- zip の展開は DecompressionStream('deflate-raw') を使う。Node 22 以上で動く（調査で Node v24.12 で動くことを確かめた）。package.json に `"engines": { "node": ">=22" }` を足す（依存ではない）

### 全部を zip で保存（確認事項 105）
- 入れるもの: ブラウザの中で変換した md と、点検した Gemini の md。表の下ごしらえの一式は入れない（それぞれの zip で保存する）
- ファイル名が重なったら ` (2)` を付ける
