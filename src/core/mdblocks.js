// 写した部品: gemini-kit src/js/md.js のパース（RE・splitRow・parse・nest）と、src/js/docview.js の unwrapFence・tableCols・stateOf（2026-11-26）。
// 描画（render）は写さない。判断・データ（core/judge.js・core/table-def.js）が md の表・コードブロック・見出しを読むのに使う
export const MDBLOCKS = (() => {
  // ---------- パース ----------
  const RE = {
    fence: /^\s*(```|~~~)\s*([\w-]*)\s*$/,
    heading: /^(#{1,6})\s+(.*?)\s*#*\s*$/,
    tableRow: /^\s*\|.*\|\s*$/,
    tableSep: /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/,
    list: /^(\s*)([-*+]|\d+[.)])\s+(.*)$/,
    quote: /^\s*>\s?(.*)$/,
    hr: /^\s*([-*_])(\s*\1){2,}\s*$/,
  };

  function splitRow(line) {
    let s = line.trim().replace(/^\|/, "").replace(/\|$/, "");
    const cells = [];
    let cur = "";
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "\\" && s[i + 1] === "|") { cur += "|"; i++; continue; }
      if (s[i] === "|") { cells.push(cur.trim()); cur = ""; continue; }
      cur += s[i];
    }
    cells.push(cur.trim());
    return cells;
  }

  // 戻り値：[{type, line, ...}]。line は 1 始まりの開始行
  function parse(src) {
    const lines = String(src || "").replace(/\r\n?/g, "\n").split("\n");
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const start = i + 1;
      let m;
      if ((m = line.match(RE.fence))) {
        const mark = m[1];
        const buf = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith(mark)) buf.push(lines[i++]);
        i++;
        blocks.push({ type: "code", lang: m[2].toLowerCase(), text: buf.join("\n"), line: start, end: i });
        continue;
      }
      if ((m = line.match(RE.heading))) {
        blocks.push({ type: "heading", level: m[1].length, text: m[2], line: start, end: start });
        i++;
        continue;
      }
      if (RE.tableRow.test(line) && i + 1 < lines.length && RE.tableSep.test(lines[i + 1])) {
        const head = splitRow(line);
        const align = splitRow(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? "center" : /-:$/.test(c) ? "right" : ""));
        i += 2;
        const rows = [];
        while (i < lines.length && RE.tableRow.test(lines[i])) rows.push(splitRow(lines[i++]));
        blocks.push({ type: "table", head, align, rows, line: start, end: i });
        continue;
      }
      if (RE.list.test(line)) {
        const items = [];
        while (i < lines.length) {
          const l = lines[i];
          const lm = l.match(RE.list);
          if (lm) {
            let text = lm[3];
            let check = null;
            const cb = text.match(/^\[( |x|X)\]\s*/);
            if (cb) { check = cb[1] !== " "; text = text.slice(cb[0].length); }
            items.push({ indent: lm[1].replace(/\t/g, "    ").length, ordered: /\d/.test(lm[2]), num: parseInt(lm[2], 10) || null, text, check, line: i + 1 });
            i++;
            continue;
          }
          // 箇条書きの続きの行（字下げされた文）は直前の項目につなげる
          if (l.trim() && /^\s{2,}/.test(l) && items.length) { items[items.length - 1].text += "\n" + l.trim(); i++; continue; }
          break;
        }
        blocks.push({ type: "list", items: nest(items), line: start, end: i });
        continue;
      }
      if (RE.quote.test(line)) {
        const buf = [];
        while (i < lines.length && RE.quote.test(lines[i])) buf.push(lines[i++].match(RE.quote)[1]);
        blocks.push({ type: "quote", text: buf.join("\n"), line: start, end: i });
        continue;
      }
      if (RE.hr.test(line)) { blocks.push({ type: "hr", line: start, end: start }); i++; continue; }
      if (!line.trim()) { i++; continue; }
      const buf = [];
      while (i < lines.length && lines[i].trim() && !RE.fence.test(lines[i]) && !RE.heading.test(lines[i]) && !RE.list.test(lines[i]) && !RE.quote.test(lines[i]) && !(RE.tableRow.test(lines[i]) && i + 1 < lines.length && RE.tableSep.test(lines[i + 1]))) buf.push(lines[i++]);
      blocks.push({ type: "para", text: buf.join("\n"), line: start, end: i });
    }
    return blocks;
  }

  // 字下げの深さで入れ子にする。{text, check, ordered, line, children:[]}
  function nest(flat) {
    const root = { children: [], indent: -1 };
    const stack = [root];
    for (const it of flat) {
      const node = Object.assign({}, it, { children: [] });
      while (stack.length > 1 && it.indent <= stack[stack.length - 1].indent) stack.pop();
      stack[stack.length - 1].children.push(node);
      stack.push(node);
    }
    return root.children;
  }

  // ---------- 文書の表の状態列・根拠列（docview.js から） ----------
  const STATES = { "確定": "ok", "検討中": "wip", "仮置き": "tmp", "要確認": "ask", "技術検証": "tech" };
  const STATE_COL = /^(状態|ステータス)$/;
  const SRC_COL = /^(根拠|出典|根拠・出典|根拠（カルテ）)$/;
  const stripMd = (s) => String(s).replace(/\*\*|`/g, "").trim();
  const tableCols = (head) => {
    const h = (head || []).map((x) => stripMd(x));
    return { st: h.findIndex((x) => STATE_COL.test(x)), src: h.findIndex((x) => SRC_COL.test(x)) };
  };
  const stateOf = (cell) => { const s = stripMd(cell || "").replace(/^【(.*)】$/, "$1").trim(); return STATES[s] ? s : null; };

  // Gemini が本文を ```markdown の 1 つの囲みで返したときは中身だけにする（docview.js から）
  function unwrapFence(src) {
    const t = String(src == null ? "" : src).replace(/\r\n?/g, "\n");
    const m = t.match(/^\s*(`{3,}|~{3,})[ \t]*([\w-]*)[ \t]*\n([\s\S]*?)\n?[ \t]*\1[ \t]*\s*$/);
    if (!m) return src;
    const lang = m[2].toLowerCase();
    if (lang && lang !== "markdown" && lang !== "md") return src;
    if (m[1] === "```" && !lang) return src;
    // 3つの囲みのとき、中に閉じていない ``` があれば囲みではない（中のコードブロックを壊さない）
    const inner = m[3];
    if (m[1].length === 3 && m[1][0] === "`" && (inner.match(/^[ \t]*```/gm) || []).length % 2) return src;
    return inner;
  }

  return { parse, splitRow, unwrapFence, tableCols, stateOf, STATES };
})();
