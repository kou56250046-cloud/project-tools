// P6d T6: 忠実さの点検
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fidelityCheck, fidelityWords } from '../src/core/fidelity.js';

test('元にあって返事に無い数値・英数字の語・漢字カタカナの語を出す', () => {
  const src = '# 受注処理\n\n| 項目 | 金額 |\n|---|---|\n| 見積 | 1,250,000 |\n| 値引き | 35000 |\n\nシステム名 SAP-ERP、締め日 25日';
  const reply = '# 受注処理\n\n| 項目 | 金額 |\n|---|---|\n| 見積 | 1250000 |\n\nシステム名 sap-erp';
  const r = fidelityCheck(src, reply);
  assert.ok(r.missing.includes('35000'));
  assert.ok(r.missing.includes('値引'));
  assert.ok(r.missing.includes('25'), '締め日の 25 が抜けている');
  assert.ok(!r.missing.includes('1250000'), '桁区切りの違いは抜けにしない');
  assert.ok(!r.missing.includes('sap-erp'), '大文字小文字の違いは抜けにしない');
  assert.ok(r.rate < 1 && r.rate > 0);
});

test('HTML の返事はタグを外して照合する。全角半角の違いは抜けにしない', () => {
  const r = fidelityCheck('申請番号 ＡＢ１２ 金額１０００', '<table><tr><td>申請番号</td><td>AB12</td></tr></table><p>金額 1,000</p>');
  assert.equal(r.missingCount, 0, r.missing.join());
  assert.deepEqual(fidelityCheck('', 'x'), { total: 0, missing: [], missingCount: 0, rate: 1 });
  assert.ok(fidelityWords('<!-- 出典: a.pptx -->本文').every((w) => w !== 'pptx'), '出典の注記は語にしない');
});
