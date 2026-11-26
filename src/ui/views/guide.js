// 使い方: 左の目次と右の本文。文章は core/guide-text.js、画面の一覧は core/screens.js、指示文の名前は PURPOSES から引く

import { GROUPS, SCREENS, hiddenScreenInPresentation } from '../../core/screens.js';
import { INTRO, FIRST_STEPS, ROUND_TRIP, ROUND_TRIP_TIPS, PHASES, SCREEN_HELP, FAQ, TERMS } from '../../core/guide-text.js';
import { PURPOSES } from '../../core/prompts.js';
import { h } from '../dom.js';
import { store } from '../store.js';

const CHAPTERS = [
  { id: 'g-intro', title: 'はじめに' },
  { id: 'g-first', title: '最初の 10 分' },
  { id: 'g-round', title: 'Gemini との往復' },
  { id: 'g-phases', title: '案件の進め方' },
  { id: 'g-screens', title: '画面ごとの説明' },
  { id: 'g-faq', title: 'よくある困りごと' },
  { id: 'g-terms', title: '用語' },
];

const screenOf = (id) => SCREENS.find((s) => s.id === id);
// 説明用の表示では、隠れる画面と道具の指示文の案内を出さない
const showScreen = (id) => !(store.presentation && hiddenScreenInPresentation(screenOf(id)));
const showPurposes = () => !store.presentation;

// 「この画面を開く」。開けないときは押せず、理由を出す
function openButton(app, id, label) {
  const c = app.canOpen(id);
  return h('span', { class: 'open-wrap' },
    h('button', { class: 'btn small', type: 'button', 'data-fk': 'go-' + id + '-' + label.length, disabled: !c.ok, title: c.ok ? '' : c.reason, onclick: () => app.go(id) }, label),
    c.ok ? null : h('span', { class: 'muted small', text: c.reason }));
}

function purposeButton(app, pid) {
  const p = PURPOSES.find((x) => x.id === pid);
  const c = app.canOpen('prompts');
  return h('li', { class: 'purpose-item' },
    h('strong', { text: p ? p.label : pid }), ' ', h('span', { class: 'small muted', text: p ? p.desc : '' }), ' ',
    h('button', { class: 'btn small', type: 'button', 'data-fk': 'purpose-' + pid, disabled: !c.ok, title: c.ok ? '' : c.reason, onclick: () => app.go('prompts', { purpose: pid }) }, 'この指示文を開く'));
}

// 「この指示文を開く」（開けないときは理由も出す）
function purposeOpen(app, pid) {
  const c = app.canOpen('prompts');
  return h('span', { class: 'open-wrap' },
    h('button', { class: 'btn small', type: 'button', 'data-fk': 'flow-purpose-' + pid, disabled: !c.ok, title: c.ok ? '' : c.reason, onclick: () => app.go('prompts', { purpose: pid }) }, 'この指示文を開く'),
    c.ok ? null : h('span', { class: 'muted small', text: c.reason }));
}

// 番号つきのカードと矢印の流れ図
function flow(steps, app) {
  const out = [];
  steps.forEach((st, i) => {
    if (i) out.push(h('div', { class: 'flow-arrow', 'aria-hidden': 'true', text: '→' }));
    out.push(h('div', { class: 'flow-card', role: 'group', 'aria-label': `手順 ${i + 1}` },
      h('div', { class: 'flow-num', text: String(i + 1) }),
      h('div', { class: 'flow-title', text: st.title }),
      h('p', { class: 'flow-desc', text: st.desc }),
      app && st.screen ? openButton(app, st.screen, 'この画面を開く') : null,
      app && st.purpose && showPurposes() ? purposeOpen(app, st.purpose) : null));
  });
  return h('div', { class: 'flow' }, out);
}

function chapter(id, title, ...children) {
  return h('section', { class: 'guide-chapter', id, 'aria-labelledby': id + '-h' }, h('h2', { id: id + '-h', text: title }), ...children);
}

