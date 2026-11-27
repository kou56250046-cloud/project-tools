// 判断・データ（道具）: フロー記法・判断マスタ・テーブル定義・ケースを貼り、台帳と突き合わせる（core/judge.js）
// gemini-kit の judgeui.js の構成に合わせて書き直した。テーブル構築（Office Scripts）の表示は写さない
// 入力は画面のモジュールの中だけに持つ（台帳に保存しない）。ロックと案件の切り替えで消す

import { JUDGE } from '../../core/judge.js';
import { JUDGE_SAMPLE } from '../../core/judge-sample.js';
import { TABLEDEF, toEntityPatch } from '../../core/table-def.js';
import { flowGeometry } from '../../core/flowsafe.js';
import { renderFlowSvg, flowFrame } from '../flowsvg.js';
import { h, toast, download, confirmDialog, todayStr } from '../dom.js';
import { store } from '../store.js';
import { sendPatchToImport } from './to-import.js';

const JD_INPUTS = [
  { key: 'flow', label: 'フロー', prompt: 'judge-flow', ph: 'フロー記法（```flow の囲みのままでも可）。分岐に [JDG-001]、データに [TBL-001] を付ける' },
  { key: 'master', label: '判断マスタ', prompt: 'judge-master', ph: '## JDG-001 題名 ＋ 区分・見る項目・判定表' },
  { key: 'tables', label: 'テーブル定義', prompt: 'table-def', ph: '## TBL-001 テーブル名 ＋ 物理名・区分 ＋ 列の表' },
  { key: 'cases', label: 'ケース', prompt: 'judge-cases', ph: '| ケース | 説明 | テーブル名.列名 | … | JDG-001 |（デモで流す入力の表）' },
];
const JD_VIEWS = [['map', '図と確認事項'], ['check', '点検'], ['demo', 'デモ']];
const freshJudge = () => ({ src: { flow: '', master: '', tables: '', cases: '' }, input: 'flow', view: 'map', sel: null, demo: null, caseKey: '0', sig: '', token: null });
let judgeState = freshJudge();
export function clearJudgeState() { judgeState = freshJudge(); }

const jdStamp = () => todayStr().replace(/-/g, '');
const jdTable = (head, rows, cls) => h('div', { class: 'table-wrap' }, h('table', { class: ['list', cls] },
  h('thead', null, h('tr', null, head.map((t) => h('th', { scope: 'col', text: t })))),
  h('tbody', null, rows)));

// 取込の画面へ差分を渡す（下書きがあれば置き換えの確認。to-import.js）
const toImport = (app, patch) => sendPatchToImport(app, patch);

function inputPane(app) {
  const s = judgeState.src;
  const cur = JD_INPUTS.find((x) => x.key === judgeState.input);
  const tabs = h('div', { class: 'jd-tabs', role: 'group', 'aria-label': '入力' }, JD_INPUTS.map((x) => h('button', {
    type: 'button', class: 'jd-tab', 'aria-pressed': String(x.key === cur.key), id: `jd-in-${x.key}`,
    onclick: () => { judgeState.input = x.key; app.refresh(); },
  }, x.label, s[x.key].trim() ? h('span', { class: 'badge ok', text: '入力済み' }) : null)));
  const ta = h('textarea', { class: 'mono jd-src', rows: '18', id: `jd-src-${cur.key}`, 'aria-label': cur.label, placeholder: cur.ph, spellcheck: 'false' });
  ta.value = s[cur.key];
  ta.addEventListener('change', () => { s[cur.key] = ta.value; app.refresh(); });
  const file = h('input', { type: 'file', accept: '.md,.txt,text/markdown,text/plain', hidden: true, id: 'jd-file' });
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    if (!f) return;
    const parts = JUDGE.detect(await f.text());
    const keys = Object.keys(parts);
    if (!keys.length) { toast('フロー・判断マスタ・テーブル定義・ケースのどれも見つかりませんでした'); return; }
    Object.assign(s, parts);
    judgeState.input = keys[0];
    toast(`${keys.map((k) => JUDGE.PARTS[k]).join('・')}を読みました`);
    app.refresh();
  });
  return h('div', { class: 'stack' },
    tabs, ta,
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', id: 'jd-sample', onclick: async () => {
        if (JD_INPUTS.some((x) => s[x.key].trim()) && !(await confirmDialog('入力をサンプル（経費申請のダミー）に置き換えます。', '置き換える'))) return;
        Object.assign(s, JUDGE_SAMPLE); judgeState.sel = null; app.refresh();
      } }, 'サンプルを試す'),
      h('button', { class: 'btn', type: 'button', onclick: () => file.click() }, 'ファイルを開く'), file,
      h('button', { class: 'btn', type: 'button', id: 'jd-save', disabled: !JD_INPUTS.some((x) => s[x.key].trim()), onclick: () => download(`判断データ_${jdStamp()}.md`, JUDGE.bundle(s), 'text/markdown;charset=utf-8') }, 'まとめて保存'),
      h('button', { class: 'btn', type: 'button', onclick: () => app.go('prompts', { purpose: cur.prompt }) }, `指示文「${cur.label === 'フロー' ? '判断フロー図' : cur.label === 'ケース' ? '判断のデモのケース' : cur.label}」を開く`),
      h('button', { class: 'btn', type: 'button', onclick: async () => {
        if (!(await confirmDialog('4 つの入力をすべて消します。', '消す', '台帳には保存していないので戻せません。残すときは先に「まとめて保存」してください。'))) return;
        clearJudgeState(); app.refresh();
      } }, 'すべて消す')));
}

