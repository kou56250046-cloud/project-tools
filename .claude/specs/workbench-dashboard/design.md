# 案件ワークベンチ 概要画面のダッシュボード — 設計

## 1. 部品の取り込み
- `src/vendor/dash.js`: `~/.claude/skills/dashboard/assets/dash.js` をそのまま写す。頭に「写した元・日付・変えたところ（なし）」のコメントを足すだけ
  - dash.js は `(function (root) { … root.Dash = {…} })(window)` の形で、`window.Dash` だけを作る
- `src/vendor/dash.css`: 同じ場所の dash.css を写す。次だけ直す
  - :root の `--d-*` の定義は消し、`src/styles.css` の :root に `--d-*` を足して、ワークベンチの変数を指す（例 `--d-s1: var(--accent)`。値が無いものは値で足す: `--d-mute: #999999` など。--d-* の値は P6a で同じ配色にしてあるので見た目は変わらない）
  - `#E6E6EA`（目盛線・表の線）は `var(--line-2)`、印刷用の `#999` は `var(--d-mute)` に置き換える
- `build.mjs`:
  - VENDOR_JS = ['vendor/dash.js'] を、本体の `(() => { … })()` の前に、そのまま（import の除去・名前の衝突の検査をせずに）入れる
  - VENDOR_CSS = ['vendor/dash.css'] を styles.css の後に連結する（CSP のハッシュは連結後の全体で取るので変わらない）
- `test/ui-colors.test.mjs`: dash.css も「:root の外に #fff 以外の直書きの色が無い」の対象に加える。`--d-*` を足した組み合わせ（--d-label / --d-card、--d-s1 / --d-card、--d-neg-text / --d-card）のコントラストも足す
- `test/build.test.mjs` に足すこと: ビルドした JS に `Dash` が 1 回だけ定義される。vendor の JS に `innerHTML`・`fetch`・`eval`・`new Function` が無い

## 2. 集計（src/core/dashboard.js・新規、DOM に触れない）

```js
export function dashboardData(ledger, { today, presentation }) → {
  kpi: { customerWait: { count, maxDays }, overdue: { count, byKind: { issue, question, task } }, agreement: { rate, agreed, total, baselineRate }, spi: { value, hasTasks } },
  requirements: { categories: [..], agreed: [..], draft: [..], dropped: [..] },
  ball: { categories: ['顧客','自社','協力会社','未定'], d0_3: [..], d4_7: [..], d8: [..], notAsked: [..] },
  curve: [{ date, pv, ev, ac }] | null,
  confidence: { categories: ['要望','要件','制約'], fact, guess, confirmed, none },
  due: { categories: ['期限切れ','今週','来週','それ以降'], issue: [..], question: [..], task: [..] },
}
```
- presentation が true なら、`visibleLedger(ledger, true)` で数える（社内のみを除く）。表示する・しないは画面の側で決める
- 顧客待ち: `ballOf(it, ledger) === 'customer'` の件数。maxDays は waitDays の最大（null は除く）
- 期限切れ: 未完了（OPEN_STATUSES）で、DUE_FIELD の期限が today より前の課題・質問・作業
- 要件の合意率: 取り下げ（dropped）を除いた要件のうち agreed の割合（0 件なら null）。baselineRate は最新のベースラインの要件の写しで同じ計算をした値（ベースラインが無ければ null）
- SPI: computeEvm(ledger, today).spi。作業が無ければ hasTasks false
- 要件の状態の分類: 機能（category functional）、非機能の 6 大項目（NFR_CATEGORIES の順）、非機能で大項目なし。要件が 0 件の分類は出さない。案の多い順に並べる
- ボールの状況: 未完了の課題・質問を ballOf で分け、waitDays で 0〜3・4〜7・8 以上・null（まだ聞いていない）に分ける
- S カーブ: computeEvm の curve（進捗画面と同じ）。作業が無ければ null
- 確度の内訳: 要望（rejected を除く）・要件（dropped を除く）・制約（resolved を除く）の confidence（fact / guess / confirmed / 無し）
- 期限の分布: 未完了で期限がある課題・質問・作業を、期限切れ（today より前）・今週（today から今週の日曜まで）・来週（翌月曜〜翌日曜）・それ以降に分ける。週は月曜始まり

