# 案件ワークベンチ P1 — 設計

## 全体構成

```
src/
  shell.html          HTMLの骨組み（{{CSP}} {{CSS}} {{JS}} を差し込む）
  styles.css
  core/               DOMに触れない純粋な処理。Node のテストから直接 import する
    schema.js         種別定義・列挙値・台帳と項目の検証
    extract.js        Gemini の返答から JSON を取り出す寛容なパーサ
    patch.js          差分の検証・採番・適用（新しい台帳を返す。元は変えない）
    health.js         健康診断
    prompts.js        指示文の生成
    starter.js        案件の型（業務システム新規）
  ui/                 DOMを扱う画面
    dom.js            要素生成の小道具（h()、textContent のみ）
    store.js          状態・localStorage・取り消し・書き出し状態
    views/*.js        overview / graph / list / decisions / health / import / prompts / settings
    detail.js         詳細パネル
  app.js              起動・タブ切替
build.mjs             src を連結して index.html を作る（node:fs, node:crypto のみ）
test/*.test.mjs       node --test
samples/              ダミーの台帳・差分・壊れた差分
index.html            生成物（コミットする。GitHub Pages がこれを配る）
```

### ビルド
- `build.mjs` は決められた順でファイルを連結し、`import` 行を消し、`export ` を外して1つの `<script>` にまとめる（全ファイルが同じスコープに入る。名前の衝突はビルドで検出して止める）
- スクリプトと CSS の SHA-256 を計算し、CSP の `script-src` と `style-src` にハッシュで書く（`unsafe-inline` を使わない）
- `package.json` は `"type": "module"` と scripts だけ。依存は空

### CSP
```
default-src 'none'; script-src 'sha256-…'; style-src 'sha256-…';
img-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'
```
- HTMLの属性に `style="…"` を書かない（CSP で弾かれる）。JS からの `el.style.x = …` は許される
- JSON の書き出しは Blob + `<a download>`。ダウンロードは CSP の対象外
- favicon の自動取得を止めるため、shell.html に `<link rel="icon" href="data:,">` を入れる
- 「HTMLをダウンロード」は `<a href="./index.html" download>`。通信せずに同じ場所の本体を保存させる（GitHub Pages のときだけ表示。`location.protocol !== 'file:'`）

## データ構造

### 台帳
```ts
type Ledger = {
  schemaVersion: 1;
  type: "ledger";
  revision: number;             // 適用のたびに +1
  project: Project;
  items: Item[];
  relations: Relation[];
  counters: Record<Prefix, number>;  // 種別ごとの最終連番
  updatedAt: string;            // ISO 日時
};

type Project = {
  name: string; customer?: string; purpose?: string;
  periodStart?: string; periodEnd?: string;   // YYYY-MM-DD
  goals?: string[]; summary?: string;
  starter?: "business-system-new" | null;
};

type Confidence = "fact" | "guess" | "confirmed";   // 事実 / 推測 / 確認済み
type Source = {
  type: "meeting" | "doc" | "mail" | "chat" | "template" | "other";
  ref: string;                  // 会議名・資料名・メール件名など
  date?: string;                // YYYY-MM-DD（いつ言われたか）
  speaker?: ID;                 // 関係者 ID（誰が言ったか）
  note?: string;
};

type ItemBase = {
  id: string; kind: Kind; title: string; body?: string;
  status: string;               // 種別ごとの列挙（下表）
  confidence: Confidence;
  sources: Source[];
  links: string[];              // 関係する項目の ID
  tags?: string[];
  createdAt: string; updatedAt: string;
};
```

### 種別ごとの定義（`schema.js` の KINDS 表で一元管理）

