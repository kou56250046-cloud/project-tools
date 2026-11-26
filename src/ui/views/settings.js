// 設定画面: 案件の一覧（切り替え・外す）・新規案件・読み込み・この案件の設定・書き出し・HTML のダウンロード・保存の大きさ

import { STARTERS, createLedger } from '../../core/starter.js';
import { SETTINGS, settingOf } from '../../core/schema.js';
import { h, toast, download, confirmDialog, choiceDialog, nowIso, fmtDateTime } from '../dom.js';
import { store } from '../store.js';
import { ensureVaultReady, MIN_PASSPHRASE } from '../lock.js';

const settingsState = { loadErrors: null, changingPass: false, passError: null };

// 案件の型の選択（新規・中身を空に戻す で共通）
function starterSelect(id, selected) {
  return h('select', { id, 'aria-label': '案件の型' },
    Object.entries(STARTERS).map(([sid, st]) => h('option', { value: sid, selected: sid === selected, text: st.label })),
    h('option', { value: '', selected: selected === null, text: '型を使わない（空の台帳）' }));
}
function starterDesc(v) { return v ? STARTERS[v].desc : '項目のない台帳から始めます'; }

// 新しい案件を作って開く（設定画面と上部の「＋ 新しい案件」で共通）。作れたら true
async function createProject(n, starterId, app) {
  if (!n) { toast('案件名を入れてください'); return false; }
  if (!(await ensureVaultReady())) return false;
  store.addProject(createLedger(n, starterId || null, nowIso()));
  toast(`「${n}」を作りました`);
  app.go('overview');
  return true;
}

// 上部の「＋ 新しい案件」: 案件名と型を入れる小さな画面
export function newProjectDialog(app) {
  const name = h('input', { type: 'text', id: 'dlg-new-name', placeholder: '例: ○○社 受発注システム刷新', 'aria-label': '案件名' });
  const starter = starterSelect('dlg-new-starter', Object.keys(STARTERS)[0]);
  const desc = h('p', { class: 'muted small', text: starterDesc(starter.value) });
  starter.addEventListener('change', () => { desc.textContent = starterDesc(starter.value); });
  const err = h('p', { class: 'notice error', role: 'alert', hidden: true });
  const dlg = h('dialog', { class: 'dialog', id: 'new-project-dialog', 'aria-labelledby': 'new-project-title' },
    h('form', { method: 'dialog', class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      const n = name.value.trim();
      if (!n) { err.textContent = '案件名を入れてください'; err.hidden = false; name.focus(); return; }
      close();
      await createProject(n, starter.value, app);
    } },
      h('h2', { id: 'new-project-title', text: '新しい案件を作る' }),
      h('p', { class: 'small', text: '今の案件はそのまま残り、新しい案件が追加されます。' }),
      h('label', { class: 'field' }, '案件名', name),
      h('label', { class: 'field' }, '案件の型', starter),
      desc,
      err,
      h('div', { class: 'row dialog-actions' },
        h('button', { class: 'btn', type: 'button', 'data-act': 'cancel', onclick: () => close() }, 'やめる'),
        h('button', { class: 'btn primary', type: 'submit', 'data-act': 'ok' }, '作る'))));
  function close() { dlg.close(); dlg.remove(); }
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  document.body.appendChild(dlg);
  dlg.showModal();
  name.focus();
}

// この案件の中身を空に戻す（案件情報と設定は残す。取り消しで戻せる）
async function resetCurrent(starterId) {
  const l = store.ledger;
  const p = store.projects().find((x) => x.id === store.activeId);
  const ok = await confirmDialog(`「${l.project.name}」の中身を空に戻します。`, '空に戻す',
    `項目 ${l.items.length} 件・関係 ${l.relations.length} 件・ベースライン ${l.baselines.length} 件と変更の記録が消えます。案件情報とこの案件の設定は残ります（「自分」の設定は外れます）。` +
    `「取り消し」で元に戻せます（再読み込みやロックの後は戻せません）。${lastExportText(p)}。` +
    (p.dirty ? '最後の書き出しより後の変更があります。先に書き出してください。' : ''));
  if (!ok) return;
  store.resetProject(starterId || null);
  toast('中身を空に戻しました（取り消し可）');
}

