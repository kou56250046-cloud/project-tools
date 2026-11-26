# 案件ワークベンチ P7c — 設計

## 写す部品（gemini-kit → src/core。IIFE ごと包む）
| 新しいファイル | 元 | 外に出す名前 | 直すところ |
|---|---|---|---|
| `core/flow.js` | src/js/flow.js（796 行）の parse・layout・wrap・textW・ROLES・ROLE_ORDER・roleOf・roleLabel・MARK・TYPE_NAMES | `FLOWCHART` | REF_ID（40〜41 行）を、ワークベンチの接頭辞（KINDS から作る）と JDG・TBL に広げる。toSVG・render・palette は写さない（下の flowsvg で書き直す） |
| `core/mdblocks.js` | src/js/md.js の parse（DOM に触れない部分）と、docview.js の unwrapFence・stateOf・tableCols | `MDBLOCKS` | render・inline（DOM）は写さない |
| `core/table-def.js` | src/js/table.js の parse・util・columnRows・columnCsv・TYPES・TYPE_NAMES・COLUMN_HEAD・pkOf・constraint | `TABLEDEF` | GK.trace.ID_RE・GK.docview・GK.md を mdblocks と台帳の ID_RE に。officeScript・erLayout・erSVG・TARGETS は写さない |
| `core/judge.js` | src/js/judge.js（594 行） | `JUDGE` | 下の「台帳とのつなぎ」 |

## 台帳とのつなぎ（judge.js の書き直し）
- カルテ（anken.v2）の代わりに台帳を渡す: `JUDGE.analyze({ flow, master, tables, ledger })`
- ID の状態の判定（gemini-kit の Q・H・F・D）を台帳の種別と状態で置き換える:
  | gemini-kit | 台帳 | ✓ 確定 | ? 未確定 |
  |---|---|---|---|
  | Q（未回答） | question（QA） | answered・closed | open |
  | H（保留） | issue（IS） | closed | open・in_progress |
  | F（事実） | request・requirement・constraint | 確度が fact・confirmed か、要件が agreed | それ以外 |
  | D（決定） | decision（DC） | valid | superseded は「? 置き換え済み」 |
  | （なし） | entity（EN）・screen（SC）など | 状態が fixed | draft |
  - 台帳に無い ID は「! 見つからない」
- kartePatch の代わりに `JUDGE.questionPatch(items)` → `{ type: 'ledger-patch', schemaVersion: 2, ops: [{ op: 'add', tempId, item: { kind: 'question', title, body: 理由, askTo: 名前から引けた関係者の ID, confidence: 'guess', sources: [{ type: 'other', ref: '判断・データの点検' }] } }] }`
- `TABLEDEF.toEntityPatch(tables, ledger)` → entity の add の差分。型の対応（調査の表から）:
  | TBL の型 | entity の型 | 補足 |
  |---|---|---|
  | text / note | string / text | |
  | number | 小数があれば decimal、無ければ int | |
  | currency | decimal（scale 0） | |
  | date / datetime / bool | date / datetime / boolean | |
  | choice | code | 選択肢は note に「選択肢: a / b」 |
  | lookup・fk・ref | fk `{ entity: new: の仮 ID か台帳の EN, column: 参照先の主キー }` | 参照先が同じ差分の中なら tempId |
  - key → name（物理名）、name → logical、maxLen → length、required・pk はそのまま。min・max・状態・根拠は note に書く
  - 同じ物理名のテーブルが台帳にあれば add にせず、警告を出して飛ばす（上書きしない）
- 取込への渡し方: import.js が `app.go('import', { text })` を受けて、その文を貼った状態で読み取る（今の import.js に opts を足す）

## 図（src/ui/flowsvg.js・新規）
- `renderFlowSvg(geo, overlay)` → SVGElement。gemini-kit の toSVG（685〜786 行）と同じ組み立ての順と寸法で、`s()` で組む
- 色はクラスで: `.fl2-lane`・`.fl2-node`・`.fl2-role-ai` など。:root に `--role-ai: #6A4C9C`・`--role-rule: #2F5F8F`・`--role-human: #8A5A1F`・`--role-ext: #5F6B78`・`--lane-bar`。文字とのコントラストのテストを ui-colors に足す
- overlay（marks・visited・taken・current）はクラスと印の文字で表す
- 業務フロー・判断・データの両方の画面で使う

