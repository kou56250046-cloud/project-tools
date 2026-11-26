# 案件ワークベンチ 使い方の流れ図 — 設計

## データ（src/core/guide-text.js に足す。文章の唯一の置き場所）

```js
export const WHERE = { GEM: 'Gemini', NLM: 'NotebookLM', TOOL: 'このツール', CLIENT: '顧客' };
// kind: 'start' | 'step' | 'end'。loop: 繰り返す部分か。optional: 任意の段か
export const FLOW_STEPS = [
  { id, label, where, kind, loop, optional, in: [..], out: [..], to: '..', how: [..], screens: [screenId..], purposes: [purposeId..] },
];
export const FLOW_EDGES = [{ from, to, label?, back? }];   // back: 戻りの線（破線）
export const MEETING_TIMELINE = [{ when: '会議の前日', items: [[WHERE のキー, '作業']] }, …];
export const FLOW_TEXT = {
  summary: '…',                 // 図の前に置く、流れを文章で書いた 1 行
  legend: { GEM: '…', NLM: '…', TOOL: '…', CLIENT: '…' },
  marks: { done: '✓ 済', active: '● 今ここ', todo: '○ これから', loop: '↻ 繰り返し', optional: '― 任意' },
  loopLabel: '↻ 会議 1 回ごとに回す',
  loopSub: '取込 → 点検 → ヒヤリング → 議事録',
  noLedger: '案件を開くと、進み具合（✓ 済・● 今ここ など）がここに出ます。',
  allDone: 'すべての段に手が付いています。会議のたびに繰り返しの部分を回します。',
  loopNow: '今は繰り返しの部分（点線の枠）です。要件が固まったら「要件の合意」へ進みます。',
};
```
- 章の名前と各章の前置きの文も、今 guide.js にあるものを含めて `GUIDE_CHAPTERS`（id・title・lead）として guide-text.js に移す

### 段（FLOW_STEPS）
| id | 名前 | 場所 | kind | 繰り返し | 任意 | 画面 | 指示文 |
|---|---|---|---|---|---|---|---|
| setup | 準備（案件と合言葉） | TOOL | start | | | settings | |
| digest | 資料の下ごしらえ | NLM | step | | ○ | | notebooklm |
| initial | 初期作成 | GEM | step | | | prompts | initial, material |
| import | 取込 | TOOL | step | ○ | | import | |
| check | 点検 | TOOL | step | ○ | | overview, health, issues, graph, list, cross | |
| prep | ヒヤリング準備 | GEM | step | ○ | | hearing, nfr | hearing-questions, nfr |
| meeting | 会議・回答 | CLIENT | step | ○ | | hearing | |
| minutes | 議事録の取込 | GEM | step | ○ | | prompts | minutes, free |
| baseline | 要件の合意 | TOOL | step | | | scope, decisions | review-pm, review-user |
| plan | 計画・進捗 | GEM | step | | | wbs, gantt, progress, changes, meeting-report | wbs, progress, change-review, report-polish |
| design | 設計・見積 | GEM | step | | | data, functions, crud, estimate, master | data-design, functions, review-eng |
| test | テスト | GEM | end | | | trace, tests | test-viewpoints, review-pl, review-ops |
| docs | 文書づくり | TOOL | end | | ○ | settings | |

- 今の PHASES の「毎日・毎週」は、check の手順（朝に概要の次にやることと健康診断、兼務なら横断）と MEETING_TIMELINE に移す。graph・list・cross は check の画面に、free は minutes の指示文（議事録以外のメモ）に入れる。今の案内で消えるものは無い
- 入れるもの・出るもの・次に持っていく先・手順の文は、今の FIRST_STEPS・ROUND_TRIP・PHASES の文から移す。docs は P6a のカルテの書き出し
- 今の文章で伝えていたことが移っていることは、テストで FLOW_STEPS の how 全体（連結した文字列）に次の語が部分一致で含まれることで確かめる: `合言葉`・`型`・`ここから資料`・`却下`・`適用`・`取り消し`・`履歴`・`NotebookLM`・`健康診断`・`横断`
- FLOW_EDGES:
  - setup → digest、digest → initial、setup → initial（label「資料が少なければ」）
  - initial → import、import → check、check → prep、prep → meeting、meeting → minutes
  - minutes → import（back、label「次の周期」）
  - check → baseline（label「要件が固まったら」）
  - baseline → plan、plan → design、design → test
  - check → docs（label「文書が要るとき」）