export function renderGuide(root, app) {
  const toc = h('nav', { class: 'guide-toc', 'aria-label': '使い方の目次' },
    h('div', { class: 'small muted', text: '目次' }),
    CHAPTERS.map((c, i) => h('button', { type: 'button', class: 'toc-item', 'data-fk': 'toc-' + c.id, onclick: () => {
      const el = document.getElementById(c.id);
      if (el) { el.scrollIntoView({ block: 'start' }); el.querySelector('h2').setAttribute('tabindex', '-1'); el.querySelector('h2').focus({ preventScroll: true }); }
    } }, `${i + 1}. ${c.title}`)));

  const body = h('div', { class: 'guide-body' });

  // 1 はじめに
  body.appendChild(chapter('g-intro', '1. はじめに',
    h('p', { class: 'guide-lead', text: INTRO.lead }),
    h('div', { class: 'grid cols-3 guide-points' }, INTRO.points.map((p) => h('div', { class: 'card' }, h('h3', { text: p.title }), h('p', { class: 'small', text: p.desc })))),
    h('h3', { text: 'データの扱い' }),
    h('ul', { class: 'guide-list' }, INTRO.data.map((d) => h('li', { text: d })))));

  // 2 最初の 10 分
  body.appendChild(chapter('g-first', '2. 最初の 10 分',
    h('p', { class: 'small muted', text: '初めて使うときは、この順に進めます。' }),
    flow(FIRST_STEPS, app)));

  // 3 往復
  body.appendChild(chapter('g-round', '3. Gemini・NotebookLM との往復',
    h('p', { class: 'small muted', text: 'このツールでの作業は、ほぼすべてこの往復でできています。会議の後・資料が届いたとき・レビューのときも同じ流れです。' }),
    flow(ROUND_TRIP, null),
    h('h3', { text: 'うまくいかないとき' }),
    h('div', { class: 'grid cols-3' }, ROUND_TRIP_TIPS.map((t) => h('div', { class: 'card tip' }, h('h4', { text: t.title }), h('p', { class: 'small', text: t.desc }))))));

  // 4 案件の進め方
  body.appendChild(chapter('g-phases', '4. 案件の進め方',
    h('p', { class: 'small muted', text: '段階ごとに、主に使う画面と指示文です。順番どおりでなくてもかまいません。' }),
    h('div', { class: 'phases' }, PHASES.map((ph, i) => h('section', { class: 'card phase', id: 'phase-' + ph.id },
      h('div', { class: 'row' }, h('span', { class: 'phase-num', text: String(i + 1) }), h('h3', { text: ph.title })),
      h('p', { class: 'small', text: ph.desc }),
      h('div', { class: 'phase-cols' },
        h('div', null, h('h4', { text: '使う画面' }),
          h('ul', { class: 'guide-list' }, ph.screens.filter(showScreen).map((sid) => h('li', null, h('strong', { text: screenOf(sid).label }), ' ', openButton(app, sid, '開く'))))),
        showPurposes() ? h('div', null, h('h4', { text: '使う指示文' }), h('ul', { class: 'guide-list' }, ph.purposes.map((pid) => purposeButton(app, pid)))) : null))))));

  // 5 画面ごとの説明
  const groups = GROUPS.filter((g) => g.id !== 'help');
  body.appendChild(chapter('g-screens', '5. 画面ごとの説明',
    h('p', { class: 'small muted', text: '上段の分類ごとに並べています。' }),
    groups.map((g) => {
      const list = SCREENS.filter((s) => s.group === g.id && showScreen(s.id));
      if (!list.length) return null;
      return h('section', { class: 'screen-group' },
        h('h3', { text: g.label }),
        h('div', { class: 'table-wrap' }, h('table', { class: 'list guide-table' },
          h('thead', null, h('tr', null, ['画面', '何ができるか', 'いつ使うか', ''].map((t) => h('th', { scope: 'col', text: t })))),
          h('tbody', null, list.map((s) => {
            const help = SCREEN_HELP[s.id] || { what: '説明準備中', when: '' };
            return h('tr', { class: 'nocursor', 'data-screen': s.id },
              h('td', null, h('strong', { text: s.label })),
              h('td', { class: 'wrap small', text: help.what }),
              h('td', { class: 'wrap small', text: help.when }),
              h('td', null, openButton(app, s.id, 'この画面を開く')));
          })))));
    })));

  // 6 よくある困りごと
  body.appendChild(chapter('g-faq', '6. よくある困りごと',
    h('div', { class: 'faq' }, FAQ.map((f) => h('details', { class: 'card faq-item' }, h('summary', { text: f.q }), h('p', { class: 'small', text: f.a }))))));

  // 7 用語
  body.appendChild(chapter('g-terms', '7. 用語',
    h('dl', { class: 'terms' }, TERMS.flatMap((t) => [h('dt', { text: t.term }), h('dd', { text: t.desc })]))));

  root.appendChild(h('div', { class: 'guide' }, toc, body));
}