## 業務フロー（種別 bizflow）
```js
bizflow: {
  prefix: 'BF', label: '業務フロー',
  statuses: [{ v: 'draft', label: '案' }, { v: 'fixed', label: '確定' }],
  fields: {
    phase: { type: 'enum', required: true, label: '現行・導入後', values: [{ v: 'asis', label: '現行' }, { v: 'tobe', label: '導入後' }] },
    notation: { type: 'text', required: true, label: 'フロー記法' },
  },
}
```
- notation は 20,000 字まで（validateFields の種別ごとの点検。memo の本文と同じ書き方）
- 画面 `src/ui/views/bizflow.js`: 左にフローの一覧（現行・導入後のバッジ）と「新しいフロー」、右に図と記法の欄（textarea・「保存」）と誤り・警告。関連でつながる現行・導入後があれば上下に並べる
- 指示文の目的 `bizflow`（業務フローの作成）: 記法の説明は gemini-kit の 50-fmt-flow.md を写して直したもの（`core/flow-format.js` の文字列）。返させるのは bizflow の add か、notation の update
- 健康診断 `flow-error`（中）: FLOWCHART.parse の errors が 1 件以上

## 構成図（src/core/arch.js・新規）
- `archGraph(ledger)` → `{ nodes: [{ id, label, kind: 'self' | 'system', status }], edges: [{ from, to, label }], batches: [title] }`
  - 真ん中 `self`（案件名）。interface の system を相手、direction で向き。同じ相手への連携は線を分ける
- 画面 `src/ui/views/arch.js`: dash.js の Dash.flow（LR）で描く。バッチは真ん中の箱の下に一覧。廃止のシステムは破線（Dash.flow の status で表す。できなければ名前に「（廃止）」）

## 判断・データ（道具の画面 `src/ui/views/judge.js`・新規）
- gemini-kit の judgeui.js の画面の構成に合わせて書き直す（左: 4 つの欄のタブ・サンプル・ファイルを開く・まとめて保存、右: 件数の帯と 3 つの表示「図と確認事項」「点検」「デモ」）。テーブル構築（Office Scripts）の表示は写さない
- 状態は画面のモジュールの中だけ。store の lock の通知で消す
- 指示文の目的: `judge-flow`・`table-def`・`judge-master`・`judge-cases`（group 設計・plain: true）。gemini-kit の items 90〜93 を写し、差し込み（{{事実一覧}} など）を台帳の一覧（要件・決定・質問）に置き換える

## 触るファイル
| ファイル | 変更内容 |
|---|---|
| `src/core/flow.js` `mdblocks.js` `table-def.js` `judge.js` `flow-format.js` `arch.js`（新規） | 上のとおり |
| `src/core/schema.js` | bizflow・notation の上限 |
| `src/core/health.js` `src/core/prompts.js` | flow-error・5 つの目的 |
| `src/ui/flowsvg.js`（新規） | 図 |
| `src/ui/views/bizflow.js` `arch.js` `judge.js`（新規） `src/ui/views/import.js` | 画面・取込に文を渡す |
| `src/core/screens.js` `src/app.js` `build.mjs` `src/styles.css` `src/core/guide-text.js` | 組み込み・色・説明 |
| `test/flow.test.mjs` `test/judge.test.mjs` `test/arch.test.mjs`（新規）・`test/fixtures/judge/`（gemini-kit のダミーを写す） | gemini-kit の flow 12 件・judge 35 件のうち、写した部分のテストを ES module に直して通す |

## 検討した代替案
| 案 | 採らなかった理由 |
|---|---|
| 業務フローを Dash.flow で描く | レーン（部門の帯）と区分の色が無い。gemini-kit の配置の処理を写す方が、gemini-kit と同じ図になる |
| 判断・データを台帳に保存する | ユーザーの判断（道具として移す） |
| テーブル定義を entity と一本にする | ユーザーの判断。代わりに「台帳のテーブルに取り込む」で変換する |
| 構成図を ER 図の配置（erlayout）で描く | 箱と流れの数が少なく、Dash.flow で足りる |

