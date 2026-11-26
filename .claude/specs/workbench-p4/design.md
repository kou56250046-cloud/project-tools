# 案件ワークベンチ P4 — 設計

## データ構造

### 種別の追加
| 種別 | 接頭辞 | 状態 | 項目 |
|---|---|---|---|
| entity（テーブル） | EN | draft / fixed / dropped | physicalName*, fileType*（internal / external）, master（真偽）, columns（下記） |
| screen（画面） | SC | draft / fixed / dropped | screenType*（input / inquiry / report）, fields（下記）, crud（下記） |
| interface（連携） | IF | draft / fixed / dropped | system*（システム ID）, direction*（in / out）, method（file / api / db / other）, frequency（文字列）, fields, crud |
| batch（バッチ） | BT | draft / fixed / dropped | trigger（文字列）, frequency（文字列）, crud |

```ts
type Column = { name: string; logical?: string; type: string; length?: number; scale?: number;
                pk?: boolean; required?: boolean; fk?: { entity: ID; column: string }; pattern?: string; note?: string };
type Field = { name: string; type?: string; required?: boolean; source?: { entity: ID; column: string } };
type Crud = { entity: ID; ops: string };   // ops は "C" "R" "U" "D" の組み合わせ（例 "CRU"）
```
- 新しいフィールドの型 `columns` / `fields` / `crud` を `schema.js` に足し、要素ごとに検査する
- 列の型は自由な文字列にせず、論理型の列挙にする: `string / text / int / bigint / decimal / date / datetime / boolean / code`。方言ごとの物理型は DDL 生成で決める
- `REF_FIELDS` に `system`（interface → system）、`columns[].fk.entity`、`fields[].source.entity`、`crud[].entity`（→ entity）を足す。tempId の後始末・逆参照・健康診断はこれで動く。配列の中のオブジェクトの参照は shape `nested` として扱う（参照先が却下されたら、その要素の参照だけ外す。crud はその要素ごと外す）
- 台帳の settings に `productivity`（人日 / FP、任意）と `ddlDialect`・`namingCase`（lower / upper）を足す

### FP の数え方（`src/core/fp.js`）
| 機能の種類 | 元 | 重み |
|---|---|---|
| ILF | テーブル fileType=internal（dropped 以外） | 35 |
| EIF | テーブル fileType=external（dropped 以外） | 15 |
| EI | 画面 input、連携 in、バッチのうち crud に C/U/D を含むもの | 4 |
| EO | 画面 report、連携 out、バッチのうち crud が R だけのもの | 5 |
| EQ | 画面 inquiry | 4 |
- 画面・連携・バッチも dropped は数えない。crud が空のバッチは種類が決まらないので数えず、見積画面に「数えていない機能」として一覧で出す

FP = Σ件数×重み。工数 = FP × 生産性。BAC との差 = (工数 − BAC) / BAC。

## 処理の流れ

### ER 図（`src/ui/views/data.js` + `src/core/erlayout.js`）
- 配置は外部キーを辺とした層割り（`~/.claude/skills/dashboard/assets/dash.js:899` の `layering` を改変して流用: 循環の逆辺の除去・重心法での並べ替え）。層を横に、層の中を縦に並べる
- 箱の高さは列の数で決まる（1 列 18px、上限 20 列。超えたら「…ほか N 列」）。外部キーの線は、参照元の列の行から参照先の主キーの行へ直交の折れ線で結ぶ
- 配置の計算は DOM に依存しない関数にしてテストする

### DDL（`src/core/ddl.js`）
- 型の対応表（論理型 → 方言ごとの物理型）。例: string(n) → VARCHAR(n) / NVARCHAR(n) / VARCHAR2(n CHAR)
- 並び順: 外部キーの参照先が先。循環する外部キーは CREATE の後に ALTER TABLE ADD CONSTRAINT で足す
- 識別子は namingCase に従って変換する。引用符で囲まない（予約語と衝突するものは点検で知らせる）
- コメント: PostgreSQL / Oracle は COMMENT ON、SQL Server は sp_addextendedproperty
- 予約語の表は方言ごとに主なもの（各 60 語前後）を `ddl.js` に持つ

