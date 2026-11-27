# 案件ワークベンチ P6d 資料の変換の強化 — 要件

承認: 2026-11-27（計画 `~/.claude/plans/claude-code-pc-pc-gemini-notebooklm-pc-h-imperative-newell.md` の「P6d」節の承認を、この仕様の承認として扱う）

## 背景
- PPT・Excel・HTML の中のフローが、変換すると省略される・伝わらない
  - PPT: 図形の文字だけを箇条書きにし、矢印（コネクタ）を捨てている
  - Excel: 図形（drawing）を読んでいない
  - HTML: 図は [図] になり、SVG の文字も拾わない
- Gemini の変換の指示文は PDF・画像 → md だけ。PPT・HTML → md と、Excel・PPT・PDF → HTML（人が読む資料）の指示文が欲しい。どれも選択肢つきで確かめてから書かせる
- ヒヤリング: HTML は人が読む資料（共有・保管）。作り方はツールが組む方式と Gemini が直接書く指示文の両方。フローはツールが図形と矢印から自動で起こし、画像のフローだけ Gemini に書き写させる。忠実さの点検・SmartArt・Excel の細部・フローを台帳へ、も足す

## 受入条件
- [ ] AC-01 PPT のスライドで図形が矢印で 2 本以上つながっていれば、md に ```flow（フロー記法）を出す。FLOWCHART.parse の誤りが 0。フローに使った図形の文字は箇条書きに重ねない
- [ ] AC-02 形から種類（decision・start/end・doc・data・sub・task）を決め、矢印の向き（stCxn→endCxn、無ければ端点に近い図形、矢じりの向き）と、線の近くの短い文字を出口のラベルにする。ほかの図形を 2 つ以上囲む長方形はレーンにする
- [ ] AC-03 Excel の図形（xl/drawings）も同じ処理で ```flow にする。テキストボックスの文字も出す
- [ ] AC-04 Excel の非表示シート・結合セル・セルのコメントを落とさずに出す
- [ ] AC-05 SmartArt（PPT・Word）を字下げの箇条書きにし、手順型はフロー記法にする
- [ ] AC-06 HTML の svg の文字を出し、mermaid などのコードはコードブロックで残す。ツールが作った HTML のフロー記法は md に戻すと ```flow に戻る
- [ ] AC-07 Gemini 指示文: md 化（PDF・画像・PPT・HTML）、HTML 化（Excel・PPT・PDF）、画像のフロー → フロー記法。最初の返事は選択肢つきの問いだけ。フローを書かせるものにはフロー記法の説明を入れる
- [ ] AC-08 ツールが md から 1 枚の HTML を組む（目次・表・箇条書き・フローは SVG の図・CSP の meta・script なし・文字はすべてエスケープ）
- [ ] AC-09 Gemini が書いた HTML の仕上げ（script・on 属性・外部 URL を外す、CSP の meta、`<pre class="flow">` を図に）。外した件数を出す。ダウンロードだけ
- [ ] AC-10 忠実さの点検: ツールで変換した元の文字と Gemini の返事（md・HTML）を照合し、抜けた数値・英数字の語・漢字かなの語の一覧と件数を出す
- [ ] AC-11 変換結果の ```flow ごとに「業務フローとして台帳に足す」（現行・導入後を選ぶ）
- [ ] AC-12 上をダミーの pptx・xlsx・docx・html のテストで確かめる

## 非目標
- PDF・画像の文字をブラウザで取り出すこと（OCR・PDF の文字抽出）
- スライドの見た目（位置・色・フォント）の再現。HTML は読みやすさ優先の 1 段組
- 画像の HTML への埋め込み（図は [図: 説明] のまま）
- Gemini が書いた HTML を画面の中でプレビューすること
- Word の描画キャンバス（wps）の図形と矢印からのフロー起こし（Word は SmartArt だけ）
- フロー以外の図（組織図・構成図・グラフ）の構造の再現
- 図形が 60 個を超えるスライド・シートのフロー起こし（文字の箇条書きに戻す）

## 制約
- 依存ゼロ・file:// で動く・実行時の通信なし・CSP・innerHTML を使わない（作った HTML は文字列でエスケープして組み、ダウンロードする）
- 書き出す HTML にも CSP の meta（default-src 'none'・style はハッシュではなく文書内の style 要素を許す `style-src 'unsafe-inline'`。script は無し）
