// マスタの点検: 元データ（CSV / TSV）をテーブルの列の定義と突き合わせる。元データは保存しない

export const CHECKS = [
  { v: 'header', label: '見出しと列の対応' },
  { v: 'pk', label: '主キーの重複' },
  { v: 'required', label: '必須の空欄' },
  { v: 'type', label: '型と長さの違反' },
  { v: 'pattern', label: 'コードの形の違反' },
  { v: 'fk', label: '参照先に無い値' },
];
export const ISSUE_LIMIT = 1000;

const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();

// 見出し → 列の対応。戻り値: { map: (列 | null)[], unknown: string[], missing: Column[] }
export function mapHeaders(entity, header) {
  const cols = entity.columns || [];
  const map = header.map((hd) => cols.find((c) => norm(c.name) === norm(hd) || (c.logical && norm(c.logical) === norm(hd))) || null);
  const unknown = header.filter((hd, i) => !map[i] && norm(hd) !== '');
  const missing = cols.filter((c) => (c.required || c.pk) && !map.includes(c));
  return { map, unknown, missing };
}

function isValidDate(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

// 型と長さ。違反ならメッセージ、問題なければ null
export function typeError(col, v) {
  const s = String(v);
  switch (col.type) {
    case 'int':
    case 'bigint':
      return /^-?\d+$/.test(s) ? null : '整数ではありません';
    case 'decimal': {
      const m = /^-?(\d+)(?:\.(\d+))?$/.exec(s);
      if (!m) return '数値ではありません';
      const scale = col.scale || 0;
      if ((m[2] || '').length > scale) return `小数点以下は ${scale} 桁までです`;
      if (col.length && m[1].replace(/^0+(?=\d)/, '').length > col.length - scale) return `整数部が ${col.length - scale} 桁を超えています`;
      return null;
    }
    case 'date': {
      const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);
      return m && isValidDate(+m[1], +m[2], +m[3]) ? null : '日付（YYYY-MM-DD か YYYY/MM/DD）ではありません';
    }
    case 'datetime': {
      const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
      return m && isValidDate(+m[1], +m[2], +m[3]) && (m[4] === undefined || (+m[4] < 24 && +m[5] < 60)) ? null : '日時ではありません';
    }
    case 'boolean':
      return /^(0|1|true|false)$/i.test(s) ? null : '0 / 1 / true / false ではありません';
    default:
      return col.length && [...s].length > col.length ? `${col.length} 文字を超えています（${[...s].length} 文字）` : null;
  }
}

// rows: 見出しを含む string[][]。refData: Map<テーブルID, { header: string[], rows: string[][] }>（外部キーの点検用。任意）
// 戻り値: { summary: Record<種類, 件数>, issues: [{ row, column, type, value, message }], total, dataRows, mapping }
export function checkMaster(entity, rows, refData = new Map(), allEntities = []) {
  const summary = Object.fromEntries(CHECKS.map((c) => [c.v, 0]));
  const issues = [];
  const add = (row, column, type, value, message) => {
    summary[type]++;
    if (issues.length < ISSUE_LIMIT) issues.push({ row, column, type, value, message });
  };
  if (!rows.length) return { summary, issues, total: 0, dataRows: 0, mapping: null };
  const header = rows[0];
  const mapping = mapHeaders(entity, header);
  for (const u of mapping.unknown) add(1, u, 'header', u, `見出し「${u}」に当たる列がありません`);
  for (const c of mapping.missing) add(1, c.name, 'header', '', `必須の列「${c.name}」${c.logical ? `（${c.logical}）` : ''}の見出しがありません`);

  // 外部キーの参照先の値の集合（参照先の元データが渡されたときだけ）
  const refSets = new Map();
  for (const c of entity.columns || []) {
    if (!c.fk || !refData.has(c.fk.entity)) continue;
    const ref = refData.get(c.fk.entity);
    const refEnt = allEntities.find((e) => e.id === c.fk.entity);
    if (!refEnt) continue;
    const m = mapHeaders(refEnt, ref.header);
    const idx = m.map.findIndex((x) => x && norm(x.name) === norm(c.fk.column));
    if (idx < 0) continue;
    refSets.set(c.name, new Set(ref.rows.map((r) => String(r[idx] ?? '').trim())));
  }

  const pkCols = mapping.map.map((c, i) => (c && c.pk ? i : -1)).filter((i) => i >= 0);
  const seenPk = new Map();
  let dataRows = 0;
  for (let r = 1; r < rows.length; r++) {
    const line = r + 1;  // 見出しが 1 行目
    const row = rows[r];
    dataRows++;
    mapping.map.forEach((col, i) => {
      if (!col) return;
      const v = String(row[i] ?? '').trim();
      if (v === '') {
        if (col.required || col.pk) add(line, col.name, 'required', '', `「${col.name}」が空です`);
        return;
      }
      const te = typeError(col, v);
      if (te) add(line, col.name, 'type', v, `「${col.name}」: ${te}`);
      if (col.pattern) {
        let re = null;
        try { re = new RegExp(col.pattern); } catch (e) { re = null; }
        if (re && !re.test(v)) add(line, col.name, 'pattern', v, `「${col.name}」がコードの形（${col.pattern}）に合いません`);
      }
      if (refSets.has(col.name) && !refSets.get(col.name).has(v)) add(line, col.name, 'fk', v, `「${col.name}」の値「${v}」が参照先に見つかりません`);
    });
    if (pkCols.length) {
      const key = pkCols.map((i) => String(row[i] ?? '').trim()).join('\u0001');
      if (pkCols.every((i) => String(row[i] ?? '').trim() !== '')) {
        if (seenPk.has(key)) add(line, pkCols.map((i) => mapping.map[i].name).join('+'), 'pk', key.split('\u0001').join(' / '), `主キーが ${seenPk.get(key)} 行目と重複しています`);
        else seenPk.set(key, line);
      }
    }
  }
  return { summary, issues, total: Object.values(summary).reduce((a, b) => a + b, 0), dataRows, mapping };
}
