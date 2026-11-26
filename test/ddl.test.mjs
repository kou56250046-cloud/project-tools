// P4 T2: FP・DDL・名前の点検
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyLedger } from '../src/core/schema.js';
import { applyLocalOps } from '../src/core/patch.js';
import { countFp, fpEstimate } from '../src/core/fp.js';
import { generateDdl, lintNames } from '../src/core/ddl.js';

const load = () => JSON.parse(readFileSync(new URL('../samples/sample-ledger.json', import.meta.url), 'utf8'));
const NOW = '2026-11-26T09:00:00.000Z';

test('FP: サンプルを手で数えた値と一致する（225）', () => {
  const r = countFp(load());
  const by = Object.fromEntries(r.rows.map((x) => [x.v, x.count]));
  assert.deepEqual(by, { ILF: 5, EIF: 1, EI: 4, EO: 3, EQ: 1 });
  assert.equal(r.total, 225);
  assert.deepEqual(r.uncounted, []);
});

test('FP: 取り下げは数えず、CRUD の無いバッチは「数えていない機能」に出る', () => {
  const r = applyLocalOps(load(), [
    { op: 'add', item: { kind: 'batch', title: '空のバッチ' } },
    { op: 'add', item: { kind: 'screen', title: '取り下げ画面', screenType: 'input', status: 'dropped' } },
  ], NOW);
  const fp = countFp(r.ledger);
  assert.equal(fp.total, 225);
  assert.deepEqual(fp.uncounted.map((u) => u.item.title).sort(), ['取り下げ画面', '空のバッチ'].sort());
});

test('FP: 生産性を入れると工数と BAC との差が出る', () => {
  const l = load();
  assert.equal(fpEstimate(l, '2026-11-26').effort, null);
  l.settings.productivity = 1;
  const e = fpEstimate(l, '2026-11-26');
  assert.equal(e.effort, 225);
  assert.equal(e.bac, 181);
  assert.equal(e.gap, Math.round(((225 - 181) / 181) * 1000) / 1000);
});

function twoTables() {
  const r = applyLocalOps(emptyLedger('DDL 例', NOW), [
    { op: 'add', tempId: 'new:a', item: { kind: 'entity', title: '部署', physicalName: 'dept', fileType: 'internal', columns: [
      { name: 'dept_id', logical: '部署ID', type: 'int', pk: true },
      { name: 'dept_name', logical: "部署名（'略称'）", type: 'string', length: 50, required: true }] } },
    { op: 'add', item: { kind: 'entity', title: '社員', physicalName: 'emp', fileType: 'internal', columns: [
      { name: 'emp_id', type: 'int', pk: true },
      { name: 'dept_id', type: 'int', fk: { entity: 'new:a', column: 'dept_id' } },
      { name: 'salary', type: 'decimal', length: 10, scale: 2 }] } },
  ], NOW);
  return r.ledger;
}

test('DDL: PostgreSQL（参照先が先・主キー・外部キー・NOT NULL・コメント・引用符のエスケープ）', () => {
  const ddl = generateDdl(twoTables(), 'postgres', 'lower');
  const expected = [
    '-- DDL 例 のテーブル定義（PostgreSQL）',
    '-- 案件ワークベンチで生成。外部参照のテーブルは作成しない',
    '',
    'CREATE TABLE dept (',
    '  dept_id INTEGER NOT NULL,',
    '  dept_name VARCHAR(50) NOT NULL,',
    '  CONSTRAINT pk_dept PRIMARY KEY (dept_id)',
    ');',
    '',
    'CREATE TABLE emp (',
    '  emp_id INTEGER NOT NULL,',
    '  dept_id INTEGER,',
    '  salary NUMERIC(10,2),',
    '  CONSTRAINT pk_emp PRIMARY KEY (emp_id),',
    '  CONSTRAINT fk_emp_dept_id FOREIGN KEY (dept_id) REFERENCES dept (dept_id)',
    ');',
    '',
    '-- 表と列のコメント',
    "COMMENT ON TABLE dept IS '部署';",
    "COMMENT ON COLUMN dept.dept_id IS '部署ID';",
    "COMMENT ON COLUMN dept.dept_name IS '部署名（''略称''）';",
    "COMMENT ON TABLE emp IS '社員';",
  ].join('\n') + '\n';
  assert.equal(ddl, expected);
});

