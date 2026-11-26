# 案件ワークベンチ P2 — 設計

## データ構造

### 台帳（版 2）
```ts
type Ledger = {
  schemaVersion: 2;                 // 1 → 2
  // P1 の項目はそのまま
  baselines: Baseline[];            // 追加（AC-17）
  changelog: ChangeEntry[];         // 追加（AC-C3）。新しい 2,000 件まで
  settings: { ballWaitDays: number }; // 追加。既定 7
};

type Baseline = {
  id: string;            // BL-001
  name: string;          // 例: 要件定義 合意版
  date: string;          // YYYY-MM-DD
  items: { id: ID; kind: 'request' | 'requirement'; title: string; scope: Scope; status: string }[];
};

type ChangeEntry = {
  rev: number;           // 適用後の revision
  at: string;            // ISO 日時
  source: 'import' | 'local' | 'hearing';
  changes: { id: ID; op: 'add' | 'update' | 'relate' | 'project'; kind?: Kind; fields?: string[]; statusFrom?: string; statusTo?: string }[];
};
```

### 移行（`schema.js` の `migrateLedger(obj) → { ledger, migrated: boolean }`）
- 版 1: `baselines: []`、`changelog: []`、`settings: { ballWaitDays: 7 }` を足し、`schemaVersion: 2` にする。項目は変えない
- 版 2: そのまま
- それ以外（未来の版・不明）: 移行しない。呼び出し側は P1 と同じく「読めない」扱いにして退避する
- `store.unlock` / `parseLedgerFile` / 旧平文の読み込みの3か所は、検査の前に必ず `migrateLedger` を通す
- 取り消し（undo）は移行後の台帳どうしで行うので、影響しない

### 種別・項目の追加（`KINDS` 表に足すだけ）
| 種別 | 接頭辞 | 状態 | 項目 |
|---|---|---|---|
| meeting（会議） | MT | planned / held / cancelled | date*（日付）, meetingType*（regular / hearing / review / other）, attendees（関係者 ID の配列）, agenda（文字列の配列） |

| 既存の種別 | 足す項目 |
|---|---|
| question | meeting（会議 ID）, askedAt（日付）, nfrCategory（非機能の大項目。その大項目についての質問であることを示す） |
| request | scope（in / out / tbd）, scopeReason（文字列） |
| requirement | scope, scopeReason, nfrCategory（availability / performance / operability / migration / security / environment） |

- `REF_FIELDS` に `meeting`（question → meeting）と `attendees`（meeting → stakeholder、配列）を足す
- `nfrCategory` は category が nonfunctional のときだけ意味を持つ。functional に付いていたら健康診断ではなく検証で警告（誤りにはしない）

### 非機能の定義（`src/core/nfr.js`、表だけ）
```ts
const NFR = [{ id: 'availability', label: '可用性', points: ['継続性（稼働時間・停止許容）', '耐障害性', '災害対策', '回復性（復旧時間・復旧時点）'] }, …6件];
```
指示文と非機能画面はこの表から作る。

## 処理の流れ

### 変更の記録（AC-C3）
- `applyPatch` が、適用した操作から `ChangeEntry` を作って `changelog` の末尾に足す（純粋関数のまま）。`source` は引数
- update の `fields` は set のキー。status が変わったら `statusFrom` / `statusTo`
- 2,000 件を超えたら古いものから捨てる

### ボール（AC-08〜11、`src/core/ball.js`）
```ts
ballOf(item, ledger): 'customer' | 'own' | 'vendor' | 'unknown'
// question → askTo の関係者の side、issue → owner の side。未完了でなければ null
waitDays(item, today): number   // question は askedAt ?? createdAt の日付、issue は createdAt の日付
```
- 日付はローカル日付で数える（FIX-015 と同じ関数を `health.js` から共有する）
- 健康診断の `ball-wait`（中）: ボールが customer かつ waitDays ≥ settings.ballWaitDays

### ヒヤリング（AC-03〜07）
- 候補の生成 `hearingCandidates(ledger, today)` → `{ type: 'question' | 'gap' | 'nfr', ref, text }[]`
  - question: 未回答かつ meeting なし
  - gap: 健康診断の no-owner / no-source / must-guess / stale-guess の項目（「〜を確認する」という文にする）
  - nfr: 要件も質問も無い非機能の大項目
- 候補の「割り当て」は、question なら `update { meeting }`、gap と nfr なら `add question { meeting, links: [元の項目] }` の差分を作り、`applyLocalOps` に通す（経路を1本に保つ）
- 回答の入力: `update { answer, status: 'answered', askedAt }` を `source: 'hearing'` で適用
- 会議を指定した議事録の指示文: `buildPrompt('minutes', ledger, { meetingId })`。会議の情報と、シートの質問（ID・題名）を「この会議で聞いた質問」として入れる

