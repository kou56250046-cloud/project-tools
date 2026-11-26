# 案件ワークベンチ 使い方タブ — 設計

## データ構造
台帳には何も足さない。

### `src/core/screens.js`（新規・DOM に触れない）
```ts
export const GROUPS: { id; label }[];                  // 把握 / 要件定義 / 計画・進捗 / 設計 / テスト / 道具 / 使い方
export const SCREENS: { id; group; label }[];          // 今の VIEWS から render を除いたもの + guide
export const NO_LEDGER_OK = ['settings', 'guide'];      // 台帳が無くても開ける画面
export const HIDDEN_IN_PRESENTATION = (s) => s.group === 'tools' || s.id === 'health' || s.id === 'cross';
```
- app.js の VIEWS は `SCREENS.map((s) => ({ ...s, render: RENDERERS[s.id] }))` で作る（RENDERERS は id → 描画関数の表）。NEEDS_LEDGER と hiddenInPresentation はこの表から作る

### `src/core/guide-text.js`（新規・DOM に触れない）
```ts
export const SCREEN_HELP: Record<screenId, { what: string; when: string }>;
export const PHASES: { id; title; desc; screens: screenId[]; purposes: purposeId[] }[];   // 4章
export const FIRST_STEPS: { title; desc; screen?: screenId }[];                           // 2章（4手順）
export const ROUND_TRIP: { title; desc }[];                                              // 3章の流れ
export const FAQ: { q; a }[];         // 10 件以上
export const TERMS: { term; desc }[]; // 10 語以上
```

## 処理の流れ
- `app.canOpen(viewId) → { ok, reason }`: ロック中は guide だけ ok。台帳が無ければ NO_LEDGER_OK だけ ok。説明用の表示中は HIDDEN_IN_PRESENTATION の画面は不可。タブのボタンの disabled と使い方のボタンの両方がこれを使う（今のタブの判定をこの関数に置き換える。ただし台帳が無いときの「概要」タブは今と同じく押せてようこそ画面を出す。概要は使い方のボタンからは押せない＝ようこそ画面に意味が無いため）
- ロック中の画面: `renderView` は `locked()` のとき、`app.view === 'guide'` なら使い方を描き、それ以外はロック画面を描く。使い方の上に「合言葉の画面に戻る」ボタン（app.go('overview') → ロック画面になる）。分類とタブは出さない
- 目次は `<nav>` のボタン。押すと本文の章へ `scrollIntoView`
- 「この画面を開く」は `app.go(id)`。「この指示文を開く」は `app.go('prompts', { purpose })`。押せないときは disabled と、`canOpen` の reason を title と横の小さな文字で出す
- 流れ図は HTML のカード（番号・見出し・説明）と、カードの間の矢印（→ の文字の要素。`aria-hidden`）
- よくある困りごとは `<details>`
- 説明用の表示中は、4章・5章から HIDDEN_IN_PRESENTATION の画面と、道具の分類にある指示文の案内を除く

## 触るファイル
| ファイル | 変更内容 |
|---|---|
| `src/core/screens.js`（新規） | 分類と画面の表 |
| `src/core/guide-text.js`（新規） | 説明の文章の表 |
| `src/ui/views/guide.js`（新規） | 使い方の画面 |
| `src/app.js` | VIEWS を screens.js から作る、`app.canOpen`、ロック中の使い方、ようこそ画面の入口 |
| `src/ui/lock.js` | ロック画面（locked / legacy）に「使い方を見る」 |
| `src/styles.css` | 目次・カード・矢印・用語の表 |
| `build.mjs` | 新しい3ファイルを連結の一覧に足す（screens・guide-text は core、guide は views） |
| `test/guide.test.mjs`（新規） | 全画面に説明がある・4章の画面と目的が実在する・FAQ と用語の件数 |

## 検討した代替案
| 案 | 採らなかった理由 |
|---|---|
| README を HTML に埋め込んで表示 | 開発者向けの内容（コマンドなど）が混ざり、会社PCの利用者に要らない情報が多い |
| 画面ごとの「?」ボタン | 25 画面すべてに足すと込み合う。まず1か所にまとめる（非目標） |
| 図を SVG で描く | カードと矢印の HTML の方が文字の折り返しに強い |
| テストで app.js を文字列として読み、画面の id を抜き出す | 書き方が変わると壊れる。画面の表を core に移す方が素直で、app.js の判定も1か所になる |
| ロック画面に要点の文章だけを出す | 初めての人が合言葉を決める前に全体を読めない。使い方だけはロック中も開けるようにした（案件のデータは出さないので安全） |
