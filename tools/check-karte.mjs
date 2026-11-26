// 開発用: カルテの書き出しを、gemini-kit 自身の parse → normalize → validate にかけて確かめる（P6a AC-12）。
// gemini-kit（~/projects/bunsekiya-manage/gemini-kit）が無ければ何もせずに終わる。gemini-kit のファイルは読むだけ。
// 使い方: node tools/check-karte.mjs
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { ledgerToKarte } from '../src/core/karte.js';

const kitSchema = join(homedir(), 'projects', 'bunsekiya-manage', 'gemini-kit', 'src', 'js', 'schema.js');
if (!existsSync(kitSchema)) {
  console.log('gemini-kit が見つからないため飛ばします: ' + kitSchema);
  process.exit(0);
}
const ctx = vm.createContext({});
vm.runInContext(readFileSync(kitSchema, 'utf8'), ctx, { filename: kitSchema });
const S = ctx.GK.schema;

const load = () => JSON.parse(readFileSync(new URL('../samples/sample-ledger.json', import.meta.url), 'utf8'));
// 端の場合: 確度なし・回答済み・回答なしのクローズ・取り下げ・不採用・解消・中止・社内のみ
function edge() {
  const l = load();
  const set = (id, patch) => Object.assign(l.items.find((it) => it.id === id), patch);
  const first = (kind) => l.items.find((it) => it.kind === kind);
  set(first('requirement').id, { status: 'dropped' });
  set(l.items.filter((it) => it.kind === 'request')[0].id, { status: 'rejected', internal: true });
  set(first('constraint').id, { status: 'resolved', confidence: undefined });
  set(first('task').id, { status: 'cancelled' });
  set('QA-002', { status: 'closed', answer: 'クローズ時の回答' });
  set('QA-003', { status: 'closed', answer: '' });
  for (const it of l.items) if (it.kind === 'requirement') delete it.confidence;
  // P7a のリスク（社内のみと共有・発生）
  l.items.push({ id: 'RK-001', kind: 'risk', title: '稼働が遅れる', status: 'open', prob: 5, impact: 4, internal: true, sources: [], links: [] });
  l.items.push({ id: 'RK-002', kind: 'risk', title: '担当の退職', status: 'occurred', prob: 2, impact: 3, response: '引き継ぎ', internal: false, sources: [], links: [] });
  return l;
}

let failed = 0;
for (const [name, ledger] of [['サンプル', load()], ['端の場合', edge()]]) {
  for (const includeInternal of [false, true]) {
    const { karte } = ledgerToKarte(ledger, { includeInternal, now: new Date().toISOString(), today: '2026-11-26' });
    const parsed = S.parse(JSON.stringify(karte));
    const fixes = parsed.fixes || [];
    const k = S.normalize(parsed.data || parsed.karte || parsed);
    const ws = S.validate(k);
    const errors = ws.filter((w) => w.level === 'error');
    const warns = ws.filter((w) => w.level === 'warn' && !/引用（quote）がありません/.test(w.msg));
    const quoteWarns = ws.filter((w) => w.level === 'warn' && /引用（quote）がありません/.test(w.msg)).length;
    const label = `${name}・社内のみ${includeInternal ? 'を含める' : 'を含めない'}`;
    const ok = !fixes.length && !errors.length && !warns.length;
    if (!ok) failed++;
    console.log(`${ok ? 'OK ' : 'NG '} ${label}: 事実 ${k.facts.length}・未回答 ${k.unknowns.length}・決定 ${k.decisions.length}・保留 ${k.pending.length}・ToDo ${k.todos.length}・出典 ${k.sources.length} / 自動修正 ${fixes.length}・error ${errors.length}・warn（引用以外）${warns.length}・引用の warn ${quoteWarns}`);
    for (const w of [...errors, ...warns].slice(0, 10)) console.log(`     ${w.level} ${w.where}: ${w.msg}`);
    for (const f of fixes.slice(0, 5)) console.log(`     fix: ${typeof f === 'string' ? f : JSON.stringify(f)}`);
  }
}
process.exit(failed ? 1 : 0);
