# 案件ワークベンチ P5 — 設計

## データ構造

### 種別の追加
| 種別 | 接頭辞 | 状態 | 項目 |
|---|---|---|---|
| test（テスト） | TS | draft / ready / passed / failed / onhold | level*（unit / integration / system / acceptance）, viewpoint*（normal / boundary / error / authority / performance / other）, steps（文章）, expected（文章）, executedAt（日付） |
- 台帳の settings に `me`（関係者 ID、任意）を足す。`REF_FIELDS` ではなく settings の検査で存在を確かめる（無ければ未設定扱い）

### 保存の形（暗号化の箱の中身）
```ts
// P4 まで: 箱の中身 = Ledger（1件）
// P5 から:
type Workspace = {
  type: 'workspace';
  version: 1;
  activeId: string;                        // ledgers のキー
  ledgers: Record<string, Ledger>;         // キーはランダムな案件 ID（台帳の中には入れない）
  exported: Record<string, { revision: number | null; at: string | null }>;
};
```
- 開けた中身の `type` が `ledger` なら、`{ type: 'workspace', ledgers: { <新しいID>: 中身 }, activeId, exported: { <ID>: 今の exportedRevision / exportedAt } }` に移す（AC-08）。P1〜P4 の `exportedRevision` / `exportedAt` の localStorage キーは移したあと消す
- それ以外の `type` は読めない扱い → 退避
- 読み込みの順: 箱を開く → `migrateWorkspace`（type が ledger なら包む）→ 案件ごとに `migrateLedger` → `validateLedger`（allowDanglingRefs）。通らない案件は ledgers から外し、元の文字列を `recovery[案件ID]` として退避する（退避の箱は `KEY_RECOVERY` 1つのまま、中身を `{ [案件ID]: 文字列 }` の辞書にする。P1〜P4 の単一文字列の退避は `{ legacy: 文字列 }` に移す）
- P1 の平文の保存（legacy）も、合言葉を決めた時点で同じ包み方をする
- 全案件が読めないときは workspace を空として開き、退避だけ残す

### store の変更
- `store.ledger` は「今開いている案件の台帳」を指すまま（既存の画面は変えない）
- `store.workspace` を足し、`switchProject(id)` で ledger・undoLedger（案件ごとの Map）・selectedId・token・gen を切り替える
- `replace()` を `addProject(ledger)`（新しい案件として足して開く）と `replaceProject(id, ledger)`（同じ案件名の案件を置き換える）に分ける（AC-06）
- 説明用の表示中は、上部の案件の切り替えに今の案件だけを出し、横断の画面を開かせない（P3 の visibleItems の方針と同じ）
- `persist()` は workspace 全体を暗号化する

## 処理の流れ

### トレーサビリティ（`src/core/trace.js`）
```ts
traceRows(ledger) → { req, requests: Item[], design: Item[], tests: Item[], counts: Record<status, n>, verdict }[]
```
- 要望: 要件の links にある要望と、要件を links に持つ要望
- 設計: 要件を links に持つ画面・連携・バッチ・テーブル
- テスト: 要件か、その要件の設計の項目を links に持つテスト（設計経由のテストも数える）
- 判定: テスト 0 件 → テストなし / failed あり → 不合格あり / passed 以外あり → 未実施あり / すべて passed → すべて合格

### 横断（`src/core/cross.js`）
- 入力: workspace・今日。案件ごとに既存の関数（ballOf / waitDays / runHealth / evm）を呼んで集める。新しい計算は持たない
- 自分の判定: settings.me が無い案件は「自分」の欄を出さず「自分が未設定」と出す

### テスト観点の指示文
- 対象の選択は指示文画面に「対象」の欄を足す（要件・画面の複数選択）
- 指示文に入れるもの: 対象の項目の全フィールド（画面なら fields の型・必須）、対象とつながる制約・非機能要件の題名、既にあるテストの題名（重複を避けさせる）
- 返させるもの: test の add（links に対象の ID）

### 型の追加（`src/core/starter.js`）
- 質問に `tags` で分類（業務 / 連携・データ / 非機能 / 制約 / パッケージ適合 など）を付ける。非機能の質問には P2 で足した `nfrCategory` を入れ、P2 の非機能画面の「質問中」の判定にそのまま乗せる

## 触るファイル

| ファイル | 変更内容 |
|---|---|
| `build.mjs` | P5 の新しいファイルを JS_FILES に足す |
| `src/core/workspace.js`（新規） | migrateWorkspace・案件ごとの検査と退避の振り分け（純粋関数） |
| `src/core/schema.js` | test 種別、SETTINGS に me、validateProject の starter の値を STARTERS のキーから作る（schema.js は starter.js を import できないため、許す値の一覧を starter.js から schema.js へ渡す登録関数を置く） |
| `src/core/trace.js` `cross.js`（新規） | トレーサビリティ・横断 |
| `src/core/health.js` | テストの無い要件・不合格のテスト |
| `src/core/prompts.js` | テスト観点の生成（対象つき） |
| `src/core/starter.js` | 型2つの追加、既存の型の非機能の質問 |
| `src/ui/store.js` | workspace・移行・案件の切り替え・案件ごとの取り消しと書き出し状態・保存の大きさ |
| `src/app.js` | 案件の切り替え、分類「テスト」、横断の画面（分類「把握」の先頭） |
| `src/ui/views/trace.js` `tests.js` `cross.js`（新規） | 画面 |
| `src/ui/views/settings.js` | 新規・読み込みを「追加」に、案件を外す、自分の設定、保存の大きさ |
| `src/ui/views/prompts.js` | 対象の選択 |
| `samples/sample-ledger.json` `samples/sample-ledger-2.json` | テストのダミー、2件目の案件 |
| `test/*.test.mjs` | trace・cross・workspace の移行・型 |

## 検討した代替案

| 案 | 採らなかった理由 |
|---|---|
| 案件ごとに別の暗号化の箱を持つ | 横断画面を出すたびに全部開くことになり、合言葉が1つなら分ける利点が無い |
| 案件ごとに別の合言葉 | 横断のたびに全部の合言葉が要る |
| 案件 ID を台帳の中に持つ | 書き出したファイルを別の PC で読み込むと ID がぶつかりうる。保存の入れ物の側で振る |
| テストを要件の中の配列として持つ | 画面・連携からのテストもあり、状態の更新を差分で受けにくい。独立した種別にする |
| 横断画面での編集 | 案件の切り替えと取り消しの単位が複雑になる。押したら案件に移動して、そこで操作する |
