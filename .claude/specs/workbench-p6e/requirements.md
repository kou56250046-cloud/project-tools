# 案件ワークベンチ P6e qa-box（質問箱）との連携 — 要件

承認: 2026-11-27（計画 `~/.claude/plans/claude-code-pc-pc-gemini-notebooklm-pc-h-imperative-newell.md` の「P6e」節の承認を、この仕様の承認として扱う）

## 背景
- qa-box（`~/projects/bunsekiya-manage/qa-box`）は NotebookLM に決まったブロック形式で回答させ、状態（確定・未確定・提案・対応中・要確認）つきで管理する別の HTML。台帳とはつながっていない
- ヒヤリング: 両方向。qa-box は変えない。確定は回答済み、それ以外は質問のまま回答案を本文に（提案は推測）。回答の表は回答の本文に残すだけ

## 受入条件
- [ ] AC-01 未回答の質問を選んで、qa-box のブロック形式（`## 新規`・質問の先頭に `【QA-xxx】`）の聞く文を作れる。1 通 3000 字以内に分かれ、1 件で超えるものは単独で警告
- [ ] AC-02 回答の形式の指示（qa-box の prompt.md の写し `src/core/qabox-prompt.js`）をコピーできる
- [ ] AC-03 qa-box の JSON（控え v1・v2、AI 用 qa-box.ai.v1）を読める。形が違えば理由を出す
- [ ] AC-04 印 → 正規化した題名（qa-box の qkey と同じ規則）の順で台帳の質問と突き合わせ、確定は回答済み、それ以外は本文の「NotebookLM の回答案」の節を置き換え、無ければ新しい質問。出典に `NotebookLM（qa-box Q-xxx）`。取込のカードで確かめて適用でき、validatePatch を通る
- [ ] AC-05 同じ JSON を 2 回読むと差分 0
- [ ] AC-06 回答の表は回答の Markdown に残る

## 非目標
- qa-box そのものを変えること
- NotebookLM の返事（ブロック形式の文）をワークベンチに直接貼ること（qa-box に貼る）
- 回答の表を台帳のテーブル・判断・データに変換すること
- 台帳の質問を qa-box に直接入れる JSON を作ること
- 台帳から質問を消すこと
- 似ているだけの質問の照合

## 触るファイル
- 新規: `src/core/qabox.js`・`src/core/qabox-prompt.js`・`src/ui/views/qabox.js`・`src/ui/views/to-import.js`（判断・データと共通の取込への受け渡し）・`test/qabox.test.mjs`・`test/fixtures/qabox/`
- 変更: `src/core/screens.js`・`src/app.js`・`build.mjs`・`src/core/guide-text.js`・`src/ui/views/judge.js`（共通の受け渡しを使う）

## 検証方法
- `node --test "test/*.test.mjs"`
- 簡易サーバー＋Playwright で、ダミーの qa-box JSON の読み込み → 取込 → 適用 → 質問が回答済み
