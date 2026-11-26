// P4 T3: ER 図の配置
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { layoutEr } from '../src/core/erlayout.js';
import { emptyLedger } from '../src/core/schema.js';
import { applyLocalOps } from '../src/core/patch.js';

const load = () => JSON.parse(readFileSync(new URL('../samples/sample-ledger.json', import.meta.url), 'utf8'));
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const onEdge = (box, [x, y]) => (x === box.x || x === box.x + box.w) && y >= box.y && y <= box.y + box.h;

function check(L) {
  for (let i = 0; i < L.boxes.length; i++) for (let j = i + 1; j < L.boxes.length; j++) {
    assert.equal(overlap(L.boxes[i], L.boxes[j]), false, `${L.boxes[i].id} と ${L.boxes[j].id} が重なる`);
  }
  const byId = new Map(L.boxes.map((b) => [b.id, b]));
  for (const ln of L.lines) {
    assert.ok(onEdge(byId.get(ln.from), ln.points[0]), `${ln.from}.${ln.column} の始点が箱の辺上にない`);
    assert.ok(onEdge(byId.get(ln.to), ln.points.at(-1)), `${ln.from}.${ln.column} の終点が箱の辺上にない`);
  }
}

test('サンプルの 6 テーブル: 箱が重ならず、線の両端が箱の辺上にある', () => {
  const L = layoutEr(load());
  assert.equal(L.boxes.length, 6);
  assert.equal(L.lines.length, 6);   // 外部キーの数（単価 2・受注 1・明細 2・在庫 1）
  check(L);
  // 参照先（得意先・商品）は参照元（得意先別単価・受注）より左
  const x = (name) => L.boxes.find((b) => b.physicalName === name).x;
  assert.ok(x('customer') < x('customer_price'));
  assert.ok(x('order_header') < x('order_line'));
});

test('循環する外部キーでも箱は重ならず、線の端は辺上', () => {
  const r = applyLocalOps(emptyLedger('x', '2026-11-26T00:00:00.000Z'), [
    { op: 'add', tempId: 'new:a', item: { kind: 'entity', title: 'A', physicalName: 'a', fileType: 'internal', columns: [{ name: 'id', type: 'int', pk: true }, { name: 'b_id', type: 'int', fk: { entity: 'new:b', column: 'id' } }] } },
    { op: 'add', tempId: 'new:b', item: { kind: 'entity', title: 'B', physicalName: 'b', fileType: 'internal', columns: [{ name: 'id', type: 'int', pk: true }, { name: 'a_id', type: 'int', fk: { entity: 'new:a', column: 'id' } }] } },
  ], '2026-11-26T00:00:00.000Z');
  check(layoutEr(r.ledger));
});

test('列が 20 を超えると「ほか N 列」になる', () => {
  const cols = Array.from({ length: 25 }, (_, i) => ({ name: 'c' + i, type: 'int', pk: i === 0 }));
  const r = applyLocalOps(emptyLedger('x', '2026-11-26T00:00:00.000Z'), [{ op: 'add', item: { kind: 'entity', title: 'W', physicalName: 'w', fileType: 'internal', columns: cols } }], '2026-11-26T00:00:00.000Z');
  const b = layoutEr(r.ledger).boxes[0];
  assert.equal(b.rows.length, 20);
  assert.equal(b.more, 5);
});
