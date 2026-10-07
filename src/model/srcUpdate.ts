// 原文更新合併（實驗性功能）：把新版原文對到頁簽裡的舊條目，再套用回去。
// 比對方法參考 LQA 的 align.py、normalize.py：先配 ID，其餘用相似度做照順序的全域對齊，
// 最後把兩邊剩下沒配到的交叉比對，抓出順序換過的條目。
import { newUid } from './paste';
import type { Entry } from './types';

/** 貼進來的新版一列 */
export interface NewRow { id: string; speaker: string; src: string }

/** 對齊視窗的一列：左邊舊條目、右邊新版，任一邊可以是空格 */
export interface AlignRow { old: number | null; new: number | null }

// ---- 正規化與相似度 ----

const RICH_TAG = /<[^<>]{1,40}>|\[\/?(?:color|b|i|u|size)[^\]]{0,40}\]/gi;
const PLACEHOLDER = /\{[^{}]{0,40}\}|%(?:\d+\$)?[sd]/g;
const CHAR_MAP: Record<string, string> = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'", '“': '"', '”': '"', '„': '"', '‟': '"', '′': "'", '″': '"',
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '―': '-', '−': '-',
  ' ': ' ', ' ': ' ', ' ': ' ', '　': ' ', '​': '', '‌': '', '‍': '', '﻿': '', '…': '...',
};

/** 比對用：去掉富文本標籤、統一引號破折號、小寫、去掉標點和空白 */
export function matchKey(text: string): string {
  let s = (text || '').replace(RICH_TAG, '').normalize('NFC');
  s = Array.from(s, (ch) => CHAR_MAP[ch] ?? ch).join('');
  s = s.toLowerCase().replace(PLACEHOLDER, ' ');
  return s.replace(/[^\p{L}\p{N}]+/gu, '');
}

/** 兩段文字的相似度 0～1（2 × 最長共同子序列 ÷ 兩邊長度和） */
export function ratio(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;
  const n = a.length, m = b.length;
  let prev = new Uint16Array(m + 1), row = new Uint16Array(m + 1);
  for (let i = 1; i <= n; i++) {
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      row[j] = ca === b.charCodeAt(j - 1) ? prev[j - 1] + 1 : Math.max(prev[j], row[j - 1]);
    }
    [prev, row] = [row, prev];
  }
  return (2 * prev[m]) / (n + m);
}

export const similarity = (a: string, b: string) => ratio(matchKey(a), matchKey(b));

/** 箭頭顏色：完全相同（只忽略前後空白）沒有箭頭；50% 以上黃色；其他紅色 */
export type Arrow = 'same' | 'yellow' | 'red';
export function arrowOf(oldSrc: string | null, newSrc: string | null): Arrow {
  if (oldSrc === null || newSrc === null) return 'red';
  if (oldSrc.trim() === newSrc.trim()) return 'same';
  return similarity(oldSrc, newSrc) >= 0.5 ? 'yellow' : 'red';
}

// ---- 對齊 ----

const MATCH_OFFSET = 0.5;
const GAP = 0.3;
const BAND = 96;
const REORDER = 0.85;

/** 照順序的全域對齊（Needleman-Wunsch，帶寬限制）。回傳 [舊索引, 新索引] 的配對，缺口是 null */
function globalAlign(a: string[], b: string[]): [number | null, number | null][] {
  const n = a.length, m = b.length;
  const ka = a.map(matchKey), kb = b.map(matchKey);
  const cache = new Map<number, number>();
  const sim = (i: number, j: number) => {
    const k = i * (m + 1) + j;
    let v = cache.get(k);
    if (v === undefined) { v = ratio(ka[i], kb[j]); cache.set(k, v); }
    return v;
  };
  // 帶寬：兩邊長度差太多時放寬，確保走得到終點
  const band = Math.max(BAND, Math.abs(n - m) + 8);
  const W = m + 1;
  const dp = new Float32Array((n + 1) * W).fill(-Infinity);
  const back = new Uint8Array((n + 1) * W); // 1 斜、2 上（舊有新沒有）、3 左（新有舊沒有）
  dp[0] = 0;
  for (let i = 0; i <= n; i++) {
    const jLo = Math.max(0, i - band), jHi = Math.min(m, i + band);
    for (let j = jLo; j <= jHi; j++) {
      if (i === 0 && j === 0) continue;
      let best = -Infinity, from = 0;
      if (i > 0 && j > 0 && dp[(i - 1) * W + j - 1] > -Infinity) {
        const c = dp[(i - 1) * W + j - 1] + sim(i - 1, j - 1) - MATCH_OFFSET;
        if (c > best) { best = c; from = 1; }
      }
      if (i > 0 && dp[(i - 1) * W + j] > -Infinity && dp[(i - 1) * W + j] - GAP > best) { best = dp[(i - 1) * W + j] - GAP; from = 2; }
      if (j > 0 && dp[i * W + j - 1] > -Infinity && dp[i * W + j - 1] - GAP > best) { best = dp[i * W + j - 1] - GAP; from = 3; }
      dp[i * W + j] = best; back[i * W + j] = from;
    }
  }
  const out: [number | null, number | null][] = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const f = back[i * W + j];
    if (f === 1) { out.push([i - 1, j - 1]); i--; j--; }
    else if (f === 2) { out.push([i - 1, null]); i--; }
    else { out.push([null, j - 1]); j--; }
  }
  return out.reverse();
}