## 3. 画面（src/ui/views/overview.js）
- 並び（requirements の AC-04）。グラフのカードは `.dash-grid`（2 列の grid、幅が狭いときは 1 列）に置く
- KPI（Dash.kpi）。比べる相手（compare）は次のとおり。過去の推移は持たないので spark は付けない
  | KPI | value | compare | 押したとき |
  |---|---|---|---|
  | 顧客待ち | count 件 | 「目標 0 件との差」delta=count、better: down。note に「いちばん長い待ち N 日」 | issues（ボール） |
  | 期限切れ | count 件 | 「目標 0 件との差」delta=count、better: down。note に内訳（課題 N・質問 N・作業 N） | health |
  | 要件の合意率 | rate を % | ベースラインがあれば「ベースラインから」delta=rate−baselineRate（pt）、better: up。無ければ「目標 100% との差」 | list（種別 要件で絞る） |
  | SPI | value（小数 2 桁） | 「基準 1.00 との差」delta=spi−1、better: up。作業が無ければ value「—」・note「WBS を作ると出ます」 | progress |
  - KPI の押す動作: カードを囲む要素を button にせず、KPI の下に「開く」の小さなボタンを置く（dash.js の KPI の中身は変えない）
- 要件の状態: Dash.bar `{ categories, series: [合意, 案, 取り下げ], mode: 'stack', orientation: 'h', unit: '件' }`
- ボールの状況: Dash.bar `{ categories: 待ち先, series: [0〜3 日, 4〜7 日, 8 日以上, まだ聞いていない], mode: 'stack', orientation: 'h' }`
- S カーブ: Dash.line `{ x: 日付, series: [PV（role reference）, EV（focus）, AC], unit: '人日' }`。説明用の表示では AC を除く
- 確度の内訳: Dash.bar `{ categories: [要望, 要件, 制約], series: [確認済み, 事実, 推測, 未設定], mode: 'stack', orientation: 'h' }`
- 期限の分布: Dash.bar `{ categories: [期限切れ, 今週, 来週, それ以降], series: [課題, 質問, 作業], mode: 'stack', orientation: 'v' }`
- 共通: asOf ← today（「2026-11-26 時点」）、source ←「台帳 rev N」
- 説明用の表示: KPI の顧客待ち・期限切れ、ボールの状況、確度の内訳を出さない。KPI は合意率と SPI の 2 枚にする
- 描き直し: dash.js は ResizeObserver で幅に合わせて描き直す。app.refresh のたびに概要の DOM は作り直されるので、古い観測は要素ごと消える（dash.js の frame が host._dashRO を切る）

## 触るファイル
| ファイル | 変更内容 |
|---|---|
| `src/vendor/dash.js`（新規・写し） | dashboard スキルの部品 |
| `src/vendor/dash.css`（新規・写し） | 色を変数に置き換えたもの |
| `src/styles.css` | :root に --d-* の別名、.dash-grid |
| `build.mjs` | VENDOR_JS・VENDOR_CSS |
| `src/core/dashboard.js`（新規） | dashboardData |
| `src/ui/views/overview.js` | KPI・グラフ・並び替え |
| `src/core/guide-text.js` | 概要の画面の説明（SCREEN_HELP.overview）を直す |
| `test/dashboard.test.mjs`（新規） | 集計 |
| `test/ui-colors.test.mjs` | dash.css も検査、--d-* の組み合わせ |
| `test/build.test.mjs` | vendor の検査 |

## 検討した代替案
| 案 | 採らなかった理由 |
|---|---|
| 今の chart.js を広げる | gemini-kit と見た目がそろわず、統合の後に部品が 2 つになる（ユーザーの選択） |
| dash.js を ES module に書き直して取り込む | 写しの元（スキル）と差分ができ、スキル側の直しを取り込みにくい。そのまま入れて `Dash` だけを使う |
| KPI に前週比を出す | 台帳は項目ごとの過去の状態を持たない。履歴を足すと保存の形が変わる。目標値とベースラインと比べる |
| 新しい「ダッシュボード」画面を足す | 概要が毎日最初に見る画面なので、そこに置く方が使われる |

## レビューを受けて決めたこと（上の本文と食い違うときは、こちらが正）

### 空のグラフ（指摘 1）
- 合計が 0 件のグラフには `categories: []` を渡す。すべてのグラフに `empty: 'まだありません'` を渡す（dash.js は分類が空のときだけ空の表示を出すため）

