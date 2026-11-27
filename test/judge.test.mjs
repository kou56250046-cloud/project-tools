// P7c T4: 判断・データの部品（gemini-kit tests/judge.test.mjs のうち、写した部分を ES module に直したもの）
// 写さなかったテスト: 構築先の型の表・Office Scripts・ER 図・SVG の文字列（toSVG）・カルテの追加分（台帳の質問の差分に置き換えた）
// フィクスチャの根拠の ID は、サンプル台帳の ID に書き直してある（F-01→RE-001・F-02→RE-005・F-03→CN-001・D-01→DC-002・D-02→DC-003・Q-02→QA-001・Q-03→QA-002・Q-04→QA-003）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TABLEDEF, toEntityPatch } from '../src/core/table-def.js';
import { JUDGE } from '../src/core/judge.js';
import { JUDGE_SAMPLE } from '../src/core/judge-sample.js';
import { FLOWCHART } from '../src/core/flow.js';
import { validatePatch, applyPatch } from '../src/core/patch.js';
import { validateLedger } from '../src/core/schema.js';

const fx = (f) => readFileSync(new URL(`./fixtures/judge/${f}`, import.meta.url), 'utf8');
const SAMPLE = { flow: fx('flow.txt'), master: fx('master.md'), tables: fx('tables.md') };
const col = (m, tid, name) => m.tables.find((t) => t.id === tid).cols.find((c) => c.name === name);
const loadLedger = () => JSON.parse(readFileSync(new URL('../samples/sample-ledger.json', import.meta.url), 'utf8'));
const NOW = '2026-11-26T00:00:00.000Z';

test('画面のサンプルは fixtures と同じ中身', () => {
  for (const k of ['flow', 'master', 'tables']) assert.equal(JUDGE_SAMPLE[k], SAMPLE[k], k);
  assert.equal(JUDGE_SAMPLE.cases, fx('cases.md'));
});

// ---------- テーブル定義 ----------
test('テーブル定義：サンプルを警告なしで読める（物理名・区分の行も読む）', () => {
  const m = TABLEDEF.parse(SAMPLE.tables);
  assert.deepEqual(m.warnings, []);
  assert.deepEqual(m.tables.map((t) => [t.id, t.name, t.cols.length, t.physical, t.fileType]), [['TBL-001', '経費申請', 7, 'expense_request', 'internal'], ['TBL-002', '社員', 4, 'employee', 'external'], ['TBL-003', '支払', 4, 'payment', 'internal']]);
  const t1 = m.tables[0];
  assert.equal(t1.desc, '経費の申請 1 件を 1 行');
  assert.deepEqual(t1.basis, ['RE-001']);
  assert.equal(col(m, 'TBL-001', '申請番号').pk, true);
  assert.equal(col(m, 'TBL-001', '申請番号').maxLen, 10);
  assert.equal(col(m, 'TBL-001', '申請者').ref, 'TBL-002');
  assert.deepEqual(col(m, 'TBL-001', '経費種別').choices, ['交通費', '接待費', '備品', 'その他']);
  assert.equal(col(m, 'TBL-001', '金額').min, 0);
  assert.deepEqual(col(m, 'TBL-001', '領収書あり').choices, ['はい', 'いいえ']);
  assert.equal(col(m, 'TBL-002', '部署').state, '要確認');
  assert.equal(col(m, 'TBL-001', '申請日').required, true);
});

test('テーブル定義：```markdown の囲み・型の言い換え・旧書式の列名・範囲の書き方', () => {
  const src = [
    '````markdown',
    '## TBL-010 受注',
    '| 項目（論理） | 項目（物理） | 型 | 桁 | 必須 | 既定値 | キー | 根拠 | 状態 |',
    '|---|---|---|---|---|---|---|---|---|',
    '| 受付番号 | order_no | テキスト | 12 | 必須 | 採番 | 主キー | RE-001 | 確定 |',
    '| 品番 | item_code | 文字 | 10 | Y | | FK（TBL-011） | RE-002 | 確定 |',
    '| 数量 | qty | 整数 | 5 | ○ | | | RE-003 | 検討中 |',
    '| 区分 | kind | 区分 | 2 | | 10 | | RE-004 | 確定 |',
    '| 登録日時 | created_at | 日付と時刻 | | ○ | | | RE-005 | 確定 |',
    '| 有効 | active | Yes/No | | | | | RE-001 | 確定 |',
    '| 金額 | amount | 金額 | | | | | RE-001 | 確定 |',
    '| メモ | memo | 複数行 | | | | | RE-001 | 確定 |',
    '| 担当 | owner | Lookup | | | | | RE-001 | 確定 |',
    '',
    '## TBL-011 品目',
    '| 列名 | 内部名 | 型 | 必須 | キー | 選択肢・範囲 | 根拠 | 状態 |',
    '|---|---|---|---|---|---|---|---|',
    '| 品番 | item_code | 文字 | ○ | PK | 最大 10 文字 | RE-001 | 確定 |',
    '| 単価 | price | 通貨 | ○ | | 1〜10万 | RE-001 | 確定 |',
    '| 在庫 | stock | 数値 | | | 100 以下 | RE-001 | 確定 |',
    '| 下限 | low | 数値 | | | >5 | RE-001 | 確定 |',
    '````',
  ].join('\n');
  const m = TABLEDEF.parse(src);
  const c = (n) => m.tables[0].cols.find((x) => x.name === n);
  assert.deepEqual(m.tables[0].cols.map((x) => x.type), ['text', 'text', 'number', 'choice', 'datetime', 'bool', 'currency', 'note', 'lookup']);
  assert.equal(c('受付番号').key, 'order_no');
  assert.equal(c('受付番号').pk, true);
  assert.equal(c('受付番号').maxLen, 12);
  assert.match(c('受付番号').note, /既定値：採番/);
  assert.equal(c('品番').fk, true);
  assert.equal(c('品番').ref, 'TBL-011');
  assert.equal(c('品番').required, true);
  assert.equal(c('区分').required, false);
  assert.equal(c('数量').state, '検討中');
  const p = m.tables[1].cols;
  assert.deepEqual([p[1].min, p[1].max], [1, 100000]);
  assert.deepEqual([p[2].min, p[2].max, p[2].maxOpen], [null, 100, false]);
  assert.deepEqual([p[3].min, p[3].minOpen], [5, true]);
  assert.equal(p[0].maxLen, 10);
  const msgs = m.warnings.map((w) => w.message).join('\n');
  assert.match(msgs, /選択肢型なのに選択肢がありません/);
  assert.match(msgs, /参照の列なのに参照先の TBL ID がありません/);
});