### スコープ（AC-16〜21）
- ベースラインの記録は `{ op: 'baseline', name, date }` の差分にせず、store の専用操作 `recordBaseline(name, date)` とする（Gemini に作らせる操作ではないため。取り消し・変更の記録の対象にはする）
- 「ベースライン後」の判定: 最新ベースラインに ID が無い要望・要件
- 差の計算 `baselineDiff(baseline, ledger)` → added / scopeChanged / dropped（要件 dropped・要望 rejected になったもの）

### 画面の分類（AC-C2）
| 分類 | 画面 |
|---|---|
| 把握 | 概要・関係図・一覧・決定ログ・健康診断 |
| 要件定義 | ヒヤリング・課題と質問・非機能・スコープ |
| 計画・進捗 | （P3） |
| 設計 | （P4） |
| テスト | （P5） |
| 道具 | 指示文・取込・設定 |
- 中身の無い分類は表示しない。URL の # は画面 ID のまま（`#hearing` など）

## 触るファイル

| ファイル | 変更内容 |
|---|---|
| `src/core/schema.js` | 版 2・`migrateLedger`・meeting 種別・項目追加・REF_FIELDS 追加 |
| `src/core/nfr.js`（新規） | 非機能の大項目の表 |
| `src/core/ball.js`（新規） | ボール・待ち日数 |
| `src/core/hearing.js`（新規） | 候補の生成・ベースラインの差 |
| `src/core/patch.js` | 変更の記録 |
| `src/core/health.js` | ball-wait / nfr-missing / scope-no-reason / scope-undecided。日付関数を export |
| `src/core/prompts.js` | 目的2つ追加・会議つき議事録・目的ごとの対象種別 |
| `src/ui/store.js` | 移行の呼び出し・recordBaseline・source の受け渡し |
| `src/app.js` | 2段の画面切り替え |
| `src/ui/views/hearing.js` `issues.js` `nfr.js` `scope.js`（新規） | 画面 |
| `src/ui/detail.js` | 範囲の変更・会議の表示 |
| `src/ui/views/list.js` | 「ベースライン後」の表示 |
| `src/ui/views/settings.js` | この案件の設定（ballWaitDays） |
| `src/core/extract.js` | 配列だけの返答の版 |
| `src/core/starter.js` | createLedger の記録の除去 |
| `build.mjs` | 連結の順に新規ファイルを足す |
| `test/*.test.mjs` | 移行・記録・ボール・候補・差・健康診断・指示文 |
| `samples/sample-ledger.json` | 版 2 にし、会議・範囲・非機能・ベースラインのダミーを足す。版 1 のサンプルは `samples/sample-ledger-v1.json` として残す（移行のテスト用） |

## 検討した代替案

| 案 | 採らなかった理由 |
|---|---|
| ボールを項目に手で持たせる | 付け替え忘れで嘘になる。質問先・担当の立場から決まるので、自動で出す方が正確 |
| ヒヤリング用の別の種別（hearing-item）を作る | 質問と同じものを二重に持つことになる。質問に会議 ID を持たせるだけで足りる |
| ベースラインを台帳全体の写しで持つ | 大きくなり、差の表示に要るのは要望・要件の ID・題名・範囲・状態だけ |
| 変更の記録を持たず、毎回の台帳の写しから差を取る | 保存量が台帳の数倍になる。記録だけなら小さい |
| 非機能を中項目まで管理する | P2 の目的（大項目の抜けに気づく）に対して入力の手間が大きすぎる |
| 版を上げずに任意項目として足す | 版1のファイルに baselines などが無いまま読める必要があり、全ての箇所で無い場合の分岐が要る。移行で1回そろえる方が単純 |

## 段階をまたぐ決まり（spec-reviewer の指摘を受けて。P3〜P5 もこれに従う）

### 項目をまたぐ検査（指摘1）
- `checkIntegrity(ledger) → { errors: { itemId, message }[], warnings }` を `schema.js` に置く。親の循環・前の作業の循環・開始 > 終了（P3）、物理名の重複・外部キーの参照先の列（P4）などの「複数の項目を見ないと分からない検査」はすべてここに足す
- 取込: `planPatch` の後、採用した操作を仮に適用した台帳に `checkIntegrity` をかける。**元の台帳に無かった誤り**が出たら「適用」を押せなくし、その誤りの itemId に触れる操作のカードに表示する（仮IDの項目は振る予定の本 ID で示す）
- 画面での変更（applyLocalOps）も同じ検査を通す
- 読み込み・ロック解除: `checkIntegrity` の誤りでは読み込みを止めない。健康診断の `integrity`（高）として出す（開けなくなるのを防ぐ）

