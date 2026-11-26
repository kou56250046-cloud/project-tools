// P7c T1: gemini-kit flow.js から写した記法と配置（gemini-kit tests/kit.test.mjs のフロー図のテストを写した）
// 色のテストは palette を写さないので、test/ui-colors.test.mjs の変数の組み合わせに置き換えた
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FLOWCHART } from '../src/core/flow.js';
import { parseFlowTolerant, flowGeometry } from '../src/core/flowsafe.js';

const fx = (f) => readFileSync(new URL(`./fixtures/flow/${f}`, import.meta.url), 'utf8');

test('フロー記法：サンプルがエラーなく読める', () => {
  const g = FLOWCHART.parse(fx('order-flow.txt'));
  assert.deepEqual(g.errors, []);
  assert.equal(g.lanes.length, 4);
  assert.equal(g.nodes.length, 11);
  assert.equal(g.edges.length, 12);
  assert.equal(g.nodes.find((n) => n.id === 'D').notes.length, 1);
});

test('フロー記法：誤りを行番号つきで返す', () => {
  const g = FLOWCHART.parse('lane A\ntask X @B 処理\nX -> Y\nfoo bar\ntask X @A 重複');
  const lines = g.errors.map((e) => e.line);
  assert.deepEqual(lines, [...lines].sort((a, b) => a - b), '行番号の順に並ぶ');
  const msgs = g.errors.map((e) => `${e.line}:${e.message}`).join('\n');
  assert.match(msgs, /2:レーン「B」は定義されていません/);
  assert.match(msgs, /3:ID「Y」が定義されていません/);
  assert.match(msgs, /4:解釈できない行/);
  assert.match(msgs, /5:ID「X」が2回定義/);
});

test('フロー記法：ラベルに -> を含むノードと全角の ＠ を読める', () => {
  const g = FLOWCHART.parse('lane 営業\ntask A ＠営業 見積->受注\ntask B @営業 次\nA -> B');
  assert.deepEqual(g.errors, []);
  assert.equal(g.nodes[0].label, '見積->受注');
  assert.equal(g.nodes[0].lane, '営業');
});

test('フロー記法：日本語のキーワードと連続矢印・点線', () => {
  const g = FLOWCHART.parse('開始 S 始め\n処理 A 作業\n分岐 B 良いか\n終了 Z 終わり\nS -> A -> B\nB -> Z : はい\nB ..> A : いいえ');
  assert.deepEqual(g.errors, []);
  assert.deepEqual(g.nodes.map((n) => n.type), ['start', 'task', 'decision', 'end']);
  assert.equal(g.edges.length, 4);
  assert.equal(g.edges.find((e) => e.from === 'B' && e.to === 'A').dashed, true);
});

// 線分が箱（端点の箱以外）を通っていないか
function crossings(geo) {
  const bad = [];
  for (const e of geo.edges) {
    for (let k = 0; k + 1 < e.points.length; k++) {
      const [a, b] = [e.points[k], e.points[k + 1]];
      for (const n of geo.nodes) {
        if (n.id === e.from || n.id === e.to) continue;
        const x1 = Math.min(a[0], b[0]), x2 = Math.max(a[0], b[0]), y1 = Math.min(a[1], b[1]), y2 = Math.max(a[1], b[1]);
        if (x2 > n.x + 1 && x1 < n.x + n.w - 1 && y2 > n.y + 1 && y1 < n.y + n.h - 1) bad.push(`${e.from}->${e.to} が ${n.id} を通る`);
      }
    }
  }
  return bad;
}
function overlaps(geo) {
  const bad = [];
  geo.nodes.forEach((a, i) => geo.nodes.slice(i + 1).forEach((b) => {
    if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) bad.push(`${a.id} と ${b.id}`);
  }));
  return bad;
}

test('フロー配置：箱が重ならず、線が他の箱を通らない（サンプルと小さめの寸法）', () => {
  const g = FLOWCHART.parse(fx('order-flow.txt'));
  for (const opt of [{}, { nodeW: 86, decisionW: 102, fontSize: 12, lineH: 15.5, gapMin: 28, laneHeaderW: 72, margin: 4, slotGap: 24 }]) {
    const geo = FLOWCHART.layout(g, opt);
    assert.deepEqual(overlaps(geo), []);
    assert.deepEqual(crossings(geo), []);
    for (const e of geo.edges) for (let k = 0; k + 1 < e.points.length; k++) {
      const [a, b] = [e.points[k], e.points[k + 1]];
      assert.ok(a[0] === b[0] || a[1] === b[1], `${e.from}->${e.to} に斜めの線`);
    }
    for (const n of geo.nodes) {
      const lane = geo.lanes[g.lanes.indexOf(g.nodes.find((x) => x.id === n.id).lane)];
      assert.ok(n.y >= lane.y && n.y + n.h <= lane.y + lane.h, `${n.id} がレーンからはみ出す`);
    }
  }
});

