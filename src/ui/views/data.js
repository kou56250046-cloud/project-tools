// データ設計: ER 図・テーブル定義・DDL（方言を選んでコピー）・物理名の点検

import { settingOf, enumLabel, LOGICAL_TYPES, SETTINGS } from '../../core/schema.js';
import { layoutEr, ER } from '../../core/erlayout.js';
import { generateDdl, lintNames, DIALECTS } from '../../core/ddl.js';
import { h, s, toast, copyText } from '../dom.js';
import { store } from '../store.js';
import { idButton } from '../detail.js';

// 文字幅の概算で箱に収まるように切る（全角 12.5px・半角 7px）
function clipText(str, maxW) {
  let w = 0;
  let out = '';
  for (const ch of String(str)) {
    w += ch.charCodeAt(0) > 0xff ? 12.5 : 7;
    if (w > maxW - 10) return out + '…';
    out += ch;
  }
  return out;
}

function erSvg(L, selectedId, app) {
  const svg = s('svg', { class: 'chart er', width: L.width, height: L.height, viewBox: `0 0 ${L.width} ${L.height}`, role: 'img', 'aria-label': 'ER 図' });
  svg.appendChild(s('defs', null, s('marker', { id: 'er-arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' }, s('path', { d: 'M0,0 L10,5 L0,10 z', class: 'er-head' }))));
  for (const ln of L.lines) {
    const d = ln.points.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
    svg.appendChild(s('path', { class: ['er-line', (ln.from === selectedId || ln.to === selectedId) && 'hl'].filter(Boolean).join(' '), d, 'marker-end': 'url(#er-arrow)' }, s('title', null, `${ln.from}.${ln.column} → ${ln.to}`)));
  }
  for (const b of L.boxes) {
    const g = s('g', {
      class: ['er-box', b.id === selectedId && 'selected', b.external && 'external'].filter(Boolean).join(' '),
      transform: `translate(${b.x},${b.y})`, tabindex: '0', role: 'button', 'data-id': b.id, 'aria-label': `${b.title}（${b.physicalName}）`,
      onclick: () => app.openItem(b.id),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); app.openItem(b.id); } },
    },
    s('rect', { class: 'er-frame', width: b.w, height: b.h, rx: 4 }),
    s('rect', { class: 'er-head-bg', width: b.w, height: ER.HEAD }),
    s('title', null, `${b.title}（${b.physicalName}）${b.external ? '・外部参照' : ''}`),
    s('text', { class: 'er-title', x: 8, y: 17 }, clipText(`${b.external ? '[外部] ' : ''}${b.title}（${b.physicalName}）`, b.w - 16)));
    b.rows.forEach((r, i) => {
      const y = ER.HEAD + i * ER.ROW + 13;
      g.appendChild(s('text', { class: ['er-col', r.pk && 'pk'].filter(Boolean).join(' '), x: 8, y }, `${r.pk ? '🔑 ' : r.fk ? '↗ ' : '　'}${r.name}`));
      g.appendChild(s('text', { class: 'er-type', x: b.w - 8, y, 'text-anchor': 'end' }, r.type || ''));
    });
    if (b.more) g.appendChild(s('text', { class: 'er-type', x: 8, y: ER.HEAD + b.rows.length * ER.ROW + 13 }, `…ほか ${b.more} 列`));
    svg.appendChild(g);
  }
  return svg;
}

