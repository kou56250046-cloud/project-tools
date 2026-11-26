// P6a T3: 台帳 → gemini-kit の案件カルテ（anken.v2）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ledgerToKarte, KARTE_SCHEMA, KARTE_VIEWPOINTS } from '../src/core/karte.js';

const load = () => JSON.parse(readFileSync(new URL('../samples/sample-ledger.json', import.meta.url), 'utf8'));
const OPT = { now: '2026-11-26T00:00:00.000Z', today: '2026-11-26' };
const PREFIX = { sources: 'S', facts: 'F', unknowns: 'Q', decisions: 'D', pending: 'H', todos: 'T' };
const LISTS = ['sources', 'facts', 'unknowns', 'decisions', 'pending', 'todos', 'conflicts', 'issues', 'proposals', 'people', 'asis', 'risks', 'reviews'];
// gemini-kit の ENUMS（schema.js）
const ENUMS = { 'sources.kind': ['議事録', '概要', 'マスタ', 'ヒヤリング', 'その他'], 'facts.status': ['確定', '推測'], 'unknowns.priority': ['高', '中', '低'], 'unknowns.status': ['未回答', '依頼中', '回答済'] };

// 端の場合を足した台帳
function edgeLedger() {
  const l = load();
  const set = (id, patch) => Object.assign(l.items.find((it) => it.id === id), patch);
  const first = (kind) => l.items.find((it) => it.kind === kind);
  set(first('requirement').id, { status: 'dropped' });
  set(l.items.filter((it) => it.kind === 'request')[0].id, { status: 'rejected' });
  set(first('constraint').id, { status: 'resolved', confidence: undefined });
  set(first('task').id, { status: 'cancelled' });
  set('QA-002', { status: 'closed', answer: 'クローズ時の回答' });
  set('QA-003', { status: 'answered', answer: '' });
  set('QA-005', { due: '2026-11-01' });
  const r = l.items.filter((it) => it.kind === 'requirement' && it.status === 'draft')[0];
  delete r.confidence;
  first('request').sources = [{ type: 'template', ref: '案件の型' }];
  return l;
}

function checkShape(karte) {
  assert.equal(karte.schema, KARTE_SCHEMA);
  assert.ok(karte.project.name);
  for (const n of LISTS) assert.ok(Array.isArray(karte[n]), n);
  const ids = new Set();
  for (const [coll, pre] of Object.entries(PREFIX)) {
    for (const it of karte[coll]) {
      assert.match(it.id, new RegExp(`^${pre}-\\d{2,}$`), `${coll} ${it.id}`);
      assert.ok(!ids.has(it.id), `重複 ${it.id}`);
      ids.add(it.id);
      if ('viewpoint' in it && it.viewpoint) assert.ok(KARTE_VIEWPOINTS.includes(it.viewpoint), it.viewpoint);
      for (const [key, vals] of Object.entries(ENUMS)) {
        const [c, f] = key.split('.');
        if (c === coll && it[f]) assert.ok(vals.includes(it[f]), `${key} ${it[f]}`);
      }
    }
  }
  const src = new Set(karte.sources.map((s) => s.id));
  for (const coll of ['facts', 'unknowns', 'decisions', 'pending', 'todos']) {
    for (const it of karte[coll]) {
      if (it.source) assert.ok(src.has(it.source), `${it.id} の source ${it.source}`);
      if (coll !== 'sources') assert.equal(it.quote ?? '', '');
    }
  }
  const factIds = new Set(karte.facts.map((f) => f.id));
  for (const u of karte.unknowns) {
    if (u.raisedIn) assert.ok(src.has(u.raisedIn));
    if (u.answeredBy) assert.ok(factIds.has(u.answeredBy));
  }
}

test('サンプル台帳の書き出しは anken.v2 の形で、ID・参照・列挙値が正しい', () => {
  const l = load();
  const before = JSON.stringify(l);
  const { karte, counts } = ledgerToKarte(l, OPT);
  checkShape(karte);
  assert.equal(JSON.stringify(l), before, '台帳を変えない');
  assert.equal(counts.facts, karte.facts.length);
  assert.equal(karte.workbench.revision, l.revision);
  assert.equal(karte.project.client, l.project.customer);
});

test('ID は台帳の ID から決まり、項目を足しても既存の ID は変わらない', () => {
  const l = load();
  const a = ledgerToKarte(l, OPT).karte;
  const re = a.facts.find((f) => f.wbId === 'RE-001');
  assert.equal(re.id, 'F-10001');
  assert.equal(a.unknowns.find((u) => u.wbId === 'QA-004').id, 'Q-04');
  assert.equal(a.facts.find((f) => f.wbId === 'QA-004#answer').id, 'F-40004');
  assert.equal(a.workbench.idMap['F-40004'], 'QA-004#answer');
  for (const [k, v] of Object.entries(a.workbench.idMap)) {
    const all = [...a.facts, ...a.unknowns, ...a.decisions, ...a.pending, ...a.todos];
    assert.equal(all.find((x) => x.id === k).wbId, v);
  }
  // 要件を 1 件足して書き出し直す
  l.items.unshift({ id: 'RE-099', kind: 'requirement', title: '追加の要件', status: 'draft', category: 'functional' });
  const b = ledgerToKarte(l, OPT).karte;
  for (const f of a.facts) assert.equal(b.facts.find((x) => x.wbId === f.wbId).id, f.id);
});

