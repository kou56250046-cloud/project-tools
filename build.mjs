// src/ を連結して index.html を1ファイル作る。依存ゼロ（node:fs, node:path, node:crypto のみ）。
//
// 規則:
// - src のファイルは ES module として書く（test から import するため）
// - import は1行で書く。ビルド時に行ごと消し、全ファイルを1つのスコープに入れる
// - トップレベルの名前がファイル間で衝突したらビルドを止める
// - CSP は script / style のハッシュで許可する（unsafe-inline を使わない）

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, 'src');

// 写した部品（ES module ではない）。import の除去と名前の衝突の検査をせず、そのまま本体の前に入れる
// dash.js は window.Dash だけを作る（test/build.test.mjs で確かめる）
export const VENDOR_JS = ['vendor/dash.js'];
export const VENDOR_CSS = ['vendor/dash.css'];

// 連結の順番。依存される側を先に置く
export const JS_FILES = [
  'core/schema.js',
  'core/screens.js',
  'core/guide-text.js',
  'core/guide-flow.js',
  'core/nfr.js',
  'core/extract.js',
  'core/patch.js',
  'core/ball.js',
  'core/raci.js',
  'core/wbs.js',
  'core/evm.js',
  'core/health.js',
  'core/impact.js',
  'core/report.js',
  'core/fp.js',
  'core/ddl.js',
  'core/erlayout.js',
  'core/csv.js',
  'core/zip.js',
  'core/xlsx.js',
  'core/tableprep.js',
  'core/convert.js',
  'core/gemini-convert.js',
  'core/transcript.js',
  'core/chat.js',
  'core/mask.js',
  'core/mastercheck.js',
  'core/trace.js',
  'core/workspace.js',
  'core/cross.js',
  'core/org.js',
  'core/kpi.js',
  'core/risk.js',
  'core/flow.js',
  'core/flowsafe.js',
  'core/flow-format.js',
  'core/shapeflow.js',
  'core/smartart.js',
  'core/fidelity.js',
  'core/judge-prompts.js',
  'core/arch.js',
  'core/mdblocks.js',
  'core/mdhtml.js',
  'core/table-def.js',
  'core/judge.js',
  'core/judge-sample.js',
  'core/karte.js',
  'core/dashboard.js',
  'core/hearing.js',
  'core/prompts.js',
  'core/starter.js',
  'core/vault.js',
  'ui/dom.js',
  'ui/flowsvg.js',
  'ui/store.js',
  'ui/lock.js',
  'ui/detail.js',
  'ui/chart.js',
  'ui/views/overview.js',
  'ui/views/graph.js',
  'ui/views/list.js',
  'ui/views/decisions.js',
  'ui/views/health.js',
  'ui/views/import.js',
  'ui/views/prompts.js',
  'ui/views/settings.js',
  'ui/views/hearing.js',
  'ui/views/issues.js',
  'ui/views/nfr.js',
  'ui/views/scope.js',
  'ui/views/wbs.js',
  'ui/views/gantt.js',
  'ui/views/progress.js',
  'ui/views/changes.js',
  'ui/views/meeting-report.js',
  'ui/views/data.js',
  'ui/views/functions.js',
  'ui/views/crud.js',
  'ui/views/estimate.js',
  'ui/views/master.js',
  'ui/views/trace.js',
  'ui/views/tests.js',
  'ui/views/cross.js',
  'ui/views/convert.js',
  'ui/views/memos.js',
  'ui/views/preprocess.js',
  'ui/views/mask.js',
  'ui/views/kpi-tree.js',
  'ui/views/bizflow.js',
  'ui/views/arch.js',
  'ui/views/judge.js',
  'ui/views/risks.js',
  'ui/views/org.js',
  'ui/views/guide.js',
  'app.js',
];

const DECL_RE = /^(?:export\s+)?(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;

export function stripModule(code, file) {
  const out = [];
  for (const line of code.split(/\r?\n/)) {
    if (/^\s*import\s/.test(line)) {
      if (!/^\s*import\s+\{[^}]*\}\s+from\s+['"][^'"]+['"];?\s*$/.test(line)) {
        throw new Error(`${file}: import は「import { a, b } from './x.js';」の1行形式だけ使えます: ${line.trim()}`);
      }
      continue;
    }
    if (/^\s*export\s+default\b/.test(line)) throw new Error(`${file}: export default は使えません`);
    if (/^\s*export\s*\{/.test(line)) throw new Error(`${file}: export { } は使えません。宣言に export を付けてください`);
    out.push(line.replace(/^export\s+/, ''));
  }
  return out.join('\n');
}

export function findCollisions(files) {
  const seen = new Map();
  const errors = [];
  for (const { file, code } of files) {
    for (const m of code.matchAll(DECL_RE)) {
      const name = m[1];
      if (seen.has(name)) errors.push(`名前「${name}」が ${seen.get(name)} と ${file} の両方で定義されています`);
      else seen.set(name, file);
    }
  }
  return errors;
}

const sha = (s) => "'sha256-" + createHash('sha256').update(s, 'utf8').digest('base64') + "'";

export function build({ files = JS_FILES, write = true } = {}) {
  const sources = files.map((f) => ({ file: f, code: readFileSync(join(SRC, f), 'utf8') }));
  const collisions = findCollisions(sources);
  if (collisions.length) throw new Error('ビルド失敗:\n' + collisions.join('\n'));

  const body = sources.map(({ file, code }) => `// ---- ${file} ----\n` + stripModule(code, file)).join('\n\n');
  const vendor = VENDOR_JS.map((f) => `// ---- ${f} ----\n` + readFileSync(join(SRC, f), 'utf8')).join('\n');
  const js = `\n${vendor}\n(() => {\n'use strict';\n${body}\n})();\n`;
  if (/<\/script/i.test(js)) throw new Error('ビルド失敗: スクリプト内に </script が含まれています');

  const css = '\n' + [join(SRC, 'styles.css'), ...VENDOR_CSS.map((f) => join(SRC, f))].map((p) => readFileSync(p, 'utf8')).join('\n') + '\n';
  const csp = [
    "default-src 'none'",
    `script-src ${sha(js)}`,
    `style-src ${sha(css)}`,
    'img-src data: blob:',
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');

  const shell = readFileSync(join(SRC, 'shell.html'), 'utf8');
  for (const key of ['{{CSP}}', '{{CSS}}', '{{JS}}']) {
    if (!shell.includes(key)) throw new Error(`ビルド失敗: shell.html に ${key} がありません`);
  }
  // 置換文字列中の $ を特別扱いさせないため関数で置き換える
  const html = shell
    .replace('{{CSP}}', () => csp)
    .replace('{{CSS}}', () => css)
    .replace('{{JS}}', () => js);
  if (write) writeFileSync(join(ROOT, 'index.html'), html);
  return html;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const html = build();
    console.log(`index.html を作成しました（${(Buffer.byteLength(html) / 1024).toFixed(1)} KB）`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