function tableDef(e, app) {
  const cols = e.columns || [];
  const thead = h('thead', null, h('tr', null, ['物理名', '論理名', '型', '桁', 'PK', '必須', '外部キー', 'コードの形', '補足'].map((t) => h('th', { scope: 'col', text: t }))));
  const tbody = h('tbody', null, cols.map((c) => h('tr', { class: 'nocursor' },
    h('td', { class: 'mono small', text: c.name }),
    h('td', { class: 'small', text: c.logical || '' }),
    h('td', { class: 'small', text: enumLabel(LOGICAL_TYPES, c.type) }),
    h('td', { class: 'small num', text: c.length ? `${c.length}${c.scale ? ',' + c.scale : ''}` : '' }),
    h('td', { class: 'small', text: c.pk ? '○' : '' }),
    h('td', { class: 'small', text: c.required || c.pk ? '○' : '' }),
    h('td', { class: 'small' }, c.fk ? [idButton(c.fk.entity, app), `.${c.fk.column}`] : ''),
    h('td', { class: 'mono small', text: c.pattern || '' }),
    h('td', { class: 'small wrap', text: c.note || '' }))));
  return h('section', { class: 'card stack', id: 'table-def' },
    h('div', { class: 'row' }, h('h3', { text: `テーブル定義: ${e.title}（${e.physicalName}）` }), idButton(e.id, app),
      h('span', { class: 'badge', text: e.fileType === 'external' ? '外部参照' : '自システム' }), e.master ? h('span', { class: 'badge accent', text: 'マスタ' }) : null),
    cols.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'list' }, thead, tbody)) : h('p', { class: 'muted', text: '列がまだありません' }));
}

export function renderData(root, app) {
  const ledger = store.view();
  const ents = ledger.items.filter((it) => it.kind === 'entity' && it.status !== 'dropped');
  root.appendChild(h('div', { class: 'row' },
    h('h2', { text: 'データ設計' }),
    h('span', { class: 'spacer' }),
    store.presentation ? null : h('button', { class: 'btn', type: 'button', onclick: () => app.go('prompts', { purpose: 'data-design' }) }, 'データ設計の指示文へ')));
  if (!ents.length) { root.appendChild(h('div', { class: 'empty', text: 'まだテーブルがありません。「データ設計」の指示文で、要件からテーブルを作らせてください。' })); return; }

  const sel = store.selectedId && ents.some((e) => e.id === store.selectedId) ? store.selectedId : null;
  root.appendChild(h('p', { class: 'muted small', text: '左が参照される側、右が参照する側です（矢印は外部キーの向き）。箱を押すとテーブル定義が下に出ます。🔑 は主キー、↗ は外部キーの列です。' }));
  root.appendChild(h('div', { class: 'chart-wrap graph-wrap', id: 'er-wrap' }, erSvg(layoutEr(ledger), sel, app)));
  if (sel) root.appendChild(tableDef(ents.find((e) => e.id === sel), app));

  // 物理名の点検
  const dialect = settingOf(ledger, 'ddlDialect');
  const naming = settingOf(ledger, 'namingCase');
  const lint = lintNames(ledger, dialect, naming);
  root.appendChild(h('section', { class: 'card stack', id: 'name-lint' },
    h('h3', { text: `物理名の点検（${lint.length}件）` }),
    lint.length ? h('ul', { class: 'ref-list' }, lint.map((x) => h('li', null, idButton(x.itemId, app), h('span', { text: x.message })))) : h('p', { class: 'muted small', text: '問題はありません' })));

  // DDL
  const pick = (key, values) => {
    const el = h('select', { id: 'ddl-' + key, 'aria-label': SETTINGS[key].label }, values.map((v) => h('option', { value: v.v, selected: v.v === settingOf(ledger, key), text: v.label })));
    el.addEventListener('change', () => {
      if (store.presentation) return;
      const r = store.updateSettings({ [key]: el.value });
      if (!r.ok) toast(r.errors.join(' / '));
    });
    return el;
  };
  const ddl = generateDdl(ledger, dialect, naming);
  const ta = h('textarea', { id: 'ddl-text', rows: '16', readonly: true, 'aria-label': 'DDL' });
  ta.value = ddl;
  root.appendChild(h('section', { class: 'card stack' },
    h('div', { class: 'row' }, h('h3', { text: 'DDL' }), h('span', { class: 'spacer' }),
      h('label', { class: 'row small' }, '方言', pick('ddlDialect', DIALECTS)),
      h('label', { class: 'row small' }, '大文字・小文字', pick('namingCase', SETTINGS.namingCase.values)),
      h('button', { class: 'btn primary', type: 'button', id: 'ddl-copy', onclick: async () => { const ok = await copyText(ddl); toast(ok ? 'DDL をコピーしました' : 'コピーできませんでした'); } }, 'コピー')),
    h('p', { class: 'muted small', text: '方言と大文字・小文字は案件の設定として保存します。外部参照のテーブルは作成しません。' }),
    ta));
}
