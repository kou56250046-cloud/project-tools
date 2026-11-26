# 案件ワークベンチ P6a — 設計

## 1. UI

### 色の変数（src/styles.css の :root）
名前は今の変数を残し、値を gemini-kit（dash.css）の値にする。画面ごとの CSS は変えずに済む。

| 変数 | 新しい値 | 元にした値 |
|---|---|---|
| --bg | #F8F8FB | --d-bg |
| --panel | #FFFFFF | --d-card |
| --ink | #000000 | --d-text |
| --ink-2 / --ink-3 | #626264 | --d-label |
| --line | #CCCCCC | --d-line |
| --line-2 | #F1F1F4 | --d-control |
| --accent | #0017C1 | --d-s1 |
| --accent-strong（新） | #000060 | --d-s2（上のバー・主色のボタンを押したとき） |
| --accent-soft | #E8F1FE | --d-hl |
| --gold（新） | #A58000 | --d-s4。選んだ分類のタブの下線と、濃紺の上のフォーカス枠だけに使う。文字には使わない |
| --head-text（新） | #C9D4E3 | gemini-kit の上のバーの文字。濃紺の上の補助の文字にも使う |
| --high | #CE0000 | --d-neg-text |
| --mid | #8A5A00 | gemini-kit の --warn |
| --ok | #1A6B35 | gemini-kit の --ok |
| --low | #2B4FCF | --d-s3 を、白地で 4.5:1 になるよう暗くした値 |
| --side-customer | #3460FB | --d-s3。主色（選んだ項目の強調）と区別するため、主色とは別の青 |
| --side-own / --side-vendor / --side-system | #1A6B35 / #8A5A00 / #5B4A9E | ok・warn と、今の紫 |
| *-soft の各色 | 今の値のまま | 背景だけに使う色。コントラストのテストで確かめる |
| --surface（新） | #F1F1F4 | 表の見出し・却下や置き換え済みの地（今は直書き） |
| --hover（新） | #E8F1FE | 行に重ねたときの地（今は直書き） |
| --edge（新） | #666666 | --d-ref。図の線・矢印・予定線（今は直書き） |
| --bar（新）/ --bar-line（新） | #C5D7FB / #3460FB | ガントの棒の地と枠（今は直書き） |

- ダイアログの背景の幕と影は rgba のまま残す（透明度の指定で、色の取り決めの対象外）
- 字体は `--font: Arial, "メイリオ", Meiryo, "Yu Gothic", sans-serif;`。等幅（--mono）は今のまま

### 上のバー（src/shell.html・src/styles.css）
```
<header class="topbar">              濃紺（--accent-strong）・position: sticky; top: 0
  <div class="topbar-in">            最大幅 1600px・左右 20px・flex-wrap
    <h1 class="brand">案件ワークベンチ<small>オフラインで動作・外部送信なし</small></h1>
    #project-name  #topbar-status  #topbar-actions      ← 1 段目（並びは今と同じ）
    <nav class="groups" id="groups">                    ← 2 段目（flex-basis: 100%）
  </div>
</header>
<nav class="tabs" id="tabs">          白地・今のまま（上のバーの下）
```
- groups を header の中へ移すだけにする。app.js の描画（renderTabs が #groups に足す）は変えない
- body は今のまま縦の flex。中身は .view の中でスクロールするので、上のバーは常に見えている

濃紺の上で必要な上書き（今のスタイルのままだと読めなくなるもの）:
| セレクタ | 指定 | 理由 |
|---|---|---|
| `.topbar` | color: #fff | 名前・案件名を白にする |
| `.topbar .brand small` | color: var(--head-text)、12px | 副題 |
| `.topbar select` | color: var(--ink)、background: #fff | `button, select { color: inherit }`（L39）で白地に白文字になるのを防ぐ |
| `.topbar .btn` | 透明の地、枠 var(--head-text)、文字 #fff | |
| `.topbar .btn:hover:not(:disabled)` | 地 rgba(255,255,255,.12)、文字 #fff、枠 #fff | `.btn:hover { color: var(--accent) }`（L94）だと濃紺の上に青い文字になる |
| `.topbar .btn.primary` | 地 #fff、文字 var(--accent) | 書き出しのボタンと、説明用の表示中の「通常の表示に戻す」 |
| `.topbar .btn.primary:hover:not(:disabled)` | 地 var(--accent-soft)、文字 var(--accent) | `.btn.primary:hover` の地が --accent-strong（バーと同じ色）になるのを防ぐ |
| `.topbar .btn:disabled` | 不透明度 .45（今と同じ） | |
| `.topbar .muted` | color: var(--head-text) | rev の表示（muted small）が #626264 のままだと濃紺の上で約 2.9:1 |
| `.topbar :focus-visible` | outline-color: var(--gold) | |
| `.groups .group` | 文字 var(--head-text)、地なし、下線 3px 透明、最小の高さ 40px | |
| `.groups .group:hover` | 文字 #fff、地なし | `.group:hover` の地 --line-2（L284）が白っぽい塊になるのを防ぐ |
| `.groups .group[aria-current="true"]` | 文字 #fff・太字、下線 var(--gold) | |
- バッジは今の *-soft の地に濃い文字なので、濃紺の上でもそのまま読める（テストで比を確かめる）

