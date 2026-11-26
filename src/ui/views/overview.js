// 概要（ダッシュボード）: 案件情報・始め方・KPI 4 枚・グラフ（要件の状態・ボール・S カーブ・確度・期限）・次にやること・種別ごとの件数
// 集計は core/dashboard.js、描画は dashboard スキルの部品（src/vendor/dash.js の window.Dash。gemini-kit と同じ）

import { LEDGER_KINDS, kindLabel, isOpen } from '../../core/schema.js';
import { dashboardData, seriesTotal } from '../../core/dashboard.js';
import { h, todayStr } from '../dom.js';
import { store } from '../store.js';
import { findingRow } from './health.js';

const EMPTY = 'まだありません';
const NO_COMPARE = [{ label: '比べる値なし', delta: 0, better: 'none' }];

// グラフを置く入れ物。描く前に文書に入れておく（dash.js は幅を測って描く）
function slot(parent, id) {
  const el = h('section', { class: 'card dash-card', id });
  parent.appendChild(el);
  return el;
}

// 合計が 0 のグラフは分類を空にして、dash.js の空の表示（まだありません）を出す
const barSpec = (chart, spec) => (seriesTotal(chart) ? { ...spec, categories: chart.categories, series: chart.series } : { ...spec, categories: [], series: chart.series });

function renderDashboard(root, app, ledger) {
  const Dash = window.Dash;
  if (!Dash) return;
  const today = todayStr();
  const hide = store.presentation;
  const d = dashboardData(store.ledger, { today, presentation: hide });
  const meta = { asOf: today, source: `台帳 rev ${ledger.revision}`, empty: EMPTY };
  const k = d.kpi;

  // ---- KPI ----
  const kpis = h('div', { class: 'dash-kpis', id: 'dash-kpis' });
  root.appendChild(kpis);
  const kpi = (id, spec, open) => {
    const wrap = h('div', { class: 'dash-kpi' });
    kpis.appendChild(wrap);
    const host = slot(wrap, id);
    Dash.kpi(host, { ...meta, ...spec });
    wrap.appendChild(h('button', { class: 'btn small dash-open', type: 'button', 'data-fk': 'open-' + id, onclick: open.go }, open.label));
  };
  if (!hide) {
    kpi('k-wait', {
      title: '顧客待ち', value: k.customerWait.count, unit: '件',
      compare: [{ label: '目標 0 件との差', delta: k.customerWait.count, unit: '件', better: 'down' }],
      note: k.customerWait.count ? (k.customerWait.maxDays !== null ? `いちばん長い待ち ${k.customerWait.maxDays} 日` : null) : '顧客の返事を待っている課題・質問はありません',
    }, { label: '課題と質問を開く', go: () => app.go('issues') });
    const bk = k.overdue.byKind;
    kpi('k-overdue', {
      title: '期限切れ', value: k.overdue.count, unit: '件',
      compare: [{ label: '目標 0 件との差', delta: k.overdue.count, unit: '件', better: 'down' }],
      note: k.overdue.count ? `${kindLabel('issue')} ${bk.issue}・${kindLabel('question')} ${bk.question}・${kindLabel('task')} ${bk.task}` : '期限を過ぎたものはありません',
    }, { label: '健康診断を開く', go: () => app.go('health') });
  }
  const a = k.agreement;
  const pct = (r) => Math.round(r * 1000) / 10;
  kpi('k-agree', a.rate === null
    ? { title: '要件の合意率', value: null, unit: '%', compare: NO_COMPARE, note: '合意の対象の要件がまだありません' }
    : {
      title: '要件の合意率', value: pct(a.rate), unit: '%', digits: 1,
      compare: a.baselineRate !== null
        ? [{ label: 'ベースラインから', delta: pct(a.rate) - pct(a.baselineRate), unit: 'pt', digits: 1, better: 'up' }]
        : [{ label: '目標 100% との差', delta: pct(a.rate) - 100, unit: 'pt', digits: 1, better: 'up' }],
      note: `合意 ${a.agreed} / ${a.total} 件（取り下げを除く）`,
    }, { label: '要件の一覧を開く', go: () => app.go('list', { filter: { kind: 'requirement' } }) });
  const sp = k.spi;
  const spiNote = !sp.hasTasks ? 'WBS を作ると出ます' : !sp.hasTargets ? '見積・開始日・終了日を入れると出ます' : sp.value === null ? '計画の開始日を過ぎると出ます' : 'EV ÷ PV。1 未満は遅れ';
  kpi('k-spi', sp.value === null
    ? { title: 'SPI（スケジュール効率）', value: null, compare: NO_COMPARE, note: spiNote }
    : { title: 'SPI（スケジュール効率）', value: sp.value, digits: 2, compare: [{ label: '基準 1.00 との差', delta: Math.round((sp.value - 1) * 100) / 100, digits: 2, better: 'up' }], note: spiNote },
  { label: '進捗を開く', go: () => app.go('progress') });

  // ---- 要件の状態 ／ ボールの状況 ----
  const row1 = h('div', { class: 'dash-grid' });
  root.appendChild(row1);
  Dash.bar(slot(row1, 'g-req'), barSpec(d.requirements, { ...meta, title: '要件の状態（分類ごと）', unit: '件', mode: 'stack', orientation: 'h', sort: 'none', sub: '案の多い順' }));
  if (!hide) Dash.bar(slot(row1, 'g-ball'), barSpec(d.ball, { ...meta, title: 'ボールの状況（誰の対応待ちか × 待ち日数）', unit: '件', mode: 'stack', orientation: 'h', sort: 'none', sub: `区切りは設定の「顧客待ちを知らせる日数」（${d.ballWaitDays} 日）` }));

  // ---- 進捗の S カーブ（EVM の対象の作業があるときだけ） ----
  if (d.curve) {
    const series = [
      { name: 'PV 計画', values: d.curve.map((p) => p.pv), role: 'reference' },
      { name: 'EV 出来高', values: d.curve.map((p) => p.ev), focus: true },
    ];
    if (!hide) series.push({ name: 'AC 実績', values: d.curve.map((p) => p.ac) });
    Dash.line(slot(root, 'g-curve'), { ...meta, title: '進捗の S カーブ（週ごと・人日の累計）', unit: '人日', x: d.curve.map((p) => p.date), series });
  }

  // ---- 確度の内訳 ／ 期限の分布 ----
  const row2 = h('div', { class: 'dash-grid' });
  root.appendChild(row2);
  if (!hide) Dash.bar(slot(row2, 'g-conf'), barSpec(d.confidence, { ...meta, title: '確度の内訳（要望・要件・制約）', unit: '件', mode: 'stack', orientation: 'h', sort: 'none', sub: '取り下げ・不採用・解消を除く' }));
  Dash.bar(slot(row2, 'g-due'), barSpec(d.due, { ...meta, title: '期限の分布（未完了）', unit: '件', mode: 'stack', orientation: 'v', sort: 'none', sub: '週は月曜始まり。健康診断の期限切れと同じ対象' }));
}