/**
 * 自動比對：有 ID 的先讓 ID 相同的配成一對；其餘照順序全域對齊；
 * 剩下兩邊都沒配到的再交叉比對，夠像的就是順序換過的條目。
 */
export function autoAlign(old: { id: string; src: string }[], next: NewRow[]): AlignRow[] {
  const pairOf = new Map<number, number | null>(); // 舊 → 新
  const newUsed = new Set<number>();
  // 1. ID 相同（兩邊都只出現一次的 ID 才算）
  const count = (xs: string[]) => { const m = new Map<string, number>(); xs.forEach((x) => { if (x.trim()) m.set(x.trim(), (m.get(x.trim()) ?? 0) + 1); }); return m; };
  const co = count(old.map((o) => o.id)), cn = count(next.map((r) => r.id));
  const newById = new Map<string, number>();
  next.forEach((r, j) => { const k = r.id.trim(); if (k && cn.get(k) === 1) newById.set(k, j); });
  old.forEach((o, i) => {
    const k = o.id.trim();
    const j = k && co.get(k) === 1 ? newById.get(k) : undefined;
    if (j !== undefined) { pairOf.set(i, j); newUsed.add(j); }
  });
  // 2. 其餘照順序全域對齊
  const restOld = old.map((_, i) => i).filter((i) => !pairOf.has(i));
  const restNew = next.map((_, j) => j).filter((j) => !newUsed.has(j));
  const aligned = globalAlign(restOld.map((i) => old[i].src), restNew.map((j) => next[j].src));
  const freeOld: number[] = [], freeNew: number[] = [];
  for (const [a, b] of aligned) {
    if (a !== null && b !== null) { pairOf.set(restOld[a], restNew[b]); newUsed.add(restNew[b]); }
    else if (a !== null) freeOld.push(restOld[a]);
    else if (b !== null) freeNew.push(restNew[b]);
  }
  // 3. 剩下的交叉比對，抓順序換過的
  const cands: [number, number, number][] = [];
  for (const i of freeOld) for (const j of freeNew) {
    const sc = similarity(old[i].src, next[j].src);
    if (sc >= REORDER) cands.push([sc, i, j]);
  }
  cands.sort((x, y) => y[0] - x[0]);
  const uo = new Set<number>(), un = new Set<number>();
  for (const [, i, j] of cands) {
    if (uo.has(i) || un.has(j)) continue;
    uo.add(i); un.add(j); pairOf.set(i, j); newUsed.add(j);
  }
  const rows: AlignRow[] = [];
  old.forEach((_, i) => rows.push({ old: i, new: pairOf.get(i) ?? null }));
  next.forEach((_, j) => { if (!newUsed.has(j)) rows.push({ old: null, new: j }); });
  return orderRows(rows);
}

/** 照順序對應：舊的第 N 條對新的第 N 條 */
export function sequentialRows(nOld: number, nNew: number): AlignRow[] {
  return Array.from({ length: Math.max(nOld, nNew) }, (_, k) => ({ old: k < nOld ? k : null, new: k < nNew ? k : null }));
}

/**
 * 排列順序照新版；新版沒有的舊條目，放在它前一條舊條目的後面。
 */
