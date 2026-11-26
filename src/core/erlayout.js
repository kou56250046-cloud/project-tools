// ER 図の配置（DOM に依存しない）。外部キーの向きで層に分け、参照先を左、参照元を右に置く
// 層割りと並べ替えは ~/.claude/skills/dashboard/assets/dash.js の layering を改変して流用

export const ER = { BOX_W: 230, HEAD: 26, ROW: 18, MAX_ROWS: 20, GAP_X: 90, GAP_Y: 28, PAD: 20 };

// 有向グラフを層に分ける。逆向きの辺（循環）を見つけ、最長経路で層を決め、重心法で並び替える
function layering(ids, edges) {
  const out = new Map(ids.map((id) => [id, []]));
  edges.forEach((e, i) => out.get(e.s).push(i));
  const state = new Map();
  const back = new Set();
  const visit = (u) => {
    state.set(u, 1);
    for (const i of out.get(u)) {
      const v = edges[i].t;
      const st = state.get(v);
      if (st === 1) back.add(i); else if (!st) visit(v);
    }
    state.set(u, 2);
  };
  ids.forEach((id) => { if (!state.get(id)) visit(id); });
  const fwd = edges.map((_, i) => i).filter((i) => !back.has(i));
  const indeg = new Map(ids.map((id) => [id, 0]));
  for (const i of fwd) indeg.set(edges[i].t, indeg.get(edges[i].t) + 1);
  const rank = new Map(ids.map((id) => [id, 0]));
  const queue = ids.filter((id) => !indeg.get(id));
  while (queue.length) {
    const u = queue.shift();
    for (const i of out.get(u)) {
      if (back.has(i)) continue;
      const v = edges[i].t;
      rank.set(v, Math.max(rank.get(v), rank.get(u) + 1));
      indeg.set(v, indeg.get(v) - 1);
      if (!indeg.get(v)) queue.push(v);
    }
  }
  const maxRank = Math.max(0, ...rank.values());
  const layers = Array.from({ length: maxRank + 1 }, () => []);
  ids.forEach((id) => layers[rank.get(id)].push(id));
  const pos = new Map();
  const index = () => layers.forEach((L) => L.forEach((id, i) => pos.set(id, i)));
  index();
  const preds = new Map(ids.map((id) => [id, []]));
  const succs = new Map(ids.map((id) => [id, []]));
  for (const i of fwd) { preds.get(edges[i].t).push(edges[i].s); succs.get(edges[i].s).push(edges[i].t); }
  const bary = (id, nb) => { const ns = nb.get(id); return ns.length ? ns.reduce((a, x) => a + pos.get(x), 0) / ns.length : pos.get(id); };
  for (let it = 0; it < 6; it++) {
    for (let r = 1; r <= maxRank; r++) { const b = new Map(layers[r].map((id) => [id, bary(id, preds)])); layers[r].sort((x, y) => b.get(x) - b.get(y)); index(); }
    for (let r = maxRank - 1; r >= 0; r--) { const b = new Map(layers[r].map((id) => [id, bary(id, succs)])); layers[r].sort((x, y) => b.get(x) - b.get(y)); index(); }
  }
  return { rank, layers };
}

// 戻り値: { boxes: [{ id, x, y, w, h, title, physicalName, external, rows: [{ name, type, pk, fk }], more }], lines: [{ from, to, column, points }], width, height }
export function layoutEr(ledger) {
  const ents = ledger.items.filter((it) => it.kind === 'entity' && it.status !== 'dropped').sort((a, b) => a.id.localeCompare(b.id));
  const ids = ents.map((e) => e.id);
  const idSet = new Set(ids);
  const edges = [];
  for (const e of ents) for (const c of e.columns || []) {
    if (c && c.fk && idSet.has(c.fk.entity) && c.fk.entity !== e.id) edges.push({ s: c.fk.entity, t: e.id });
  }
  const { layers } = layering(ids, edges);
  const byId = new Map(ents.map((e) => [e.id, e]));
  const boxes = new Map();
  let height = 0;
  layers.forEach((layer, r) => {
    let y = ER.PAD;
    for (const id of layer) {
      const e = byId.get(id);
      const cols = (e.columns || []).filter(Boolean);
      const shown = cols.slice(0, ER.MAX_ROWS);
      const more = cols.length - shown.length;
      const h = ER.HEAD + (shown.length + (more > 0 ? 1 : 0)) * ER.ROW + 6;
      boxes.set(id, {
        id, x: ER.PAD + r * (ER.BOX_W + ER.GAP_X), y, w: ER.BOX_W, h,
        title: e.title, physicalName: e.physicalName, external: e.fileType === 'external',
        rows: shown.map((c) => ({ name: c.name, type: c.type, pk: !!c.pk, fk: !!c.fk })), more,
      });
      y += h + ER.GAP_Y;
    }
    height = Math.max(height, y);
  });
  const rowY = (box, name) => {
    const i = box.rows.findIndex((r) => String(r.name).toLowerCase() === String(name).toLowerCase());
    return box.y + ER.HEAD + (i < 0 ? 0 : i) * ER.ROW + ER.ROW / 2;
  };
  // 線: 参照元の列の行から、参照先の列の行へ。左右の辺の上に端を置き、直交の折れ線で結ぶ
  const lines = [];
  for (const e of ents) {
    const child = boxes.get(e.id);
    for (const c of e.columns || []) {
      if (!c || !c.fk || !boxes.has(c.fk.entity) || c.fk.entity === e.id) continue;
      const parent = boxes.get(c.fk.entity);
      const y1 = rowY(child, c.name);
      const y2 = rowY(parent, c.fk.column);
      let points;
      if (parent.x + parent.w <= child.x) {
        const x1 = child.x;
        const x2 = parent.x + parent.w;
        const mx = Math.round((x1 + x2) / 2);
        points = [[x1, y1], [mx, y1], [mx, y2], [x2, y2]];
      } else if (child.x + child.w <= parent.x) {
        const x1 = child.x + child.w;
        const x2 = parent.x;
        const mx = Math.round((x1 + x2) / 2);
        points = [[x1, y1], [mx, y1], [mx, y2], [x2, y2]];
      } else {
        // 同じ列（循環で同じ層に来たとき）: 右の辺から外へ出て回り込む
        const x1 = child.x + child.w;
        const x2 = parent.x + parent.w;
        const ox = Math.max(x1, x2) + 24;
        points = [[x1, y1], [ox, y1], [ox, y2], [x2, y2]];
      }
      lines.push({ from: e.id, to: c.fk.entity, column: c.name, points });
    }
  }
  // 同じすき間を通る線の縦の部分が重ならないよう、少しずつずらす
  const groups = new Map();
  for (const ln of lines) {
    const key = `${ln.points[0][0]}|${ln.points[3][0]}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ln);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.points[0][1] - b.points[0][1]);
    list.forEach((ln, i) => {
      const off = Math.round((i - (list.length - 1) / 2) * 10);
      ln.points[1][0] += off;
      ln.points[2][0] += off;
    });
  }
  const width = ER.PAD * 2 + layers.length * ER.BOX_W + Math.max(0, layers.length - 1) * ER.GAP_X + 30;
  return { boxes: [...boxes.values()], lines, width, height: height + ER.PAD };
}
