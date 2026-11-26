// PDF・画像の変換は Gemini に任せる。その指示文と、返ってきた Markdown の点検。DOM に触れない。
// 指示文は、まず選択肢つきで確かめさせてから、要約せずに一字一句書き写させる（ユーザーの案）

// 先に確かめる 5 つ（番号で答えられる形）
export const GEMINI_CONVERT_QUESTIONS = [
  { q: '表の扱い', choices: ['Markdown の表にする', '箇条書きにする'] },
  { q: '図・写真の扱い', choices: ['内容の説明を [図: …] で書く', '[図] の印だけ残す'] },
  { q: '見出しの付け方', choices: ['文字の大きさから見出しの段（#・##・###）を推定する', '見出しを付けない'] },
  { q: 'ページの区切り', choices: ['各ページの先頭に <!-- p.N --> を入れる（N はページ番号）', '入れない'] },
  { q: '読めない文字', choices: ['[読めない] と書く', '前後から推定して [推定: …] と書く'] },
];

// kind: 'pdf' | 'image'、pages: ページ数（分からなければ null）
export function conversionPrompt({ fileName, kind, pages }) {
  const what = kind === 'pdf' ? `PDF「${fileName}」${pages ? `（全 ${pages} ページ）` : ''}` : `画像「${fileName}」`;
  const qs = GEMINI_CONVERT_QUESTIONS.map((x, i) => `${i + 1}. ${x.q}\n${x.choices.map((c, j) => `   ${String.fromCharCode(97 + j)}) ${c}`).join('\n')}`).join('\n');
  return [
    `あなたは、資料を一字一句そのまま Markdown に書き写す係です。添付した${what}を書き写してください。`,
    '',
    '## 守ること',
    '- 要約・言い換え・補足・意見を書かない。資料にある文字だけを、出てくる順に書く',
    '- 数字・固有名詞・記号・表の値を変えない。単位も省かない',
    '- 途中で止まったら、「続き」と言われてから、止まったところの次から続ける（前の部分を繰り返さない）',
    '',
    '## 最初の返事でやること',
    'まだ書き写さないでください。次の 5 つを、番号と記号（例「1a 2b 3a 4a 5a」）で答えられるように、そのまま私に聞いてください。',
    '',
    qs,
    '',
    '## 答えを受けた後',
    '- 答えに合わせて、全ページを順に書き写す',
    '- 出力は ```markdown の囲みの中に本文だけを書く。囲みの外に説明を書かない',
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
