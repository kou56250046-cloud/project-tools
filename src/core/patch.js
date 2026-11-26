// 差分の検証・計画・適用。適用は新しい台帳を返し、元の台帳は変えない。

import { KINDS, KIND_IDS, REF_FIELDS, RELATION_PREFIX, RELATION_NODE_KINDS, TEMP_ID_RE, SCHEMA_VERSION, CHANGELOG_LIMIT, newIntegrityErrors, validateFields, validateProject, withDefaults, makeResolver, kindOfId, kindLabel, formatId, fieldSpec, refFieldLabel, nestedRef } from './schema.js';

export const OP_TYPES = ['add', 'update', 'relate', 'project'];
const OP_LABELS = { add: '追加', update: '更新', relate: '関係の追加', project: '案件情報の更新' };
const FORBIDDEN_SET = ['id', 'kind', 'createdAt'];

export function opLabel(op) { return OP_LABELS[op] || String(op); }

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
// 関係の重複判定のキー（ラベルの前後の空白は無視する）
const relKey = (from, to, label) => [from, to, String(label).trim()].join('|');

// 差分を検査する。戻り値:
// { errors: 差分全体の誤り, warnings, ops: ParsedOp[] }
// ParsedOp = { index, op, type, kind, tempId, errors, warnings, unknown }
// opts.local: 画面の操作（applyLocalOps）から呼ぶとき true。Gemini の差分ではメモ（memo）を足したり変えたりできない
export function validatePatch(patch, ledger, opts = {}) {
  const errors = [];
  const warnings = [];
  if (!isObj(patch)) return { errors: ['差分がオブジェクトではありません'], warnings, ops: [] };
  if (patch.type !== 'ledger-patch') {
    if (patch.type === 'ledger') return { errors: ['これは差分ではなく台帳全体です。台帳は「設定」画面の「読み込み」から開いてください'], warnings, ops: [] };
    warnings.push('type が "ledger-patch" ではありませんが、差分として読みました');
  }
  if (patch.schemaVersion !== undefined && patch.schemaVersion !== SCHEMA_VERSION) warnings.push(`schemaVersion が ${SCHEMA_VERSION} ではありません（${String(patch.schemaVersion)}）`);
  if (patch.basedOnRevision !== undefined && patch.basedOnRevision !== ledger.revision) {
    warnings.push(`この差分は revision ${String(patch.basedOnRevision)} の台帳をもとに作られています（今は ${ledger.revision}）。指示文を作った後に台帳が変わっています`);
  }
  if (!Array.isArray(patch.ops)) return { errors: [...errors, 'ops（操作の配列）がありません'], warnings, ops: [] };
  if (!patch.ops.length) errors.push('ops が空です。取り込む操作がありません');

  // 1周目: 仮ID を集める
  const temps = new Map();
  const parsed = patch.ops.map((op, index) => ({
    index, op, type: isObj(op) ? op.op : undefined, kind: null, tempId: null, errors: [], warnings: [], unknown: [],
  }));
  for (const p of parsed) {
    if (p.type !== 'add' || !isObj(p.op.item)) continue;
    p.kind = p.op.item.kind;
    if (p.op.tempId === undefined) continue;
    if (typeof p.op.tempId !== 'string' || !TEMP_ID_RE.test(p.op.tempId)) { p.errors.push(`tempId「${String(p.op.tempId)}」は「new:1」の形で指定してください`); continue; }
    if (temps.has(p.op.tempId)) { p.errors.push(`tempId「${p.op.tempId}」が操作${temps.get(p.op.tempId).index + 1}と重複しています`); continue; }
    p.tempId = p.op.tempId;
    temps.set(p.tempId, { index: p.index, kind: KINDS[p.kind] ? p.kind : null });
  }
  const base = makeResolver(ledger);
  const resolve = (id) => base(id) || (temps.has(id) ? temps.get(id).kind : null);

  // 2周目: 各操作を検査する
  const relKeys = new Set(ledger.relations.map((r) => relKey(r.from, r.to, r.label)));
  for (const p of parsed) {
    const op = p.op;
    if (!isObj(op)) { p.errors.push('操作がオブジェクトではありません'); continue; }
    if (!OP_TYPES.includes(op.op)) { p.errors.push(`op「${String(op.op)}」は使えません。使える値: ${OP_TYPES.join(', ')}`); continue; }

    if (op.op === 'add') {
      if (!isObj(op.item)) { p.errors.push('item（追加する項目）がありません'); continue; }
      if (op.item.id !== undefined) p.warnings.push(`item.id「${String(op.item.id)}」は無視します。ID は取り込み時に振ります`);
      if (!KINDS[op.item.kind]) { p.errors.push(`種別（kind）「${String(op.item.kind)}」は使えません。使える値: ${KIND_IDS.join(', ')}`); continue; }
      if (op.item.kind === 'memo' && !opts.local) { p.errors.push(MEMO_PATCH_ERROR); continue; }
      const r = validateFields(op.item.kind, withDefaults(op.item.kind, op.item), { resolve });
      p.errors.push(...r.errors); p.warnings.push(...r.warnings); p.unknown = r.unknown;
      if (op.item.kind === 'decision' && op.item.supersedes && op.item.supersedes === op.tempId) p.errors.push('supersedes に自分自身は指定できません');
    } else if (op.op === 'update') {
      if (typeof op.id !== 'string') { p.errors.push('id（更新する項目の ID）がありません'); continue; }
      if (TEMP_ID_RE.test(op.id)) { p.errors.push(`仮ID「${op.id}」は更新できません。追加の item に含めてください`); continue; }
      const k = base(op.id);
      if (!k) { p.errors.push(kindOfId(op.id) ? `ID「${op.id}」は台帳にありません` : `「${op.id}」は ID の形式ではありません`); continue; }
      p.kind = k;
      if (k === 'memo' && !opts.local) { p.errors.push(MEMO_PATCH_ERROR); continue; }
      const set = op.set === undefined ? {} : op.set;
      if (!isObj(set)) { p.errors.push('set（変更する内容）はオブジェクトで指定してください'); continue; }
      for (const f of FORBIDDEN_SET) if (set[f] !== undefined) p.errors.push(`${f} は変更できません`);
      const rest = { ...set };
      for (const f of [...FORBIDDEN_SET, 'updatedAt']) delete rest[f];
      if (set.updatedAt !== undefined) p.warnings.push('updatedAt は無視します');
      const r = validateFields(k, rest, { resolve, partial: true });
      p.errors.push(...r.errors); p.warnings.push(...r.warnings); p.unknown = r.unknown;
      if (op.addLinks !== undefined) {
        if (!Array.isArray(op.addLinks)) p.errors.push('addLinks は ID の配列で指定してください');
        else p.errors.push(...validateFields(k, { links: op.addLinks }, { resolve, partial: true }).errors.map((e) => e.replace('関連（links）', '追加する関連（addLinks）')));
      }
      if (!Object.keys(rest).length && !op.addLinks) p.errors.push('変更する内容（set か addLinks）がありません');
      if (op.reason !== undefined && typeof op.reason !== 'string') p.warnings.push('reason は文字列で指定してください（無視します）');
      if (k === 'decision' && set.supersedes === op.id) p.errors.push('supersedes に自分自身は指定できません');
      // 配列の項目は丸ごと置き換わるので、消える要素を知らせる（P4 AC-16）
      for (const r of removedElements(ledger, op)) {
        p.warnings.push(`この更新で${refFieldLabel(r.field, k)}から次が消えます: ${r.names.join('、')}（残すときは、変えない要素も含めて全部返させてください）`);
      }
    } else if (op.op === 'relate') {
      for (const end of ['from', 'to']) {
        const id = op[end];
        const k = typeof id === 'string' ? resolve(id) : null;
        if (typeof id !== 'string' || id === '') p.errors.push(`${end}: ID を文字列で指定してください`);
        else if (!k) {
          if (TEMP_ID_RE.test(id)) p.errors.push(`${end}: 仮ID「${id}」はこの差分の中にありません`);
          else if (!kindOfId(id)) p.errors.push(`${end}: 「${id}」は ID の形式ではありません（例: SH-001 / new:1）`);
          else p.errors.push(`${end}: ID「${id}」は台帳にありません`);
        } else if (!RELATION_NODE_KINDS.includes(k)) p.errors.push(`${end}: 「${id}」は${kindLabel(k)}です。関係は関係者とシステムの間にだけ引けます`);
      }
      if (typeof op.label !== 'string' || op.label.trim() === '') p.errors.push('label（関係の名前。例: 発注、利用、連携）がありません');
      else if (relKeys.has(relKey(op.from, op.to, op.label))) p.errors.push('同じ関係がすでにあります（台帳か、この差分の前の操作に）');
      if (!p.errors.length) relKeys.add(relKey(op.from, op.to, op.label));
    } else if (op.op === 'project') {
      if (!isObj(op.set)) { p.errors.push('set（変更する案件情報）がありません'); continue; }
      const r = validateProject(op.set, true);
      p.errors.push(...r.errors); p.warnings.push(...r.warnings);
    }
  }
  return { errors, warnings, ops: parsed };
}