### links の向き（指摘3）
- `links` は向きを持たない。「A と B がつながっている」= A.links に B があるか、B.links に A があるか
- `linkedIds(ledger, id) → Set<ID>` を `schema.js` に置き、P2 以降の「つながっているか」の判定（ヒヤリングの候補・非機能・健康診断・影響範囲・トレーサビリティ）はすべてこれを使う
- P1 の健康診断 unlinked-request も、この関数に置き換える（要件側・要望側のどちらの links でもよい）

### 台帳の設定の変更（指摘5）
- `store.updateSettings(partial)` を置く。revision +1、取り消しの対象、未書き出しの印が付く、変更の記録は `source: 'local'`, `op: 'settings'`, `fields: [変えたキー]`。Gemini の差分では変えさせない（op に入れない）
- 設定の項目と既定値は `schema.js` の `SETTINGS` 表に置く。P2: ballWaitDays（7）。P3 以降はこの表に足す
- 画面は設定画面に「この案件の設定」の欄を足す（`src/ui/views/settings.js` を P2 の触るファイルに足す）

### ベースラインの記録（指摘6）
- `store.recordBaseline(name, date)`: revision +1、`undoLedger` を設定、変更の記録は `op: 'baseline'`, `id: BL-xxx`。採番は `counters.BL`（`normalizeCounters` が baselines の最大番号にそろえる）

### 版 2 の検査の厳しさ（指摘12）
- `baselines` の要素・`changelog` の要素・`settings` の検査は、形（配列・オブジェクト・必要な最小限の項目）だけを見る。不明なキーは誤りにせず、警告にしてそのまま残す（後の段階で足す値で既存の保存が読めなくならないように）

### 移行と新規作成の細部（指摘13）
- `emptyLedger` を版 2 の形（baselines: [] / changelog: [] / settings: 既定値）にする
- `createLedger`（案件の型）は適用後に `changelog` を空に戻し、revision を 0 にする（型の 20 件を「変更」として残さない）
- `extract.js` が配列だけの返答を包むときの `schemaVersion` を `SCHEMA_VERSION` から取る
- 読み込みで移行が起きた（`migrated: true`）ときは「書き出し済み」にしない（版 2 で書き出し直すまで未書き出し）

### 目的ごとの対象種別（指摘16）
| 目的 | 項目一覧に載せる種別 |
|---|---|
| 初期作成・議事録の取込・資料からの追加・自由指示・レビュー5種 | 全種別（P1 と同じ） |
| ヒヤリング質問の生成 | stakeholder, request, constraint, requirement, decision, question, meeting |
| 非機能の洗い出し | requirement, question, constraint, system |
- 表は `prompts.js` の `PURPOSES` に `kinds` として持つ（無ければ全種別）

### ヒヤリングの候補の割り当て（指摘17）
- 非機能の候補: `add question { meeting, nfrCategory, title: '<大項目>について確認する' }`
- 空欄の候補（gap）: その項目と `linkedIds` でつながる未回答の質問が既にあれば、候補から外す。割り当ては `add question { meeting, links: [元の項目] }`
- 未回答の質問の候補: `update { meeting }`

### 非機能の状態の判定（指摘4）
| 状態 | 条件（上から順に当てはめる） |
|---|---|
| 合意済み | その大項目の非機能要件が1件以上あり、取り下げ以外がすべて agreed |
| 定義あり | その大項目の非機能要件（取り下げ以外）が1件以上ある |
| 質問中 | 要件は無いが、その大項目の未回答の質問がある |
| 未着手 | 上のどれでもない（回答済みの質問だけある場合も、要件が無ければ未着手。回答を要件にする作業が残っているため） |
- 健康診断の nfr-missing は「未着手」の大項目を出す

### ボールの起点（確認事項20 への判断）
- 会議が割り当てられていて、その会議が planned、かつ askedAt が無い質問は「まだ聞いていない」として ボール＝自社。待ち日数は出さない
- それ以外は質問先の立場で決める。askedAt が無ければ作成日から数える（P1 の台帳には askedAt が無いため）

### build.mjs（指摘14）
- 各段の最初のタスクで、その段で増える src のファイルを `JS_FILES` に足す（P3〜P5 も同じ）

### テストの台帳（指摘15）
- 各段の最初のタスクで `samples/sample-ledger.json` にその段のダミーを足す（P2 なら会議・範囲・非機能・ベースライン）。後のタスクの完了条件は、このサンプルで判定する