test('テーブル定義：点検の警告（主キーなし・参照先なし・選択肢なし・根拠なし・重なり・内部名・ID の重なり・読めない型・セルの数）', () => {
  const src = [
    '## TBL-001 A',
    '| 列名 | 内部名 | 型 | キー | 選択肢・範囲 | 根拠 | 状態 |',
    '|---|---|---|---|---|---|---|',
    '| 名前 | name | 文字 | | | RE-001 | 確定 |',
    '| 名前 | name | 文字 | | | RE-001 | 確定 |',
    '| 種別 | 種別 | 選択肢 | | | | 確定 |',
    '| 相手 | partner | 参照 | FK | TBL-099 | RE-002 | 確定 |',
    '| 謎 | odd | なぞ型 | | | RE-003 | 済み |',
    '## TBL-001 B',
    '| 列名 | 型 | キー |',
    '|---|---|---|',
    '| x | 文字 | PK | 余り |',
  ].join('\n');
  const m = TABLEDEF.parse(src);
  const msgs = m.warnings.map((w) => `${w.where}:${w.message}`).join('\n');
  for (const re of [/TBL-001:主キー（PK）の列がありません/, /TBL-001.名前:列名「名前」が重なっています/, /内部名「name」が重なっています/, /TBL-001.種別:選択肢型なのに選択肢がありません/,
    /TBL-001.種別:根拠が空です（台帳の/, /内部名「種別」に英数字と _ 以外/, /参照先 TBL-099 がテーブル定義にありません/, /TBL-001 が 2 回定義されています/, /型「なぞ型」は読めません/, /状態「済み」は読めません/,
    /セルが 4 個です（見出しは 3 個）/]) assert.match(msgs, re);
  assert.ok(m.warnings.every((w) => w.line > 0));
  assert.doesNotMatch(msgs, /Excel|SharePoint|Dataverse|カルテ/);
});

test('列定義表: 型（台帳）の列があり、構築先の列が無い。CSV は式になる先頭に \' を付ける', () => {
  const m = TABLEDEF.parse(SAMPLE.tables);
  assert.deepEqual(TABLEDEF.COLUMN_HEAD, ['テーブル', '列名', '内部名', '型（定義）', '型（台帳）', '必須', '主キー', '参照先', '桁', '範囲', '選択肢', '状態', '根拠', '備考']);
  const rows = TABLEDEF.columnRows(m);
  assert.equal(rows.length, 15);
  const r = (name) => rows.find((x) => x.name === name);
  assert.equal(r('金額').ledgerType, '小数');
  assert.equal(r('申請番号').pk, '○');
  assert.equal(r('申請者').ref, 'TBL-002 社員.社員番号');
  assert.equal(r('金額').range, '0 以上');
  const csv = TABLEDEF.columnCsv(m);
  assert.ok(csv.startsWith('﻿テーブル,列名,内部名,型（定義）,型（台帳）'));
  assert.equal(TABLEDEF.util.toCsv([['=HYPERLINK("x")', '+1+1', '@SUM(A1)', '-cmd', '-', '-100', '通常']]), '﻿"\'=HYPERLINK(""x"")",\'+1+1,\'@SUM(A1),\'-cmd,-,-100,通常\r\n');
});

// ---------- 判断マスタ ----------
test('判断マスタ：サンプルを読める（区分・見る項目・判定表・区分ごとの項目）', () => {
  const J = JUDGE.parse(SAMPLE.master);
  assert.deepEqual(J.warnings, []);
  assert.deepEqual(J.judges.map((j) => [j.id, j.role]), [['JDG-001', 'ai'], ['JDG-002', 'rule'], ['JDG-003', 'human']]);
  const [a, r, h] = J.judges;
  assert.deepEqual(a.inputs, ['経費申請.金額', '経費申請.領収書あり']);
  assert.equal(a.examples.length, 2);
  assert.match(a.criteria, /3 か月以内/);
  assert.deepEqual(r.condCols, ['金額', '経費種別']);
  assert.equal(r.rows.length, 4);
  assert.deepEqual(r.rows[0].conds.金額, { op: '<', n: 5000 });
  assert.deepEqual(r.rows[1].conds.金額, { range: [5000, 99999] });
  assert.equal(r.rows[3].result, null);
  assert.equal(r.rows[3].state, '要確認');
  assert.deepEqual(r.rows[3].basis, ['QA-003']);
  assert.match(h.contact, /経理部/);
});