// 採用/却下の状態から、実際に適用される操作と警告を求める。
// accepted: 採用する操作の index の Set（誤りのある操作は含めても無視する）
// 戻り値: { apply: Set<index>, autoRejected: Set<index>, warnings: Map<index, string[]> }
export function planPatch(validated, accepted) {
  const ok = (p) => accepted.has(p.index) && !p.errors.length;
  const rejectedTemps = new Set(validated.ops.filter((p) => p.tempId && !ok(p)).map((p) => p.tempId));
  const apply = new Set();
  const autoRejected = new Set();
  const warnings = new Map();
  const warn = (i, m) => { if (!warnings.has(i)) warnings.set(i, []); warnings.get(i).push(m); };
  for (const p of validated.ops) {
    if (!ok(p)) continue;
    const op = p.op;
    if (op.op === 'relate') {
      const bad = ['from', 'to'].filter((e) => rejectedTemps.has(op[e]));
      if (bad.length) {
        autoRejected.add(p.index);
        warn(p.index, `参照先 ${bad.map((e) => op[e]).join('・')} の追加が却下されたため、この関係は取り込みません`);
        continue;
      }
    } else if (op.op === 'add' || op.op === 'update') {
      const obj = op.op === 'add' ? op.item : { ...(op.set || {}), links: [...((op.set && op.set.links) || []), ...(op.addLinks || [])] };
      for (const rf of REF_FIELDS) {
        if (rf.shape === 'source') {
          for (const s of Array.isArray(obj.sources) ? obj.sources : []) {
            if (s && rejectedTemps.has(s.speaker)) warn(p.index, `参照先 ${s.speaker} の追加が却下されたため、出典「${s.ref}」の発言者を外します`);
          }
        } else if (rf.shape === 'nested') {
          for (const el of Array.isArray(obj[rf.field]) ? obj[rf.field] : []) {
            const id = nestedRef(el, rf.path);
            if (rejectedTemps.has(id)) warn(p.index, rf.dropElement
              ? `参照先 ${id} の追加が却下されたため、${refFieldLabel(rf.field, p.kind)}からその行を外します`
              : `参照先 ${id} の追加が却下されたため、「${el.name}」の参照（${rf.path[0]}）を外します`);
          }
        } else if (rf.shape === 'many') {
          for (const id of Array.isArray(obj[rf.field]) ? obj[rf.field] : []) {
            if (rejectedTemps.has(id)) warn(p.index, `参照先 ${id} の追加が却下されたため、${refFieldLabel(rf.field)}から外します`);
          }
        } else if (rejectedTemps.has(obj[rf.field])) {
          warn(p.index, `参照先 ${obj[rf.field]} の追加が却下されたため、${refFieldLabel(rf.field, p.kind)}を外します`);
        }
      }
    }
    apply.add(p.index);
  }
  return { apply, autoRejected, warnings };
}

