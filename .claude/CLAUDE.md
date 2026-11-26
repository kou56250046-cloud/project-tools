# 案件ワークベンチ

SIer の PM/SE が1人で使う、案件台帳のツール。会社PC（Gemini・NotebookLM・ブラウザのみ）で、
「HTMLが指示文を作る → Gemini が差分JSONを返す → HTMLで確認して取り込む」を往復して台帳を育てる。

**何ではないか:** チームで共有するツールではない。サーバーも API 連携も持たない。文書作成ツールでもない（文書は台帳の見せ方）。

---

## 絶対的な制約

### 1. npm 依存ゼロ
- `package.json` の `dependencies` と `devDependencies` は空のまま
- ビルド・テストは Node 標準モジュールと `node --test` だけ

### 2. オフラインで動き、実行時に一切通信しない
- CDN・外部フォント・外部画像を使わない
- CSP（`build.mjs` が script / style のハッシュで生成）で外部通信を禁止している。`unsafe-inline` にしない
- HTML の属性に `style="…"` を書かない（CSP で弾かれる）。JS から `el.style.x = …` は可
- 図は台帳が実行時に変わるため、**実行時に SVG を描く**（テンプレの「生成時に静的 SVG」とは違う）

### 3. `file://` で開ける
- 生成物は `index.html` 1ファイル。`fetch()` を使わない
- データは localStorage（キーは `anken-workbench:v1:` で始める）と、書き出した JSON ファイル
- **localStorage には平文で保存しない。** file:// のページどうしは保存領域を共有するため、合言葉（PBKDF2→AES-GCM、`src/core/vault.js`）で暗号化した箱だけを置く。鍵はメモリのみ
- 外部由来の JSON は `safeParse`（`src/core/extract.js`）で読む。定義の表はプロトタイプを持たない辞書にする（`schema.js` の `dict`）
- 自動確認用の `window.__workbench` は URL に `?debug` を付けたときだけ公開する
- 暗号化の箱の中身は複数案件の入れ物（`src/core/workspace.js`）。`store.ledger` は今開いている案件を返す getter。案件ごとに検査し、読めない案件だけ退避する
- 台帳の形を変えるときは、古い保存が読めなくなっても上書きで消えないこと（退避の仕組みは `store.recovery`。案件ごとに暗号化して残す）を確かめる

### 4. 外部サービスを使わない
- GitHub Pages は**配布（HTMLのダウンロード）にだけ**使う。実行時の通信はしない

### 5. 案件データをリポジトリに入れない
- サンプルはダミーのみ（`samples/`）。実案件の書き出しファイルは `.gitignore` で除外している
- 関係者の氏名・所属は台帳に入れてよい（ユーザー承認済み）。ただし会社PCの中だけで扱う

---

## 構成

```
src/core/       DOMに触れない処理。test から import する
src/ui/         画面
src/shell.html  骨組み
src/styles.css
build.mjs       src を連結して index.html を作る
test/           node --test
samples/        ダミーの台帳・差分・壊れた返答
index.html      生成物（コミットする。GitHub Pages がこれを配る）
```

## コマンド

```bash
node build.mjs      # index.html を作る
node --test "test/*.test.mjs"   # テスト
python -m http.server 8765   # Playwright で確かめるとき（file:// は Playwright で開けない）
```

## 書き方の規則

- src のファイルは ES module。import は `import { a } from './x.js';` の1行形式だけ
- ビルドで全ファイルが1つのスコープに入る。トップレベルの名前はファイル間で重複させない（ビルドが止まる）
- 外部由来の文字列（台帳・差分）は `textContent` でだけ描画する。`innerHTML` を使わない
- 種別・列挙値・参照フィールドは `src/core/schema.js` の表だけで定義する。他で列挙し直さない

## 仕様

- `.claude/specs/workbench-p1/` — P1（土台と往復）。requirements / design / tasks
- `.claude/specs/workbench-p2/` 〜 `workbench-p5/` — P2（要件定義）・P3（計画・進捗・報告）・P4（設計と見積）・P5（テストと横断）。段階をまたぐ決まりは P2 の design.md の最後
- ロードマップ（P1〜P5）: `~/.claude/plans/claude-code-pc-pc-gemini-notebooklm-pc-h-imperative-newell.md`
