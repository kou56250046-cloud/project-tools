// ほかの画面で作った差分（ledger-patch）を、取込の画面に渡す（判断・データ・質問箱で共通）
// 取込の画面に下書き（貼った文）があれば、置き換えてよいかを確かめる

import { confirmDialog } from '../dom.js';
import { importDraftText } from './import.js';

export async function sendPatchToImport(app, patch) {
  const cur = importDraftText();
  if (cur && cur.trim() && !(await confirmDialog('取込の画面に下書き（貼った文）があります。', '置き換える', '今の下書きを置き換えます。下書きを残したいときは「やめる」を押し、先に取込を済ませてください。'))) return;
  app.go('import', { text: JSON.stringify(patch, null, 2) });
}
