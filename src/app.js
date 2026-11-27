// 起動・画面切替・上部の状態表示

import { h, clear, toast, download, confirmDialog, fmtDateTime } from './ui/dom.js';
import { store, UNDO_LIMIT } from './ui/store.js';
import { renderLock } from './ui/lock.js';
import { runHealth } from './core/health.js';
import { createLedger } from './core/starter.js';
import { validatePatch } from './core/patch.js';
import { extractJson } from './core/extract.js';
import { todayStr } from './ui/dom.js';
import { renderDetail } from './ui/detail.js';
import { renderOverview } from './ui/views/overview.js';
import { renderGraph } from './ui/views/graph.js';
import { renderList } from './ui/views/list.js';
import { renderDecisions } from './ui/views/decisions.js';
import { renderHealth } from './ui/views/health.js';
import { renderImport, clearImportDraft } from './ui/views/import.js';
import { renderPrompts, clearPromptsState } from './ui/views/prompts.js';
import { renderSettings, newProjectDialog } from './ui/views/settings.js';
import { renderHearing, clearHearingState } from './ui/views/hearing.js';
import { renderIssues } from './ui/views/issues.js';
import { renderNfr } from './ui/views/nfr.js';
import { renderScope } from './ui/views/scope.js';
import { renderWbs } from './ui/views/wbs.js';
import { renderGantt } from './ui/views/gantt.js';
import { renderProgress } from './ui/views/progress.js';
import { renderChanges } from './ui/views/changes.js';
import { renderMeetingReport } from './ui/views/meeting-report.js';
import { renderData } from './ui/views/data.js';
import { renderFunctions } from './ui/views/functions.js';
import { renderArch } from './ui/views/arch.js';
import { renderJudge, clearJudgeState } from './ui/views/judge.js';
import { renderCrud } from './ui/views/crud.js';
import { renderEstimate } from './ui/views/estimate.js';
import { renderMaster, clearMasterState } from './ui/views/master.js';
import { renderTrace } from './ui/views/trace.js';
import { renderTests } from './ui/views/tests.js';
import { renderCross } from './ui/views/cross.js';
import { renderGuide } from './ui/views/guide.js';
import { renderConvert, clearConvertState } from './ui/views/convert.js';
import { renderMemos, clearMemosState } from './ui/views/memos.js';
import { renderPreprocess, clearPreprocessState } from './ui/views/preprocess.js';
import { renderMask, clearMaskState } from './ui/views/mask.js';
import { renderKpiTree } from './ui/views/kpi-tree.js';
import { renderBizflow, clearBizflowState } from './ui/views/bizflow.js';
import { renderRisks } from './ui/views/risks.js';
import { renderOrg } from './ui/views/org.js';
import { GROUPS, SCREENS, NO_LEDGER_OK, hiddenScreenInPresentation } from './core/screens.js';

// 画面の描画関数（画面の id → 関数）。分類と画面の一覧は core/screens.js が正
const RENDERERS = {
  cross: renderCross, memos: renderMemos, org: renderOrg, overview: renderOverview, graph: renderGraph, list: renderList, decisions: renderDecisions, health: renderHealth,
  hearing: renderHearing, issues: renderIssues, nfr: renderNfr, scope: renderScope, 'kpi-tree': renderKpiTree, bizflow: renderBizflow,
  wbs: renderWbs, gantt: renderGantt, progress: renderProgress, changes: renderChanges, risks: renderRisks, 'meeting-report': renderMeetingReport,
  data: renderData, functions: renderFunctions, arch: renderArch, judge: renderJudge, crud: renderCrud, estimate: renderEstimate, master: renderMaster,
  trace: renderTrace, tests: renderTests,
  prompts: renderPrompts, import: renderImport, convert: renderConvert, preprocess: renderPreprocess, mask: renderMask, settings: renderSettings,
  guide: renderGuide,
};
const VIEWS = SCREENS.map((sc) => ({ ...sc, render: RENDERERS[sc.id] }));
// 台帳が無いと開けない画面
const NEEDS_LEDGER = new Set(VIEWS.filter((v) => !NO_LEDGER_OK.includes(v.id)).map((v) => v.id));
// 再描画をまたいで保つスクロール位置（画面の中の横スクロール領域も含む）
const SCROLLERS = ['#view', '.graph-wrap', '.table-wrap', '#detail'];

