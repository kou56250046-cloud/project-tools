// マスキング: 表（CSV・TSV・Excel・貼り付け）の個人や会社の情報を、列ごとの規則で伏せる（gemini-kit のマスキングと同じ規則）。
// 対応表（元の値と伏せた値）は保存しない。この画面のモジュールの中だけに持ち、ロックか「対応表を空にする」で消す

import { MASK } from '../../core/mask.js';
import { XLSX } from '../../core/xlsx.js';
import { decodeText, baseName, detectKind } from '../../core/convert.js';
import { h, toast, download, copyText, todayStr } from '../dom.js';

let maskState = { name: '', rows: null, rules: null, header: true, inText: true, result: null, state: MASK.newState(), sheets: null, sheet: 0, paste: '' };
export function clearMaskState() {
  maskState = { name: '', rows: null, rules: null, header: true, inText: true, result: null, state: MASK.newState(), sheets: null, sheet: 0, paste: '' };
}

const maskYmd = () => todayStr().replace(/-/g, '');
const srcName = () => (maskState.name ? baseName(maskState.name) : '貼り付け');

function loadRows(rows, name) {
  if (!rows || !rows.length || !rows[0].length) { toast('表が空です'); return; }
  maskState.rows = rows;
  maskState.name = name;
  maskState.result = null;
  inferRules();
}
function inferRules() {
  const rows = maskState.rows;
  const body = maskState.header ? rows.slice(1) : rows;
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  maskState.rules = Array.from({ length: width }, (_, c) => MASK.infer(maskState.header ? rows[0][c] || '' : '', body.map((r) => r[c] || '')));
}

async function loadMaskFile(f, app) {
  const st = maskState;   // ロックで替わったら、読んだ表を捨てる
  const bytes = new Uint8Array(await f.arrayBuffer());
  const kind = (await detectKind(f.name, bytes)).kind;
  if (st !== maskState) return;
  try {
    if (kind === 'xlsx') {
      const sheets = (await XLSX.sheets(bytes)).filter((s) => s.rows.length);
      if (st !== maskState) return;
      maskState.sheets = sheets;
      maskState.sheet = 0;
      if (!maskState.sheets.length) { toast('シートが空です'); return; }
      loadRows(maskState.sheets[0].rows, f.name);
    } else if (kind === 'csv' || kind === 'tsv' || kind === 'text') {
      maskState.sheets = null;
      loadRows(MASK.parseTable(decodeText(bytes).text), f.name);
    } else { toast('表のファイル（CSV・TSV・Excel）を選んでください'); return; }
  } catch (e) { toast(String(e && e.message || e)); return; }
  app.refresh();
}

