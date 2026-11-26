// 画面の状態。台帳・取り消し・書き出し状態を持ち、localStorage に「暗号化して」保存する。
//
// 保存の状態（vaultState）:
//   empty    保存された台帳が無い。新しく作る・読み込むときに合言葉を決める
//   legacy   P1 の平文の保存が残っている。合言葉を決めると暗号化し、平文を消す
//   locked   暗号化した台帳がある。合言葉を入れるまで開けない
//   unlocked 開いている。鍵はメモリにだけある
//   nostore  この環境では暗号化が使えない。ブラウザには保存しない（書き出しが正本）
//
// P5 から箱の中身は複数案件の入れ物（workspace）。ledger・undoLedger・exportedRevision・exportedAt は
// 「今開いている案件」の値を返す getter にしてあり、画面側は今までどおり store.ledger を読めばよい

import { validateLedger, normalizeCounters, migrateLedger, validateSettings, formatId, BASELINE_PREFIX, visibleLedger, SETTINGS } from '../core/schema.js';
import { applyPatch, applyLocalOps, appendChange } from '../core/patch.js';
import { safeParse } from '../core/extract.js';
import { cryptoAvailable, newSalt, deriveKey, sealText, parseBox, openBox, PBKDF2_ITERATIONS } from '../core/vault.js';
import { nowIso } from './dom.js';
import { emptyWorkspace, migrateWorkspace, openWorkspace, newProjectId, findByName } from '../core/workspace.js';
import { createLedger } from '../core/starter.js';

export const UNDO_LIMIT = 20;
const STEP_OPS = new Set(['settings', 'baseline', 'reset']);

// 取り消しの段の表示用の種類と件数を、適用後の台帳の最後の記録から作る
function stepInfo(after) {
  const log = after && after.changelog;
  const e = log && log.length ? log[log.length - 1] : null;
  if (!e || e.rev !== after.revision) return { kind: 'local', count: 0 };
  const changes = e.changes || [];
  const op = changes[0] && changes[0].op;
  return { kind: STEP_OPS.has(op) ? op : (e.source || 'local'), count: changes.length };
}

const KEY_VAULT = 'anken-workbench:v1:vault';
const KEY_RECOVERY = 'anken-workbench:v1:recovery';
const KEY_LEGACY = 'anken-workbench:v1:ledger';
const KEY_EXPORTED = 'anken-workbench:v1:exportedRevision';
const KEY_EXPORTED_AT = 'anken-workbench:v1:exportedAt';

function lsGet(key) {
  try { return window.localStorage.getItem(key); } catch (e) { return null; }
}
function lsSet(key, value) {
  try { window.localStorage.setItem(key, value); return true; } catch (e) { return false; }
}
function lsRemove(key) {
  try { window.localStorage.removeItem(key); } catch (e) { /* 何もしない */ }
}

// 台帳のオブジェクトを移行して検査する。戻り値: { ok, ledger, migrated } / { ok: false, errors }
function checkLedgerObject(obj) {
  const m = migrateLedger(obj);
  if (m.error) return { ok: false, errors: [m.error] };
  let errs;
  try { errs = validateLedger(m.ledger, { allowDanglingRefs: true }); } catch (e) {
    errs = ['台帳の検査中に問題が起きました（' + String(e && e.message || e) + '）'];
  }
  if (errs.length) return { ok: false, errors: errs };
  return { ok: true, ledger: normalizeCounters(m.ledger), migrated: m.migrated };
}

// 台帳の文字列を検査して読む
function readLedgerText(text) {
  let obj;
  try { obj = safeParse(String(text).replace(/^﻿/, '')); } catch (e) {
    return { ok: false, errors: ['JSON として読めません'] };
  }
  return checkLedgerObject(obj);
}