// フォーカスしている要素を、再描画後に探し直せる形で覚える
function focusSelector(el) {
  if (!el || el === document.body || !el.closest) return null;
  if (!el.closest('#view, #detail, #tabs, #groups, .topbar')) return null;
  if (el.id) return '#' + CSS.escape(el.id);
  if (el.dataset && el.dataset.fk) return `[data-fk="${CSS.escape(el.dataset.fk)}"]`;
  if (el.dataset && el.dataset.id) return `${el.tagName.toLowerCase()}[data-id="${CSS.escape(el.dataset.id)}"]`;
  return null;
}

function captureUi() {
  const scroll = SCROLLERS.map((sel) => { const e = document.querySelector(sel); return e ? [sel, e.scrollTop, e.scrollLeft] : null; }).filter(Boolean);
  return { scroll, focus: focusSelector(document.activeElement) };
}

function restoreUi(st) {
  for (const [sel, top, left] of st.scroll) {
    const e = document.querySelector(sel);
    if (e) { e.scrollTop = top; e.scrollLeft = left; }
  }
  if (st.focus) {
    const f = document.querySelector(st.focus);
    if (f) f.focus({ preventScroll: true });
  }
}

const app = {
  view: 'overview',
  viewOpts: {},
  opener: null,
  // 画面を切り替える（先頭から表示する）
  go(view, opts) {
    if (!VIEWS.some((v) => v.id === view) || hiddenInPresentation(view)) view = 'overview';
    const same = view === this.view;
    // マスタ点検の元データは、画面を離れたら捨てる（保存しない）
    if (!same && this.view === 'master') clearMasterState();
    this.view = view;
    this.viewOpts = opts || {};
    if (location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
    if (same) { this.refresh(); return; }
    renderAll();
    document.getElementById('view').scrollTop = 0;
    const cur = document.querySelector('#tabs [aria-current="page"]');
    if (cur && document.activeElement && document.activeElement.closest && document.activeElement.closest('#tabs, #groups')) cur.focus();
  },
  // 同じ画面を描き直す（スクロール位置とフォーカスを保つ）
  refresh() {
    const st = captureUi();
    renderAll();
    restoreUi(st);
  },
  openItem(id) {
    this.opener = focusSelector(document.activeElement);
    store.select(id);
    const t = document.getElementById('detail-title');
    if (t) t.focus({ preventScroll: true });
  },
  closeDetail() {
    const back = this.opener;
    store.select(null);
    if (back) { const e = document.querySelector(back); if (e) e.focus({ preventScroll: true }); }
  },
  // 画面を開けるか。タブのボタンと使い方のボタンの両方がこれを使う。戻り値: { ok, reason }
  canOpen(viewId) {
    if (!VIEWS.some((v) => v.id === viewId)) return { ok: false, reason: 'その画面はありません' };
    if (locked()) return viewId === 'guide' ? { ok: true } : { ok: false, reason: '合言葉で開いてから使えます' };
    if (!store.ledger && NEEDS_LEDGER.has(viewId)) return { ok: false, reason: '先に「設定」で案件を作るか、読み込んでください' };
    if (hiddenInPresentation(viewId)) return { ok: false, reason: '説明用の表示中は開けません' };
    return { ok: true };
  },
  views() { return VIEWS; },
  health() {
    // 説明用の表示では健康診断を出さない（社内向けの点検のため）
    return store.ledger && !store.presentation ? runHealth(store.ledger, todayStr()) : [];
  },
};

// 説明用の表示で開けない画面（道具の分類と健康診断）
function hiddenInPresentation(viewId) {
  if (!store.presentation) return false;
  return hiddenScreenInPresentation(VIEWS.find((x) => x.id === viewId));
}

function locked() {
  return store.vaultState === 'locked' || store.vaultState === 'legacy';
}

// 分類ごとに最後に開いた画面（分類を押したときに戻る先）
const lastInGroup = {};

function renderTabs() {
  const groupsEl = clear(document.getElementById('groups'));
  const tabs = clear(document.getElementById('tabs'));
  if (locked()) return;
  const highCount = app.health().filter((f) => f.severity === 'high').length;
  const curView = VIEWS.find((v) => v.id === app.view);
  lastInGroup[curView.group] = curView.id;
  for (const g of GROUPS) {
    const views = VIEWS.filter((v) => v.group === g.id && !hiddenInPresentation(v.id));
    if (!views.length) continue;
    groupsEl.appendChild(h('button', {
      class: 'group', type: 'button', id: 'group-' + g.id, 'aria-current': g.id === curView.group ? 'true' : null,
      onclick: () => app.go(lastInGroup[g.id] || (g.id === 'grasp' ? 'overview' : views[0].id)),
    }, g.label));
  }
  for (const v of VIEWS.filter((x) => x.group === curView.group && !hiddenInPresentation(x.id))) {
    // 台帳が無いときの「概要」タブは押せてようこそ画面を出す（初回の入口）
    const disabled = !app.canOpen(v.id).ok && !(v.id === 'overview' && !store.ledger);
    tabs.appendChild(h('button', {
      class: 'tab', type: 'button', id: 'tab-' + v.id, 'aria-current': app.view === v.id ? 'page' : null, disabled,
      onclick: () => app.go(v.id),
    }, v.label, v.id === 'health' && highCount ? h('span', { class: 'count', text: String(highCount), 'aria-label': `（重要度 高 ${highCount}件）` }) : null));
  }
}

// 取り消しの段の種類の表示名
const STEP_LABELS = { import: '取込', local: '画面での変更', hearing: 'ヒヤリング', settings: '設定', baseline: 'ベースライン', reset: '中身を空に戻す' };

// 取り消しの履歴: 新しい順に出し、「ここまで戻す」でその変更の前まで一度に戻す
function historyDialog() {
  const steps = store.history();
  const total = steps.length;
  const dlg = h('dialog', { class: 'dialog history-dialog', id: 'history-dialog', 'aria-labelledby': 'history-title' },
    h('h2', { id: 'history-title', text: '取り消しの履歴' }),
    h('p', { class: 'small muted', text: `直近 ${total} 件（最大 ${UNDO_LIMIT} 件）。再読み込み・ロックで消えます。案件を切り替えても残ります。` }),
    h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
      h('thead', null, h('tr', null, ['いつ', 'どこから', '件数', ''].map((t) => h('th', { scope: 'col', text: t })))),
      h('tbody', null, steps.map((st, n) => h('tr', { class: 'nocursor', 'data-step': String(st.index) },
        h('td', { class: 'mono small', text: fmtDateTime(st.at) }),
        h('td', { text: STEP_LABELS[st.kind] || st.kind }),
        h('td', { class: 'num', text: st.kind === 'reset' ? '—' : `${st.count} 件` }),
        h('td', null, h('button', { class: 'btn small', type: 'button', 'data-fk': 'undo-to-' + st.index, onclick: async () => {
          const lost = total - st.index;
          close();
          const ok = await confirmDialog('この変更の前まで戻します。', 'ここまで戻す',
            `この変更を含め、新しい方から ${lost} 段の変更が失われ、やり直せません。`);
          if (ok && store.undoTo(st.index)) toast(`${lost} 段取り消しました`);
        } }, n === 0 ? 'これを取り消す' : 'ここまで戻す'))))))),
    h('div', { class: 'row dialog-actions' }, h('button', { class: 'btn', type: 'button', 'data-act': 'cancel', onclick: () => close() }, '閉じる')));
  function close() { dlg.close(); dlg.remove(); }
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  document.body.appendChild(dlg);
  dlg.showModal();
}

