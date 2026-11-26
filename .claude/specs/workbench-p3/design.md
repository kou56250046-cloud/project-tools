# 案件ワークベンチ P3 — 設計

## データ構造

### 種別の追加
| 種別 | 接頭辞 | 状態 | 項目 |
|---|---|---|---|
| task（作業） | TK | todo / doing / done / cancelled | parent（作業 ID）, estimate（人日, 数値 ≥0）, actual（人日, 数値 ≥0）, assignee（関係者 ID）, start / end（日付）, progress（0〜100 の整数）, dependsOn（作業 ID の配列）, milestone（真偽） |
| change（変更要求） | CR | proposed / approved / rejected / withdrawn | requestedBy（関係者 ID）, extraEstimate（人日, 数値 ≥0） |

- 全種別の共通項目に `internal`（真偽、社内のみ）を足す
- 新しいフィールドの型 `number`（min / max / integer を持つ）と `boolean` を `schema.js` に足す
- `REF_FIELDS` に parent（task → task）, assignee（task → stakeholder）, dependsOn（task → task, 配列）, requestedBy（change → stakeholder）を足す
- 検証の追加: parent をたどって自分に戻る（循環）は誤り。start > end は誤り。dependsOn の循環は誤り

### 変更の記録の拡張（P2 の ChangeEntry）
```ts
changes[].values?: { progress?: number; actual?: number; estimate?: number; status?: string }
```
作業の add のとき（値があれば）と update でこれらの項目が変わったときに、適用後の値を残す（S カーブの復元用）。
- 記録を 2,000 件で切るとき、捨てる記録の values から作業ごとの最後の値を集め、`{ rev, at, source: 'snapshot', changes: [{ id, op: 'update', values }] }` の1件として先頭に残す。S カーブはこの at より前を描かない

### 未完了・担当・期限の種別ごとの対応（指摘8）
- `OPEN_STATUSES` に task: todo / doing、change: proposed を足す
- 担当と期限のフィールドを種別ごとの表 `OWNER_FIELD = { issue: 'owner', question: 'askTo', task: 'assignee' }`、`DUE_FIELD = { issue: 'due', question: 'due', task: 'end' }` で持ち、健康診断の no-owner / overdue とボールはこの表を使う（change は対象外）

### 項目をまたぐ検査（P2 の checkIntegrity に足す）
- 親の循環・前の作業の循環・開始 > 終了（部分更新の後の値で判定するため、仮適用した台帳で見る）

### 表示の状態（台帳に入れない）
- `store.presentation: boolean`（説明用の表示）。localStorage に保存しない（開き直したら通常に戻す。見せたくない情報を出しっぱなしにしないため、既定は「通常」ではなく次の起動時も通常）

## 処理の流れ

### WBS の集計（`src/core/wbs.js`）
```ts
buildTree(ledger) → Node[]   // { item, children, depth, rollup: { estimate, actual, progress } }
```
- 末端の値はそのまま。親は子の合計。親の進捗 = Σ(子の見積 × 子の進捗) / Σ子の見積（見積 0 の子だけなら単純平均）
- 親に直接入れた見積・進捗は、子があるときは表示しない（子の集計を正とする。健康診断「親に値がある」は出さない＝非目標）
- 期間の経過割合 = (今日 − 開始) / (終了 − 開始 + 1) を 0〜1 に丸める。遅れ = 経過割合×100 − 進捗 ≥ 20 かつ 状態が done 以外

### EVM（`src/core/evm.js`）
- 対象は末端の作業のうち cancelled 以外、見積・開始・終了がそろったもの。そろわない作業の数は画面に出す
- BAC = Σ見積
- PV(t) = Σ 見積 × 経過割合(t)
- EV(t) = Σ 見積 × 進捗(t) / 100
- AC(t) = Σ 実績(t)
- 進捗(t)・実績(t) は、変更の記録の values を時系列にたどって、t の日の終わり時点の値を求める。記録より前は 0、作成日より前は対象外
- SPI = EV / PV（PV が 0 なら「—」）、CPI = EV / AC、EAC = BAC / CPI
- S カーブの点は「最初の開始日 〜 最後の終了日」と今日を含む期間で、週ごと（月曜）に取る

