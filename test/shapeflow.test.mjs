// P6d T1・T3: 図形と矢印 → フロー記法（PPT）・SmartArt
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapesToFlow, SHAPEFLOW_MAX } from '../src/core/shapeflow.js';
import { smartArtToMd } from '../src/core/smartart.js';
import { FLOWCHART } from '../src/core/flow.js';
import { convertFile, parseXml } from '../src/core/convert.js';
import { makeFlowPptx, makePptx } from '../tools/make-convert-samples.mjs';

const flowsIn = (md) => [...md.matchAll(/```flow\n([\s\S]*?)\n```/g)].map((m) => m[1]);

test('PPT: 図形が矢印でつながったスライドは ```flow になり、種類・向き・ラベル・レーンが正しい', async () => {
  const r = await convertFile('流れ.pptx', makeFlowPptx(), { today: '2026-11-27' });
  assert.equal(r.ok, true);
  const [flow] = flowsIn(r.md);
  assert.ok(flow, 'フロー記法が出る');
  const g = FLOWCHART.parse(flow);
  assert.deepEqual(g.errors, []);
  assert.deepEqual(g.lanes, ['営業', '経理']);
  const node = (label) => g.nodes.find((n) => n.label === label);
  assert.equal(node('受付').type, 'start');
  assert.equal(node('金額は10万以上か').type, 'decision');
  assert.equal(node('完了').type, 'end');
  assert.equal(node('部長承認').lane, '経理', 'グループの中の図形も、座標を写してレーンに入る');
  const edge = (a, b) => g.edges.find((e) => e.from === node(a).id && e.to === node(b).id);
  assert.ok(edge('内容確認', '金額は10万以上か'), '接続の印が無い線は端点の近さで結ぶ');
  assert.equal(edge('金額は10万以上か', '部長承認').label, 'はい');
  assert.equal(edge('金額は10万以上か', '完了').label, 'いいえ');
  assert.ok(edge('部長承認', '完了'), '矢じりが始点側だけの線は向きを逆にする');
  // フローに使った図形の文字は箇条書きに重ねない。使わなかった図形の文字は残す
  const slide1 = r.md.split('## スライド 2')[0];
  assert.ok(!/^- (受付|内容確認|営業|はい)$/m.test(slide1));
  assert.match(slide1, /^- 補足のメモ$/m);
  assert.match(r.counts, /フロー 1/);
});

test('PPT: 線が 1 本以下のスライドは今までどおり（フロー記法を出さない）', async () => {
  const r = await convertFile('説明資料.pptx', makePptx(), { today: '2026-11-27' });
  assert.equal(flowsIn(r.md).length, 0);
  assert.match(r.md, /- グループの中/);
});

test('shapesToFlow: 線が 2 本未満・図形が多すぎる・つながらない線は起こさない', () => {
  const box = (id, x) => ({ id, text: `箱${id}`, geom: 'rect', x, y: 0, w: 100, h: 50 });
  assert.equal(shapesToFlow({ shapes: [box(1, 0), box(2, 200)], links: [{ from: 1, to: 2, x1: 100, y1: 25, x2: 200, y2: 25, tail: true }] }).ok, false);
  const many = Array.from({ length: SHAPEFLOW_MAX + 1 }, (_, i) => box(i + 1, i * 200));
  assert.equal(shapesToFlow({ shapes: many, links: [{ from: 1, to: 2 }, { from: 2, to: 3 }] }).ok, false);
  // 遠く離れた線は図形に結ばない
  const far = shapesToFlow({ shapes: [box(1, 0), box(2, 200)], links: [{ x1: 5000, y1: 5000, x2: 6000, y2: 5000 }, { x1: 7000, y1: 5000, x2: 8000, y2: 5000 }] });
  assert.equal(far.ok, false);
  // ラベルの記号（-> や [ ]）は記法を壊さない形に置き換える
  const ok = shapesToFlow({ shapes: [box(1, 0), { ...box(2, 200), text: '見積->受注 [A]' }, box(3, 400)], links: [{ from: 1, to: 2, tail: true, x1: 0, y1: 0, x2: 0, y2: 0 }, { from: 2, to: 3, tail: true, x1: 0, y1: 0, x2: 0, y2: 0 }] });
  assert.equal(ok.ok, true);
  assert.deepEqual(FLOWCHART.parse(ok.notation).errors, []);
  assert.match(ok.notation, /見積→受注 ［A］/);
});

test('SmartArt: 手順型はフロー記法（並びは srcOrd の順）、階層型は字下げの箇条書き', async () => {
  const r = await convertFile('流れ.pptx', makeFlowPptx(), { today: '2026-11-27' });
  const s2 = r.md.split('## スライド 2')[1];
  const [proc] = flowsIn(s2);
  const g = FLOWCHART.parse(proc);
  assert.deepEqual(g.nodes.map((n) => n.label), ['申請', '審査', '支払']);
  assert.equal(g.edges.length, 2);
  assert.match(s2, /- 本部\n  - 営業部\n    - 一課/);
  assert.equal(smartArtToMd(parseXml('<x/>')), '');
});

