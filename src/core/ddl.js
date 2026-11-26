// DDL の生成（PostgreSQL / SQL Server / Oracle）と、物理名の点検

export const DIALECTS = [
  { v: 'postgres', label: 'PostgreSQL' },
  { v: 'sqlserver', label: 'SQL Server' },
  { v: 'oracle', label: 'Oracle' },
];

const DEFAULT_LEN = { string: 255, code: 20 };

// 論理型 → 方言ごとの物理型
function physType(col, dialect) {
  const n = col.length || DEFAULT_LEN[col.type];
  const p = col.length || 18;
  const sc = col.scale || 0;
  const map = {
    postgres: { string: `VARCHAR(${n})`, code: `VARCHAR(${n})`, text: 'TEXT', int: 'INTEGER', bigint: 'BIGINT', decimal: `NUMERIC(${p},${sc})`, date: 'DATE', datetime: 'TIMESTAMP', boolean: 'BOOLEAN' },
    sqlserver: { string: `NVARCHAR(${n})`, code: `NVARCHAR(${n})`, text: 'NVARCHAR(MAX)', int: 'INT', bigint: 'BIGINT', decimal: `DECIMAL(${p},${sc})`, date: 'DATE', datetime: 'DATETIME2', boolean: 'BIT' },
    oracle: { string: `VARCHAR2(${n} CHAR)`, code: `VARCHAR2(${n} CHAR)`, text: 'CLOB', int: 'NUMBER(10)', bigint: 'NUMBER(19)', decimal: `NUMBER(${p},${sc})`, date: 'DATE', datetime: 'TIMESTAMP', boolean: 'NUMBER(1)' },
  };
  return map[dialect][col.type] || map[dialect].string;
}

