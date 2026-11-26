// 写した部品: gemini-kit src/js/tableprep.js（2026-11-26）。外側の IIFE を、TABLEPREP だけを外に出す形に包み直した。
// 変えたところ: 区切りの読み取りは csv.js の parseDelimited、JSON は extract.js の safeParse、CSV の書き出しは中の prepToCsv、文言の「gemini-kit」を「案件ワークベンチ」に
// 表の下ごしらえ：大きな表を NotebookLM が読み違えない形にする。DOM は使わない（テストで読む）。
// ・集計は NotebookLM にさせず、ここで全行から計算した結果を表で渡す（01_集計.md）
// ・データは 1 行 1 レコードで列名を毎回書く（断片に切られても列名が残る）。決めた行数ごとにファイルを分ける
// 表は { name, source, sheet, cols: [列名], rows: [[文字列]] }（rows は見出しを除く）
import { parseDelimited } from './csv.js';
import { safeParse } from './extract.js';
export const TABLEPREP = (() => {

  const CODE_MAX = 50; // 異なる値がこれ以下なら「コード値の一覧」に全部の値を載せる
  const TOP = 10;
  const TYPICAL = 30;
  const EXCEPT_MAX = 30;

  const str = (v) => (v == null ? "" : String(v));
  // CSV の書き出し（gemini-kit の mask.js の toCSV と同じ。Excel で開けるよう BOM つき・全セルを引用符で囲む）
  const prepToCsv = (rows) => "\uFEFF" + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const isBlank = (v) => str(v).trim() === "";

  // ---------- 値の判定 ----------
  function num(v) {
    const s = str(v).trim().replace(/[,，\s円¥￥]/g, "");
    if (!/^[-+]?(\d+(\.\d+)?|\.\d+)$/.test(s)) return null;
    if (/^[-+]?0\d/.test(s)) return null; // 0012 のようなコードは数値にしない
    return Number(s);
  }
  // 日付を並べ替えられる文字列（yyyy-mm-dd または yyyy-mm-dd hh:mm）にする
  function dateKey(v) {
    const m = str(v).trim().match(/^(\d{4})[/\-.年](\d{1,2})[/\-.月](\d{1,2})日?(?:[ T](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/);
    if (!m) return null;
    const p = (n) => String(n).padStart(2, "0");
    const mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${m[1]}-${p(mo)}-${p(d)}` + (m[4] != null ? ` ${p(m[4])}:${m[5]}` : "");
  }
  function fmtNum(n) {
    if (!isFinite(n)) return "";
    const r = Number(n.toFixed(4));
    const [i, f] = String(Math.abs(r)).split(".");
    return (r < 0 ? "-" : "") + i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f ? "." + f : "");
  }
  const pct = (a, b) => (b ? `${Math.round((a / b) * 1000) / 10}%` : "0%");

  // ---------- 表を作る ----------
  // 見出しの空・重複を直す（空は「列3」、重複は「金額_2」）
  function fixHeader(h) {
    const seen = new Map();
    return h.map((x, i) => {
      let n = str(x).trim() || `列${i + 1}`;
      if (seen.has(n)) { let k = seen.get(n) + 1; while (seen.has(`${n}_${k}`)) k++; seen.set(n, k); n = `${n}_${k}`; }
      seen.set(n, 1);
      return n;
    });
  }
  // 2 次元配列（1 行目が見出し）→ 表。すべて空の行は落とす
  function fromRows(rows, meta) {
    const all = (rows || []).map((r) => r.map(str));
    const width = Math.max(0, ...all.map((r) => r.length));
    if (!all.length || !width) throw new Error("表に行がありません");
    const pad = (r) => (r.length < width ? r.concat(Array(width - r.length).fill("")) : r);
    const body = all.slice(1).map(pad).filter((r) => r.some((v) => !isBlank(v)));
    return { name: (meta && meta.name) || "表", source: (meta && meta.source) || "", sheet: (meta && meta.sheet) || "", cols: fixHeader(pad(all[0])), rows: body };
  }
  // CSV / TSV の文字列 → 表（区切りと引用符は mask.js の parseTable）
  function fromText(text, meta) {
    const rows = parseDelimited(text);
    if (!rows.length) throw new Error("表が空です");
    return fromRows(rows, meta);
  }

  // JSON：オブジェクトの配列を探す
  function arrayKeys(obj) {
    return Object.keys(obj).filter((k) => Array.isArray(obj[k]) && obj[k].some((x) => x && typeof x === "object" && !Array.isArray(x)));
  }
  function flatten(obj, pre, out) {
    for (const [k, v] of Object.entries(obj)) {
      const key = pre ? `${pre}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
      else if (Array.isArray(v)) out[key] = v.map((x) => (x && typeof x === "object" ? JSON.stringify(x) : str(x))).join("、");
      else out[key] = v == null ? "" : str(v);
    }
    return out;
  }
  // 戻り値 { table, keys }。keys はオブジェクトの配列を持つキーの候補（最上位が配列なら []）
  function fromJSON(text, meta, key) {
    let data;
    try { data = safeParse(str(text).replace(/^﻿/, "")); } catch (e) { throw new Error(`JSON として読めません（${e.message}）`); }
    let arr, keys = [];
    if (Array.isArray(data)) arr = data;
    else if (data && typeof data === "object") {
      keys = arrayKeys(data);
      if (!keys.length) throw new Error("JSON にオブジェクトの配列がありません（[{…}, {…}] の形か、それを持つキーが必要です）");
      const k = key && keys.includes(key) ? key : keys[0];
      arr = data[k];
      meta = Object.assign({}, meta, { sheet: k });
    } else throw new Error("JSON にオブジェクトの配列がありません");
    const recs = arr.filter((x) => x && typeof x === "object" && !Array.isArray(x)).map((x) => flatten(x, "", Object.create(null)));
    if (!recs.length) throw new Error("JSON の配列にオブジェクトがありません");
    const cols = [];
    const seen = new Set();
    for (const r of recs) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); cols.push(k); }
    const table = fromRows([cols, ...recs.map((r) => cols.map((c) => (c in r ? r[c] : "")))], meta);
    return { table, keys };
  }

  // ---------- 列の性質 ----------
  function profile(t) {
    const n = t.rows.length;
    return t.cols.map((name, c) => {
      const vals = t.rows.map((r) => str(r[c]).trim());
      const filled = vals.filter((v) => v !== "");
      const counts = new Map();
      for (const v of filled) counts.set(v, (counts.get(v) || 0) + 1);
      const freq = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      const nums = filled.map(num);
      const dates = filled.map(dateKey);
      let type = "文字";
      if (filled.length && nums.every((x) => x != null)) type = "数値";
      else if (filled.length && dates.every((x) => x != null)) type = "日付";
      else if (filled.length && counts.size <= CODE_MAX && counts.size <= Math.max(1, filled.length / 2)) type = "分類";
      const p = { name, index: c, type, n, filled: filled.length, blank: n - filled.length, distinct: counts.size, top: freq.slice(0, TOP), codes: counts.size <= CODE_MAX ? freq : null, counts };
      if (type === "数値") {
        let sum = 0, min = Infinity, max = -Infinity;
        for (const x of nums) { sum += x; if (x < min) min = x; if (x > max) max = x; }
        Object.assign(p, { sum, mean: sum / nums.length, min, max });
      } else if (type === "日付") {
        const s = [...dates].sort();
        Object.assign(p, { min: s[0], max: s[s.length - 1] });
      }
      return p;
    });
  }
  const showMin = (p) => (p.type === "数値" ? fmtNum(p.min) : p.type === "日付" ? p.min : "");
  const showMax = (p) => (p.type === "数値" ? fmtNum(p.max) : p.type === "日付" ? p.max : "");

  // ---------- Markdown ----------
  const cellMd = (v) => str(v).replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
  function mdTable(head, rows) {
    return [`| ${head.map(cellMd).join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map(cellMd).join(" | ")} |`)].join("\n");
  }
  function about(t, o) {
    const L = [`- 表の名前：${t.name}`];
    if (t.source) L.push(`- 元のファイル：${t.source}`);
    if (t.sheet) L.push(`- シート：${t.sheet}`);
    L.push(`- 行数：${fmtNum(t.rows.length)} 行（見出しを除く）`, `- 列数：${t.cols.length} 列`);
    if (o && o.date) L.push(`- 作成：${o.date}`);
    return L.join("\n");
  }
  // o.ref：ほかのファイルの呼び名 { def, sum, data }（bundle が実際のファイル名を入れる）
  const ref = (o, k) => (o && o.ref && o.ref[k]) || { def: "項目定義書", sum: "集計の表", data: "データのファイル" }[k];
  const NOTE_CALC = (t, o) => `> この表の数字は 案件ワークベンチが全 ${fmtNum(t.rows.length)} 行から計算した値です。件数・合計・平均を聞かれたら、${ref(o, "data")}から数え直さず、この表の数字を使ってください。`;
  // o.bare：まとめた 1 ファイルの章として使うとき（表の情報を繰り返さない）
  const head = (title, t, o, pre) => (o && o.bare ? [title, "", ...(pre || [])] : [title, "", ...(pre || []), about(t, o), ""]);

  function dictionaryMd(t, prof, o) {
    const L = [...head(`# 項目定義書：${t.name}`, t, o), "## 列の一覧", ""];
    L.push(mdTable(["#", "列名", "型", "空の割合", "異なる値の数", "最小", "最大", "値の例"],
      prof.map((p, i) => [i + 1, p.name, p.type, pct(p.blank, p.n), fmtNum(p.distinct), showMin(p), showMax(p), p.top.slice(0, 3).map((x) => x[0]).join("、")])));
    for (const p of prof) {
      L.push("", `## ${p.name}`, "", `- 型：${p.type}`, `- 意味：（ここに書き足すと、NotebookLM が答えに使えます）`,
        `- 空：${fmtNum(p.blank)} 行（${pct(p.blank, p.n)}）`, `- 異なる値の数：${fmtNum(p.distinct)}`);
      if (p.type === "数値" || p.type === "日付") L.push(`- 最小：${showMin(p)}`, `- 最大：${showMax(p)}`);
      if (p.type === "数値") L.push(`- 合計：${fmtNum(p.sum)}`, `- 平均：${fmtNum(p.mean)}`);
      if (!p.filled) continue;
      if (p.codes) {
        L.push("", `コード値の一覧（全 ${p.codes.length} 種類。件数の多い順）`, "", mdTable(["値", "件数", "割合"], p.codes.map(([v, k]) => [v, fmtNum(k), pct(k, p.n)])));
      } else {
        L.push("", `よく出る値（上位 ${p.top.length}）`, "", mdTable(["値", "件数", "割合"], p.top.map(([v, k]) => [v, fmtNum(k), pct(k, p.n)])));
      }
    }
    return L.join("\n") + "\n";
  }

  // groupCol：分類 × 数値列のクロス表にする列の名前（なければ作らない）
  function summaryMd(t, prof, groupCol, o) {
    const numCols = prof.filter((p) => p.type === "数値");
    const catCols = prof.filter((p) => p.codes && p.type !== "数値");
    const L = head(`# 集計：${t.name}`, t, o, [NOTE_CALC(t, o), ""]);
    L.push("## 数値の列", "");
    if (numCols.length) L.push(mdTable(["列", "件数", "合計", "平均", "最小", "最大"], numCols.map((p) => [p.name, fmtNum(p.filled), fmtNum(p.sum), fmtNum(p.mean), fmtNum(p.min), fmtNum(p.max)])));
    else L.push("数値の列はありません。");
    L.push("", "## 分類の列：値ごとの件数", "");
    if (!catCols.length) L.push(`値の種類が ${CODE_MAX} 以下の列はありません。`);
    for (const p of catCols) {
      const rows = p.codes.map(([v, k]) => [v, fmtNum(k), pct(k, p.n)]);
      if (p.blank) rows.push(["（空）", fmtNum(p.blank), pct(p.blank, p.n)]);
      rows.push(["合計", fmtNum(p.n), "100%"]);
      L.push(`### ${p.name}`, "", mdTable(["値", "件数", "割合"], rows), "");
    }
    const g = prof.find((p) => p.name === groupCol && p.codes);
    if (g) {
      L.push(`## ${g.name} 別の集計`, "", NOTE_CALC(t, o), "");
      const groups = new Map();
      for (const r of t.rows) {
        const k = str(r[g.index]).trim() || "（空）";
        if (!groups.has(k)) groups.set(k, { n: 0, sums: numCols.map(() => 0) });
        const x = groups.get(k);
        x.n++;
        numCols.forEach((p, i) => { const v = num(r[p.index]); if (v != null) x.sums[i] += v; });
      }
      const keys = [...groups.keys()].sort((a, b) => groups.get(b).n - groups.get(a).n || (a < b ? -1 : 1));
      const total = { n: t.rows.length, sums: numCols.map((p) => p.sum) };
      L.push(mdTable([g.name, "件数", ...numCols.map((p) => `${p.name}の合計`)],
        [...keys.map((k) => [k, fmtNum(groups.get(k).n), ...groups.get(k).sums.map(fmtNum)]), ["合計", fmtNum(total.n), ...total.sums.map(fmtNum)]]), "");
    }
    return L.join("\n").replace(/\n+$/, "") + "\n";
  }

  // ---------- 代表サンプル ----------
  // 典型：分類の列のよく出る値を順に拾い、空のない行で埋める。例外：空がある・最小・最大・1 回しか出ない値
  function pickSamples(t, prof) {
    const cats = prof.filter((p) => p.codes && p.type !== "数値" && p.distinct > 1);
    const usual = prof.filter((p) => p.blank * 2 <= p.n).map((p) => p.index); // 空が半分を超える列は空が普通なので見ない
    const noBlank = (r) => usual.every((c) => !isBlank(r[c]));
    const typical = [];
    const used = new Set();
    const add = (i) => { if (!used.has(i) && typical.length < TYPICAL) { used.add(i); typical.push(i); } };
    for (let rank = 0; rank < TOP && typical.length < TYPICAL; rank++) {
      for (const p of cats) {
        const v = p.top[rank] && p.top[rank][0];
        if (v == null || p.top[rank][1] < 2) continue;
        const i = t.rows.findIndex((r, j) => !used.has(j) && noBlank(r) && str(r[p.index]).trim() === v);
        if (i >= 0) add(i);
      }
    }
    // 残りは、よく出る値をたくさん含む行から
    const score = (r) => cats.reduce((s, p) => s + (p.counts.get(str(r[p.index]).trim()) || 0) / Math.max(1, p.n), 0);
    t.rows.map((r, i) => [i, noBlank(r) ? score(r) : -1]).sort((a, b) => b[1] - a[1] || a[0] - b[0]).forEach(([i]) => add(i));
    typical.sort((a, b) => a - b);

    const ex = new Map(); // 行 → 理由
    const why = (i, s) => { if (!ex.has(i)) { if (ex.size >= EXCEPT_MAX) return; ex.set(i, []); } if (!ex.get(i).includes(s)) ex.get(i).push(s); };
    for (const p of prof) {
      if (p.type === "数値" || p.type === "日付") {
        const key = p.type === "数値" ? num : dateKey;
        const iMin = t.rows.findIndex((r) => !isBlank(r[p.index]) && key(r[p.index]) === p.min);
        const iMax = t.rows.findIndex((r) => !isBlank(r[p.index]) && key(r[p.index]) === p.max);
        if (iMin >= 0) why(iMin, `${p.name}が最小`);
        if (iMax >= 0) why(iMax, `${p.name}が最大`);
      }
    }
    for (const p of cats) {
      for (const [v, k] of p.codes) if (k === 1) { const i = t.rows.findIndex((r) => str(r[p.index]).trim() === v); if (i >= 0) why(i, `${p.name}「${v}」は 1 回しか出ない`); }
    }
    // 空がある行（空になりがちな列は除く：空が半分を超える列は空が普通）
    for (const p of prof) {
      if (!p.blank || p.blank * 2 > p.n) continue;
      const i = t.rows.findIndex((r) => isBlank(r[p.index]));
      if (i >= 0) why(i, `${p.name}が空`);
    }
    return { typical, exceptions: [...ex.entries()].sort((a, b) => a[0] - b[0]) };
  }
  const recordMd = (t, r, i) => [`### 行 ${i + 1}`, ...t.cols.map((c, k) => (isBlank(r[k]) ? null : `${c}：${str(r[k]).replace(/\r?\n/g, " ")}`)).filter(Boolean)].join("\n");
  function sampleMd(t, prof, o) {
    const s = pickSamples(t, prof);
    const L = head(`# 代表サンプル：${t.name}`, t, o, [`全 ${fmtNum(t.rows.length)} 行のうち、典型の行 ${s.typical.length} 行と例外の行 ${s.exceptions.length} 行です。列の意味は${ref(o, "def")}、件数は${ref(o, "sum")}を見てください。行の番号は元の表の見出しを除いた順番です。空の項目は省いています。`, ""]);
    L.push("## 典型の行", "", `よく出る値を含む行を選んでいます。`, "");
    for (const i of s.typical) L.push(recordMd(t, t.rows[i], i), "");
    L.push("## 例外の行", "");
    if (!s.exceptions.length) L.push("例外にあたる行はありません。");
    for (const [i, reasons] of s.exceptions) L.push(recordMd(t, t.rows[i], i), `選んだ理由：${reasons.join("／")}`, "");
    return L.join("\n").replace(/\n+$/, "") + "\n";
  }

  // ---------- データ本体 ----------
  // o.format: "md" | "json" | "csv"、o.ext: JSON の拡張子（"json" | "txt"）、o.size: 1 ファイルの行数
  function dataFiles(t, o) {
    const fmt = (o && o.format) || "md";
    const size = Math.max(1, Math.floor((o && o.size) || 500));
    const ext = fmt === "json" ? ((o && o.ext) === "txt" ? "txt" : "json") : fmt;
    const files = [];
    const parts = Math.max(1, Math.ceil(t.rows.length / size));
    const w = Math.max(3, String(parts).length);
    for (let k = 0; k < parts; k++) {
      const from = k * size, to = Math.min(t.rows.length, from + size);
      const rows = t.rows.slice(from, to);
      let data;
      if (fmt === "json") {
        const recs = rows.map((r) => JSON.stringify(Object.fromEntries(t.cols.map((c, j) => [c, str(r[j])]))));
        data = `[\n${recs.join(",\n")}\n]\n`;
      } else if (fmt === "csv") {
        data = prepToCsv([t.cols, ...rows]) + "\r\n";
      } else {
        data = [`# ${t.name}：データ ${k + 1} / ${parts}（行 ${from + 1}〜${to}／全 ${fmtNum(t.rows.length)} 行）`, "",
          `列：${t.cols.join("、")}`, "", `1 行を 1 つの見出しにして「列名：値」で書いています。空の項目は省いています。件数・合計は${ref(o, "sum")}を使ってください。`, "",
          ...rows.map((r, j) => recordMd(t, r, from + j) + "\n")].join("\n");
      }
      files.push({ name: `${(o && o.prefix) || ""}10_データ_${String(k + 1).padStart(w, "0")}.${ext}`, data, from: from + 1, to });
    }
    return files;
  }

  // ファイル名に使える形にする（Windows で使えない文字と空白を _ に）
  const fileSafe = (s) => str(s).trim().replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^[._]+|[._]+$/g, "").slice(0, 40) || "表";
  // 見出しを 1 段下げる（まとめた 1 ファイルの章にするため）
  const demote = (md) => md.replace(/^(#{1,5}) /gm, "#$1 ");

  // NotebookLM はファイルを互いに無関係なソースとして扱うので、Markdown のファイルには先頭に「1 組の案内」を入れる
  function guideMd(t, set) {
    const L = [`> **この表「${t.name}」は、次の ${set.count} 個のファイルで 1 組です。** 質問の目的に合うファイルを使ってください。`];
    for (const [name, what] of set.list) L.push(`> - ${name}：${what}`);
    L.push(">", `> 件数・合計・平均は ${set.sumName}にある表の数字で答え、データのファイルから数え直さないでください。`);
    return L.join("\n");
  }
  const withGuide = (md, guide) => md.replace(/^(# [^\n]*\n)/, (m) => `${m}\n${guide}\n`);

  // ファイル一式。o: { groupCol, format, ext, size, date, merge }
  // merge：項目定義書・集計・代表サンプルを 1 つのファイルにまとめる（ソースの数が減り、定義と集計を取り違えにくい）
  function bundle(t, o) {
    o = o || {};
    const prof = profile(t);
    const p = fileSafe(t.name) + "_";
    const data = dataFiles(t, Object.assign({}, o, { prefix: p, ref: {} })); // 名前と行の範囲を先に決める
    const dataLabel = data.length > 1 ? `${data[0].name} 〜 ${data[data.length - 1].name}` : data[0].name;
    const dataWhat = `1 行ずつのデータ（全 ${fmtNum(t.rows.length)} 行${data.length > 1 ? `を ${data.length} 個に分けたもの` : ""}）。個々の行を探すときに使う`;
    const names = o.merge
      ? { all: `${p}00_定義・集計・サンプル.md` }
      : { def: `${p}00_項目定義書.md`, sum: `${p}01_集計.md`, sample: `${p}02_代表サンプル.md` };
    const sumName = o.merge ? `${names.all} の「集計」の章` : names.sum;
    const set = {
      count: (o.merge ? 1 : 3) + data.length,
      sumName,
      list: [
        ...(o.merge
          ? [[names.all, "列の意味・型・コード値の一覧（項目定義書）、件数と合計（集計。全行から計算済み）、典型と例外の行（代表サンプル）"]]
          : [[names.def, "列の意味・型・コード値の一覧"], [names.sum, "件数と合計（全行から計算済み）"], [names.sample, "典型の行と例外の行"]]),
        [dataLabel, dataWhat],
      ],
    };
    const guide = guideMd(t, set);
    const out = [];
    if (o.merge) {
      const ref = { def: "このファイルの「項目定義書」の章", sum: "このファイルの「集計」の章", data: "データのファイル" };
      const sub = Object.assign({}, o, { bare: true, ref });
      const md = [`# 定義・集計・サンプル：${t.name}`, "", guide, "", about(t, o), "",
        demote(dictionaryMd(t, prof, sub)), demote(summaryMd(t, prof, o.groupCol, sub)), demote(sampleMd(t, prof, sub))].join("\n");
      out.push({ name: names.all, data: md.replace(/\n{3,}/g, "\n\n") });
    } else {
      const ref = { def: names.def, sum: names.sum, data: "データのファイル" };
      const sub = Object.assign({}, o, { ref });
      out.push(
        { name: names.def, data: withGuide(dictionaryMd(t, prof, sub), guide) },
        { name: names.sum, data: withGuide(summaryMd(t, prof, o.groupCol, sub), guide) },
        { name: names.sample, data: withGuide(sampleMd(t, prof, sub), guide) });
    }
    const files = dataFiles(t, Object.assign({}, o, { prefix: p, ref: { sum: sumName } }));
    for (const f of files) out.push(f.name.endsWith(".md") ? Object.assign(f, { data: withGuide(f.data, guide) }) : f);
    return out;
  }

  return { CODE_MAX, num, dateKey, fmtNum, fromRows, fromText, fromJSON, profile, dictionaryMd, summaryMd, sampleMd, pickSamples, dataFiles, bundle, fileSafe };
})();
