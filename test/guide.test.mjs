// 使い方タブ T1: 画面の表と説明の表がずれていないか
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCREENS, GROUPS, NO_LEDGER_OK } from '../src/core/screens.js';
import { SCREEN_HELP, PHASES, FIRST_STEPS, FAQ, TERMS } from '../src/core/guide-text.js';
import { PURPOSES } from '../src/core/prompts.js';

const ids = new Set(SCREENS.map((s) => s.id));
const purposeIds = new Set(PURPOSES.map((p) => p.id));

test('すべての画面に説明がある（説明だけ残った画面も無い）', () => {
  for (const s of SCREENS) assert.ok(SCREEN_HELP[s.id], `説明が無い: ${s.id}`);
  for (const id of Object.keys(SCREEN_HELP)) assert.ok(ids.has(id), `画面に無い説明: ${id}`);
});

test('画面の分類はすべて定義されている', () => {
  const g = new Set(GROUPS.map((x) => x.id));
  for (const s of SCREENS) assert.ok(g.has(s.group), s.id);
  for (const id of NO_LEDGER_OK) assert.ok(ids.has(id), id);
});

test('案件の進め方と最初の手順が指す画面・指示文はすべて実在する', () => {
  for (const ph of PHASES) {
    for (const s of ph.screens) assert.ok(ids.has(s), `${ph.id}: 画面 ${s}`);
    for (const p of ph.purposes) assert.ok(purposeIds.has(p), `${ph.id}: 指示文 ${p}`);
  }
  for (const st of FIRST_STEPS) {
    if (st.screen) assert.ok(ids.has(st.screen), st.title);
    if (st.purpose) assert.ok(purposeIds.has(st.purpose), st.title);
  }
  assert.equal(FIRST_STEPS.length, 4);
});

test('よくある困りごと 10 件以上・用語 10 語以上', () => {
  assert.ok(FAQ.length >= 10);
  assert.ok(TERMS.length >= 10);
});