test('取り下げ・不採用・解消・置き換え済み・完了・中止・クローズを消さずに状態で表す', () => {
  const l = edgeLedger();
  const { karte } = ledgerToKarte(l, OPT);
  checkShape(karte);
  const by = (coll, wb) => karte[coll].find((x) => x.wbId === wb);
  const dropped = l.items.find((it) => it.kind === 'requirement' && it.status === 'dropped');
  assert.equal(by('facts', dropped.id).scope, '対象外');
  assert.match(by('facts', dropped.id).text, /（取り下げ）$/);
  const rejected = l.items.find((it) => it.kind === 'request' && it.status === 'rejected');
  assert.match(by('facts', rejected.id).text, /（不採用）$/);
  assert.equal(by('facts', rejected.id).scope, '対象外');
  const resolved = l.items.find((it) => it.kind === 'constraint' && it.status === 'resolved');
  assert.match(by('facts', resolved.id).text, /（解消）$/);
  assert.equal(by('facts', resolved.id).status, '推測');   // 確度なしの制約は推測
  const sup = l.items.find((it) => it.kind === 'decision' && it.status === 'superseded');
  assert.match(by('decisions', sup.id).text, /^（置き換え済み）/);
  const closedIssue = l.items.find((it) => it.kind === 'issue' && it.status === 'closed');
  assert.equal(by('pending', closedIssue.id).status, '完了');
  const cancelled = l.items.find((it) => it.kind === 'task' && it.status === 'cancelled');
  assert.equal(by('todos', cancelled.id).status, 'クローズ');
  // クローズで回答のある質問 → 回答済・事実あり。回答の無い回答済 → answeredBy 空
  const q2 = by('unknowns', 'QA-002');
  assert.equal(q2.status, '回答済');
  assert.equal(q2.answeredBy, 'F-40002');
  assert.equal(by('facts', 'QA-002#answer').text, 'クローズ時の回答');
  assert.equal(by('facts', 'QA-002#answer').source, '');
  const q3 = by('unknowns', 'QA-003');
  assert.equal(q3.status, '回答済');
  assert.equal(q3.answeredBy, '');
  assert.equal(karte.facts.some((f) => f.wbId === 'QA-003#answer'), false);
  assert.equal(by('unknowns', 'QA-005').priority, '高');   // 期限切れ
  assert.equal(by('unknowns', 'QA-001').status, '依頼中');
  assert.equal(by('unknowns', 'QA-001').askedOn, '2026-10-28');
  assert.equal(by('unknowns', 'QA-001').answeredOn, '');
  // 確度なしの案の要件は推測、合意済みの要件は確度が無くても確定
  const noConf = l.items.find((it) => it.kind === 'requirement' && it.status === 'draft' && it.confidence === undefined);
  assert.equal(by('facts', noConf.id).status, '推測');
  // 案件の型の出典は sources に入らない
  assert.equal(karte.sources.some((s) => s.name === '案件の型'), false);
});

test('社内のみの項目は既定で入らず、含めると入る。注意が条件どおりに出る', () => {
  const l = load();
  const off = ledgerToKarte(l, OPT);
  assert.equal(off.karte.pending.some((p) => p.wbId === 'IS-005'), false);
  assert.ok(off.notes.some((n) => n.includes('社内のみの項目 1 件は書き出しません')));
  assert.ok(off.notes.some((n) => n.includes('消えています')));
  assert.ok(off.notes.some((n) => n.includes('引用がありません')));
  const on = ledgerToKarte(l, { ...OPT, includeInternal: true });
  assert.equal(on.karte.pending.some((p) => p.wbId === 'IS-005'), true);
  assert.equal(on.karte.workbench.includeInternal, true);
  assert.ok(on.notes.some((n) => n.includes('含めます')));
  assert.equal(on.counts.pending, off.counts.pending + 1);
  // 中身を空に戻したことがある台帳
  l.changelog.push({ rev: 99, at: OPT.now, source: 'local', changes: [{ id: 'reset', op: 'reset' }] });
  assert.ok(ledgerToKarte(l, OPT).notes.some((n) => n.includes('別の案件名')));
});

test('観点の対応', () => {
  const { karte } = ledgerToKarte(load(), OPT);
  assert.equal(karte.unknowns.find((u) => u.wbId === 'QA-003').viewpoint, '性能・可用性');
  assert.equal(karte.unknowns.find((u) => u.wbId === 'QA-002').viewpoint, '');
  for (const f of karte.facts) if (f.wbId.startsWith('RQ-')) assert.equal(f.viewpoint, '機能');
});