### コントラストのテスト（test/ui-colors.test.mjs）
styles.css の :root から変数の値を読み、WCAG の式で比を計算する。どれも 4.5 以上であること。
- 本文: --ink / --panel、--ink / --bg、--ink-2 / --panel、--ink-2 / --bg、--ink-2 / --surface
- 色の文字: --accent / --panel、--high / --panel、--mid / --panel、--ok / --panel、--low / --panel、--side-customer / --panel
- 上のバー: --head-text / --accent-strong、#fff / --accent-strong、--accent / #fff（白地のボタン）、--accent / --accent-soft（白地のボタンを押したとき）
- バッジ: --high / --high-soft、--mid / --mid-soft、--ok / --ok-soft、--low / --low-soft、--accent / --accent-soft

あわせて、:root の外に `#xxx` / `#xxxxxx` の色が `#fff` 以外に無いことを確かめる（rgba は対象外）。

## 2. カルテの書き出し（src/core/karte.js・新規、DOM に触れない）

```js
export function ledgerToKarte(ledger, { includeInternal = false, now }) → { karte, counts, notes }
```
- includeInternal が false なら `visibleLedger(ledger, true)`（社内のみの項目を除く）を元にする
- 台帳は読むだけで変えない

### カルテの ID は台帳の ID から決める（毎回同じ ID になる）
gemini-kit は同じ案件名のカルテを読み込むと、ID の一致で前の版を引き継ぎ、差分を出す（merge.js の carryOver・diff）。そのため、書き出しのたびに同じ項目が同じ ID になるようにする。また、項目を消さずに状態で表す。

| カルテ | 台帳 | ID の作り方 | 例 |
|---|---|---|---|
| facts | requirement | F-(10000 + 番号) | RE-003 → F-10003 |
| facts | request | F-(20000 + 番号) | RQ-012 → F-20012 |
| facts | constraint | F-(30000 + 番号) | CN-002 → F-30002 |
| facts | 質問の回答 | F-(40000 + 番号) | QA-005 の回答 → F-40005 |
| unknowns | question | Q-番号（2 桁以上） | QA-005 → Q-05 |
| decisions | decision | D-番号 | DC-004 → D-04 |
| pending | issue | H-番号 | IS-007 → H-07 |
| todos | task | T-番号 | TK-021 → T-21 |

- 番号は台帳の ID の数字部分。台帳の採番は増えるだけなので重ならない
- 番号が 10000 以上（帯をはみ出す）の項目は書き出さず、注意に出す
- 中身を空に戻すと台帳の番号は 001 からやり直すので、前の版と ID の意味がずれる。注意に「中身を空に戻した後は、gemini-kit で別の案件名として読み込んでください」と出す（changelog に reset があるとき）
- sources（S-01…）は台帳に ID が無いので、書き出しごとに日付・名前の順に並べて振る。前の版と S の番号がずれることがある（gemini-kit の差分は facts などで見るので影響は小さい。非目標に書く）

### 状態の写し方（項目を消さない）
| 台帳 | カルテでの表し方 |
|---|---|
| 要件 dropped・要望 rejected | 事実として残し、scope ← 「対象外」、text の末尾に「（取り下げ）」「（不採用）」 |
| 要望 deferred | 事実として残し、text の末尾に「（保留）」 |
| 制約 resolved | 事実として残し、text の末尾に「（解消）」 |
| 決定 superseded | 決定として残し、text の頭に「（置き換え済み）」 |
| 課題 closed | 保留として残し、status ← 「完了」 |
| 作業 cancelled | ToDo として残し、status ← 「クローズ」（gemini-kit で完了扱い。期限切れに数えない） |
| 質問 closed | 未回答として残し、status ← 「回答済」。回答があれば事実を作る |

