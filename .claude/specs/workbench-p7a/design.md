# 案件ワークベンチ P7a — 設計

## 種別（src/core/schema.js の KINDS_RAW）
```js
kpi: {
  prefix: 'KP', label: 'KPI',
  statuses: [{ v: 'active', label: '追跡中' }, { v: 'achieved', label: '達成' }, { v: 'dropped', label: '取り下げ' }],
  fields: {
    metric: { type: 'string', required: true, label: '指標' },        // 例: 受注 1 件の処理時間
    baseline: { type: 'string', label: '現状値' },
    target: { type: 'string', label: '目標値' },
    unit: { type: 'string', label: '単位' },
    measure: { type: 'text', label: '測り方' },
    due: { type: 'date', label: '期限' },
    goal: { type: 'string', label: '対応するゴール' },                // 案件情報の goals の文と同じ文
    parent: { type: 'ref', label: '親の KPI', kinds: ['kpi'] },
  },
},
risk: {
  prefix: 'RK', label: 'リスク',
  statuses: [{ v: 'open', label: '監視中' }, { v: 'mitigating', label: '対策中' }, { v: 'occurred', label: '発生' }, { v: 'closed', label: '解消' }],
  fields: {
    prob: { type: 'enum', required: true, label: '起きる見込み', values: RISK_SCALE },
    impact: { type: 'enum', required: true, label: '影響', values: RISK_SCALE },
    strategy: { type: 'enum', label: '対応の方針', values: [{ v: 'avoid', label: '回避' }, { v: 'mitigate', label: '軽減' }, { v: 'transfer', label: '移転' }, { v: 'accept', label: '受容' }] },
    response: { type: 'text', label: '対策' },
    trigger: { type: 'text', label: 'きっかけ（起きそうな兆し）' },
    owner: { type: 'ref', label: '担当', kinds: ['stakeholder'] },
    due: { type: 'date', label: '対策の期限' },
  },
},
```
- `RISK_SCALE = [{ v: '1', label: '1 とても低い' }, … { v: '5', label: '5 とても高い' }]`（schema.js に 1 か所）。点数は `+prob * +impact`
- REF_FIELDS: `{ field: 'parent', on: ['task', 'kpi'] }`（既存の parent の行の kinds・on を種別ごとに分ける。kpi の parent は kpi だけを指す）、owner の行の `on` に risk
- OPEN_STATUSES: `risk: ['open', 'mitigating']`、`kpi: ['active']`
- OWNER_FIELD: `risk: 'owner'`、DUE_FIELD: `risk: 'due'`（kpi は入れない。KPI の期限は点検しない）
- INTEGRITY_RULES: kpi の parent の循環（task と同じ形）
- withDefaults: kind が risk で internal が undefined なら `internal: true`
- 版は 2 のまま。接頭辞 KP・RK を持つ案件は前のツールで ID の形の検査に合わず、その案件だけ退避に移る（消えない）

## 波及する箇所（調査のチェックリストから）
| 場所 | 扱い |
|---|---|
| dashboard.js の期限の分布・期限切れの内訳 | 種別を issue・question・task に固定している。risk を足す（系列「リスク」・byKind.risk）。足さないと配列の -1 で落ちる |
| health.js | 新しい規則 3 つ（KPI）と 1 つ（リスク）。HEALTH_CODES に `req-no-kpi`・`kpi-no-measure`・`kpi-goal-unknown`・`risk-high-no-response` |
| hearing.js の GAP_CODES | risk・kpi の指摘はヒヤリングの候補にしない（候補にする種別を question・request などに限る今の作りを確かめ、必要なら kind で除く） |
| prompts.js | PURPOSES に `kpi`（目的と KPI の整理・kinds: kpi・request・requirement）と `risks`（リスクの洗い出し・kinds: risk・issue・constraint・decision・stakeholder）。taskText に 2 つの case。internal の説明の文言を「リスクは既定で社内のみ」に直す。notebookPrompt の見出しに「リスク」「KPI」 |
| karte.js | risks を書き出す（`{ id: 'R-' + 番号, text: title + 対策, prob, impact, effect: '' , wbId }`。高中低に直す）。KARTE_KINDS に risk |
| detail.js | statusBadge の完了・取り消しの状態に achieved・dropped（kpi）、occurred・closed（risk）。リスクの詳細に「課題へ移す」ボタン |
| report.js の DONE | achieved・closed を完了に |
| list.js | rankOf にリスクの点数（見込み × 影響）。personOf は owner で自動 |
| impact.js | 変更要求書に社内のみのリスクを出さない（internal の項目は変更要求書の対象・影響範囲から除く） |
| screens.js・app.js | `kpi-tree`（req）、`risks`（plan） |
| guide-text.js | SCREEN_HELP 2 つ、FAQ（KPI の使い方・前のツールで開いたとき）、TERMS（KPI・リスクの点数・RACI は P7b） |
| overview.js の件数 | LEDGER_KINDS から自動で 2 枚増える |