export function renderOverview(root, app) {
  const ledger = store.view();
  const p = ledger.project;

  const kv = h('dl', { class: 'kv wide' });
  const row = (k, v) => { if (v) { kv.appendChild(h('dt', { text: k })); kv.appendChild(h('dd', { class: 'body-text', text: v })); } };
  row('顧客', p.customer);
  row('目的', p.purpose);
  row('期間', p.periodStart || p.periodEnd ? `${p.periodStart || '?'} 〜 ${p.periodEnd || '?'}` : '');
  row('概要', p.summary);
  const goals = Array.isArray(p.goals) && p.goals.length ? h('ul', { class: 'goals' }, p.goals.map((g) => h('li', { text: g }))) : null;

  root.appendChild(h('section', { class: 'card stack' },
    h('h2', { text: p.name }),
    kv.childNodes.length ? kv : h('p', { class: 'muted', text: '案件の目的や期間はまだありません。「指示文」の「初期作成」で資料から設定できます。' }),
    goals ? h('div', null, h('h3', { text: 'ゴール' }), goals) : null));

  // 始め方（項目が少ないうち。説明用の表示では出さない）
  if (!store.presentation && ledger.items.filter((it) => it.kind !== 'memo').length < 10) {
    root.appendChild(h('div', { class: 'notice stack' },
      h('strong', { text: '始め方' }),
      h('ol', null,
        h('li', { text: '「指示文」で「初期作成」を選んでコピーし、提案依頼書やメモと一緒に Gemini に貼る' }),
        h('li', { text: 'Gemini の返答を「取込」に貼って確認し、適用する' }),
        h('li', { text: '会議のあとは「議事録の取込」、節目ごとに「レビュー」を回す' }))));
  }

  renderDashboard(root, app, ledger);

  // 次にやること（説明用の表示では出さない）
  if (!store.presentation) {
    const findings = app.health();
    root.appendChild(h('div', { class: 'row' },
      h('h3', { text: '次にやること' }),
      h('span', { class: 'spacer' }),
      findings.length > 5 ? h('button', { class: 'btn small', type: 'button', onclick: () => app.go('health') }, `健康診断をすべて見る（${findings.length}件）`) : null));
    root.appendChild(findings.length
      ? h('div', { class: 'card next-actions' }, findings.slice(0, 5).map((f) => findingRow(f, app)))
      : h('div', { class: 'card empty', text: '健康診断の指摘はありません' }));
  }

  // 種別ごとの件数（押すと一覧をその種別で開く。説明用の表示でも出す）
  const stats = LEDGER_KINDS.map((kd) => {
    const items = ledger.items.filter((it) => it.kind === kd);
    const open = items.filter(isOpen).length;
    return h('button', {
      class: 'card stat', type: 'button', 'data-kind': kd,
      onclick: () => app.go('list', { filter: { kind: kd } }),
    },
    h('span', { class: 'num', text: String(items.length) }),
    h('span', { class: 'lab', text: kindLabel(kd) + (kd === 'issue' || kd === 'question' ? `（未完了 ${open}）` : '') }));
  });
  root.appendChild(h('h3', { text: '件数' }));
  root.appendChild(h('div', { class: 'grid cols-4' }, stats));
}
