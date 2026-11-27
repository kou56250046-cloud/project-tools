# P6d — 設計

## 図形 → フロー記法（src/core/shapeflow.js・新規）
- 入力（PPT・Excel 共通の形）: `{ shapes: [{ id, text, geom, x, y, w, h }], links: [{ from, to, x1, y1, x2, y2, head, tail }] }`
  - geom は prstGeom の名前（rect・diamond・flowChartDecision など）。座標は同じ単位（EMU か、Excel はセル番号×既定の幅）
  - links の from/to は stCxn・endCxn の id（無ければ null。端点から近い図形を探す）
  - head/tail は矢じりの有無（a:headEnd・a:tailEnd の type が none 以外）。tail だけなら from→to、head だけなら to→from、両方か無しなら from→to
- 出力: `{ notation, used: Set(図形 id), ok }`。図形どうしを結ぶ線が 2 本未満、図形が 60 を超える、parse の誤りがあれば ok=false（呼ぶ側は今の箇条書きのまま）
- 規則:
  - レーン: 文字を持ち、ほかの図形を 2 つ以上完全に囲む長方形。ノードは中心が入るレーンに属する。レーンは上→下（横長なら）、左→右（縦長なら）の順
  - ラベル: どの線にも結ばれない、文字が 12 字以下の図形で、線の中点に最も近く、距離が線の長さの半分以下のもの → その線のラベル。使ったら used に入れる
  - ノードの ID は N1, N2…（上から下、左から右の順）。ラベルの改行は空白に。`->`・`..>` は `→` に置き換える
  - 種類: diamond・flowChartDecision → decision。flowChartTerminator・ellipse・roundRect・flowChartAlternateProcess → 入りが無ければ start、出が無ければ end、どちらでもなければ task。flowChartDocument・flowChartMultidocument → doc。can・flowChartMagneticDisk・flowChartInputOutput・flowChartMagneticDrum → data。flowChartPredefinedProcess → sub。ほか task
  - title は呼ぶ側（スライドのタイトル・シート名）

## PPT（convert.js）
- pptShapes で、文字のある図形（placeholder のタイトル以外）とコネクタ（p:cxnSp）を、グループの座標変換（grpSpPr の off・ext と chOff・chExt）を通して集める
- shapeflow が ok なら、```flow を出し、used の図形の文字は箇条書きから外す
- SmartArt（graphicFrame の dgm:relIds）→ smartart.js

## Excel（xlsx.js・convert.js）
- xlsx.js の sheets が、各シートに `hidden`・`merges`（A1:B2 の配列）・`comments`（[{ ref, text }]）・`drawing`（図形と線の一覧）を返す
  - drawing: シートの rels → drawingN.xml。xdr:twoCellAnchor / oneCellAnchor の from（col・colOff・row・rowOff）を座標に（col × 64px・row × 20px＋オフセット）。xdr:sp（文字・形）と xdr:cxnSp（stCxn・endCxn）
  - comments: シートの rels → commentsN.xml の comment ref と text
- xlsxToMd: 見出しに（非表示）、結合セルは左上以外を空にし表の下に「結合: A1:C1」、コメントは「コメント: A1 …」、図形は ```flow か「図形の文字: …」

## SmartArt（src/core/smartart.js・新規）
- data*.xml の dgm:ptLst（type が doc・node、文字は dgm:t の a:t）と dgm:cxnLst（type parOf または無指定が親子。srcId=親・destId=子・srcOrd=順）→ 木
- レイアウト（layout*.xml の uniqueId か、data の dgm:prSet loTypeId）に process・cycle・chevron・arrow を含むときは、根の子を順につないだフロー記法
- それ以外は字下げの箇条書き

## HTML（convert.js htmlToMd）
- `<svg>` の中の `<text>`・`<tspan>` の文字を「[図の文字: a ／ b]」で出す
- `<pre class="flow-src">`（ツールが作った HTML）と `<pre class="flow">`（Gemini の HTML）は ```flow に戻す。`<pre class="mermaid">` は ```mermaid のまま