// 合言葉を変える
async function changePass(cur, p1, p2, app) {
  const fail = (msg) => { settingsState.passError = msg; app.refresh(); };
  if (p1.length < MIN_PASSPHRASE) return fail(`新しい合言葉は ${MIN_PASSPHRASE} 文字以上にしてください`);
  if (p1 !== p2) return fail('新しい合言葉の 2 回の入力が一致しません');
  settingsState.changingPass = true; settingsState.passError = null;
  app.refresh();
  const r = await store.changePassphrase(cur, p1);
  settingsState.changingPass = false;
  if (!r.ok) return fail(r.error);
  toast('合言葉を変えました。次からは新しい合言葉で開きます');
  app.refresh();
}
// localStorage はおよそ 5MB（文字数で約 500 万）。4MB を超えたら知らせる
const STORAGE_WARN = 4 * 1024 * 1024;

function lastExportText(p) {
  return p.exportedAt ? `最後の書き出し: ${fmtDateTime(p.exportedAt)}` : 'まだ一度も書き出していません';
}

async function loadFile(file, app) {
  if (!file) return;
  let text;
  try { text = await file.text(); } catch (e) {
    settingsState.loadErrors = { name: file.name, errors: ['ファイルを読めませんでした'], more: 0 };
    app.refresh();
    return;
  }
  const r = store.parseLedgerFile(text);
  if (!r.ok) {
    settingsState.loadErrors = { name: file.name, errors: r.errors, more: r.more || 0 };
    app.refresh();
    return;
  }
  settingsState.loadErrors = null;
  // 同じ案件名の案件があれば、置き換えるか別の案件として足すかを選ぶ（P5 AC-06）
  const same = store.findProjectByName(r.ledger.project.name);
  let mode = 'add';
  if (same) {
    const p = store.projects().find((x) => x.id === same);
    mode = await choiceDialog(
      `同じ案件名「${p.name}」の案件がすでにあります。`,
      [{ value: 'add', label: '別の案件として足す' }, { value: 'replace', label: '置き換える', primary: true }],
      `今ある案件: rev ${p.revision}・${lastExportText(p)}${p.dirty ? '・その後に変更があります（置き換えると失われます）' : ''}。読み込むファイル: rev ${r.ledger.revision}`);
    if (!mode) return;
  }
  if (!(await ensureVaultReady())) return;
  if (mode === 'replace') store.replaceProject(same, r.ledger, { exported: true, migrated: r.migrated });
  else store.addProject(r.ledger, { exported: true, migrated: r.migrated });
  toast(`「${r.ledger.project.name}」を${mode === 'replace' ? '置き換えて' : ''}読み込みました`);
  app.go('overview');
}

function settingInput(key, d, cur) {
  if (d.type === 'enum') {
    return h('select', { id: 'set-' + key, 'aria-label': d.label }, d.values.map((e) => h('option', { value: e.v, selected: e.v === cur, text: e.label })));
  }
  if (d.type === 'ref') {
    const people = store.ledger.items.filter((it) => d.kinds.includes(it.kind));
    return h('select', { id: 'set-' + key, 'aria-label': d.label },
      h('option', { value: '', text: '（未設定）' }),
      people.map((p) => h('option', { value: p.id, selected: p.id === cur, text: `${p.title}（${p.id}）` })));
  }
  return h('input', { type: 'number', id: 'set-' + key, 'aria-label': d.label, min: d.min, max: d.max, step: d.type === 'int' ? '1' : 'any', value: cur == null ? '' : String(cur) });
}