export const store = {
  workspace: emptyWorkspace(),
  undoById: new Map(),     // 案件ごとの取り消しの段 [{ ledger: 適用前, at, kind, count }]（古い順・最大 UNDO_LIMIT・メモリのみ）
  legacyExported: null,    // P4 までの書き出し状態（移行で使う）
  recovery: {},            // 読めなかった案件の元の文字列 { 案件ID: 文字列 }（暗号化して退避する）
  gen: 0,                  // 台帳が変わるたびに増える世代（revision は取り消しや新規作成で重なるため別に持つ）
  token: '',               // 台帳を置き換えるたびに変わる印（取込の下書きを捨てる判定に使う）
  vaultState: 'empty',
  key: null,
  salt: null,
  passChanging: false,     // 合言葉の変更中（ロックを押せなくする）
  keyRef: null,            // 書き込みに使う鍵 { key, salt }。保存の列に並んだ処理は、実行する時点でこれを読む（合言葉の変更が後から効くように）
  saving: Promise.resolve(),
  saveError: null,
  loadError: null,
  selectedId: null,
  presentation: false,     // 説明用の表示（保存しない。開き直すと通常に戻る）
  listeners: new Set(),

  // ---- 今開いている案件 ----
  get activeId() { return this.workspace.activeId; },
  get ledger() {
    const id = this.workspace.activeId;
    return id ? this.workspace.ledgers[id] || null : null;
  },
  set ledger(v) {
    if (!v) return;
    if (!this.workspace.activeId) {
      const id = newProjectId();
      this.workspace.activeId = id;
      this.workspace.exported[id] = { revision: null, at: null };
    }
    this.workspace.ledgers[this.workspace.activeId] = v;
  },
  get undoSteps() { return this.undoById.get(this.workspace.activeId) || []; },
  // 変更を1段積む（before: 適用前、after: 適用後）
  pushUndo(before, after) {
    const id = this.workspace.activeId;
    if (!id || !before) return;
    const steps = this.undoById.get(id) || [];
    steps.push({ ledger: before, at: after.updatedAt || nowIso(), ...stepInfo(after) });
    if (steps.length > UNDO_LIMIT) steps.splice(0, steps.length - UNDO_LIMIT);
    this.undoById.set(id, steps);
  },
  get exportedRevision() { const e = this.workspace.exported[this.workspace.activeId]; return e ? e.revision : null; },
  get exportedAt() { const e = this.workspace.exported[this.workspace.activeId]; return e ? e.at : null; },
  get recoveryText() {
    const v = Object.values(this.recovery);
    return v.length ? v.join('\n\n') : null;
  },

  init() {
    const ex = lsGet(KEY_EXPORTED);
    this.legacyExported = { revision: ex === null || ex === '' ? null : Number(ex), at: lsGet(KEY_EXPORTED_AT) || null };
    if (!cryptoAvailable()) {
      this.vaultState = 'nostore';
      this.loadError = 'このブラウザでは暗号化が使えないため、台帳をブラウザに保存しません。作業の区切りごとに必ず「書き出し」をしてください';
      return;
    }
    if (lsGet(KEY_VAULT)) { this.vaultState = 'locked'; return; }
    const legacy = lsGet(KEY_LEGACY);
    if (legacy) {
      this.vaultState = 'legacy';
      const r = readLedgerText(legacy);
      if (r.ok) {
        this.ledger = r.ledger;
        this.workspace.exported[this.workspace.activeId] = r.migrated ? { revision: null, at: null } : { ...this.legacyExported };
      } else { this.recovery = { legacy }; this.loadError = '以前の保存が壊れているため開けませんでした。「設定」から元のデータを書き出せます'; }
      this.token = Math.random().toString(36).slice(2);
    }
  },

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  emit(reason) { for (const fn of this.listeners) fn(reason); },

  needsPassphraseSetup() { return this.vaultState === 'empty' || this.vaultState === 'legacy'; },

  // 合言葉を決める（新規・平文からの移行）
  async setPassphrase(pass) {
    this.salt = newSalt();
    this.key = await deriveKey(pass, this.salt);
    this.keyRef = { key: this.key, salt: this.salt };
    this.vaultState = 'unlocked';
    if (this.recoveryText) await this.saveRecovery();
    lsRemove(KEY_LEGACY);
    lsRemove(KEY_EXPORTED); lsRemove(KEY_EXPORTED_AT);
    await this.persist();
    this.emit('vault');
  },

  // 合言葉で開ける。戻り値: { ok } / { ok: false, error }
  async unlock(pass) {
    const box = parseBox(lsGet(KEY_VAULT));
    if (!box) return { ok: false, error: '保存されたデータの形式が正しくありません' };
    const key = await deriveKey(pass, box.salt, box.iter);
    let text;
    try { text = await openBox(key, box); } catch (e) { return { ok: false, error: '合言葉が違います' }; }
    this.key = key;
    this.salt = box.salt;
    this.keyRef = { key, salt: box.salt };
    this.vaultState = 'unlocked';
    this.undoById.clear();
    this.loadError = null;
    // 以前の退避を先に読む（今回の退避と合わせて残すため）
    const rec = parseBox(lsGet(KEY_RECOVERY));
    let recovery = {};
    if (rec) {
      try {
        const t = await openBox(key, rec);
        let o = null;
        try { o = JSON.parse(t); } catch (e) { o = null; }
        recovery = o && o.type === 'recovery' && o.items ? o.items : { legacy: t };   // P1〜P4 の退避は文字列1つ
      } catch (e) { /* 別の合言葉の退避は扱わない */ }
    }
    let obj = null;
    try { obj = safeParse(text); } catch (e) { obj = null; }
    const m = obj ? migrateWorkspace(obj, this.legacyExported) : { error: 'JSON として読めません' };
    let changed = false;
    if (m.error) {
      // 中身の形が分からない。上書きで消えないように丸ごと退避する
      this.workspace = emptyWorkspace();
      recovery.all = text;
      this.loadError = '保存されていた台帳を開けませんでした（' + m.error + '）。元のデータは退避してあり、「設定」から書き出せます';
      changed = true;
    } else {
      const o = openWorkspace(m.workspace, checkLedgerObject);
      this.workspace = o.workspace;
      const brokenIds = Object.keys(o.broken);
      for (const id of brokenIds) recovery[id] = o.broken[id];
      if (brokenIds.length) this.loadError = `読めない案件が ${brokenIds.length} 件あったため、その案件だけを退避しました。「設定」から元のデータを書き出せます`;
      changed = m.wrapped || brokenIds.length > 0 || o.migratedIds.length > 0;
    }
    this.recovery = recovery;
    if (Object.keys(recovery).length) await this.saveRecovery();
    if (changed) {
      lsRemove(KEY_EXPORTED); lsRemove(KEY_EXPORTED_AT);
      this.persist();
    }
    this.token = Math.random().toString(36).slice(2);
    this.gen++;
    this.emit('vault');
    return { ok: true };
  },

  // 鍵と台帳をメモリから消す
  lock() {
    if (this.vaultState !== 'unlocked') return;
    this.workspace = emptyWorkspace(); this.undoById.clear(); this.key = null; this.keyRef = null; this.selectedId = null; this.recovery = {};
    this.vaultState = lsGet(KEY_VAULT) ? 'locked' : 'empty';
    this.gen++;
    this.emit('vault');
  },

  // 合言葉を忘れたとき: ブラウザ内の暗号化データを消して始め直す
  resetVault() {
    lsRemove(KEY_VAULT); lsRemove(KEY_RECOVERY);
    this.workspace = emptyWorkspace(); this.undoById.clear(); this.key = null; this.salt = null; this.keyRef = null; this.recovery = {}; this.loadError = null;
    this.vaultState = 'empty';
    this.gen++;
    this.emit('vault');
  },

  // 退避データを暗号化して保存する（保存の列に並べ、合言葉の変更と入れ替わらないようにする）
  saveRecovery() {
    const ref = this.keyRef;
    if (!ref) return this.saving;
    const items = { ...this.recovery };
    this.saving = this.saving.then(async () => {
      if (!Object.keys(items).length) { lsRemove(KEY_RECOVERY); return; }
      try { lsSet(KEY_RECOVERY, await sealText(ref.key, ref.salt, PBKDF2_ITERATIONS, JSON.stringify({ type: 'recovery', items }))); } catch (e) { /* 次の保存で書き直す */ }
    });
    return this.saving;
  },
  // id を省くとすべて消す
  async discardRecovery(id) {
    if (id) delete this.recovery[id]; else this.recovery = {};
    await this.saveRecovery();
    this.emit('vault');
  },

  // 暗号化して保存する。書き込みの順序が入れ替わらないよう直列にする
  persist() {
    if (this.vaultState !== 'unlocked' || !this.key) return this.saving;
    const text = JSON.stringify(this.workspace);
    const ref = this.keyRef;
    this.saving = this.saving.then(async () => {
      try {
        const ok = lsSet(KEY_VAULT, await sealText(ref.key, ref.salt, PBKDF2_ITERATIONS, text));
        this.saveError = ok ? null : 'ブラウザへの保存に失敗しました。容量不足の可能性があります。今すぐ「書き出し」で JSON を保存してください';
      } catch (e) {
        this.saveError = 'ブラウザへの保存（暗号化）に失敗しました。今すぐ「書き出し」で JSON を保存してください';
      }
      if (this.saveError) this.emit('save-error');
    });
    return this.saving;
  },

  // 合言葉を変える。全案件と退避データを新しい合言葉で暗号化し直す。戻り値: { ok } / { ok: false, error }
  // 保存の列の中で、確かめる → 暗号化 → 書き込み → 鍵の差し替え を行う。失敗したら元の保存に書き戻す
  changePassphrase(current, next) {
    const run = async () => {
      const ref = this.keyRef;
      if (this.vaultState !== 'unlocked' || !ref) return { ok: false, error: '台帳が開いていません' };
      // 待ちの間にロックされても空の入れ物を書かないよう、中身は先に写し取る
      const wsText = JSON.stringify(this.workspace);
      const items = { ...this.recovery };
      const alive = () => this.keyRef === ref && this.vaultState === 'unlocked';
      const aborted = { ok: false, error: '途中でロックされたため、合言葉は変えていません' };
      const oldVault = lsGet(KEY_VAULT);
      const oldRec = lsGet(KEY_RECOVERY);
      const box = parseBox(oldVault);
      if (!box) return { ok: false, error: '保存されたデータの形式が正しくありません' };
      try { await openBox(await deriveKey(current, box.salt, box.iter), box); } catch (e) { return { ok: false, error: '今の合言葉が違います' }; }
      if (!alive()) return aborted;
      const hasItems = Object.keys(items).length > 0;
      if (oldRec && !hasItems) return { ok: false, error: '開けない退避データがあります。先に「設定」から消すか、元の合言葉で開いて書き出してください' };
      let salt, key, vaultText, recText = null;
      try {
        salt = newSalt();
        key = await deriveKey(next, salt);
        vaultText = await sealText(key, salt, PBKDF2_ITERATIONS, wsText);
        if (hasItems) recText = await sealText(key, salt, PBKDF2_ITERATIONS, JSON.stringify({ type: 'recovery', items }));
      } catch (e) {
        return { ok: false, error: '暗号化に失敗しました。合言葉は変わっていません' };
      }
      if (!alive()) return aborted;
      if (!lsSet(KEY_VAULT, vaultText) || (recText !== null && !lsSet(KEY_RECOVERY, recText))) {
        lsSet(KEY_VAULT, oldVault);
        if (oldRec === null) lsRemove(KEY_RECOVERY); else lsSet(KEY_RECOVERY, oldRec);
        return { ok: false, error: '保存に失敗しました（容量不足の可能性）。合言葉は変わっていません' };
      }
      // 列に並んでいる保存も新しい鍵で書くよう、同じ入れ物の中身を差し替える
      ref.key = key; ref.salt = salt;
      this.key = key; this.salt = salt;
      this.saveError = null;
      return { ok: true };
    };
    this.passChanging = true;
    this.emit('pass');
    const p = this.saving.then(run).finally(() => { this.passChanging = false; this.emit('pass'); });
    this.saving = p.then(() => {}, () => {});
    return p.catch(() => ({ ok: false, error: '合言葉の変更に失敗しました。合言葉は変わっていません' }));
  },

  setExported(rev, at) {
    const id = this.workspace.activeId;
    if (!id) return;
    const cur = this.workspace.exported[id] || { revision: null, at: null };
    this.workspace.exported[id] = { revision: rev, at: at === undefined ? cur.at : at };
  },

  isDirty() {
    return !!this.ledger && this.ledger.revision !== this.exportedRevision;
  },

  // ---- 案件の追加・置き換え・切り替え・外す（P5） ----
  // 新しい案件として足して開く。合言葉の設定は呼び出し側で済ませておく
  addProject(ledger, { exported, migrated } = {}) {
    const id = newProjectId();
    this.workspace.ledgers[id] = normalizeCounters(ledger);
    this.workspace.exported[id] = { revision: exported && !migrated ? ledger.revision : null, at: exported && !migrated ? nowIso() : null };
    this.openProject(id, 'replace');
    return id;
  },
  // 既存の案件（同じ案件名など）を置き換えて開く
  replaceProject(id, ledger, { exported, migrated } = {}) {
    if (!this.workspace.ledgers[id]) return this.addProject(ledger, { exported, migrated });
    this.workspace.ledgers[id] = normalizeCounters(ledger);
    this.workspace.exported[id] = { revision: exported && !migrated ? ledger.revision : null, at: exported && !migrated ? nowIso() : null };
    this.undoById.delete(id);
    this.openProject(id, 'replace');
    return id;
  },
  // 互換: 新しい案件として足す
  replace(ledger, opts) { return this.addProject(ledger, opts); },
  openProject(id, reason = 'switch') {
    this.workspace.activeId = id;
    this.selectedId = null;
    if (reason !== 'switch') this.loadError = null;
    this.token = Math.random().toString(36).slice(2);
    this.gen++;
    this.persist();
    this.emit(reason);
  },
  switchProject(id) {
    if (!this.workspace.ledgers[id] || id === this.workspace.activeId) return false;
    this.openProject(id, 'switch');
    return true;
  },
  removeProject(id) {
    if (!this.workspace.ledgers[id]) return;
    delete this.workspace.ledgers[id];
    delete this.workspace.exported[id];
    this.undoById.delete(id);
    const next = this.workspace.activeId === id ? (Object.keys(this.workspace.ledgers)[0] || null) : this.workspace.activeId;
    this.openProject(next, 'replace');
  },
  projects() {
    return Object.entries(this.workspace.ledgers).map(([id, l]) => {
      const e = this.workspace.exported[id] || {};
      return { id, name: l.project.name, revision: l.revision, dirty: l.revision !== e.revision, exportedAt: e.at || null };
    });
  },
  findProjectByName(name) { return findByName(this.workspace, name); },
  // 保存の大きさ（文字数。localStorage はおよそ 5MB まで）
  storageSize() {
    return (lsGet(KEY_VAULT) || '').length + (lsGet(KEY_RECOVERY) || '').length;
  },

  // 取込画面から: validatePatch の結果と採用集合を適用する
  applyValidated(validated, accepted) {
    const before = this.ledger;
    const r = applyPatch(before, validated, accepted, nowIso(), 'import');
    this.pushUndo(before, r.ledger);
    this.ledger = r.ledger;
    this.gen++;
    this.persist();
    this.emit('apply');
    return r;
  },

  // 画面の内部の変更（詳細パネルなど）
  applyLocal(ops, source = 'local') {
    const before = this.ledger;
    const r = applyLocalOps(before, ops, nowIso(), source);
    if (!r.ok) return r;
    this.pushUndo(before, r.ledger);
    this.ledger = r.ledger;
    this.gen++;
    this.persist();
    this.emit('apply');
    return r;
  },

  // 差分の外の変更（設定・ベースライン）を、取り消し・記録・revision の対象として適用する
  commitExternal(mutate, change) {
    const before = this.ledger;
    const next = structuredClone(before);
    const now = nowIso();
    mutate(next);
    next.revision = before.revision + 1;
    next.updatedAt = now;
    appendChange(next, { rev: next.revision, at: now, source: 'local', changes: [change] });
    this.pushUndo(before, next);
    this.ledger = next;
    this.gen++;
    this.persist();
    this.emit('apply');
    return next;
  },

  // 台帳の設定を変える（AC: 設定の変更は revision +1・取り消し可・記録あり）
  updateSettings(partial) {
    const errors = validateSettings(partial);
    if (errors.length) return { ok: false, errors };
    this.commitExternal((next) => { next.settings = { ...(next.settings || {}), ...partial }; }, { id: 'settings', op: 'settings', fields: Object.keys(partial) });
    return { ok: true };
  },

  // ベースラインを記録する（要望・要件の ID・題名・範囲・状態の写し）
  recordBaseline(name, date) {
    let id;
    this.commitExternal((next) => {
      next.counters[BASELINE_PREFIX] = (next.counters[BASELINE_PREFIX] || 0) + 1;
      id = formatId(BASELINE_PREFIX, next.counters[BASELINE_PREFIX]);
      const items = next.items
        .filter((it) => it.kind === 'request' || it.kind === 'requirement')
        .map((it) => ({ id: it.id, kind: it.kind, title: it.title, scope: it.scope || 'tbd', status: it.status }));
      next.baselines.push({ id, name, date, items });
    }, { id: 'baseline', op: 'baseline' });
    return id;
  },

  // 案件の中身を空に戻す。案件情報と設定は残し、型を選び直す（null は型を使わない）。取り消しの1段になる
  resetProject(starterId) {
    const before = this.ledger;
    if (!before) return null;
    const now = nowIso();
    const next = createLedger(before.project.name, starterId || null, now);
    next.project = { ...structuredClone(before.project), starter: starterId || null };
    next.settings = structuredClone(before.settings || next.settings);
    // 関係者などを指す設定は、採番し直した別の項目を指さないよう、無くなった ID なら外す
    for (const [k, d] of Object.entries(SETTINGS)) {
      const v = next.settings[k];
      if (d.type === 'ref' && v && !next.items.some((it) => it.id === v)) next.settings[k] = null;
    }
    next.revision = before.revision + 1;
    next.updatedAt = now;
    next.changelog = [];
    appendChange(next, { rev: next.revision, at: now, source: 'local', changes: [{ id: 'reset', op: 'reset', starter: starterId || null }] });
    this.pushUndo(before, next);
    this.ledger = next;
    this.selectedId = null;
    this.token = Math.random().toString(36).slice(2);   // 取込の下書きを捨てる
    this.gen++;
    this.persist();
    this.emit('apply');
    return next;
  },

  canUndo() { return this.undoSteps.length > 0; },
  // 取り消しの段の一覧（新しい順）。index は undoTo に渡す配列の位置
  history() {
    return this.undoSteps.map((s, index) => ({ index, at: s.at, kind: s.kind, count: s.count })).reverse();
  },
  undo() { return this.undoTo(this.undoSteps.length - 1); },
  // 段の配列の i 番目の適用前に戻し、i 番目以降をすべて捨てる（失われる段の数 = 長さ − i）
  undoTo(i) {
    const steps = this.undoSteps;
    if (!Number.isInteger(i) || i < 0 || i >= steps.length) return false;
    this.ledger = steps[i].ledger;
    steps.splice(i);
    if (!steps.length) this.undoById.delete(this.workspace.activeId);
    this.gen++;
    // 書き出したものより前に戻ったら、同じ revision でも中身が違いうるので未書き出し扱いにする（日時は事実なので残す）
    if (this.exportedRevision !== null && this.exportedRevision > this.ledger.revision) this.setExported(null);
    if (this.selectedId && !this.ledger.items.some((it) => it.id === this.selectedId)) this.selectedId = null;
    this.persist();
    this.emit('undo');
    return true;
  },

  exportText() {
    return JSON.stringify(this.ledger, null, 2) + '\n';
  },
  exportFilename() {
    const name = (this.ledger.project.name || '案件').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    return `${name}_rev${this.ledger.revision}_${ymd}.json`;
  },
  // 保存ダイアログで取り消されても検知できないため、「書き出しを試みた」記録として扱う
  markExported() {
    this.setExported(this.ledger.revision, nowIso());
    this.persist();
    this.emit('exported');
  },

  // ファイルから読み込む前の検査。置き換えは呼び出し側が確認を取ってから replace する
  parseLedgerFile(text) {
    let obj;
    try { obj = safeParse(String(text).replace(/^﻿/, '')); } catch (e) {
      return { ok: false, errors: ['JSON として読めません。台帳の書き出しファイルか確かめてください'] };
    }
    if (obj && obj.type === 'ledger-patch') return { ok: false, errors: ['これは差分のファイルです。差分は「取込」画面に貼り付けてください'] };
    const r = checkLedgerObject(obj);
    if (!r.ok) return { ok: false, errors: r.errors.slice(0, 10), more: Math.max(0, r.errors.length - 10) };
    return { ok: true, ledger: r.ledger, migrated: r.migrated };
  },

  select(id) {
    this.selectedId = id;
    this.emit('select');
  },

  // 説明用の表示を反映した台帳（画面の一覧・集計はこれを使う）
  view() {
    return this.ledger ? visibleLedger(this.ledger, this.presentation) : null;
  },
  // 説明用の表示で隠れる項目か
  isHidden(id) {
    if (!this.presentation || !this.ledger) return false;
    const it = this.ledger.items.find((x) => x.id === id);
    return !!(it && it.internal);
  },
  setPresentation(on) {
    this.presentation = !!on;
    if (on && this.selectedId && this.isHidden(this.selectedId)) this.selectedId = null;
    this.emit('presentation');
  },

  item(id) {
    return this.ledger ? this.ledger.items.find((it) => it.id === id) || null : null;
  },
};
