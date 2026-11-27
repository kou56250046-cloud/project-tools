// 写した部品: gemini-kit src/js/mask.js（2026-11-26）。外側の IIFE を、MASK だけを外に出す形に包み直した。変えたところ: 短い行を列の数まで埋める（FIX-003）・書き出しで式になる値を無害にする（FIX-023）・文中の置き換えの重複を除く（FIX-019）
// 貼り付けもファイル（CSV・TSV）も、この中の parseTable で読む（結果をそろえるため。P6c design.md）
// 表（Excel からのコピー＝TSV、または CSV）を列ごとの規則でマスキングする。ブラウザの中だけで処理する。
// ・同じ値には必ず同じ仮名を付ける（同じ接頭辞の列どうしで辞書を共有するので、別シートの結合キーも保てる）
// ・対応表は別に出力する。対応表は社外に出さない
import { csvSafe } from './csv.js';

export const MASK = (() => {

  const RULES = {
    keep: "そのまま",
    pseudo: "仮名にする（顧客A など）",
    seq: "連番にする（形式は保つ）",
    email: "メールを仮のアドレスに",
    round: "数値を丸める（上位2桁）",
    range: "数値を範囲にする",
    reldate: "日付を基準日からの日数に",
    pref: "住所を都道府県までに",
    blank: "空にする",
    drop: "列ごと削除",
  };

  // ---------- 表の読み書き ----------
  function parseTable(text) {
    const src = String(text || "").replace(/\r\n?/g, "\n").replace(/\n+$/, "");
    if (!src) return [];
    const first = src.split("\n")[0];
    const sep = first.includes("\t") ? "\t" : ",";
    const rows = [];
    let row = [], cell = "", q = false;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (q) {
        if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"' && cell === "") q = true;
      else if (c === sep) { row.push(cell); cell = ""; }
      else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += c;
    }
    row.push(cell);
    rows.push(row);
    const n = rows.reduce((m, r) => Math.max(m, r.length), 0);
    return rows.map((r) => (r.length < n ? r.concat(Array(n - r.length).fill("")) : r));
  }
  // 書き出すときは、式として読まれる値を無害にする（csv.js の csvSafe。写し元から足した）
  function toTSV(rows) {
    return rows.map((r) => r.map((v0) => { const v = csvSafe(v0); return /[\t\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }).join("\t")).join("\n");
  }
  function toCSV(rows) {
    return "\uFEFF" + rows.map((r) => r.map((v) => `"${csvSafe(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  }

  // ---------- 値の判定 ----------
  const num = (v) => {
    const s = String(v).replace(/[,，\s円¥￥]/g, "");
    return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
  };
  function parseDate(v) {
    const m = String(v).trim().match(/^(\d{4})[/\-.年](\d{1,2})[/\-.月](\d{1,2})日?/);
    if (!m) return null;
    const d = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    return Number.isNaN(d) ? null : d;
  }
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  const PHONE = /0\d{1,4}-\d{1,4}-\d{3,4}/;
  const PREF = /(北海道|東京都|京都府|大阪府|[^\s都道府県]{2,3}県)/;

  // 見出しと値から規則の初期値を決める
  function infer(header, values) {
    const h = String(header || "");
    const vals = values.map((v) => String(v).trim()).filter(Boolean);
    const all = (f) => vals.length > 0 && vals.every(f);
    if (/(メール|mail)/i.test(h) || all((v) => EMAIL.test(v))) return { rule: "email" };
    if (/(顧客|得意先)/.test(h) && !/(コード|ID|番号|No)/i.test(h)) return { rule: "pseudo", prefix: "顧客" };
    if (/(仕入先|外注先|協力会社)/.test(h) && !/(コード|ID|番号)/i.test(h)) return { rule: "pseudo", prefix: "仕入先" };
    if (/(社名|会社|取引先|企業|法人|店舗|支店)/.test(h) && !/(コード|ID|番号)/i.test(h)) return { rule: "pseudo", prefix: "会社" };
    if (/(氏名|名前|担当|社員|作成者|承認者|申請者|責任者)/.test(h) && !/(コード|ID|番号)/i.test(h)) return { rule: "pseudo", prefix: "担当者" };
    if (/(電話|TEL|FAX|携帯)/i.test(h) || all((v) => PHONE.test(v))) return { rule: "seq" };
    if (/(郵便|〒)/.test(h)) return { rule: "blank" };
    if (/(住所|所在地)/.test(h)) return { rule: "pref" };
    if (/(備考|メモ|コメント|摘要|詳細|内容|自由記述)/.test(h)) return { rule: "blank" };
    if (all((v) => parseDate(v) != null)) return { rule: "reldate" };
    if (/(コード|ID|番号|No|ＩＤ)/i.test(h)) return { rule: "seq" };
    if (/(金額|売上|単価|価格|費用|予算|原価|利益|年収|給与|請求)/.test(h) && all((v) => num(v) != null)) return { rule: "round" };
    if (all((v) => num(v) != null)) {
      if (vals.some((v) => /^0\d/.test(v))) return { rule: "seq" };
      return { rule: "keep" };
    }
    const distinct = new Set(vals).size;
    const avg = vals.reduce((s, v) => s + v.length, 0) / Math.max(1, vals.length);
    if (avg > 25) return { rule: "blank" };
    if (distinct <= Math.max(8, vals.length * 0.3)) return { rule: "keep" };
    return { rule: "pseudo", prefix: (h || "項目").slice(0, 6) };
  }

  // ---------- 置き換え ----------
  const alpha = (i) => { let s = ""; i += 1; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };
  function seqFormat(orig, n) {
    const runs = [...String(orig).matchAll(/\d+/g)];
    if (!runs.length) return String(orig).replace(/[A-Za-z぀-ヿ一-鿿]+/g, "X") + n;
    let out = "", last = 0;
    runs.forEach((m, k) => {
      out += String(orig).slice(last, m.index);
      out += k === runs.length - 1 ? String(n).padStart(m[0].length, "0") : "0".repeat(m[0].length);
      last = m.index + m[0].length;
    });
    return out + String(orig).slice(last);
  }
  const man = (v) => {
    const a = Math.abs(v);
    if (a >= 1e8) return `${+(v / 1e8).toPrecision(3)}億`;
    if (a >= 1e4) return `${+(v / 1e4).toPrecision(3)}万`;
    return String(v);
  };
  function roundSig(v, d) {
    if (v === 0) return 0;
    const p = Math.pow(10, Math.floor(Math.log10(Math.abs(v))) - (d - 1));
    return Math.round(v / p) * p;
  }

  // state：{ dict: Map(group -> Map(original -> masked)) }。画面を開いている間だけ保持する（保存しない）
  function newState() { return { dict: new Map(), baseDate: null }; }

  function apply(rows, colRules, state, opt) {
    const o = Object.assign({ header: true, replaceInText: true }, opt);
    const st = state || newState();
    if (!rows.length) return { rows: [], mapping: [], warnings: [] };
    // xlsx の行は値のある最後の列までしかないので、列の数まで "" で埋める（CSV に undefined を書かない）
    const width = rows.reduce((m, r) => Math.max(m, r.length), colRules.length);
    rows = rows.map((r) => (r.length < width ? r.concat(Array(width - r.length).fill("")) : r)).map((r) => r.map((v) => (v == null ? "" : v)));
    const head = o.header ? rows[0] : rows[0].map((_, i) => `列${i + 1}`);
    const body = o.header ? rows.slice(1) : rows;
    const mapping = [];
    const seen = new Set();
    const dictOf = (key) => { if (!st.dict.has(key)) st.dict.set(key, new Map()); return st.dict.get(key); };
    const record = (col, from, to) => { const k = col + "\u0000" + from; if (!seen.has(k)) { seen.add(k); mapping.push({ column: col, original: from, masked: to }); } };

    // 日付の基準日は表全体で1つ（列ごとに変えると、受注日と納期の前後関係が読めなくなる）。
    // 対応表を共有している間は、最初の表で決めた基準日を使い続ける（それより古い日は「基準日-N日」）
    if (st.baseDate == null) {
      const ds = [];
      colRules.forEach((cr, c) => { if (cr.rule === "reldate") for (const r of body) { const d = parseDate(r[c]); if (d != null) ds.push(d); } });
      if (ds.length) st.baseDate = ds.reduce((m, d) => Math.min(m, d), Infinity);
    }
    const textReplace = []; // 他の列の文中に出てくる元の値 → 仮名
    const outBody = body.map((r) => r.map((v) => v));
    colRules.forEach((cr, c) => {
      const col = head[c];
      // 辞書の共有範囲：仮名は接頭辞ごと（別の列・別の表でも同じ値は同じ仮名）、メールは全体、連番は列ごと
      const group = cr.rule === "pseudo" ? "pseudo:" + (cr.prefix || "") : cr.rule === "seq" ? "seq:" + col : cr.rule;
      const dict = dictOf(group);
      for (const r of outBody) {
        const v = String(r[c] ?? "");
        if (v.trim() === "" && cr.rule !== "drop") continue;
        let out = v;
        switch (cr.rule) {
          case "pseudo":
            if (!dict.has(v)) dict.set(v, `${cr.prefix || "項目"}${alpha(dict.size)}`);
            out = dict.get(v);
            if (v.length >= 2) textReplace.push([v, out]);
            break;
          case "seq":
            if (!dict.has(v)) dict.set(v, seqFormat(v, dict.size + 1));
            out = dict.get(v);
            break;
          case "email":
            if (!dict.has(v)) dict.set(v, `user${String(dict.size + 1).padStart(3, "0")}@example.com`);
            out = dict.get(v);
            textReplace.push([v, out]);
            break;
          case "round": {
            const n = num(v);
            if (n == null) { out = "（数値以外）"; break; }
            const rv = roundSig(n, cr.digits || 2);
            out = /,/.test(v) ? rv.toLocaleString("en-US") : String(rv);
            break;
          }
          case "range": {
            const n = num(v);
            if (n == null) { out = "（数値以外）"; break; }
            if (n === 0) { out = "0"; break; }
            const lo = Math.pow(10, Math.floor(Math.log10(Math.abs(n))));
            out = n < 0 ? `-${man(lo * 10)}超〜-${man(lo)}以下` : `${man(lo)}以上${man(lo * 10)}未満`;
            break;
          }
          case "reldate": {
            const d = parseDate(v);
            if (d == null) { out = "（日付以外）"; break; }
            const days = Math.round((d - st.baseDate) / 86400000);
            out = days < 0 ? `基準日-${-days}日` : `基準日+${days}日`;
            break;
          }
          case "pref": {
            const m = v.match(PREF);
            out = m ? m[1] : "（不明）";
            break;
          }
          case "blank": out = ""; break;
          default: break;
        }
        if (out !== v && cr.rule !== "blank" && cr.rule !== "drop") record(col, v, out);
        r[c] = out;
      }
    });
    // そのままの列の文中にある元の値を置き換える（長いものから）
    if (o.replaceInText && textReplace.length) {
      // 同じ元の値は 1 つにまとめる（行ごとに積むと、行数の 2 乗で遅くなる）
      const uniq = new Map();
      for (const [from, to] of textReplace) if (!uniq.has(from)) uniq.set(from, to);
      textReplace.length = 0;
      for (const x of uniq) textReplace.push(x);
      textReplace.sort((a, b) => b[0].length - a[0].length);
      colRules.forEach((cr, c) => {
        if (cr.rule !== "keep") return;
        for (const r of outBody) {
          let v = String(r[c] ?? "");
          for (const [from, to] of textReplace) if (v.includes(from)) v = v.split(from).join(to);
          r[c] = v;
        }
      });
    }
    const keepIdx = colRules.map((cr, c) => (cr.rule === "drop" ? -1 : c)).filter((c) => c >= 0);
    const outRows = (o.header ? [head] : []).concat(outBody).map((r) => keepIdx.map((c) => r[c]));
    return { rows: outRows, mapping, warnings: check(outRows, colRules.filter((cr) => cr.rule !== "drop"), o.header, textReplace) };
  }

  // 残っていそうな固有情報を探す
  function check(rows, rules, header, replaced) {
    const warns = [];
    const pats = [
      [/(株式会社|有限会社|合同会社|\(株\)|（株）|㈱|\(有\)|㈲)/, "会社名らしき文字"],
      [EMAIL, "メールアドレス"],
      [PHONE, "電話番号"],
      [/〒?\d{3}-\d{4}/, "郵便番号"],
      [/(様|殿|さん)(\s|$|、|。)/, "敬称つきの人名らしき文字"],
    ];
    const originals = new Set(replaced.map((x) => x[0]));
    rows.forEach((r, i) => {
      if (header && i === 0) return;
      r.forEach((v, c) => {
        const s = String(v);
        // 置き換えた列は形式が決まっているので、そのままにした列だけを見る
        if (!s || (rules[c] && rules[c].rule !== "keep")) return;
        for (const [re, what] of pats) if (re.test(s)) { warns.push({ row: i + 1, col: c + 1, rule: rules[c] && rules[c].rule, message: what }); break; }
        if (originals.has(s)) warns.push({ row: i + 1, col: c + 1, message: "置き換え前の値がそのまま残っています" });
      });
    });
    return warns;
  }

  function mappingCSV(mapping) {
    return toCSV([["列", "元の値", "置き換え後"], ...mapping.map((m) => [m.column, m.original, m.masked])]);
  }

  return { RULES, parseTable, toTSV, toCSV, infer, apply, newState, mappingCSV, seqFormat };
})();