test('フロー配置：分岐が多く段をまたぐ図でも重ならない', () => {
  const src = ['lane 甲', 'lane 乙', 'lane 丙'];
  for (let i = 0; i < 14; i++) src.push(`${i % 4 === 2 ? 'decision' : 'task'} N${i} @${['甲', '乙', '丙'][i % 3]} 手順${i}`);
  for (let i = 0; i < 13; i++) src.push(`N${i} -> N${i + 1}`);
  src.push('N2 -> N9 : いいえ', 'N6 -> N1 : 差し戻し', 'N10 -> N4 : 再確認', 'N0 -> N13');
  const g = FLOWCHART.parse(src.join('\n'));
  assert.deepEqual(g.errors, []);
  const geo = FLOWCHART.layout(g);
  assert.deepEqual(overlaps(geo), []);
  assert.deepEqual(crossings(geo), []);
});

const ROLE_SRC = [
  'lane 申請者 {外部}', 'lane AI エージェント {AI}', 'lane Office Scripts {ルール}', 'lane 担当者 {人}',
  'start S @申請者 申請書を提出', 'task A @[AI エージェント] 書類の項目を読み取る',
  'decision B @[AI エージェント] 書類の種類を判別できたか', 'decision C @[Office Scripts] 必須項目はそろっているか',
  'task D @[Office Scripts] 台帳に登録', 'task F @[Office Scripts] {人} 例外を手で登録', 'task E @担当者 読み取り結果を確認',
  'end Z @担当者 受付完了',
  'S -> A -> B', 'B -> C : はい', 'B -> E : いいえ', 'C -> D : はい', 'C -> F : いいえ', 'F -> D', 'E -> D', 'D -> Z',
].join('\n');

test('フロー区分：レーンの区分がノードに付き、ノード側の区分が優先し、知らない区分は警告して無視する', () => {
  const g = FLOWCHART.parse(ROLE_SRC);
  assert.deepEqual(g.errors, []);
  assert.deepEqual(g.lanes, ['申請者', 'AI エージェント', 'Office Scripts', '担当者']);
  const role = (id) => g.nodes.find((n) => n.id === id).role;
  assert.equal(role('S'), 'ext');
  assert.equal(role('B'), 'ai');
  assert.equal(role('C'), 'rule');
  assert.equal(role('F'), 'human');
  assert.equal(g.nodes.find((n) => n.id === 'F').label, '例外を手で登録');
  const h = FLOWCHART.parse('task A 書類を読む {AI}\ntask B ｛rule｝ 照合する\ntask C {見積}を作る\nA -> B -> C');
  assert.deepEqual(h.nodes.map((n) => [n.role, n.label]), [['ai', '書類を読む'], ['rule', '照合する'], [null, '{見積}を作る']]);
  const w = FLOWCHART.parse('lane 係 {ロボ}\ntask A @係 {謎} 作業\ntask B @係 次\nA -> B');
  assert.deepEqual(w.errors, []);
  assert.equal(w.warnings.filter((x) => /区分「(ロボ|謎)」/.test(x.message)).length, 2);
  assert.ok(w.nodes.every((n) => n.role === null));
});

test('フロー区分：区分のある図でも重ならず、区分名（分岐は判定方式）と凡例が出る', () => {
  const geo = FLOWCHART.layout(FLOWCHART.parse(ROLE_SRC));
  assert.deepEqual(overlaps(geo), []);
  assert.deepEqual(crossings(geo), []);
  const node = (id) => geo.nodes.find((n) => n.id === id);
  assert.equal(FLOWCHART.roleLabel(node('B')), 'AI判断');
  assert.equal(FLOWCHART.roleLabel(node('C')), 'ルール判定');
  assert.equal(FLOWCHART.roleLabel(node('D')), 'ルール');
  assert.deepEqual(geo.roles.map((r) => r.key), ['ai', 'rule', 'human', 'ext']);
});

test('参照の ID: 台帳の接頭辞と JDG・TBL は参照になり、カルテの Q・H・F・D は参照にならない', () => {
  const g = FLOWCHART.parse('task A 確認 [JDG-001, TK-001]\ntask B 照合 [TBL-002 RE-010]\ntask C 次 [Q-04]\ntask E 決定 [D-01]\nA -> B -> C -> E');
  assert.deepEqual(g.errors, []);
  const refs = Object.fromEntries(g.nodes.map((n) => [n.id, n.refs]));
  assert.deepEqual(refs.A, ['JDG-001', 'TK-001']);
  assert.deepEqual(refs.B, ['TBL-002', 'RE-010']);
  assert.deepEqual(refs.C, []);
  assert.deepEqual(refs.E, []);
  assert.equal(g.nodes.find((n) => n.id === 'C').label, '次 [Q-04]', '参照でない括弧はラベルに残る');
});