test('判断マスタ：条件のセルの読み方と評価（範囲・以上未満・桁区切り）', () => {
  const P = TABLEDEF.util.parseCond, T = TABLEDEF.util.testCond;
  const cases = [
    ['-', '何でも', true], ['', 'x', true], ['任意', 'x', true],
    ['>=100000', '100000', true], ['>=100000', '99999', false], ['≧10万', '100,000', true], ['10万円以上', '100000', true], ['5000未満', '4999', true], ['5000未満', '5000', false],
    ['100超', '100', false], ['<=5', '5', true], ['1〜10', '10', true], ['1-10', '0', false], ['＞３', '4', true],
    ['交通費', '交通費', true], ['交通費|備品', '備品', true], ['交通費、備品', '接待費', false], ['交通費 または 備品', '備品', true], ['!=交通費', '備品', true], ['交通費以外', '交通費', false],
    ['はい', 'あり', true], ['はい', 'いいえ', false], ['=100', '１００', true], ['>=5', '', false], ['>=5', 'abc', false],
  ];
  for (const [cell, v, want] of cases) assert.equal(T(P(cell), v), want, `「${cell}」に「${v}」`);
  assert.deepEqual(P('100,000'), { eq: ['100,000'] });
  const r = P('10万以上50万未満');
  assert.deepEqual(r, { range: [100000, 500000], hi: '<' });
  assert.equal(T(r, '500000'), false);
  assert.equal(T(P('100超200以下'), '100'), false);
  assert.deepEqual(P('5000〜'), { op: '>=', n: 5000 });
  assert.deepEqual(P('100,000、200,000'), { eq: ['100,000', '200,000'] });
});

test('判断マスタ：ルール区分の漏れと矛盾を例つきで出す。未確定の行も当たりに数える', () => {
  const J = JUDGE.parse(SAMPLE.master);
  const cov = JUDGE.coverage(J.judges[1], null);
  assert.equal(cov.skipped, false);
  assert.equal(cov.conflicts.count, 0);
  assert.equal(cov.gaps.count, 0);
  const m = TABLEDEF.parse(SAMPLE.tables);
  const cov2 = JUDGE.coverage(J.judges[1], (name) => col(m, 'TBL-001', name) || null);
  assert.equal(cov2.gaps.count, 2);
  assert.deepEqual(cov2.gaps.examples, ['金額=4,999・経費種別=備品', '金額=4,999・経費種別=その他']);
  const bad = JUDGE.parse(['## JDG-009 x', '- 区分：ルール', '| No | 点数 | 結果 | 状態 |', '|---|---|---|---|', '| 1 | >=50 | 合格 | 確定 |', '| 2 | >=60 | 不合格 | 確定 |', '| 3 | <40 | ? | 要確認 |'].join('\n')).judges[0];
  const c3 = JUDGE.coverage(bad, null);
  assert.ok(c3.conflicts.count > 0);
  assert.match(c3.conflicts.examples[0], /点数=60（No\.1・No\.2）/);
  assert.deepEqual(c3.gaps.examples, ['点数=40', '点数=41', '点数=49']);
});

test('判断マスタ：組み合わせが 512 を超えたら列挙しない', () => {
  const head = Array.from({ length: 5 }, (_, i) => `c${i}`);
  const rows = Array.from({ length: 4 }, (_, r) => `| ${r + 1} | ${head.map((_, i) => `v${r}${i}`).join(' | ')} | 結果${r} | 確定 |`);
  const src = ['## JDG-001 多い', '- 区分：ルール', `| No | ${head.join(' | ')} | 結果 | 状態 |`, `|${'---|'.repeat(head.length + 3)}`, ...rows].join('\n');
  const j = JUDGE.parse(src).judges[0];
  const cov = JUDGE.coverage(j, null);
  assert.equal(cov.total, 1024);
  assert.equal(cov.skipped, true);
  assert.ok(JUDGE.analyze({ master: src }).warnings.some((w) => /1024 通り（上限 512）/.test(w.message)));
});

test('判断マスタ：区分ごとの点検・番号の列・セルの数', () => {
  const src = ['## JDG-001 a', '- 見る項目：x', '## JDG-002 b', '- 区分：神託', '## JDG-003 c', '- 区分：ルール', '## JDG-004 d', '- 区分：AI判断', '## JDG-005 e', '- 区分：人',
    '## JDG-006 f', '- 区分：ルール', '| x | 結果 |', '|---|---|', '| 1 | はい |'].join('\n');
  const J = JUDGE.parse(src);
  const msgs = J.warnings.map((w) => `${w.where}:${w.message}`).join('\n');
  for (const re of [/JDG-001:区分（ルール・AI・人・外部）がありません/, /JDG-002:区分「神託」は読めません/, /JDG-003:ルール区分なのに判定表/, /JDG-004:AI 区分なのに判断基準がありません/,
    /JDG-004:AI 区分なのに境界の例/, /JDG-005:人の区分なのに連絡先/, /JDG-006:判定表に「状態」列がありません/]) assert.match(msgs, re);
  for (const h of ['No.', 'NO', '項番', '№', 'No：']) {
    const j = JUDGE.parse(['## JDG-001 x', '- 区分：ルール', `| ${h} | 点 | 結果 | 状態 |`, '|---|---|---|---|', '| 1 | >=5 | 可 | 確定 |'].join('\n')).judges[0];
    assert.deepEqual(j.condCols, ['点'], h);
  }
  const W = JUDGE.parse(['## JDG-001 x', '- 区分：ルール', '| No | 種別 | 結果 | 状態 |', '|---|---|---|---|', '| 1 | 交通費|備品 | 課長 | 確定 |'].join('\n'));
  assert.match(W.warnings.map((w) => w.message).join('\n'), /セルが 5 個です（見出しは 4 個）/);
});