// 参照フィールドの ID を置き換える。sub(id) が null を返したら外す
function substituteRefs(kind, obj, sub) {
  const out = { ...obj };
  for (const rf of REF_FIELDS) {
    if (!rf.on.includes(kind)) continue;
    if (rf.shape === 'source') {
      if (Array.isArray(out.sources)) {
        out.sources = out.sources.map((s) => {
          if (!s || s.speaker === undefined) return s;
          const v = sub(s.speaker);
          const c = { ...s };
          if (v) c.speaker = v; else delete c.speaker;
          return c;
        });
      }
    } else if (rf.shape === 'nested') {
      if (Array.isArray(out[rf.field])) {
        out[rf.field] = out[rf.field].map((el) => {
          const id = nestedRef(el, rf.path);
          if (!id) return el;
          const v = sub(id);
          if (!v) {
            if (rf.dropElement) return null;
            const c = { ...el };
            delete c[rf.path[0]];   // 参照のオブジェクト（fk / source）ごと外す
            return c;
          }
          // path の先の ID を置き換えた写しを作る
          const c = { ...el };
          if (rf.path.length === 1) c[rf.path[0]] = v;
          else c[rf.path[0]] = { ...el[rf.path[0]], [rf.path[1]]: v };
          return c;
        }).filter((x) => x !== null);
      }
    } else if (rf.shape === 'many') {
      if (Array.isArray(out[rf.field])) out[rf.field] = [...new Set(out[rf.field].map(sub).filter(Boolean))];
    } else if (out[rf.field] !== undefined && out[rf.field] !== null) {
      const v = sub(out[rf.field]);
      if (v) out[rf.field] = v; else delete out[rf.field];
    }
  }
  return out;
}