| kind | 接頭辞 | 表示名 | 状態 | 追加の項目 |
|---|---|---|---|---|
| stakeholder | SH | 関係者 | active / inactive | side: customer/own/vendor, org?, role? |
| system | SY | システム | existing / planned / retired | owner?: ID |
| request | RQ | 要望 | open / accepted / rejected / deferred | owner?: ID, priority?: Must/Should/Could/Wont |
| constraint | CN | 制約 | active / resolved | category: budget/schedule/technical/legal/operation/other |
| requirement | RE | 要件 | draft / agreed / dropped | priority?, category: functional/nonfunctional |
| decision | DC | 決定 | valid / superseded | decidedAt: date, decidedBy: ID[], reason?, alternatives?: string[], supersedes?: ID |
| issue | IS | 課題 | open / in_progress / closed | owner?: ID, due?: date, severity?: high/mid/low |
| question | QA | 質問 | open / answered / closed | askTo?: ID, due?: date, answer? |

- 「未完了」は issue の open / in_progress、question の open
- ID の形式は `^(SH|SY|RQ|CN|RE|DC|IS|QA)-\d{3,}$`

### 関係
```ts
type Relation = { id: string /* RL-001 */; from: ID; to: ID; label: string };
```
from / to は stakeholder か system のみ。

### 参照フィールド（ここが唯一の定義。逆参照・健康診断・関係図・tempId の後始末はすべてこの表を使う）

`schema.js` に `REF_FIELDS` として持つ。

| フィールド | 持つ種別 | 形 | 参照先の種別 | 参照先の追加が却下されたとき |
|---|---|---|---|---|
| links | 全種別 | 配列 | 全種別 | その要素を外す |
| sources[].speaker | 全種別 | 単一（出典ごと） | stakeholder | その出典の speaker を消す（出典は残す） |
| owner | system, request, issue | 単一 | stakeholder | フィールドを消す |
| askTo | question | 単一 | stakeholder | フィールドを消す |
| decidedBy | decision | 配列 | stakeholder | その要素を外す |
| supersedes | decision | 単一 | decision | フィールドを消す |
| relation.from / to | 関係 | 単一 | stakeholder, system | relate 操作ごと自動で却下する |

- 参照先の種別が違う（例: owner に要件の ID）ときは誤り
- 上の後始末をしたカードには「参照先 new:2 の追加が却下されたため、owner を外します」の形で警告を出す

### localStorage のキー
- `anken-workbench:v1:ledger` 台帳
- `anken-workbench:v1:exportedRevision` 最後に書き出した revision
- 取り消し用の「適用前の台帳」はメモリにだけ持つ（容量を2倍にしないため）

### 差分（Gemini が返す形）
```ts
type Patch = {
  type: "ledger-patch";
  schemaVersion: 1;
  basedOnRevision?: number;     // 指示文に入れた revision。食い違えば警告（エラーにはしない）
  ops: Op[];
};
type Op =
  | { op: "add"; tempId?: string /* "new:1" */; item: Omit<Item, "id"|"createdAt"|"updatedAt"> }
  | { op: "update"; id: ID; set: Partial<Item>; reason?: string }
  | { op: "relate"; from: ID | TempId; to: ID | TempId; label: string }
  | { op: "project"; set: Partial<Project> };
```
- update で変えられないもの: id, kind, createdAt（指定されたら誤り）
- 配列の項目（links, sources, tags）は update で置き換え。links だけは `addLinks` を受け付けて追記もできる
- 省略された status・confidence・sources・links は既定値（各種別の最初の状態 / guess / [] / []）で補う

### 取込の処理状態（メモリのみ）
```ts
type ParsedOp = { index: number; op: Op; errors: string[]; warnings: string[]; accepted: boolean };
```

## 処理の流れ

### 差分の取込
1. 貼り付けた文字列 → `extractJson(text)`
   - ```json … ``` / ``` … ``` の中を優先 → なければ最初の `{` から括弧の対応が取れる `}` まで → `JSON.parse`
   - 失敗したら、末尾のカンマ・全角の引用符 `“ ”` を直して1回だけ再挑戦。だめなら「JSONとして読めません（○行目付近）」
   - 配列だけが返ってきたら `{type:"ledger-patch", ops: 配列}` とみなす
