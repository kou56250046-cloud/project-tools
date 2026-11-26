// Gemini の返答から JSON を取り出す寛容なパーサ。
import { SCHEMA_VERSION } from './schema.js';

// 囲み記号（```json）・前後の説明文・末尾のカンマ・全角の引用符・配列だけの返答に対応する。

// 文字列リテラルを考慮して、start の括弧に対応する閉じ括弧の位置を返す。無ければ -1
function matchBracket(text, start) {
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return c === close ? i : -1;
    }
  }
  return -1;
}

// 文字列の外にある末尾カンマ（, の直後が } か ]）を消す
function stripTrailingCommas(text) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (c === '\\') { out += text[i + 1] || ''; i++; } else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === '}' || text[j] === ']') continue;
    }
    out += c;
  }
  return out;
}

function lineOf(text, pos) {
  return text.slice(0, pos).split('\n').length;
}

// JSON.parse のエラーから位置を取り出して「○行目付近」にする
function describeParseError(err, text) {
  const msg = String(err && err.message || err);
  let m = /line (\d+) column (\d+)/.exec(msg);
  if (m) return `${m[1]}行目 ${m[2]}文字目付近`;
  m = /position (\d+)/.exec(msg);
  if (m) return `${lineOf(text, Number(m[1]))}行目付近`;
  return '位置不明';
}

// プロトタイプ汚染に使われるキーを捨てる（外部から来た JSON はすべてこれを通す）
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
export function safeReviver(key, value) {
  return DANGEROUS_KEYS.has(key) ? undefined : value;
}

export function safeParse(text) {
  return JSON.parse(text, safeReviver);
}

function tryParse(text) {
  try { return { ok: true, value: safeParse(text) }; } catch (e) { return { ok: false, error: e }; }
}

// 候補の文字列を取り出す。囲み記号の中を優先し、無ければ最初の { か [ から対応する括弧まで
function candidates(text) {
  const out = [];
  const fence = /```[ \t]*([A-Za-z0-9_-]*)[ \t]*\r?\n([\s\S]*?)```/g;
  let m;
  while ((m = fence.exec(text))) out.push({ body: m[2].trim(), note: '囲み記号（```' + (m[1] || '') + '）を外しました' });
  // 閉じていない囲み（出力が途中で切れた場合など）
  const open = /```[ \t]*(?:json)?[ \t]*\r?\n([\s\S]*)$/i.exec(text);
  if (!out.length && open) out.push({ body: open[1].trim(), note: '閉じていない囲み記号を外しました' });
  const firstObj = text.search(/[{[]/);
  if (firstObj >= 0) {
    const end = matchBracket(text, firstObj);
    const body = end >= 0 ? text.slice(firstObj, end + 1) : text.slice(firstObj);
    const trimmedOuter = firstObj > 0 || (end >= 0 && end < text.length - 1 && text.slice(end + 1).trim() !== '');
    out.push({ body, note: trimmedOuter ? 'JSON の前後にある説明文を外しました' : null });
  }
  return out;
}

// 戻り値: { ok: true, value, notes: string[] } / { ok: false, error: string }
export function extractJson(text) {
  if (typeof text !== 'string' || text.trim() === '') return { ok: false, error: '貼り付けた内容が空です' };
  const src = text.replace(/^﻿/, '');
  const cands = candidates(src);
  if (!cands.length) return { ok: false, error: 'JSON が見つかりません（{ または [ で始まる部分がありません）' };

  let firstError = null;
  for (const c of cands) {
    const notes = c.note ? [c.note] : [];
    let r = tryParse(c.body);
    if (!r.ok) {
      if (!firstError) firstError = { err: r.error, body: c.body };
      // 1回だけ修復して再挑戦: 全角の引用符 → 半角、末尾カンマの除去
      const fixed = stripTrailingCommas(c.body.replace(/[“”„‟″＂]/g, '"'));
      if (fixed !== c.body) {
        r = tryParse(fixed);
        if (r.ok) notes.push('全角の引用符や末尾のカンマを直して読みました');
      }
    }
    if (r.ok) {
      let value = r.value;
      if (Array.isArray(value)) {
        value = { type: 'ledger-patch', schemaVersion: SCHEMA_VERSION, ops: value };
        notes.push('配列だけの返答だったので、差分の ops とみなしました');
      }
      if (!value || typeof value !== 'object') continue;
      return { ok: true, value, notes };
    }
  }
  const where = firstError ? describeParseError(firstError.err, firstError.body) : '位置不明';
  return { ok: false, error: `JSON として読めません（${where}）。返答が途中で切れていないか確かめてください` };
}