import { makeFlowXlsx } from '../tools/make-convert-samples.mjs';
test('Excel: 図形のフロー・テキストボックスの文字・非表示シート・結合セル・コメント（T2）', async () => {
  const r = await convertFile('申請.xlsx', makeFlowXlsx(), { today: '2026-11-27' });
  assert.equal(r.ok, true, r.reason);
  const [flow] = flowsIn(r.md);
  const g = FLOWCHART.parse(flow);
  assert.deepEqual(g.errors, []);
  assert.deepEqual(g.nodes.map((n) => [n.type, n.label]), [['start', '受付'], ['task', '入力'], ['data', '登録']]);
  assert.match(r.md, /- 図形の文字: 担当者が確認すること/);
  assert.ok(!/図形の文字: 受付/.test(r.md), 'フローに使った図形の文字は重ねない');
  assert.match(r.md, /## 作業用（非表示）/);
  assert.match(r.md, /結合したセル: A2:B2/);
  assert.match(r.md, /- コメント B1: 税抜で入れる/);
  assert.match(r.counts, /うち非表示 1/);
});

import { makeZip } from '../tools/make-convert-samples.mjs';
test('Word の SmartArt は字下げの箇条書き（T3）', async () => {
  const DG = 'xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
  const data = `<dgm:dataModel ${DG}><dgm:ptLst><dgm:pt modelId="0" type="doc"><dgm:prSet loTypeId="urn:x/layout/hierarchy2"/></dgm:pt><dgm:pt modelId="a"><dgm:t><a:p><a:r><a:t>親</a:t></a:r></a:p></dgm:t></dgm:pt><dgm:pt modelId="b"><dgm:t><a:p><a:r><a:t>子</a:t></a:r></a:p></dgm:t></dgm:pt></dgm:ptLst><dgm:cxnLst><dgm:cxn modelId="c1" srcId="0" destId="a" srcOrd="0"/><dgm:cxn modelId="c2" srcId="a" destId="b" srcOrd="0"/></dgm:cxnLst></dgm:dataModel>`;
  const doc = '<w:document xmlns:w="w" xmlns:r="r"><w:body><w:p><w:r><w:t>前の段落</w:t></w:r></w:p><w:p><w:r><w:drawing><a:graphic xmlns:a="a"><a:graphicData><dgm:relIds xmlns:dgm="d" r:dm="rIdS"/></a:graphicData></a:graphic></w:drawing></w:r></w:p></w:body></w:document>';
  const z = makeZip([
    { name: '[Content_Types].xml', data: '<Types/>' },
    { name: 'word/document.xml', data: doc },
    { name: 'word/_rels/document.xml.rels', data: '<Relationships><Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData" Target="diagrams/data1.xml"/></Relationships>' },
    { name: 'word/diagrams/data1.xml', data: data },
  ]);
  const r = await convertFile('手順.docx', z, { today: '2026-11-27' });
  assert.equal(r.ok, true, r.reason);
  assert.match(r.md, /\[SmartArt\]\n- 親\n  - 子/);
  assert.match(r.counts, /SmartArt 1/);
});

test('HTML: svg の文字・mermaid・フロー記法（flow-src / flow）を戻す。ツールの図の svg は読み飛ばす（T3）', async () => {
  const html = '<html><body><h1>表題</h1><svg><text>受付</text><text>承認</text></svg>'
    + '<pre class="mermaid">graph TD; A-->B</pre>'
    + '<svg class="bfl-svg"><text>重ねない</text></svg><pre class="flow-src" hidden>task A 一\ntask B 二\nA -> B</pre>'
    + '<pre class="flow">start S 始め\nend Z 終わり\nS -> Z</pre></body></html>';
  const r = await convertFile('a.html', new TextEncoder().encode(html), { today: '2026-11-27' });
  assert.match(r.md, /\[図の文字: 受付 ／ 承認\]/);
  assert.match(r.md, /```mermaid\ngraph TD; A-->B\n```/);
  assert.equal(flowsIn(r.md).length, 2);
  assert.ok(!r.md.includes('重ねない'));
});

import { conversionPrompt, convertQuestions, flowImagePrompt, GEMINI_CONVERT_QUESTIONS } from '../src/core/gemini-convert.js';
test('Gemini 指示文: 種類 × 目的ごとの問い・最初は問いだけ・フロー記法の説明・HTML の禁止事項（T4）', () => {
  for (const kind of ['pdf', 'image', 'pptx', 'html']) {
    const p = conversionPrompt({ fileName: 'x', kind, pages: 3 });
    const qs = convertQuestions(kind, 'md');
    assert.ok(p.includes(`次の ${qs.length} つ`), kind);
    for (const q of qs) assert.ok(p.includes(q.q), `${kind}: ${q.q}`);
    assert.ok(p.includes('まだ書き写さないでください') && p.includes('# フロー記法') && p.includes('```flow'), kind);
    assert.doesNotMatch(p, /\{\{/);
  }
  assert.ok(convertQuestions('pptx').some((q) => /ノート/.test(q.q)));
  assert.ok(!convertQuestions('image').some((q) => /区切り/.test(q.q)));
  assert.ok(conversionPrompt({ fileName: 'x', kind: 'pdf', pages: 12 }).includes('全 12 ページ'));
  assert.ok(conversionPrompt({ fileName: 'x', kind: 'pptx', pages: 8 }).includes('全 8 スライド'));
  for (const kind of ['xlsx', 'pptx', 'pdf']) {
    const p = conversionPrompt({ fileName: 'x', kind, target: 'html' });
    for (const q of convertQuestions(kind, 'html')) assert.ok(p.includes(q.q), `${kind}: ${q.q}`);
    assert.ok(p.includes('<script>') && p.includes('<pre class="flow">') && p.includes('```html') && p.includes('<style>'), kind);
  }
  assert.ok(convertQuestions('xlsx', 'html').some((q) => /非表示のシート/.test(q.q)));
  const f = flowImagePrompt({ fileName: '流れ.png' });
  assert.ok(f.includes('次の 3 つ') && f.includes('# フロー記法') && f.includes('{AI}'));
  assert.equal(GEMINI_CONVERT_QUESTIONS.length, 5);
});
