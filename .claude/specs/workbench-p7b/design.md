# 案件ワークベンチ P7b — 設計

## スキーマ（src/core/schema.js）
- stakeholder の fields に:
  - `reportsTo: { type: 'ref', label: '上長（報告先）', kinds: ['stakeholder'] }`
  - `teamRole: { type: 'enum', label: '体制上の役割', values: TEAM_ROLES }`。`TEAM_ROLES = [{ v: 'owner', label: '責任者' }, { v: 'pm', label: 'PM' }, { v: 'pl', label: 'PL' }, { v: 'member', label: '担当' }, { v: 'approver', label: '承認者' }, { v: 'window', label: '窓口' }, { v: 'other', label: 'その他' }]`
- task・decision・issue の fields に `raci: { type: 'raci', label: 'RACI' }`
  - 形: `[{ who: 'SH-001', role: 'R' | 'A' | 'C' | 'I' }]`。同じ who は 1 回だけ。who は関係者を指す
  - `RACI_ROLES = [{ v: 'R', label: '実行' }, { v: 'A', label: '承認' }, { v: 'C', label: '相談' }, { v: 'I', label: '報告' }]`
  - checkField に case 'raci'（配列・要素はオブジェクト・who は関係者の ID・role は R/A/C/I・who の重複は誤り）
  - REF_FIELDS に `{ field: 'raci', shape: 'nested', kinds: ['stakeholder'], on: ['task', 'decision', 'issue'], path: 'who' }`（nested の既存の書き方に合わせる。参照の後始末・tempId の置き換え・健康診断の存在しない ID の点検がそのまま効く）
  - REF_FIELDS に reportsTo（one・stakeholder・on stakeholder）
- INTEGRITY_RULES に reportsTo の循環（task の parent と同じ形）
- 版は 2 のまま（新しい種別は無い。新しいフィールドは前のツールでは「不明な項目」として無視される）

## 表示用の補い（src/core/raci.js・新規、DOM に触れない）
```js
export function effectiveRaci(item) → [{ who, role, derived: boolean }]
// 明示があればそれ。無ければ task.assignee・issue.owner を R、decision.decidedBy（複数）を A として derived: true
export function raciRows(ledger, { tasks: 'top' | 'all', issues: 'open' | 'all' }) → [{ item, cells: Map<who, { role, derived }> }]
export function cycleRole(role) → 次の役（'' → R → A → C → I → ''）
export function setRaciOp(item, who, role) → { op: 'update', id, set: { raci: 新しい配列 } }   // 補った分は明示に書き写してから変える（押した時点で明示になる）
```

## 体制図（src/core/org.js・新規）
```js
export function orgLayout(ledger) → { columns: [{ side, orgs: [{ org, nodes: [{ id, x, y, w, h, depth }] }] }], edges: [{ from, to, cross: boolean }], width, height }
```
- 列は 顧客・自社・協力会社（graph.js の COLS と同じ順）。列の中は所属（org）ごとのまとまり、まとまりの中は reportsTo の木（wbs.js の buildTree の作りで。上長が別の所属・別の列にいるときはその所属の根として置き、線だけ引く）
- 箱の位置: 木の深さで字下げ、行は順に積む（列ごとの縦の並び）。関与なし（inactive）の関係者は薄く
- 画面 `src/ui/views/org.js`: 上に体制図（SVG を `s()` で組む。色は変数）、下に RACI 表（crud.js の表の作りを手本に。セルは button、押すと cycleRole → store.applyLocal([setRaciOp(...)])）。表の上に「作業: 親だけ / すべて」「課題: 未完了だけ / すべて」の切り替え

## 指示文・表示
- prompts.js:
  - schemaText の配列の書き方に `raci: [{"who":"SH-001","role":"R"}]`（R 実行・A 承認・C 相談・I 報告。A は 1 人）
  - itemsText の詳細で raci を `SH-001:R, SH-002:A` に（配列のオブジェクトを join しない）
  - PURPOSES に `org`（体制の整理・kinds: stakeholder・task・decision・issue）と taskText の case
- detail.js: fieldValue・valueText に raci（「名前（役）」を並べる）。stakeholder の詳細に部下の一覧
- health.js: AC-03・AC-07 の 4 規則と HEALTH_CODES（`reports-to-inactive`・`task-no-a`・`issue-no-a`・`multiple-a`）
- screens.js・app.js・guide-text.js: `org`（grasp）、説明・用語（RACI）