function figure(an, overlay) {
  const r = flowGeometry(JUDGE.flowText(judgeState.src.flow));
  if (!r.geo) return h('div', { class: 'empty small', text: judgeState.src.flow.trim() ? '描けるフローがありません。記法を確かめてください' : 'フローを貼ると、ここに図が出ます' });
  return h('div', { class: 'stack' },
    r.errors.length ? h('p', { class: 'notice warn small', text: `フロー記法に誤りが ${r.errors.length} 件あります。誤りの行を外して描いています（「点検」に行番号）。印は誤りを直すまで付きません` }) : null,
    flowFrame(renderFlowSvg(r.geo, overlay), 'jd-figure'));
}

function legend() {
  return h('p', { class: 'small muted' }, '印: ', h('span', { class: 'badge ok', text: '✓ 確定' }), ' ', h('span', { class: 'badge mid', text: '? 未確定' }), ' ', h('span', { class: 'badge high', text: '! マスタなし' }), '　箱を押すと、未確定の理由が出ます');
}

function mapView(app, an) {
  const sel = judgeState.sel;
  const box = h('div', { class: 'stack' });
  box.appendChild(legend());
  box.appendChild(figure(an, { marks: an.marks, focus: sel, titles: Object.fromEntries(Object.entries(an.nodes).map(([id, x]) => [id, x.label])), onSelect: (id) => { judgeState.sel = judgeState.sel === id ? null : id; app.refresh(); } }));
  if (sel && an.nodes[sel]) {
    const x = an.nodes[sel];
    const info = x.jdg && an.judgeInfo[x.jdg];
    box.appendChild(h('section', { class: 'card stack', id: 'jd-detail' },
      h('h3', { text: `${sel} ${x.label}${x.jdg ? `（${x.jdg}${info ? ' ' + info.judge.title : ''}）` : x.table ? `（${x.table}）` : ''}` }),
      x.reasons.length ? h('ul', null, x.reasons.map((t) => h('li', { text: t }))) : h('p', { class: 'small', text: '決まっています（未確定の理由はありません）' }),
      info && info.judge.criteria ? h('p', { class: 'small', text: `判断基準: ${info.judge.criteria}` }) : null,
      info && info.judge.contact ? h('p', { class: 'small', text: `連絡先: ${info.judge.contact}` }) : null));
  } else if (sel) box.appendChild(h('p', { class: 'small muted', text: `${sel} は判断マスタ・テーブルを引いていない箱です` }));
  // 確認事項
  const items = an.items;
  box.appendChild(h('section', { class: 'card stack', id: 'jd-items' },
    h('div', { class: 'row' }, h('h3', { text: `確認が必要な事項（${items.length} 件）` }), h('span', { class: 'spacer' }),
      h('button', { class: 'btn', type: 'button', disabled: !items.length, onclick: () => download(`確認事項_${jdStamp()}.csv`, JUDGE.itemsCsv(items), 'text/csv;charset=utf-8') }, 'CSV で保存'),
      h('button', { class: 'btn primary', type: 'button', id: 'jd-to-questions', disabled: !items.length || !store.ledger, onclick: () => {
        const p = JUDGE.questionPatch(items, store.ledger);
        if (!p.ops.length) { toast('質問にするものはありません（すべて台帳の未回答の質問か、同じ題名の質問があります）'); return; }
        toImport(app, p);
      } }, '質問として取込へ')),
    items.length ? jdTable(JUDGE.ITEM_HEAD, items.map((x) => h('tr', { class: ['nocursor', x.id === sel && 'selected'] }, JUDGE.itemCells(x).map((c, i) => h('td', { class: i === 4 ? 'wrap small' : 'small', text: c }))))) : h('div', { class: 'empty small', text: '確認が必要な事項はありません' })));
  return box;
}