test('DDL: SQL Server と Oracle の型・コメント・大文字', () => {
  const ss = generateDdl(twoTables(), 'sqlserver', 'lower');
  assert.match(ss, /dept_name NVARCHAR\(50\) NOT NULL,/);
  assert.match(ss, /salary DECIMAL\(10,2\)/);
  assert.match(ss, /EXEC sp_addextendedproperty N'MS_Description', N'部署', N'SCHEMA', N'dbo', N'TABLE', N'dept';/);
  const ora = generateDdl(twoTables(), 'oracle', 'upper');
  assert.match(ora, /CREATE TABLE DEPT \(/);
  assert.match(ora, /DEPT_NAME VARCHAR2\(50 CHAR\) NOT NULL,/);
  assert.match(ora, /EMP_ID NUMBER\(10\) NOT NULL,/);
  assert.match(ora, /COMMENT ON TABLE DEPT IS '部署';/);
});

test('DDL: 循環する外部キーは ALTER で後から足す', () => {
  const r = applyLocalOps(emptyLedger('循環', NOW), [
    { op: 'add', tempId: 'new:a', item: { kind: 'entity', title: 'A', physicalName: 'a', fileType: 'internal', columns: [{ name: 'id', type: 'int', pk: true }, { name: 'b_id', type: 'int', fk: { entity: 'new:b', column: 'id' } }] } },
    { op: 'add', tempId: 'new:b', item: { kind: 'entity', title: 'B', physicalName: 'b', fileType: 'internal', columns: [{ name: 'id', type: 'int', pk: true }, { name: 'a_id', type: 'int', fk: { entity: 'new:a', column: 'id' } }] } },
  ], NOW);
  const ddl = generateDdl(r.ledger, 'postgres', 'lower');
  assert.match(ddl, /-- 循環する外部キー/);
  assert.equal((ddl.match(/ALTER TABLE/g) || []).length, 1);
  assert.equal((ddl.match(/FOREIGN KEY/g) || []).length, 2);
});

test('DDL: 外部参照のテーブルは作らず、それへの外部キーはコメントにする', () => {
  const ddl = generateDdl(load(), 'postgres', 'lower');
  assert.doesNotMatch(ddl, /CREATE TABLE warehouse_stock/);
  assert.match(ddl, /外部参照のテーブル（作成しない）: warehouse_stock/);
  assert.match(ddl, /CREATE TABLE customer_price/);
  assert.ok(ddl.indexOf('CREATE TABLE customer (') < ddl.indexOf('CREATE TABLE customer_price ('));
});

test('名前の点検: 予約語・規則・Oracle の 30 文字', () => {
  const r = applyLocalOps(emptyLedger('x', NOW), [{ op: 'add', item: { kind: 'entity', title: '利用者', physicalName: 'user', fileType: 'internal', columns: [
    { name: 'User-Name', type: 'string' }, { name: 'a_very_long_column_name_over_thirty', type: 'int', pk: true }] } }], NOW);
  const pg = lintNames(r.ledger, 'postgres', 'lower').map((x) => x.message).join('\n');
  assert.match(pg, /「user」は PostgreSQL の予約語/);
  assert.match(pg, /「User-Name」は英小文字/);
  assert.doesNotMatch(pg, /30 文字/);
  assert.match(lintNames(r.ledger, 'oracle', 'lower').map((x) => x.message).join('\n'), /30 文字を超えています/);
  assert.deepEqual(lintNames(load(), 'postgres', 'lower'), []);
});