### 対応表
| カルテ | 中身 |
|---|---|
| project | name ← name、client ← customer、phase ← ""、updated ← now の日付、version ← 0 |
| sources | 書き出す項目（facts・unknowns・decisions・pending・todos の元の項目）の出典だけを集める。type が template（案件の型）の出典は入れない。(type, ref, date) が同じものを 1 件にまとめる。name ← ref、kind ← meeting なら「議事録」・それ以外は「その他」、date ← date（無ければ ""）、round ← ""、summary ← "" |
| people | stakeholder 全員。name ← title、org ← org、role ← side が own なら「自社」・それ以外は ""、note ← role |
| facts | 下の「事実の作り方」 |
| unknowns | 下の「未回答の作り方」 |
| decisions | text ← title（reason があれば「。理由: …」を足す）、owner ← decidedBy の名前を「、」でつなぐ、source、quote ← "" |
| pending | text ← title、owner ← owner の名前、due ← due、status ← 未着手 / 対応中 / 完了、source、quote ← "" |
| todos | text ← title、owner ← assignee の名前、due ← end、status ← 未着手 / 対応中 / 完了 / クローズ、source、quote ← "" |
| issues・proposals・conflicts・asis・risks・reviews | []（台帳に対応する種別が無い） |

共通の決まり:
- **quote は常に ""。** 台帳は資料の原文を持たない（出典の note は「補足」で、原文ではない）。gemini-kit では facts・decisions に「引用がありません」の warn が出る。これは「台帳から作ったので原文の引用が無い」という事実どおりの表示として受け入れる
- source ← その項目の最初の出典（template を除く）の S の ID。無ければ ""
- 人の参照は stakeholder の title（名前）。見つからなければ ""
- 各要素の `wbId` ← 元の台帳の ID。回答から作った事実は `"QA-005#answer"`。sources と people は wbId を持たない
- 最上位の `workbench.idMap` は「カルテの ID → wbId」（sources は含めない）

事実の作り方:
- text ← title（body があれば「。」でつなぎ、全体で 200 字まで）と、上の状態の印
- viewpoint ← 下の観点の対応
- status:
  - confidence が guess → 「推測」
  - confidence が fact か confirmed → 「確定」（明示された確度を優先する。案の要件でも事実なら確定）
  - confidence が無い → 要件で状態が agreed なら「確定」、それ以外（要望・制約・案の要件）は「推測」
- scope ← scope が out か、上の「対象外」の状態なら「対象外」
- speaker ← 最初の出典の speaker の名前
- 回答から作る事実（answered か closed で、answer が空でない質問）:
  - text ← answer、viewpoint ← 質問と同じ、status ← 確定、at ← Q の ID、answers ← Q の ID
  - source ← ""、speaker ← 質問先の名前（答えた人）、quote ← ""
  - 回答の出典は台帳に無いので、質問の出典は使わない

未回答の作り方:
- question ← title、why ← body
- priority ← 期限（due）を過ぎていて未回答なら「高」、それ以外は「中」
- askTo ← 質問先の名前、raisedIn ← source と同じ
- status ← answered か closed なら「回答済」。open で askedAt があれば「依頼中」。それ以外は「未回答」
- answeredBy ← 回答から事実を作ったときだけ、その F の ID。回答が空なら ""（gemini-kit は空なら参照を確かめない）
- askedOn ← askedAt（無ければ ""）、answeredOn ← ""（台帳に回答日が無い）
- estimateImpact ← ""、assumption ← ""
- viewpoint ← nfrCategory があればその対応、無ければ ""

観点の対応（gemini-kit の VIEWPOINTS から選ぶ。決められないものは ""。空は検証を通る）:
| 台帳 | 観点 |
|---|---|
| 要件 functional・要望 | 機能 |
| 非機能 availability・performance | 性能・可用性 |
| 非機能 security | セキュリティ |
| 非機能 migration | 移行 |
| 非機能 operability・environment | 運用・保守 |
| 非機能で大項目なし | ""（決め打ちしない） |
| 制約 budget・legal | 予算・契約 |
| 制約 schedule | 日程 |
| 制約 technical | 現行システム |
| 制約 operation | 運用・保守 |
| 制約 other | "" |