## Gemini 指示文（gemini-convert.js）
- `conversionPrompt({ fileName, kind, pages, target })`。target: 'md' | 'html'。kind: pdf・image・pptx・html・xlsx
- 問いの表: `convertQuestions(kind, target)`。共通（表・図・見出し・読めない文字）＋ kind（ページ／スライドの区切り、PPT はノート・非表示スライド、Excel はシートの扱い）＋フロー（md: ```flow で書く／文章、html: `<pre class="flow">` に書く／文章）＋ html だけ（目次の有無）
- `flowImagePrompt({ fileName })`: 画像のフロー → フロー記法。最初に問い（レーンの単位・区分 {AI}{ルール}{人}{外部} を付けるか・読めない文字）
- フローを書かせる指示文の末尾に `flowFormatText()`
- HTML の指示文: 1 枚の HTML、`<style>` は指示文に書いた最小の書式だけ、script・外部の読み込み・画像を書かない、```html の囲み

## ツールが組む HTML（src/core/mdhtml.js・新規）
- `mdToHtml(md, { title, flowSvg })`: flowSvg(notation) → SVG の文字列（画面側で renderFlowSvg と XMLSerializer。テストでは仮の関数）
- MDBLOCKS.parse のブロック → 見出し（目次の id 付き）・段落・表・箇条書き・引用・コード・```flow（図＋`<pre class="flow-src" hidden>`）
- 行内: **太字**・`コード`・[文字](URL は # と相対だけ。http は文字だけ残す)。すべてエスケープ
- 先頭に CSP: `default-src 'none'; style-src 'unsafe-inline'; img-src data:`。CSS は配色の変数を書いた固定の文字列

## Gemini の HTML の仕上げ（mdhtml.js の finishHtml）
- 正規表現で: `<script…>…</script>`・`<iframe|object|embed|link|meta http-equiv=refresh>` を外す、on 属性を外す、`href|src` が http・//・javascript: なら外す（href は # に）、`<pre class="flow">…</pre>` を図に置き換え、`<head>` の先頭に CSP の meta（すでにある CSP は外す）
- 戻り値 `{ html, removed: { scripts, handlers, urls, others }, flows }`

## 忠実さの点検（src/core/fidelity.js・新規）
- `fidelityCheck(sourceText, replyText)`: 両方から語を取り出す（HTML ならタグを外す）。語: 数値（桁区切りを外す）、英数字の 2 文字以上の語、漢字・カタカナの 2 文字以上の連なり
- 元にあって返事に無い語を一覧（出てきた順・重複なし・最大 100）。件数と割合
- 画面: Gemini の返事を点検するとき、同じファイルのツールの md があれば照合（PDF・画像は無いので出さない）

## 画面（src/ui/views/convert.js）
- ファイルのカード: 「Gemini で変換」欄に目的の選択（md にする／HTML にする／画像のフローをフロー記法に）と指示文のコピー。返事の欄。「点検する」で md・HTML を判定
- md の結果: 「HTML を保存（ツールで組む）」、```flow ごとの「業務フローとして台帳に足す」（現行・導入後の選択。案件が開いているときだけ）
- HTML の返事: 「仕上げて保存」、外した件数、忠実さの点検

## 触るファイル
| ファイル | 変更 |
|---|---|
| src/core/shapeflow.js・smartart.js・mdhtml.js・fidelity.js | 新規 |
| src/core/convert.js | PPT の図形と線・SmartArt・Excel の細部・HTML の svg とコード |
| src/core/xlsx.js | 非表示・結合・コメント・drawing |
| src/core/gemini-convert.js | 指示文と問いの表 |
| src/ui/flowsvg.js | flowSvgString（SVG の文字列） |
| src/ui/views/convert.js | 画面 |
| src/core/guide-text.js | 説明 |
| build.mjs | 新規ファイル |
| tools/make-convert-samples.mjs・test/*.test.mjs | ダミーとテスト |

## 検討した代替案
| 案 | 採らなかった理由 |
|---|---|
| フローもすべて Gemini に書き写させる | ユーザーの判断（ツールで自動）。図形と矢印の情報があれば決まった規則で正確に起こせる |
| Gemini の HTML を画面の中にプレビュー | 外から来た HTML を画面に入れるのは innerHTML 禁止と CSP に反する。ダウンロードして開く |
| HTML を DOMParser で消毒する | 文字列の処理で足りる範囲（script・on・URL）に絞り、テストで確かめる |
