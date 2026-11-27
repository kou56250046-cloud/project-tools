// チャット（Teams・Google Chat の貼り付け）の読み取りと、1 行 1 発言の本文との行き来。DOM に触れない。
// 決まりは .claude/specs/workbench-p6c/design.md の「レビューを受けて決めたこと」の「チャットの読み取り」

const CHAT_TIME = '(?:(?:午前|午後)\\s*)?\\d{1,2}:\\d{2}';
const CHAT_FORMATS = [
  { id: 'bracket', label: '角かっこの日時' },
  { id: 'header', label: '名前と時刻の見出し' },
  { id: 'three', label: '名前・時刻・本文の 3 行' },
  { id: 'speaker', label: '話者:本文' },
];
export const CHAT_FORMAT_LABEL = Object.fromEntries([...CHAT_FORMATS.map((f) => [f.id, f.label]), ['unknown', '判定できない形']]);

const RE_BRACKET = new RegExp(`^\\[(?:(\\d{4})/(\\d{1,2})/(\\d{1,2}) )?(${CHAT_TIME})\\] (.{1,30}?)[:：] ?(.*)$`);
const RE_HEADER = new RegExp(`^(.{1,30}?)[\\s、,]+(?:(\\d{4})/(\\d{1,2})/(\\d{1,2}) )?(${CHAT_TIME})$`);
const RE_TIME_ONLY = new RegExp(`^(${CHAT_TIME})$`);
const RE_SPEAKER = /^(.{0,19}?[^\d\s:：])[:：](.+)$/;
const RE_DATE_LINES = [
  /^(\d{4})年(\d{1,2})月(\d{1,2})日\s*(?:[(（][^)）]*[)）])?$/,
  /^(\d{4})\/(\d{1,2})\/(\d{1,2})\s*(?:[(（][^)）]*[)）])?$/,
  /^()(\d{1,2})月(\d{1,2})日\s*(?:[(（][^)）]*[)）])?$/,
];
// 落とす飾りの行
const DECOR = [
  /^[(（]?編集済み[)）]?$/,
  /^返信$/,
  /^\d+\s*件の返信$/,
  /^既読(\s*\d+)?$/,
  /さんがリアクションしました$/,
  /^[\p{Extended_Pictographic}\u200d\ufe0f]+(\s*\d+)?(\s+[\p{Extended_Pictographic}\u200d\ufe0f]+(\s*\d+)?)*$/u,   // 絵文字とリアクションの数だけの行（例 👍 2）
];