2. `validatePatch(patch, ledger)` → ParsedOp[]
   - 形・種別・列挙値・日付形式（YYYY-MM-DD）・ID の存在（既存 ID または同じ差分内の tempId）を検査
   - エラーは「操作3（追加・課題）: status 'done' は使えません。使える値: open, in_progress, closed」の形
3. 画面にカード表示。誤りのあるカードは「却下」に固定。正しいカードは誤りがあっても適用できる。採用が0件なら「適用」を押せない
   - 採用/却下を切り替えるたびに `planPatch` を再計算し、参照先が却下された操作のカードに警告を出す（後始末の内容は参照フィールド表）
4. 「適用」→ `applyPatch(ledger, acceptedOps, now)` が新しい台帳を返す
   - 採番: 種別ごとに counters を進め、tempId → 本 ID の対応表で参照フィールドをすべて置き換える
   - 却下された tempId を参照している値は参照フィールド表に従って後始末する
   - 決定の追加で supersedes があれば、置き換えられた決定の status を superseded にする（AC-13b）
   - revision +1、updatedAt を更新
5. store が「適用前の台帳」を1つだけ保持 → 取り消しはそれに戻す
6. localStorage へ保存、未書き出しの印を付ける

### ファイルの読み込み（AC-22）
1. `JSON.parse`（寛容なパーサは使わない。台帳は自分で書き出したもののため）
2. `validateLedger(obj, {allowDanglingRefs: true})`。形・種別・列挙値の誤りがあれば読み込まず、先頭10件の誤りを表示
3. 確認 → 置き換え → exportedRevision を読み込んだ revision にする → 取り消しを空にする

### 詳細パネルでの変更（AC-18）
内部で `{op:"update"}` の差分を作り、取込と同じ `applyPatch` を通す。処理の経路を1本にする。

### 健康診断
`runHealth(ledger, today)` → `Finding[] = {severity, code, itemId, message}`。純粋関数。描画のたびに再計算（500件以下を想定）。