function renderTopbar() {
  const name = clear(document.getElementById('project-name'));
  const projects = store.projects();
  // 案件が複数あるときは切り替えの一覧を出す。説明用の表示では、他の顧客の案件名を見せないよう今の案件名だけ
  if (projects.length > 1 && !store.presentation && !locked()) {
    const sel = h('select', { id: 'project-switch', 'aria-label': '案件を切り替える' },
      projects.map((p) => h('option', { value: p.id, selected: p.id === store.activeId, text: p.name + (p.dirty ? '（未書き出し）' : '') })));
    sel.addEventListener('change', () => { store.switchProject(sel.value); toast('案件を切り替えました'); });
    name.appendChild(sel);
  } else if (store.ledger) {
    name.appendChild(h('span', { class: 'project-title', text: store.ledger.project.name }));
  }
  // 上部からの新しい案件（ロック中と説明用の表示では出さない。台帳が無いときも出す）
  if (!locked() && !store.presentation) {
    name.appendChild(h('button', { class: 'btn small', type: 'button', id: 'btn-new-project', title: '新しい案件を作る（今の案件はそのまま残る）', onclick: () => newProjectDialog(app) }, '＋ 新しい案件'));
  }
  const status = clear(document.getElementById('topbar-status'));
  if (store.saveError) status.appendChild(h('span', { class: 'badge high', text: '保存に失敗', title: store.saveError }));
  if (store.vaultState === 'nostore') status.appendChild(h('span', { class: 'badge high', text: 'ブラウザに保存しません', title: store.loadError || '' }));
  if (store.presentation) status.appendChild(h('span', { class: 'badge accent', id: 'presentation-badge', text: '説明用の表示中' }));
  if (store.ledger && !store.presentation) {
    status.appendChild(h('span', { class: 'muted small', text: `rev ${store.ledger.revision}` }));
    if (store.isDirty()) status.appendChild(h('span', { class: 'badge mid', id: 'dirty-badge', text: '未書き出しの変更あり' }));
    else status.appendChild(h('span', { class: 'badge ok', text: '書き出し済み' }));
  }
  const actions = clear(document.getElementById('topbar-actions'));
  if (store.ledger) {
    actions.appendChild(h('button', {
      class: ['btn', store.presentation && 'primary'], type: 'button', id: 'btn-presentation', 'aria-pressed': String(store.presentation),
      title: '顧客に画面を見せるときの表示。社内のみの項目・健康診断・実績の値・道具の画面を隠す',
      onclick: () => { store.setPresentation(!store.presentation); toast(store.presentation ? '説明用の表示にしました' : '通常の表示に戻しました'); },
    }, store.presentation ? '通常の表示に戻す' : '説明用の表示'));
  }
  if (store.ledger && !store.presentation) {
    actions.appendChild(h('button', {
      class: 'btn', type: 'button', id: 'btn-undo', disabled: !store.canUndo(), title: `直前の変更を1段ずつ取り消す（${UNDO_LIMIT}段まで）`,
      onclick: () => { if (store.undo()) toast(`1段取り消しました（あと ${store.history().length} 段）`); },
    }, '取り消し'));
    actions.appendChild(h('button', {
      class: 'btn', type: 'button', id: 'btn-history', disabled: !store.canUndo(), title: '直近の変更の一覧から、まとめて戻す',
      onclick: () => historyDialog(),
    }, '履歴'));
    actions.appendChild(h('button', {
      class: 'btn primary', type: 'button', id: 'btn-export', title: '台帳を JSON ファイルに保存する',
      onclick: () => { download(store.exportFilename(), store.exportText()); store.markExported(); toast('書き出しました（保存ダイアログを閉じた場合は保存されていません）'); },
    }, '書き出し'));
  }
  if (store.vaultState === 'unlocked') {
    actions.appendChild(h('button', {
      class: 'btn', type: 'button', id: 'btn-lock', disabled: store.passChanging, title: store.passChanging ? '合言葉を変えている間はロックできません' : '台帳と鍵をメモリから消し、合言葉を入れるまで開けないようにする',
      onclick: () => { store.lock(); toast('ロックしました'); },
    }, 'ロック'));
  }
}

