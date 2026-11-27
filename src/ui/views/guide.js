// 使い方: 左の目次と右の本文。文章は core/guide-text.js、進み具合は core/guide-flow.js、画面の一覧は core/screens.js、指示文の名前は PURPOSES から引く
// 全体の流れは gemini-kit の使い方（箱と矢印の 1 周期の図 → 段ごとのカード）にならう

import { GROUPS, SCREENS, hiddenScreenInPresentation } from '../../core/screens.js';
import { INTRO, GUIDE_CHAPTERS, WHERE, FLOW_STEPS, FLOW_EDGES, MEETING_TIMELINE, FLOW_TEXT, ROUND_TRIP_TIPS, SCREEN_HELP, FAQ, TERMS } from '../../core/guide-text.js';
import { stepStatus } from '../../core/guide-flow.js';
import { PURPOSES } from '../../core/prompts.js';
import { h, s } from '../dom.js';
import { store } from '../store.js';

const screenOf = (id) => SCREENS.find((x) => x.id === id);
// 説明用の表示では、隠れる画面と道具の指示文の案内を出さない
const showScreen = (id) => !(store.presentation && hiddenScreenInPresentation(screenOf(id)));
const showPurposes = () => !store.presentation;
// 使う場所の印の色（検査済みのバッジの組み合わせだけを使う。重要度の赤は使わない）
const WHERE_BADGE = { GEM: 'accent', NLM: 'low', TOOL: 'ok', CLIENT: 'mid' };
const whereBadge = (w) => h('span', { class: ['badge', WHERE_BADGE[w]], text: WHERE[w] });

// 「この画面を開く」。開けないときは押せず、理由を出す
function openButton(app, id, label) {
  const c = app.canOpen(id);
  return h('span', { class: 'open-wrap' },
    h('button', { class: 'btn small', type: 'button', 'data-fk': 'go-' + id + '-' + label.length, disabled: !c.ok, title: c.ok ? '' : c.reason, onclick: () => app.go(id) }, label),
    c.ok ? null : h('span', { class: 'muted small', text: c.reason }));
}

// 「この指示文を開く」（開けないときは理由も出す）
function purposeOpen(app, pid, fk) {
  const p = PURPOSES.find((x) => x.id === pid);
  const c = app.canOpen('prompts');
  return h('span', { class: 'open-wrap' },
    h('button', { class: 'btn small', type: 'button', 'data-fk': fk, disabled: !c.ok, title: c.ok ? '' : c.reason, onclick: () => app.go('prompts', { purpose: pid }) }, `指示文「${p ? p.label : pid}」を開く`),
    c.ok ? null : h('span', { class: 'muted small', text: c.reason }));
}

function chapter(i, children) {
  const c = GUIDE_CHAPTERS[i];
  return h('section', { class: 'guide-chapter', id: c.id, 'aria-labelledby': c.id + '-h' },
    h('h2', { id: c.id + '-h', text: `${i + 1}. ${c.title}` }),
    c.lead ? h('p', { class: 'small muted', text: c.lead }) : null,
    ...children);
}

// 段のカードへ移り、見出しにフォーカスする
function focusStep(id) {
  const el = document.getElementById('step-' + id);
  if (!el) return;
  el.scrollIntoView({ block: 'start' });
  const hd = el.querySelector('h3');
  if (hd) hd.focus({ preventScroll: true });
}

// ---- 全体の流れの図（箱の位置は固定。1040 × 520） ----
const BW = 168;
const BH = 56;
const POS = {
  setup: [40, 60], digest: [40, 170], initial: [40, 280],
  import: [260, 80], check: [450, 80], prep: [640, 80],
  minutes: [260, 230], meeting: [640, 230],
  docs: [850, 80],
  baseline: [260, 420], plan: [450, 420], design: [640, 420], test: [830, 420],
};
const LOOP_BOX = { x: 240, y: 30, w: 590, h: 280 };
// 線の形（FLOW_EDGES の from→to ごと）。d は SVG の path、at は名前の位置、rot は名前を縦にするとき
const EDGE_PATHS = {
  'setup>digest': { d: 'M124,116V168' },
  'digest>initial': { d: 'M124,226V278' },
  'setup>initial': { d: 'M40,88H18V308H38', at: [12, 198], rot: true },
  'initial>import': { d: 'M208,308H226V108H258' },
  'import>check': { d: 'M428,108H448' },
  'check>prep': { d: 'M618,108H638' },
  'prep>meeting': { d: 'M724,136V228' },
  'meeting>minutes': { d: 'M640,258H430' },
  'minutes>import': { d: 'M344,230V138', at: [344, 186] },
  'check>baseline': { d: 'M534,136V360H344V418', at: [534, 340] },
  'baseline>plan': { d: 'M428,448H448' },
  'plan>design': { d: 'M618,448H638' },
  'design>test': { d: 'M808,448H828' },
  'check>docs': { d: 'M534,80V14H934V78', at: [760, 14] },
};