const chatPad2 = (n) => String(n).padStart(2, '0');
// 午前・午後を 24 時間にする
function to24(t) {
  const m = /^(午前|午後)?\s*(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return t;
  let hh = +m[2];
  if (m[1] === '午後' && hh < 12) hh += 12;
  if (m[1] === '午前' && hh === 12) hh = 0;
  return `${chatPad2(hh)}:${m[3]}`;
}
const looksDateOrNumber = (s) => /^[\d/:\-年月日\s()（）]+$/.test(s);

// 年の無い日付の年: 基準の年。月が基準の月より 2 か月以上先なら前の年（12 月から 1 月をまたぐとき）
function yearFor(month, today, year) {
  const ty = year || +today.slice(0, 4);
  const tm = +today.slice(5, 7);
  return month - tm >= 2 ? ty - 1 : ty;
}
function addDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function dateLine(line, today, year) {
  if (line === '今日') return today;
  if (line === '昨日') return addDays(today, -1);
  for (const re of RE_DATE_LINES) {
    const m = re.exec(line);
    if (!m) continue;
    const mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const y = m[1] ? +m[1] : yearFor(mo, today, year);
    return `${y}-${chatPad2(mo)}-${chatPad2(d)}`;
  }
  return null;
}
const isDecor = (line) => DECOR.some((re) => re.test(line));

// その行が、形 f の発言の始まりか。始まりなら { speaker, time, date?, text, skip }（skip: 次の何行を読み飛ばすか）
function startOf(f, lines, i) {
  const line = lines[i];
  if (f === 'bracket') {
    const m = RE_BRACKET.exec(line);
    return m ? { speaker: m[5].trim(), time: to24(m[4]), date: m[1] ? `${m[1]}-${chatPad2(m[2])}-${chatPad2(m[3])}` : '', text: m[6].trim(), skip: 0 } : null;
  }
  if (f === 'header') {
    const m = RE_HEADER.exec(line);
    if (!m || looksDateOrNumber(m[1]) || RE_TIME_ONLY.test(m[1].trim())) return null;
    return { speaker: m[1].trim(), time: to24(m[5]), date: m[2] ? `${m[2]}-${chatPad2(m[3])}-${chatPad2(m[4])}` : '', text: '', skip: 0 };
  }
  if (f === 'three') {
    const next = lines[i + 1];
    if (next === undefined || !RE_TIME_ONLY.test(next)) return null;
    if (line.length > 30 || RE_TIME_ONLY.test(line) || looksDateOrNumber(line)) return null;
    return { speaker: line, time: to24(next), date: '', text: '', skip: 1 };
  }
  if (f === 'speaker') {
    const m = RE_SPEAKER.exec(line);
    return m ? { speaker: m[1].trim(), time: '', date: '', text: m[2].trim(), skip: 0 } : null;
  }
  return null;
}

// text: 貼り付け。today: YYYY-MM-DD（「今日」「昨日」と年の無い日付に使う）。year: 年の無い日付の基準の年（省くと today の年）
// 戻り値 { format, lines: [{ at, speaker, text, raw? }], dropped, unparsed, from, to }
export function parseChat(text, { year, today } = {}) {
  const base = today || new Date().toISOString().slice(0, 10);
  const all = String(text || '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim());
  let dropped = 0;
  const lines = [];   // 空行と飾りの行を除いた行
  for (const l of all) {
    if (!l) continue;
    if (isDecor(l)) { dropped++; continue; }
    lines.push(l);
  }
  // 形を決める: 発言の始まりに当たる行の数がいちばん多い形（同数なら上の形）
  let format = 'unknown';
  let best = 0;
  for (const f of CHAT_FORMATS) {
    let n = 0;
    for (let i = 0; i < lines.length; i++) if (!dateLine(lines[i], base, year) && startOf(f.id, lines, i)) n++;
    if (n > best) { best = n; format = f.id; }
  }
  const out = [];
  let cur = null;
  let date = '';
  let unparsed = 0;
  // 本文の無い見出しは発言にしないが、黙って消さずに読めなかった行として残す
  const finish = () => { if (cur) { if (cur.text) out.push(cur); else { out.push({ at: '', speaker: '', text: cur.speaker, raw: true }); unparsed++; } cur = null; } };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const dl = dateLine(l, base, year);
    if (dl) { date = dl; continue; }
    let s = format === 'unknown' ? null : startOf(format, lines, i);
    // 見出し（名前 時刻）の直後の行は、見出しの形に合っても本文とする（「集合は 9:30」を新しい発言と読まない）
    if (s && format === 'header' && cur && !cur.text) s = null;
    if (s) {
      finish();
      const d = s.date || date;
      const at = s.time ? (d ? `${d} ${s.time}` : s.time) : (format === 'speaker' ? '' : d);
      cur = { at, speaker: s.speaker, text: s.text, date: d };
      i += s.skip;
      continue;
    }
    if (cur) { cur.text = cur.text ? `${cur.text} ${l}` : l; continue; }
    out.push({ at: '', speaker: '', text: l, raw: true });
    unparsed++;
  }
  finish();
  const dates = out.map((x) => x.date).filter(Boolean).sort();
  return {
    format,
    lines: out.map((x) => (x.raw ? { at: '', speaker: '', text: x.text, raw: true } : { at: x.at, speaker: x.speaker, text: x.text })),
    dropped,
    unparsed,
    from: dates[0] || '',
    to: dates[dates.length - 1] || '',
  };
}

// lines → 1 行 1 発言の本文（`at 話者｜本文`。at が無ければ `話者｜本文`。読めなかった行はそのまま）
export function linesToBody(lines) {
  return lines.map((l) => (l.raw || !l.speaker ? l.text : `${l.at ? l.at + ' ' : ''}${l.speaker}｜${l.text}`)).join('\n');
}

// 本文 → lines（書き出しの JSON に使う）。最初の ｜ で分け、左の先頭が日時なら at、残りが話者
const RE_AT = /^((\d{4}-\d{2}-\d{2} )?\d{1,2}:\d{2}(:\d{2})?) /;
export function bodyToLines(body) {
  return String(body || '').split('\n').filter((l) => l.trim() !== '').map((l) => {
    const k = l.indexOf('｜');
    if (k < 0) return { text: l };
    const left = l.slice(0, k);
    const m = RE_AT.exec(left);
    return m ? { at: m[1], speaker: left.slice(m[0].length).trim(), text: l.slice(k + 1) } : { at: '', speaker: left.trim(), text: l.slice(k + 1) };
  });
}
