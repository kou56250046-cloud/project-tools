// 資料の変換: ファイルを Markdown にする（Excel・CSV・JSON・Word・PowerPoint・HTML・md・txt）。
// 表は NotebookLM 用の一式（表の下ごしらえ）も作れる。PDF・画像は Gemini に貼る変換の指示文と、返事の点検。
// 結果は台帳にもブラウザにも保存しない。この画面のモジュールの中だけに持ち、ロックで消す（画面を離れても残す）

import { convertFile, baseName, mdHeader } from '../../core/convert.js';
import { TABLEPREP } from '../../core/tableprep.js';
import { zipWrite } from '../../core/zip.js';
import { conversionPrompt, inspectMarkdown, pdfPageCount } from '../../core/gemini-convert.js';
import { h, toast, download, copyText, todayStr } from '../dom.js';

let convertState = { files: [], seq: 0 };
export function clearConvertState() { convertState = { files: [], seq: 0 }; }

const KIND_LABEL = { xlsx: 'Excel', csv: 'CSV', tsv: 'TSV', json: 'JSON', docx: 'Word', pptx: 'PowerPoint', html: 'HTML', text: '文字（そのまま）', pdf: 'PDF', image: '画像', reject: '読めない形式' };
const PREVIEW_LINES = 200;
const MD_TYPE = 'text/markdown;charset=utf-8';
const sizeText = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

async function addFiles(list, app) {
  const today = todayStr();
  const st = convertState;   // ロックで替わったら、残りのファイルを読まない（結果をロックの後に残さない）
  for (const f of list) {
    if (st !== convertState) return;
    const id = ++convertState.seq;
    const entry = { id, name: f.name, size: f.size, kind: '', ok: false, reason: '', md: null, counts: '', tables: null };
    convertState.files.push(entry);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const r = await convertFile(f.name, bytes, { today });
      if (st !== convertState) return;
      Object.assign(entry, r);
      if (r.kind === 'pdf') entry.pages = pdfPageCount(bytes);
      if (r.kind === 'image') entry.pages = 1;
      if (r.tables && r.tables.length) entry.bundle = { table: 0, groupCol: '', format: 'md', size: 500, merge: true, ext: 'json' };
    } catch (e) {
      Object.assign(entry, { ok: false, kind: 'reject', reason: 'ファイルを読めませんでした（' + String(e && e.message || e) + '）' });
    }
  }
  app.refresh();
}

// 表の下ごしらえの一式（zip）
function saveBundle(entry) {
  const src = entry.tables[entry.bundle.table];
  const t = TABLEPREP.fromRows(src.rows, { name: baseName(entry.name) + (src.label ? '_' + src.label : ''), source: entry.name, sheet: src.label || '' });
  const o = entry.bundle;
  const files = TABLEPREP.bundle(t, { groupCol: o.groupCol || null, format: o.format, ext: o.ext, size: Math.max(1, +o.size || 500), date: todayStr(), merge: o.merge });
  download(`${TABLEPREP.fileSafe(t.name)}_NotebookLM.zip`, zipWrite(files), 'application/zip');
  toast(`${files.length} 個のファイルを zip にしました`);
}