function stripUnknown(obj, unknown) {
  const out = { ...obj };
  for (const k of unknown) delete out[k];
  return out;
}

// 差分を適用して新しい台帳を返す。
// 戻り値: { ledger, idMap: Map<tempId, id>, applied: number }
// 変更の記録を1件足す（新しい台帳オブジェクトの changelog を直接書き換える。上限を超えたら古いものを捨てる）
// 上限を超えて古い記録を捨てるときは、捨てる記録にあった作業の値（S カーブ用）の最後の値を、起点の記録1件にまとめて先頭に残す
export function appendChange(next, entry) {
  if (!Array.isArray(next.changelog)) next.changelog = [];
  next.changelog.push(entry);
  if (next.changelog.length <= CHANGELOG_LIMIT) return;
  // 起点の記録の分も枠に入れるため、1件多く捨てる
  const drop = next.changelog.splice(0, next.changelog.length - CHANGELOG_LIMIT + 1);
  const last = new Map();
  for (const e of drop) {
    for (const c of e.changes || []) {
      if (c.values) last.set(c.id, { ...(last.get(c.id) || {}), ...c.values });
    }
  }
  const at = drop[drop.length - 1].at;
  const rev = drop[drop.length - 1].rev;
  next.changelog.unshift({ rev, at, source: 'snapshot', changes: [...last].map(([id, values]) => ({ id, op: 'update', kind: 'task', values })) });
}

// 作業の値の記録（S カーブの復元用）。この項目が変わったときだけ残す
const TRACKED_VALUES = ['progress', 'actual', 'estimate', 'status'];
function trackedValues(item, keys) {
  if (item.kind !== 'task') return null;
  const v = {};
  for (const k of TRACKED_VALUES) if (keys.includes(k) && item[k] !== undefined) v[k] = item[k];
  return Object.keys(v).length ? v : null;
}