// ---------- 突き合わせ ----------
test('突き合わせ：サンプル（台帳なし）の分岐の状態・件数・確認事項', () => {
  const an = JUDGE.analyze(SAMPLE);
  assert.deepEqual({ ...an.marks }, { C: 'ok', B: 'ok', D: 'open', K: 'none', E: 'ok', G: 'open' });
  assert.deepEqual([an.counts.ok, an.counts.open, an.counts.none, an.counts.tables, an.counts.openCols], [2, 1, 1, 3, 2]);
  assert.ok(an.warnings.some((w) => w.kind === '台帳' && /台帳を渡していない/.test(w.message)));
  const it = (id) => an.items.find((x) => x.id === id);
  assert.deepEqual(an.items.map((x) => [x.kind, x.id]), [['判断', 'JDG-002'], ['分岐', 'K'], ['テーブル', 'TBL-002.部署'], ['テーブル', 'TBL-003.支払予定日']]);
  assert.match(it('JDG-002').reason, /判定表 No\.4 の結果が決まっていない/);
  assert.match(it('JDG-002').reason, /当たらない組み合わせが 2 通り/);
  assert.equal(it('JDG-002').askTo, 'Power Automate');
  assert.equal(it('JDG-002').options, '自動承認、課長、部長');
  assert.equal(it('K').options, 'はい、いいえ');
  assert.match(it('TBL-002.部署').reason, /^要確認/);
  assert.ok(JUDGE.itemsCsv(an.items).startsWith('﻿種類,ID,題名,区分,未確定の理由,聞く相手,選択肢,関係する未確定の項目\r\n'));
  assert.equal(JUDGE.itemsMarkdown(an.items).trim().split('\n').length, 2 + an.items.length);
});

test('突き合わせ：見る項目・条件列と列（ない・曖昧・選択肢外・数でない列・読めない数）、未確定の列を見る判断は未確定', () => {
  const tables = ['## TBL-001 A', '| 列名 | 型 | キー | 選択肢・範囲 | 根拠 | 状態 |', '|---|---|---|---|---|---|', '| id | 文字 | PK | | RE-001 | 確定 |', '| 種別 | 選択肢 | | 甲, 乙 | RE-001 | 確定 |', '| 名前 | 文字 | | | RE-001 | 確定 |', '| 金額 | 通貨 | | | RE-001 | 確定 |',
    '## TBL-002 B', '| 列名 | 型 | キー | 根拠 | 状態 |', '|---|---|---|---|---|', '| id | 文字 | PK | RE-001 | 確定 |', '| 名前 | 文字 | | RE-001 | 検討中 |'].join('\n');
  const master = ['## JDG-001 x', '- 区分：ルール', '- 見る項目：A.種別, 名前, A.ない列', '| No | 種別 | 名前 | 結果 | 状態 |', '|---|---|---|---|---|', '| 1 | 丙 | >3 | はい | 確定 |', '| 2 | 甲 | - | いいえ | 確定 |'].join('\n');
  const msgs = JUDGE.analyze({ master, tables }).warnings.map((w) => `${w.where}:${w.message}`).join('\n');
  assert.match(msgs, /見る項目「A.ない列」がどのテーブルの列にもありません/);
  assert.match(msgs, /見る項目「名前」は TBL-001・TBL-002 の列に当たります/);
  assert.match(msgs, /条件の値「丙」は TBL-001.種別 の選択肢（甲、乙）にありません/);
  const an2 = JUDGE.analyze({ master: master.replace('見る項目：A.種別, 名前, A.ない列', '見る項目：A.種別, B.名前'), tables });
  assert.match(an2.warnings.map((w) => w.message).join('\n'), /「>3」は数の条件ですが、TBL-002.名前 は文字型です/);
  assert.ok(an2.judgeInfo['JDG-001'].reasons.includes('TBL-002.名前 が検討中'));
  const m3 = ['## JDG-001 x', '- 区分：ルール', '- 見る項目：A.金額', '| No. | 金額 | 結果 | 状態 |', '|---|---|---|---|', '| 1 | たくさん | 多 | 確定 |'].join('\n');
  assert.match(JUDGE.analyze({ master: m3, tables }).warnings.map((w) => w.message).join('\n'), /「たくさん」は数の条件として読めません/);
});

test('突き合わせ：出口ラベルと結果の食い違い・区分の食い違い・マスタにない JDG・引かれない JDG・未確定の判断を引く分岐', () => {
  const flow = ['lane 係 {人}', 'start S @係 始め', 'decision A @係 {ルール} 判定 [JDG-001]', 'decision B @係 二つ目 [JDG-009]', 'end Z @係 終わり', 'end Y @係 別', 'S -> A', 'A -> B : 可', 'A -> Y : 保留', 'B -> Z : はい', 'B -> Y : いいえ'].join('\n');
  const master = ['## JDG-001 判定', '- 区分：人', '- 連絡先：窓口', '| 点 | 結果 | 状態 |', '|---|---|---|', '| >=5 | 可 | 確定 |', '| <5 | 不可 | 確定 |', '## JDG-002 使わない', '- 区分：人', '- 連絡先：窓口'].join('\n');
  const an = JUDGE.analyze({ flow, master });
  const msgs = an.warnings.map((w) => `${w.where}:${w.message}`).join('\n');
  assert.match(msgs, /A:JDG-001 の結果「不可」がフローの出口にない/);
  assert.match(msgs, /A:出口「保留」になる行が JDG-001 の判定表にない/);
  assert.match(msgs, /A:分岐の区分（ルール）と JDG-001 の区分（人）が違います/);
  assert.match(msgs, /B:JDG-009 が判断マスタにありません/);
  assert.match(msgs, /JDG-002:フローのどの分岐からも引かれていません/);
  assert.equal(an.marks.A, 'open');
  assert.equal(an.marks.B, 'none');
  assert.ok(an.items.some((x) => x.kind === '分岐' && x.id === 'B' && /JDG-009 が判断マスタにない/.test(x.reason)));
  const f2 = ['lane L', 'start S @L s', 'decision A @L a [JDG-001]', 'decision B @L b [JDG-002]', 'end Z @L z', 'S -> A', 'A -> B : x', 'A -> Z : y', 'B -> Z : x', 'B -> S : y'].join('\n');
  const an2 = JUDGE.analyze({ flow: f2, master: ['## JDG-001 a', '- 区分：ルール', '## JDG-002 b', '- 区分：AI', '- 判断基準：x'].join('\n') });
  assert.deepEqual([an2.marks.A, an2.marks.B], ['open', 'open']);
  assert.match(an2.nodes.A.reasons.join(), /判定表（の行）がない/);
});

