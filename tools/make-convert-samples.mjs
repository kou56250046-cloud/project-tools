// 開発用: 資料の変換（P6b）のテストに使うダミーのファイルを組み立てる。実案件のデータは入れない。
// テストは import して中身をその場で作る。`node tools/make-convert-samples.mjs` で test/fixtures/convert/ にも書き出す（ブラウザで確かめる用）
import { deflateRawSync, crc32 } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const enc = new TextEncoder();

// files: [{ name, data: 文字列 | Uint8Array, store?: true }] → zip（store なら無圧縮、それ以外は deflate）
export function makeZip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const raw = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const method = f.store ? 0 : 8;
    const body = method ? deflateRawSync(raw) : raw;
    const crc = crc32(raw) >>> 0;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
    chunks.push(lh, name, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...chunks, cd, end]));
}

// ---- xlsx: シート「受注」（共有文字列・数値・日付・日時・真偽）とシート「空」 ----
export function makeXlsx({ store = false } = {}) {
  const ss = ['受注番号', '得意先', '金額', '受注日', '日時', '確定', '株式会社テスト商事', '有限会社サンプル'];
  const si = ss.map((s) => `<si><t>${s}</t></si>`).join('');
  const sheet1 = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c><c r="F1" t="s"><v>5</v></c></row>
<row r="2"><c r="A2"><v>1001</v></c><c r="B2" t="s"><v>6</v></c><c r="C2"><v>15000</v></c><c r="D2" s="1"><v>46351</v></c><c r="E2" s="1"><v>46351.5</v></c><c r="F2" t="b"><v>1</v></c></row>
<row r="3"><c r="A3"><v>1002</v></c><c r="B3" t="s"><v>7</v></c><c r="C3"><v>2500.5</v></c><c r="D3" s="1"><v>46352</v></c><c r="F3" t="b"><v>0</v></c></row>
</sheetData></worksheet>`;
  const sheet2 = '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>';
  return makeZip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>', store },
    { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="受注" sheetId="1" r:id="rId1"/><sheet name="空" sheetId="2" r:id="rId2"/></sheets></workbook>', store },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="worksheet" Target="worksheets/sheet2.xml"/></Relationships>', store },
    { name: 'xl/sharedStrings.xml', data: `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${si}</sst>`, store },
    { name: 'xl/styles.xml', data: '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>', store: true },
    { name: 'xl/worksheets/sheet1.xml', data: sheet1, store },
    { name: 'xl/worksheets/sheet2.xml', data: sheet2, store },
  ]);
}

// ---- docx: 見出しの判定・箇条書き・表（結合・入れ子）・テキストボックス・図 ----
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:wp="x" xmlns:wps="y" xmlns:a="z" xmlns:v="v"';
const wp = (text, pPr = '') => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const st = (id) => `<w:pStyle w:val="${id}"/>`;
const num = (id, lvl = 0) => `<w:numPr><w:ilvl w:val="${lvl}"/><w:numId w:val="${id}"/></w:numPr>`;
const tc = (inner, pr = '') => `<w:tc>${pr ? `<w:tcPr>${pr}</w:tcPr>` : ''}${inner}</w:tc>`;
export function makeDocx() {
  const styles = `<?xml version="1.0" encoding="UTF-8"?><w:styles ${W}>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
<w:style w:type="paragraph" w:styleId="a2"><w:name w:val="見出し 2"/></w:style>
<w:style w:type="paragraph" w:styleId="CorpH"><w:name w:val="社内見出し"/><w:basedOn w:val="Heading1"/></w:style>
<w:style w:type="paragraph" w:styleId="ListNum"><w:name w:val="List Number"/><w:pPr><w:numPr><w:numId w:val="2"/></w:numPr></w:pPr></w:style>
</w:styles>`;
  const numbering = `<?xml version="1.0" encoding="UTF-8"?><w:numbering ${W}>
<w:abstractNum w:abstractNumId="10"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="20"><w:lvl w:ilvl="0"><w:numFmt w:val="decimalEnclosedCircle"/></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="10"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="20"/></w:num>
</w:numbering>`;
  const textbox = '<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor><a:graphic><a:graphicData><wps:wsp><wps:txbx><w:txbxContent>'
    + wp('枠の中の文') + '</w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice><mc:Fallback><w:pict><v:shape><v:textbox><w:txbxContent>'
    + wp('枠の中の文') + '</w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r><w:r><w:t>枠の前の文</w:t></w:r></w:p>';
  const nested = `<w:tbl><w:tr>${tc(wp('内1'))}${tc(wp('内2'))}</w:tr><w:tr>${tc(wp('内3'))}${tc(wp('内4'))}</w:tr></w:tbl>`;
  const table = `<w:tbl>
<w:tr>${tc(wp('項目'))}${tc(wp('内容'))}${tc(wp('備考'))}</w:tr>
<w:tr>${tc(wp('結合'), '<w:gridSpan w:val="2"/>')}${tc(wp('右'))}</w:tr>
<w:tr>${tc(wp('縦結合'), '<w:vMerge w:val="restart"/>')}${tc(wp('一行目') + wp('二行目'))}${tc(nested)}</w:tr>
<w:tr>${tc(wp(''), '<w:vMerge/>')}${tc(wp('下'))}${tc(wp('端'))}</w:tr>
</w:tbl>`;
  const body = [
    wp('文書の題名', st('Title')),
    wp('第1章 背景', st('Heading1')),
    wp('第2節 日本語の見出し', st('a2')),
    wp('社内の見出し', st('CorpH')),
    wp('段の見出し', '<w:outlineLvl w:val="2"/>'),
    wp('番号つきの見出し', st('Heading1') + num(2)),
    wp('本文の段落です。'),
    wp('箇条書きの一', num(1)),
    wp('箇条書きの二（下の段）', num(1, 1)),
    wp('丸数字の番号', st('ListNum')),
    wp('番号を外した段落', num(0)),
    textbox,
    table,
    '<w:p><w:r><w:drawing><wp:inline><a:graphic/></wp:inline></w:drawing></w:r></w:p>',
    wp('おわり'),
  ].join('\n');
  return makeZip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0"?><Types/>' },
    { name: 'word/document.xml', data: `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}<w:sectPr/></w:body></w:document>` },
    { name: 'word/styles.xml', data: styles },
    { name: 'word/numbering.xml', data: numbering },
  ]);
}

// ---- pptx: 並び順・非表示・グループ・表（結合）・図・ノート ----
const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const sp = (ph, paras) => `<p:sp><p:nvSpPr><p:cNvPr id="1" name="x"/><p:cNvSpPr/><p:nvPr>${ph ? `<p:ph${ph === 'body' ? '' : ` type="${ph}"`}/>` : ''}</p:nvPr></p:nvSpPr><p:txBody>${paras.map(([t, lvl]) => `<a:p>${lvl ? `<a:pPr lvl="${lvl}"/>` : ''}<a:r><a:t>${t}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>`;
export function makePptx() {
  const atc = (t, attrs = '') => `<a:tc${attrs}><a:txBody><a:p><a:r><a:t>${t}</a:t></a:r></a:p></a:txBody></a:tc>`;
  const table = `<p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tr>${atc('列A')}${atc('列B')}${atc('列C')}</a:tr><a:tr>${atc('結合', ' gridSpan="2"')}${atc('', ' hMerge="1"')}${atc('右')}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
  const slideA = `<?xml version="1.0" encoding="UTF-8"?><p:sld ${P}><p:cSld><p:spTree>${sp('title', [['概要']])}${sp('body', [['一段目'], ['二段目', 1]])}<p:grpSp><p:nvGrpSpPr/>${sp(null, [['グループの中']])}</p:grpSp>${table}<p:pic/></p:spTree></p:cSld></p:sld>`;
  const slideB = `<?xml version="1.0" encoding="UTF-8"?><p:sld ${P} show="0"><p:cSld><p:spTree>${sp('ctrTitle', [['表紙']])}</p:spTree></p:cSld></p:sld>`;
  const notes = `<?xml version="1.0" encoding="UTF-8"?><p:notes ${P}><p:cSld><p:spTree>${sp('sldImg', [])}${sp('body', [['話す内容その一'], ['話す内容その二']])}${sp('sldNum', [['3']])}</p:spTree></p:cSld></p:notes>`;
  return makeZip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0"?><Types/>' },
    // 表示の順は slide2.xml（概要）→ slide1.xml（表紙・非表示）。ファイル名の番号順とは違う
    { name: 'ppt/presentation.xml', data: `<?xml version="1.0" encoding="UTF-8"?><p:presentation ${P}><p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>` },
    { name: 'ppt/_rels/presentation.xml.rels', data: '<?xml version="1.0"?><Relationships><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>' },
    { name: 'ppt/slides/slide1.xml', data: slideB },
    { name: 'ppt/slides/slide2.xml', data: slideA },
    { name: 'ppt/slides/_rels/slide2.xml.rels', data: '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>' },
    { name: 'ppt/notesSlides/notesSlide1.xml', data: notes },
  ]);
}

// 古い Office（CFB）の先頭
export const CFB_HEAD = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'convert');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'sample.xlsx'), makeXlsx());
  writeFileSync(join(dir, 'sample-stored.xlsx'), makeXlsx({ store: true }));
  writeFileSync(join(dir, 'sample.docx'), makeDocx());
  writeFileSync(join(dir, 'sample.pptx'), makePptx());
  console.log('書き出しました: ' + dir);
}