function renderView() {
  const root = clear(document.getElementById('view'));
  if (locked()) {
    // ロック中でも使い方だけは読める（案件のデータは出さない）
    if (app.view === 'guide') {
      root.appendChild(h('div', { class: 'row guide-back' }, h('button', { class: 'btn', type: 'button', id: 'guide-back-lock', onclick: () => app.go('overview') }, '← 合言葉の画面に戻る')));
      renderGuide(root, app, app.viewOpts);
    } else renderLock(root, app);
    return;
  }
  if (store.loadError) root.appendChild(h('p', { class: 'notice error', text: store.loadError }));
  if (store.saveError) root.appendChild(h('p', { class: 'notice error', text: store.saveError }));
  const v = VIEWS.find((x) => x.id === app.view);
  if (!store.ledger && NEEDS_LEDGER.has(v.id)) {
    renderWelcome(root);
    return;
  }
  v.render(root, app, app.viewOpts);
}

function renderWelcome(root) {
  root.appendChild(h('div', { class: 'card stack welcome' },
    h('h2', { text: '案件ワークベンチへようこそ' }),
    h('p', { text: 'まだ台帳がありません。上の「＋ 新しい案件」か「設定」から新しい案件を作るか、「設定」で書き出した台帳ファイルを読み込んでください。' }),
    h('p', { class: 'muted small', text: '台帳は合言葉で暗号化してこのブラウザの中に保存し、書き出したファイルにも保存できます。外部へは一切送信しません。' }),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', type: 'button', onclick: () => app.go('settings') }, '設定を開く'),
      h('button', { class: 'btn', type: 'button', id: 'welcome-guide', onclick: () => app.go('guide') }, '使い方を見る'))));
}

