// ヒヤリング画面: 会議を選ぶ → ヒヤリングシート（その会議で聞く質問）→ その場で回答。候補を会議に割り当てる

import { KINDS, enumLabel, statusLabel } from '../../core/schema.js';
import { hearingCandidates } from '../../core/hearing.js';
import { h, toast, todayStr } from '../dom.js';
import { store } from '../store.js';
import { idButton, itemTitle, statusBadge } from '../detail.js';

const hearingState = { meetingId: null, picked: new Set(), drafts: {} };
const TYPE_VALUES = KINDS.meeting.fields.meetingType.values;

function meetings(ledger) {
  return ledger.items.filter((it) => it.kind === 'meeting').sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id.localeCompare(a.id));
}

// 既定の会議: 今日以降で最も近い予定の会議、無ければ最も新しい会議
function defaultMeeting(list, today) {
  const upcoming = list.filter((m) => m.status === 'planned' && m.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  return (upcoming[0] || list[0] || {}).id || null;
}

function addMeetingForm(app) {
  const title = h('input', { type: 'text', id: 'mt-title', placeholder: '例: 第3回ヒヤリング（経理）', 'aria-label': '会議名' });
  const date = h('input', { type: 'date', id: 'mt-date', 'aria-label': '日付', value: todayStr() });
  const type = h('select', { id: 'mt-type', 'aria-label': '種類' }, TYPE_VALUES.map((t) => h('option', { value: t.v, selected: t.v === 'hearing', text: t.label })));
  return h('details', { class: 'card small' },
    h('summary', { text: '会議を追加する' }),
    h('div', { class: 'row' }, title, date, type,
      h('button', { class: 'btn', type: 'button', id: 'mt-add', onclick: () => {
        if (!title.value.trim()) { toast('会議名を入れてください'); return; }
        const r = store.applyLocal([{ op: 'add', item: { kind: 'meeting', title: title.value.trim(), date: date.value, meetingType: type.value, confidence: 'fact', sources: [{ type: 'other', ref: 'ヒヤリング画面で追加' }] } }], 'hearing');
        if (!r.ok) { toast(r.errors.join(' / ')); return; }
        hearingState.meetingId = r.ledger.items.at(-1).id;
        toast('会議を追加しました（取り消し可）');
        app.refresh();
      } }, '追加')));
}

function sheetRow(q, meeting, app) {
  const ledger = store.view();
  const answered = q.status !== 'open';
  const draft = hearingState.drafts[q.id] ?? q.answer ?? '';
  const ta = h('textarea', { rows: '2', 'data-fk': 'ans-' + q.id, 'aria-label': `${q.title} の回答`, placeholder: 'その場で回答を書く' });
  ta.value = draft;
  ta.addEventListener('input', () => { hearingState.drafts[q.id] = ta.value; });
  const save = () => {
    const ans = ta.value.trim();
    if (!ans) { toast('回答を書いてください'); ta.focus(); return; }
    const r = store.applyLocal([{ op: 'update', id: q.id, set: { answer: ans, status: 'answered', askedAt: q.askedAt || meeting.date || todayStr() } }], 'hearing');
    if (!r.ok) { toast(r.errors.join(' / ')); return; }
    delete hearingState.drafts[q.id];
    toast('回答済みにしました（取り消し可）');
  };
  return h('li', { class: ['sheet-item', answered && 'answered'], 'data-id': q.id },
    h('div', { class: 'row' },
      idButton(q.id, app), statusBadge(q.kind, q.status),
      h('strong', { class: 'sheet-title', text: q.title }),
      q.askTo ? h('span', { class: 'muted small', text: '質問先: ' + (itemTitle(q.askTo, ledger) || q.askTo) }) : h('span', { class: 'badge mid', text: '質問先なし' }),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn small', type: 'button', 'data-fk': 'unassign-' + q.id, onclick: () => {
        const r = store.applyLocal([{ op: 'update', id: q.id, set: { meeting: null } }], 'hearing');
        toast(r.ok ? 'このシートから外しました（取り消し可）' : r.errors.join(' / '));
      } }, 'シートから外す')),
    q.body ? h('p', { class: 'small body-text', text: q.body }) : null,
    answered
      ? h('p', { class: 'answer' }, h('span', { class: 'muted small', text: `回答（${q.askedAt || '日付不明'}）: ` }), q.answer || '（回答の記録なし）')
      : h('div', { class: 'row' }, ta, h('button', { class: 'btn primary small', type: 'button', 'data-fk': 'save-' + q.id, onclick: save }, '回答済みにする')));
}

