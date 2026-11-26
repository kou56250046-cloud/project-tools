// P6c T1: 議事録の前処理（gemini-kit の clean.js を写したもの）。テストも gemini-kit と同じ中身
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TRANSCRIPT } from '../src/core/transcript.js';
import { decodeBytes } from '../src/core/csv.js';

const LINE = /^(\d{1,2}:\d{2}(:\d{2})? )?[^｜\s][^｜]*｜.+$/;
const minutes = (f) => decodeBytes(readFileSync(new URL(`./fixtures/minutes/${f}`, import.meta.url)));

test('前処理: Teams（VTT）・Teams（時刻つき）・Meet・見出し形式・Shift_JIS を 1 行 1 発言にそろえる', () => {
  const cases = [
    ['2026-10-20_第1回_キックオフ.vtt', 'Teams（VTT）', 'utf-8'],
    ['2026-11-04_第2回_定例.txt', 'Teams（時刻つき）', 'utf-8'],
    ['2026-11-12_第3回_定例_meet.txt', 'Meet', 'utf-8'],
    ['teams-header.txt', 'Teams（話者と時刻の見出し）', 'utf-8'],
    ['cp932-speaker.txt', '話者:本文', 'shift_jis'],
  ];
  for (const [f, format, enc] of cases) {
    const { text, encoding } = minutes(f);
    assert.equal(encoding, enc, f);
    const r = TRANSCRIPT.clean(text);
    assert.equal(r.format, format, f);
    for (const l of r.lines.filter((x) => !x.raw)) assert.match(`${l.t ? l.t + ' ' : ''}${l.speaker}｜${l.text}`, LINE, f);
    assert.ok(r.stats.rate >= 0.8, `${f} の判定率 ${r.stats.rate}`);
    assert.doesNotMatch(r.out, /えー|あのー|えっと/, `${f} につなぎ言葉が残っている`);
  }
});

test('前処理: 「あの件」は消さず、折り返しの行は前の発言につなぎ、見出しは本文のまま残す', () => {
  const r = TRANSCRIPT.clean(minutes('2026-11-04_第2回_定例.txt').text);
  assert.match(r.out, /佐藤 健｜あの件ですが、稼働は来年 10 月ではなく、 4 月に前倒し/);
  assert.ok(r.raw.includes('議題メモ：次回までに現行の帳票一覧を共有'));
  const h = TRANSCRIPT.clean(minutes('teams-header.txt').text);
  assert.match(h.out, /^0:15 田中 一郎｜FAX の枚数は、 1 日何枚くらいでしょうか。$/m);
});