### 配列の項目の更新（指摘10）
- columns / fields / crud の update は丸ごと置き換え（既存の applyPatch のまま）。取込の update カードで、更新前にあって更新後に無い要素（列の name、項目の name、crud の entity）を「消える」として警告する
- 指示文「データ設計」に「テーブルを更新するときは、変えない列も含めて columns を全部返す」を入れる

### 項目をまたぐ検査（P2 の checkIntegrity に足す）
- テーブルの物理名の重複、外部キーの参照先の列が無い、同じテーブル内の列名の重複

### マスタの点検（`src/core/csv.js`・`src/core/mastercheck.js`）
- CSV / TSV の読み取りは、引用符・`""`・引用符の中の改行・CRLF・BOM に対応する状態機械（`~/projects/薬膳/index.html:522` の parseCSV を改変して流用。区切り文字を引数にし、BOM 除去を足す）。区切りは1行目のタブとカンマの数で自動判定
- 見出しは列の物理名か論理名に一致させる。どちらにも合わない見出し・どの見出しにも無い必須列を出す
- 型の検査: int / bigint は整数、decimal は数値と桁数、date は YYYY-MM-DD か YYYY/MM/DD、boolean は 0/1/true/false、string は長さ（文字数）
- 結果は `{ summary: Record<種類, 件数>, issues: { row, column, type, value, message }[] }`。issues は先頭 1,000 件まで表示し、件数は全件数える
- ファイルは ArrayBuffer で読み、文字コードの指定が自動なら `TextDecoder('utf-8', { fatal: true })` で読んで失敗したら `TextDecoder('shift_jis')`（標準機能。依存は増えない）
- 元データは画面のモジュール変数にだけ置き、画面を離れたら捨てる。store・台帳・localStorage に渡さない

### 新しい指示文の目的
| 目的 | 対象種別 | 返させるもの |
|---|---|---|
| データ設計 | requirement, decision, constraint, entity, system | entity の add / update（columns を含む） |
| 画面・連携の洗い出し | requirement, entity, system, screen, interface, batch | screen / interface / batch の add（crud を含む） |

## 触るファイル

| ファイル | 変更内容 |
|---|---|
| `build.mjs` | P4 の新しいファイルを JS_FILES に足す |
| `src/core/schema.js` | 4 種別、columns / fields / crud 型、nested の参照、SETTINGS に productivity・ddlDialect・namingCase、checkIntegrity に物理名・外部キー |
| `src/ui/views/import.js` | 配列の要素が消える警告 |
| `src/core/patch.js` | nested の参照の後始末・置き換え |
| `src/core/fp.js` `ddl.js` `erlayout.js` `csv.js` `mastercheck.js`（新規） | 計算 |
| `src/core/health.js` | 未参照の設計項目・作業の無い要件（どちらも linkedIds で判定）・作成されないテーブル・見積の差 |
| `src/core/prompts.js` | 目的2つ。columns などの説明を種別一覧に出す |
| `src/ui/views/data.js` `crud.js` `estimate.js` `master.js` `functions.js`（新規） | 画面 |
| `src/ui/detail.js` | 列・項目・CRUD の表示 |
| `src/core/impact.js` | 設計の項目を影響範囲に含める（参照フィールドの追加で自動的に入ることを確かめる） |
| `samples/sample-ledger.json` | テーブル 6・画面 5・連携 2・バッチ 1 のダミー |
| `samples/sample-master-*.csv` | 点検用のダミー（正常・違反入り） |
| `test/*.test.mjs` | 検査・FP・DDL（3 方言）・配置・CSV・マスタ点検 |

## 検討した代替案

| 案 | 採らなかった理由 |
|---|---|
| 列を別の種別（column）にする | テーブルとの親子を毎回たどることになり、Gemini も1テーブル分をまとめて返しにくい |
| 列の型を方言の物理型で持つ | 方言を変えるたびに直すことになる。論理型で持ち、DDL で変換する |
| マスタの元データを台帳に入れる | 実データ（個人情報を含みうる）が保存・書き出しに乗る。点検だけで足りる |
| IFPUG 詳細法 | DET / RET を数えるための情報入力が重い。概算で BAC との突き合わせには足りる |
| ER 図を力学配置にする | 毎回配置が変わる。外部キーの向きで層に分ける方が読みやすい |
