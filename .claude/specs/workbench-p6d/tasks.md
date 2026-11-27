# P6d — タスク

## T1 図形 → フロー記法と PPT
- 触るファイル: src/core/shapeflow.js（新規）・src/core/convert.js・tools/make-convert-samples.mjs・test/shapeflow.test.mjs
- **完了条件:** ダミーの pptx（レーン 2 本・分岐とはい/いいえ・終端・グループの中の図形・stCxn の無い線・矢じりが逆の線）で、md に ```flow が出て parse の誤り 0、種類・向き・ラベル・レーンが正しい。フローの図形の文字は箇条書きに出ない。線が 1 本以下のスライドは今と同じ

## T2 Excel の図形と細部
- 触るファイル: src/core/xlsx.js・src/core/convert.js・tools/make-convert-samples.mjs・test/convert.test.mjs
- **完了条件:** ダミーの xlsx で、図形のフローが ```flow、テキストボックスの文字が出る。非表示シートの印・結合の注記・コメントが出る

## T3 SmartArt と HTML
- 触るファイル: src/core/smartart.js（新規）・src/core/convert.js・test
- **完了条件:** pptx・docx の SmartArt が字下げの箇条書き、手順型はフロー記法。HTML の svg の文字・mermaid のコード・flow-src の戻り

## T4 Gemini 指示文
- 触るファイル: src/core/gemini-convert.js・test/convert.test.mjs
- **完了条件:** 種類 × 目的ごとに、問いの番号と選択肢・最初は問いだけ・フロー記法の説明・HTML の禁止事項が入る

## T5 HTML（ツールが組む・Gemini の仕上げ）
- 触るファイル: src/core/mdhtml.js（新規）・src/ui/flowsvg.js・test/mdhtml.test.mjs
- **完了条件:** 見出し・目次・表・箇条書き・flow の図と元の文・CSP・エスケープ（`<script>` を含む md が文字になる）。仕上げで script・on 属性・外部 URL が消え件数が出る、pre.flow が図になる

## T6 忠実さの点検
- 触るファイル: src/core/fidelity.js（新規）・test/fidelity.test.mjs
- **完了条件:** 抜けた数値・語が出る。桁区切り・全角半角・HTML のタグの違いでは抜けにしない

## T7 画面と説明
- 触るファイル: src/ui/views/convert.js・src/core/guide-text.js・src/styles.css・build.mjs
- **完了条件:** ブラウザで、ダミーの pptx・xlsx を入れてフローの md が出る、指示文の選択とコピー、HTML の保存（開いて図が出る）、台帳へ足すと業務フローの画面に出る