最上位に足すもの（gemini-kit の normalize は知らない最上位のキーもそのまま残す）:
```json
"workbench": { "from": "案件ワークベンチ", "project": "案件名", "revision": 12, "exportedAt": "…", "includeInternal": false, "idMap": { "F-10003": "RE-003", "F-40005": "QA-005#answer", … } }
```

### counts と notes（書き出しのダイアログに出す）
- counts: facts（うち回答から作ったもの）・unknowns（うち未回答・依頼中）・decisions・pending・todos・people・sources
- notes（当てはまるものだけ出す）:
  1. 「事実と決定の N 件は、台帳に資料の原文が無いため、gemini-kit で『引用がありません』と表示されます」（N > 0 のとき）
  2. 「社内のみの項目 N 件を含めます。顧客に見せる文書に載らないよう注意してください」（含めるとき）。含めないときは「社内のみの項目 N 件は書き出しません」
  3. 「前に社内のみを含めて書き出した版があると、gemini-kit で『消えています』と表示されることがあります」（含めないとき、社内のみの項目が 1 件以上あるとき）
  4. 「番号が 10000 以上の項目 N 件は書き出せません」（N > 0 のとき）
  5. 「この案件は中身を空に戻したことがあります。gemini-kit では別の案件名として読み込んでください」（changelog に reset があるとき）
- 「社内のみの項目を含める」を切り替えたら、counts と notes を作り直して表示し直す

### 画面（src/ui/views/settings.js）
- 「書き出す」の欄に「gemini-kit 用（カルテ）を書き出す」を足す。押すとダイアログを出す（counts・notes・チェックボックス・書き出す / やめる）
- ファイル名は `<案件名>_karte_rev<N>_<YYYYMMDD>.json`（exportFilename と同じ作り方。.gitignore の `*_rev*.json` に当たる）
- 書き出しても台帳・revision・書き出しの状態（markExported）は変えない

## 触るファイル
| ファイル | 変更内容 |
|---|---|
| `src/styles.css` | 色の変数・字体・上のバーと上書き・直書きの色の置き換え |
| `src/shell.html` | 上のバーの中に topbar-in と groups を入れる。副題を足す |
| `src/core/karte.js`（新規） | ledgerToKarte |
| `src/ui/views/settings.js` | カルテを書き出すボタンとダイアログ |
| `src/core/guide-text.js` | 設定の説明・よくある困りごとに 1 件 |
| `build.mjs` | JS_FILES に core/karte.js を足す |
| `test/karte.test.mjs`（新規） | ID の決め方・状態の写し方・参照の実在・列挙値・台帳を変えないこと |
| `test/ui-colors.test.mjs`（新規） | コントラストと直書きの色 |
| `tools/check-karte.mjs`（新規） | 開発用。gemini-kit の schema.js を vm で読み、parse → normalize → validate を通す。gemini-kit が無ければ飛ばす |

## 検討した代替案
| 案 | 採らなかった理由 |
|---|---|
| 変数の名前を --d-* に改名する | 全画面の CSS を書き換えることになり、見落としが出る。値だけ変えれば同じ見た目になる |
| 画面のタブも濃紺の 3 段目にする | 濃い段が 3 段になり重い。gemini-kit の 2 段に合わせ、画面のタブは白地にする |
| カルテの ID を書き出しのたびに連番で振る | 項目の増減で後ろの ID がずれ、gemini-kit の版の引き継ぎで別の事実が「覆った」扱いになる |
| 取り下げた項目を書き出さない | gemini-kit は「ID は消さずに状態を変える」決まりで、消えると警告になる |
| 出典の note や題名を quote に入れる | quote は資料の原文という意味で、文書の根拠欄に載る。note は補足、題名は台帳の要約で、どちらも原文ではない |
| ワークベンチの課題をカルテの issues に入れる | カルテの issues は「顧客の業務の課題」で、提案（proposals）が解く相手。プロジェクトの課題は pending（決まっていないこと）の方が意味が近い |
| gemini-kit の案件ファイル形式（case.versions）で書き出す | 版の管理は gemini-kit の役目。カルテ本体を書き出せば、gemini-kit が同じ案件名の新しい版として取り込む |
