// 資料の変換を Gemini に任せるときの指示文と、返ってきた Markdown の点検。DOM に触れない。
// 指示文は、まず選択肢つきで確かめさせてから、要約せずに一字一句書き写させる（ユーザーの案）
// P6d: md にする（PDF・画像・PowerPoint・HTML）、HTML にする（Excel・PowerPoint・PDF）、画像のフローをフロー記法にする、の 3 種類

import { flowFormatText } from './flow-format.js';

// 先に確かめる共通の 5 つ（番号で答えられる形）
export const GEMINI_CONVERT_QUESTIONS = [
  { q: '表の扱い', choices: ['Markdown の表にする', '箇条書きにする'] },
  { q: '図・写真の扱い', choices: ['内容の説明を [図: …] で書く', '[図] の印だけ残す'] },
  { q: '見出しの付け方', choices: ['文字の大きさから見出しの段（#・##・###）を推定する', '見出しを付けない'] },
  { q: 'ページの区切り', choices: ['各ページの先頭に <!-- p.N --> を入れる（N はページ番号）', '入れない'] },
  { q: '読めない文字', choices: ['[読めない] と書く', '前後から推定して [推定: …] と書く'] },
];
// フロー図（業務の流れ・手順・分岐の図）の扱い。md では ```flow、HTML では <pre class="flow"> にフロー記法で書かせる
const Q_FLOW_MD = { q: 'フロー図（業務の流れ・手順・分岐の図）の扱い', choices: ['下の「フロー記法」で ```flow の囲みに書く（箱・矢印・分岐・レーンを残す）', '手順を番号つきの箇条書きで書く'] };
const Q_FLOW_HTML = { q: 'フロー図（業務の流れ・手順・分岐の図）の扱い', choices: ['下の「フロー記法」で <pre class="flow"> の中に書く（あとで図にします）', '手順を番号つきの箇条書きで書く'] };
const Q_SLIDE = { q: 'スライドの区切り', choices: ['各スライドの先頭に <!-- p.N --> と「## スライド N: タイトル」を入れる', '区切りを入れない'] };
const Q_NOTES = { q: 'スライドのノート（話す内容）', choices: ['各スライドの最後に「> ノート: …」で入れる', '入れない'] };
const Q_HIDDEN = { q: '非表示のスライド', choices: ['入れて、見出しに（非表示）と付ける', '入れない'] };
const Q_SHEETS = { q: '非表示のシートとセルのコメント', choices: ['どちらも入れる（シート名に（非表示）、コメントは表の下に「コメント A1: …」）', 'どちらも入れない'] };
const Q_CHAPTER = { q: '章の分け方', choices: ['元の区切り（ページ・スライド・シート）ごとに章（<h2>）にする', '内容の見出しで章を分ける'] };
const Q_TABLE_HTML = { q: '表の見せ方', choices: ['元の表のまま（見出しの行を <thead> に、結合は rowspan・colspan で）', '長い表（30 行超）は <details> で折りたたむ'] };
const Q_TOC = { q: '目次', choices: ['先頭に章の目次（ページ内のリンク）を付ける', '付けない'] };
const Q_FLOW_LANE = { q: 'レーン（担当の帯）', choices: ['図の帯・列の見出しをそのままレーンにする', 'レーンを使わない'] };
const Q_FLOW_ROLE = { q: '処理の区分', choices: ['箱ごとに {AI}・{ルール}・{人}・{外部} を推定して付け、推定したものは末尾に一覧で書く', '区分を付けない'] };

