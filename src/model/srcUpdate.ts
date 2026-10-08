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
  const k = s.replace(/[^\p{L}\p{N}]+/gu, '');
  // 整句都是標點（例如「……」）：去掉標點會變成空的，改用原字串（只去掉空白）來比
  return k || (text || '').replace(/\s+/g, '');
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
/** 帶寬：條目很多時窄一點，算得快 */
const bandFor = (n: number) => (n > 5000 ? 48 : 96);
const REORDER = 0.85;
/** 對齊表格、交叉比對最多算這麼多格 */
const MAX_CELLS = 30_000_000;
/** 相似度低於這個就不硬配成一對，兩邊各自留空格 */
const MIN_PAIR = 0.3;

/** 字元出現次數（算相似度上限用） */
function charCounts(s: string): Map<number, number> {
  const m = new Map<number, number>();
  for (let k = 0; k < s.length; k++) { const c = s.charCodeAt(k); m.set(c, (m.get(c) ?? 0) + 1); }
  return m;
}

/** 相似度的上限（不跑最長共同子序列）：共同的字元最多就是各字元出現次數取小的加總 */
function ratioBound(a: string, b: string, ca: Map<number, number>, cb: Map<number, number>, floor: number): number {
  if (!a.length && !b.length) return 1;
  // 長度差太多：一定不像
  const lenBound = (2 * Math.min(a.length, b.length)) / (a.length + b.length);
  if (lenBound < floor) return lenBound;
  const [small, big] = ca.size <= cb.size ? [ca, cb] : [cb, ca];
  let common = 0;
  small.forEach((n, c) => { common += Math.min(n, big.get(c) ?? 0); });
  return (2 * common) / (a.length + b.length);
}

/** 一群比對用字串（已經是 matchKey），附上字元統計，算相似度時先用上限排除 */
class Keys {
  private counts: (Map<number, number> | undefined)[] = [];
  constructor(readonly keys: string[]) {}
  countsOf(i: number) { return (this.counts[i] ??= charCounts(this.keys[i])); }
}

/** 相似度；確定低於 floor 時直接回傳 0（不跑最長共同子序列）。比對用字串相同的直接是 1 */
function simAbove(a: Keys, i: number, b: Keys, j: number, floor: number): number {
  const x = a.keys[i], y = b.keys[j];
  if (x === y) return 1;
  if (ratioBound(x, y, a.countsOf(i), b.countsOf(j), floor) < floor) return 0;
  return ratio(x, y);
}

/**
 * 照順序的全域對齊（Needleman-Wunsch，帶寬限制）。a、b 是舊、新的索引，回傳配對（缺口是 null）。
 * dp 只配置帶寬內的格子；不夠像的不配成一對。
 */
function globalAlign(A: Keys, a: number[], B: Keys, b: number[]): [number | null, number | null][] {
  const n = a.length, m = b.length;
  if (!n || !m) return [...a.map((i): [number, null] => [i, null]), ...b.map((j): [null, number] => [null, j])];
  // 帶寬：兩邊長度差太多時放寬，確保走得到終點
  const band = Math.max(bandFor(Math.max(n, m)), Math.abs(n - m) + 8);
  const W = 2 * band + 1;
  // 兩邊條數差太多又找不到錨點：表格會大到記憶體放不下，全部留空格讓使用者自己拖
  if ((n + 1) * W > MAX_CELLS) return [...a.map((i): [number, null] => [i, null]), ...b.map((j): [null, number] => [null, j])];
  const at = (i: number, j: number) => i * W + (j - i + band);
  const ok = (i: number, j: number) => Math.abs(j - i) <= band;
  const dp = new Float32Array((n + 1) * W).fill(-Infinity);
  const back = new Uint8Array((n + 1) * W); // 1 斜、2 上（舊有新沒有）、3 左（新有舊沒有）
  dp[at(0, 0)] = 0;
  for (let i = 0; i <= n; i++) {
    const jLo = Math.max(0, i - band), jHi = Math.min(m, i + band);
    for (let j = jLo; j <= jHi; j++) {
      if (i === 0 && j === 0) continue;
      let best = -Infinity, from = 0;
      if (i > 0 && j > 0 && dp[at(i - 1, j - 1)] > -Infinity) {
        const sc = simAbove(A, a[i - 1], B, b[j - 1], MIN_PAIR);
        if (sc >= MIN_PAIR) {
          const c = dp[at(i - 1, j - 1)] + sc - MATCH_OFFSET;
          if (c > best) { best = c; from = 1; }
        }
      }
      if (i > 0 && ok(i - 1, j) && dp[at(i - 1, j)] - GAP > best) { best = dp[at(i - 1, j)] - GAP; from = 2; }
      if (j > 0 && ok(i, j - 1) && dp[at(i, j - 1)] - GAP > best) { best = dp[at(i, j - 1)] - GAP; from = 3; }
      dp[at(i, j)] = best; back[at(i, j)] = from;
    }
  }
  const out: [number | null, number | null][] = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const f = back[at(i, j)];
    if (f === 1) { out.push([a[i - 1], b[j - 1]]); i--; j--; }
    else if (f === 2) { out.push([a[i - 1], null]); i--; }
    else { out.push([null, b[j - 1]]); j--; }
  }
  return out.reverse();
}