// ---------- 台帳の ID の状態（design.md の表） ----------
test('台帳の ID の状態: 種別ごとの ✓ と ?（理由）', () => {
  const S = JUDGE.refState;
  const t = (kind, extra) => S({ id: 'X-1', kind, ...extra });
  const cases = [
    [t('question', { status: 'open' }), false, '未回答'], [t('question', { status: 'answered' }), true], [t('question', { status: 'closed' }), true],
    [t('issue', { status: 'open' }), false, '未解決'], [t('issue', { status: 'in_progress' }), false, '未解決'], [t('issue', { status: 'closed' }), true],
    [t('request', { status: 'accepted' }), true], [t('request', { status: 'open' }), false, '未決'], [t('request', { status: 'deferred' }), false, '未決'], [t('request', { status: 'rejected' }), false, '不採用'],
    [t('requirement', { status: 'draft', confidence: 'fact' }), true], [t('requirement', { status: 'draft', confidence: 'confirmed' }), true], [t('requirement', { status: 'agreed' }), true],
    [t('requirement', { status: 'agreed', confidence: 'guess' }), false, '推測'], [t('requirement', { status: 'draft' }), false, '未合意'], [t('requirement', { status: 'dropped', confidence: 'fact' }), false, '取り下げ'],
    [t('constraint', { status: 'resolved', confidence: 'guess' }), true], [t('constraint', { status: 'active', confidence: 'guess' }), false, '推測'], [t('constraint', { status: 'active', confidence: 'fact' }), true],
    [t('decision', { status: 'valid' }), true], [t('decision', { status: 'superseded' }), false, '置き換え済み'],
    [t('change', { status: 'approved' }), true], [t('change', { status: 'proposed' }), false, '未承認'], [t('change', { status: 'rejected' }), false, '却下'], [t('change', { status: 'withdrawn' }), false, '取り下げ'],
    ...['entity', 'screen', 'interface', 'batch', 'bizflow'].flatMap((k) => [[t(k, { status: 'fixed' }), true], [t(k, { status: 'draft' }), false, '案'], [t(k, { status: 'dropped' }), false, '取り下げ']]),
    ...['stakeholder', 'system', 'meeting', 'task', 'test', 'kpi', 'risk', 'memo'].map((k) => [t(k, { status: 'whatever' }), true]),
    [S(null), false, '台帳に無い'],
  ];
  for (const [r, ok, why] of cases) { assert.equal(r.ok, ok, JSON.stringify(r)); if (!ok) assert.equal(r.why, why); }
});

test('突き合わせ：台帳の点検（無い ID・回答済みの質問・未回答の質問と未解決の課題は未確定）。聞く相手は質問の質問先', () => {
  const l = loadLedger();
  const askTo = l.items.find((it) => it.id === 'QA-001').askTo;
  const master = ['## JDG-001 x', '- 区分：人', '- 連絡先：窓口', '- 根拠：RE-001, RE-099, QA-004',
    '## JDG-002 y', '- 区分：人', '- 連絡先：窓口', '- 根拠：QA-001',
    '## JDG-003 z', '- 区分：人', '- 連絡先：窓口', '- 根拠：IS-001',
    '## JDG-004 w', '- 区分：人', '- 連絡先：窓口', '- 根拠：IS-004, DC-001'].join('\n');
  const an = JUDGE.analyze({ master, ledger: l });
  const msgs = an.warnings.map((w) => `${w.where}:${w.message}`).join('\n');
  assert.match(msgs, /JDG-001:RE-099 が台帳にありません/);
  assert.match(msgs, /JDG-001:QA-004 は回答済みです/);
  assert.doesNotMatch(msgs, /RE-001 が台帳にありません/);
  assert.deepEqual(an.judgeInfo['JDG-001'].reasons, ['RE-099 が台帳に無い']);
  assert.deepEqual(an.judgeInfo['JDG-002'].reasons, ['QA-001 が未回答']);
  assert.deepEqual(an.judgeInfo['JDG-003'].reasons, ['IS-001 が未解決']);
  assert.deepEqual(an.judgeInfo['JDG-004'].reasons, ['DC-001 が置き換え済み']);
  if (askTo) assert.equal(an.items.find((x) => x.id === 'JDG-002').askTo, l.items.find((it) => it.id === askTo).title);
  assert.equal(an.items.find((x) => x.id === 'JDG-002').qs, 'QA-001');
  assert.ok(!an.warnings.some((w) => /台帳を渡していない/.test(w.message)));
  // フロー記法の参照も同じ: 分岐に未回答の質問を書くと ? になる
  const an2 = JUDGE.analyze({ flow: 'start S s\ndecision A a [QA-001]\nend Z z\nS -> A\nA -> Z : はい\nA -> S : いいえ', ledger: l });
  assert.equal(an2.marks.A, 'open');
  assert.deepEqual(an2.nodes.A.reasons, ['QA-001 が未回答']);
});

