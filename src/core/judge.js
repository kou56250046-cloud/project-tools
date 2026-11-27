// 写した部品: gemini-kit src/js/judge.js（2026-11-26）。判断マスタのパース・網羅の点検・突き合わせ・ケース・デモ・まとめ保存
// 変えたところ: 突き合わせる相手をカルテから台帳にした（refState の表。design.md「台帳の ID の状態」）。
// カルテの追加分（kartePatch）は、台帳の質問の差分（questionPatch）にした。

import { KINDS } from './schema.js';
import { FLOWCHART } from './flow.js';
import { MDBLOCKS } from './mdblocks.js';
import { TABLEDEF } from './table-def.js';

export const JUDGE = (() => {
  // 外から来た見出し・ID をキーにする表は、プロトタイプの無い表にする（constructor などの名前で継承したものに当たらない。写し元から変えた）
  // 台帳の ID か（JDG・TBL は判断マスタとテーブル定義の ID）
  const LEDGER_PFX = new Set(Object.values(KINDS).map((k) => k.prefix));
  const isLedgerId = (id) => LEDGER_PFX.has(String(id).split("-")[0]);
  // 台帳の項目の状態 → ✓（ok: true）か ?（ok: false と理由）。項目が無ければ ?（台帳に無い）
  const CONF_OK = (it) => it.confidence === "fact" || it.confidence === "confirmed";
  function refState(it) {
    if (!it) return { ok: false, why: "台帳に無い" };
    switch (it.kind) {
      case "question": return it.status === "open" ? { ok: false, why: "未回答" } : { ok: true };
      case "issue": return it.status === "closed" ? { ok: true } : { ok: false, why: "未解決" };
      case "request": return it.status === "accepted" ? { ok: true } : { ok: false, why: it.status === "rejected" ? "不採用" : "未決" };
      case "requirement":
      case "constraint":
        if (it.status === "dropped") return { ok: false, why: "取り下げ" };
        if (it.kind === "constraint" && it.status === "resolved") return { ok: true };
        if (it.confidence === "guess") return { ok: false, why: "推測" };
        if (CONF_OK(it) || (!it.confidence && it.kind === "requirement" && it.status === "agreed")) return { ok: true };
        return { ok: false, why: "未合意" };
      case "decision": return it.status === "valid" ? { ok: true } : { ok: false, why: "置き換え済み" };
      case "change": return it.status === "approved" ? { ok: true } : { ok: false, why: it.status === "proposed" ? "未承認" : it.status === "rejected" ? "却下" : "取り下げ" };
      case "entity": case "screen": case "interface": case "batch": case "bizflow":
        return it.status === "fixed" ? { ok: true } : { ok: false, why: it.status === "dropped" ? "取り下げ" : "案" };
      default: return { ok: true };
    }
  }
  const U = TABLEDEF.util;
  const ROLE_NAME = (k) => (k && FLOWCHART.ROLES[k] ? FLOWCHART.ROLES[k].name : "");
  const LIMIT = 512; // 網羅の点検で列挙する組み合わせの上限
  const MAX_STEPS = 200; // デモの歩数の上限
  const EXAMPLES = 5;

  // ---------- 判断マスタのパース ----------
  const NO_COL = /^(no|№|番号|項番|#|行|行番号|連番)$/i;
  const isNoCol = (h) => NO_COL.test(String(h).normalize("NFKC").replace(/[.．。:：\s]+$/, "").trim());
  const RESULT_COL = /^(結果|判定|判定結果|出口)$/;
  const OTHER_COL = /^(根拠|出典|根拠・出典|根拠（カルテ）|状態|ステータス|備考|説明|メモ)$/;
  const UNKNOWN_RESULT = /^(|\?|？|未定|要確認|不明|tbd|-|－)$/i;
  const splitInputs = (s) => U.strip(s).split(/\s*(?:,|，|、)\s*/).map((x) => x.trim()).filter(Boolean);

  function parse(src) {
    const out = { judges: [], warnings: [] };
    const warn = (line, where, message) => out.warnings.push({ line, where, message });
    const seen = new Map();
    for (const s of U.sections(src, "JDG")) {
      const f = U.fields(s.blocks);
      const fx = (names) => U.field(f, names);
      const txt = (names) => { const x = fx(names); return x ? [x.text, ...x.items].filter(Boolean).join(" ／ ") : ""; };
      const roleF = fx(["区分", "判断の区分", "担い手の区分"]);
      const role = roleF ? FLOWCHART.roleOf(U.strip(roleF.text).replace(/\s+/g, "")) : null;
      const inputsF = fx(["見る項目", "入力", "見るデータ", "参照する項目"]);
      const exF = fx(["境界の例", "迷う例", "判断の例"]);
      const j = {
        id: s.id, title: s.title || s.id, role, roleRaw: roleF ? roleF.text : "", actor: txt(["判断する仕組み・人", "判断する仕組み", "判断する人", "担い手", "担当"]),
        inputs: inputsF ? [...splitInputs(inputsF.text), ...inputsF.items] : [], basis: U.idsIn(txt(["根拠", "出典"])),
        criteria: txt(["判断基準", "基準"]), examples: exF ? [exF.text, ...exF.items].filter(Boolean) : [],
        contact: txt(["連絡先", "例外のときの連絡先", "相談先", "問い合わせ先"]), guide: txt(["判断の目安", "目安"]),
        condCols: [], rows: [], hasTable: false, line: s.line,
      };
      if (seen.has(j.id)) warn(s.line, j.id, `${j.id} が 2 回定義されています（最初は ${seen.get(j.id)} 行目）`);
      else seen.set(j.id, s.line);
      if (!roleF) warn(s.line, j.id, "区分（ルール・AI・人・外部）がありません");
      else if (!role) warn(roleF.line, j.id, `区分「${roleF.text}」は読めません（ルール・AI・人・外部のどれか）`);
      const tb = s.blocks.find((b) => b.type === "table" && b.head.some((h) => RESULT_COL.test(U.strip(h))));
      if (tb) {
        j.hasTable = true;
        const head = tb.head.map(U.strip);
        const ri = head.findIndex((h) => RESULT_COL.test(h));
        const cols = MDBLOCKS.tableCols(tb.head);
        const noI = head.findIndex(isNoCol);
        const condIdx = head.map((h, i) => i).filter((i) => head[i] && i !== ri && i !== noI && !OTHER_COL.test(head[i]));
        j.condCols = condIdx.map((i) => head[i]);
        tb.rows.forEach((r, k) => {
          // 「交通費|備品」のように表の中で | を使うと列がずれる
          if (r.length !== tb.head.length) warn(tb.line + 2 + k, j.id, `判定表の ${k + 1} 行目のセルが ${r.length} 個です（見出しは ${tb.head.length} 個）。セルの中で | を使うと列がずれます。「どれか」は 交通費、備品 のように 、 で書く`);
          const raw = Object.create(null), conds = Object.create(null);
          for (const i of condIdx) { raw[head[i]] = U.strip(r[i] || ""); conds[head[i]] = U.parseCond(r[i] || ""); }
          const resultRaw = U.strip(r[ri] || "");
          const stateRaw = cols.st >= 0 ? U.strip(r[cols.st] || "") : "";
          j.rows.push({
            no: (noI >= 0 && U.strip(r[noI] || "")) || String(k + 1), conds, raw, result: UNKNOWN_RESULT.test(resultRaw) ? null : resultRaw, resultRaw,
            basis: cols.src >= 0 ? U.idsIn(r[cols.src]) : [], state: MDBLOCKS.stateOf(stateRaw), stateRaw, line: tb.line + 2 + k,
          });
        });
        if (cols.st < 0) warn(tb.line, j.id, "判定表に「状態」列がありません（行はすべて未確定として扱います）");
        if (!j.rows.length) warn(tb.line, j.id, "判定表に行がありません");
      }
      if (role === "rule" && !tb) warn(s.line, j.id, "ルール区分なのに判定表（「結果」列を持つ表）がありません");
      if (role === "ai" && !j.criteria) warn(s.line, j.id, "AI 区分なのに判断基準がありません");
      if (role === "ai" && !j.examples.length) warn(s.line, j.id, "AI 区分なのに境界の例（迷う例と正しい結果）がありません");
      if (role === "human" && !j.contact) warn(s.line, j.id, "人の区分なのに連絡先（迷ったときに聞く相手）がありません");
      out.judges.push(j);
    }
    out.warnings.sort((a, b) => a.line - b.line);
    return out;
  }

  // ---------- 網羅の点検（ルール区分） ----------
  // colOf(条件列) → テーブル定義の列（なければ null）。戻り値 { total, skipped, gaps:{count, examples}, conflicts:{count, examples} }
  function coverage(j, colOf) {
    const cols = j.condCols;
    const points = cols.map((name) => {
      const cs = j.rows.map((r) => r.conds[name]);
      const col = colOf ? colOf(name) : null;
      if (cs.every((c) => c.any)) return [null];
      const numeric = (col && (col.type === "number" || col.type === "currency")) || cs.every((c) => c.any || U.isNumCond(c));
      if (numeric) {
        const ts = [];
        for (const c of cs) {
          if (c.op) ts.push(c.n);
          if (c.range) ts.push(c.range[0], c.range[1]);
          for (const x of [...(c.eq || []), ...(c.ne || [])]) if (U.num(x) != null) ts.push(U.num(x));
        }
        const uniq = [...new Set(ts)].sort((a, b) => a - b);
        const d = uniq.every(Number.isInteger) ? 1 : 1e-6;
        let arr = [...new Set(uniq.flatMap((t) => [t - d, t, t + d]))].sort((a, b) => a - b);
        if (col && col.min != null) arr = arr.filter((x) => (col.minOpen ? x > col.min : x >= col.min));
        if (col && col.max != null) arr = arr.filter((x) => (col.maxOpen ? x < col.max : x <= col.max));
        return arr.length ? arr.map(String) : [null];
      }
      if (col && col.choices.length) return col.choices.slice();
      const vals = [];
      for (const c of cs) for (const v of [...(c.eq || []), ...(c.ne || [])]) if (!vals.some((x) => U.same(x, v))) vals.push(v);
      if (cs.some((c) => c.ne)) vals.push("（ほかの値）");
      return vals.length ? vals : [null];
    });
    const total = points.reduce((p, a) => p * a.length, 1);
    const res = { total, skipped: false, gaps: { count: 0, examples: [] }, conflicts: { count: 0, examples: [] } };
    if (!j.rows.length) return res;
    if (total > LIMIT) { res.skipped = true; return res; }
    const show = (vals) => cols.map((c, i) => (vals[i] == null ? null : `${c}=${U.num(vals[i]) != null ? U.fmtN(U.num(vals[i])) : vals[i]}`)).filter(Boolean).join("・") || "（条件なし）";
    const idx = new Array(cols.length).fill(0);
    for (let n = 0; n < total; n++) {
      const vals = idx.map((k, i) => points[i][k]);
      const hit = j.rows.filter((r) => cols.every((c, i) => vals[i] == null || U.testCond(r.conds[c], vals[i])));
      if (!hit.length) { res.gaps.count++; if (res.gaps.examples.length < EXAMPLES) res.gaps.examples.push(show(vals)); }
      else {
        const known = [...new Set(hit.filter((r) => r.result != null).map((r) => U.norm(r.result)))];
        if (known.length > 1) { res.conflicts.count++; if (res.conflicts.examples.length < EXAMPLES) res.conflicts.examples.push(`${show(vals)}（No.${hit.filter((r) => r.result != null).map((r) => r.no).join("・No.")}）`); }
      }
      for (let i = cols.length - 1; i >= 0; i--) { if (++idx[i] < points[i].length) break; idx[i] = 0; }
    }
    return res;
  }

  // ---------- 突き合わせ ----------
  const PENDING_DONE = /^(決定|確定|済|完了|解決|クローズ)/;
  const flowText = (src) => {
    const t = String(src == null ? "" : src);
    const b = MDBLOCKS.parse(t).find((x) => x.type === "code" && x.lang === "flow");
    return b ? b.text : t;
  };
  // ```flow の囲みの中を読むとき、欄の行番号に直すために足す行数（囲みの開始行。囲みが無ければ 0）
  const flowLineOffset = (src) => {
    const b = MDBLOCKS.parse(String(src == null ? "" : src)).find((x) => x.type === "code" && x.lang === "flow");
    return b ? b.line : 0;
  };

  function analyze(inp) {
    const flowSrc = String((inp && inp.flow) || ""), ledger = (inp && inp.ledger) || null;
    const T = TABLEDEF.parse((inp && inp.tables) || "");
    const J = parse((inp && inp.master) || "");
    const graph = flowSrc.trim() ? FLOWCHART.parse(flowText(flowSrc)) : null;
    // 囲みの中を読んだときは、誤り・警告・箱・線の行番号を欄の行番号に直す（点検の「N 行目」で正しい行へ移る）
    const off = flowSrc.trim() ? flowLineOffset(flowSrc) : 0;
    if (graph && off) for (const x of [...graph.errors, ...graph.warnings, ...graph.nodes, ...graph.edges]) if (typeof x.line === "number") x.line += off;
    const warnings = [];
    const seenW = new Set();
    // src：警告の元の入力（flow / master / tables）。画面で行へ飛ぶのに使う
    const srcOf = (kind, where) => (kind === "テーブル" ? "tables" : kind === "判断マスタ" ? "master" : kind === "フロー" ? "flow"
      : kind === "台帳" ? null : /^TBL-/.test(where) ? "tables" : /^JDG-/.test(where) ? "master" : graph && graph.nodes.some((n) => n.id === where) ? "flow" : null);
    const W = (kind, where, message, line) => { const k = `${kind}|${where}|${message}`; if (seenW.has(k)) return; seenW.add(k); warnings.push({ kind, where, message, line: line || null, src: srcOf(kind, where) }); };
    for (const w of T.warnings) W("テーブル", w.where, w.message, w.line);
    for (const w of J.warnings) W("判断マスタ", w.where, w.message, w.line);
    if (graph) {
      for (const e of graph.errors) W("フロー", `${e.line} 行目`, e.message, e.line);
      for (const e of graph.warnings) W("フロー", `${e.line} 行目`, e.message, e.line);
    }

    // 台帳（写し元はカルテ。ID の状態は refState の表で決める）
    const L = ledger ? new Map(ledger.items.map((it) => [it.id, it])) : null;
    if (!ledger) W("台帳", "—", "台帳を渡していないので、根拠の ID の点検をしていません");
    // 未確定の参照なら、理由の文を返す（台帳に無い ID も未確定）
    const openWhy = (id) => {
      if (!isLedgerId(id) || !L) return null;
      const r = refState(L.get(id));
      return r.ok ? null : `${id} が${r.why}`;
    };
    const checkRefs = (ids, where, line) => {
      if (!L) return;
      for (const id of ids) {
        if (!isLedgerId(id)) continue;
        const it = L.get(id);
        if (!it) { W("台帳", where, `${id} が台帳にありません`, line); continue; }
        if (it.kind === "question" && it.status !== "open") W("台帳", where, `${id} は回答済みです${it.answer ? `（${String(it.answer).slice(0, 40)}）` : ""}。判断マスタ・テーブル定義の根拠と状態を直してください`, line);
      }
    };
    // 聞く相手: 未回答の質問の質問先（関係者の名前）
    const askOf = (ids) => { for (const id of ids) { const it = L && L.get(id); if (it && it.kind === "question" && it.askTo) { const p = L.get(it.askTo); return p ? p.title : it.askTo; } } return ""; };
    const qsOf = (ids) => [...new Set(ids.filter((id) => openWhy(id)))];

    // テーブルの列
    const tables = T.tables;
    for (const t of tables) { checkRefs(t.basis, t.id, t.line); for (const c of t.cols) checkRefs(c.basis, `${t.id}.${c.name}`, c.line); }
    const findTable = (s) => tables.find((t) => t.id === s.trim() || U.norm(t.name) === U.norm(s));
    const sameCol = (c, s) => U.norm(c.name) === U.norm(s) || (c.key && U.norm(c.key) === U.norm(s));
    function resolve(ref) {
      const s = U.strip(ref);
      const m = s.match(/^(.+?)[.．](.+)$/);
      if (m) {
        const t = findTable(m[1]);
        if (t) { const c = t.cols.find((x) => sameCol(x, m[2])); return c ? [{ t, c }] : []; }
      }
      const hits = [];
      for (const t of tables) for (const c of t.cols) if (sameCol(c, s)) hits.push({ t, c });
      return hits;
    }
    if (J.judges.length && !tables.length) W("つながり", "—", "テーブル定義がないので、見る項目と列の突き合わせをしていません");
    const colState = (c) => (c.state === "確定" ? null : `${c.state || "状態なし"}`);

    // 判断ごと
    const judgeInfo = Object.create(null);
    for (const j of J.judges) {
      const reasons = [];
      const refs = [...j.basis, ...j.rows.flatMap((r) => r.basis)];
      checkRefs(j.basis, j.id, j.line);
      for (const r of j.rows) checkRefs(r.basis, `${j.id} No.${r.no}`, r.line);
      for (const id of new Set(refs)) { const w = openWhy(id); if (w) reasons.push(w); }
      for (const r of j.rows) {
        if (r.result == null) reasons.push(`判定表 No.${r.no} の結果が決まっていない`);
        else if (r.state !== "確定") reasons.push(`判定表 No.${r.no} が${r.stateRaw || "状態なし"}`);
      }
      // 見る項目と条件列を列に結び付ける
      const inputCols = [];
      const colMap = Object.create(null);
      if (tables.length) {
        for (const inp2 of j.inputs) {
          const hits = resolve(inp2);
          if (!hits.length) W("つながり", j.id, `見る項目「${inp2}」がどのテーブルの列にもありません`, j.line);
          else if (hits.length > 1) W("つながり", j.id, `見る項目「${inp2}」は ${hits.map((h) => h.t.id).join("・")} の列に当たります（テーブル名.列名 で書く）`, j.line);
          else inputCols.push({ input: inp2, t: hits[0].t, c: hits[0].c });
        }
        for (const name of j.condCols) {
          const viaInput = inputCols.find((x) => U.norm(x.input) === U.norm(name) || sameCol(x.c, name));
          let hit = viaInput ? { t: viaInput.t, c: viaInput.c } : null;
          if (!hit) {
            const hits = resolve(name);
            if (hits.length === 1) hit = hits[0];
            else if (!hits.length) W("つながり", j.id, `判定表の条件列「${name}」がどのテーブルの列にもありません`, j.line);
            else W("つながり", j.id, `判定表の条件列「${name}」は ${hits.map((h) => h.t.id).join("・")} の列に当たります（見る項目に テーブル名.列名 で書く）`, j.line);
          }
          if (hit) colMap[name] = hit;
        }
        // 条件の値が列に合うか
        for (const name of j.condCols) {
          const h = colMap[name];
          if (!h) continue;
          const c = h.c;
          const isNum = c.type === "number" || c.type === "currency";
          for (const r of j.rows) {
            const cd = r.conds[name];
            if (cd.any) continue;
            if (isNum && (cd.eq || cd.ne) && ![...(cd.eq || []), ...(cd.ne || [])].every((v) => U.num(v) != null)) W("つながり", `${j.id} No.${r.no}`, `「${r.raw[name]}」は数の条件として読めません（${h.t.id}.${c.name} は${TABLEDEF.TYPE_NAMES[c.type]}型。>=5000・5000〜99999・10万以上50万未満 のように書く）`, r.line);
            if ((cd.op || cd.range) && !isNum) W("つながり", `${j.id} No.${r.no}`, `「${r.raw[name]}」は数の条件ですが、${h.t.id}.${c.name} は${TABLEDEF.TYPE_NAMES[c.type]}型です`, r.line);
            if (c.choices.length) for (const v of [...(cd.eq || []), ...(cd.ne || [])]) if (!c.choices.some((x) => U.same(x, v))) W("つながり", `${j.id} No.${r.no}`, `条件の値「${v}」は ${h.t.id}.${c.name} の選択肢（${c.choices.join("、")}）にありません`, r.line);
          }
        }
        const used = new Map();
        for (const x of [...inputCols, ...Object.values(colMap)]) used.set(`${x.t.id}.${x.c.name}`, x);
        for (const [key, x] of used) { const st = colState(x.c); if (st) reasons.push(`${key} が${st}`); }
      }
      // 書き方が足りない判断は、表や基準があっても決まっているとは言えない
      if (!j.role) reasons.push("区分（ルール・AI・人・外部）が読めない");
      if (j.role === "rule" && !j.rows.length) reasons.push("ルール区分なのに判定表（の行）がない");
      if (j.role === "ai" && (!j.criteria || !j.examples.length)) reasons.push("AI 区分なのに判断基準か境界の例がない");
      if (j.role === "human" && !j.contact) reasons.push("人の区分なのに連絡先がない");
      let cov = null;
      if (j.role === "rule" && j.rows.length) {
        cov = coverage(j, (name) => (colMap[name] ? colMap[name].c : null));
        if (cov.skipped) W("判断マスタ", j.id, `組み合わせが ${cov.total} 通り（上限 ${LIMIT}）あるので、漏れ・矛盾を調べていません`, j.line);
        if (cov.gaps.count) { const m = `判定表に当たらない組み合わせが ${cov.gaps.count} 通りあります（例：${cov.gaps.examples.join(" ／ ")}）`; W("判断マスタ", j.id, m, j.line); reasons.push(m); }
        if (cov.conflicts.count) { const m = `結果が食い違う組み合わせが ${cov.conflicts.count} 通りあります（例：${cov.conflicts.examples.join(" ／ ")}）`; W("判断マスタ", j.id, m, j.line); reasons.push(m); }
      }
      judgeInfo[j.id] = { judge: j, reasons: [...new Set(reasons)], refs: [...new Set(refs)], inputCols, colMap, coverage: cov, nodes: [] };
    }

    // フローの分岐・データ
    const nodes = Object.create(null);
    const marks = Object.create(null);
    const usable = graph && !graph.errors.length;
    if (usable) {
      const tblById = new Map(tables.map((t) => [t.id, t]));
      for (const n of graph.nodes) {
        const refs = n.refs || [];
        const outs = graph.edges.filter((e) => e.from === n.id);
        if (n.type === "decision") {
          const reasons = [];
          let state = "ok";
          const jids = refs.filter((r) => r.startsWith("JDG-"));
          for (const id of refs.filter((r) => !/^(JDG|TBL)-/.test(r))) { const w = openWhy(id); if (w) reasons.push(w); checkRefs([id], n.id, n.line); }
          if (!jids.length) { state = reasons.length ? "open" : "none"; if (!reasons.length) reasons.push("判断マスタ（JDG）を引いていない"); }
          for (const jid of jids) {
            const info = judgeInfo[jid];
            if (!info) { W("つながり", n.id, `${jid} が判断マスタにありません`, n.line); reasons.push(`${jid} が判断マスタにない`); state = "none"; continue; }
            info.nodes.push(n.id);
            reasons.push(...info.reasons);
            const j = info.judge;
            if (n.role && j.role && n.role !== j.role) W("つながり", n.id, `分岐の区分（${ROLE_NAME(n.role)}）と ${jid} の区分（${ROLE_NAME(j.role)}）が違います`, n.line);
            const labels = outs.map((e) => e.label).filter(Boolean);
            const results = [];
            for (const r of j.rows) if (r.result != null && !results.some((x) => U.same(x, r.result))) results.push(r.result);
            if (results.length) {
              for (const r of results) if (!labels.some((l) => U.same(l, r))) { const m = `${jid} の結果「${r}」がフローの出口にない`; W("つながり", n.id, m, n.line); reasons.push(m); }
              for (const l of labels) if (!results.some((r) => U.same(l, r))) { const m = `出口「${l}」になる行が ${jid} の判定表にない`; W("つながり", n.id, m, n.line); reasons.push(m); }
            }
          }
          if (state !== "none" && reasons.length) state = "open";
          nodes[n.id] = { kind: "decision", state, refs, jdg: jids[0] || null, reasons: [...new Set(reasons)], label: n.label, role: n.role, exits: outs.map((e) => e.label || "") };
          marks[n.id] = state;
        } else if (n.type === "data") {
          const tids = refs.filter((r) => r.startsWith("TBL-"));
          if (!tids.length) continue;
          const reasons = [];
          let state = "ok";
          for (const tid of tids) {
            const t = tblById.get(tid);
            if (!t) { W("つながり", n.id, `${tid} がテーブル定義にありません`, n.line); reasons.push(`${tid} がテーブル定義にない`); state = "none"; continue; }
            for (const c of t.cols) { const st = colState(c); if (st) reasons.push(`${t.id}.${c.name} が${st}`); }
          }
          if (state !== "none" && reasons.length) state = "open";
          nodes[n.id] = { kind: "data", state, refs, table: tids[0], reasons, label: n.label, role: n.role };
          marks[n.id] = state;
        }
      }
      for (const j of J.judges) if (!judgeInfo[j.id].nodes.length) W("つながり", j.id, "フローのどの分岐からも引かれていません", j.line);
    }

    // 確認が必要な事項
    const items = [];
    const exitsOf = (jid) => { const info = judgeInfo[jid]; const ls = []; for (const nid of info.nodes) for (const l of nodes[nid].exits) if (l && !ls.includes(l)) ls.push(l); return ls; };
    for (const j of J.judges) {
      const info = judgeInfo[j.id];
      if (!info.reasons.length) continue;
      const qs = qsOf(info.refs);
      const results = [...new Set(j.rows.map((r) => r.result).filter(Boolean))];
      items.push({ kind: "判断", id: j.id, title: j.title, role: ROLE_NAME(j.role), reasons: info.reasons, reason: info.reasons.join(" ／ "), askTo: askOf(qs) || j.contact || j.actor, options: (exitsOf(j.id).length ? exitsOf(j.id) : results).join("、"), qs: qs.join("、") });
    }
    if (usable) for (const n of graph.nodes) {
      const x = nodes[n.id];
      if (!x || x.kind !== "decision" || (x.jdg && judgeInfo[x.jdg])) continue; // マスタにない JDG を引く分岐もここに出す
      const qs = qsOf(x.refs);
      items.push({ kind: "分岐", id: n.id, title: n.label, role: ROLE_NAME(n.role), reasons: x.reasons, reason: x.reasons.join(" ／ "), askTo: askOf(qs), options: x.exits.filter(Boolean).join("、"), qs: qs.join("、") });
    }
    for (const t of tables) for (const c of t.cols) {
      const st = colState(c);
      if (!st) continue;
      const qs = qsOf(c.basis);
      const whys = [st, ...qs.map(openWhy).filter(Boolean)];
      items.push({ kind: "テーブル", id: `${t.id}.${c.name}`, title: t.name, role: "", reasons: whys, reason: whys.join(" ／ "), askTo: askOf(qs), options: c.choices.join("、"), qs: qs.join("、") });
    }

    const dec = Object.values(nodes).filter((x) => x.kind === "decision");
    const counts = {
      ok: dec.filter((x) => x.state === "ok").length, open: dec.filter((x) => x.state === "open").length, none: dec.filter((x) => x.state === "none").length,
      judges: J.judges.length, tables: tables.length, cols: tables.reduce((s, t) => s + t.cols.length, 0),
      openCols: tables.reduce((s, t) => s + t.cols.filter((c) => c.state !== "確定").length, 0), warnings: warnings.length,
    };
    const openRefs = [...new Set([...J.judges.flatMap((j) => [...j.basis, ...j.rows.flatMap((r) => r.basis)]), ...tables.flatMap((t) => t.cols.flatMap((c) => c.basis))].filter((id) => openWhy(id) || (!L && isLedgerId(id) && id.startsWith(KINDS.question.prefix + "-"))))];
    return { graph, tables, model: T, judges: J.judges, judgeInfo, nodes, marks, items, warnings, counts, ledger: !!ledger, openRefs };
  }

  // ---------- 確認事項を台帳の質問にする（写し元は gemini-kit の追加分の組み立て） ----------
  // 理由がすべて台帳の既存の未回答の質問を指すものと、同じ題名の質問が台帳にあるものは入れない（2 回押しても二重にならない）
  function questionPatch(items, ledger) {
    const qp = KINDS.question.prefix;
    const openQ = new RegExp(`^${qp}-\\d+ が未回答`);
    const people = ledger.items.filter((it) => it.kind === "stakeholder");
    const titles = new Set(ledger.items.filter((it) => it.kind === "question").map((it) => U.norm(it.title)));
    const ops = [];
    for (const x of items || []) {
      const rest = (x.reasons || [x.reason]).filter((r) => r && !openQ.test(r));
      if (!rest.length) continue;
      const what = x.kind === "テーブル" ? `${x.title}（${x.id.split(".")[0]}）の列「${x.id.split(".").slice(1).join(".")}」`
        : x.kind === "分岐" ? `業務フローの分岐「${x.title}」` : `判断「${x.title}」（${x.id}）`;
      const ask = x.kind === "テーブル" ? (x.options ? `の値（${x.options}）を確定してください` : "の型・値の範囲を確定してください")
        : x.kind === "分岐" ? "は、何を見て、誰（何）が決めますか" : `の決め方を確定してください${x.options ? `（結果：${x.options}）` : ""}`;
      const title = `${what}${ask}`;
      if (titles.has(U.norm(title))) continue;
      titles.add(U.norm(title));
      const who = String(x.askTo || "").trim();
      const p = who ? people.find((it) => String(it.title).trim() === who) : null;
      const item = { kind: "question", title, status: "open", confidence: "guess", body: [`設計の点検で未確定：${rest.join(" ／ ")}`, who && !p ? `聞く相手: ${who}` : ""].filter(Boolean).join("\n"),
        sources: [{ type: "other", ref: "判断・データの点検" }] };
      if (p) item.askTo = p.id;
      const links = [...new Set((x.qs ? x.qs.split("、") : []).filter((id) => ledger.items.some((it) => it.id === id)))];
      if (links.length) item.links = links;
      ops.push({ op: "add", tempId: `new:judge-${ops.length + 1}`, item });
    }
    return { type: "ledger-patch", basedOnRevision: ledger.revision, summary: "判断・データの点検で見つかった確認事項", ops };
  }

  const ITEM_HEAD = ["種類", "ID", "題名", "区分", "未確定の理由", "聞く相手", "選択肢", "関係する未確定の項目"];
  const itemCells = (x) => [x.kind, x.id, x.title, x.role, x.reason, x.askTo, x.options, x.qs];
  const itemsCsv = (items) => U.toCsv([ITEM_HEAD, ...items.map(itemCells)]);
  const mdCell = (s) => String(s == null ? "" : s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  const itemsMarkdown = (items) => [`| ${ITEM_HEAD.join(" | ")} |`, `|${ITEM_HEAD.map(() => "---").join("|")}|`, ...items.map((x) => `| ${itemCells(x).map(mdCell).join(" | ")} |`)].join("\n") + "\n";

  // ---------- ケース ----------
  const CASE_NAME = /^(ケース|ケース名|名前|case)$/i;
  const CASE_SKIP = /^(説明|想定|期待|期待する結果|想定する結果|メモ|備考)$/;
  function caseList(src) {
    const text = MDBLOCKS.unwrapFence(String(src == null ? "" : src));
    const cases = [];
    for (const b of MDBLOCKS.parse(text)) {
      if (b.type !== "table") continue;
      const head = b.head.map(U.strip);
      const ni = head.findIndex((h) => CASE_NAME.test(h));
      if (ni < 0) continue;
      const di = head.findIndex((h) => /^(説明|想定|期待|期待する結果|想定する結果)$/.test(h));
      b.rows.forEach((r, k) => {
        const values = Object.create(null);
        head.forEach((h, i) => { if (i !== ni && h && !CASE_SKIP.test(h)) { const v = U.strip(r[i] || ""); if (v !== "") values[h] = v; } });
        cases.push({ name: U.strip(r[ni] || "") || `ケース ${cases.length + 1}`, desc: di >= 0 ? U.strip(r[di] || "") : "", values, line: b.line + 2 + k });
      });
    }
    return cases;
  }
  // 値の引き当て：名前の完全一致 → 「表.列」の列名の一致
  function valueFor(values, names) {
    const keys = Object.keys(values || {});
    for (const n of names) { if (!n) continue; const k = keys.find((x) => U.norm(x) === U.norm(n)); if (k != null && values[k] !== "") return values[k]; }
    for (const n of names) {
      if (!n) continue;
      const base = U.norm(String(n).split(/[.．]/).pop());
      const k = keys.find((x) => U.norm(x.split(/[.．]/).pop()) === base);
      if (k != null && values[k] !== "") return values[k];
    }
    return null;
  }
  // 判断の見る項目の一覧（条件列と、見る項目に書かれた列）。名前の候補と結び付いた列
  function fieldsOf(info) {
    const out = [];
    const add = (label, names, hit) => {
      const key = hit ? `${hit.t.id}.${hit.c.name}` : U.norm(label);
      if (out.some((x) => x.key === key)) return;
      out.push({ key, label: hit ? `${hit.t.name}.${hit.c.name}` : label, names: [...names, ...(hit ? [`${hit.t.name}.${hit.c.name}`, `${hit.t.id}.${hit.c.name}`, hit.c.name] : [])], t: hit ? hit.t : null, c: hit ? hit.c : null });
    };
    for (const name of info.judge.condCols) { const hit = info.colMap[name]; const viaInput = hit && info.inputCols.find((x) => x.c === hit.c); add(name, [name, viaInput ? viaInput.input : null].filter(Boolean), hit); }
    for (const x of info.inputCols) add(x.input, [x.input], x);
    for (const inp of info.judge.inputs) if (!info.inputCols.some((x) => x.input === inp)) add(inp, [inp], null);
    return out;
  }
  // 値が列の型・選択肢・範囲・必須に合うか。合わなければ理由の文
  function badValue(c, v) {
    if (!c) return null;
    const where = c.name;
    if (v == null || v === "") return c.required ? `${where} の値がありません（必須）` : null;
    if (c.type === "number" || c.type === "currency") {
      const n = U.num(v);
      if (n == null) return `${where} の値「${v}」が数ではありません`;
      if (c.min != null && (c.minOpen ? n <= c.min : n < c.min)) return `${where} の値「${v}」が範囲（${TABLEDEF.constraint(c)}）の外です`;
      if (c.max != null && (c.maxOpen ? n >= c.max : n > c.max)) return `${where} の値「${v}」が範囲（${TABLEDEF.constraint(c)}）の外です`;
    }
    if ((c.type === "choice" || c.type === "bool") && c.choices.length && !c.choices.some((x) => U.same(x, v))) return `${where} の値「${v}」が選択肢（${c.choices.join("、")}）にありません`;
    if ((c.type === "date" || c.type === "datetime") && !/^\d{4}[-/年]\d{1,2}[-/月]\d{1,2}/.test(String(v))) return `${where} の値「${v}」が日付として読めません`;
    if ((c.type === "text" || c.type === "note") && c.maxLen && [...String(v)].length > c.maxLen) return `${where} の値が ${c.maxLen} 文字を超えています`;
    return null;
  }

  // ---------- デモ ----------
  const clone = (x) => JSON.parse(JSON.stringify(x));
  function demoStart(an, values) {
    const st = { cur: null, visited: [], taken: [], log: [], status: "run", options: [], stop: null, used: [], decided: [], stopped: [], steps: 0, values: values || {} };
    const g = an.graph;
    if (!g || g.errors.length || !g.nodes.length) { st.status = "stop"; st.stop = { reason: "フロー図がないか、エラーがあります", items: [] }; return st; }
    const s0 = g.nodes.find((n) => n.type === "start") || g.nodes.find((n) => !g.edges.some((e) => e.to === n.id)) || g.nodes[0];
    st.cur = s0.id;
    st.visited.push(s0.id);
    st.log.push({ node: s0.id, kind: "info", text: `開始：${s0.label}` });
    return st;
  }
  function demoStep(st0, an, choice) {
    if (st0.status === "done" || st0.status === "stop") return st0;
    const st = clone(st0);
    const g = an.graph;
    const byId = (id) => g.nodes.find((n) => n.id === id);
    const node = byId(st.cur);
    const outs = g.edges.filter((e) => e.from === node.id);
    const label = (n) => n.label.replace(/\n/g, "");
    const stop = (reason, items) => { st.status = "stop"; st.options = []; st.stop = { reason, items: items || [] }; st.stopped.push({ node: node.id, id: (an.nodes[node.id] && an.nodes[node.id].jdg) || node.id, reason }); st.log.push({ node: node.id, kind: "stop", text: `止まる：${reason}` }); return st; };
    const go = (e) => {
      st.taken.push(`${e.from}>${e.to}`);
      st.cur = e.to;
      st.visited.push(e.to);
      st.status = "run";
      st.options = [];
      const t = byId(e.to);
      st.log.push({ node: t.id, kind: "move", text: `${e.label ? `「${e.label}」で ` : ""}${t.id} ${label(t)} へ` });
      if (t.type === "end") { st.status = "done"; st.log.push({ node: t.id, kind: "done", text: `終了：${label(t)}` }); }
      return st;
    };
    if (++st.steps > MAX_STEPS) return stop(`${MAX_STEPS} 歩を超えたので止めました（同じところを回っていないか確かめる）`);
    if (choice != null) {
      const e = outs.find((x) => x.to === choice) || outs.find((x) => U.same(x.label, choice));
      if (!e) return stop(`選んだ出口「${choice}」がありません`);
      const x = an.nodes[node.id];
      st.decided.push({ node: node.id, id: (x && x.jdg) || node.id, result: e.label || byId(e.to).label, by: "選んだ" });
      st.log.push({ node: node.id, kind: "choose", text: `${node.id} ${label(node)}：「${e.label || label(byId(e.to))}」を選んだ` });
      return go(e);
    }
    if (node.type === "end") { st.status = "done"; return st; }
    if (node.type === "decision") {
      const x = an.nodes[node.id] || { jdg: null };
      const jid = x.jdg;
      const info = jid ? an.judgeInfo[jid] : null;
      if (jid && !info) return stop(`${jid} が判断マスタにありません`, [`${jid} を判断マスタに書く`]);
      if (info) {
        const fs = fieldsOf(info);
        const bad = [];
        for (const f of fs) {
          const v = valueFor(st.values, f.names);
          if (f.c && !st.used.includes(f.key)) st.used.push(f.key);
          const b = badValue(f.c, v);
          if (b) bad.push(b);
        }
        if (bad.length) return stop(`${jid} の見る項目の値が列の定義に合いません`, bad);
      }
      if (info && info.judge.role === "rule" && info.judge.rows.length) {
        const j = info.judge;
        const fs = fieldsOf(info);
        const valOf = (name) => { const f = fs.find((y) => y.names.some((n) => U.norm(n) === U.norm(name))); return valueFor(st.values, f ? f.names : [name]); };
        const hits = j.rows.filter((r) => j.condCols.every((c) => U.testCond(r.conds[c], valOf(c))));
        const combo = j.condCols.map((c) => `${c}=${valOf(c) == null ? "（なし）" : valOf(c)}`).join("・");
        if (!hits.length) return stop(`${jid} ${j.title}：判定表のどの行にも当たりません（${combo}）`, [`この組み合わせのときの結果を決める（${combo}）`, ...info.reasons.filter((r) => /当たらない/.test(r))]);
        const r = hits[0];
        st.log.push({ node: node.id, kind: "judge", text: `${jid} ${j.title}：判定表 No.${r.no} に当たる（${combo}）→ ${r.result == null ? "結果が決まっていない" : r.result}${hits.length > 1 ? `。ほかにも当たる行：No.${hits.slice(1).map((y) => y.no).join("・No.")}` : ""}` });
        if (r.result == null || r.state !== "確定") {
          const qs = r.basis.filter((id) => isLedgerId(id) && an.openRefs && an.openRefs.includes(id));
          return stop(`${jid} 判定表 No.${r.no} が${r.result == null ? "結果未定" : ""}${r.state !== "確定" ? (r.result == null ? "・" : "") + (r.stateRaw || "状態なし") : ""}です`, [`No.${r.no}（${Object.entries(r.raw).map(([k, v]) => `${k}=${v || "-"}`).join("・")}）の結果を確定する`, ...qs.map((q) => (q.startsWith(KINDS.question.prefix + "-") ? `${q} の回答を得る` : `${q} を確定する`))]);
        }
        const e = outs.find((y) => U.same(y.label, r.result));
        if (!e) return stop(`${jid} の結果「${r.result}」に合う出口がフローにありません`, [`フローの ${node.id} に出口「${r.result}」を足すか、判定表の結果を出口のラベルにそろえる`]);
        st.decided.push({ node: node.id, id: jid, result: r.result, by: `判定表 No.${r.no}` });
        return go(e);
      }
      // AI・人・外部・マスタなし：ケースに結果があれば使い、なければ選ばせる
      const pre = valueFor(st.values, [jid, node.id].filter(Boolean));
      if (pre != null) {
        const e = outs.find((y) => U.same(y.label, pre));
        if (!e) return stop(`ケースの結果「${pre}」に合う出口が ${node.id} にありません`, [`ケースの ${jid || node.id} を出口のラベル（${outs.map((y) => y.label).filter(Boolean).join("、")}）にそろえる`]);
        st.decided.push({ node: node.id, id: jid || node.id, result: pre, by: "ケース" });
        st.log.push({ node: node.id, kind: "judge", text: `${jid || node.id} ${label(node)}：ケースの結果「${pre}」を使う` });
        return go(e);
      }
      st.steps--;
      st.status = "choose";
      st.options = outs.map((y) => ({ to: y.to, label: y.label || label(byId(y.to)) }));
      st.log.push({ node: node.id, kind: "ask", text: `${jid ? jid + " " : ""}${label(node)}：${ROLE_NAME((info && info.judge.role) || node.role) || "人"}が決める分岐です。出口を選んでください` });
      return st;
    }
    const solid = outs.filter((e) => !e.dashed);
    if (!solid.length) { st.status = "done"; st.log.push({ node: node.id, kind: "done", text: `終了：${label(node)}（この先の矢印がない）` }); return st; }
    if (solid.length === 1) return go(solid[0]);
    st.steps--;
    st.status = "choose";
    st.options = solid.map((y) => ({ to: y.to, label: y.label || label(byId(y.to)) }));
    st.log.push({ node: node.id, kind: "ask", text: `${label(node)}：出口が ${solid.length} 本あります。進む先を選んでください` });
    return st;
  }
  // 選ぶ・止まる・終わるまで進める
  function demoRun(st, an) {
    let s = st;
    for (let k = 0; k <= MAX_STEPS + 1 && s.status === "run"; k++) s = demoStep(s, an);
    return s;
  }

  // ---------- まとめ保存と種類の見分け ----------
  const PARTS = { flow: "フロー", master: "判断マスタ", tables: "テーブル定義", cases: "ケース" };
  const MARK_RE = /^<!--\s*gk-judge:(flow|master|tables|cases)\s*-->\s*$/;
  function bundle(parts) {
    const out = ["# 判断・データのまとめ（案件ワークベンチ）", "", "このファイルを「判断・データ」の画面の「ファイルを開く」で開くと、4 つの入力に戻ります。", ""];
    for (const k of Object.keys(PARTS)) {
      out.push(`<!-- gk-judge:${k} -->`);
      out.push(String((parts && parts[k]) || "").replace(/\r\n?/g, "\n").replace(/\s+$/, ""));
      out.push("");
    }
    return out.join("\n");
  }
  function unbundle(text) {
    const lines = String(text == null ? "" : text).replace(/\r\n?/g, "\n").split("\n");
    if (!lines.some((l) => MARK_RE.test(l.trim()))) return null;
    const out = Object.create(null);
    let cur = null;
    for (const l of lines) {
      const m = l.trim().match(MARK_RE);
      if (m) { cur = m[1]; out[cur] = []; continue; }
      if (cur) out[cur].push(l);
    }
    for (const k of Object.keys(out)) out[k] = out[k].join("\n").replace(/\s+$/, "") + "\n";
    return out;
  }
  function detect(text) {
    const b = unbundle(text);
    if (b) return b;
    const t = String(text == null ? "" : text);
    const out = Object.create(null);
    if (U.sections(t, "JDG").length) out.master = t;
    if (U.sections(t, "TBL").length) out.tables = t;
    if (caseList(t).length) out.cases = t;
    const fb = MDBLOCKS.parse(MDBLOCKS.unwrapFence(t)).find((x) => x.type === "code" && x.lang === "flow");
    if (fb) out.flow = fb.text + "\n";
    else if (!Object.keys(out).length) { const g = FLOWCHART.parse(t); if (!g.errors.length && g.nodes.length >= 2) out.flow = t; }
    return out;
  }

  return {
    parse, coverage, analyze, caseList, questionPatch, refState, valueFor, fieldsOf, badValue, itemsCsv, itemsMarkdown, ITEM_HEAD, itemCells,
    demo: { start: demoStart, step: demoStep, run: demoRun }, bundle, unbundle, detect, flowText, PARTS, LIMIT, MAX_STEPS,
  };
})();