export function renderMask(root, app) {
  root.appendChild(h('h2', { text: 'マスキング' }));
  root.appendChild(h('p', { class: 'muted small', text: '表の顧客名・担当者・メール・電話・住所・金額・日付などを、列ごとの規則で伏せてから NotebookLM や Gemini に渡します。同じ値には同じ仮名を付けます。対応表は保存しません（画面を開いている間だけ。ロックすると消えます）。' }));
  const file = h('input', { type: 'file', accept: '.csv,.tsv,.txt,.xlsx,.xlsm', id: 'mk-file', 'aria-label': '表のファイルを選ぶ' });
  file.addEventListener('change', () => { if (file.files[0]) loadMaskFile(file.files[0], app); file.value = ''; });
  const ta = h('textarea', { rows: '5', id: 'mk-src', 'aria-label': '表の貼り付け', placeholder: 'Excel からコピーした表（タブ区切り）か CSV を貼ります' });
  ta.value = maskState.paste;
  ta.addEventListener('input', () => { maskState.paste = ta.value; });
  const chk = (key, label, id, after) => {
    const el = h('input', { type: 'checkbox', id, checked: maskState[key] });
    el.addEventListener('change', () => { maskState[key] = el.checked; if (after) after(); });
    return h('label', { class: 'row small' }, el, label);
  };
  root.appendChild(h('section', { class: 'card stack' },
    h('div', { class: 'row' }, h('span', { class: 'small', text: 'ファイル（CSV・TSV・Excel）' }), file),
    ta,
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', type: 'button', id: 'mk-load', onclick: () => { if (!maskState.paste.trim()) { toast('表を貼り付けてください'); return; } maskState.sheets = null; loadRows(MASK.parseTable(maskState.paste), ''); app.refresh(); } }, '貼り付けた表を読む'),
      chk('header', '1 行目は見出し', 'mk-header', () => { if (maskState.rows) { inferRules(); app.refresh(); } }),
      chk('inText', '「そのまま」の列の文中も置き換える', 'mk-text'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn', type: 'button', id: 'mk-reset', onclick: () => { maskState.state = MASK.newState(); maskState.result = null; toast('対応表を空にしました。次から仮名を振り直します'); app.refresh(); } }, '対応表を空にする'))));
  if (!maskState.rows) return;

  // 列ごとの規則
  const rows = maskState.rows;
  const body = maskState.header ? rows.slice(1) : rows;
  const sheetSel = maskState.sheets && maskState.sheets.length > 1 ? (() => {
    const el = h('select', { 'aria-label': 'シート', id: 'mk-sheet' }, maskState.sheets.map((s, i) => h('option', { value: String(i), selected: i === maskState.sheet, text: s.name })));
    el.addEventListener('change', () => { maskState.sheet = +el.value; loadRows(maskState.sheets[maskState.sheet].rows, maskState.name); app.refresh(); });
    return h('label', { class: 'field' }, 'シート', el);
  })() : null;
  root.appendChild(h('section', { class: 'card stack', id: 'mk-rules' },
    h('div', { class: 'row' }, h('h3', { text: `列ごとの伏せ方（${srcName()}・${body.length} 行）` }), sheetSel),
    h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
      h('thead', null, h('tr', null, ['列', '値の例（先頭 3 件）', '伏せ方', '仮名の頭'].map((t) => h('th', { scope: 'col', text: t })))),
      h('tbody', null, maskState.rules.map((rule, c) => {
        const sel = h('select', { 'aria-label': `列 ${c + 1} の伏せ方`, 'data-fk': `mk-rule-${c}` }, Object.entries(MASK.RULES).map(([k, v]) => h('option', { value: k, selected: k === rule.rule, text: v })));
        sel.addEventListener('change', () => { rule.rule = sel.value; app.refresh(); });
        const pre = rule.rule === 'pseudo' ? (() => { const el = h('input', { type: 'text', value: rule.prefix || '', 'aria-label': `列 ${c + 1} の仮名の頭`, class: 'mk-prefix', 'data-fk': `mk-pre-${c}` }); el.addEventListener('input', () => { rule.prefix = el.value; }); return el; })() : h('span', { class: 'muted', text: '－' });
        const ex = [...new Set(body.map((r) => r[c]).filter((v) => String(v || '').trim()))].slice(0, 3).join(' ／ ');
        return h('tr', { class: 'nocursor' }, h('td', { text: maskState.header ? rows[0][c] || `列${c + 1}` : `列${c + 1}` }), h('td', { class: 'wrap small', text: ex }), h('td', null, sel), h('td', null, pre));
      })))),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', id: 'mk-run', onclick: () => {
      maskState.result = MASK.apply(maskState.rows, maskState.rules, maskState.state, { header: maskState.header, replaceInText: maskState.inText });
      app.refresh();
    } }, '伏せる'))));

  const res = maskState.result;
  if (!res) return;
  const out = res.rows;
  root.appendChild(h('section', { class: 'card stack', id: 'mk-out' },
    h('div', { class: 'row' },
      h('h3', { text: '伏せた表' }),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn', type: 'button', id: 'mk-copy', onclick: async () => toast((await copyText(MASK.toTSV(out))) ? 'コピーしました（Excel に貼れる形）' : 'コピーできませんでした') }, 'コピー'),
      h('button', { class: 'btn', type: 'button', id: 'mk-tsv', onclick: () => download(`${srcName()}_masked_${maskYmd()}.tsv`, MASK.toTSV(out) + '\n', 'text/tab-separated-values;charset=utf-8') }, 'TSV を保存'),
      h('button', { class: 'btn', type: 'button', id: 'mk-csv', onclick: () => download(`${srcName()}_masked_${maskYmd()}.csv`, MASK.toCSV(out), 'text/csv;charset=utf-8') }, 'CSV を保存'),
      h('button', { class: 'btn', type: 'button', id: 'mk-map', onclick: () => download(`対応表_社外秘_${srcName()}_${maskYmd()}.csv`, MASK.mappingCSV(res.mapping), 'text/csv;charset=utf-8') }, `対応表を保存（${res.mapping.length} 件）`)),
    h('ul', { class: ['small', res.warnings.length ? 'notice warn' : 'notice'], id: 'mk-warnings' },
      res.warnings.length
        ? res.warnings.slice(0, 30).map((w) => h('li', { text: `${w.row} 行目・${w.col} 列目: ${w.message}が残っている可能性があります` }))
        : h('li', { text: '「そのまま」にした列に、会社名・メール・電話番号らしき文字は見つかりませんでした' })),
    h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
      h('tbody', null, out.slice(0, 51).map((r, i) => h('tr', { class: 'nocursor' }, r.map((v) => h(i === 0 && maskState.header ? 'th' : 'td', { text: v }))))))),
    out.length > 51 ? h('p', { class: 'small muted', text: `先頭 50 行だけを表示しています（全 ${out.length - (maskState.header ? 1 : 0)} 行）` }) : null));
}
