// 忠実さの点検（P6d）: 元の資料をツールで変換した文字と、Gemini が書き写した md・HTML を照合し、元にあって返事に無い語を出す
// 語: 数値（桁区切り・全角は正規化）、英数字の 2 文字以上の語、漢字・カタカナの 2 文字以上の連なり。DOM に触れない

export const FIDELITY_LIST_MAX = 100;

// HTML ならタグを外して、実体参照を戻す。md の書式記号は語の区切りになるので、そのままでよい
function fdPlain(text) {
  let t = String(text || '');
  if (/<\/?[a-zA-Z][^>]*>/.test(t)) {
    t = t.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ')
      .replace(/&(lt|gt|amp|quot|#39|nbsp);/g, (m, k) => ({ lt: '<', gt: '>', amp: '&', quot: '"', '#39': "'", nbsp: ' ' })[k]);
  }
  return t.normalize('NFKC');
}
// 語を出てきた順に（重なりは除く）
export function fidelityWords(text) {
  const t = fdPlain(text).replace(/<!--[\s\S]*?-->/g, ' ');
  const out = [];
  const seen = new Set();
  const add = (w) => { if (!seen.has(w)) { seen.add(w); out.push(w); } };
  // 数値: 1,000 → 1000、3.14。年月日の 2026-11-27 は数字ごとに分かれる
  // 1 桁の数（番号・箇条の数）は多すぎて意味が薄いので、2 桁以上だけ
  for (const m of t.matchAll(/\d[\d,]*(?:\.\d+)?/g)) { const n = m[0].replace(/,/g, ''); if (n.length >= 2) add(n); }
  for (const m of t.matchAll(/[A-Za-z][A-Za-z0-9_-]+/g)) add(m[0].toLowerCase());
  for (const m of t.matchAll(/[\p{Script=Han}\p{Script=Katakana}ー]{2,}/gu)) add(m[0]);
  return out;
}
// 戻り値 { total, missing: [語]（最大 FIDELITY_LIST_MAX）, missingCount, rate（元の語のうち返事にあった割合 0〜1） }
export function fidelityCheck(sourceText, replyText) {
  const src = fidelityWords(sourceText);
  const reply = fdPlain(replyText);
  // 数値と英数字の語は、返事の語の集まりと完全一致で照合する（25 が 1250000 の一部に当たらないように）。漢字・カタカナは部分一致
  const replyWords = new Set(fidelityWords(replyText));
  const missing = [];
  for (const w of src) {
    const hit = /^[\d.-]|^[a-z]/.test(w) ? replyWords.has(w) : reply.includes(w);
    if (!hit) missing.push(w);
  }
  return { total: src.length, missing: missing.slice(0, FIDELITY_LIST_MAX), missingCount: missing.length, rate: src.length ? (src.length - missing.length) / src.length : 1 };
}