// ---------- 確認事項 → 台帳の質問 ----------
test('確認事項を台帳の質問の差分にする: 題名・質問先の照合・既存の未回答だけを指すものと同じ題名を除く。検査を通って取り込める', () => {
  const l = loadLedger();
  const person = l.items.find((it) => it.kind === 'stakeholder');
  const an = JUDGE.analyze({ ...SAMPLE, ledger: l });
  const items = an.items.map((x) => (x.id === 'K' ? { ...x, askTo: ` ${person.title} ` } : x.id === 'JDG-002' ? { ...x, askTo: '外の誰か' } : x));
  const p = JUDGE.questionPatch(items, l);
  assert.equal(p.type, 'ledger-patch');
  const byTitle = (re) => p.ops.find((o) => re.test(o.item.title));
  const j2 = byTitle(/承認ルートの判定/);
  assert.equal(j2.item.title, '判断「承認ルートの判定」（JDG-002）の決め方を確定してください（結果：自動承認、課長、部長）');
  assert.match(j2.item.body, /当たらない組み合わせ/);
  assert.match(j2.item.body, /聞く相手: 外の誰か/);
  assert.equal(j2.item.askTo, undefined);
  assert.equal(byTitle(/予算内か/).item.askTo, person.id, '前後の空白を除いて関係者の名前と完全一致');
  assert.ok(p.ops.every((o) => o.item.kind === 'question' && o.item.status === 'open'));
  const v = validatePatch(p, l);
  assert.deepEqual(v.ops.flatMap((o) => o.errors), []);
  const after = applyPatch(l, v, new Set(v.ops.map((_, i) => i)), NOW).ledger;
  assert.deepEqual(validateLedger(after), []);
  // もう一度押しても二重にならない
  assert.equal(JUDGE.questionPatch(items, after).ops.length, 0);
  // 理由がすべて既存の未回答の質問のものは入れない
  assert.equal(JUDGE.questionPatch([{ kind: 'テーブル', id: 'TBL-001.x', title: 't', reasons: ['QA-001 が未回答'], options: '' }], l).ops.length, 0);
});

// ---------- テーブル定義 → 台帳のテーブル ----------
test('テーブル定義を台帳のテーブルの差分にする（物理名・区分・内部名なし・型・fk・同じ物理名・根拠）', () => {
  const l = loadLedger();
  const src = [
    '## TBL-001 経費申請', '- 物理名：expense_request', '- 根拠：RE-001, RE-099',
    '| 列名 | 内部名 | 型 | 桁 | キー | 選択肢・範囲 | 根拠 | 状態 |', '|---|---|---|---|---|---|---|---|',
    '| 申請番号 | request_no | 文字 | | PK | 10 桁 | RE-001 | 確定 |',
    '| 申請者 | applicant | 参照 | | FK | TBL-002 | RE-005 | 確定 |',
    '| 金額 | amount | 数値 | | | 0 以上 | CN-001 | 確定 |',
    '| 単価 | price | 数値 | 10,2 | | | CN-001 | 確定 |',
    '| 率 | rate | 小数 | | | | CN-001 | 確定 |',
    '| 種別 | kind | 選択肢 | | | 甲, 乙 | DC-002 | 要確認 |',
    '| 名前だけ |  | 文字 | | | | RE-001 | 確定 |',
    '| 支払 | payment | 参照 | | FK | TBL-003 | RE-001 | 確定 |',
    '## TBL-002 社員', '- 物理名：employee', '- 区分：外部参照',
    '| 列名 | 内部名 | 型 | キー |', '|---|---|---|---|', '| 社員番号 | employee_no | 文字 | PK |',
    '## TBL-003 支払', '- 物理名：ORDERS',
    '| 列名 | 内部名 | 型 | キー |', '|---|---|---|---|', '| 支払番号 | pay_no | 文字 | PK |',
    '## TBL-004 名なし',
    '| 列名 | 内部名 | 型 | キー |', '|---|---|---|---|', '| a | a | 文字 | PK |',
  ].join('\n');
  const ex = l.items.find((it) => it.kind === 'entity');
  const l2 = structuredClone(l);
  l2.items.find((it) => it.id === ex.id).physicalName = 'orders';
  const { patch, warnings } = toEntityPatch(TABLEDEF.parse(src), l2);
  const w = warnings.join('\n');
  assert.match(w, /TBL-004 名なし: 物理名がありません/);
  assert.match(w, new RegExp(`TBL-003 支払: 物理名「ORDERS」のテーブルが台帳にあります（${ex.id}）`));
  assert.match(w, /TBL-001.名前だけ: 内部名（物理名）が空なので、この列を外します/);
  assert.deepEqual(patch.ops.map((o) => o.item.physicalName), ['expense_request', 'employee']);
  const [e1, e2] = patch.ops.map((o) => o.item);
  assert.equal(e1.fileType, 'internal', '区分が無ければ自システム');
  assert.equal(e2.fileType, 'external');
  const c = (n) => e1.columns.find((x) => x.name === n);
  assert.equal(c('name') , undefined);
  assert.deepEqual(e1.columns.map((x) => x.name), ['request_no', 'applicant', 'amount', 'price', 'rate', 'kind', 'payment']);
  assert.equal(c('request_no').logical, '申請番号');
  assert.equal(c('request_no').length, 10);
  assert.equal(c('request_no').pk, true);
  assert.deepEqual([c('amount').type, c('price').type, c('rate').type], ['int', 'decimal', 'decimal']);
  assert.equal(c('kind').type, 'code');
  assert.deepEqual(c('applicant').fk, { entity: 'new:TBL-002', column: 'employee_no' });
  // 既存のテーブルを指すときは、テーブル定義の主キー名ではなく、台帳のそのテーブルの主キー名を使う（FIX-005）
  assert.deepEqual(c('payment').fk, { entity: ex.id, column: ex.columns.find((x) => x.pk).name }, '同じ物理名の既存のテーブルを指す');
  assert.equal(c('applicant').type, 'string', '参照の列は参照先の主キーの型');
  assert.match(c('amount').note, /範囲: 0 以上/);
  assert.match(c('kind').note, /選択肢: 甲 \/ 乙/);
  assert.match(c('kind').note, /状態: 要確認/);
  assert.match(c('kind').note, /根拠: DC-002/);
  assert.deepEqual(e1.links, ['RE-001']);
  assert.match(e1.body, /根拠（台帳に無い ID）: RE-099/);
  const v = validatePatch(patch, l2);
  assert.deepEqual(v.ops.flatMap((o) => o.errors), []);
  const after = applyPatch(l2, v, new Set(v.ops.map((_, i) => i)), NOW).ledger;
  assert.deepEqual(validateLedger(after), []);
  // 取り下げたテーブルは既存に数えない（FIX-006）
  const l3 = structuredClone(l2);
  l3.items.find((it) => it.id === ex.id).status = 'dropped';
  const r3 = toEntityPatch(TABLEDEF.parse(src), l3);
  assert.ok(r3.patch.ops.some((o) => o.item.physicalName === 'ORDERS'));
  assert.ok(!r3.warnings.some((w) => w.includes(ex.id)));
});