## レビューを受けて決めたこと（上の本文と食い違うときは、こちらが正）

### テーブル定義 → 台帳のテーブル（指摘 1・4・5）
- テーブル定義の書式に「- 物理名：」と「- 区分：（自システム / 外部参照）」の行を足し、table-def.js の parse で読む。指示文 table-def でもこの 2 行を書かせる
- toEntityPatch の決まり:
  | 場合 | 扱い |
  |---|---|
  | テーブルの物理名が無い | そのテーブルは差分にせず、警告「物理名がありません」 |
  | 区分が無い | internal（自システム） |
  | 同じ物理名のテーブルが台帳にある（大文字・小文字を区別しない） | add にせず警告。そのテーブルを指す参照は台帳の EN の ID にする |
  | 列の内部名（key）が空 | その列を外して警告 |
  | 型 number | typeRaw に「小数」「decimal」があるか、桁に「,」（例 10,2）があれば decimal、それ以外は int |
  | lookup・fk | fk の column は参照先のテーブルの主キーの列の内部名（物理名）。参照先が同じ差分なら entity に tempId、台帳にあればその EN |
  | テーブル単位の根拠（t.basis） | 台帳にある ID は links に、無い ID は note に |
  | 列の min・max・状態・根拠・選択肢 | note に「範囲: …」「選択肢: a / b」「状態: …」「根拠: …」 |
- 列定義表（columnRows・columnCsv）は「型（構築先）」の列を外し、「型（台帳）」（entity の論理型）にする。見出し: テーブル・列名・内部名・型（定義）・型（台帳）・必須・主キー・参照先・桁・範囲・選択肢・状態・根拠・備考。「点検」の表示の下に出し、CSV で保存できる
- 指示文 90〜93 は、ID の規則を台帳の接頭辞（RQ・RE・CN・DC・QA・IS・EN など）に書き換え、構築先（Excel・SharePoint・Dataverse）の文を消す
- サンプルは `src/core/judge-sample.js`（文字列の定数）。fixtures（test/fixtures/judge/）の ID は台帳の ID に書き直す（サンプル台帳 samples/sample-ledger.json の ID に合わせる）

### 台帳の ID の状態（指摘 2）
| 種別 | ✓ 確定 | ? 未確定（理由） |
|---|---|---|
| question | answered・closed | open（未回答） |
| issue | closed | open・in_progress（未解決） |
| request | accepted | open・deferred（未決）、rejected（不採用） |
| requirement・constraint | karte.js の factStatus と同じ: 確度 fact・confirmed、確度が無く要件が agreed、制約は resolved も ✓ | guess（推測）、確度が無く agreed でない（未合意）、dropped（取り下げ） |
| decision | valid | superseded（置き換え済み） |
| change | approved | proposed（未承認）、rejected・withdrawn（却下・取り下げ） |
| entity・screen・interface・batch・bizflow | fixed | draft（案）、dropped（取り下げ） |
| stakeholder・system・meeting・task・test・kpi・risk・memo | 台帳にあれば ✓（状態は見ない） | — |
- 「?」の参照は、gemini-kit の Q・H と同じく、その判断・箱を未確定にする理由（reasons）に入る。理由の文は「QA-001 が未回答」のように ID と理由
- gemini-kit の qsOf・QH_REASON・デモの `/^[QH]-/`・ITEM_HEAD「関係する Q・H」は、「未確定の参照（上の表で ? の ID）」と見出し「関係する未確定の項目」に置き換える
- 箱の印（marks）は gemini-kit と同じ 3 つ: ✓ 確定・? 未確定・! マスタなし（JDG・TBL が見つからない）。台帳に無い ID は警告の一覧に出し、その箱を ? にする（理由「台帳に無い ID」）
- REF_ID（フロー記法の参照）は JDG・TBL と、台帳の全種別の接頭辞にする。gemini-kit の Q・H・F・D は外す（書いてあってもラベルの文字として残る）