function renderAll() {
  renderTabs();
  renderTopbar();
  renderView();
  renderDetail(document.getElementById('detail'), app);
}

function boot() {
  // 他人のページの枠の中では動かない（クリックジャッキング対策。GitHub Pages ではヘッダで防げないため）
  if (window.top !== window.self) {
    document.body.textContent = 'このツールは単独のタブで開いてください。';
    return;
  }
  store.init();
  const fromHash = location.hash.replace('#', '');
  app.view = VIEWS.some((v) => v.id === fromHash) ? fromHash : 'overview';
  store.subscribe((reason) => {
    if (reason === 'select') {
      // 選んだ項目を画面の中でも強調する画面は、描き直す
      const sc = SCREENS.find((x) => x.id === app.view);
      if (sc && sc.select) app.refresh();
      else renderDetail(document.getElementById('detail'), app);
      return;
    }
    if (reason === 'save-error') { renderTopbar(); return; }
    // ロックのとき、画面が持つ一時の入力（貼った文・書きかけ・変換の結果）をすべて消す（続く vault の通知で描き直す）
    if (reason === 'lock') { clearConvertState(); clearMemosState(); clearPreprocessState(); clearMaskState(); clearBizflowState(); clearJudgeState(); clearImportDraft(); clearPromptsState(); clearHearingState(); app.viewOpts = {}; return; }
    if (reason === 'vault') { clearMasterState(); clearJudgeState(); }
    // 案件の切り替え・置き換えでも、案件ごとの書きかけ（業務フロー）と判断・データの入力を消す（別の案件に持ち込まない）
    if (reason === 'switch' || reason === 'replace') { clearBizflowState(); clearJudgeState(); }
    if (reason === 'presentation' && hiddenInPresentation(app.view)) { app.go('overview'); return; }
    app.refresh();
  });
  window.addEventListener('hashchange', () => {
    const id = location.hash.replace('#', '');
    if (id !== app.view && VIEWS.some((v) => v.id === id)) app.go(id);
    else if (hiddenInPresentation(id)) app.go('overview');
  });
  // Esc で詳細パネルを閉じる（ダイアログが開いているときはダイアログ側が受ける）
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && store.selectedId && !document.querySelector('dialog[open]')) { e.preventDefault(); app.closeDetail(); }
  });
  // 自動確認用の入口。URL に ?debug を付けたときだけ公開する（普段は台帳をメモリから取り出せないようにする）
  if (new URLSearchParams(location.search).has('debug')) {
    window.__workbench = { store, app, core: { createLedger, validatePatch, extractJson } };
  }
  renderAll();
}

boot();
