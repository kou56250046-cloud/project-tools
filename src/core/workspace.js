// 複数案件の入れ物（workspace）。暗号化の箱の中身はこの形になる（P5）
// type: 'workspace', version: 1, activeId, ledgers: { 案件ID: 台帳 }, exported: { 案件ID: { revision, at } }

export const WORKSPACE_VERSION = 1;

export function newProjectId() {
  const r = globalThis.crypto && globalThis.crypto.getRandomValues ? globalThis.crypto.getRandomValues(new Uint32Array(2)) : [Math.random() * 2 ** 32, Math.random() * 2 ** 32];
  return 'p' + [...r].map((x) => Math.floor(x).toString(36)).join('');
}

export function emptyWorkspace() {
  return { type: 'workspace', version: WORKSPACE_VERSION, activeId: null, ledgers: {}, exported: {} };
}

// 箱の中身（P4 までの台帳1件 / workspace）を workspace にそろえる。
// legacyExported: P4 までの書き出し状態（{ revision, at }）。戻り値: { workspace, wrapped } / { error }
export function migrateWorkspace(obj, legacyExported) {
  if (obj && obj.type === 'workspace' && obj.version === WORKSPACE_VERSION && obj.ledgers && typeof obj.ledgers === 'object') {
    return { workspace: { ...emptyWorkspace(), ...obj, exported: obj.exported || {} }, wrapped: false };
  }
  if (obj && obj.type === 'ledger') {
    const id = newProjectId();
    const ws = emptyWorkspace();
    ws.ledgers[id] = obj;
    ws.activeId = id;
    ws.exported[id] = legacyExported || { revision: null, at: null };
    return { workspace: ws, wrapped: true };
  }
  return { error: '保存されたデータの形が分かりません' };
}

// 案件ごとに検査する。check(ledgerObj) → { ok, ledger, migrated } / { ok: false, errors }
// 戻り値: { workspace（読めた案件だけ）, broken: { 案件ID: 元の文字列 }, migratedIds: string[] }
export function openWorkspace(ws, check) {
  const out = { ...ws, ledgers: {}, exported: { ...(ws.exported || {}) } };
  const broken = {};
  const migratedIds = [];
  for (const [id, obj] of Object.entries(ws.ledgers || {})) {
    let r;
    try { r = check(obj); } catch (e) { r = { ok: false, errors: [String(e && e.message || e)] }; }
    if (r.ok) {
      out.ledgers[id] = r.ledger;
      if (r.migrated) { migratedIds.push(id); out.exported[id] = { revision: null, at: null }; }
    } else {
      broken[id] = JSON.stringify(obj, null, 2);
      delete out.exported[id];
    }
  }
  if (!out.ledgers[out.activeId]) out.activeId = Object.keys(out.ledgers)[0] || null;
  return { workspace: out, broken, migratedIds };
}

// 同じ案件名の案件の ID（無ければ null）
export function findByName(ws, name) {
  const n = String(name || '').trim();
  for (const [id, l] of Object.entries(ws.ledgers)) if (String(l.project && l.project.name || '').trim() === n) return id;
  return null;
}