## 触るファイル
| ファイル | 変更内容 |
|---|---|
| `src/core/schema.js` | stakeholder の 2 項目・raci の型・REF_FIELDS・INTEGRITY |
| `src/core/raci.js` `src/core/org.js`（新規） | 補い・表・配置 |
| `src/core/health.js` `src/core/prompts.js` | 規則・指示文 |
| `src/ui/detail.js` | raci の表示・部下 |
| `src/ui/views/org.js`（新規） `src/core/screens.js` `src/app.js` `build.mjs` `src/styles.css` `src/core/guide-text.js` | 画面と組み込み |
| `test/raci.test.mjs`（新規） | 下のタスクの完了条件 |

## 検討した代替案
| 案 | 採らなかった理由 |
|---|---|
| RACI を関係者の側に持たせる（担当している項目の一覧） | 項目の側に持つ方が、作業の取り込み（差分）と一緒に返させやすい |
| 体制図を関係図（graph.js）に重ねる | 関係図は関係（relate）の図で、上下関係とは意味が違う |
| 補った R・A を台帳に書き込む | 担当を変えたときに RACI と食い違う。表で押したときだけ明示にする |

## レビューを受けて決めたこと（上の本文と食い違うときは、こちらが正）

### 補いと明示の規則（指摘 1・2・確認事項 102）
- 補いは**役ごと**に行う。保存されている明示の要素（`raci`）に加えて、表示のときだけ次を足す:
  - R: 明示に R が 1 人もいなければ、作業の担当（assignee）・課題の担当（owner）を R として補う（その人が明示で別の役を持っていれば補わない）
  - A: 明示に A が 1 人もいなく、決定の決めた人（decidedBy）がちょうど 1 人なら、その人を A として補う（2 人以上なら補わない）
- `raci` が無いことと `[]` は同じ（明示なし）
- setRaciOp は**明示の要素だけ**を書き直す（補いを書き写さない）。補った人のセルを押すと、その人の明示の役が次の役（補いの役の次）になる。補いを消したいときは、別の人に同じ役を明示する
- 担当や決めた人を変えても、明示の RACI は直さない（非目標）
- 「A が 2 人以上」（multiple-a）は明示だけを数える
- 健康診断の A なしは、指摘が多くなりすぎないよう対象を絞る:
  - task-no-a: 子を持つ根の作業（工程・フェーズ。親を持たず子がある）で、完了・中止でないもの
  - issue-no-a: 重要度が高の未完了の課題
  - どちらも、A が明示にも補いにも無いもの

### 既存の nested の仕組みに載せる（指摘 3・4・5）
- REF_FIELDS の行: `{ field: 'raci', shape: 'nested', kinds: ['stakeholder'], on: ['task', 'decision', 'issue'], path: ['who'], dropElement: true }`（path は配列。参照先が無くなったら要素ごと外す）
- patch.js の removedElements の keyOf に `raci: (e) => e && e.who`（消える人の名前を取込のカードに出す）
- prompts.js の schemaText の「配列は update で丸ごと置き換わる」の一覧に raci を足す
- 目的 `org` では、台帳の一覧を詳しい形（今の raci が見える形）で載せる

### 画面の操作（指摘 6・確認事項 103〜105）
- 詳細パネルの関係者に「上長」と「体制上の役割」の選択を足す（画面の操作。取り消し・記録の対象）
- RACI 表の行:
  - 作業: 「根だけ」は親を持たない作業（子の有無を問わない。中止を除く）、「すべて」は中止も含む全部
  - 決定: 置き換え済みを除く（「すべて」のときは含める）
  - 課題: 「未完了だけ」か「すべて」
- RACI 表の列: 関与中の関係者と、関与なしでも明示の役を持つ人（列を薄く出し、直せる）
- 説明用の表示: 体制図と RACI 表は store.view()（社内のみの項目を除く）で描き、セルは押せない

### 体制図の端の場合（指摘 7・確認事項 106・107）
- 列の順は `KINDS.stakeholder.fields.side.values` から取る（列挙を二重に持たない）
- 所属（org）が空の関係者は「（所属なし）」のまとまりに入れる
- 上長が循環している関係者は、所属のまとまりの根として置き、箱に「（上長が循環）」と出す（消えないようにする）
- reports-to-inactive は、本人が関与中で、上長が関与なしのときだけ出す