## KPI の木（src/core/kpi.js・新規、DOM に触れない）
```js
export function kpiTree(ledger) → { purpose, roots: [{ goal, kpis: [Node] }], unassigned: [Node] }
// Node = { kpi, children: [Node], requests: [{ request, requirements: [requirement] }] }
```
- 子の KPI は parent で（wbs.js の buildTree と同じ作り。循環でも止まる）
- 施策: KPI と links でつながる要望（取り下げ以外）。要件: その要望と links でつながる要件（取り下げ以外）
- ゴールの対応は文の完全一致（前後の空白を除く）。当たらなければ unassigned

画面 `src/ui/views/kpi-tree.js`: 目的（文）・ゴールごとの字下げの表（種別・ID・題名・指標・現状値 → 目標値・状態）。項目を押すと詳細パネル。下に Dash.flow（TB）の図。nodes は ゴール・KPI・要望・要件、40 を超えたら図の代わりに「項目が多いため表だけ出しています」

## リスクのヒートマップ（src/core/risk.js・新規）
```js
export function riskMatrix(ledger) → { cells: number[5][5]（[見込み-1][影響-1]）, items: [{ risk, score }] }   // 監視中・対策中だけ
export function riskToIssueOps(risk) → ops   // [{ op:'add', tempId:'new:1', item:{ kind:'issue', title:'（発生）'+title, body: きっかけと対策, owner, internal, links:[risk.id], severity: 点数 15 以上は high・8 以上は mid・それ以外 low } }, { op:'update', id: risk.id, set:{ status:'occurred' } }]
```
- 画面 `src/ui/views/risks.js`: 5 × 5 の表（縦が影響 5→1、横が見込み 1→5。セルは件数と色の段（点数 1〜4・5〜9・10〜14・15〜25 の 4 段。色は CSS の変数 --heat-1〜--heat-4 を :root に足し、文字とのコントラストを ui-colors のテストに足す）。セルを押すとそのセルのリスクに絞る）。下にリスクの一覧（点数の高い順）と「課題へ移す」
- 説明用の表示では社内のみのリスクは visibleLedger で消える（印を外したものだけ出る）

## 触るファイル
| ファイル | 変更内容 |
|---|---|
| `src/core/schema.js` | kpi・risk・RISK_SCALE・REF_FIELDS・OPEN/OWNER/DUE・INTEGRITY・withDefaults |
| `src/core/kpi.js`（新規） | kpiTree |
| `src/core/risk.js`（新規） | riskMatrix・riskToIssueOps |
| `src/core/health.js` `src/core/prompts.js` `src/core/karte.js` `src/core/dashboard.js` `src/core/impact.js` `src/core/report.js` `src/core/hearing.js` | 上の表のとおり |
| `src/ui/views/kpi-tree.js` `src/ui/views/risks.js`（新規） | 画面 |
| `src/ui/detail.js` `src/ui/views/list.js` | 状態・課題へ移す・点数 |
| `src/core/screens.js` `src/app.js` `build.mjs` `src/styles.css` `src/core/guide-text.js` | 組み込み・ヒートマップの色・説明 |
| `test/kpi.test.mjs` `test/risk.test.mjs`（新規）、`test/ui-colors.test.mjs` `test/dashboard.test.mjs` `test/karte.test.mjs` | テスト |

## 検討した代替案
| 案 | 採らなかった理由 |
|---|---|
| ゴールを種別にする | ユーザーの判断（案件情報のまま） |
| KPI と要望を専用の参照（kpis）でつなぐ | 既存の links で足りる。Gemini にも links で返させれば済む |
| リスクを常に社内のみ（種別で隠す） | ユーザーの判断（既定で社内のみ・外せる） |
| リスクを課題（issue）に印を付けて表す | 見込み・影響・対策の項目が課題に無い。起きる前と起きた後を分ける方が管理しやすい |