- MEETING_TIMELINE（4 列）:
  - 毎朝: TOOL 概要の「次にやること」と健康診断、TOOL 兼務なら横断
  - 会議の前日: TOOL 顧客待ちの催促、GEM ヒヤリング質問の生成、TOOL ヒヤリングシートの割り当て
  - 会議の当日: CLIENT シートの順に聞く、TOOL その場で回答を書く、CLIENT 文字起こしを保存
  - 会議の翌日: GEM 議事録の取込、TOOL 取込で確かめて適用、TOOL 定例会資料・週報
- 今の FIRST_STEPS・ROUND_TRIP・PHASES は消す。ROUND_TRIP_TIPS は「うまくいかないとき」として残す

## 進み具合（src/core/guide-flow.js・新規、DOM に触れない）

```js
export function stepStatus(ledger) → { status: { [stepId]: 'done' | 'active' | 'todo' | 'loop' | 'optional' }, loopActive: boolean } | null
```
- ledger が無いときは null（図に進み具合を出さない）。説明用の表示のときも、呼ぶ側（guide.js）が null として扱う

### 直線の段の「済」の条件（状態は問わない。取り下げた項目も数える。手が付いたかを見るため）
| 段 | 済の条件 |
|---|---|
| setup | 常に済（台帳がある） |
| initial | `items.some((it) => !(it.sources && it.sources.length && it.sources.every((s) => s.type === 'template')))`。出典が空の項目（手で足したもの）や、型の質問に会議の出典が足されたものも済に数える |
| baseline | `baselines.length > 0` |
| plan | kind `task` が 1 件以上 |
| design | kind `entity`（テーブル）・`screen`・`interface`・`batch` のどれかが 1 件以上 |
| test | kind `test` が 1 件以上 |

### 状態の決め方
1. 繰り返しの段（import・check・prep・meeting・minutes）は常に 'loop'。任意の段（digest・docs）は常に 'optional'
2. 直線の段（setup・initial・baseline・plan・design・test）は、それぞれ上の条件で 'done' か、そうでなければ 'todo'
3. 直線の段を順に見て、最初の 'todo' の段を探す（前の段が済でなく後の段が済になっている台帳もありうる。その場合も各段の済は条件どおりに出す）
   - それが initial なら、initial を 'active' にする
   - それが baseline なら、'active' の段は作らず `loopActive: true`（繰り返しの部分が今ここ）。baseline は 'todo' のまま
   - それが plan・design・test なら、その段を 'active' にする
   - 'todo' の段が無い（全段が済）なら、'active' は無く `loopActive: false`
4. 'active' は多くても 1 つ

### 端の場合（テストで確かめる。台帳はテストの中で組み立てる）
| 台帳 | 結果 |
|---|---|
| null | null |
| 型だけの台帳（createLedger の業務システム新規） | initial が active、baseline・plan・design・test が todo、loopActive false |
| 型の質問に会議の出典を足した台帳 | initial が done、loopActive true、active なし |
| 型を使わない空の台帳 | initial が active |
| 要件 1 件 + ベースライン | plan が active |
| ベースライン無し + 作業あり（sample-ledger-2.json と同じ形） | plan は done、baseline は todo、loopActive true、active なし |
| samples/sample-ledger.json（全部ある） | 直線の段はすべて done、active なし、loopActive false |

## 図（src/ui/views/guide.js）
- 1040 × 520 の viewBox の SVG を `s()` で組む。箱の位置は段ごとに固定（POS の表をこのファイルに置く）
  - 左の列: setup → digest → initial（上から下）
  - 中央の点線の角丸の枠: import → check → prep（上の段・左から右）、meeting ← minutes の向きに下の段、minutes → import の戻り（破線）。枠の中に FLOW_TEXT.loopLabel と loopSub
  - 下の段: baseline → plan → design → test（左から右）。check から「要件が固まったら」で下りる
  - 右上: docs（任意）