export function orderRows(rows: AlignRow[]): AlignRow[] {
  const withNew = rows.filter((r) => r.new !== null).sort((a, b) => a.new! - b.new!);
  const removed = rows.filter((r) => r.new === null && r.old !== null).sort((a, b) => a.old! - b.old!);
  const out = [...withNew];
  for (const r of removed) {
    // 找前一條（舊順序）已經放好的位置
    let at = -1;
    for (let k = r.old! - 1; k >= 0 && at < 0; k--) at = out.findIndex((x) => x.old === k);
    out.splice(at + 1, 0, r);
  }
  return out;
}

// ---- 套用 ----

export interface Summary { same: number; changed: number; added: number; removed: number }

/** 這條原文要不要標「原文更新」：跟目前的原文比（只忽略前後空白） */
function srcChanged(e: Entry, src: string): boolean {
  return src.trim() !== e.src.trim();
}

export function summarize(entries: Entry[], next: NewRow[], rows: AlignRow[]): Summary {
  const s: Summary = { same: 0, changed: 0, added: 0, removed: 0 };
  for (const r of rows) {
    if (r.old === null && r.new === null) continue;
    if (r.old === null) s.added++;
    else if (r.new === null) s.removed++;
    else if (srcChanged(entries[r.old], next[r.new].src)) s.changed++;
    else s.same++;
  }
  return s;
}

/**
 * 套用：整個頁簽照新版的順序。
 * - 配上的：譯文、備註、標記等都保留，ID 和發話者換成新貼的（沒貼那欄就不動）；原文有改就先暫存新原文、標「原文更新」。
 * - 新版多的：插進來，標待確認。
 * - 新版沒有的：保留，標「原文更新」並顯示「新版已移除」。
 */
export function applyUpdate(entries: Entry[], next: NewRow[], rows: AlignRow[], has: { id: boolean; speaker: boolean }): Entry[] {
  const out: Entry[] = [];
  for (const r of rows) {
    if (r.old === null && r.new === null) continue;
    if (r.old === null) {
      const n = next[r.new!];
      out.push({ uid: newUid(), id: n.id, speaker: n.speaker.trim() || '無', src: n.src, src0: n.src, tgt: '', tgt0: '', mark: '', pending: true, skipCheck: false, note: '', sugg: '' });
      continue;
    }
    const e = entries[r.old];
    if (r.new === null) { out.push({ ...e, upd: { removed: true } }); continue; }
    const n = next[r.new];
    const base: Entry = { ...e, id: has.id ? n.id : e.id, speaker: has.speaker ? (n.speaker.trim() || '無') : e.speaker };
    if (srcChanged(e, n.src)) out.push({ ...base, upd: { src: n.src } });
    else { const { upd: _drop, ...rest } = base; void _drop; out.push(rest); }
  }
  return out;
}

// ---- 新舊原文的差異（原文框用） ----

const NO_SPREAD = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const WORDISH = /[\p{L}\p{N}_'’-]/u;

/** 切成詞：英文之類一個詞一段，中日韓一個字一段，其他字元各自一段 */
function tokens(s: string): { t: string; at: number }[] {
  const out: { t: string; at: number }[] = [];
  const chars = Array.from(s);
  let at = 0, k = 0;
  while (k < chars.length) {
    const c = chars[k];
    if (WORDISH.test(c) && !NO_SPREAD.test(c)) {
      let w = '', start = at;
      while (k < chars.length && WORDISH.test(chars[k]) && !NO_SPREAD.test(chars[k])) { w += chars[k]; at += chars[k].length; k++; }
      out.push({ t: w, at: start });
    } else { out.push({ t: c, at }); at += c.length; k++; }
  }
  return out;
}

/**
 * 新原文裡改過的地方（逐詞，中文逐字）：新增或改掉的詞畫底線；
 * 只刪掉的地方回傳長度 0 的範圍，畫成小標記。
 */
export function srcDiff(oldS: string, newS: string): { start: number; end: number }[] {
  const a = tokens(oldS), b = tokens(newS);
  const n = a.length, m = b.length;
  // 最長共同子序列（詞為單位）
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    L[i][j] = a[i].t === b[j].t ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  }
  const out: { start: number; end: number }[] = [];
  let i = 0, j = 0, pendingDel = false;
  const push = (start: number, end: number) => {
    const last = out[out.length - 1];
    if (last && last.end === start && end > start && last.end > last.start) last.end = end;
    else out.push({ start, end });
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i].t === b[j].t) {
      if (pendingDel) { push(b[j].at, b[j].at); pendingDel = false; }
      i++; j++;
    } else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) {
      push(b[j].at, b[j].at + b[j].t.length); pendingDel = false; j++;
    } else {
      // 刪掉的詞緊接在新增的詞後面就是「改掉」，不另外畫小標記
      const here = j < m ? b[j].at : newS.length;
      const last = out[out.length - 1];
      if (!(last && last.end === here && last.end > last.start)) pendingDel = true;
      i++;
    }
  }
  if (pendingDel) push(newS.length, newS.length);
  // 只是空白的改動不畫
  return out.filter((r) => r.start === r.end || newS.slice(r.start, r.end).trim() !== '');
}