// ---------- デモ ----------
test('デモ：サンプルの 5 ケースの終わり方と止まる理由', () => {
  const an = JUDGE.analyze({ ...SAMPLE, ledger: loadLedger() });
  const cases = JUDGE.caseList(fx('cases.md'));
  assert.equal(cases.length, 5);
  assert.deepEqual({ ...cases[0].values }, { '経費申請.金額': '3000', '経費申請.経費種別': '交通費', '経費申請.領収書あり': 'はい', '社員.役職': '一般', 'JDG-001': '一致' });
  const run = (c) => JUDGE.demo.run(JUDGE.demo.start(an, c.values), an);
  const r = cases.map(run);
  assert.deepEqual(r.map((s) => [s.status, s.cur]), [['done', 'Z'], ['done', 'Z'], ['stop', 'D'], ['stop', 'D'], ['stop', 'C']]);
  assert.deepEqual(r[0].taken, ['S>A', 'A>C', 'C>B', 'B>D', 'D>G', 'G>Z']);
  assert.deepEqual(r[0].decided.map((d) => [d.id, d.result, d.by]), [['JDG-001', '一致', 'ケース'], ['JDG-002', '自動承認', '判定表 No.1']]);
  assert.deepEqual(r[1].decided.map((d) => d.result), ['一致', '課長', '承認']);
  assert.match(r[2].stop.reason, /JDG-002 判定表 No\.4 が結果未定・要確認です/);
  assert.ok(r[2].stop.items.includes('QA-003 の回答を得る'));
  assert.match(r[3].stop.reason, /どの行にも当たりません（金額=3000・経費種別=備品）/);
  assert.match(r[4].stop.items[0], /金額 の値「-100」が範囲（0 以上）の外です/);
  assert.ok(r[0].used.includes('TBL-001.金額') && r[0].used.includes('TBL-001.経費種別'));
  assert.deepEqual(r[2].stopped.map((x) => x.id), ['JDG-002']);
});

test('デモ：選ぶ分岐は choose になり、選ぶと進む。200 歩で止まる・フローが無ければ止まる。値の点検', () => {
  const an = JUDGE.analyze(SAMPLE);
  const values = { '経費申請.金額': '200000', '経費申請.経費種別': '備品', '経費申請.領収書あり': 'はい', '社員.役職': '部長', 'JDG-001': '一致' };
  let st = JUDGE.demo.run(JUDGE.demo.start(an, values), an);
  assert.deepEqual([st.status, st.cur], ['choose', 'K']);
  assert.deepEqual(st.options.map((o) => o.label), ['はい', 'いいえ']);
  assert.equal(JUDGE.demo.step(st, an).cur, 'K');
  st = JUDGE.demo.run(JUDGE.demo.step(st, an, st.options[0].to), an);
  assert.deepEqual([st.status, st.cur], ['choose', 'E']);
  st = JUDGE.demo.run(JUDGE.demo.step(st, an, 'X'), an);
  assert.deepEqual([st.status, st.cur], ['done', 'X']);
  assert.deepEqual(st.decided.map((d) => [d.id, d.by]), [['JDG-001', 'ケース'], ['JDG-002', '判定表 No.3'], ['K', '選んだ'], ['JDG-003', '選んだ']]);
  const loop = JUDGE.analyze({ flow: 'start S 始め\ntask A 回る\nS -> A\nA -> A' });
  const s2 = JUDGE.demo.run(JUDGE.demo.start(loop, {}), loop);
  assert.match(s2.stop.reason, /200 歩を超えた/);
  assert.equal(JUDGE.demo.start(JUDGE.analyze({ flow: '' }), {}).status, 'stop');
  const m = TABLEDEF.parse(SAMPLE.tables);
  const B = JUDGE.badValue;
  assert.match(B(col(m, 'TBL-001', '金額'), ''), /値がありません（必須）/);
  assert.match(B(col(m, 'TBL-001', '金額'), 'たくさん'), /数ではありません/);
  assert.match(B(col(m, 'TBL-001', '経費種別'), '旅費'), /選択肢（交通費、接待費、備品、その他）にありません/);
  assert.match(B(col(m, 'TBL-001', '申請日'), '来週'), /日付として読めません/);
  assert.equal(B(col(m, 'TBL-001', '申請日'), '2026/11/19'), null);
  assert.match(B(col(m, 'TBL-002', '氏名'), 'あ'.repeat(41)), /40 文字を超えています/);
});

