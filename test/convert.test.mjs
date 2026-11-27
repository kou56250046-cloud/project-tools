// P6b 資料の変換
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipEntries, zipText, zipWrite, resolvePart, relsPathOf } from '../src/core/zip.js';
import { XLSX } from '../src/core/xlsx.js';
import { TABLEPREP } from '../src/core/tableprep.js';
import { makeXlsx, makeDocx, makePptx, CFB_HEAD } from '../tools/make-convert-samples.mjs';
import { convertFile, detectKind, htmlToMd, CONVERT_MAX_BYTES } from '../src/core/convert.js';

const enc = (s) => new TextEncoder().encode(s);
const conv = (name, bytes) => convertFile(name, bytes, { today: '2026-11-26' });
const bodyOf = (md) => md.split('\n').slice(2).join('\n');   // 頭書きの 2 行を除く

// ---- T3 PDF・画像 ----
import { conversionPrompt, inspectMarkdown, pdfPageCount, GEMINI_CONVERT_QUESTIONS } from '../src/core/gemini-convert.js';

test('変換の指示文に 5 つの確認と「要約しない」が入る', () => {
  const p = conversionPrompt({ fileName: '仕様.pdf', kind: 'pdf', pages: 12 });
  assert.equal(GEMINI_CONVERT_QUESTIONS.length, 5);
  for (const x of GEMINI_CONVERT_QUESTIONS) assert.ok(p.includes(x.q), x.q);
  assert.ok(p.includes('要約') && p.includes('全 12 ページ') && p.includes('<!-- p.N -->'));
});

test('点検: 囲みつきで 2 回に分かれた返事をつなげても数えられる。印が無ければページを点検しない', () => {
  const reply = '```markdown\n<!-- p.1 -->\n# 第1章\n| a | b |\n| --- | --- |\n| 1 | 2 |\n```\n続きです\n```markdown\n<!-- p.3 -->\n## 節\n|a|b|\n|:---|---:|\n[読めない]の字\n```';
  const r = inspectMarkdown(reply, { pages: 3 });
  assert.deepEqual(r.missing, [2]);
  assert.equal(r.pageChecked, true);
  assert.equal(r.tables, 2);
  assert.equal(r.headings, 2);
  assert.equal(r.unreadable, 1);
  assert.ok(!r.md.includes('```'));
  const none = inspectMarkdown('# 見出し\n本文', { pages: 5 });
  assert.equal(none.pageChecked, false);
  assert.deepEqual(none.missing, []);
});

test('PDF のページ数: /Count を使い、増分で保存してページが二重でも正しい。読めなければ null', () => {
  const pdf = enc('%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >> endobj\n'
    + '3 0 obj << /Type /Page /Parent 2 0 R >> endobj\n4 0 obj << /Type /Page /Parent 2 0 R >> endobj\n'
    + '3 0 obj << /Type /Page /Parent 2 0 R /Annots [] >> endobj\n%%EOF');
  assert.equal(pdfPageCount(pdf), 2);
  assert.equal(pdfPageCount(enc('%PDF-1.7\n<< /Type /Page >> << /Type /Page >>')), 2);
  assert.equal(pdfPageCount(enc('%PDF-1.7\n圧縮されて読めない')), null);
});