- 箱は角丸の矩形。1 行目は「印 名前」、2 行目は「使う場所（・今ここ）」。kind が start・end の箱は丸みを大きくする
- 箱の大きさは 168 × 56。名前は最長で 12 字（「準備（案件と合言葉）」は 10 字）。文字は 14px、12 字を超える名前は 13px にする
- 色はクラスで当てる（styles.css。SVG の属性に色を書かない）
  - `.fl-node rect`: 枠 --accent、地 --panel
  - `.fl-todo rect` と `.fl-optional rect`: 枠を破線、色 --ink-3
  - `.fl-active rect`: 枠 3.5、地 --accent-soft
  - `.fl-edge`: --edge。`.fl-back` は破線
  - `.fl-loop`: --accent の点線、地 --hover。`.fl-loop.is-now` は線を 3 に太くする
  - `.fl-node:focus-visible rect`: 枠 --gold・3（キーボードで選んでいる箱）。`<g>` 自体の outline は消す
- 使う場所の印（バッジ）は、今ある組み合わせを使う（test/ui-colors.test.mjs で検査済みの組み合わせだけ）
  - GEM: --accent / --accent-soft
  - NLM: --low / --low-soft
  - TOOL: --ok / --ok-soft
  - CLIENT: --mid / --mid-soft
  - 重要度の赤（--high）は使わない
- 箱の `<g>` に role="button"・tabindex="0"・aria-label（段の名前・使う場所・進み具合）を付ける。click と Enter / Space で `#step-<id>` へ移り、見出しにフォーカスする。Tab で回る順は FLOW_STEPS の順（DOM に足す順）
- 図の前に FLOW_TEXT.summary を小さな字で 1 行置く。凡例（使う場所・印）は図の上に置く
- 進み具合が null のときは印を付けず、FLOW_TEXT.noLedger を図の上に出す。全段が済なら allDone、loopActive なら loopNow を出す

## カード（src/ui/views/guide.js）
- `section#step-<id>.card.fl-step`
  - 見出し（h3、tabindex="-1"）と進み具合のバッジ
  - 4 つの枠の横並び: 入れるもの → 使う場所 → 出るもの → 次に持っていく先（`.fl-frames`、矢印は aria-hidden）
  - 手順（ol）
  - ボタンの行: 段の screens ごとに openButton（今ある関数）、purposes ごとに purposeOpen（今ある関数。説明用の表示では出さない）、「次の段へ（名前）」（FLOW_STEPS の次の段）
- 説明用の表示で隠れる画面のボタンは出さない（showScreen。今と同じ）

## 章立て（GUIDE_CHAPTERS。目次も合わせる）
1. はじめに（今のまま）
2. 全体の流れ（図）
3. 段ごとにやること（カード）
4. 毎朝と会議の前後でやること（MEETING_TIMELINE）
5. うまくいかないとき（ROUND_TRIP_TIPS）
6. 画面ごとの説明（今のまま）
7. よくある困りごと（今のまま）
8. 用語（今のまま）

## 触るファイル
| ファイル | 変更内容 |
|---|---|
| `src/core/guide-text.js` | WHERE・FLOW_STEPS・FLOW_EDGES・MEETING_TIMELINE・FLOW_TEXT・GUIDE_CHAPTERS を足し、FIRST_STEPS・ROUND_TRIP・PHASES を消す |
| `src/core/guide-flow.js`（新規） | stepStatus |
| `src/ui/views/guide.js` | 図・カード・毎朝と会議の前後・章立て |
| `src/styles.css` | 流れ図・カード・時系列のスタイル（色は変数） |
| `build.mjs` | JS_FILES に core/guide-flow.js |
| `test/guide.test.mjs` | 新しいデータの検査に書き換え、stepStatus の端の場合のテストを足す |

## 検討した代替案
| 案 | 採らなかった理由 |
|---|---|
| 箱の位置を自動で配置する | 戻りの線と繰り返しの枠をきれいに描くには固定の位置が確実。段は 13 で増減も少ない |
| gemini-kit の guide.js を写す | IIFE と別の部品（Dash.flow・ad-* の CSS）に依存し、段の中身も違う。考え方だけ借りる |
| 進み具合を手で付ける | 台帳から決まる方がずれない。保存の形も増えない |
| 箱の役割を link にする | 押すと同じページの中で移るだけで、Space でも動かすので button の方が合う |
| 使う場所の色に新しい変数を足す | 既存の検査済みの組み合わせで足りる。足すとコントラストの検査も足す必要がある |