### 影響範囲（`src/core/impact.js`）
```ts
impactOf(ledger, rootIds, depth = 2) → { byKind: Record<Kind, Item[]>, taskEstimate: number }
```
- 参照フィールドの順方向と逆方向（buildBackrefs）、links（linkedIds）、関係の両方向を幅優先でたどる。根は含めない
- 関係者とシステムには到達するが、そこから先へは進まない（終点）
- 作業は、たどり着いた作業とその子孫を含める（親だけがつながっていても、子の見積を数えるため）

### 定例会資料（`src/core/report.js`）
- 入力: 台帳・期間 [from, to]・今日
- 期間の変更: changelog の at が期間内のもの。追加 / 完了（status が done・closed・answered・agreed に変わった）/ その他の状態変化 に分ける
- 文面: 見出しつきの平文（「■ 今週の進捗」「■ 決まったこと」「■ お願い（顧客待ち）」「■ 来週の予定」）。社内のみの項目は、説明用の表示中は入れない

### 説明用の表示（AC-19〜21）
- `visibleItems(ledger, presentation)` を1か所に置き、全画面の一覧・関係図・集計はこれを通す
- 隠すもの: internal の項目、関係の片方が internal なら関係も、課題の severity、健康診断の画面とタブの数・概要の次にやること、作業の実績・EVM の AC / CPI / EAC
- 参照の表示（detail.js の idButton・itemTitle・fieldValue・valueText）も visibleItems を通し、隠れた項目は「（社内のみ）」とだけ出す
- ハッシュの切り替えで道具の画面を指定されたら概要へ戻す
- 指示文・取込・設定の分類「道具」は、説明用の表示中は分類ごと出さない

### 新しい指示文の目的
| 目的 | 対象種別（項目一覧に載せる） | 返させるもの |
|---|---|---|
| WBS の作成 | requirement, decision, constraint, task, stakeholder | task の add（parent は tempId 可）・relate なし |
| 進捗の更新 | task, stakeholder | task の update（progress / actual / status） |
| 変更の影響レビュー | 変更要求と影響範囲の項目だけ | issue / question の add、change の update（extraEstimate） |
| 週報の清書 | なし（文面を入れる） | 平文（差分を返させない。NotebookLM 用と同じ扱い） |

## 触るファイル

| ファイル | 変更内容 |
|---|---|
| `build.mjs` | P3 の新しいファイルを JS_FILES に足す |
| `src/core/schema.js` | task / change 種別、internal、number / boolean 型、OPEN_STATUSES・OWNER_FIELD・DUE_FIELD、checkIntegrity に循環と日付 |
| `src/core/ball.js` | OWNER_FIELD を使う |
| `src/core/patch.js` | 記録の values |
| `src/core/wbs.js` `evm.js` `impact.js` `report.js`（新規） | 集計・EVM・影響範囲・定例会資料 |
| `src/core/health.js` | evm-low（高） |
| `src/core/prompts.js` | 目的4つ |
| `src/ui/views/wbs.js` `gantt.js` `progress.js` `changes.js` `meeting-report.js`（新規） | 画面 |
| `src/ui/chart.js`（新規） | 日付軸の折れ線（S カーブ）とガントの描画部品 |
| `src/ui/detail.js` | 社内のみの切り替え、変更要求の影響範囲と下書き |
| `src/ui/store.js` `src/app.js` | 説明用の表示、分類「計画・進捗」 |
| 既存の画面（overview / graph / list / decisions / issues / scope） | visibleItems を通す |
| `samples/sample-ledger.json` | 作業 15 件前後・変更要求 2 件・進捗の記録のダミー |
| `test/*.test.mjs` | 集計・EVM・影響範囲・資料・検査・visibleItems |

## 検討した代替案

| 案 | 採らなかった理由 |
|---|---|
| EVM の推移を毎日の写しで持つ | 保存量が増える。変更の記録に値を残せば復元できる |
| 親の作業の値を手入力で持つ | 子と食い違う。子からの集計を正にする |
| ガントを既存の viz.js の gantt で描く | 階層・今日線・進捗・依存の矢印が無く、style 属性を使うので CSP で落ちる。日付→座標と月目盛の考え方だけ借りる |
| 折れ線を dash.js の line で描く | x がカテゴリ等間隔で、frame / palette など周辺の関数ごと持ち込む必要がある。週ごとの点なら小さく書ける |
| 説明用の表示を台帳に保存する | 開いたまま席を外すと社内情報が出たままになる。毎回「通常」から始める |
| 変更要求を Gemini に作らせる専用の流れ | 議事録・自由指示の取込で add できる。影響範囲の計算だけ HTML 側に置く |