/** 最長遞增子序列：回傳留下來的索引 */
function lis(vals: number[]): number[] {
  const tails: number[] = [], prev = new Int32Array(vals.length).fill(-1);
  for (let k = 0; k < vals.length; k++) {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (vals[tails[mid]] < vals[k]) lo = mid + 1; else hi = mid; }
    if (lo > 0) prev[k] = tails[lo - 1];
    tails[lo] = k;
  }
  const out: number[] = [];
  for (let k = tails.length ? tails[tails.length - 1] : -1; k >= 0; k = prev[k]) out.push(k);
  return out.reverse();
}

/**
 * 先用錨點切段再對齊：兩邊都只出現一次、完全相同的句子直接配對；其中順序一致的（最長遞增子序列）當錨點，
 * 錨點之間的每一段再做全域對齊。順序不一致的那些就是被搬動的句子，一樣直接配對。
 */
function alignByAnchors(A: Keys, a: number[], B: Keys, b: number[]): [number | null, number | null][] {
  const count = (K: Keys, xs: number[]) => { const m = new Map<string, number>(); xs.forEach((x) => { const k = K.keys[x]; if (k) m.set(k, (m.get(k) ?? 0) + 1); }); return m; };
  const ca = count(A, a), cb = count(B, b);
  const posB = new Map<string, number>();
  b.forEach((j, q) => { const k = B.keys[j]; if (k && cb.get(k) === 1) posB.set(k, q); });
  // [在 a 的位置, 在 b 的位置]，照 a 的順序
  const uniq: [number, number][] = [];
  a.forEach((i, p) => { const k = A.keys[i]; const q = k && ca.get(k) === 1 ? posB.get(k) : undefined; if (q !== undefined) uniq.push([p, q]); });
  const anchors = lis(uniq.map((u) => u[1])).map((k) => uniq[k]);
  const pairedA = new Set(uniq.map((u) => u[0])), pairedB = new Set(uniq.map((u) => u[1]));
  const out: [number | null, number | null][] = uniq.map(([p, q]) => [a[p], b[q]]);
  let pa = 0, pb = 0;
  for (const [p, q] of [...anchors, [a.length, b.length] as [number, number]]) {
    const segA: number[] = [], segB: number[] = [];
    for (let x = pa; x < p; x++) if (!pairedA.has(x)) segA.push(a[x]);
    for (let y = pb; y < q; y++) if (!pairedB.has(y)) segB.push(b[y]);
    out.push(...globalAlign(A, segA, B, segB));
    pa = p + 1; pb = q + 1;
  }
  return out;
}

/**
 * 自動比對：有 ID 的先讓 ID 相同的配成一對；其餘先用錨點切段、再照順序全域對齊；
 * 剩下兩邊都沒配到的再交叉比對，夠像的就是順序換過的條目。
 */