// ---------- まとめ保存と見分け ----------
test('まとめ保存して分けると元に戻る。種類の見分け（複数に当たるファイル）', () => {
  const parts = { flow: SAMPLE.flow, master: SAMPLE.master, tables: SAMPLE.tables, cases: fx('cases.md') };
  const md = JUDGE.bundle(parts);
  assert.match(md, /案件ワークベンチ/);
  const back = JUDGE.unbundle(md);
  for (const k of Object.keys(parts)) assert.equal(back[k].trim(), parts[k].trim(), k);
  assert.deepEqual(JUDGE.detect(md), back);
  assert.deepEqual(Object.keys(JUDGE.detect(SAMPLE.master)), ['master']);
  assert.deepEqual(Object.keys(JUDGE.detect(SAMPLE.tables)), ['tables']);
  assert.deepEqual(Object.keys(JUDGE.detect(fx('cases.md'))), ['cases']);
  assert.deepEqual(Object.keys(JUDGE.detect(SAMPLE.flow)), ['flow']);
  const design = `# 詳細設計\n\n\`\`\`flow\n${SAMPLE.flow}\`\`\`\n\n${SAMPLE.tables}\n${SAMPLE.master}`;
  const d = JUDGE.detect(design);
  assert.deepEqual(Object.keys(d).sort(), ['flow', 'master', 'tables']);
  assert.equal(FLOWCHART.parse(d.flow).nodes.length, 12);
  assert.deepEqual({ ...JUDGE.detect('ただのメモ') }, {});
  const an = JUDGE.analyze({ flow: design, master: design, tables: design });
  assert.equal(an.graph.errors.length, 0);
  assert.equal(an.marks.D, 'open');
});

// ---------- 指示文 4 つ ----------
import { buildPrompt, PURPOSES } from '../src/core/prompts.js';
test('判断・データの指示文 4 つ: 設計の分類で plain、差し込みが残らず、台帳の ID が入り、カルテの ID・構築先の文が無い。囲みの指定がある', () => {
  const l = loadLedger();
  for (const id of ['judge-flow', 'table-def', 'judge-master', 'judge-cases']) {
    const p = PURPOSES.find((x) => x.id === id);
    assert.ok(p && p.group === '設計' && p.plain, id);
    const body = buildPrompt(id, l, { today: '2026-11-26' });
    assert.doesNotMatch(body, /\{\{/, id);
    assert.doesNotMatch(body, /\b[FDQH]-\d/, `${id} にカルテの ID`);
    assert.doesNotMatch(body, /Excel|SharePoint|Dataverse|カルテ/, id);
    assert.match(body, id === 'judge-flow' ? /```flow/ : /````markdown/, id);
    assert.ok(body.includes('QA-001'), `${id} に未回答の質問`);
    assert.doesNotMatch(body, /ledger-patch/, `${id} は差分を求めない`);
  }
  const flow = buildPrompt('judge-flow', l, { today: '2026-11-26' });
  assert.ok(flow.includes('# フロー記法') && flow.includes('DC-002'), '記法の説明と有効な決定');
  assert.ok(!flow.includes('DC-001 '), '置き換え済みの決定は載せない');
  assert.match(buildPrompt('table-def', l, { today: '2026-11-26' }), /- 物理名：expense_request\n- 区分：自システム/);
});

test('外から来た見出し・ID が constructor などでも落ちない（FIX-016）', () => {
  const tables = ['## TBL-001 A', '| 列名 | 型 | キー | 根拠 | 状態 |', '|---|---|---|---|---|', '| 金額 | 通貨 | PK | RE-001 | 確定 |'].join('\n');
  const master = ['## JDG-001 x', '- 区分：ルール', '| constructor | 結果 | 状態 |', '|---|---|---|', '| 1 | 可 | 確定 |'].join('\n');
  assert.doesNotThrow(() => JUDGE.analyze({ master, tables }));
  const an = JUDGE.analyze({ flow: 'start S 開始\nend Z 終了\nS -> Z', master: '' });
  assert.equal(an.nodes.constructor, undefined);
  assert.equal(an.nodes.toString, undefined);
  assert.ok(FLOWCHART.parse('constructor A x').errors.length > 0, '種類の語に constructor を受け付けない');
  assert.equal(FLOWCHART.roleOf('toString'), null);
});

test('判定表のセルに空白が並んでも固まらない（FIX-017）', () => {
  const P = TABLEDEF.util.parseCond;
  const t0 = Date.now();
  P('a' + ' '.repeat(5000) + 'b');
  P('a' + '\u3000'.repeat(5000) + 'b');
  TABLEDEF.util.splitVals('a' + ' '.repeat(5000) + 'または' + ' '.repeat(5000) + 'b');
  assert.ok(Date.now() - t0 < 500, `${Date.now() - t0}ms かかった`);
  assert.deepEqual(P('交通費  または   備品'), { eq: ['交通費', '備品'] });
});

import { csvSafe } from '../src/core/csv.js';
import { MASK } from '../src/core/mask.js';
test('CSV・TSV の式になる値（FIX-023）: - の後が式なら \' を付け、純粋な数値はそのまま', () => {
  for (const v of ['-1+1', '- 1+1', '-.5+1', "-2+3+cmd|' /C calc'!A0", '=HYPERLINK("x")', '+1', '@SUM(A1)']) assert.ok(csvSafe(v).startsWith("'"), v);
  for (const v of ['-', '-100', '-1,000', '-0.5', '通常', '2026-11-27']) assert.equal(csvSafe(v), v);
  assert.ok(!JUDGE.itemsCsv([{ kind: '判断', id: 'JDG-1', title: '-1+1', role: '', reason: '', askTo: '', options: '', qs: '' }]).includes(',-1+1'));
  assert.ok(MASK.mappingCSV([{ column: '氏名', original: '=HYPERLINK("x")', masked: '氏名A' }]).includes(`"'=HYPERLINK`));
  assert.ok(MASK.toTSV([['=1+1']]).startsWith("'="));
});

test('囲み付きのフローの誤りの行番号は、欄の行番号で出る（FIX-009）', () => {
  const an = JUDGE.analyze({ flow: '説明\n```flow\nstart S 始まり\nfoo\n```' });
  const w = an.warnings.find((x) => x.kind === 'フロー');
  assert.equal(w.line, 4);
});