// ---- T2 md 化と形式の判定 ----
test('docx: 見出しの判定・箇条書き・表の結合と入れ子・テキストボックス・図', async () => {
  const r = await conv('設計書.docx', makeDocx());
  assert.equal(r.ok, true);
  const md = r.md;
  for (const line of ['## 文書の題名', '## 第1章 背景', '### 第2節 日本語の見出し', '## 社内の見出し', '#### 段の見出し', '## 番号つきの見出し',
    '- 箇条書きの一', '  - 箇条書きの二（下の段）', '1. 丸数字の番号', '番号を外した段落', '[図]',
    '| 結合 |  | 右 |', '| 縦結合 | 一行目<br>二行目 | 内1 / 内2<br>内3 / 内4 |', '|  | 下 | 端 |']) {
    assert.ok(md.split('\n').includes(line), `「${line}」が無い`);
  }
  assert.equal(md.split('枠の中の文').length - 1, 1, 'テキストボックスが二重に出ている');
  assert.ok(md.indexOf('枠の前の文') < md.indexOf('枠の中の文'));
  assert.ok(!md.includes('- 番号を外した段落'));
  assert.match(md, /^<!-- 出典: 設計書\.docx \/ 変換: 2026-11-26 \/ 方式: 案件ワークベンチ（ブラウザの中で変換） \/ 見出し 6・表 1・段落 \d+ -->\n# 設計書\n/);
});

test('pptx: 表示の順・非表示・グループ・タイトルは本文に出ない・表の結合・ノートに番号が混ざらない', async () => {
  const r = await conv('説明資料.pptx', makePptx());
  const lines = r.md.split('\n');
  assert.ok(lines.indexOf('## スライド 1: 概要') < lines.indexOf('## スライド 2: 表紙（非表示）'));
  for (const line of ['- 一段目', '  - 二段目', '- グループの中', '- [図]', '| 結合 |  | 右 |', '> ノート: 話す内容その一', '> 話す内容その二']) {
    assert.ok(lines.includes(line), `「${line}」が無い`);
  }
  assert.ok(!lines.includes('- 概要'));
  assert.ok(!r.md.includes('> 3'));
  assert.match(lines[0], /スライド 2（うち非表示 1）・表 1/);
});

test('html: 見出し・入れ子の箇条書き・表の結合・セルの改行・リンク・pre・画像・文字参照・閉じタグの省略', () => {
  const html = `<!doctype html><html><head><title>x</title><style>p{}</style></head><body>
<h1>題名</h1><p>一つ目の段落<p>二つ目 &amp; &copy; &#x41;&#66; &nbsp;終わり
<script>alert(1)</script>
<ul><li>上<ul><li>下の段</ul><li>次</ul>
<ol><li>番号</ol>
<table><tr><th>A<th>B<th>C<tr><td colspan=2>結合<td>右<tr><td rowspan="2">縦<td><p>一<p>二<td>x<tr><td>下<td>y</table>
<p><a href="https://example.com/a">リンク</a> と <a href="javascript:void(0)">危ない</a> <img src="a.png" alt="構成図"> <img src="b.png">
<pre>  字下げ
  &lt;そのまま&gt;</pre></body></html>`;
  const { body, counts } = htmlToMd(html);
  const lines = body.split('\n');
  for (const line of ['## 題名', '一つ目の段落', '- 上', '  - 下の段', '- 次', '1. 番号', '| A | B | C |', '| 結合 |  | 右 |', '| 縦 | 一<br>二 | x |', '|  | 下 | y |',
    '  字下げ', '  <そのまま>']) {
    assert.ok(lines.includes(line), `「${line}」が無い`);
  }
  assert.ok(body.includes('二つ目 & © AB'));
  assert.ok(body.includes('[リンク](https://example.com/a) と 危ない [図: 構成図] [図]'));
  assert.ok(!body.includes('alert'));
  assert.ok(!body.includes('p{}'));
  assert.equal(counts, '見出し 1・表 1');
});

test('csv（Shift_JIS）・tsv（UTF-16 の BOM つき）・json（キーが 2 つ）・md の素通し', async () => {
  const sjis = new Uint8Array([0x96, 0xbc, 0x91, 0x4f, 0x2c, 0x8b, 0xe0, 0x8a, 0x7a, 0x0a, 0x82, 0xa0, 0x2c, 0x31, 0x0a, 0x82, 0xa2, 0x2c, 0x32, 0x0a]); // 名前,金額 / あ,1 / い,2
  let r = await conv('a.csv', sjis);
  assert.equal(r.kind, 'csv');
  assert.ok(r.md.includes('| 名前 | 金額 |\n|---|---|\n| あ | 1 |\n| い | 2 |'));
  assert.match(r.md, /行 2・列 2/);
  const u16 = new Uint8Array([0xff, 0xfe, ...[...'列1\t列2\nx\ty\n'].flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8])]);
  r = await conv('b.txt', u16);
  assert.equal(r.kind, 'tsv');
  assert.ok(r.md.includes('| 列1 | 列2 |'));
  r = await conv('c.json', enc('{"受注":[{"番号":1,"明細":{"品名":"A"}}],"顧客":[{"名前":"甲"}],"数":3}'));
  assert.equal(r.kind, 'json');
  assert.ok(r.md.includes('## 受注') && r.md.includes('## 顧客') && r.md.includes('| 番号 | 明細.品名 |'));
  assert.match(r.md, /表 2・行 2/);
  r = await conv('メモ.md', enc('# 見出し\n\n本文\n'));
  assert.equal(r.kind, 'text');
  assert.equal(bodyOf(r.md).trim(), '# 見出し\n\n本文');
});