### 指示文
`buildPrompt(purpose, ledger, options)` → string。構成:
1. 役割と目的（目的ごとの本文）
2. 出力の規則: 「JSONのみを ```json で1つ返す」「新規は tempId `new:N` を使い、既存は ID で参照」「分からないことは confidence:"guess"、根拠は sources に」「既存と同じ内容は追加せず update にする」
3. 差分の形式・使える kind と値の一覧（KINDS 表から自動生成。指示文とスキーマが食い違わない）
4. 小さな例（add・update・relate を1つずつ）
5. 案件の概要と revision
6. 今の項目一覧: `ID | 種別 | 状態 | 題名` を1行ずつ（本文は入れない。長さを抑える）
7. `--- ここから資料 ---`（ユーザーが貼る位置）

NotebookLM 用だけは 2〜4 を入れず、AC-06 の見出し構成での箇条書きを求める。

目的10種: 初期作成 / 議事録取込 / 資料からの追加 / レビュー（エンジニア・PL・PM・利用者・運用者）/ 自由指示 / NotebookLM 用の要点整理

立場別レビューは5種。作る側（エンジニア / PL / PM）と使う側（利用者 / 運用者）。2026-11-25 ユーザーの提案で、当初の4種（情シス / 運用担当 / 品質保証 / 顧客側PM）から変更。項目の本文まで含め、結果は issue / question の add で返させる。
修正依頼文は `buildFixPrompt(errors)`。

### 関係図のレイアウト
- 列: 顧客 / 自社 / 協力会社 / システム（左から）。列の中は ID 順に縦に並べる
- ノードの大きさは固定（幅160×高さ40）。縦の間隔は64px。ノードどうしは重ならない
- 線は列の間を3次ベジェ曲線で結び、ラベルは線の中点に置く。同じ列の中の線は外側へ弧を描く
- ラベルの重なりを避ける: 描いたラベルの矩形を記録し、重なるものは縦に 16px ずつずらす（最大6回）。それでも重なるものは省略して線だけにし、ホバーと詳細パネルで読めるようにする
- ノードを押す → つながるノードと線以外を薄くする。もう一度押すか背景を押すと戻る

## 再利用（reuse-scout の結果）

| 部品 | 元 | 扱い |
|---|---|---|
| 一覧表の並べ替え | `~/.claude/skills/dashboard/assets/dash.js:815-857` `table()` | 改変して流用。`el`・`frame` への依存を外し、絞り込みを足す |
| Blob 保存 | `~/projects/ai-agents/index.html:1205-1211` `download()` | 改変して流用 |
| localStorage の読み書き | `~/projects/ai-agents/index.html:1178-1193` `load/save` | 改変して流用（失敗時は画面に警告） |
| クリップボードへのコピー | `~/projects/ai-agents/index.html:1213-1229` `copyText/fallbackCopy` | 改変して流用。file:// では `isSecureContext` が偽になることがあるので代替経路が必須 |
| CSP | `~/projects/security-check/index.html:7` | 参考。こちらは `unsafe-inline` なので、ハッシュ指定に強める |
| 関係図 | `dash.js:1154-1255` `forceLayout/network` | 参考のみ。エッジのラベル・矢印・クリックでの詳細が無く、列レイアウトを採るため新規に書く |
| 寛容な JSON パース・差分の検証 | なし | 新規に書く |
| 自分自身の保存 | `~/projects/emali-data-exstract/index.html:3569` `PRISTINE = outerHTML` | 採らない。直列化し直すとスクリプトの文字列が変わり、CSP のハッシュと合わなくなるおそれがある。`<a href="./index.html" download>` にする |

## 触るファイル

| ファイル | 変更内容 |
|---|---|
| `.claude/CLAUDE.md` | static-zero テンプレから作成し、このプロジェクト用に書き換える |
| `package.json` | type:module と scripts（build, test）のみ |
| `build.mjs` | 連結・CSP ハッシュ・名前衝突の検出 |
| `src/shell.html` `src/styles.css` | 骨組みと見た目 |
| `src/core/*.js` | 上記6ファイル |
| `src/ui/*.js` `src/ui/views/*.js` `src/app.js` | 画面 |
| `test/*.test.mjs` | core のテスト |
| `samples/*.json` `samples/*.txt` | ダミー台帳・差分・壊れた返答の例 |
| `index.html` | ビルドの生成物 |
| `README.md` | 会社PCでの使い方・Gem の作り方 |
| `.gitignore` | `private/`、`*.ledger.json`（実案件の書き出し名）を除外 |

## 検討した代替案

| 案 | 採らなかった理由 |
|---|---|
| index.html を直接1ファイルで書く | 2,000行を超える見込み。core をテストから import できない |
| `<script type="module">` で src を読む | file:// では別ファイルの module を読めない |
| 種別ごとに別の配列（requests, issues…）を持つ | 差分・ID・健康診断・一覧の処理が種別の数だけ重複する。1つの items 配列と KINDS 表にした |
| Gemini に台帳の全体を返させる | 長い台帳で出力が途中で切れる。既存の内容を勝手に書き換えられても気づけない |
| Gemini に本 ID を採番させる | 既存 ID との重複が起きる。tempId を HTML 側で置き換える |
| 力学レイアウトの関係図 | 毎回配置が変わり、画面共有で説明しにくい。列で分ける方が立場が一目で分かる |
| CSP を `unsafe-inline` で書く | 台帳の文字列経由でスクリプトが入り込む余地が残る。ハッシュ指定にした |
| JSON Schema の汎用バリデータを自作 | 必要な検査は KINDS 表から書ける。汎用化は過剰 |
| File System Access API で自動保存 | file:// での動作が未確認。P1 は localStorage と書き出しで足りる |