function flowDiagram(st) {
  const svg = s('svg', { class: 'fl-svg', viewBox: '0 0 1040 520', width: '1040', height: '520', 'aria-labelledby': 'fl-summary' });
  svg.appendChild(s('defs', null, s('marker', { id: 'fl-arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' },
    s('path', { class: 'fl-arrowhead', d: 'M0,0L10,5L0,10Z' }))));
  // 繰り返しの枠
  svg.appendChild(s('rect', { class: ['fl-loop', st && st.loopActive && 'is-now'], x: LOOP_BOX.x, y: LOOP_BOX.y, width: LOOP_BOX.w, height: LOOP_BOX.h, rx: '18' }));
  // 見出し（青）と補足（灰）は 1 つの行の中で続けて置く。位置を別々に決めると、文字の長さしだいで重なる
  // 線（点検 → 文書づくり）が横切るので、線を描いたあとに、枠の地の色で縁取って重ねる（下の「線」の後で足す）
  const loopText = s('text', { class: 'fl-loop-text', x: '400', y: '58' },
    s('tspan', { class: 'fl-loop-label' }, FLOW_TEXT.loopLabel),
    s('tspan', { class: 'fl-loop-sub', dx: '16' }, FLOW_TEXT.loopSub));
  // 線
  for (const e of FLOW_EDGES) {
    const p = EDGE_PATHS[e.from + '>' + e.to];
    if (!p) continue;
    svg.appendChild(s('path', { class: ['fl-edge', e.back && 'fl-back'], d: p.d, 'marker-end': 'url(#fl-arrow)' }));
    if (e.label && p.at) {
      const [x, y] = p.at;
      const w = e.label.length * 12 + 10;
      const g = s('g', { class: 'fl-elabel', transform: p.rot ? `rotate(-90 ${x} ${y})` : null });
      g.appendChild(s('rect', { x: x - w / 2, y: y - 10, width: w, height: '20', rx: '4' }));
      g.appendChild(s('text', { x, y: y + 4, 'text-anchor': 'middle' }, e.label));
      svg.appendChild(g);
    }
  }
  svg.appendChild(loopText);
  // 箱（FLOW_STEPS の順に足す。Tab で回る順になる）
  for (const step of FLOW_STEPS) {
    const [x, y] = POS[step.id];
    const state = st ? st.status[step.id] : null;
    const mark = state ? FLOW_TEXT.marks[state] : '';
    const where = WHERE[step.where] + (state === 'active' ? '・今ここ' : '');
    const label = (mark ? mark.split(' ')[0] + ' ' : '') + step.label;
    const g = s('g', {
      class: ['fl-node', state && 'fl-' + state, `fl-where-${step.where}`],
      role: 'button', tabindex: '0', 'data-step': step.id,
      'aria-label': `${step.label}（${WHERE[step.where]}${state ? '・' + mark.split(' ').slice(1).join(' ') : ''}）。押すと説明に移ります`,
    });
    g.appendChild(s('rect', { x, y, width: BW, height: BH, rx: step.kind === 'step' ? '8' : String(BH / 2) }));
    g.appendChild(s('text', { class: ['fl-name', label.length > 11 && 'is-long'], x: x + BW / 2, y: y + 24, 'text-anchor': 'middle' }, label));
    g.appendChild(s('text', { class: 'fl-where', x: x + BW / 2, y: y + 44, 'text-anchor': 'middle' }, where));
    const go = () => focusStep(step.id);
    g.addEventListener('click', go);
    g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } });
    svg.appendChild(g);
  }
  return svg;
}

// ---- 段ごとのカード ----
function stepCard(app, step, st, i) {
  const state = st ? st.status[step.id] : null;
  const next = FLOW_STEPS[i + 1];
  const box = (cls, title, items) => h('div', { class: ['fl-frame', cls] }, h('p', { class: 'fl-frame-h', text: title }), h('ul', null, items.map((t) => h('li', { text: t }))));
  const arrow = () => h('span', { class: 'fl-arrow', 'aria-hidden': 'true', text: '→' });
  const screens = step.screens.filter(showScreen);
  return h('section', { class: ['card', 'fl-step', state && 'fl-step-' + state], id: 'step-' + step.id },
    h('div', { class: 'row fl-step-head' },
      h('h3', { tabindex: '-1', text: step.label }),
      whereBadge(step.where),
      state ? h('span', { class: ['badge', state === 'active' && 'accent'], text: FLOW_TEXT.marks[state] }) : null),
    h('div', { class: 'fl-frames', role: 'group', 'aria-label': `${step.label}: 入れるもの・使う場所・出るもの・次に持っていく先` },
      box('fl-in', '入れるもの', step.in), arrow(),
      h('div', { class: 'fl-frame fl-at' }, h('p', { class: 'fl-frame-h', text: '使う場所' }), whereBadge(step.where)), arrow(),
      box('fl-out', '出るもの', step.out), arrow(),
      box('fl-to', '次に持っていく先', [step.to])),
    h('ol', { class: 'fl-how' }, step.how.map((t) => h('li', { text: t }))),
    h('div', { class: 'row fl-actions' },
      screens.map((id) => openButton(app, id, `画面「${screenOf(id).label}」を開く`)),
      showPurposes() ? step.purposes.map((pid) => purposeOpen(app, pid, `step-${step.id}-${pid}`)) : null,
      next ? h('button', { class: 'btn small', type: 'button', 'data-fk': 'next-' + step.id, onclick: () => focusStep(next.id) }, `次の段へ（${next.label}）`) : null));
}