function bundleBox(entry, app) {
  const o = entry.bundle;
  const src = entry.tables[o.table];
  const cols = src.rows[0] || [];
  const sel = (key, options, label) => {
    const el = h('select', { 'aria-label': label, 'data-fk': `b-${entry.id}-${key}` }, options.map(([v, t]) => h('option', { value: v, selected: String(o[key]) === String(v), text: t })));
    el.addEventListener('change', () => { o[key] = key === 'table' ? +el.value : el.value; if (key === 'table') o.groupCol = ''; app.refresh(); });
    return h('label', { class: 'field' }, label, el);
  };
  const chk = (key, label) => {
    const el = h('input', { type: 'checkbox', checked: !!o[key], 'data-fk': `b-${entry.id}-${key}` });
    el.addEventListener('change', () => { o[key] = el.checked; });
    return h('label', { class: 'row small' }, el, label);
  };
  const size = h('input', { type: 'number', min: '1', step: '100', value: String(o.size), class: 'num-in', 'aria-label': '1 ファイルの行数', 'data-fk': `b-${entry.id}-size` });
  size.addEventListener('change', () => { o.size = Math.max(1, +size.value || 500); });
  return h('details', { class: 'cv-bundle' },
    h('summary', { text: 'NotebookLM 用の一式（表の下ごしらえ）' }),
    h('p', { class: 'small muted', text: '項目定義書・集計（全行から計算済み）・代表サンプル・行数で分けたデータを zip で保存します。NotebookLM は大きな表の集計を間違えやすいため、集計はここで計算して渡します。' }),
    h('div', { class: 'row settings-row' },
      entry.tables.length > 1 ? sel('table', entry.tables.map((t, i) => [i, t.label || `表 ${i + 1}`]), entry.kind === 'json' ? '配列のキー' : 'シート') : null,
      sel('groupCol', [['', '（集計の軸なし）'], ...cols.map((c) => [c, c])], 'まとめる列（集計の軸）'),
      sel('format', [['md', 'Markdown'], ['json', 'JSON'], ['csv', 'CSV']], 'データの形式'),
      h('label', { class: 'field' }, '1 ファイルの行数', size)),
    h('div', { class: 'row' }, chk('merge', '定義・集計・サンプルを 1 ファイルにまとめる'),
      h('label', { class: 'row small' }, (() => { const el = h('input', { type: 'checkbox', checked: o.ext === 'txt', 'data-fk': `b-${entry.id}-ext` }); el.addEventListener('change', () => { o.ext = el.checked ? 'txt' : 'json'; }); return el; })(), 'JSON の拡張子を .txt にする')),
    h('button', { class: 'btn', type: 'button', 'data-fk': `b-${entry.id}-save`, onclick: () => saveBundle(entry) }, '一式を zip で保存'));
}

function geminiBox(entry, app) {
  const pages = h('input', { type: 'number', min: '1', value: entry.pages ? String(entry.pages) : '', class: 'num-in', 'aria-label': 'ページ数', 'data-fk': `g-${entry.id}-pages` });
  // 空欄・0・数でない値は「ページ数なし」（空欄を 1 ページとして点検しない）
  pages.addEventListener('change', () => { const n = Math.floor(Number(pages.value)); entry.pages = pages.value.trim() !== '' && n >= 1 ? n : null; });
  const reply = h('textarea', { rows: '6', 'aria-label': 'Gemini の返事', placeholder: 'Gemini の返事（```markdown の囲みごと）を貼ります。何回かに分かれたときは、つなげて貼ってください。', 'data-fk': `g-${entry.id}-reply` });
  reply.value = entry.reply || '';
  reply.addEventListener('input', () => { entry.reply = reply.value; });
  const r = entry.inspect;
  return h('div', { class: 'stack' },
    h('p', { class: 'small', text: 'PDF・画像はブラウザの中では文字にできません。変換の指示文をコピーし、ファイルと一緒に Gemini に貼ってください。Gemini は先に 5 つを選択肢で聞いてきます。答えると、要約せずに書き写した Markdown を返します。' }),
    h('div', { class: 'row' },
      h('label', { class: 'field' }, entry.kind === 'pdf' ? 'ページ数（数えた値。違えば直す）' : 'ページ数', pages),
      h('button', { class: 'btn primary', type: 'button', 'data-fk': `g-${entry.id}-copy`, onclick: async () => {
        const ok = await copyText(conversionPrompt({ fileName: entry.name, kind: entry.kind, pages: entry.pages }));
        toast(ok ? '変換の指示文をコピーしました' : 'コピーできませんでした');
      } }, '変換の指示文をコピー')),
    h('label', { class: 'field' }, '返事を貼る', reply),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', 'data-fk': `g-${entry.id}-check`, onclick: () => {
      if (!reply.value.trim()) { toast('返事を貼ってください'); return; }
      entry.inspect = inspectMarkdown(reply.value, { pages: entry.pages });
      const x = entry.inspect;
      entry.md = mdHeader(entry.name, todayStr(), 'Gemini（このツールで点検）', `ページ ${entry.pages || '?'}・見出し ${x.headings}・表 ${x.tables}`) + x.md;
      app.refresh();
    } }, '点検する')),
    r ? h('ul', { class: ['small', 'cv-inspect', r.pageChecked && r.missing.length ? 'notice warn' : 'notice'] },
      h('li', { text: !r.pageMarks ? 'ページの区切りの印がありません（印を入れない答えにした場合は点検しません）'
        : r.pageChecked ? (r.missing.length ? `抜けているページ: ${r.missing.join('・')}（印 ${r.pageMarks} 個 / ${r.pagesExpected} ページ）` : `全 ${r.pagesExpected} ページの印がそろっています`)
          : `ページの区切りの印 ${r.pageMarks} 個（ページ数を入れると抜けを点検します）` }),
      h('li', { text: `見出し ${r.headings}・表 ${r.tables}・[読めない] ${r.unreadable}` })) : null);
}

