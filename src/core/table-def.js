// 写した部品: gemini-kit src/js/table.js（2026-11-26）の、共通の小道具・条件のセル・型・テーブル定義のパースと点検・列定義表と CSV。
// 写さないもの: 構築先（Excel・SharePoint・Dataverse）の型と手順、Office Scripts、ER 図（ワークベンチは台帳のテーブルの ER 図がある）
// 変えたところ: ID の規則（台帳の ID と JDG・TBL）、テーブルの「物理名」「区分」の行、列定義表の「型（台帳）」

import { KINDS, LOGICAL_TYPES } from './schema.js';
import { MDBLOCKS } from './mdblocks.js';

export const TABLEDEF = (() => {
  const LOGICAL_LABEL = Object.fromEntries(LOGICAL_TYPES.map((t) => [t.v, t.label]));
  // ---------- 共通の小道具 ----------
  const strip = (s) => String(s == null ? "" : s).replace(/\*\*|`/g, "").replace(/<br\s*\/?>/gi, " ").trim();
  // 写し元から変えたところ: ID は台帳の全種別の接頭辞と JDG・TBL（カルテの ID の規則は使わない）
  const ID_PFX = ['JDG', 'TBL', ...Object.values(KINDS).map((k) => k.prefix)].join('|');
  const idRe = () => new RegExp(`(?:${ID_PFX})-\\d{1,4}(?![\\d-])`, 'g');
  const idsIn = (s) => [...new Set([...String(s || "").matchAll(idRe())].map((m) => m[0]))];
  const norm = (s) => strip(s).normalize("NFKC").toLowerCase().replace(/\s+/g, " ");

  // 見出し「## PFX-001 題名」で区切る。より深い見出しは同じ区切りの中に含める
  function sections(src, prefix) {
    const text = MDBLOCKS.unwrapFence(String(src == null ? "" : src));
    const re = new RegExp(`^(${prefix}-\\d{1,4})(?![\\d-])\\s*[：:．.]?\\s*(.*)$`);
    const out = [];
    let cur = null;
    for (const b of MDBLOCKS.parse(text)) {
      if (b.type === "heading") {
        const m = strip(b.text).match(re);
        if (m) { cur = { id: m[1], title: m[2].trim(), line: b.line, level: b.level, blocks: [] }; out.push(cur); continue; }
        if (cur && b.level <= cur.level) cur = null;
        continue;
      }
      if (cur) cur.blocks.push(b);
    }
    return out;
  }
  // 「- 項目：値」の箇条書き。字下げした子の項目は items に入れる。最初に出たものを使う
  function fields(blocks) {
    const f = {};
    for (const b of blocks) {
      if (b.type !== "list") continue;
      for (const it of b.items) {
        const m = strip(it.text).match(/^([^：:]{1,24})[：:]\s*([\s\S]*)$/);
        if (!m) continue;
        const k = m[1].trim();
        if (!(k in f)) f[k] = { text: m[2].trim(), items: it.children.map((c) => strip(c.text)).filter(Boolean), line: it.line };
      }
    }
    return f;
  }
  const field = (f, names) => { for (const n of names) if (f[n]) return f[n]; return null; };

  // 数値：全角・桁区切り・円・万／千／億を読む。読めなければ null
  function num(s) {
    if (s == null) return null;
    const t = String(s).normalize("NFKC").replace(/[−–―]/g, "-").replace(/[,\s円]/g, "");
    const m = t.match(/^([-+]?\d+(?:\.\d+)?)(万|千|億)?$/);
    if (!m) return null;
    return +m[1] * (m[2] === "万" ? 1e4 : m[2] === "千" ? 1e3 : m[2] === "億" ? 1e8 : 1);
  }
  const BOOL_T = /^(はい|yes|true|○|〇|◯|有|あり|y|✓|✔)$/i;
  const BOOL_F = /^(いいえ|no|false|×|✕|無|なし|n)$/i;
  const boolOf = (s) => { const t = strip(s); return BOOL_T.test(t) ? true : BOOL_F.test(t) ? false : null; };
  // 2 つの値が同じか（数値なら数として、はい・いいえは真偽として、それ以外は表記をそろえて比べる）
  function same(a, b) {
    const na = num(a), nb = num(b);
    if (na != null && nb != null) return na === nb;
    const ba = boolOf(a), bb = boolOf(b);
    if (ba != null && bb != null) return ba === bb;
    return norm(a) === norm(b);
  }
  // 「A、B」「A|B」などの並び。数値だけのとき（100,000 など）は区切らない。
  // , は桁区切りと見分けられないので、ほかの区切りで分けたあと、数として読めない断片だけを , で分ける
  function splitVals(s) {
    const t = strip(s);
    if (num(t) != null) return [t];
    return t.split(/\s*(?:\||｜|、|／|\/|\s+または\s+|\s+又は\s+|\s+or\s+)\s*/i)
      .flatMap((x) => (num(x) != null ? [x] : x.split(/\s*[,，]\s*/)))
      .map((x) => x.trim()).filter(Boolean);
  }

  // ---------- 条件のセル ----------
  // { any } | { op, n } | { range:[a,b], lo?, hi? } | { eq:[...] } | { ne:[...] }。range の lo / hi が ">" / "<" なら端を含まない
  const ANY_RE = /^(?:|-|－|―|ー|—|\*|＊|任意|問わない|すべて|全て|指定なし|any)$/i;
  const OPS = { ">=": ">=", "≧": ">=", "＞＝": ">=", "=>": ">=", "<=": "<=", "≦": "<=", "＜＝": "<=", "=<": "<=", ">": ">", "＞": ">", "<": "<", "＜": "<", "=": "=", "＝": "=", "==": "=", "!=": "!=", "≠": "!=", "<>": "!=" };
  const WORD_OPS = { 以上: ">=", 以下: "<=", 未満: "<", 超: ">", を超える: ">", より大きい: ">", より小さい: "<" };
  function parseCond(raw) {
    const t = strip(raw).replace(/^【(.*)】$/, "$1").trim();
    if (ANY_RE.test(t)) return { any: true };
    // 「10万以上50万未満」「100 超 200 以下」
    let m = t.match(/^(.+?)\s*(以上|超|より大きい|を超え)\s*[、,・，]?\s*(.+?)\s*(以下|未満|まで)$/);
    if (m && num(m[1]) != null && num(m[3]) != null) {
      const r = { range: [num(m[1]), num(m[3])] };
      if (m[2] !== "以上") r.lo = ">";
      if (m[4] === "未満") r.hi = "<";
      return r;
    }
    // 片側だけの「5000〜」「〜5000」
    m = t.match(/^(.+?)\s*[〜~～]$/);
    if (m && num(m[1]) != null) return { op: ">=", n: num(m[1]) };
    m = t.match(/^[〜~～]\s*(.+)$/);
    if (m && num(m[1]) != null) return { op: "<=", n: num(m[1]) };
    m = t.match(/^(.+?)\s*[〜~～]\s*(.+)$/);
    if (m && num(m[1]) != null && num(m[2]) != null) return { range: [num(m[1]), num(m[2])] };
    m = t.match(/^([-+]?[\d,.]+[万千億]?)\s*[-－]\s*([-+]?[\d,.]+[万千億]?)$/);
    if (m && num(m[1]) != null && num(m[2]) != null) return { range: [num(m[1]), num(m[2])] };
    m = t.match(/^(>=|<=|=>|=<|==|!=|<>|≧|≦|≠|＞＝|＜＝|>|<|=|＞|＜|＝)\s*(.+)$/);
    if (m) {
      const op = OPS[m[1]];
      if (op === "=") return { eq: splitVals(m[2]) };
      if (op === "!=") return { ne: splitVals(m[2]) };
      const n = num(m[2]);
      return n != null ? { op, n } : { eq: [t] };
    }
    m = t.match(/^(.+?)\s*(以上|以下|未満|を超える|より大きい|より小さい|超)$/);
    if (m && num(m[1]) != null) return { op: WORD_OPS[m[2]], n: num(m[1]) };
    m = t.match(/^(.+?)\s*以外$/);
    if (m) return { ne: splitVals(m[1]) };
    return { eq: splitVals(t) };
  }
  const isNumCond = (c) => !!(c && (c.op || c.range || ((c.eq || c.ne) && (c.eq || c.ne).every((x) => num(x) != null))));
  function testCond(c, value) {
    if (!c || c.any) return true;
    const v = value == null ? "" : String(value).trim();
    if (v === "") return false;
    if (c.range) {
      const n = num(v);
      if (n == null) return false;
      return (c.lo === ">" ? n > c.range[0] : n >= c.range[0]) && (c.hi === "<" ? n < c.range[1] : n <= c.range[1]);
    }
    if (c.op) {
      const n = num(v);
      if (n == null) return false;
      return c.op === ">=" ? n >= c.n : c.op === "<=" ? n <= c.n : c.op === ">" ? n > c.n : n < c.n;
    }
    if (c.eq) return c.eq.some((x) => same(x, v));
    if (c.ne) return !c.ne.some((x) => same(x, v));
    return false;
  }
  const fmtN = (n) => (Number.isInteger(n) ? n.toLocaleString("en-US") : String(n));
  function condText(c) {
    if (!c || c.any) return "何でも";
    if (c.range) return c.lo || c.hi ? `${fmtN(c.range[0])} ${c.lo === ">" ? "超" : "以上"} ${fmtN(c.range[1])} ${c.hi === "<" ? "未満" : "以下"}` : `${fmtN(c.range[0])}〜${fmtN(c.range[1])}`;
    if (c.op) return `${c.op}${fmtN(c.n)}`;
    if (c.eq) return c.eq.join(" または ");
    if (c.ne) return `${c.ne.join("・")} 以外`;
    return "";
  }

  // ---------- 型 ----------
  const TYPES = ["text", "note", "number", "currency", "date", "datetime", "bool", "choice", "lookup"];
  const TYPE_NAMES = { text: "文字", note: "長文", number: "数値", currency: "通貨", date: "日付", datetime: "日時", bool: "はい・いいえ", choice: "選択肢", lookup: "参照" };
  const TYPE_WORDS = [
    ["datetime", /^(日時|日付と時刻|日付時刻|日付・時刻|datetime|timestamp)/i],
    ["date", /^(日付|年月日|date)$/i],
    ["note", /^(長文|複数行|複数行テキスト|メモ|note)/i],
    ["currency", /^(通貨|金額|currency|money)$/i],
    ["number", /^(数値|整数|小数|数量|数|number|int|integer|decimal|numeric)/i],
    ["bool", /^(はい・いいえ|はい\/いいえ|はい／いいえ|真偽|真偽値|yes\/no|bool|boolean|フラグ|チェック|二択)/i],
    ["choice", /^(選択肢|リスト|区分|コード|choice|enum)/i],
    ["lookup", /^(参照|lookup|外部キー|検索)/i],
    ["text", /^(文字|文字列|テキスト|1\s?行テキスト|一行テキスト|text|string|varchar|char|nvarchar)/i],
  ];
  const typeOf = (s) => { const t = strip(s).normalize("NFKC"); for (const [k, re] of TYPE_WORDS) if (re.test(t)) return k; return null; };

  // ---------- テーブル定義のパース ----------
  const HEAD = {
    name: /^(列名|項目名|論理名|項目（論理）|項目\(論理\)|項目|列)$/,
    key: /^(内部名|物理名|項目（物理）|項目\(物理\)|列ID|列 ID|英名|スキーマ名)$/,
    type: /^(型|データ型|種類)$/,
    required: /^(必須|必須？)$/,
    pk: /^(キー|PK|PK\/FK|主キー|キー（PK・FK）)$/,
    choice: /^(選択肢・範囲|選択肢|範囲|選択肢・桁|桁・範囲|制約|値の範囲|選択肢・範囲・桁)$/,
    digits: /^(桁|桁数|長さ)$/,
    def: /^(既定値|初期値|デフォルト)$/,
    basis: /^(根拠|出典|根拠・出典|根拠（カルテ）)$/,
    state: /^(状態|ステータス)$/,
    note: /^(備考|説明|メモ)$/,
  };
  function mapHead(head) {
    const h = (head || []).map((x) => strip(x).normalize("NFKC").replace(/\(/g, "（").replace(/\)/g, "）"));
    const idx = {};
    for (const [k, re] of Object.entries(HEAD)) idx[k] = h.findIndex((x) => re.test(x) || re.test(x.replace(/（/g, "(").replace(/）/g, ")")));
    return idx;
  }
  const REQUIRED_RE = /^(○|〇|◯|✓|✔|必須|はい|y|yes|true|1)$/i;

  function parse(src) {
    const out = { tables: [], warnings: [] };
    const warn = (line, where, message) => out.warnings.push({ line, where, message });
    const seen = new Map();
    for (const s of sections(src, "TBL")) {
      const f = fields(s.blocks);
      const kindText = strip((field(f, ["区分"]) || {}).text || "");
      const t = { id: s.id, name: s.title || s.id, desc: (field(f, ["説明", "概要"]) || {}).text || "", basis: idsIn((field(f, ["根拠", "出典"]) || {}).text), line: s.line, cols: [],
        physical: strip((field(f, ["物理名", "テーブルの物理名"]) || {}).text || ""), fileType: /外部/.test(kindText) ? "external" : kindText ? "internal" : null };
      if (seen.has(t.id)) warn(s.line, t.id, `${t.id} が 2 回定義されています（最初は ${seen.get(t.id)} 行目）`);
      else seen.set(t.id, s.line);
      out.tables.push(t);
      const tb = s.blocks.find((b) => { if (b.type !== "table") return false; const H = mapHead(b.head); return H.name >= 0 && H.type >= 0; });
      if (!tb) { warn(s.line, t.id, "列の表（「列名」と「型」の列を持つ表）がありません"); continue; }
      const H = mapHead(tb.head);
      tb.rows.forEach((r, i) => {
        const line = tb.line + 2 + i;
        if (r.length !== tb.head.length) warn(line, t.id, `列の表の ${i + 1} 行目のセルが ${r.length} 個です（見出しは ${tb.head.length} 個）。セルの中で | を使うと列がずれます`);
        const cell = (k) => (H[k] >= 0 ? strip(r[H[k]] || "") : "");
        const name = cell("name");
        if (!name) return;
        const where = `${t.id}.${name}`;
        const typeRaw = cell("type");
        let type = typeOf(typeRaw);
        if (!type) { warn(line, where, `型「${typeRaw || "（空）"}」は読めません。文字とみなします`); type = "text"; }
        const keyCell = cell("pk").normalize("NFKC");
        const choiceCell = cell("choice");
        const notes = [cell("note"), cell("def") ? `既定値：${cell("def")}` : ""].filter(Boolean);
        const stateRaw = cell("state");
        const col = {
          name, key: cell("key"), type, typeRaw, required: REQUIRED_RE.test(cell("required")),
          pk: /\bPK\b|主キー/i.test(keyCell), fk: /\bFK\b|外部キー/i.test(keyCell),
          choices: [], min: null, max: null, minOpen: false, maxOpen: false, maxLen: null, ref: null,
          basis: idsIn(cell("basis")), state: MDBLOCKS.stateOf(stateRaw), stateRaw, note: notes.join("。"), line, digits: cell("digits"),
        };
        const refs = idsIn(keyCell + " " + choiceCell).filter((x) => x.startsWith("TBL-"));
        if (type === "lookup" || col.fk) col.ref = refs[0] || null;
        if (type === "choice") col.choices = splitList(choiceCell);
        else if (type === "bool") col.choices = ["はい", "いいえ"];
        else if (type === "number" || type === "currency") Object.assign(col, rangeOf(choiceCell));
        else if (type === "text" || type === "note") col.maxLen = lenOf(choiceCell) ?? lenOf(cell("digits") && `${cell("digits")} 桁`);
        if ((type === "number" || type === "currency") && cell("digits") && num(cell("digits")) != null) col.note = [col.note, `${num(cell("digits"))} 桁`].filter(Boolean).join("。");
        if (stateRaw && !col.state) warn(line, where, `状態「${stateRaw}」は読めません（確定・検討中・仮置き・要確認・技術検証のどれか）`);
        t.cols.push(col);
      });
      check(t, warn);
    }
    const ids = new Set(out.tables.map((t) => t.id));
    for (const t of out.tables) for (const c of t.cols) if (c.ref && !ids.has(c.ref)) warn(c.line, `${t.id}.${c.name}`, `参照先 ${c.ref} がテーブル定義にありません`);
    out.warnings.sort((a, b) => a.line - b.line);
    return out;
  }
  const splitList = (s) => strip(s).split(/\s*(?:,|，|、|\/|／|\||｜)\s*/).map((x) => x.trim()).filter(Boolean);
  function rangeOf(s) {
    const t = strip(s);
    if (!t) return {};
    const c = parseCond(t.replace(/^(範囲|値)[：:]\s*/, ""));
    if (c.range) return { min: c.range[0], max: c.range[1] };
    if (c.op === ">=" || c.op === ">") return { min: c.n, minOpen: c.op === ">" };
    if (c.op === "<=" || c.op === "<") return { max: c.n, maxOpen: c.op === "<" };
    return {};
  }
  function lenOf(s) {
    const m = strip(s || "").normalize("NFKC").match(/(?:最大\s*)?(\d+)\s*(?:桁|文字|字)/);
    return m ? +m[1] : null;
  }
  function check(t, warn) {
    if (t.cols.length && !t.cols.some((c) => c.pk)) warn(t.line, t.id, "主キー（PK）の列がありません");
    const names = new Map(), keys = new Map();
    for (const c of t.cols) {
      const where = `${t.id}.${c.name}`;
      if (names.has(c.name)) warn(c.line, where, `列名「${c.name}」が重なっています（${names.get(c.name)} 行目）`); else names.set(c.name, c.line);
      if (c.key) {
        if (keys.has(c.key.toLowerCase())) warn(c.line, where, `内部名「${c.key}」が重なっています（${keys.get(c.key.toLowerCase())} 行目）`); else keys.set(c.key.toLowerCase(), c.line);
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(c.key)) warn(c.line, where, `内部名「${c.key}」に英数字と _ 以外が入っています（台帳のテーブルの列の物理名にできません）`);
      }
      if (c.type === "choice" && !c.choices.length) warn(c.line, where, "選択肢型なのに選択肢がありません（「選択肢・範囲」に , 区切りで書く）");
      if (c.type === "choice" && c.choices.some((x) => x.includes(","))) warn(c.line, where, "選択肢に , が入っています（区切りと見分けられません）");
      if ((c.type === "lookup" || c.fk) && !c.ref) warn(c.line, where, "参照の列なのに参照先の TBL ID がありません（例：FK（TBL-002））");
      if (!c.basis.length) warn(c.line, where, "根拠が空です（台帳の要件・決定・質問などの ID を書く）");
    }
  }

  // ---------- 列定義表・CSV ----------
  const pkOf = (t) => (t ? t.cols.find((c) => c.pk) || null : null);
  function constraint(c) {
    if (c.choices.length && c.type !== "bool") return c.choices.join("、");
    if (c.min != null || c.max != null) {
      if (c.min != null && c.max != null) return `${fmtN(c.min)}〜${fmtN(c.max)}`;
      if (c.min != null) return `${fmtN(c.min)} ${c.minOpen ? "より大きい" : "以上"}`;
      return `${fmtN(c.max)} ${c.maxOpen ? "未満" : "以下"}`;
    }
    if (c.maxLen) return `最大 ${c.maxLen} 文字`;
    return "";
  }
  // 定義の型 → 台帳のテーブルの論理型（schema.js の LOGICAL_TYPES）。数値は小数の印か「10,2」の桁があれば decimal
  function ledgerType(c, byId) {
    if (c.type === "number") return /小数|decimal/i.test(c.typeRaw) || /\d+\s*[,，]\s*\d+/.test(c.digits || "") ? "decimal" : "int";
    if (c.type === "lookup") { const p = pkOf(byId && byId.get(c.ref)); return p ? ledgerType(p) : "string"; }
    return { text: "string", note: "text", currency: "decimal", date: "date", datetime: "datetime", bool: "boolean", choice: "code" }[c.type] || "string";
  }
  function columnRows(model) {
    const byId = new Map(model.tables.map((t) => [t.id, t]));
    const rows = [];
    for (const t of model.tables) for (const c of t.cols) {
      const range = c.min != null || c.max != null ? constraint(c) : "";
      const ref = c.ref ? `${c.ref}${byId.get(c.ref) ? " " + byId.get(c.ref).name : ""}${pkOf(byId.get(c.ref)) ? "." + pkOf(byId.get(c.ref)).name : ""}` : "";
      rows.push({ table: `${t.id} ${t.name}`, name: c.name, key: c.key, typeName: TYPE_NAMES[c.type], ledgerType: LOGICAL_LABEL[ledgerType(c, byId)] || ledgerType(c, byId),
        required: c.required ? "○" : "", pk: c.pk ? "○" : "", ref, digits: c.maxLen ? `${c.maxLen}` : c.digits || "", range, choices: c.type === "choice" ? c.choices.join("、") : "",
        state: c.state || c.stateRaw || "", basis: c.basis.join(" "), note: c.note });
    }
    return rows;
  }
  const COLUMN_HEAD = ["テーブル", "列名", "内部名", "型（定義）", "型（台帳）", "必須", "主キー", "参照先", "桁", "範囲", "選択肢", "状態", "根拠", "備考"];
  const rowCells = (r) => [r.table, r.name, r.key, r.typeName, r.ledgerType, r.required, r.pk, r.ref, r.digits, r.range, r.choices, r.state, r.basis, r.note];
  // Excel が式として読む先頭（= + @、- の後に数以外、タブ・改行）は ' を前に付ける。「-」だけのセルと数はそのまま
  const csvCell = (s) => {
    let v = String(s == null ? "" : s);
    if (/^[=+@\t\r]/.test(v) || /^-[^\d.\s]/.test(v)) v = "'" + v;
    return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const toCsv = (rows) => "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  const columnCsv = (model) => toCsv([COLUMN_HEAD, ...columnRows(model).map(rowCells)]);
  const headerCsv = (t) => toCsv([t.cols.map((c) => c.name)]);

  return {
    parse, columnRows, columnCsv, headerCsv, ledgerType, TYPES, TYPE_NAMES, COLUMN_HEAD, rowCells, constraint, pkOf,
    // judge.js と共用
    util: { strip, idsIn, norm, sections, fields, field, num, same, boolOf, splitVals, parseCond, isNumCond, testCond, condText, fmtN, toCsv, csvCell },
  };
})();

// テーブル定義 → 台帳のテーブル（entity）の差分。design.md「テーブル定義 → 台帳のテーブル」の表のとおり
// 戻り値 { patch, warnings }。patch.ops は add だけ（既存のテーブルは書き換えない）
export function toEntityPatch(model, ledger) {
  const { strip } = TABLEDEF.util;
  const warnings = [];
  const ids = new Set(ledger.items.map((it) => it.id));
  const existing = new Map(ledger.items.filter((it) => it.kind === 'entity' && it.physicalName).map((it) => [String(it.physicalName).toLowerCase(), it]));
  const byTbl = new Map(model.tables.map((t) => [t.id, t]));
  // TBL → 台帳の参照先（同じ差分の仮 ID か、既存の EN の ID）
  const target = new Map();
  for (const t of model.tables) {
    if (!t.physical) continue;
    const ex = existing.get(t.physical.toLowerCase());
    target.set(t.id, ex ? ex.id : `new:${t.id}`);
  }
  const pkKey = (t) => { const p = TABLEDEF.pkOf(t); return p ? p.key || '' : ''; };
  const ops = [];
  for (const t of model.tables) {
    if (!t.physical) { warnings.push(`${t.id} ${t.name}: 物理名がありません（「- 物理名：」の行を足してください）。取り込みません`); continue; }
    const ex = existing.get(t.physical.toLowerCase());
    if (ex) { warnings.push(`${t.id} ${t.name}: 物理名「${t.physical}」のテーブルが台帳にあります（${ex.id}）。追加せず、参照は ${ex.id} を指します`); continue; }
    const columns = [];
    for (const c of t.cols) {
      if (!c.key) { warnings.push(`${t.id}.${c.name}: 内部名（物理名）が空なので、この列を外します`); continue; }
      const col = { name: c.key, logical: c.name, type: TABLEDEF.ledgerType(c, byTbl) };
      if (c.maxLen) col.length = c.maxLen;
      if (c.pk) col.pk = true;
      if (c.required) col.required = true;
      if (c.ref) {
        const to = target.get(c.ref);
        const refT = byTbl.get(c.ref);
        const key = refT ? pkKey(refT) : '';
        if (to && key) col.fk = { entity: to, column: key };
        else warnings.push(`${t.id}.${c.name}: 参照先 ${c.ref} を台帳のテーブルにできないので、外部キーを付けません（参照先に物理名か主キーの内部名がありません）`);
      }
      const note = [
        c.min != null || c.max != null ? `範囲: ${TABLEDEF.constraint(c)}` : '',
        c.type === 'choice' && c.choices.length ? `選択肢: ${c.choices.join(' / ')}` : '',
        c.state || c.stateRaw ? `状態: ${c.state || c.stateRaw}` : '',
        c.basis.length ? `根拠: ${c.basis.join(' ')}` : '',
        c.note || '',
      ].filter(Boolean).join('。');
      if (note) col.note = note;
      columns.push(col);
    }
    const item = { kind: 'entity', title: strip(t.name), physicalName: t.physical, fileType: t.fileType || 'internal', columns, status: 'draft' };
    const known = t.basis.filter((id) => ids.has(id));
    const unknown = t.basis.filter((id) => !ids.has(id));
    if (known.length) item.links = known;
    const body = [t.desc, unknown.length ? `根拠（台帳に無い ID）: ${unknown.join(' ')}` : '', `テーブル定義 ${t.id} から取り込み`].filter(Boolean).join('\n');
    item.body = body;
    ops.push({ op: 'add', tempId: `new:${t.id}`, item });
  }
  return { patch: { type: 'ledger-patch', basedOnRevision: ledger.revision, summary: 'テーブル定義から台帳のテーブルへ', ops }, warnings };
}
