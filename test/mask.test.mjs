// P6c T4: マスキング（gemini-kit の mask.js を写したもの）。テストも gemini-kit の kit.test.mjs と同じ中身
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MASK } from '../src/core/mask.js';

const fx = () => readFileSync(new URL('./fixtures/mask/master.tsv', import.meta.url), 'utf8');

test("マスキング：列の規則を推定し、同じ値に同じ仮名を付ける", () => {
  const rows = MASK.parseTable(fx());
  const rules = rows[0].map((h, c) => MASK.infer(h, rows.slice(1).map((r) => r[c])));
  assert.deepEqual(rules.map((r) => r.rule), ["seq", "pseudo", "pseudo", "email", "seq", "pref", "keep", "round", "reldate", "blank"]);
  const res = MASK.apply(rows, rules, MASK.newState());
  const out = res.rows;
  const col = (name) => out.slice(1).map((r) => r[out[0].indexOf(name)]);
  assert.deepEqual(col("顧客名"), ["顧客A", "顧客B", "顧客C", "顧客A"], "同じ会社は同じ仮名");
  assert.deepEqual(col("担当者"), ["担当者A", "担当者B", "担当者A", "担当者C"]);
  assert.deepEqual(col("顧客コード"), ["C-00001", "C-00002", "C-00003", "C-00004"], "形式を保った連番");
  assert.deepEqual(col("電話番号").map((v) => v.slice(-4)), ["0001", "0002", "0003", "0004"], "連番は列ごと");
  assert.deepEqual(col("住所"), ["東京都", "大阪府", "愛知県", "東京都"]);
  assert.deepEqual(col("初回取引日"), ["基準日+0日", "基準日+563日", "基準日+660日", "基準日+0日"]);
  assert.equal(col("年間売上")[0], "120000000");
  assert.deepEqual(col("備考"), ["", "", "", ""]);
  // 元の値が出力に残っていない
  const text = MASK.toTSV(out);
  for (const s of ["テスト商事", "山田", "yamada@", "03-1234", "芝公園"]) assert.ok(!text.includes(s), `${s} が残っている`);
  assert.ok(res.mapping.some((m) => m.original === "株式会社テスト商事" && m.masked === "顧客A"));
});

test("マスキング：そのままの列の文中も置き換え、残りそうな情報を警告する", () => {
  const rows = [["会社名", "メモ"], ["株式会社テスト商事", "株式会社テスト商事に訪問"], ["株式会社テスト商事", "有限会社ほげに電話 03-1111-2222"]];
  const res = MASK.apply(rows, [{ rule: "pseudo", prefix: "会社" }, { rule: "keep" }], MASK.newState());
  assert.equal(res.rows[1][1], "会社Aに訪問");
  assert.ok(res.warnings.some((w) => w.row === 3 && w.col === 2));
});

test("マスキング：日付の基準日は表全体で1つ（列の前後関係を保つ）", () => {
  const rows = [["受注日", "納期"], ["2024/04/10", "2024/04/20"], ["2024/05/01", "2024/04/30"]];
  const st = MASK.newState();
  const r = MASK.apply(rows, [{ rule: "reldate" }, { rule: "reldate" }], st);
  assert.deepEqual(r.rows.slice(1), [["基準日+0日", "基準日+10日"], ["基準日+21日", "基準日+20日"]]);
  // 対応表を共有している間は同じ基準日。それより古い日は「基準日-N日」
  const r2 = MASK.apply([["日"], ["2024/04/01"]], [{ rule: "reldate" }], st);
  assert.equal(r2.rows[1][0], "基準日-9日");
});

test("マスキング：対応表を共有すると、別の表でも同じ仮名になる", () => {
  const st = MASK.newState();
  MASK.apply([["顧客"], ["甲社"], ["乙社"]], [{ rule: "pseudo", prefix: "顧客" }], st);
  const r2 = MASK.apply([["得意先"], ["乙社"], ["丙社"]], [{ rule: "pseudo", prefix: "顧客" }], st);
  assert.deepEqual(r2.rows.slice(1).map((r) => r[0]), ["顧客B", "顧客C"]);
});

test("マスキング：Excel の引用符つきセル（改行・タブ入り）を読み書きできる", () => {
  const rows = MASK.parseTable('a\tb\n"x\ny"\t"q""q"\n');
  assert.deepEqual(rows, [["a", "b"], ["x\ny", 'q"q']]);
  assert.equal(MASK.toTSV(rows), 'a\tb\n"x\ny"\t"q""q"');
  assert.equal(MASK.seqFormat("03-1234-5678", 7), "00-0000-0007");
});

test("マスキング：xlsx のように短い行（右端の空セルが無い）でも CSV・TSV に undefined を書かない（FIX-003）", () => {
  const rows = [["顧客名", "金額", "備考"], ["山田商事", "100"], ["佐藤工業", "200", "急ぎ"]];
  const rules = [{ rule: "pseudo", prefix: "顧客" }, { rule: "keep" }, { rule: "keep" }];
  const res = MASK.apply(rows, rules, MASK.newState());
  assert.ok(!MASK.toCSV(res.rows).includes("undefined"));
  assert.ok(!MASK.toTSV(res.rows).includes("undefined"));
  assert.equal(res.rows[1].length, 3);
});