export function applyPatch(ledger, validated, accepted, now, source = 'import') {
  const plan = planPatch(validated, accepted);
  const next = structuredClone(ledger);
  const counters = next.counters;
  const idMap = new Map();

  // 先に採番する（後ろの操作が前の仮IDを参照していても、前の操作が後ろの仮IDを参照していても置き換えられるように）
  for (const p of validated.ops) {
    if (!plan.apply.has(p.index) || p.op.op !== 'add') continue;
    const prefix = KINDS[p.op.item.kind].prefix;
    counters[prefix] = (counters[prefix] || 0) + 1;
    const id = formatId(prefix, counters[prefix]);
    p._newId = id;
    if (p.tempId) idMap.set(p.tempId, id);
  }
  const sub = (id) => (TEMP_ID_RE.test(id) ? idMap.get(id) || null : id);
  const byId = new Map(next.items.map((it) => [it.id, it]));
  const superseded = [];
  const changes = [];
  let applied = 0;

  for (const p of validated.ops) {
    if (!plan.apply.has(p.index)) continue;
    const op = p.op;
    if (op.op === 'add') {
      const kind = op.item.kind;
      const clean = stripUnknown(op.item, [...p.unknown, 'id', 'kind', 'createdAt', 'updatedAt']);
      for (const [k, v] of Object.entries(clean)) if (v === null) delete clean[k];
      const item = { id: p._newId, kind, ...substituteRefs(kind, withDefaults(kind, clean), sub), createdAt: now, updatedAt: now };
      item.links = item.links.filter((x) => x !== item.id);
      next.items.push(item);
      byId.set(item.id, item);
      const addValues = trackedValues(item, TRACKED_VALUES);
      changes.push(addValues ? { id: item.id, op: 'add', kind, values: addValues } : { id: item.id, op: 'add', kind });
      if (kind === 'decision' && item.supersedes) superseded.push(item.supersedes);
    } else if (op.op === 'update') {
      const target = byId.get(op.id);
      // 検証した後に台帳が変わって対象が無くなっていたら、この操作は飛ばす（壊さない）
      if (!target) continue;
      const set = stripUnknown(op.set || {}, [...p.unknown, ...FORBIDDEN_SET, 'updatedAt']);
      const s = substituteRefs(target.kind, set, sub);
      const change = { id: target.id, op: 'update', kind: target.kind, fields: Object.keys(s) };
      if (s.status !== undefined && s.status !== target.status) { change.statusFrom = target.status; change.statusTo = s.status; }
      if (Array.isArray(op.addLinks) && !change.fields.includes('links')) change.fields.push('links');
      changes.push(change);
      for (const [k, v] of Object.entries(s)) {
        if (v === null) delete target[k];
        else target[k] = v;
      }
      if (Array.isArray(op.addLinks)) {
        const add = op.addLinks.map(sub).filter(Boolean);
        target.links = [...new Set([...(target.links || []), ...add])];
      }
      target.links = (target.links || []).filter((x) => x !== target.id);
      target.updatedAt = now;
      const upd = trackedValues(target, Object.keys(s));
      if (upd) change.values = upd;
      if (target.kind === 'decision' && s.supersedes) superseded.push(s.supersedes);
    } else if (op.op === 'relate') {
      const from = sub(op.from);
      const to = sub(op.to);
      // 仮IDを解決した結果、既存の関係と同じになったものは足さない
      if (next.relations.some((r) => relKey(r.from, r.to, r.label) === relKey(from, to, op.label))) continue;
      counters[RELATION_PREFIX] = (counters[RELATION_PREFIX] || 0) + 1;
      next.relations.push({ id: formatId(RELATION_PREFIX, counters[RELATION_PREFIX]), from, to, label: op.label.trim() });
      changes.push({ id: formatId(RELATION_PREFIX, counters[RELATION_PREFIX]), op: 'relate' });
    } else if (op.op === 'project') {
      changes.push({ id: 'project', op: 'project', fields: Object.keys(op.set) });
      for (const [k, v] of Object.entries(op.set)) {
        if (!['name', 'customer', 'purpose', 'periodStart', 'periodEnd', 'goals', 'summary', 'starter'].includes(k)) continue;
        if (v === null) delete next.project[k];
        else next.project[k] = v;
      }
    }
    applied++;
  }
  // 置き換えられた決定を superseded にする（AC-13b）
  for (const id of superseded) {
    const d = byId.get(id);
    if (d && d.kind === 'decision' && d.status !== 'superseded') {
      changes.push({ id: d.id, op: 'update', kind: 'decision', fields: ['status'], statusFrom: d.status, statusTo: 'superseded' });
      d.status = 'superseded'; d.updatedAt = now;
    }
  }
  for (const p of validated.ops) delete p._newId;
  next.revision = ledger.revision + 1;
  next.updatedAt = now;
  if (changes.length) appendChange(next, { rev: next.revision, at: now, source, changes });
  return { ledger: next, idMap, applied };
}

