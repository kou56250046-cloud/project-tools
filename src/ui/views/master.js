// マスタ点検: マスタのテーブルを選び、CSV / TSV を貼るかファイルを選んで、列の定義と突き合わせる
// 元データは顧客の実データになりうるため、この画面の変数にだけ置く。台帳・localStorage には渡さない。画面を離れると消す

import { CHECKS, checkMaster, ISSUE_LIMIT } from '../../core/mastercheck.js';
import { parseDelimited, decodeBytes } from '../../core/csv.js';
import { h, toast } from '../dom.js';
import { store } from '../store.js';

const ENCODINGS = [{ v: 'auto', label: '自動（UTF-8 → Shift_JIS）' }, { v: 'utf-8', label: 'UTF-8' }, { v: 'shift_jis', label: 'Shift_JIS' }];
let masterState = null;
const fresh = () => ({ entityId: null, encoding: 'auto', main: null, refs: {}, result: null });

// 画面を離れたときに呼ぶ（元データを捨てる）
export function clearMasterState() {
  masterState = null;
}

function dataInput(id, label, onLoad) {
  const ta = h('textarea', { rows: '6', id: id + '-text', 'aria-label': label, placeholder: 'CSV / TSV を貼り付けるか、下でファイルを選びます（1 行目は見出し）' });
  const file = h('input', { type: 'file', id: id + '-file', accept: '.csv,.tsv,.txt,text/csv', 'aria-label': label + 'のファイル' });
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    const dec = decodeBytes(await f.arrayBuffer(), masterState.encoding);
    onLoad({ name: f.name, text: dec.text, encoding: dec.encoding });
  });
  const btn = h('button', { class: 'btn small', type: 'button', id: id + '-use', onclick: () => { if (ta.value.trim()) onLoad({ name: '貼り付け', text: ta.value, encoding: '貼り付け' }); } }, '貼った内容を使う');
  return h('div', { class: 'stack' }, ta, h('div', { class: 'row' }, file, btn));
}

export function renderMaster(root, app) {
  if (!masterState) masterState = fresh();
  const st = masterState;
  const ledger = store.view();
  const ents = ledger.items.filter((it) => it.kind === 'entity' && it.status !== 'dropped');
  const masters = ents.filter((e) => e.master);
  root.appendChild(h('h2', { text: 'マスタ点検' }));
  root.appendChild(h('p', { class: 'notice small', text: '貼った元データはこの画面の中だけで点検し、台帳にもブラウザの保存にも残しません。別の画面に移ると消えます。' }));
  if (!masters.length) { root.appendChild(h('div', { class: 'empty', text: 'マスタの印のあるテーブルがありません。データ設計でテーブルを master: true にしてください。' })); return; }
  if (!st.entityId || !masters.some((e) => e.id === st.entityId)) st.entityId = masters[0].id;
  const ent = masters.find((e) => e.id === st.entityId);

  const sel = h('select', { id: 'master-entity', 'aria-label': '点検するマスタ' }, masters.map((e) => h('option', { value: e.id, selected: e.id === st.entityId, text: `${e.title}（${e.physicalName}）` })));
  sel.addEventListener('change', () => { masterState = { ...fresh(), entityId: sel.value, encoding: st.encoding }; app.refresh(); });
  const enc = h('select', { id: 'master-encoding', 'aria-label': 'ファイルの文字コード' }, ENCODINGS.map((x) => h('option', { value: x.v, selected: x.v === st.encoding, text: x.label })));
  enc.addEventListener('change', () => { st.encoding = enc.value; });
  root.appendChild(h('div', { class: 'row' }, h('label', { class: 'row' }, 'マスタ', sel), h('label', { class: 'row small' }, 'ファイルの文字コード', enc)));

  const run = () => {
    if (!st.main) return;
    const refData = new Map();
    for (const [eid, d] of Object.entries(st.refs)) {
      const rows = parseDelimited(d.text);
      if (rows.length) refData.set(eid, { header: rows[0], rows: rows.slice(1) });
    }
    st.result = checkMaster(ent, parseDelimited(st.main.text), refData, ents);
    toast(`点検しました（違反 ${st.result.total} 件）`);
    app.refresh();
  };
  root.appendChild(h('section', { class: 'card stack' },
    h('h3', { text: `点検する元データ（${ent.title}）` }),
    st.main ? h('p', { class: 'small', id: 'master-loaded', text: `読み込み済み: ${st.main.name}（${st.main.encoding}）` }) : null,
    dataInput('master-main', `${ent.title}の元データ`, (d) => { st.main = d; run(); })));

  // 外部キーの参照先（任意）
  const fkTargets = [...new Set((ent.columns || []).filter((c) => c.fk && c.fk.entity).map((c) => c.fk.entity))].map((id) => ents.find((e) => e.id === id)).filter(Boolean);
  if (fkTargets.length) {
    root.appendChild(h('details', { class: 'card' },
      h('summary', { text: `参照先の元データ（任意。入れると「参照先に無い値」を点検します）: ${fkTargets.map((e) => e.title).join('・')}` }),
      fkTargets.map((t) => h('div', { class: 'stack' },
        h('h4', { text: t.title + (st.refs[t.id] ? `（読み込み済み: ${st.refs[t.id].name}）` : '') }),
        dataInput('master-ref-' + t.id, `${t.title}の元データ`, (d) => { st.refs[t.id] = d; run(); })))));
  }

  const r = st.result;
  if (!r) return;
  root.appendChild(h('h3', { text: `点検結果（データ ${r.dataRows} 行・違反 ${r.total} 件）` }));
  root.appendChild(h('div', { class: 'grid cols-3', id: 'master-summary' }, CHECKS.map((c) => h('div', { class: ['card stat', r.summary[c.v] > 0 && 'kpi alert'], 'data-check': c.v },
    h('span', { class: 'num', text: String(r.summary[c.v]) }), h('span', { class: 'lab', text: c.label })))));
  if (!r.issues.length) { root.appendChild(h('p', { class: 'notice', text: '違反はありません。' })); return; }
  if (r.total > ISSUE_LIMIT) root.appendChild(h('p', { class: 'notice warn small', text: `違反が多いため、先頭 ${ISSUE_LIMIT} 件だけを表示しています（件数は全件）。` }));
  const label = Object.fromEntries(CHECKS.map((c) => [c.v, c.label]));
  root.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'list', id: 'master-issues' },
    h('thead', null, h('tr', null, ['行', '列', '種類', '値', '内容'].map((t) => h('th', { scope: 'col', text: t })))),
    h('tbody', null, r.issues.map((x) => h('tr', { class: 'nocursor' },
      h('td', { class: 'mono small num', text: String(x.row) }),
      h('td', { class: 'mono small', text: x.column }),
      h('td', { class: 'small', text: label[x.type] }),
      h('td', { class: 'mono small wrap', text: x.value }),
      h('td', { class: 'small wrap', text: x.message })))))));
}