export function renderGuide(root, app) {
  // 進み具合は、台帳を開いているときだけ（説明用の表示では出さない）
  const st = store.ledger && !store.presentation ? stepStatus(store.ledger) : null;

  const toc = h('nav', { class: 'guide-toc', 'aria-label': '使い方の目次' },
    h('div', { class: 'small muted', text: '目次' }),
    GUIDE_CHAPTERS.map((c, i) => h('button', { type: 'button', class: 'toc-item', 'data-fk': 'toc-' + c.id, onclick: () => {
      const el = document.getElementById(c.id);
      if (el) { el.scrollIntoView({ block: 'start' }); el.querySelector('h2').setAttribute('tabindex', '-1'); el.querySelector('h2').focus({ preventScroll: true }); }
    } }, `${i + 1}. ${c.title}`)));

  const body = h('div', { class: 'guide-body' });

  // 1 はじめに
  body.appendChild(chapter(0, [
    h('p', { class: 'guide-lead', text: INTRO.lead }),
    h('div', { class: 'grid cols-3 guide-points' }, INTRO.points.map((p) => h('div', { class: 'card' }, h('h3', { text: p.title }), h('p', { class: 'small', text: p.desc })))),
    h('h3', { text: 'データの扱い' }),
    h('ul', { class: 'guide-list' }, INTRO.data.map((d) => h('li', { text: d })))]));

  // 2 全体の流れ
  const state = !st ? FLOW_TEXT.noLedger : st.loopActive ? FLOW_TEXT.loopNow : (Object.values(st.status).includes('active') ? '' : FLOW_TEXT.allDone);
  body.appendChild(chapter(1, [
    h('ul', { class: 'fl-legend' },
      Object.keys(WHERE).map((w) => h('li', null, whereBadge(w), ' ', FLOW_TEXT.legend[w])),
      st ? h('li', { class: 'small muted', text: Object.values(FLOW_TEXT.marks).join('　') }) : null),
    state ? h('p', { class: ['notice', 'small', st && st.loopActive && 'fl-now'], id: 'fl-state', text: state }) : null,
    h('p', { class: 'small muted', id: 'fl-summary', text: FLOW_TEXT.summary }),
    h('div', { class: 'fl-wrap' }, flowDiagram(st))]));

  // 3 段ごとにやること
  body.appendChild(chapter(2, [h('div', { class: 'fl-steps' }, FLOW_STEPS.map((step, i) => stepCard(app, step, st, i)))]));

  // 4 毎朝と会議の前後
  body.appendChild(chapter(3, [h('div', { class: 'fl-timeline', role: 'group', 'aria-label': GUIDE_CHAPTERS[3].title },
    MEETING_TIMELINE.map((col) => h('div', { class: 'card fl-tl-col' },
      h('p', { class: 'fl-tl-when', text: col.when }),
      h('ul', null, col.items.map(([w, t]) => h('li', null, whereBadge(w), ' ', t))))))]));

  // 5 うまくいかないとき
  body.appendChild(chapter(4, [h('div', { class: 'grid cols-3' }, ROUND_TRIP_TIPS.map((t) => h('div', { class: 'card tip' }, h('h4', { text: t.title }), h('p', { class: 'small', text: t.desc }))))]));

  // 6 画面ごとの説明
  const groups = GROUPS.filter((g) => g.id !== 'help');
  body.appendChild(chapter(5, [groups.map((g) => {
    const list = SCREENS.filter((x) => x.group === g.id && showScreen(x.id));
    if (!list.length) return null;
    return h('section', { class: 'screen-group' },
      h('h3', { text: g.label }),
      h('div', { class: 'table-wrap' }, h('table', { class: 'list guide-table' },
        h('thead', null, h('tr', null, ['画面', '何ができるか', 'いつ使うか', ''].map((t) => h('th', { scope: 'col', text: t })))),
        h('tbody', null, list.map((x) => {
          const help = SCREEN_HELP[x.id] || { what: '説明準備中', when: '' };
          return h('tr', { class: 'nocursor', 'data-screen': x.id },
            h('td', null, h('strong', { text: x.label })),
            h('td', { class: 'wrap small', text: help.what }),
            h('td', { class: 'wrap small', text: help.when }),
            h('td', null, openButton(app, x.id, 'この画面を開く')));
        })))));
  })]));

  // 7 よくある困りごと
  body.appendChild(chapter(6, [h('div', { class: 'faq' }, FAQ.map((f) => h('details', { class: 'card faq-item' }, h('summary', { text: f.q }), h('p', { class: 'small', text: f.a }))))]));

  // 8 用語
  body.appendChild(chapter(7, [h('dl', { class: 'terms' }, TERMS.flatMap((t) => [h('dt', { text: t.term }), h('dd', { text: t.desc })]))]));

  root.appendChild(h('div', { class: 'guide' }, toc, body));
}