export function renderHearing(root, app) {
  const ledger = store.view();
  const today = todayStr();
  const list = meetings(ledger);
  if (!hearingState.meetingId || !list.some((m) => m.id === hearingState.meetingId)) hearingState.meetingId = defaultMeeting(list, today);

  root.appendChild(h('h2', { text: 'ヒヤリング' }));
  root.appendChild(addMeetingForm(app));

  if (!list.length) {
    root.appendChild(h('div', { class: 'empty', text: 'まだ会議がありません。上の「会議を追加する」から作るか、議事録を取り込んでください。' }));
  } else {
    const sel = h('select', { id: 'hearing-meeting', 'aria-label': '会議を選ぶ' },
      list.map((m) => h('option', { value: m.id, selected: m.id === hearingState.meetingId, text: `${m.date}　${m.title}（${enumLabel(TYPE_VALUES, m.meetingType)}・${statusLabel('meeting', m.status)}）` })));
    sel.addEventListener('change', () => { hearingState.meetingId = sel.value; hearingState.picked = new Set(); app.refresh(); });
    const m = list.find((x) => x.id === hearingState.meetingId);
    const sheet = ledger.items.filter((it) => it.kind === 'question' && it.meeting === m.id);
    const open = sheet.filter((q) => q.status === 'open').length;

    root.appendChild(h('section', { class: 'card stack' },
      h('div', { class: 'row' }, h('label', { class: 'row' }, '会議', sel), idButton(m.id, app)),
      h('div', { class: 'small row' },
        h('span', { class: 'muted', text: '出席者:' }),
        (m.attendees || []).length ? m.attendees.map((id) => idButton(id, app, { withTitle: true })) : h('span', { class: 'muted', text: '未登録' })),
      (m.agenda || []).length ? h('div', { class: 'small' }, h('span', { class: 'muted', text: '議題: ' }), m.agenda.join(' ／ ')) : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', id: 'hearing-minutes', onclick: () => app.go('prompts', { purpose: 'minutes', meetingId: m.id }) }, 'この会議の議事録の指示文を作る'),
        m.status === 'planned' ? h('button', { class: 'btn', type: 'button', id: 'hearing-held', onclick: () => {
          const r = store.applyLocal([{ op: 'update', id: m.id, set: { status: 'held' } }], 'hearing');
          toast(r.ok ? '開催済みにしました（取り消し可）' : r.errors.join(' / '));
        } }, '開催済みにする') : null)));

    root.appendChild(h('h3', { text: `ヒヤリングシート（${sheet.length}件 ／ 未回答 ${open}件）` }));
    root.appendChild(sheet.length
      ? h('ol', { class: 'sheet stack', id: 'hearing-sheet' }, sheet.map((q) => sheetRow(q, m, app)))
      : h('p', { class: 'muted', text: 'この会議で聞く質問はまだありません。下の候補から割り当ててください。' }));

    // 候補
    const cands = hearingCandidates(ledger, today);
    const label = { question: '未割り当ての質問', gap: '台帳の空欄', nfr: '非機能の未着手' };
    root.appendChild(h('h3', { text: `次のヒヤリングの候補（${cands.length}件）` }));
    if (!cands.length) {
      root.appendChild(h('p', { class: 'muted', text: '候補はありません。' }));
    } else {
      const items = cands.map((c) => h('li', { class: 'row cand' },
        h('input', { type: 'checkbox', id: 'cand-' + c.key.replace(/[^A-Za-z0-9_-]/g, '_'), 'data-fk': 'cand-' + c.key, checked: hearingState.picked.has(c.key), 'aria-label': c.text,
          onchange: (e) => { if (e.target.checked) hearingState.picked.add(c.key); else hearingState.picked.delete(c.key); app.refresh(); } }),
        h('span', { class: 'badge', text: label[c.type] }),
        h('span', { class: 'cand-text', text: c.text }),
        c.type !== 'nfr' ? idButton(c.ref, app) : null));
      root.appendChild(h('ul', { class: 'cand-list stack', id: 'hearing-cands' }, items));
      const n = cands.filter((c) => hearingState.picked.has(c.key)).length;
      root.appendChild(h('div', { class: 'row' },
        h('button', { class: 'btn small', type: 'button', onclick: () => { hearingState.picked = new Set(cands.map((c) => c.key)); app.refresh(); } }, 'すべて選ぶ'),
        h('button', { class: 'btn primary', type: 'button', id: 'hearing-assign', disabled: n === 0, onclick: () => {
          const ops = cands.filter((c) => hearingState.picked.has(c.key)).flatMap((c) => c.ops(m.id));
          const r = store.applyLocal(ops, 'hearing');
          if (!r.ok) { toast(r.errors.join(' / ')); return; }
          hearingState.picked = new Set();
          toast(`${n}件をこの会議に割り当てました（取り消し可）`);
        } }, `選んだ ${n} 件をこの会議に割り当てる`)));
    }
  }
}