function checkView(app, an) {
  const c = an.counts;
  const model = an.model;
  const rows = TABLEDEF.columnRows(model);
  return h('div', { class: 'stack' },
    h('p', { class: 'small muted', text: `テーブル ${c.tables}（列 ${c.cols}・未確定 ${c.openCols}）・判断 ${c.judges}。書き方と、つながり（見る項目と列・出口と結果）、台帳の ID の状態を点検します。` }),
    an.warnings.length ? jdTable(['種類', '場所', '内容', '行'], an.warnings.map((w) => h('tr', { class: 'nocursor' },
      h('td', { class: 'small', text: w.kind }), h('td', { class: 'small mono', text: w.where }), h('td', { class: 'wrap small', text: w.message }),
      h('td', null, w.src && w.line ? h('button', { class: 'linklike small', type: 'button', onclick: () => { judgeState.input = w.src; app.refresh(); setTimeout(() => {
        const ta = document.getElementById(`jd-src-${w.src}`);
        if (!ta) return;
        const pos = ta.value.split('\n').slice(0, w.line - 1).join('\n').length + (w.line > 1 ? 1 : 0);
        ta.focus(); ta.setSelectionRange(pos, pos);
      }, 0); } }, `${w.line} 行目`) : (w.line ? String(w.line) : ''))))) : h('div', { class: 'empty small', text: '警告はありません' }),
    h('section', { class: 'card stack', id: 'jd-columns' },
      h('div', { class: 'row' }, h('h3', { text: `列定義表（${rows.length} 列）` }), h('span', { class: 'spacer' }),
        h('button', { class: 'btn', type: 'button', disabled: !rows.length, onclick: () => download(`列定義_${jdStamp()}.csv`, TABLEDEF.columnCsv(model), 'text/csv;charset=utf-8') }, 'CSV で保存'),
        h('button', { class: 'btn primary', type: 'button', id: 'jd-to-entities', disabled: !model.tables.length || !store.ledger, onclick: () => {
          const r = toEntityPatch(model, store.ledger);
          if (r.warnings.length) toast(r.warnings.slice(0, 3).join(' / ') + (r.warnings.length > 3 ? ` ほか ${r.warnings.length - 3} 件` : ''));
          if (!r.patch.ops.length) { if (!r.warnings.length) toast('取り込めるテーブルがありません'); return; }
          toImport(app, r.patch);
        } }, '台帳のテーブルとして取込へ')),
      rows.length ? jdTable(TABLEDEF.COLUMN_HEAD, rows.map((r) => h('tr', { class: 'nocursor' }, TABLEDEF.rowCells(r).map((v) => h('td', { class: 'small', text: v }))))) : h('div', { class: 'empty small', text: 'テーブル定義を貼ると、ここに出ます' })));
}