## レビューを受けて決めたこと（上の本文と食い違うときは、こちらが正）

### 画面からの入力（指摘 1・確認事項 104）
- リスクの画面に「リスクを足す」フォームを置く: 題名・起きる見込み・影響・対応の方針・対策・きっかけ・担当・期限。store.applyLocal の add（社内のみが既定で付く）
- 足した後の見込み・影響・対策などの変更は、Gemini の差分で行う（手での編集は非目標）。状態と社内のみの印は今の詳細パネルで変えられる
- KPI は手で足すフォームを作らない（Gemini の差分で足す。非目標）
- 「課題へ移す」はリスクの画面の一覧と、リスクの詳細パネルに置く。監視中・対策中のリスクにだけ出す（発生・解消では出さない。二重に課題ができないように）

### 見込み・影響の型（指摘 9）
- `prob`・`impact` は `{ type: 'number', integer: true, min: 1, max: 5, required: true }`。RISK_SCALE は表示の言葉（1 とても低い 〜 5 とても高い）にだけ使う

### KPI の木の組み方（指摘 2）
- 子の KPI は親の KPI の下にだけ出す。どのゴールの下に置くかは、いちばん上の祖先の goal で決める（子の goal は見ない）
- 施策（要望）から除く状態は rejected（不採用）。deferred（保留）は出し、状態のバッジで見分ける
- 要件を KPI に直接 links でつないだものは、その KPI の下に「（直接の要件）」として出す

### 健康診断の対象（指摘 3・確認事項 103）
- `req-no-kpi`（低）: 取り下げでない KPI が 1 件以上あるときだけ。対象は取り下げ以外の要件のうち、要望と links でつながっているもの（要望とつながっていない要件は既存の別の点検の範囲なので対象外）。「つながっている」は、つながる要望（不採用以外）のどれかが取り下げ以外の KPI と links でつながるか、要件自身が取り下げ以外の KPI と直接つながること
- `kpi-no-measure`（中）: 追跡中の KPI で、measure か target が空
- `kpi-goal-unknown`（低）: 追跡中の根の KPI（親が無い）で、goal が空か、案件情報の goals の文に無いもの
- `risk-high-no-response`（中）: 監視中・対策中で、見込み × 影響が 15 以上、response が空
- risk と kpi は「出典なし」と「推測のまま」の点検の対象から外す（PM が自分で起こすのが普通のため）

### ヒヤリング・指示文への漏れ（指摘 4）
- hearing.js の候補の作り方で、kind が risk・kpi の指摘を除く（必須）
- prompts.js の gapsText（ヒヤリング質問の生成の材料）で、risk・kpi の指摘を除く
- notebookPrompt の見出しに「リスク」「KPI」を足す（AC-11 に含める）

### 概要と変更要求書（指摘 5・6）
- src/ui/views/overview.js の期限切れの内訳にリスクを足す（触るファイルに足す）
- 変更要求書の文面（changeRequestText）でだけ、社内のみの項目を出さない。impactOf と、変更の影響レビューの指示文は今のまま（社内向けなので社内のみも載せてよい）

### REF_FIELDS（指摘 7）
- parent の行を 1 行のまま `{ field: 'parent', shape: 'one', kinds: ['task', 'kpi'], on: ['task', 'kpi'] }` にする。kpi の parent が kpi だけを指すことは `KINDS.kpi.fields.parent.kinds` で守られる

### カルテ（指摘 8）
- リスクは全状態を書き出し、発生・解消は text の後ろに「（発生）」「（解消）」を付ける（事実の印と同じ方式）。ID は `R-` + 番号（2 桁以上）

### 呼び名（確認事項 102）
- 概要の 4 枚のカードは「指標カード」と呼ぶ（guide-text.js の概要の説明と overview.js の頭のコメントを直す）。「KPI」は新しい種別だけを指す

### リスクの画面の一覧（確認事項 101）
- 一覧は全状態を出し、「未完了だけ」（既定）と「すべて」を切り替える。ヒートマップは監視中・対策中だけを数える（今のまま）