test('誤りのある行を外して描ける。誤りの行番号は元の記法のまま', () => {
  const src = 'lane A\ntask X @B 処理\ntask Y @A 次\ntask W @A 最後\nX -> Y\nfoo bar\nY -> W';
  const r = flowGeometry(src);
  assert.deepEqual(r.errors.map((e) => e.line), [2, 6]);
  assert.ok(r.dropped.includes(2) && r.dropped.includes(5), '消えた箱への矢印の行も外す');
  assert.deepEqual(r.graph.nodes.map((n) => n.id), ['Y', 'W']);
  assert.ok(r.geo && r.geo.edges.length === 1);
  // 誤りが無ければ外さない
  const ok = parseFlowTolerant(fx('order-flow.txt'));
  assert.deepEqual(ok.dropped, []);
  assert.equal(ok.graph.nodes.length, 11);
  // 描ける行が残らないときは描かない
  assert.equal(flowGeometry('foo bar\nbaz').geo, null);
  assert.equal(flowGeometry('').geo, null);
});

// ---- P7c T2: 業務フロー（種別 bizflow） ----
import { validateLedger, BIZFLOW_NOTATION_MAX } from '../src/core/schema.js';
import { applyLocalOps, validatePatch } from '../src/core/patch.js';
import { runHealth } from '../src/core/health.js';
import { buildPrompt, itemsText } from '../src/core/prompts.js';

const NOW = '2026-11-26T00:00:00.000Z';
const loadLedger = () => JSON.parse(readFileSync(new URL('../samples/sample-ledger.json', import.meta.url), 'utf8'));
const ORDER = fx('order-flow.txt');

test('業務フロー: 画面の操作でも差分でも足せ、検査を通る。記法の上限を超えると誤り', () => {
  const l = loadLedger();
  const r = applyLocalOps(l, [{ op: 'add', item: { kind: 'bizflow', title: '受注（現行）', phase: 'asis', notation: ORDER, status: 'draft' } }], NOW);
  assert.equal(r.ok, true, r.errors && r.errors.join());
  assert.deepEqual(validateLedger(r.ledger), []);
  assert.ok(r.ledger.items.some((it) => it.kind === 'bizflow' && it.id.startsWith('BF-')));
  const v = validatePatch({ type: 'ledger-patch', ops: [
    { op: 'add', tempId: 'new:a', item: { kind: 'bizflow', title: '受注（導入後）', phase: 'tobe', notation: ORDER, links: ['RE-001'] } },
    { op: 'add', tempId: 'new:b', item: { kind: 'bizflow', title: '大きすぎ', phase: 'asis', notation: 'x'.repeat(BIZFLOW_NOTATION_MAX + 1) } },
    { op: 'add', tempId: 'new:c', item: { kind: 'bizflow', title: '区分の誤り', phase: 'later', notation: ORDER } },
  ] }, l);
  assert.deepEqual(v.ops.map((p) => p.errors.length > 0), [false, true, true]);
  assert.ok(v.ops[1].errors.some((e) => /20,000 字まで/.test(e)));
});

test('健康診断: 記法に誤りのある業務フローは flow-error（中）', () => {
  const l = loadLedger();
  const r = applyLocalOps(l, [
    { op: 'add', item: { kind: 'bizflow', title: '良い', phase: 'asis', notation: ORDER } },
    { op: 'add', item: { kind: 'bizflow', title: '悪い', phase: 'tobe', notation: 'task A 一\nA -> B' } },
  ], NOW).ledger;
  const fs = runHealth(r, '2026-11-26').filter((f) => f.code === 'flow-error');
  assert.equal(fs.length, 1);
  assert.equal(fs[0].severity, 'mid');
  assert.match(fs[0].message, /2 行目/);
});

test('指示文「業務フローの作成」: 選んだフローの記法が全文載り、ほかの目的の一覧には記法が出ない', () => {
  const l = loadLedger();
  const marker = 'task QQ @顧客 目印の手順';
  const notation = ORDER.replace('lane 顧客', 'lane 顧客\n' + marker);
  const r = applyLocalOps(l, [{ op: 'add', tempId: 'new:f', item: { kind: 'bizflow', title: '受注（現行）', phase: 'asis', notation } }], NOW);
  const id = r.idMap.get('new:f');
  const p = buildPrompt('bizflow', r.ledger, { today: '2026-11-26', flowId: id });
  assert.ok(p.includes(marker), '選んだフローの記法');
  assert.ok(p.includes(`${id} の update で notation`));
  assert.ok(p.includes('# フロー記法'));
  assert.ok(!/Q・H・F・D/.test(p));
  const none = buildPrompt('bizflow', r.ledger, { today: '2026-11-26' });
  assert.ok(!none.includes(marker) && none.includes('新しいフローを add'));
  for (const purpose of ['initial', 'review-eng', 'material']) assert.ok(!buildPrompt(purpose, r.ledger, { today: '2026-11-26' }).includes(marker), purpose);
  assert.ok(itemsText(r.ledger, true).includes('受注（現行）'));
  assert.ok(!itemsText(r.ledger, true).includes(marker));
});