function fileCard(entry, app) {
  const actions = [];
  if (entry.md) {
    actions.push(
      h('button', { class: 'btn small', type: 'button', 'data-fk': `c-${entry.id}-save`, onclick: () => download(baseName(entry.name) + '.md', entry.md, MD_TYPE) }, 'md を保存'),
      h('button', { class: 'btn small', type: 'button', 'data-fk': `c-${entry.id}-copy`, onclick: async () => toast((await copyText(entry.md)) ? 'コピーしました' : 'コピーできませんでした') }, 'コピー'));
  }
  actions.push(h('button', { class: 'btn small', type: 'button', 'data-fk': `c-${entry.id}-remove`, onclick: () => { convertState.files = convertState.files.filter((x) => x !== entry); app.refresh(); } }, '一覧から外す'));
  const lines = entry.md ? entry.md.split('\n') : [];
  return h('section', { class: ['card', 'stack', 'cv-card', !entry.ok && 'cv-ng'], 'data-file': entry.id },
    h('div', { class: 'row' },
      h('strong', { class: 'cv-name', text: entry.name }),
      h('span', { class: ['badge', entry.ok ? 'accent' : 'high'], text: KIND_LABEL[entry.kind] || entry.kind }),
      h('span', { class: 'small muted', text: `${sizeText(entry.size)}${entry.counts ? '・' + entry.counts : ''}${entry.md ? `・${entry.md.length.toLocaleString()} 字` : ''}` }),
      h('span', { class: 'spacer' }), actions),
    !entry.ok ? h('p', { class: 'notice error small', role: 'alert', text: entry.reason }) : null,
    entry.kind === 'pdf' || entry.kind === 'image' ? geminiBox(entry, app) : null,
    entry.md ? h('details', { class: 'cv-preview', open: convertState.files.length === 1 },
      h('summary', { text: `md の先頭（${Math.min(PREVIEW_LINES, lines.length)} / ${lines.length} 行）` }),
      h('pre', { class: 'cv-pre', text: lines.slice(0, PREVIEW_LINES).join('\n') })) : null,
    entry.bundle ? bundleBox(entry, app) : null);
}

function saveAll() {
  const used = new Map();
  const files = [];
  for (const e of convertState.files) {
    if (!e.md) continue;
    let name = baseName(e.name) + '.md';
    if (used.has(name)) { const k = used.get(name) + 1; used.set(name, k); name = `${baseName(e.name)} (${k}).md`; } else used.set(name, 1);
    files.push({ name, data: e.md });
  }
  if (!files.length) { toast('保存できる md がありません'); return; }
  download(`資料の変換_${todayStr().replace(/-/g, '')}.zip`, zipWrite(files), 'application/zip');
  toast(`${files.length} 個の md を zip にしました`);
}

export function renderConvert(root, app) {
  root.appendChild(h('h2', { text: '資料の変換' }));
  root.appendChild(h('p', { class: 'muted small', text: 'NotebookLM や Gemini に渡しやすいよう、資料を Markdown にします。Excel・CSV・JSON・Word・PowerPoint・HTML はこのブラウザの中で変換し、PDF・画像は Gemini に任せます。結果は保存しません（ロックすると消えます）。社外へ持ち出さないでください。' }));
  const input = h('input', { type: 'file', multiple: true, id: 'cv-file', 'aria-label': '変換するファイルを選ぶ' });
  input.addEventListener('change', () => { addFiles([...input.files], app); input.value = ''; });
  const zone = h('section', { class: 'card stack dropzone', id: 'cv-drop' },
    h('p', { class: 'small', text: 'ファイルを選ぶか、この枠にドラッグ&ドロップします（複数可・1 ファイル 30MB まで）。.xls・.doc・.ppt（古い形式）と暗号化されたファイルは読めません。' }),
    input);
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); addFiles([...e.dataTransfer.files], app); });
  root.appendChild(zone);
  const fs = convertState.files;
  if (!fs.length) return;
  root.appendChild(h('div', { class: 'row cv-bar' },
    h('span', { class: 'small muted', text: `${fs.length} 件（md にできたもの ${fs.filter((x) => x.md).length} 件）` }),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn primary', type: 'button', id: 'cv-save-all', onclick: saveAll }, '全部を zip で保存'),
    h('button', { class: 'btn', type: 'button', id: 'cv-clear', onclick: () => { clearConvertState(); app.refresh(); } }, '一覧を空にする')));
  for (const e of fs) root.appendChild(fileCard(e, app));
}