const KIND_NAME = { pdf: 'PDF', image: '画像', pptx: 'PowerPoint', html: 'HTML', xlsx: 'Excel' };
// kind ごとの問い。target: 'md' | 'html'
export function convertQuestions(kind, target = 'md') {
  const [table, fig, head, page, unread] = GEMINI_CONVERT_QUESTIONS;
  if (target === 'html') {
    const qs = [Q_CHAPTER, Q_TABLE_HTML, fig, Q_FLOW_HTML, Q_TOC, unread];
    if (kind === 'pptx') qs.push(Q_NOTES, Q_HIDDEN);
    if (kind === 'xlsx') qs.push(Q_SHEETS);
    return qs;
  }
  const qs = [table, fig, head];
  if (kind === 'pdf') qs.push(page);
  if (kind === 'pptx') qs.push(Q_SLIDE);
  qs.push(unread, Q_FLOW_MD);
  if (kind === 'pptx') qs.push(Q_NOTES, Q_HIDDEN);
  return qs;
}
const qsText = (qs) => qs.map((x, i) => `${i + 1}. ${x.q}\n${x.choices.map((c, j) => `   ${String.fromCharCode(97 + j)}) ${c}`).join('\n')}`).join('\n');
const answerExample = (qs) => qs.map((_, i) => `${i + 1}a`).join(' ');
const ATTACH_NOTE = {
  pptx: '（PowerPoint を添付できないときは、PowerPoint で PDF に保存してから添付してください。スライドのノートは PDF に入らないので、ノートが要るときは「ノートを含めて PDF に保存」を選びます）',
  xlsx: '（Excel を添付できないときは、シートごとに PDF に保存してから添付してください）',
  html: '（HTML を添付できないときは、ブラウザで開いて「PDF に保存」したものを添付してください）',
};
// HTML にするときに使ってよい書式（見た目をそろえるため、指示文で決める）
export const HTML_STYLE = 'body{font-family:Arial,"メイリオ",Meiryo,sans-serif;max-width:1100px;margin:24px auto;padding:0 16px;line-height:1.7;color:#000}h1{font-size:24px;border-bottom:3px solid #0017C1}h2{font-size:20px;border-left:6px solid #0017C1;padding-left:8px;margin-top:2em}h3{font-size:16px}table{border-collapse:collapse;margin:8px 0}th,td{border:1px solid #ccc;padding:4px 8px;vertical-align:top}th{background:#F1F1F4}pre.flow{background:#F8F8FB;border:1px solid #ccc;padding:8px;white-space:pre-wrap}.note{color:#626264;font-size:13px}';

// md にする: kind は 'pdf' | 'image' | 'pptx' | 'html'。HTML にする: target='html'、kind は 'xlsx' | 'pptx' | 'pdf'
export function conversionPrompt({ fileName, kind, pages, target = 'md' }) {
  const unit = kind === 'pptx' ? 'スライド' : kind === 'xlsx' ? 'シート' : 'ページ';
  const what = `${KIND_NAME[kind] || '資料'}「${fileName}」${pages ? `（全 ${pages} ${unit}）` : ''}`;
  const qs = convertQuestions(kind, target);
  const common = [
    '## 守ること',
    '- 要約・言い換え・補足・意見を書かない。資料にある文字だけを、出てくる順に書く',
    '- 数字・固有名詞・記号・表の値を変えない。単位も省かない',
    '- 途中で止まったら、「続き」と言われてから、止まったところの次から続ける（前の部分を繰り返さない）',
  ];
  const ask = [
    '## 最初の返事でやること',
    `まだ書き写さないでください。次の ${qs.length} つを、番号と記号（例「${answerExample(qs)}」）で答えられるように、そのまま私に聞いてください。`,
    '',
    qsText(qs),
  ];
  if (target === 'html') {
    return [
      `あなたは、資料の内容を一字一句そのまま、読みやすい 1 枚の HTML に書き写す係です。添付した${what}を書き写してください。${ATTACH_NOTE[kind] || ''}`,
      '',
      ...common,
      '- 見た目の飾りより、元の資料の内容・順序・表の値が正しく読めることを優先する',
      '',
      ...ask,
      '',
      '## 答えを受けた後',
      '- 1 枚の HTML（<!DOCTYPE html> から </html> まで）を書く。<title> に資料の名前を入れる',
      '- 見出しは <h1>（資料の名前）・<h2>（章）・<h3> だけを使う。表は <table>、箇条書きは <ul>・<ol>',
      `- <style> には次の書式だけをそのまま入れる（ほかの CSS・style 属性を書かない）: ${HTML_STYLE}`,
      '- <script>・外部のファイルの読み込み（http で始まる URL・<link>・<iframe>）・画像（<img>）を書かない。図は <p class="note">[図: …]</p> で表す',
      '- フロー図をフロー記法で書くときは <pre class="flow"> の中に書く（HTML の特別な文字 < > & は &lt; &gt; &amp; にする）',
      '- 出力は ```html の囲みの中に HTML だけを書く。囲みの外に説明を書かない',
      '',
      flowFormatText(),
    ].join('\n') + '\n';
  }
  return [
    `あなたは、資料を一字一句そのまま Markdown に書き写す係です。添付した${what}を書き写してください。${ATTACH_NOTE[kind] || ''}`,
    '',
    ...common,
    '',
    ...ask,
    '',
    '## 答えを受けた後',
    `- 答えに合わせて、全${unit}を順に書き写す`,
    '- フロー図をフロー記法で書くときは ```flow の囲みに入れる（本文の ```markdown の囲みの中に、入れ子で書いてよい）',
    '- 出力は ```markdown の囲みの中に本文だけを書く。囲みの外に説明を書かない',
    '',
    flowFormatText(),
  ].join('\n') + '\n';
}

