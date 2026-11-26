// 写した部品: gemini-kit src/js/flow.js（2026-11-26）。外側の IIFE を、FLOWCHART だけを外に出す形に包み直した。
// 変えたところ: 参照の ID の接頭辞（REF_ID・REF_RE）。toSVG・render・palette と色の表は写さない
// フロー記法 → 構造 → 自動配置 → SVG。
// Gemini には構造（テキスト）だけを書かせ、座標はここで決める。
// 配置の方針：
//   ・左から右へ流れる。レーン（担当）は横帯
//   ・段（rank）は最長経路で決め、段をまたぐ矢印には見えない中継点を置く
//   ・矢印の縦の線は段と段のすき間だけを通す（箱の上を通らない）
//   ・戻りの矢印はレーンの下の余白を通す
import { KINDS } from './schema.js';
export const FLOWCHART = (() => {

  // 種類のキーワード。日本語でも書ける
  const TYPE_WORDS = {
    start: "start", 開始: "start",
    end: "end", 終了: "end",
    task: "task", 処理: "task",
    decision: "decision", 分岐: "decision", 判断: "decision",
    data: "data", データ: "data", 入出力: "data",
    doc: "doc", 帳票: "doc", 書類: "doc",
    sub: "sub", サブ: "sub", 定義済み処理: "sub",
  };
  const TYPE_NAMES = { start: "開始", end: "終了", task: "処理", decision: "分岐", data: "データ", doc: "帳票", sub: "サブ処理" };
  // 処理の担い手の区分。{AI} {ルール} {人} {外部} をレーンかノードに付ける。色はどの図でも同じ（テーマにもレーンの順番にもよらない）
  const ROLE_WORDS = {
    ai: "ai", llm: "ai", "ai判断": "ai",
    rule: "rule", ルール: "rule", "ルール判定": "rule", プログラム: "rule", program: "rule", script: "rule",
    human: "human", 人: "human", 人手: "human", "人の判断": "human",
    ext: "ext", external: "ext", 外部: "ext",
  };
  const ROLES = {
    ai: { name: "AI", decision: "AI判断" },
    rule: { name: "ルール", decision: "ルール判定" },
    human: { name: "人", decision: "人の判断" },
    ext: { name: "外部", decision: "外部の判断" },
  };
  const ROLE_ORDER = ["ai", "rule", "human", "ext"];
  const roleOf = (w) => { const k = String(w).trim(); return ROLE_WORDS[k.toLowerCase()] || ROLE_WORDS[k] || null; };
  // 末尾の {区分}（全角の ｛｝ も）
  const TAG_RE = /\s*[{｛]([^}｝]*)[}｝]\s*$/;
  // 末尾の参照 [JDG-001] [Q-04 TBL-001]（全角の ［］ も）。判断マスタ・テーブル定義・カルテの ID だけを対象にする
  // 写し元から変えたところ: 参照の接頭辞を JDG・TBL と台帳の全種別にする（カルテの Q・H・F・D は外す）
  const REF_PFX = ['JDG', 'TBL', ...Object.values(KINDS).map((k) => k.prefix)].join('|');
  const REF_ID = new RegExp(`(?:${REF_PFX})-\\d{1,4}(?![\\d-])`, 'g');
  const REF_RE = new RegExp(`\\s*[[［]\\s*((?:(?:${REF_PFX})-\\d{1,4}(?![\\d-])[\\s,、，]*)+)[\\]］]\\s*$`);

  // ---------- 文字幅 ----------
  // 全角は 1em、半角は 0.6em とみなす（メイリオ / Arial の近似）
  function charW(c) {
    const code = c.codePointAt(0);
    if (code < 0x80) return /[A-Z0-9mwMW]/.test(c) ? 0.66 : 0.56;
    if (code >= 0xff61 && code <= 0xff9f) return 0.55; // 半角カナ
    return 1;
  }
  function textW(s, size) {
    let w = 0;
    for (const c of s) w += charW(c);
    return w * size;
  }
  // 幅に収まるように折り返す。\n は明示の改行。英単語の途中ではなるべく切らない
  function wrap(text, maxW, size) {
    const out = [];
    for (const para of String(text).split("\n")) {
      const start = out.length;
      let line = "";
      let w = 0;
      const chars = [...para];
      for (let i = 0; i < chars.length; i++) {
        const c = chars[i];
        const cw = charW(c) * size;
        if (w + cw > maxW && line) {
          // 半角英数の途中なら直前の空白で切る
          const sp = line.lastIndexOf(" ");
          if (/[A-Za-z0-9]/.test(c) && sp > 0 && sp > line.length - 12) {
            out.push(line.slice(0, sp));
            line = line.slice(sp + 1);
            w = textW(line, size);
          } else {
            out.push(line);
            line = "";
            w = 0;
          }
          if (c === " ") continue;
        }
        line += c;
        w += cw;
      }
      // 最後の行が1文字だけになるなら前の行から1文字もらう
      if ([...line].length === 1 && out.length > start && [...out[out.length - 1]].length > 2) {
        const prev = [...out.pop()];
        line = prev.pop() + line;
        out.push(prev.join(""));
      }
      out.push(line);
    }
    return out;
  }

  // ---------- パース ----------
  function parse(src) {
    const g = { title: "", lanes: [], laneRoles: [], nodes: [], edges: [], errors: [], warnings: [] };
    const byId = new Map();
    const laneSet = new Set();
    let declaredLanes = false;
    const pendingEdges = [];
    const pendingNotes = [];
    const lines = String(src || "").replace(/\r\n?/g, "\n").split("\n");
    const err = (line, msg) => g.errors.push({ line, message: msg });

    lines.forEach((raw, i) => {
      const ln = i + 1;
      const s = raw.trim();
      if (!s || s.startsWith("#") || s.startsWith("//") || s.startsWith("```")) return;
      let m;
      if ((m = s.match(/^(?:title|タイトル)\s*[:：]?\s*(.+)$/i))) { g.title = m[1].trim(); return; }
      if ((m = s.match(/^(?:lanes|レーン一覧)\s*[:：]?\s*(.+)$/i))) {
        for (const name of m[1].split(/[,、，]/).map((x) => x.trim()).filter(Boolean)) addLane(name, ln);
        declaredLanes = true;
        return;
      }
      if ((m = s.match(/^(?:lane|レーン)\s*[:：]?\s*(.+)$/i))) { addLane(m[1].trim(), ln); declaredLanes = true; return; }
      if ((m = s.match(/^(?:note|注記)\s+([A-Za-z0-9_]+)\s*[:：]?\s*(.+)$/i))) { pendingNotes.push({ id: m[1], text: m[2].trim(), line: ln }); return; }
      // ノードの行は種類のキーワードで始まる。ラベルに -> が入っていても矢印の行とみなさない。全角の ＠ も受け付ける
      m = s.match(/^(\S+)\s+([A-Za-z0-9_]+)(?:\s+[@＠](\[[^\]]+\]|[^\s{｛]+))?(?:\s*[{｛]([^}｝]*)[}｝])?(?:\s+(.*))?$/);
      const isNode = m && (TYPE_WORDS[m[1].toLowerCase()] || TYPE_WORDS[m[1]]);
      if (!isNode && (s.includes("->") || s.includes("..>"))) { parseEdge(s, ln); return; }
      if (m) {
        const type = TYPE_WORDS[m[1].toLowerCase()] || TYPE_WORDS[m[1]];
        if (type) {
          const id = m[2];
          if (byId.has(id)) { err(ln, `ID「${id}」が2回定義されています（最初は ${byId.get(id).line} 行目）`); return; }
          const lane = m[3] ? m[3].replace(/^\[|\]$/g, "").trim() : "";
          let label = (m[5] || "").trim();
          // 区分は @レーン の後ろに書く。ラベルの末尾に書かれた {区分} も受け付ける
          let tag = m[4];
          const tm = tag == null && label.match(TAG_RE);
          if (tm && roleOf(tm[1])) { tag = tm[1]; label = label.slice(0, tm.index).trim(); }
          // 参照と区分はどちらを先に書いてもよい
          let refs = [];
          for (let k = 0; k < 4; k++) {
            let changed = false;
            const rm = label.match(REF_RE);
            if (rm) { refs = rm[1].match(REF_ID).concat(refs); label = label.slice(0, rm.index).trim(); changed = true; }
            const tm2 = tag == null && label.match(TAG_RE);
            if (tm2 && roleOf(tm2[1])) { tag = tm2[1]; label = label.slice(0, tm2.index).trim(); changed = true; }
            if (!changed) break;
          }
          label = label.replace(/\\n/g, "\n") || id;
          const role = tag == null ? null : roleOf(tag);
          if (tag != null && !role) g.warnings.push({ line: ln, message: `区分「${tag}」は使えません（AI・ルール・人・外部のどれか）。無視します` });
          const node = { id, type, label, lane, role, refs: [...new Set(refs)], line: ln, notes: [] };
          byId.set(id, node);
          g.nodes.push(node);
          return;
        }
      }
      err(ln, `解釈できない行です：「${s.length > 30 ? s.slice(0, 30) + "…" : s}」`);
    });

    function addLane(raw, ln) {
      let name = raw, role = null;
      const tm = raw.match(TAG_RE);
      if (tm) {
        name = raw.slice(0, tm.index).trim();
        role = roleOf(tm[1]);
        if (!role) g.warnings.push({ line: ln, message: `区分「${tm[1]}」は使えません（AI・ルール・人・外部のどれか）。無視します` });
      }
      if (laneSet.has(name)) { err(ln, `レーン「${name}」が2回定義されています`); return; }
      laneSet.add(name);
      g.lanes.push(name);
      g.laneRoles.push(role);
    }
    function parseEdge(s, ln) {
      let label = "";
      let body = s;
      const lm = s.match(/^(.*?(?:->|\.\.>)\s*[A-Za-z0-9_]+)\s*[:：]\s*(.+)$/);
      if (lm) { body = lm[1]; label = lm[2].trim(); }
      const parts = body.split(/(->|\.\.>)/).map((x) => x.trim());
      if (parts.length < 3 || parts.length % 2 === 0) { err(ln, "矢印の書き方が正しくありません（例：A -> B : はい）"); return; }
      for (let k = 0; k + 2 < parts.length; k += 2) {
        const from = parts[k], to = parts[k + 2];
        if (!/^[A-Za-z0-9_]+$/.test(from) || !/^[A-Za-z0-9_]+$/.test(to)) { err(ln, `矢印の両端は ID で書きます：「${from} ${parts[k + 1]} ${to}」`); return; }
        pendingEdges.push({ from, to, label: k === 0 ? label : "", dashed: parts[k + 1] === "..>", line: ln });
      }
    }

    // ノードの定義が後ろにあっても良いように、矢印と注記は最後に確かめる
    for (const e of pendingEdges) {
      let ok = true;
      for (const id of [e.from, e.to]) if (!byId.has(id)) { err(e.line, `ID「${id}」が定義されていません`); ok = false; }
      if (ok) g.edges.push(e);
    }
    let noteNo = 0;
    for (const n of pendingNotes) {
      const node = byId.get(n.id);
      if (!node) { err(n.line, `注記の対象「${n.id}」が定義されていません`); continue; }
      node.notes.push({ no: ++noteNo, text: n.text });
    }

    // レーンの整合
    if (declaredLanes) {
      for (const n of g.nodes) {
        if (!n.lane) err(n.line, `「${n.id}」にレーンがありません（@レーン名 を付けてください）`);
        else if (!laneSet.has(n.lane)) err(n.line, `レーン「${n.lane}」は定義されていません（定義済み：${g.lanes.join("、")}）`);
      }
    } else {
      // レーン宣言なしで @ を使った場合は出てきた順にレーンを作る
      for (const n of g.nodes) if (n.lane && !laneSet.has(n.lane)) addLane(n.lane, n.line);
      if (g.lanes.length) for (const n of g.nodes) if (!n.lane) err(n.line, `「${n.id}」にレーンがありません（他のノードはレーン付きです）`);
    }
    // レーンの区分は、区分を書いていないノードに引き継ぐ
    for (const n of g.nodes) if (!n.role && n.lane) { const k = g.lanes.indexOf(n.lane); if (k >= 0 && g.laneRoles[k]) n.role = g.laneRoles[k]; }
    if (!g.nodes.length && !g.errors.length) err(1, "ノードがありません");
    g.errors.sort((a, b) => a.line - b.line);

    // 警告：つながっていないノード、出口のない分岐
    const deg = new Map(g.nodes.map((n) => [n.id, { in: 0, out: 0 }]));
    for (const e of g.edges) { deg.get(e.from).out++; deg.get(e.to).in++; }
    for (const n of g.nodes) {
      const d = deg.get(n.id);
      if (g.nodes.length > 1 && d.in === 0 && d.out === 0) g.warnings.push({ line: n.line, message: `「${n.id}」はどこともつながっていません` });
      if (n.type === "decision" && d.out < 2) g.warnings.push({ line: n.line, message: `分岐「${n.id}」の出口が ${d.out} 本です` });
      if (n.type === "end" && d.out > 0) g.warnings.push({ line: n.line, message: `終了「${n.id}」から矢印が出ています` });
    }
    return g;
  }

  // ---------- 配置 ----------
  const DEF = {
    nodeW: 150, decisionW: 172, fontSize: 13, lineH: 17, labelSize: 11,
    gapMin: 40, track: 12, slotGap: 30, laneHeaderW: 96, margin: 16, titleH: 34, minNodeH: 42,
  };

  // 「あり／なし」はどちらが良いかが文脈で変わるので、肯定・否定には数えない
  const POS_RE = /^(?:(?:はい|yes|ok|可|承認|合格|適合|正常|成功|一致|十分|足りる)(?![a-z])|y$)/;
  const NEG_RE = /^(?:(?:いいえ|no|ng|否|不可|却下|不合格|不適合|異常|エラー|失敗|不一致|不足|差し?戻し|やり直し)(?![a-z])|n$)/;

  function nodeSize(n, o) {
    if (n.type === "decision") {
      const w = o.decisionW;
      const lines = wrap(n.label, w * 0.64, o.fontSize);
      const h = Math.max(70, lines.length * o.lineH * 2.3 + 14);
      return { w, h, lines };
    }
    const pad = n.type === "data" ? 34 : n.type === "sub" ? 30 : 18;
    const lines = wrap(n.label, o.nodeW - pad, o.fontSize);
    let h = Math.max(o.minNodeH, lines.length * o.lineH + 18);
    if (n.type === "doc") h += 8;
    return { w: o.nodeW, h, lines };
  }

  function layout(g, opt) {
    const o = Object.assign({}, DEF, opt || {});
    const nodes = g.nodes.map((n) => Object.assign({}, n, nodeSize(n, o)));
    const idx = new Map(nodes.map((n, i) => [n.id, i]));
    const N = nodes.length;
    const hasLanes = g.lanes.length > 0;
    const lanes = hasLanes ? g.lanes.slice() : [""];
    const laneOf = nodes.map((n) => (hasLanes ? lanes.indexOf(n.lane) : 0));
    const edges = g.edges.map((e, i) => ({ i, from: idx.get(e.from), to: idx.get(e.to), label: e.label, dashed: e.dashed, back: false }));

    // 1. 戻りの矢印を見つける（DFS で祖先へ向かう辺）
    const outs = Array.from({ length: N }, () => []);
    for (const e of edges) outs[e.from].push(e);
    const state = new Array(N).fill(0);
    const order = [...nodes.keys()].sort((a, b) => (nodes[a].type === "start" ? 0 : 1) - (nodes[b].type === "start" ? 0 : 1) || a - b);
    for (const root of order) {
      if (state[root]) continue;
      const stack = [[root, 0]];
      state[root] = 1;
      while (stack.length) {
        const top = stack[stack.length - 1];
        const [v, k] = top;
        if (k < outs[v].length) {
          top[1]++;
          const e = outs[v][k];
          if (state[e.to] === 1) e.back = true;
          else if (state[e.to] === 0) { state[e.to] = 1; stack.push([e.to, 0]); }
        } else { state[v] = 2; stack.pop(); }
      }
    }
    const fwd = edges.filter((e) => !e.back);

    // 2. 段：前向きの辺で最長経路
    const indeg = new Array(N).fill(0);
    for (const e of fwd) indeg[e.to]++;
    const rank = new Array(N).fill(0);
    const topo = [];
    const q = [...nodes.keys()].filter((v) => indeg[v] === 0);
    while (q.length) {
      const v = q.shift();
      topo.push(v);
      for (const e of fwd) if (e.from === v) { rank[e.to] = Math.max(rank[e.to], rank[v] + 1); if (--indeg[e.to] === 0) q.push(e.to); }
    }
    // 入口のないノード（開始以外の入力データなど）は使われる直前の段へ寄せる
    for (let k = topo.length - 1; k >= 0; k--) {
      const v = topo[k];
      if (nodes[v].type === "start") continue;
      if (fwd.some((e) => e.to === v)) continue;
      const succ = fwd.filter((e) => e.from === v).map((e) => rank[e.to]);
      if (succ.length) rank[v] = Math.max(0, Math.min(...succ) - 1);
    }
    const maxRank = N ? Math.max(...rank) : 0;

    // 3. 段をまたぐ辺に中継点を置く。items = 実ノード + 中継点
    const items = nodes.map((n, i) => ({ kind: "node", i, lane: laneOf[i], rank: rank[i], h: n.h, w: n.w }));
    const legs = []; // 前向きの辺を、隣り合う段どうしの区間に分けたもの
    for (const e of fwd) {
      let prev = e.from;
      e.chain = [e.from];
      for (let r = rank[e.from] + 1; r < rank[e.to]; r++) {
        const d = items.length;
        items.push({ kind: "dummy", lane: laneOf[e.from], rank: r, h: 0, w: 0, edge: e });
        e.chain.push(d);
        legs.push({ e, a: prev, b: d });
        prev = d;
      }
      e.chain.push(e.to);
      legs.push({ e, a: prev, b: e.to });
    }

    // 4. セル（レーン × 段）内の並び。重心法で交差を減らす
    const cells = new Map();
    const cellKey = (l, r) => l * 100000 + r;
    items.forEach((it, k) => {
      const key = cellKey(it.lane, it.rank);
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(k);
    });
    const pos = new Array(items.length).fill(0);
    const updatePos = () => { for (const arr of cells.values()) arr.forEach((k, j) => (pos[k] = items[k].lane * 1000 + j)); };
    updatePos();
    const predOf = Array.from({ length: items.length }, () => []);
    const succOf = Array.from({ length: items.length }, () => []);
    for (const l of legs) { predOf[l.b].push(l.a); succOf[l.a].push(l.b); }
    for (let it = 0; it < 6; it++) {
      const useP = it % 2 === 0;
      for (const arr of cells.values()) {
        const bc = new Map(arr.map((k, j) => {
          const nb = useP ? predOf[k] : succOf[k];
          return [k, nb.length ? nb.reduce((s, x) => s + pos[x], 0) / nb.length : pos[k] - items[k].lane * 1000 + items[k].lane * 1000 + j * 0.001];
        }));
        arr.sort((a, b) => bc.get(a) - bc.get(b));
      }
      updatePos();
    }

    // 5. レーン内の行。前の段と同じ行に置けるなら置く（線をまっすぐにする）
    const laneRows = lanes.map(() => 1);
    for (const [key, arr] of cells) { const l = Math.floor(key / 100000); laneRows[l] = Math.max(laneRows[l], arr.length); }
    const row = new Array(items.length).fill(0);
    for (let r = 0; r <= maxRank; r++) {
      for (let l = 0; l < lanes.length; l++) {
        const arr = cells.get(cellKey(l, r));
        if (!arr) continue;
        const n = arr.length;
        const R = laneRows[l];
        const want = arr.map((k, j) => {
          const ps = predOf[k].filter((p) => items[p].lane === l);
          return ps.length ? Math.round(ps.reduce((s, p) => s + row[p], 0) / ps.length) : j;
        });
        for (let j = 0; j < n; j++) want[j] = Math.max(want[j], j === 0 ? 0 : want[j - 1] + 1);
        for (let j = n - 1; j >= 0; j--) want[j] = Math.min(want[j], j === n - 1 ? R - 1 : want[j + 1] - 1);
        arr.forEach((k, j) => (row[k] = want[j]));
      }
    }

    // 6. 戻りの矢印の通り道（レーン下の余白）を割り当てる
    const back = edges.filter((e) => e.back);
    const chanCount = lanes.map(() => 0);
    for (const e of back) {
      e.chanLane = Math.max(laneOf[e.from], laneOf[e.to]);
      e.chan = chanCount[e.chanLane]++;
    }

    // 7. 縦方向：レーンと行の高さ
    const top0 = o.margin + (g.title ? o.titleH : 0);
    const rowH = lanes.map((_, l) => new Array(laneRows[l]).fill(20));
    items.forEach((it, k) => { rowH[it.lane][row[k]] = Math.max(rowH[it.lane][row[k]], it.h); });
    const laneY = [], laneH = [], rowTop = lanes.map(() => []);
    let y = top0;
    for (let l = 0; l < lanes.length; l++) {
      laneY[l] = y;
      let yy = y + o.slotGap * 0.75;
      for (let r = 0; r < laneRows[l]; r++) { rowTop[l][r] = yy; yy += rowH[l][r] + o.slotGap; }
      yy = yy - o.slotGap + o.slotGap * 0.75 + (chanCount[l] ? (chanCount[l] + 1.6) * o.track : 0);
      laneH[l] = yy - y;
      y = yy;
    }
    const totalBottom = y;
    items.forEach((it, k) => {
      it.cy = rowTop[it.lane][row[k]] + rowH[it.lane][row[k]] / 2;
      it.rowBottom = rowTop[it.lane][row[k]] + rowH[it.lane][row[k]];
      it.rowTop = rowTop[it.lane][row[k]];
    });
    const lastRowBottom = (l) => rowTop[l][laneRows[l] - 1] + rowH[l][laneRows[l] - 1];
    // 分岐の下の頂点から出る線（行の下 slotGap/2 を横に走る）と重ならないよう、さらに離す
    for (const e of back) e.chanY = lastRowBottom(e.chanLane) + o.slotGap * 0.5 + (e.chan + 1.6) * o.track;

    // 8. ポート（矢印の出入り口）
    // 右から出る / 左から入る。分岐は右・下・上の頂点を使う
    const outPorts = new Map(); // edge.i -> {side, y}
    const inPorts = new Map();
    const firstTarget = (e) => (e.back ? { y: e.chanY } : { y: items[e.chain[1]].cy });
    nodes.forEach((n, v) => {
      const es = edges.filter((e) => e.from === v).map((e) => ({ e, ty: firstTarget(e).y }));
      es.sort((a, b) => a.ty - b.ty || a.e.i - b.e.i);
      const cy = items[v].cy;
      if (n.type === "decision" && es.length > 1) {
        // 一番近い高さへ行くものを右の頂点、それより上は上の頂点、下は下の頂点
        let best = 0;
        es.forEach((x, j) => { if (Math.abs(x.ty - cy) < Math.abs(es[best].ty - cy)) best = j; });
        es.forEach((x, j) => {
          if (j === best) outPorts.set(x.e.i, { side: "r", y: cy });
          else if (j < best && !es.slice(0, best).some((z, jj) => jj !== j && outPorts.get(z.e.i)?.side === "t")) outPorts.set(x.e.i, { side: "t", y: cy - n.h / 2 });
          else if (j > best && !es.slice(best + 1).some((z) => outPorts.get(z.e.i)?.side === "b")) outPorts.set(x.e.i, { side: "b", y: cy + n.h / 2 });
          else outPorts.set(x.e.i, { side: "r", y: cy });
        });
      } else {
        const sp = es.length > 1 ? Math.min(14, (n.h - 14) / (es.length - 1)) : 0;
        es.forEach((x, j) => outPorts.set(x.e.i, { side: "r", y: n.type === "decision" ? cy : cy + (j - (es.length - 1) / 2) * sp }));
      }
      const ins = edges.filter((e) => e.to === v).map((e) => ({ e, sy: e.back ? e.chanY : items[e.chain[e.chain.length - 2]].cy }));
      ins.sort((a, b) => a.sy - b.sy || a.e.i - b.e.i);
      const isp = ins.length > 1 && n.type !== "decision" ? Math.min(14, (n.h - 14) / (ins.length - 1)) : 0;
      ins.forEach((x, j) => inPorts.set(x.e.i, { y: cy + (j - (ins.length - 1) / 2) * isp }));
    });

    // 9. すき間ごとに縦線の通り道（トラック）を割り当てる
    // gap g は段 g と段 g+1 の間。g = -1 は最初の段の左
    const gapSegs = new Map(); // g -> [{y1,y2,ref}]
    // ya：左の列から縦線まで横に入ってくる高さ / yb：縦線から右の列へ横に出ていく高さ（なければ null）
    const addSeg = (gIdx, ya, yb, ref) => {
      if (ya != null && Math.abs(ya - yb) < 0.5) return;
      if (!gapSegs.has(gIdx)) gapSegs.set(gIdx, []);
      const y1 = ref.y1, y2 = ref.y2;
      gapSegs.get(gIdx).push({ lo: Math.min(y1, y2), hi: Math.max(y1, y2), ya, yb, ref });
    };
    const routes = new Map(); // edge.i -> plan
    for (const e of edges) {
      const op = outPorts.get(e.i);
      const ip = inPorts.get(e.i);
      if (e.back) {
        const sy = op.side === "r" ? op.y : stubY(e.from, op.side);
        const r1 = { y1: sy, y2: e.chanY };
        const r2 = { y1: ip.y, y2: e.chanY };
        addSeg(rank[e.from], r1.y1, null, r1);
        addSeg(rank[e.to] - 1, null, r2.y1, r2);
        routes.set(e.i, { op, ip, r1, r2 });
        continue;
      }
      const segs = [];
      for (let k = 0; k + 1 < e.chain.length; k++) {
        const a = e.chain[k], b = e.chain[k + 1];
        const ya = k === 0 ? (op.side === "r" ? op.y : stubY(a, op.side)) : items[a].cy;
        const yb = k + 2 === e.chain.length ? ip.y : items[b].cy;
        const s = { y1: ya, y2: yb, gap: items[a].rank };
        addSeg(items[a].rank, ya, yb, s);
        segs.push(s);
      }
      routes.set(e.i, { op, ip, segs });
    }
    function stubY(v, side) {
      return side === "b" ? items[v].rowBottom + o.slotGap / 2 : items[v].rowTop - o.slotGap / 2;
    }
    // 縦線の位置（トラック）を決める。
    // 規則1：縦の区間が重なる線は別のトラックにする
    // 規則2：線 A が左から入ってくる高さと、線 B が右へ出ていく高さが同じなら、A を B より左に置く
    //        （逆だと2本の横線が同じ高さで重なり、どこへ向かう線か読めなくなる）
    const gapTracks = new Map();
    const near = (a, b) => a != null && b != null && Math.abs(a - b) < 3;
    for (const [gIdx, segs] of gapSegs) {
      segs.sort((a, b) => a.lo - b.lo || a.hi - b.hi);
      const before = segs.map((s) => segs.filter((o) => o !== s && near(o.ya, s.yb) && !near(s.ya, o.yb)));
      const done = new Set();
      const order = [];
      const visit = (s, depth) => {
        if (done.has(s) || depth > segs.length) return;
        done.add(s);
        for (const o of before[segs.indexOf(s)]) visit(o, depth + 1);
        order.push(s);
      };
      segs.forEach((s) => visit(s, 0));
      const tracks = [];
      for (const s of order) {
        let t = Math.max(0, ...before[segs.indexOf(s)].map((o) => (o.ref.track ?? -1) + 1));
        while (tracks[t] && tracks[t].some((o) => o.lo < s.hi + 24 && s.lo < o.hi + 24)) t++;
        (tracks[t] = tracks[t] || []).push(s);
        s.ref.track = t;
      }
      gapTracks.set(gIdx, tracks.length);
    }
    // ラベルの幅だけ、すき間の入口を空ける
    const labelRoom = new Map();
    for (const e of edges) {
      if (!e.label) continue;
      const op = outPorts.get(e.i);
      if (op.side !== "r") continue;
      const gIdx = rank[e.from];
      labelRoom.set(gIdx, Math.max(labelRoom.get(gIdx) || 0, textW(e.label, o.labelSize) + 10));
    }
    const gapW = (gIdx) => Math.max(o.gapMin, (labelRoom.get(gIdx) || 4) + ((gapTracks.get(gIdx) || 0) + 1) * o.track);
    const colW = Math.max(o.nodeW, nodes.some((n) => n.type === "decision") ? o.decisionW : 0);
    const left0 = o.margin + (hasLanes ? o.laneHeaderW : 0);
    const colX = [];
    let x = left0 + (gapTracks.get(-1) ? gapW(-1) : o.track * 2);
    for (let r = 0; r <= maxRank; r++) { colX[r] = x; x += colW + gapW(r); }
    const rightEdge = x - gapW(maxRank) + (gapTracks.get(maxRank) ? gapW(maxRank) : o.track * 2);
    const trackX = (gIdx, t) => {
      const start = gIdx < 0 ? left0 : colX[gIdx] + colW;
      return start + (labelRoom.get(gIdx) || 4) + (t + 1) * o.track;
    };
    items.forEach((it) => {
      it.cx = colX[it.rank] + colW / 2;
    });

    // 10. 線の座標
    const outEdges = [];
    for (const e of edges) {
      const n = nodes[e.from];
      const it = items[e.from];
      const pl = routes.get(e.i);
      const pts = [];
      let labelPos = null;
      // 出口
      if (pl.op.side === "r") {
        pts.push([it.cx + n.w / 2, pl.op.y]);
        if (e.label) labelPos = { x: it.cx + n.w / 2 + 5, y: pl.op.y - 4, anchor: "start" };
      } else {
        const vy = pl.op.side === "b" ? it.cy + n.h / 2 : it.cy - n.h / 2;
        const sy = stubY(e.from, pl.op.side);
        pts.push([it.cx, vy], [it.cx, sy]);
        if (e.label) labelPos = pl.op.side === "b" ? { x: it.cx + 5, y: vy + 11, anchor: "start" } : { x: it.cx - 5, y: vy - 4, anchor: "end" };
      }
      const tIt = items[e.to];
      const tN = nodes[e.to];
      const inX = tIt.cx - tN.w / 2;
      if (e.back) {
        const x1 = trackX(rank[e.from], pl.r1.track);
        const x2 = trackX(rank[e.to] - 1, pl.r2.track);
        const lastY = pts[pts.length - 1][1];
        pts.push([x1, lastY], [x1, e.chanY], [x2, e.chanY], [x2, pl.ip.y], [inX, pl.ip.y]);
      } else {
        pl.segs.forEach((s, k) => {
          const b = e.chain[k + 1];
          const tx = trackX(s.gap, s.track || 0);
          const lastY = pts[pts.length - 1][1];
          const isLast = k + 2 === e.chain.length;
          const bx = isLast ? inX : items[b].cx - colW / 2;
          if (Math.abs(lastY - s.y2) < 0.5) {
            pts.push([bx, lastY]);
          } else {
            pts.push([tx, lastY], [tx, s.y2], [bx, s.y2]);
          }
          if (!isLast) pts.push([items[b].cx + colW / 2, s.y2]);
        });
      }
      outEdges.push({ from: n.id, to: tN.id, points: simplify(pts), label: e.label, labelPos, dashed: e.dashed, back: e.back, tone: toneOf(e) });
    }

    // 分岐から出る線の色の種類。肯定・否定の言葉なら pos / neg、それ以外は出口の順番（0, 1, 2…）
    function toneOf(e) {
      if (nodes[e.from].type !== "decision") return null;
      const sibs = edges.filter((x) => x.from === e.from);
      if (sibs.length < 2) return null;
      const lb = String(e.label || "").trim().toLowerCase();
      if (NEG_RE.test(lb)) return "neg";
      if (POS_RE.test(lb)) return "pos";
      return sibs.filter((x) => { const l = String(x.label || "").trim().toLowerCase(); return !NEG_RE.test(l) && !POS_RE.test(l); }).indexOf(e);
    }

    const notes = [];
    nodes.forEach((n) => n.notes.forEach((nt) => notes.push({ no: nt.no, id: n.id, label: n.label.replace(/\n/g, ""), text: nt.text })));
    notes.sort((a, b) => a.no - b.no);
    const noteLines = notes.map((nt) => wrap(`※${nt.no} ${nt.label}：${nt.text}`, Math.max(300, rightEdge - o.margin * 2), 12));
    // 区分の凡例（使った区分だけ、決まった順に）
    const used = new Set(nodes.map((n) => n.role).filter(Boolean));
    const roleLegend = ROLE_ORDER.filter((k) => used.has(k)).map((k) => ({ key: k, name: ROLES[k].name }));
    const roleH = roleLegend.length ? 24 : 0;
    const legendH = roleH + (notes.length ? 12 + noteLines.reduce((s, ls) => s + ls.length * 17, 0) : 0);
    const width = Math.ceil(Math.max(rightEdge + o.margin, 320));
    const height = Math.ceil(totalBottom + legendH + o.margin);

    return {
      width, height, title: g.title, titleY: o.margin + 20, fontSize: o.fontSize, lineH: o.lineH, labelSize: o.labelSize,
      laneHeaderW: hasLanes ? o.laneHeaderW : 0, left: o.margin, right: width - o.margin,
      lanes: hasLanes ? lanes.map((name, l) => ({ name, y: laneY[l], h: laneH[l], lines: wrap(name, o.laneHeaderW - 14, 13) })) : [],
      nodes: nodes.map((n, v) => ({ id: n.id, type: n.type, lane: laneOf[v], role: n.role || null, refs: n.refs || [], lines: n.lines, x: items[v].cx - n.w / 2, y: items[v].cy - n.h / 2, w: n.w, h: n.h, cx: items[v].cx, cy: items[v].cy, notes: n.notes.map((x) => x.no) })),
      edges: outEdges,
      notes: notes.map((nt, k) => ({ text: noteLines[k], })),
      roles: roleLegend, roleY: totalBottom + 14,
      legendY: totalBottom + 14 + roleH,
    };
  }

  // 一直線に並ぶ中間点と重複点を除く
  function simplify(pts) {
    const out = [];
    for (const p of pts) {
      const last = out[out.length - 1];
      if (last && Math.abs(last[0] - p[0]) < 0.01 && Math.abs(last[1] - p[1]) < 0.01) continue;
      out.push([Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);
    }
    for (let k = out.length - 2; k >= 1; k--) {
      const [a, b, c] = [out[k - 1], out[k], out[k + 1]];
      if ((a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1])) out.splice(k, 1);
    }
    return out;
  }

  // ---------- 図の部品（色は持たない。描くのは src/ui/flowsvg.js、色は styles.css の変数） ----------
  const LANE_BAR = 4;                 // レーン見出しの左端の帯の幅
  // 箱の枠の太さ（pt。SVG は 1.2 倍）。判断と終了は少し太くして目を止める
  const nodeLineW = (n) => (n.type === "decision" ? 1.5 : n.type === "end" ? 1.6 : 1.25);
  // 区分のある箱の左上に出す名前（色だけに頼らない）
  const roleLabel = (n) => (n.role && ROLES[n.role] ? (n.type === "decision" ? ROLES[n.role].decision : ROLES[n.role].name) : "");
  // 区分名の位置（文字の下端）。処理の箱は左上。分岐は上の頂点から出る線のラベルが左上に付くので左下に置く
  const roleLabelPos = (n) => (n.type === "decision" ? { x: n.x - 8, y: n.y + n.h + 11, below: true } : { x: n.x, y: n.y - 3, below: false });
  // overlay（判断・データのタブ）：{ marks: {ID: "ok"|"open"|"none"}, visited: [ID], taken: ["A>B"], current: ID, titles: {ID: 文字} }
  const MARK = { ok: { sym: "✓", word: "確定" }, open: { sym: "?", word: "未確定" }, none: { sym: "!", word: "マスタなし" } };
  // toSVG・render・palette は写さない（文字列の SVG を使わず、src/ui/flowsvg.js で DOM として組む。色は CSS の変数）

  return { parse, layout, wrap, textW, TYPE_NAMES, LANE_BAR, nodeLineW, ROLES, ROLE_ORDER, roleOf, roleLabel, roleLabelPos, MARK };
})();