// ---- 對齊視窗每一列的資訊 ----

/** 跟別處的句子這麼像，就提示可能是順序換了 */
const ELSEWHERE = 0.8;

export interface RowInfo {
  arrow: Arrow;
  /** 兩邊的相似度 0～1；有一邊是空格時是 null */
  sim: number | null;
  /** 這列的新原文跟這列不像，但跟別列的舊原文高度相似：那一列是第幾列（從 1 開始） */
  elsewhere: number | null;
}

export function rowInfos(oldSrc: string[], newSrc: string[], rows: AlignRow[]): RowInfo[] {
  const ko = oldSrc.map(matchKey), kn = newSrc.map(matchKey);
  const rowOfOld = new Map<number, number>();
  rows.forEach((r, k) => { if (r.old !== null) rowOfOld.set(r.old, k); });
  return rows.map((r, k) => {
    const o = r.old === null ? null : oldSrc[r.old];
    const n = r.new === null ? null : newSrc[r.new];
    const arrow = arrowOf(o, n);
    const sim = r.old !== null && r.new !== null ? ratio(ko[r.old], kn[r.new]) : null;
    let elsewhere: number | null = null;
    if (arrow === 'red' && r.new !== null) {
      // 拿這列的新原文，去其他列的舊原文找最像的
      let best = ELSEWHERE;
      ko.forEach((key, i) => { const rk = rowOfOld.get(i); if (rk === undefined || rk === k) return; const v = ratio(key, kn[r.new!]); if (v >= best) { best = v; elsewhere = rk + 1; } });
    }
    return { arrow, sim, elsewhere };
  });
}

// ---- 對齊視窗的手動調整（每次只動一邊） ----

export type Side = 'old' | 'new';
const other = (side: Side): Side => (side === 'old' ? 'new' : 'old');

/** 分開的兩欄重新組成列；只拿掉最後面兩邊都空的列（中間的保留，才不會讓兩邊錯位） */
function rebuild(side: Side, col: (number | null)[], rest: (number | null)[]): AlignRow[] {
  const n = Math.max(col.length, rest.length);
  const out: AlignRow[] = [];
  for (let k = 0; k < n; k++) {
    const a = col[k] ?? null, b = rest[k] ?? null;
    out.push(side === 'old' ? { old: a, new: b } : { old: b, new: a });
  }
  while (out.length && out[out.length - 1].old === null && out[out.length - 1].new === null) out.pop();
  return out;
}

/**
 * 把一邊第 a～b 列的格子拖到 drop（插在第 drop 列前面）：其他格子補上空出來的位置，總數不變，不會多出空格。
 */
export function moveCells(rows: AlignRow[], side: Side, a: number, b: number, drop: number): AlignRow[] {
  const col = rows.map((r) => r[side]);
  const rest = rows.map((r) => r[other(side)]);
  const cells = col.slice(a, b + 1);
  const left = [...col.slice(0, a), ...col.slice(b + 1)];
  const at = drop > b ? drop - cells.length : drop;
  const moved = [...left.slice(0, at), ...cells, ...left.slice(at)];
  return rebuild(side, moved, rest);
}

/** 在一邊的第 at 列插入空格，下面的往下推 */
export function insertBlank(rows: AlignRow[], side: Side, at: number): AlignRow[] {
  const col = rows.map((r) => r[side]);
  col.splice(at, 0, null);
  return rebuild(side, col, rows.map((r) => r[other(side)]));
}

/** 刪掉一邊第 at 列的空格，下面的往上補 */
export function deleteBlank(rows: AlignRow[], side: Side, at: number): AlignRow[] {
  if (rows[at]?.[side] !== null) return rows;
  const col = rows.map((r) => r[side]);
  col.splice(at, 1);
  return rebuild(side, col, rows.map((r) => r[other(side)]));
}
