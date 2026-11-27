// 資料の変換: ファイルを Markdown にする（Excel・CSV・JSON・Word・PowerPoint・HTML・md・txt）。
// 表は NotebookLM 用の一式（表の下ごしらえ）も作れる。PDF・画像は Gemini に貼る変換の指示文と、返事の点検。
// 結果は台帳にもブラウザにも保存しない。この画面のモジュールの中だけに持ち、ロックで消す（画面を離れても残す）

import { convertFile, baseName, mdHeader } from '../../core/convert.js';
import { TABLEPREP } from '../../core/tableprep.js';
import { zipWrite } from '../../core/zip.js';
import { conversionPrompt, flowImagePrompt, inspectMarkdown, pdfPageCount } from '../../core/gemini-convert.js';
import { mdToHtml, finishHtml } from '../../core/mdhtml.js';
import { fidelityCheck } from '../../core/fidelity.js';
import { FLOWCHART } from '../../core/flow.js';
import { KINDS } from '../../core/schema.js';
import { flowSvgString, flowCssText } from '../flowsvg.js';
import { h, toast, download, copyText, todayStr } from '../dom.js';
import { store } from '../store.js';

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
      entry.localMd = r.md || null;   // ツールで変換した md（Gemini の返事の忠実さの点検に使う）
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

// Gemini で変換するときの目的（種類ごと）。md: Markdown にする、html: HTML にする（Gemini が直接書く）、flow: 画像のフローをフロー記法にする（P6d）
const G_TARGETS = { pdf: ['md', 'html'], image: ['md', 'flow'], pptx: ['md', 'html'], html: ['md'], xlsx: ['html'] };
const G_TARGET_LABEL = { md: 'Markdown にする', html: 'HTML にする（Gemini が書く）', flow: '画像のフロー図をフロー記法にする' };
const G_NOTE = {
  pdf: 'PDF はブラウザの中では文字にできません。指示文をコピーし、ファイルと一緒に Gemini に貼ってください。',
  image: '画像はブラウザの中では文字にできません。指示文をコピーし、画像と一緒に Gemini に貼ってください。',
  pptx: 'このブラウザでも変換しましたが、画像の中の文字や図の説明が要るときは Gemini に任せます。返事は、ツールの変換結果と照合して抜けを出します。',
  html: 'このブラウザでも変換しましたが、画像の多い HTML は Gemini に任せます。返事は、ツールの変換結果と照合して抜けを出します。',
  xlsx: '人が読む HTML を Gemini に書かせます（表の値はツールの変換結果と照合します）。ツールで組む HTML は、上の「HTML を保存」で作れます。',
};
const flowBlocks = (md) => [...String(md || '').matchAll(/```flow\n([\s\S]*?)\n```/g)].map((m) => m[1]);