### KPI の値が無いとき（指摘 2・6）
| KPI | 値が無い条件 | value | compare | note |
|---|---|---|---|---|
| 顧客待ち | なし（0 件は値） | 0 | 目標 0 件との差 delta=0、better: down | 0 件なら「顧客の返事を待っている課題・質問はありません」。maxDays が null（日数が読めない）なら日数の文は出さない |
| 期限切れ | なし | 0 | 同上 | 内訳 |
| 要件の合意率 | 要件が 0 件・全部取り下げ（rate が null） | null | `[{ label: '比べる値なし', delta: 0, better: 'none' }]` | 「合意の対象の要件がまだありません」 |
| SPI | 作業が無い（hasTasks false） | null | 同上 | 「WBS を作ると出ます」 |
| SPI | 作業はあるが EVM の対象が 0（見積・開始・終了が揃っていない。targets 0） | null | 同上 | 「見積・開始日・終了日を入れると出ます」 |
| SPI | 対象はあるが PV が 0（開始前） | null | 同上 | 「計画の開始日を過ぎると出ます」 |
- value に「—」の文字は渡さない（dash.js が NaN と出すため）。null を渡すと dash.js が「—」と出す
- hasTasks = kind task が 1 件以上。hasTargets = computeEvm の targets > 0。curve = hasTargets ? e.curve : null

### 期限切れの数え方（指摘 3）
- KPI の期限切れは、健康診断（runHealth）の code が overdue の指摘の件数とする（親の作業を外すなどの除外が同じになる）。内訳も指摘の項目の kind で数える
- 期限の分布も同じ母集団にする: 健康診断の overdue と同じ対象の決め方（未完了・期限あり・子を持つ作業を除く）。この判定は health.js の対象の決め方を関数として出し（`dueTargets(ledger)`）、両方から使う。health.js を触るファイルに足す

### ラベルの出どころ（指摘 4）
- 待ち先: ball.js の `BALL` の label（顧客待ち・自社待ち・協力会社待ち・未定）
- 確度: schema.js の `CONFIDENCE` の順と label（事実・推測・確認済み）の後に、「未設定」
- 種別: `KINDS[kind].label`（要望・要件・制約・課題・質問・作業）
- 要件の状態: `KINDS.requirement.statuses` の label（案・合意・取り下げ）。系列の順は合意・案・取り下げ
- 非機能の大項目: `NFR_CATEGORIES` の label。機能は requirement の category の label
- dashboard.js だけが持つ文言: 「未設定」「非機能（大項目なし）」「まだ聞いていない」「日数不明」、期限の区分（期限切れ・今週・来週・それ以降）、待ち日数の区分の名前。dashboard.js の頭の 1 か所に置く

### ボールの状況（指摘 5・確認事項 101）
- 待ち日数の区切りは、設定の「顧客待ちを知らせる日数」（ballWaitDays、既定 7）に合わせる: 「N 日以内」「N 日超」「2N 日超」。課題と質問の画面の「待ちすぎ」と同じ基準になる
- 「まだ聞いていない」は `notAskedYet(it, ledger)` で判定する（課題と質問の画面と同じ）
- notAskedYet でないのに waitDays が null（作成日が読めない）ものは「日数不明」の系列に入れる。0 件なら系列を出さない

### 説明用の表示（指摘 7・8）
- 説明用の表示では、合意率をベースラインと比べない（compare は「目標 100% との差」）。ベースラインの写しは社内のみの印を持たず、母集団が合わないため
- 説明用の表示でも「件数」は出す（今と同じ）。今の早期 return の位置を、件数の後ろではなく、出さない部品を飛ばす形に変える
- 「始め方」の案内（項目が 10 件未満のとき）は、案件情報のすぐ下（KPI の上）に置く

### KPI を押したとき（指摘 9）
- 顧客待ちは「課題と質問」を開くだけ（絞り込みはしない。issues.js は触らない）
- build.mjs の JS_FILES に core/dashboard.js を足す（T2）

### 色と字体（確認事項 103）
- `#E6E6EA` は新しい変数 `--d-grid: #E6E6EA` を :root に足して指す（線の濃さを gemini-kit と同じにする）。`--d-font` は `var(--font)`（Arial・メイリオ）を指す

### 再描画で残るもの（確認事項 104）
- dash.js は CSV の blob の URL を解放しない。概要を描くたびに数個の小さな blob が残るが、1 日開いたままでも数 MB に届かない量なので許容する（dash.js は直さない）
- 「frame が host._dashRO を切る」は同じ要素に描き直すときの話。概要は DOM ごと作り直すので、古い要素と ResizeObserver は要素が外れた後にブラウザが回収する（観測先が文書から外れれば通知は来ない）