// 仮に適用して、項目をまたぐ検査で新しく出る誤りを調べる（取込の「適用」を押せるかの判定）
export function previewPatch(ledger, validated, accepted, now) {
  const r = applyPatch(ledger, validated, accepted, now);
  return { ...r, integrityErrors: newIntegrityErrors(ledger, r.ledger) };
}

// 画面の内部から作る差分（詳細パネルでの変更など）を検証して適用する
export const MEMO_PATCH_ERROR = 'メモは差分で足したり変えたりできません（メモの画面で扱います）';

// メモを消す（画面の操作だけ。取り消し・変更の記録・revision の対象）。メモを指す関連（links）も外す
function removeMemos(ledger, ids, now, source) {
  const errors = [];
  for (const id of ids) {
    const it = ledger.items.find((x) => x.id === id);
    if (!it) errors.push(`ID「${id}」は台帳にありません`);
    else if (it.kind !== 'memo') errors.push(`${id} はメモではありません。消せるのはメモだけです`);
  }
  if (errors.length) return { ok: false, errors };
  const gone = new Set(ids);
  const next = structuredClone(ledger);
  next.items = next.items.filter((x) => !gone.has(x.id)).map((x) => (Array.isArray(x.links) && x.links.some((l) => gone.has(l)) ? { ...x, links: x.links.filter((l) => !gone.has(l)), updatedAt: now } : x));
  next.revision = ledger.revision + 1;
  next.updatedAt = now;
  appendChange(next, { rev: next.revision, at: now, source, changes: ids.map((id) => ({ id, op: 'remove', kind: 'memo' })) });
  return { ok: true, ledger: next, idMap: {}, applied: ids.length };
}

export function applyLocalOps(ledger, ops, now, source = 'local') {
  const removes = ops.filter((o) => o && o.op === 'remove');
  if (removes.length) {
    if (removes.length !== ops.length) return { ok: false, errors: ['remove は他の操作と混ぜられません'] };
    return removeMemos(ledger, removes.map((o) => o.id), now, source);
  }
  const v = validatePatch({ type: 'ledger-patch', schemaVersion: SCHEMA_VERSION, ops }, ledger, { local: true });
  const errs = [...v.errors, ...v.ops.flatMap((p) => p.errors)];
  if (errs.length) return { ok: false, errors: errs };
  const r = applyPatch(ledger, v, new Set(v.ops.map((p) => p.index)), now, source);
  const integ = newIntegrityErrors(ledger, r.ledger);
  if (integ.length) return { ok: false, errors: integ.map((e) => `${e.itemId}: ${e.message}`) };
  return { ok: true, ...r };
}

// update の「変更前 → 変更後」の行を作る（表示用）
export function updateRows(ledger, op) {
  const target = ledger.items.find((it) => it.id === op.id);
  if (!target) return [];
  const rows = [];
  for (const [k, after] of Object.entries(op.set || {})) {
    if (['id', 'kind', 'createdAt', 'updatedAt'].includes(k)) continue;
    const spec = fieldSpec(target.kind, k);
    rows.push({ field: k, label: spec ? spec.label : k, before: target[k], after });
  }
  if (Array.isArray(op.addLinks)) rows.push({ field: 'links', label: '関連（追記）', before: target.links, after: [...(target.links || []), ...op.addLinks] });
  return rows;
}

// 配列の項目（列・項目・CRUD）の update で消える要素の名前（取込の警告用。配列は丸ごと置き換わるため）
export function removedElements(ledger, op) {
  const target = ledger.items.find((it) => it.id === op.id);
  if (!target || !op.set) return [];
  const out = [];
  const keyOf = { columns: (e) => e && e.name, fields: (e) => e && e.name, crud: (e) => e && e.entity, raci: (e) => e && e.who };
  for (const f of Object.keys(keyOf)) {
    if (!Array.isArray(op.set[f]) || !Array.isArray(target[f])) continue;
    const after = new Set(op.set[f].map(keyOf[f]));
    const gone = target[f].map(keyOf[f]).filter((k) => k && !after.has(k));
    if (gone.length) out.push({ field: f, names: gone });
  }
  return out;
}