test('形式の判定の順と、断る理由', async () => {
  const k = async (name, bytes) => (await detectKind(name, bytes));
  assert.equal((await k('a.xls', CFB_HEAD)).kind, 'reject');
  assert.match((await k('a.docx', CFB_HEAD)).reason, /暗号化/);
  const plainZip = zipWrite([{ name: 'readme.txt', data: 'x' }]);
  assert.match((await k('a.zip', plainZip)).reason, /対応していない zip/);
  assert.equal((await k('a.xlsx', makeXlsx())).kind, 'xlsx');
  assert.equal((await k('名前が.txt', makeDocx())).kind, 'docx');          // 中身を拡張子より優先する
  assert.equal((await k('a.txt', enc('<!DOCTYPE html><p>x'))).kind, 'html');
  assert.equal((await k('a.csv', enc('{"a":1}'))).kind, 'json');
  assert.match((await k('a.json', enc('{壊れた'))).reason, /JSON として読めません/);
  assert.equal((await k('a.txt', enc('{ではない文\n2行目'))).kind, 'text');
  assert.equal((await k('議事録.txt', enc('今日は晴れ。\n明日は雨。\n'))).kind, 'text');
  assert.equal((await k('a.pdf', enc('%PDF-1.7\n'))).kind, 'pdf');
  assert.equal((await k('a.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]))).kind, 'image');
  assert.match((await k('保存.mht', enc('MIME-Version: 1.0'))).reason, /単一ファイル/);
  const big = { length: CONVERT_MAX_BYTES + 1 };
  assert.match((await k('big.xlsx', big)).reason, /30MB/);
});

test('xlsx の md: シートごとの見出しと表、空のシート、数', async () => {
  const r = await conv('受注.xlsx', makeXlsx());
  assert.ok(r.md.includes('## 受注\n\n| 受注番号 | 得意先 | 金額 | 受注日 | 日時 | 確定 |'));
  assert.ok(r.md.includes('## 空\n\n（空のシート）'));
  assert.match(r.md.split('\n')[0], /シート 2・行 2/);
  assert.equal(r.tables.length, 1);
});

// ---- T1 zip・xlsx・表の下ごしらえ ----
test('圧縮した xlsx と無圧縮の xlsx が同じ表になる。日付・共有文字列・真偽・空のシート', async () => {
  const a = await XLSX.sheets(makeXlsx());
  const b = await XLSX.sheets(makeXlsx({ store: true }));
  assert.deepEqual(a, b);
  assert.deepEqual(a.map((s) => s.name), ['受注', '空']);
  const rows = a[0].rows;
  assert.deepEqual(rows[0], ['受注番号', '得意先', '金額', '受注日', '日時', '確定']);
  // シリアル値 46351 は 2026-11-25
  assert.deepEqual(rows[1], ['1001', '株式会社テスト商事', '15000', '2026-11-25', '2026-11-25 12:00', 'TRUE']);
  assert.deepEqual(rows[2], ['1002', '有限会社サンプル', '2500.5', '2026-11-26', '', 'FALSE']);
  assert.deepEqual(a[1].rows, []);
});

test('古い形式と zip でないファイルは理由つきで断る', async () => {
  await assert.rejects(XLSX.sheets(CFB_HEAD), /古い Excel/);
  await assert.rejects(XLSX.sheets(new TextEncoder().encode('ただの文字です。zip ではありません。ただの文字です。')), /zip ではありません/);
});

test('zip に書いて読み戻すと中身が同じ。rels の相対パスを解決する', async () => {
  const bytes = zipWrite([{ name: 'a.txt', data: 'あいう' }, { name: 'dir/b.bin', data: new Uint8Array([1, 2, 3]) }]);
  const z = zipEntries(bytes);
  assert.equal(await zipText(z, 'a.txt'), 'あいう');
  assert.deepEqual([...z.get('dir/b.bin').data], [1, 2, 3]);
  assert.equal(resolvePart('ppt/slides/slide1.xml', '../notesSlides/notesSlide1.xml'), 'ppt/notesSlides/notesSlide1.xml');
  assert.equal(resolvePart('xl/workbook.xml', 'worksheets/sheet1.xml'), 'xl/worksheets/sheet1.xml');
  assert.equal(resolvePart('xl/workbook.xml', '/xl/worksheets/sheet1.xml'), 'xl/worksheets/sheet1.xml');
  assert.equal(relsPathOf('ppt/slides/slide1.xml'), 'ppt/slides/_rels/slide1.xml.rels');
});

function bigTable(n) {
  const rows = [['番号', '地域', '金額']];
  for (let i = 1; i <= n; i++) rows.push([String(i), ['東', '西', '南'][i % 3], String(i * 100)]);
  return TABLEPREP.fromRows(rows, { name: '売上' });
}

test('表の下ごしらえ: 一式がそろい、データの分割に抜けも重なりも無い（まとめる・まとめない）', () => {
  const t = bigTable(1200);
  for (const merge of [false, true]) {
    const files = TABLEPREP.bundle(t, { size: 500, merge, groupCol: '地域', format: 'md' });
    const names = files.map((f) => f.name);
    if (merge) assert.ok(names.includes('売上_00_定義・集計・サンプル.md'));
    else for (const n of ['売上_00_項目定義書.md', '売上_01_集計.md', '売上_02_代表サンプル.md']) assert.ok(names.includes(n), n);
    const data = files.filter((f) => f.name.includes('10_データ'));
    assert.equal(data.length, 3);
    assert.deepEqual(data.map((f) => [f.from, f.to]), [[1, 500], [501, 1000], [1001, 1200]]);
    assert.ok(files.every((f) => !String(f.data).includes('gemini-kit')));
  }
  const csv = TABLEPREP.bundle(t, { size: 1000, format: 'csv' }).filter((f) => f.name.endsWith('.csv'));
  assert.equal(csv.length, 2);
  assert.ok(csv[0].data.startsWith('﻿"番号","地域","金額"'));
});

test('JSON は safeParse で読み、__proto__・constructor のキーでプロトタイプが変わらない', () => {
  const text = '{"受注":[{"番号":"1","__proto__":{"polluted":true},"constructor":{"x":1},"明細":{"品名":"A"}}],"空":[]}';
  const { table, keys } = TABLEPREP.fromJSON(text, { name: 'j' });
  assert.deepEqual(keys, ['受注']);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  assert.ok(table.cols.includes('明細.品名'));
});

// ---- FIX-012・FIX-013: 展開後の大きさと、xlsx の行・列の番号の上限 ----
import { makeZip } from '../tools/make-convert-samples.mjs';
import { zipBytes, ZIP_ENTRY_MAX } from '../src/core/zip.js';

const xlsxWithSheet = (sheet) => makeZip([
  { name: 'xl/workbook.xml', data: '<workbook xmlns:r="r"><sheets><sheet name="s" sheetId="1" r:id="rId1"/></sheets></workbook>' },
  { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
  { name: 'xl/worksheets/sheet1.xml', data: `<worksheet><sheetData>${sheet}</sheetData></worksheet>` },
]);

test('目次の展開後の大きさが上限を超える中のファイルは、展開する前に断る', async () => {
  const z = makeZip([{ name: 'big.xml', data: 'x' }]);
  // 目次（central directory）の展開後の大きさを 300MB に書き換える
  const view = new DataView(z.buffer);
  for (let i = z.length - 22; i >= 0; i--) if (view.getUint32(i, true) === 0x02014b50) { view.setUint32(i + 24, 300 * 1024 * 1024, true); break; }
  await assert.rejects(zipBytes(zipEntries(z), 'big.xml'), /大きすぎる/);
});

test('目次が小さく偽っていても、展開しながら上限を超えたら止めて断る', async () => {
  const big = new Uint8Array(ZIP_ENTRY_MAX + 1024);
  const z = makeZip([{ name: 'bomb.xml', data: big }]);
  const view = new DataView(z.buffer);
  for (let i = z.length - 22; i >= 0; i--) if (view.getUint32(i, true) === 0x02014b50) { view.setUint32(i + 24, 10, true); break; }
  assert.ok(z.length < 1024 * 1024, '圧縮後は小さい');
  await assert.rejects(zipBytes(zipEntries(z), 'bomb.xml'), /大きすぎる/);
});

test('xlsx の行・列の番号が Excel の上限を超えると断る（巨大な配列を作らない）', async () => {
  await assert.rejects(XLSX.sheets(xlsxWithSheet('<row r="300000000"><c r="A300000000" t="str"><v>x</v></c></row>')), /行の番号/);
  await assert.rejects(XLSX.sheets(xlsxWithSheet('<row r="1"><c r="ZZZZZZ1" t="str"><v>x</v></c></row>')), /列の番号/);
  // 飛んだ行番号は、出てきた順に詰める
  const s = await XLSX.sheets(xlsxWithSheet('<row r="1"><c r="A1" t="str"><v>a</v></c></row><row r="5000"><c r="A5000" t="str"><v>b</v></c></row>'));
  assert.deepEqual(s[0].rows, [['a'], ['b']]);
});

test('Excel の経過時間・1900 年 1〜2 月・1904 年基準（FIX-008）', async () => {
  assert.equal(XLSX.serialToElapsed(1.5), '36:00');
  assert.equal(XLSX.serialToDate(1), '1900-01-01');
  assert.equal(XLSX.serialToDate(59), '1900-02-28');
  assert.equal(XLSX.serialToDate(61), '1900-03-01');
  assert.equal(XLSX.serialToDate(46351), XLSX.serialToDate(46351 - 1462, true), '1904 年基準は 1462 日ずれる');
  const styles = '<styleSheet><numFmts><numFmt numFmtId="200" formatCode="[h]:mm"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="200"/><xf numFmtId="14"/></cellXfs></styleSheet>';
  const z = makeZip([
    { name: 'xl/workbook.xml', data: '<workbook xmlns:r="r"><workbookPr date1904="1"/><sheets><sheet name="s" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: 'xl/styles.xml', data: styles },
    { name: 'xl/worksheets/sheet1.xml', data: '<worksheet><sheetData><row r="1"><c r="A1" s="1"><v>1.5</v></c><c r="B1" s="2"><v>0</v></c></row></sheetData></worksheet>' },
  ]);
  const s = await XLSX.sheets(z);
  assert.deepEqual(s[0].rows[0], ['36:00', '1904-01-01']);
});