export function renderSettings(root, app) {
  root.appendChild(h('h2', { text: '設定' }));

  // 読めなかった台帳の退避データ（上書きで消えないように残してある）
  const rec = Object.entries(store.recovery);
  if (rec.length) {
    root.appendChild(h('section', { class: 'card stack recovery', id: 'recovery' },
      h('h3', { text: `読めなかった台帳の退避データ（${rec.length}件）` }),
      h('p', { class: 'small', text: '今の版では読めなかった案件の元のデータを、暗号化して退避してあります。書き出して保管するか、要らなければ消してください。' }),
      rec.map(([id, text]) => h('div', { class: 'row' },
        h('span', { class: 'mono small', text: id }),
        h('button', { class: 'btn small', type: 'button', 'data-fk': 'rec-export-' + id, onclick: () => download(`退避データ_${id}_${Date.now()}.json`, text) }, '書き出す'),
        h('button', { class: 'btn small danger', type: 'button', 'data-fk': 'rec-discard-' + id, onclick: async () => {
          if (await confirmDialog('この退避データを消します。元に戻せません。', '消す')) { await store.discardRecovery(id); toast('退避データを消しました'); }
        } }, '消す')))));
  }

  // 案件の一覧（P5）
  const projects = store.projects();
  if (projects.length) {
    root.appendChild(h('section', { class: 'card stack', id: 'project-list' },
      h('h3', { text: `ブラウザの中の案件（${projects.length}件）` }),
      h('ul', { class: 'ref-list' }, projects.map((p) => h('li', { 'data-project': p.id },
        p.id === store.activeId ? h('span', { class: 'badge accent', text: '開いている' }) : h('button', { class: 'btn small', type: 'button', 'data-fk': 'open-' + p.id, onclick: () => { store.switchProject(p.id); toast(`「${p.name}」を開きました`); } }, '開く'),
        h('span', { class: 'title', text: p.name }),
        h('span', { class: 'small muted', text: `rev ${p.revision}・${lastExportText(p)}` }),
        p.dirty ? h('span', { class: 'badge mid', text: '未書き出し' }) : null,
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn small danger', type: 'button', 'data-fk': 'remove-' + p.id, onclick: async () => {
          const ok = await confirmDialog(`「${p.name}」をブラウザから外します。`, '外す',
            `${p.dirty ? '最後の書き出しより後の変更があります。外すと失われます。先に書き出してください。' : '書き出したファイルがあれば、あとで読み込み直せます。'}（${lastExportText(p)}）`);
          if (ok) { store.removeProject(p.id); toast('案件を外しました'); }
        } }, 'ブラウザから外す'))))));
  }

  // 新規案件
  const name = h('input', { type: 'text', id: 'new-name', placeholder: '例: ○○社 受発注システム刷新', 'aria-label': '案件名' });
  const starter = starterSelect('new-starter', Object.keys(STARTERS)[0]);
  const desc = h('p', { class: 'muted small', text: starterDesc(starter.value) });
  starter.addEventListener('change', () => { desc.textContent = starterDesc(starter.value); });
  root.appendChild(h('section', { class: 'card stack' },
    h('h3', { text: '新しい案件を作る' }),
    h('p', { class: 'muted small', text: '今の案件はそのまま残り、新しい案件が追加されます。' }),
    h('div', { class: 'row' }, name, starter,
      h('button', { class: 'btn primary', type: 'button', id: 'new-create', onclick: async () => {
        if (!(await createProject(name.value.trim(), starter.value, app))) name.focus();
      } }, '作る')),
    desc));

  // 読み込み
  const input = h('input', { type: 'file', accept: '.json,application/json', id: 'load-file', 'aria-label': '台帳ファイルを選ぶ' });
  input.addEventListener('change', () => loadFile(input.files[0], app));
  const zone = h('section', { class: 'card stack dropzone', id: 'dropzone' },
    h('h3', { text: '台帳ファイルを読み込む' }),
    h('p', { class: 'muted small', text: '書き出した JSON ファイルを選ぶか、この枠にドラッグ&ドロップします。新しい案件として足します。同じ案件名の案件があるときは、置き換えるか別の案件として足すかを選べます。' }),
    input);
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    loadFile(e.dataTransfer.files[0], app);
  });
  if (settingsState.loadErrors) {
    const le = settingsState.loadErrors;
    zone.appendChild(h('div', { class: 'notice error', id: 'load-errors' },
      h('strong', { text: `「${le.name}」は読み込めませんでした。台帳は変わっていません。` }),
      h('ul', null, le.errors.map((e) => h('li', { text: e }))),
      le.more ? h('div', { text: `ほか ${le.more}件` }) : null));
  }
  root.appendChild(zone);

  // この案件の設定（台帳に保存する。変更は取り消せる）
  if (store.ledger) {
    const rows = Object.entries(SETTINGS).map(([key, d]) => {
      const cur = settingOf(store.ledger, key);
      const el = settingInput(key, d, cur);
      el.addEventListener('change', () => {
        let v = el.value;
        if (d.type === 'int') v = Number.parseInt(v, 10);
        else if (d.type === 'number') v = v === '' ? null : Number(v);
        else if (d.type === 'ref') v = v === '' ? null : v;
        if (v === cur) return;
        const r = store.updateSettings({ [key]: v });
        toast(r.ok ? `${d.label}を変えました（取り消し可）` : r.errors.join(' / '));
      });
      return h('label', { class: 'field' }, d.label, el);
    });
    root.appendChild(h('section', { class: 'card stack' },
      h('h3', { text: 'この案件の設定' }),
      h('div', { class: 'row settings-row' }, rows)));

    // この案件の中身を空に戻す
    const rs = starterSelect('reset-starter', store.ledger.project.starter || null);
    const rsDesc = h('p', { class: 'muted small', text: starterDesc(rs.value) });
    rs.addEventListener('change', () => { rsDesc.textContent = starterDesc(rs.value); });
    root.appendChild(h('section', { class: 'card stack', id: 'reset-project' },
      h('h3', { text: 'この案件の中身を空に戻す' }),
      h('p', { class: 'muted small', text: '案件名・顧客・目的などの案件情報と、この案件の設定は残したまま、項目・関係・ベースライン・変更の記録を消して最初からやり直します。型を選び直せます。' }),
      h('div', { class: 'row' }, rs,
        h('button', { class: 'btn danger', type: 'button', id: 'reset-run', onclick: () => resetCurrent(rs.value) }, '中身を空に戻す')),
      rsDesc));
  }

  // 合言葉を変える（全案件で共通）
  if (store.vaultState === 'unlocked') {
    const pw = (id, label, ac) => h('input', { type: 'password', id, autocomplete: ac, 'aria-label': label });
    const cur = pw('pass-cur', '今の合言葉', 'current-password');
    const n1 = pw('pass-next-1', '新しい合言葉', 'new-password');
    const n2 = pw('pass-next-2', '新しい合言葉（確認）', 'new-password');
    const busy = settingsState.changingPass;
    root.appendChild(h('section', { class: 'card stack', id: 'change-pass' },
      h('h3', { text: '合言葉を変える' }),
      h('p', { class: 'muted small', text: `すべての案件と退避データを、新しい合言葉で暗号化し直します。新しい合言葉は ${MIN_PASSPHRASE} 文字以上。同じツールを別のタブで開いているときは、先に閉じてください。` }),
      h('form', { class: 'row', onsubmit: (e) => { e.preventDefault(); if (!busy) changePass(cur.value, n1.value, n2.value, app); } },
        h('label', { class: 'field' }, '今の合言葉', cur),
        h('label', { class: 'field' }, '新しい合言葉', n1),
        h('label', { class: 'field' }, 'もう一度', n2),
        h('button', { class: 'btn', type: 'submit', id: 'pass-change', disabled: busy }, busy ? '変えています…' : '変える')),
      settingsState.passError ? h('p', { class: 'notice error', role: 'alert', id: 'pass-error', text: settingsState.passError }) : null));
  }

  // 書き出し
  if (store.ledger) {
    root.appendChild(h('section', { class: 'card stack' },
      h('h3', { text: '書き出す' }),
      h('p', { class: 'muted small', text: `今開いている案件を JSON ファイルで保存します（${store.exportFilename()}）。ブラウザの保存は消えることがあるので、区切りごとに書き出してください。ファイルには案件の情報が入るため、社外へ持ち出さないでください。` }),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => {
        download(store.exportFilename(), store.exportText());
        store.markExported();
        toast('書き出しました');
      } }, '書き出し'))));
  }

  // 保存の大きさ
  const size = store.storageSize();
  root.appendChild(h('section', { class: 'card stack', id: 'storage-size' },
    h('h3', { text: 'ブラウザの保存の大きさ' }),
    h('p', { class: ['small', size > STORAGE_WARN && 'notice error'], text: `約 ${(size / 1024 / 1024).toFixed(2)} MB（目安の上限 5 MB）。${size > STORAGE_WARN ? '4 MB を超えています。使っていない案件を書き出してからブラウザから外してください。' : ''}` })));

  // 配布（GitHub Pages で開いたときだけ）
  if (location.protocol === 'http:' || location.protocol === 'https:') {
    root.appendChild(h('section', { class: 'card stack' },
      h('h3', { text: 'このツールをダウンロードする' }),
      h('p', { class: 'muted small', text: 'HTML ファイル1つで動きます。保存したファイルをダブルクリックで開けば、通信なしで使えます。' }),
      h('div', { class: 'row' }, h('a', { class: 'btn primary', href: './index.html', download: 'anken-workbench.html', id: 'download-html' }, 'HTML をダウンロード'))));
  }

  root.appendChild(h('section', { class: 'card stack' },
    h('h3', { text: 'データの扱い' }),
    h('ul', { class: 'small' },
      h('li', { text: '台帳は合言葉で暗号化して、このブラウザの中（localStorage）に保存します。合言葉と鍵は保存しません。合言葉はすべての案件で共通です' }),
      h('li', { text: '書き出したファイルは暗号化されていません。社内の決められた場所に保存してください' }),
      h('li', { text: 'このツールは外部と一切通信しません（ブラウザのセキュリティ設定 CSP で禁止しています）' }),
      h('li', { text: 'Gemini への受け渡しは、コピーと貼り付けだけで行います' }))));
}