function demoView(app, an) {
  const cases = JUDGE.caseList(judgeState.src.cases);
  if (!cases.length) judgeState.caseKey = 'none';
  const sel = h('select', { 'aria-label': 'ケース', id: 'jd-case' },
    cases.map((c, i) => h('option', { value: String(i), selected: judgeState.caseKey === String(i), text: c.name })),
    h('option', { value: 'none', selected: judgeState.caseKey === 'none', text: '値なし（分岐ごとに選ぶ）' }));
  sel.addEventListener('change', () => { judgeState.caseKey = sel.value; judgeState.demo = null; app.refresh(); });
  const values = () => (cases[Number(judgeState.caseKey)] || { values: {} }).values;
  const start = () => { judgeState.demo = JUDGE.demo.start(an, values()); app.refresh(); };
  const st = judgeState.demo;
  const box = h('div', { class: 'stack' },
    h('div', { class: 'row' }, h('label', { class: 'row small' }, 'ケース', sel),
      h('button', { class: 'btn', type: 'button', id: 'jd-demo-start', onclick: start }, st ? '最初から' : '始める'),
      h('button', { class: 'btn', type: 'button', id: 'jd-demo-step', disabled: !st || st.status !== 'run', onclick: () => { judgeState.demo = JUDGE.demo.step(st, an); app.refresh(); } }, '1 歩進む'),
      h('button', { class: 'btn primary', type: 'button', id: 'jd-demo-run', disabled: !st || st.status !== 'run', onclick: () => { judgeState.demo = JUDGE.demo.run(st, an); app.refresh(); } }, '止まるまで進む')),
    cases[Number(judgeState.caseKey)] && cases[Number(judgeState.caseKey)].desc ? h('p', { class: 'small muted', text: cases[Number(judgeState.caseKey)].desc }) : null);
  box.appendChild(figure(an, st ? { marks: an.marks, visited: st.visited, taken: st.taken, current: st.cur, onSelect: (id) => {
    if (st.status === 'choose' && st.options.some((o) => o.to === id)) { judgeState.demo = JUDGE.demo.step(st, an, id); app.refresh(); }
  } } : { marks: an.marks }));
  if (st) {
    if (st.status === 'choose') box.appendChild(h('div', { class: 'row', role: 'group', 'aria-label': '出口を選ぶ' }, h('span', { class: 'small', text: '出口を選ぶ:' }),
      st.options.map((o) => h('button', { class: 'btn', type: 'button', onclick: () => { judgeState.demo = JUDGE.demo.step(st, an, o.to); app.refresh(); } }, o.label))));
    if (st.status === 'stop') box.appendChild(h('div', { class: 'notice warn small', role: 'status' }, h('strong', { text: st.stop.reason }), st.stop.items.length ? h('ul', null, st.stop.items.map((t) => h('li', { text: t }))) : null));
    if (st.status === 'done') box.appendChild(h('p', { class: 'notice small', role: 'status', text: '最後まで進みました' }));
    box.appendChild(h('ol', { class: 'small jd-log', 'aria-label': 'デモの記録' }, st.log.map((l) => h('li', { class: 'jd-log-' + l.kind, text: l.text }))));
  }
  return box;
}

export function renderJudge(root, app) {
  // 別の案件で作った入力は持ち込まない（切り替えの通知を取りこぼしても、案件の印で捨てる）
  if (judgeState.token !== null && judgeState.token !== store.token) clearJudgeState();
  judgeState.token = store.token;
  const ledger = store.ledger;
  const s = judgeState.src;
  // 入力が変わったら、選んだ箱とデモを最初に戻す
  const sig = JD_INPUTS.map((x) => s[x.key]).join('\u0000');
  if (sig !== judgeState.sig) { judgeState.sig = sig; judgeState.demo = null; }
  const an = JUDGE.analyze({ ...s, ledger });
  if (judgeState.sel && !an.graph?.nodes.some((n) => n.id === judgeState.sel)) judgeState.sel = null;

  root.appendChild(h('h2', { text: '判断・データ' }));
  root.appendChild(h('p', { class: 'muted small', text: '業務フローの分岐（判断）とデータの登録が決まっているかを、判断マスタ・テーブル定義・台帳の ID と突き合わせて点検します。入力は台帳に保存しません（ロックと案件の切り替えで消えます）。残すときは「まとめて保存」してください。' }));
  const c = an.counts;
  const band = h('div', { class: 'row jd-band' },
    h('span', { class: 'badge ok', text: `✓ 確定 ${c.ok}` }), h('span', { class: 'badge mid', text: `? 未確定 ${c.open}` }), h('span', { class: 'badge high', text: `! マスタなし ${c.none}` }),
    h('span', { class: 'small muted', text: `判断 ${c.judges}・テーブル ${c.tables}（未確定の列 ${c.openCols}）・確認事項 ${an.items.length}・警告 ${c.warnings}` }));
  const viewTabs = h('div', { class: 'jd-tabs', role: 'group', 'aria-label': '表示' }, JD_VIEWS.map(([k, label]) => h('button', {
    type: 'button', class: 'jd-tab', 'aria-pressed': String(judgeState.view === k), id: `jd-v-${k}`, onclick: () => { judgeState.view = k; app.refresh(); },
  }, label)));
  const view = judgeState.view === 'check' ? checkView(app, an) : judgeState.view === 'demo' ? demoView(app, an) : mapView(app, an);
  root.appendChild(h('div', { class: 'jd-layout' }, inputPane(app), h('div', { class: 'stack' }, band, viewTabs, h('div', { 'aria-label': JD_VIEWS.find(([k]) => k === judgeState.view)[1] }, view))));
}
