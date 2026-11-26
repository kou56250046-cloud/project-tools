// 写した部品: gemini-kit src/js/clean.js（2026-11-26）。外側の IIFE を、TRANSCRIPT だけを外に出す形に包み直した。中身は変えていない
// 議事録（文字起こし）の前処理。LLM は使わず、決まった規則だけで行う。
// 対応する形：
//   VTT（Teams）     00:00:12.345 --> 00:00:15.000 の次に <v 山田 太郎>本文</v> または 山田: 本文
//   Teams の txt     [00:12:34] 山田 太郎: 本文      ／  山田 太郎   0:03（次の行から本文）
//   Meet の txt      00:05:00（時刻だけの行）の後に 山田 太郎: 本文
//   話者:本文        山田：本文
// 出力は 1 発言 1 行の「時刻 話者｜本文」。判定できない行は本文のまま残し、件数を返す。
export const TRANSCRIPT = (() => {

  const T = String.raw`\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?`;
  const RE = {
    arrow: new RegExp(`^(${T})\\s*-->\\s*(${T})`),
    vtag: /^<v(?:\.[^\s>]+)?\s+([^>]+)>(.*?)(?:<\/v>)?\s*$/,
    timeSpeaker: new RegExp(`^\\[?(${T})\\]?\\s+(.{1,30}?)\\s*[:：]\\s*(.+)$`),
    header: new RegExp(`^(.{1,30}?)\\s+\\[?(${T})\\]?$`),
    timeOnly: new RegExp(`^\\[?(${T})\\]?$`),
    speaker: /^([^\s:：「」（）()]{1,16}(?:[ 　][^\s:：「」（）()]{1,16})?)\s*[:：]\s*(.+)$/,
    cueNo: /^\d+$/,
  };
  // つなぎ言葉。「あの件」「まあまあ」のような語を消さないよう、後ろに読点・長音・空白が続くときだけ消す
  const FILLER = /(^|[、。！？\s])(?:え[ーっ]+と?|えっと|ええと|あの[ーっ]+|あの(?=[、\s])|その[ーっ]+|まあ(?=[、\s])|う[ーん]+(?=[、\s]|$)|ん[ー]+|なんか(?=[、\s]))[、\s]*/g;
  const MERGE_UNDER = 40; // 同じ話者が続くとき、前の発言がこれより短ければつなげる

  const stripMs = (t) => t.replace(/[.,]\d+$/, "");

  function defiller(s) {
    let prev;
    do { prev = s; s = s.replace(FILLER, "$1"); } while (s !== prev);
    return s.replace(/、{2,}/g, "、").replace(/^[、\s]+/, "").replace(/\s{2,}/g, " ").trim();
  }

  // 話者らしくないもの（見出し・URL・時刻だけ）を除く
  function looksSpeaker(s) {
    if (!s || /^(https?|注|※|件名|日時|場所|参加者|出席者|todo|q|a)$/i.test(s)) return false;
    if (/(議題|メモ|備考|宿題|決定事項|連絡事項|補足)$/.test(s)) return false;
    return !/^\d+$/.test(s) && !/[。、]/.test(s);
  }

  function clean(text) {
    const src = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    const lines = [];
    const raw = [];
    const hits = { vtt: 0, teams: 0, header: 0, meet: 0, speaker: 0 };
    let time = "";
    let pending = null; // ヘッダー形式で、次の行から本文が来る話者
    let lastWasBody = false;
    const push = (speaker, body, how) => {
      const t = defiller(body);
      if (!t) return;
      hits[how]++;
      lines.push({ t: time, speaker: speaker.trim(), text: t });
    };
    for (let i = 0; i < src.length; i++) {
      const line = src[i].trim();
      if (!line) { pending = pending && pending.used ? null : pending; lastWasBody = false; continue; }
      if (i === 0 && /^WEBVTT/.test(line)) continue;
      if (/^NOTE\b/.test(line)) continue;
      let m;
      if ((m = line.match(RE.arrow))) { time = stripMs(m[1]); pending = null; continue; }
      if (RE.cueNo.test(line) && src[i + 1] && RE.arrow.test(src[i + 1].trim())) continue;
      if ((m = line.match(RE.vtag))) { push(m[1], m[2].replace(/<[^>]+>/g, ""), "vtt"); lastWasBody = true; continue; }
      if ((m = line.match(RE.timeSpeaker)) && looksSpeaker(m[2])) { time = stripMs(m[1]); push(m[2], m[3], "teams"); pending = null; lastWasBody = true; continue; }
      if ((m = line.match(RE.timeOnly))) { time = stripMs(m[1]); pending = null; continue; }
      if ((m = line.match(RE.header)) && looksSpeaker(m[1]) && !/[:：]/.test(m[1])) {
        time = stripMs(m[2]);
        pending = { speaker: m[1], used: false };
        continue;
      }
      if (pending) {
        if (pending.used && lines.length) lines[lines.length - 1].text += " " + defiller(line);
        else { push(pending.speaker, line, "header"); pending.used = true; }
        continue;
      }
      if ((m = line.match(RE.speaker)) && looksSpeaker(m[1])) {
        push(m[1], m[2], time ? "meet" : "speaker");
        lastWasBody = true;
        continue;
      }
      // 直前が発言の続きなら、同じ発言に足す（改行で折り返された本文）
      // 「議題メモ：…」のように話者ではない見出しは続きにせず、本文のまま残す
      if (lastWasBody && lines.length && !RE.speaker.test(line)) { lines[lines.length - 1].text += " " + defiller(line); continue; }
      raw.push(line);
      lines.push({ t: "", speaker: "", text: line, raw: true });
    }

    // 同じ話者が続く短い発言を 1 つにまとめる（最初の時刻を残す）
    const merged = [];
    for (const l of lines) {
      const p = merged[merged.length - 1];
      if (p && !p.raw && !l.raw && p.speaker === l.speaker && p.text.length < MERGE_UNDER) p.text += " " + l.text;
      else merged.push(Object.assign({}, l));
    }

    const order = Object.entries(hits).sort((a, b) => b[1] - a[1]);
    const NAMES = { vtt: "Teams（VTT）", teams: "Teams（時刻つき）", header: "Teams（話者と時刻の見出し）", meet: "Meet", speaker: "話者:本文" };
    const format = order[0][1] ? NAMES[order[0][0]] : "判定できない形式";

    const by = new Map();
    for (const l of merged) {
      if (l.raw) continue;
      const s = by.get(l.speaker) || { speaker: l.speaker, count: 0, chars: 0 };
      s.count++;
      s.chars += l.text.length;
      by.set(l.speaker, s);
    }
    const out = merged.map((l) => (l.raw ? l.text : `${l.t ? l.t + " " : ""}${l.speaker}｜${l.text}`)).join("\n") + "\n";
    const parsed = merged.filter((l) => !l.raw).length;
    return {
      format,
      lines: merged,
      raw,
      out,
      stats: { utterances: parsed, unparsed: raw.length, rate: parsed + raw.length ? parsed / (parsed + raw.length) : 0, bySpeaker: [...by.values()].sort((a, b) => b.chars - a.chars) },
    };
  }

  return { clean, defiller };
})();