export function autoAlign(old: { id: string; src: string }[], next: NewRow[]): AlignRow[] {
  const A = new Keys(old.map((o) => matchKey(o.src))), B = new Keys(next.map((r) => matchKey(r.src)));
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
  // ID 配好、內容卻幾乎不一樣（低於 0.3），而別處有很像的句子（0.85 以上）：ID 可能貼錯了，不信 ID，改用內容對齊
  if (pairOf.size) {
    for (const [i, j] of [...pairOf]) {
      if (j === null || simAbove(A, i, B, j, 0.3) >= 0.3) continue;
      let elsewhere = false;
      for (let jj = 0; jj < next.length && !elsewhere; jj++) elsewhere = jj !== j && simAbove(A, i, B, jj, REORDER) >= REORDER;
      for (let ii = 0; ii < old.length && !elsewhere; ii++) elsewhere = ii !== i && simAbove(A, ii, B, j, REORDER) >= REORDER;
      if (elsewhere) { pairOf.delete(i); newUsed.delete(j); }
    }
  }
  // 2. 其餘先用錨點切段，再照順序全域對齊
  const restOld = old.map((_, i) => i).filter((i) => !pairOf.has(i));
  const restNew = next.map((_, j) => j).filter((j) => !newUsed.has(j));
  const freeOld: number[] = [], freeNew: number[] = [];
  for (const [a, b] of alignByAnchors(A, restOld, B, restNew)) {
    if (a !== null && b !== null) { pairOf.set(a, b); newUsed.add(b); }
    else if (a !== null) freeOld.push(a);
    else if (b !== null) freeNew.push(b);
  }
  // 3. 剩下的交叉比對，抓順序換過的
  const cands: [number, number, number][] = [];
  if (freeOld.length * freeNew.length <= MAX_CELLS) for (const i of freeOld) for (const j of freeNew) {
    const sc = simAbove(A, i, B, j, REORDER);
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
  const removed = new Map<number, AlignRow>();
  rows.forEach((r) => { if (r.new === null && r.old !== null) removed.set(r.old, r); });
  const posOfOld = new Map<number, number>();
  withNew.forEach((r, k) => { if (r.old !== null) posOfOld.set(r.old, k); });
  // 照舊的順序走一遍：新版沒有的，接在前一條（舊順序）新版還有的條目後面
  const after = new Map<number, AlignRow[]>();
  let cur = -1;
  const maxOld = rows.reduce((m, r) => (r.old !== null && r.old > m ? r.old : m), -1);
  for (let i = 0; i <= maxOld; i++) {
    const p = posOfOld.get(i);
    if (p !== undefined) { cur = p; continue; }
    const r = removed.get(i);
    if (r) { const list = after.get(cur); if (list) list.push(r); else after.set(cur, [r]); }
  }
  const out: AlignRow[] = [...(after.get(-1) ?? [])];
  withNew.forEach((r, k) => { out.push(r); const list = after.get(k); if (list) out.push(...list); });
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

/** findElsewhere：要不要找「高相似：第幾條」（照順序對應、還在比對時不找，太花時間） */
export function rowInfos(oldSrc: string[], newSrc: string[], rows: AlignRow[], findElsewhere = true): RowInfo[] {
  const ko = oldSrc.map(matchKey), kn = newSrc.map(matchKey);
  const A = new Keys(ko), B = new Keys(kn);
  const rowOfOld = new Map<number, number>();
  rows.forEach((r, k) => { if (r.old !== null) rowOfOld.set(r.old, k); });
  return rows.map((r, k) => {
    const o = r.old === null ? null : oldSrc[r.old];
    const n = r.new === null ? null : newSrc[r.new];
    const arrow = arrowOf(o, n);
    const sim = r.old !== null && r.new !== null ? ratio(ko[r.old], kn[r.new]) : null;
    let elsewhere: number | null = null;
    if (findElsewhere && arrow === 'red' && r.new !== null) {
      // 拿這列的新原文，去其他列的舊原文找最像的（先用上限排除一定不夠像的）
      let best = ELSEWHERE;
      for (let i = 0; i < ko.length; i++) {
        const rk = rowOfOld.get(i);
        if (rk === undefined || rk === k) continue;
        const v = simAbove(A, i, B, r.new, best);
        if (v >= best) { best = v; elsewhere = rk + 1; }
      }
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