function geminiBox(entry, app) {
  const targets = G_TARGETS[entry.kind] || [];
  if (!targets.length) return null;
  if (!targets.includes(entry.gTarget)) entry.gTarget = targets[0];
  const target = entry.gTarget;
  const pages = h('input', { type: 'number', min: '1', value: entry.pages ? String(entry.pages) : '', class: 'num-in', 'aria-label': 'ページ数', 'data-fk': `g-${entry.id}-pages` });
  // 空欄・0・数でない値は「ページ数なし」（空欄を 1 ページとして点検しない）
  pages.addEventListener('change', () => { const n = Math.floor(Number(pages.value)); entry.pages = pages.value.trim() !== '' && n >= 1 ? n : null; });
  const tsel = h('select', { 'aria-label': 'Gemini で何にするか', 'data-fk': `g-${entry.id}-target` }, targets.map((t) => h('option', { value: t, selected: t === target, text: G_TARGET_LABEL[t] })));
  tsel.addEventListener('change', () => { entry.gTarget = tsel.value; entry.inspect = null; entry.fidelity = null; entry.ghtml = null; app.refresh(); });
  const reply = h('textarea', { rows: '6', 'aria-label': 'Gemini の返事', placeholder: target === 'html' ? 'Gemini の返事（```html の囲みごと）を貼ります。' : 'Gemini の返事（囲みごと）を貼ります。何回かに分かれたときは、つなげて貼ってください。', 'data-fk': `g-${entry.id}-reply` });
  reply.value = entry.reply || '';
  reply.addEventListener('input', () => { entry.reply = reply.value; });
  const unit = entry.kind === 'pptx' ? 'スライド数' : 'ページ数';
  const promptText = () => (target === 'flow' ? flowImagePrompt({ fileName: entry.name }) : conversionPrompt({ fileName: entry.name, kind: entry.kind, pages: entry.pages, target }));
  const check = () => {
    if (!reply.value.trim()) { toast('返事を貼ってください'); return; }
    entry.fidelity = entry.localMd ? fidelityCheck(entry.localMd, reply.value) : null;
    if (target === 'html') {
      entry.ghtml = finishHtml(reply.value, { flowSvg: flowSvgString, css: flowCssText() });
      entry.inspect = null;
    } else if (target === 'flow') {
      const m = /```flow\s*\n([\s\S]*?)\n\s*```/.exec(reply.value);
      const notation = (m ? m[1] : reply.value.replace(/^\s*```\w*\s*$/gm, '')).trim();
      const errs = FLOWCHART.parse(notation).errors;
      entry.inspect = { flowErrors: errs };
      entry.md = mdHeader(entry.name, todayStr(), 'Gemini（このツールで点検）', `フロー記法・誤り ${errs.length}`) + '```flow\n' + notation + '\n```\n';
    } else {
      entry.inspect = inspectMarkdown(reply.value, { pages: entry.pages });
      const x = entry.inspect;
      entry.md = mdHeader(entry.name, todayStr(), 'Gemini（このツールで点検）', `ページ ${entry.pages || '?'}・見出し ${x.headings}・表 ${x.tables}`) + x.md;
    }
    app.refresh();
  };
  const r = entry.inspect;
  const fi = entry.fidelity;
  const gh = entry.ghtml;
  return h('details', { class: 'cv-gemini stack', open: entry.kind === 'pdf' || entry.kind === 'image' },
    h('summary', { text: 'Gemini で変換する（選択肢で確かめてから書き写させる）' }),
    h('p', { class: 'small', text: `${G_NOTE[entry.kind] || ''} Gemini は先に、表・図・フロー図の扱いなどを選択肢で聞いてきます。番号で答えると書き写します。` }),
    h('div', { class: 'row settings-row' },
      h('label', { class: 'field' }, '何にするか', tsel),
      target !== 'flow' && entry.kind !== 'html' ? h('label', { class: 'field' }, entry.kind === 'pdf' ? `${unit}（数えた値。違えば直す）` : unit, pages) : null,
      h('button', { class: 'btn primary', type: 'button', 'data-fk': `g-${entry.id}-copy`, onclick: async () => {
        const ok = await copyText(promptText());
        toast(ok ? '変換の指示文をコピーしました' : 'コピーできませんでした');
      } }, '変換の指示文をコピー')),
    h('label', { class: 'field' }, '返事を貼る', reply),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', 'data-fk': `g-${entry.id}-check`, onclick: check }, '点検する'),
      entry.localMd && entry.md !== entry.localMd && target === 'md' ? h('button', { class: 'btn small', type: 'button', onclick: () => { entry.md = entry.localMd; entry.inspect = null; app.refresh(); } }, 'md をツールの変換結果に戻す') : null),
    r && r.flowErrors ? h('p', { class: ['small', r.flowErrors.length ? 'notice warn' : 'notice'], text: r.flowErrors.length ? `フロー記法の誤り ${r.flowErrors.length} 件（${r.flowErrors.slice(0, 3).map((e) => `${e.line} 行目: ${e.message}`).join(' ／ ')}）。誤りの行は図に出ません` : 'フロー記法に誤りはありません' }) : null,
    r && !r.flowErrors ? h('ul', { class: ['small', 'cv-inspect', r.pageChecked && r.missing.length ? 'notice warn' : 'notice'] },
      h('li', { text: !r.pageMarks ? '区切りの印がありません（印を入れない答えにした場合は点検しません）'
        : r.pageChecked ? (r.missing.length ? `抜けている${unit === 'スライド数' ? 'スライド' : 'ページ'}: ${r.missing.join('・')}（印 ${r.pageMarks} 個 / ${r.pagesExpected}）` : `全 ${r.pagesExpected} ${unit === 'スライド数' ? 'スライド' : 'ページ'}の印がそろっています`)
          : `区切りの印 ${r.pageMarks} 個（${unit}を入れると抜けを点検します）` }),
      h('li', { text: `見出し ${r.headings}・表 ${r.tables}・[読めない] ${r.unreadable}・フロー図 ${flowBlocks(entry.md).length}` })) : null,
    gh ? h('div', { class: 'notice small stack' },
      h('p', { text: `HTML を仕上げました: フロー図 ${gh.flows} 枚を図にしました。外したもの: script ${gh.removed.scripts}・イベント属性 ${gh.removed.handlers}・外部への URL ${gh.removed.urls}・そのほか ${gh.removed.others}` }),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', 'data-fk': `g-${entry.id}-html`, onclick: () => download(baseName(entry.name) + '.html', gh.html, 'text/html;charset=utf-8') }, '仕上げた HTML を保存'))) : null,
    fi ? h('div', { class: ['small', fi.missingCount ? 'notice warn' : 'notice'] },
      h('p', { text: fi.missingCount ? `ツールの変換結果にあって、返事に無い語が ${fi.missingCount} 個あります（元の語 ${fi.total} 個のうち ${Math.round(fi.rate * 100)}% が返事にあります）。抜け・書き換えがないか確かめてください` : `ツールの変換結果の語（${fi.total} 個）は、すべて返事にあります` }),
      fi.missing.length ? h('p', { class: 'cv-missing', text: fi.missing.slice(0, 40).join('、') + (fi.missingCount > 40 ? ` ほか ${fi.missingCount - 40} 個` : '') }) : null) : null);
}

// md の中のフロー図ごとに「業務フローとして台帳に足す」（案件を開いているときだけ）
function flowToLedgerBox(entry, app) {
  const blocks = flowBlocks(entry.md);
  if (!blocks.length || !store.ledger || store.presentation) return null;
  const phases = KINDS.bizflow.fields.phase.values;
  entry.flowPhase = entry.flowPhase || 'asis';
  const psel = h('select', { 'aria-label': '現行・導入後', 'data-fk': `f-${entry.id}-phase` }, phases.map((p) => h('option', { value: p.v, selected: p.v === entry.flowPhase, text: p.label })));
  psel.addEventListener('change', () => { entry.flowPhase = psel.value; });
  return h('div', { class: 'row cv-flows' }, h('span', { class: 'small', text: `フロー図 ${blocks.length} 枚を業務フローとして台帳に足す:` }), h('label', { class: 'row small' }, '区分', psel),
    blocks.map((notation, i) => {
      const t = /^title\s+(.+)$/m.exec(notation);
      const title = t ? t[1].trim() : `${baseName(entry.name)} の流れ ${i + 1}`;
      return h('button', { class: 'btn small', type: 'button', 'data-fk': `f-${entry.id}-${i}`, onclick: () => {
        const r = store.applyLocal([{ op: 'add', tempId: 'new:cvflow', item: { kind: 'bizflow', title, phase: entry.flowPhase, notation, status: 'draft', sources: [{ type: 'other', ref: entry.name }] } }]);
        if (!r.ok) { toast(r.errors.join(' / ')); return; }
        const id = r.idMap.get('new:cvflow');
        toast(`業務フロー ${id}「${title}」を足しました（取り消し可）`);
      } }, `「${title}」を足す`);
    }));
}

function fileCard(entry, app) {
  const actions = [];
  if (entry.md) {
    actions.push(
      h('button', { class: 'btn small', type: 'button', 'data-fk': `c-${entry.id}-save`, onclick: () => download(baseName(entry.name) + '.md', entry.md, MD_TYPE) }, 'md を保存'),
      // ツールで組む HTML（人が読む資料。フロー図は図にする）
      h('button', { class: 'btn small', type: 'button', 'data-fk': `c-${entry.id}-html`, onclick: () => {
        const r = mdToHtml(entry.md, { title: baseName(entry.name), flowSvg: flowSvgString, css: flowCssText() });
        download(baseName(entry.name) + '.html', r.html, 'text/html;charset=utf-8');
        toast(`HTML を保存しました（章 ${r.sections}・フロー図 ${r.flows}）`);
      } }, 'HTML を保存'),
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
    geminiBox(entry, app),
    entry.md ? flowToLedgerBox(entry, app) : null,
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
  root.appendChild(h('p', { class: 'muted small', text: 'NotebookLM や Gemini に渡しやすいよう、資料を Markdown にします。Excel・CSV・JSON・Word・PowerPoint・HTML はこのブラウザの中で変換し、PDF・画像は Gemini に任せます。PowerPoint・Excel の図形と矢印のフロー図は、フロー記法（```flow）に起こします。「HTML を保存」で人が読む 1 枚の HTML（フロー図は図）にもできます。結果は保存しません（ロックすると消えます）。社外へ持ち出さないでください。' }));
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