// 画像（スクリーンショット・写真）になっているフロー図を、フロー記法に書き写させる
export function flowImagePrompt({ fileName }) {
  const qs = [Q_FLOW_LANE, Q_FLOW_ROLE, GEMINI_CONVERT_QUESTIONS[4]];
  return [
    `あなたは、図を正確に読み取って書き写す係です。添付した画像「${fileName}」のフロー図（業務の流れ・手順・分岐の図）を、下の「フロー記法」に書き写してください。`,
    '',
    '## 守ること',
    '- 図に書かれた文字をそのまま使う。言い換え・要約・補足をしない',
    '- 箱・ひし形・矢印・矢印のラベル（はい・いいえ等）をすべて書く。見えない矢印を足さない',
    '- 矢印の向きが分からないところは、そのノートを note 行で書く（例: note A 矢印の向きが読めない）',
    '',
    '## 最初の返事でやること',
    `まだ書き写さないでください。次の ${qs.length} つを、番号と記号（例「${answerExample(qs)}」）で答えられるように、そのまま私に聞いてください。`,
    '',
    qsText(qs),
    '',
    '## 答えを受けた後',
    '- ```flow の囲みの中にフロー記法だけを書く。囲みの外には、読めなかった文字と推定した区分の一覧だけを書く',
    '',
    flowFormatText(),
  ].join('\n') + '\n';
}

// 貼った返事から ``` の囲みの行をすべて外す（何回かに分かれた返事をつなげて貼ってよい）
export function stripFences(text) {
  return String(text).split(/\r?\n/).filter((l) => !/^\s*```/.test(l)).join('\n').replace(/^\s+|\s+$/g, '') + '\n';
}

const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

// 戻り値 { md, pageMarks, pagesExpected, missing, pageChecked, tables, headings, unreadable }
export function inspectMarkdown(text, { pages } = {}) {
  const md = stripFences(text);
  const lines = md.split('\n');
  const marks = new Set();
  for (const m of md.matchAll(/<!--\s*p\.(\d+)\s*-->/g)) marks.add(+m[1]);
  const expected = Number.isInteger(pages) && pages > 0 ? pages : null;
  const pageChecked = marks.size > 0 && expected !== null;
  const missing = [];
  if (pageChecked) for (let i = 1; i <= expected; i++) if (!marks.has(i)) missing.push(i);
  return {
    md,
    pageMarks: marks.size,
    pagesExpected: expected,
    pageChecked,
    missing,
    tables: lines.filter((l) => TABLE_SEP.test(l) && l.includes('-')).length,
    headings: lines.filter((l) => /^#{1,6}\s/.test(l)).length,
    unreadable: (md.match(/\[読めない\]/g) || []).length,
  };
}

// PDF のページ数。ルートの /Type /Pages の中で最大の /Count。無ければ /Type /Page（/Pages を除く）の数。どちらも無ければ null
export function pdfPageCount(bytes) {
  // ASCII の部分だけ見ればよいので、latin1 で読む
  const s = new TextDecoder('latin1').decode(bytes);
  let max = 0;
  for (const m of s.matchAll(/\/Type\s*\/Pages\b([\s\S]{0,400}?)(?:>>|endobj)/g)) {
    const c = /\/Count\s+(\d+)/.exec(m[1]);
    if (c) max = Math.max(max, +c[1]);
  }
  if (!max) {
    for (const m of s.matchAll(/\/Count\s+(\d+)[\s\S]{0,400}?\/Type\s*\/Pages\b/g)) max = Math.max(max, +m[1]);
  }
  if (max) return max;
  const n = (s.match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
  return n || null;
}