const ident = (name, namingCase) => (namingCase === 'upper' ? String(name).toUpperCase() : String(name).toLowerCase());
const quote = (s) => String(s == null ? '' : s).replace(/'/g, "''");

// 外部キーの参照先が先に来る順に並べる。循環する外部キーは後から ALTER で足す
export function orderTables(entities) {
  const ids = new Set(entities.map((e) => e.id));
  const deps = new Map(entities.map((e) => [e.id, new Set((e.columns || []).map((c) => c.fk && c.fk.entity).filter((x) => x && x !== e.id && ids.has(x)))]));
  const order = [];
  const deferred = [];   // { from, colName }
  const state = new Map();
  const visit = (id, path) => {
    if (state.get(id) === 2) return;
    state.set(id, 1);
    for (const d of deps.get(id)) {
      if (state.get(d) === 1) { deferred.push({ from: id, to: d }); continue; }
      visit(d, path);
    }
    state.set(id, 2);
    order.push(id);
  };
  for (const e of [...entities].sort((a, b) => a.id.localeCompare(b.id))) if (!state.has(e.id)) visit(e.id);
  return { order: order.map((id) => entities.find((e) => e.id === id)), deferred };
}

// 戻り値: 文字列（そのまま流せる SQL）
export function generateDdl(ledger, dialect = 'postgres', namingCase = 'lower') {
  const all = ledger.items.filter((it) => it.kind === 'entity' && it.status !== 'dropped');
  const internal = all.filter((e) => e.fileType !== 'external');
  const byId = new Map(all.map((e) => [e.id, e]));
  const created = new Set(internal.map((e) => e.id));
  const { order, deferred } = orderTables(internal);
  const deferredSet = new Set(deferred.map((d) => d.from + '>' + d.to));
  const id = (n) => ident(n, namingCase);
  const L = [`-- ${ledger.project.name} のテーブル定義（${DIALECTS.find((d) => d.v === dialect).label}）`, '-- 案件ワークベンチで生成。外部参照のテーブルは作成しない'];
  const external = all.filter((e) => e.fileType === 'external');
  if (external.length) L.push(`-- 外部参照のテーブル（作成しない）: ${external.map((e) => `${id(e.physicalName)}（${e.title}）`).join(', ')}`);
  const alters = [];
  const comments = [];
  for (const e of order) {
    const t = id(e.physicalName);
    const cols = e.columns || [];
    const lines = cols.map((c) => `  ${id(c.name)} ${physType(c, dialect)}${c.required || c.pk ? ' NOT NULL' : ''}`);
    const pk = cols.filter((c) => c.pk).map((c) => id(c.name));
    if (pk.length) lines.push(`  CONSTRAINT ${id('pk_' + e.physicalName)} PRIMARY KEY (${pk.join(', ')})`);
    for (const c of cols) {
      if (!c.fk || !c.fk.entity) continue;
      const ref = byId.get(c.fk.entity);
      if (!ref) continue;
      const fkName = id(`fk_${e.physicalName}_${c.name}`);
      const clause = `FOREIGN KEY (${id(c.name)}) REFERENCES ${id(ref.physicalName)} (${id(c.fk.column)})`;
      if (!created.has(ref.id)) { lines.push(`  -- ${clause}（参照先は外部参照のため制約を作らない）`); continue; }
      if (deferredSet.has(e.id + '>' + ref.id)) alters.push(`ALTER TABLE ${t} ADD CONSTRAINT ${fkName} ${clause};`);
      else lines.push(`  CONSTRAINT ${fkName} ${clause}`);
    }
    // 最後の行のカンマを正しく付ける（コメント行には付けない）
    const body = [];
    const real = lines.map((x, i) => ({ x, i, comment: x.trim().startsWith('--') }));
    const lastReal = Math.max(...real.filter((r) => !r.comment).map((r) => r.i));
    for (const r of real) body.push(r.comment || r.i === lastReal ? r.x : r.x + ',');
    L.push('', `CREATE TABLE ${t} (`, ...body, ');');
    // コメント
    if (dialect === 'sqlserver') {
      comments.push(`EXEC sp_addextendedproperty N'MS_Description', N'${quote(e.title)}', N'SCHEMA', N'dbo', N'TABLE', N'${t}';`);
      for (const c of cols) if (c.logical || c.note) comments.push(`EXEC sp_addextendedproperty N'MS_Description', N'${quote([c.logical, c.note].filter(Boolean).join(' '))}', N'SCHEMA', N'dbo', N'TABLE', N'${t}', N'COLUMN', N'${id(c.name)}';`);
    } else {
      comments.push(`COMMENT ON TABLE ${t} IS '${quote(e.title)}';`);
      for (const c of cols) if (c.logical || c.note) comments.push(`COMMENT ON COLUMN ${t}.${id(c.name)} IS '${quote([c.logical, c.note].filter(Boolean).join(' '))}';`);
    }
  }
  if (alters.length) L.push('', '-- 循環する外部キー（テーブルを作った後に足す）', ...alters);
  if (comments.length) L.push('', '-- 表と列のコメント', ...comments);
  return L.join('\n') + '\n';
}

// 方言ごとの主な予約語（すべてではない。よく衝突するものを中心に）
const RESERVED_COMMON = ['add', 'all', 'alter', 'and', 'any', 'as', 'asc', 'between', 'by', 'case', 'check', 'column', 'constraint', 'create', 'current_date', 'current_time', 'default', 'delete', 'desc', 'distinct', 'drop', 'else', 'end', 'exists', 'foreign', 'from', 'grant', 'group', 'having', 'in', 'index', 'insert', 'into', 'is', 'join', 'key', 'like', 'not', 'null', 'on', 'or', 'order', 'primary', 'references', 'select', 'set', 'table', 'then', 'to', 'union', 'unique', 'update', 'user', 'values', 'view', 'when', 'where', 'with'];
const RESERVED = {
  postgres: [...RESERVED_COMMON, 'analyse', 'analyze', 'array', 'limit', 'offset', 'returning', 'window', 'only', 'placing'],
  sqlserver: [...RESERVED_COMMON, 'backup', 'browse', 'file', 'identity', 'key', 'open', 'percent', 'plan', 'rule', 'schema', 'top', 'transaction', 'tran'],
  oracle: [...RESERVED_COMMON, 'access', 'comment', 'date', 'file', 'level', 'mode', 'number', 'resource', 'rowid', 'rownum', 'session', 'size', 'start', 'uid', 'long', 'raw'],
};

// 戻り値: [{ itemId, message }]
export function lintNames(ledger, dialect = 'postgres', namingCase = 'lower') {
  const out = [];
  const re = namingCase === 'upper' ? /^[A-Z][A-Z0-9_]*$/ : /^[a-z][a-z0-9_]*$/;
  const rule = namingCase === 'upper' ? '英大文字・数字・下線（先頭は英字）' : '英小文字・数字・下線（先頭は英字）';
  const reserved = new Set(RESERVED[dialect]);
  const check = (itemId, what, name) => {
    if (!re.test(name)) out.push({ itemId, message: `${what}「${name}」は${rule}だけにしてください` });
    if (reserved.has(String(name).toLowerCase())) out.push({ itemId, message: `${what}「${name}」は ${DIALECTS.find((d) => d.v === dialect).label} の予約語です` });
    if (dialect === 'oracle' && String(name).length > 30) out.push({ itemId, message: `${what}「${name}」が 30 文字を超えています（古い Oracle では使えません）` });
  };
  for (const e of ledger.items.filter((it) => it.kind === 'entity' && it.status !== 'dropped')) {
    check(e.id, 'テーブル名', e.physicalName);
    for (const c of e.columns || []) if (c && c.name) check(e.id, `列名（${e.physicalName}）`, c.name);
  }
  return out;
}
