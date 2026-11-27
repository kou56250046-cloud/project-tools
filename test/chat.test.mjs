// P6c T1: チャットの読み取り（design.md の例の表がテストの期待値）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChat, linesToBody, bodyToLines } from '../src/core/chat.js';

const TODAY = '2026-11-26';
const p = (text) => parseChat(text, { today: TODAY });

test('例の表: 角かっこの日時', () => {
  const r = p('[2026/11/20 10:23] 山田 太郎: 了解です');
  assert.equal(r.format, 'bracket');
  assert.deepEqual(r.lines, [{ at: '2026-11-20 10:23', speaker: '山田 太郎', text: '了解です' }]);
});

test('例の表: 名前と時刻の見出し（日付の行・本文の続き・編集済み）', () => {
  const r = p('11月20日 (木)\n山田 太郎  10:23\n明日の件\nよろしく\n編集済み');
  assert.equal(r.format, 'header');
  assert.deepEqual(r.lines, [{ at: '2026-11-20 10:23', speaker: '山田 太郎', text: '明日の件 よろしく' }]);
  assert.equal(r.dropped, 1);
  assert.equal(r.from, '2026-11-20');
});

test('例の表: 名前・時刻・本文の 3 行（リアクションの行を落とす）', () => {
  const r = p('山田 太郎\n10:23\n資料を送りました\n👍 2');
  assert.equal(r.format, 'three');
  assert.deepEqual(r.lines, [{ at: '10:23', speaker: '山田 太郎', text: '資料を送りました' }]);
  assert.equal(r.dropped, 1);
});

test('例の表: 話者:本文', () => {
  const r = p('山田：確認します\n佐藤：お願いします');
  assert.equal(r.format, 'speaker');
  assert.deepEqual(r.lines, [{ at: '', speaker: '山田', text: '確認します' }, { at: '', speaker: '佐藤', text: 'お願いします' }]);
});

test('例の表: 読めない貼り付けは unknown で、行はそのまま残る', () => {
  const r = p('こんにちは\nよろしく');
  assert.equal(r.format, 'unknown');
  assert.equal(r.unparsed, 2);
  assert.deepEqual(r.lines.map((l) => [l.text, l.raw]), [['こんにちは', true], ['よろしく', true]]);
});

test('今日・昨日・年の無い日付・12 月から 1 月をまたぐ・午前午後', () => {
  let r = parseChat('昨日\n鈴木 一  午後 3:05\n了解\n今日\n鈴木 一  午前 12:10\nおはよう', { today: '2026-11-26' });
  assert.deepEqual(r.lines.map((l) => l.at), ['2026-11-25 15:05', '2026-11-26 00:10']);
  r = parseChat('12月28日\n鈴木 一  9:00\n年末\n1月5日\n鈴木 一  9:00\n年始', { today: '2027-01-06' });
  assert.deepEqual(r.lines.map((l) => l.at), ['2026-12-28 09:00', '2027-01-05 09:00']);
  assert.equal(r.from, '2026-12-28');
  assert.equal(r.to, '2027-01-05');
});

test('話者:本文の形でないチャットの「注意：…」は発言の始まりにならない', () => {
  const r = p('山田 太郎  10:23\n注意：明日は休みです\n佐藤 花子  10:30\n承知しました');
  assert.equal(r.format, 'header');
  assert.deepEqual(r.lines.map((l) => [l.speaker, l.text]), [['山田 太郎', '注意：明日は休みです'], ['佐藤 花子', '承知しました']]);
});

test('本文と lines の行き来（空白のある名前・日時・時刻なし・本文の中の ｜・読めない行）', () => {
  const lines = [
    { at: '2026-11-20 10:23', speaker: '山田 太郎', text: 'A案｜B案で比べる' },
    { at: '0:03:12', speaker: '佐藤', text: '前処理の時刻' },
    { at: '', speaker: '鈴木 一', text: '時刻なし' },
    { at: '', speaker: '', text: '読めない行', raw: true },
  ];
  const body = linesToBody(lines);
  assert.equal(body, '2026-11-20 10:23 山田 太郎｜A案｜B案で比べる\n0:03:12 佐藤｜前処理の時刻\n鈴木 一｜時刻なし\n読めない行');
  assert.deepEqual(bodyToLines(body), [
    { at: '2026-11-20 10:23', speaker: '山田 太郎', text: 'A案｜B案で比べる' },
    { at: '0:03:12', speaker: '佐藤', text: '前処理の時刻' },
    { at: '', speaker: '鈴木 一', text: '時刻なし' },
    { text: '読めない行' },
  ]);
});

test('名前と時刻の見出しの直後の行は、末尾が時刻でも本文として読む（FIX-007）', () => {
  const r = parseChat('山田 太郎 10:00\n集合は 9:30\n佐藤 花子 10:05\n了解です', { today: '2026-11-26' });
  assert.equal(r.format, 'header');
  assert.deepEqual(r.lines.map((x) => [x.speaker, x.text]), [['山田 太郎', '集合は 9:30'], ['佐藤 花子', '了解です']]);
});