### 確認事項を質問にする（指摘 3）
- 題名: 「「{判断の題名}」の{理由の要約}を確定してください」（gemini-kit の kartePatch の組み立てと同じ）
- 質問先: 判断マスタの「問い合わせ先」・「担当」の文を、関係者の題名（名前）と前後の空白を除いて完全一致で照合。当たれば askTo、当たらなければ本文に「聞く相手: …」
- 除外: 理由がすべて台帳の既存の未回答の質問（QA の open）を指すものは入れない。同じ題名の質問が台帳にあれば入れない（もう一度押しても二重にならない）

### 図（指摘 6・7）
- :root に足す変数とテストする組み合わせ:
  | 変数 | 値 | 使い道 | テスト |
  |---|---|---|---|
  | --role-ai / --role-rule / --role-human / --role-ext | #6A4C9C / #2F5F8F / #8A5A1F / #5F6B78 | 区分の帯・凡例の文字 | 各色 / --panel が 4.5 以上 |
  | --lane-a / --lane-b | #F4F6FA / #FFFFFF | レーンの帯（交互） | --ink / 各色 が 4.5 以上 |
  | --lane-head | #E8ECF3 | レーンの見出しの地 | --ink / --lane-head |
  | --fl-branch-yes / --fl-branch-no | #2B4FCF / #CE0000 | 分岐の出口の線と文字 | 各色 / --panel |
  | 印 ✓ ? ! | --ok / --mid / --high（既存） | 箱の右上の印 | 既存のテストで済み |
  | 通った道・今の箱 | --accent / --gold（既存。--gold は線だけ） | デモ | — |
- 区分の無い図のレーンは中立の 2 色の交互（gemini-kit のレーンの 6 色は写さない）。分岐の出口は 2 色まで（3 本目以降は --edge）
- overlay に focus（選んでいる箱）・titles（箱の説明）・当たり判定（各箱に tabindex="0"・role="button"・aria-label。押すと onSelect(id)）を入れる
- 誤りのある記法: 誤りのある行のノードと、それにつながる線を外してから layout に渡し、描ける部分を描く。誤りは行番号つきで上に出す。判断・データの画面も同じ（gemini-kit は誤りがあると図を描かない。ここは変える）

### 構成図（指摘 8）
- Dash.flow は使わず、src/ui/views/arch.js で SVG を `s()` で組む（配置は core/arch.js）:
  - 真ん中に案件のシステム（案件名）。左の列に受信元（direction in の相手）、右の列に送信先（out の相手）。受信と送信の両方がある相手は左右の両方に箱を出す
  - 同じ相手・同じ向きの連携は 1 本の線にまとめ、ラベルに連携名（方式・頻度）を並べる（3 件を超えたら「ほか N 件」）
  - システムの状態は名前の後ろの印「（新規予定）」「（廃止）」で表し、廃止は破線の枠
  - バッチは真ん中の箱の下に一覧（AC-07 も「下に一覧」に直す）
  - 連携の無いシステムは図の下に「連携の無いシステム」として並べる
  - 状態 dropped の連携・バッチは出さない
  - 0 件: システム（自分以外）も連携も 0 件なら「まだありません」

### 業務フローの指示文と一覧（指摘 9）
- 目的 bizflow では、対象のフローを選ぶ欄（メモからの取込と同じ形）を出し、選んだフローの記法を全文載せる。選ばなければ新しいフローを作らせる
- ほかの目的の台帳の一覧（itemsText の詳細）では notation を出さない（題名と現行・導入後だけ）

### 確認事項への判断（確認事項 101〜105）
- 取込への受け渡し: 取込の画面に下書き（貼った文）があるときは「今の下書きを置き換えます」の確認を出す。受け取った後 viewOpts を空にする
- 判断・データの入力は、ロックのときと、案件を切り替えたとき（vault・switch の通知）に消す
- 現行と導入後の組み合わせ: 選んだフローと関連でつながる反対側のフローを、すべて下に縦に並べる
- REF_ID は上のとおり（Q・H・F・D を外す）
- 判断・データは台帳が要る画面にする（NO_LEDGER_OK に入れない）
