// 驗證模式的修改：記下譯文的哪一段（s～e）改成什麼（t）。
// 修改框的內容 = 譯文套上這些修改；底線、高亮、套用、忽略都靠這份記錄。
import type { Entry, StoredMark } from './types';

/**
 * 一組修改：譯文 [s, e) 這一段改成 t（s === e 是插入，t 為空是刪除）。
 * id 是這組修改自己的編號：套用、忽略、高亮都用它認，不靠位置（位置會因為別組套用而改變）。
 */
export interface VEdit { s: number; e: number; t: string; id?: string }

let editSeq = 0;
export const newEditId = () => 'v' + Date.now().toString(36) + (editSeq++).toString(36);
/** 沒有編號的修改補上編號（讀檔、舊資料） */
export const withIds = (edits: VEdit[]): VEdit[] => (edits.every((d) => d.id) ? edits : edits.map((d) => (d.id ? d : { ...d, id: newEditId() })));

export interface VerifyData {
  /** 做這些修改時的譯文；譯文後來被改了，就用它重新對位置 */
  base: string;
  edits: VEdit[];
  /** 自動標上疑慮前的標記；undefined 代表不是自動標的 */
  prev?: StoredMark;
  /** 自動標上疑慮前，暫存的「認不得的自訂標記」，還原時一起放回去 */
  prevKept?: string;
}

/** 一組修改在兩個框裡的位置 */
export interface VSpan { s: number; e: number; ms: number; me: number; t: string; id: string }

const commonPrefix = (a: string, b: string) => {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  // 停在代理對（例如 emoji）的中間：往前退一格，整個字算在改動裡
  if (i > 0 && i < a.length && isHigh(a.charCodeAt(i - 1)) && isLow(a.charCodeAt(i))) i--;
  return i;
};
const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;
const commonSuffix = (a: string, b: string, max: number) => {
  let i = 0;
  while (i < max && a.charCodeAt(a.length - 1 - i) === b.charCodeAt(b.length - 1 - i)) i++;
  if (i > 0 && i < a.length && isLow(a.charCodeAt(a.length - i)) && isHigh(a.charCodeAt(a.length - i - 1))) i--;
  return i;
};

/**
 * 找出 before 改成 after 時改了哪一段：before 的 [p, before.length - q) 換成 after 的 [p, after.length - q)。
 * caret 是改完後游標的位置，用來決定重複字元時改的是哪一個。
 */
export function diffRange(before: string, after: string, caret?: number) {
  let q = commonSuffix(before, after, Math.min(before.length, after.length));
  if (caret !== undefined) q = Math.min(q, Math.max(0, after.length - caret));
  const p = Math.min(commonPrefix(before, after), before.length - q, after.length - q);
  return { p, q };
}

/** 依位置排序，算出每組修改在修改框的位置 */
export function spansOf(edits: VEdit[]): VSpan[] {
  let shift = 0;
  return [...edits].sort((a, b) => a.s - b.s).map((d) => {
    const sp = { s: d.s, e: d.e, ms: d.s + shift, me: d.s + shift + d.t.length, t: d.t, id: d.id ?? '' };
    shift += d.t.length - (d.e - d.s);
    return sp;
  });
}

/** 修改框的內容 */
export function compose(tgt: string, edits: VEdit[]): string {
  let out = '', at = 0;
  for (const d of [...edits].sort((a, b) => a.s - b.s)) {
    out += tgt.slice(at, d.s) + d.t;
    at = d.e;
  }
  return out + tgt.slice(at);
}

/** 譯文從 base 被改成 tgt：改到的那幾組修改移除，後面的跟著移位置 */
export function rebase(base: string, tgt: string, edits: VEdit[]): VEdit[] {
  if (base === tgt) return edits;
  const { p, q } = diffRange(base, tgt);
  const oe = base.length - q, delta = tgt.length - base.length;
  const out: VEdit[] = [];
  for (const d of edits) {
    if (d.e <= p && !(d.s === d.e && d.s === p && oe > p)) out.push(d);
    else if (d.s >= oe && !(d.s === d.e && d.s === oe && oe > p)) out.push({ ...d, s: d.s + delta, e: d.e + delta });
    // 其他的跟改動重疊：算處理過了，移除
  }
  return out;
}

const live = new WeakMap<Entry, VEdit[]>();
/** 這一條目前有效的修改（譯文被改過時重新對位置） */
export function editsOf(e: Entry): VEdit[] {
  const v = e.ver;
  if (!v) return [];
  let r = live.get(e);
  if (!r) { r = withIds(rebase(v.base, e.tgt, v.edits)); live.set(e, r); }
  return r;
}

/**
 * 在修改框把 oldMod 改成 newMod：改到（或碰到）已有修改的部分就併進那一組，否則是新的一組。
 * 回傳新的修改清單，以及這次改到的那一組的編號（找不到時是空字串，例如改回原樣）。
 */
export function applyChange(tgt: string, edits: VEdit[], oldMod: string, newMod: string, caret?: number): { edits: VEdit[]; active: string } {
  const { p, q } = diffRange(oldMod, newMod, caret);
  const a = p, b = oldMod.length - q;
  const spans = spansOf(withIds(edits));
  const hit = spans.filter((sp) => sp.ms <= b && sp.me >= a);
  // 併進已有的組時沿用那組的編號，新的一組給新編號
  let id = hit[0]?.id || newEditId();
  const keep = spans.filter((sp) => !hit.includes(sp));
  const A = Math.min(a, ...hit.map((h) => h.ms));
  const B = Math.max(b, ...hit.map((h) => h.me));
  // 修改框位置換成譯文位置（只用在不在任何一組裡面的位置）
  const toTgt = (x: number) => {
    let shift = 0;
    for (const sp of spans) if (sp.me <= x && !hit.includes(sp)) shift += sp.t.length - (sp.e - sp.s);
    for (const sp of hit) if (sp.me <= x) shift += sp.t.length - (sp.e - sp.s);
    return x - shift;
  };
  let s = hit.length ? Math.min(...hit.map((h) => h.s), toTgt(A)) : toTgt(A);
  let e = hit.length ? Math.max(...hit.map((h) => h.e), toTgt(B)) : toTgt(B);
  let t = newMod.slice(A, B + newMod.length - oldMod.length);
  let rest: VEdit[] = keep.map(({ s: ks, e: ke, t: kt, id: kid }) => ({ s: ks, e: ke, t: kt, id: kid }));
  // 以單詞為單位：改到一個詞的一部分，就算整個詞都改了（例如 stupid → steward 整個詞畫底線）
  const w = toWords(tgt, s, e, t);
  s = w.s; e = w.e; t = w.t;
  // 擴大後碰到別組就合併
  for (;;) {
    // 重疊的，或插入點落在範圍裡（包含正好在起點、終點）的，都併成一組
    const touch = rest.filter((x) => (x.s < e && x.e > s) || (x.s === x.e && x.s >= s && x.s <= e) || (s === e && x.s <= s && x.e >= e));
    if (!touch.length) break;
    if (!hit.length) id = touch[0].id || id;
    const S = Math.min(s, ...touch.map((x) => x.s)), E = Math.max(e, ...touch.map((x) => x.e));
    t = compose(tgt.slice(S, E), [...touch, { s, e, t }].map((x) => ({ s: x.s - S, e: x.e - S, t: x.t })));
    s = S; e = E;
    rest = rest.filter((x) => !touch.includes(x));
  }
  if (t === tgt.slice(s, e)) return { edits: rest, active: '' };
  return { edits: [...rest, { s, e, t, id }].sort((x, y) => x.s - y.s), active: id };
}

// 會被併成一個詞的字：英文字母、數字之類（中日韓文字一個字就是一個詞，不往外擴）
const WORD_CH = /[\p{L}\p{N}_'’-]/u;
const NO_SPREAD = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const isWord = (c: string | undefined) => !!c && WORD_CH.test(c) && !NO_SPREAD.test(c);

/** 修改的邊界落在詞的中間時，往外擴到整個詞 */
function toWords(tgt: string, s: number, e: number, t: string): { s: number; e: number; t: string } {
  // 左邊：譯文那段或新內容的第一個字是詞的一部分，而且前一個字也是
  while (s > 0 && isWord(tgt[s - 1]) && (isWord(s < e ? tgt[s] : undefined) || isWord(t[0]))) {
    t = tgt[s - 1] + t; s--;
  }
  while (e < tgt.length && isWord(tgt[e]) && (isWord(s < e ? tgt[e - 1] : undefined) || isWord(t[t.length - 1]))) {
    t = t + tgt[e]; e++;
  }
  return { s, e, t };
}

/** 套用一組修改：譯文那段換成修改後的內容，這組移除，後面的移位置 */
export function applyOne(tgt: string, edits: VEdit[], id: string): { tgt: string; edits: VEdit[] } {
  const d = edits.find((x) => x.id === id);
  if (!d) return { tgt, edits };
  const delta = d.t.length - (d.e - d.s);
  return {
    tgt: tgt.slice(0, d.s) + d.t + tgt.slice(d.e),
    edits: edits.filter((x) => x !== d).map((x) => (x.s >= d.e && x.s >= d.s ? { ...x, s: x.s + delta, e: x.e + delta } : x)),
  };
}

/** 移除一組修改（修改框那段回到原譯文） */
export const removeOne = (edits: VEdit[], id: string) => edits.filter((x) => x.id !== id);

/** 存進 xlsx 的文字 */
export function verifyToText(v: VerifyData | undefined): string {
  // 修改清空了但還記著自動疑慮前的標記：也要存，之後才還原得回去
  if (!v || (!v.edits.length && v.prev === undefined)) return '';
  return JSON.stringify({
    b: v.base, d: v.edits.map((d) => [d.s, d.e, d.t]),
    ...(v.prev !== undefined ? { m: v.prev } : {}), ...(v.prevKept ? { k: v.prevKept } : {}),
  });
}

/** 存得進檔案的標記（自動疑慮前的標記只接受這些） */
const VALID_MARK = /^(|verified|doubt|think|ignore|c:.+)$/;

export function textToVerify(text: string): VerifyData | undefined {
  if (!text) return undefined;
  try {
    const o = JSON.parse(text) as { b?: unknown; d?: unknown; m?: unknown; k?: unknown };
    if (typeof o.b !== 'string' || !Array.isArray(o.d)) return undefined;
    const base = o.b;
    // 位置要是整數、在範圍內；排好順序，跟前一組重疊的丟掉
    const raw = (o.d as unknown[]).flatMap((x): VEdit[] => {
      if (!Array.isArray(x) || !Number.isInteger(x[0]) || !Number.isInteger(x[1]) || typeof x[2] !== 'string') return [];
      const [s, e, t] = x as [number, number, string];
      return s >= 0 && e >= s && e <= base.length ? [{ s, e, t, id: newEditId() }] : [];
    }).sort((a, b) => a.s - b.s || a.e - b.e);
    const edits: VEdit[] = [];
    for (const d of raw) {
      const last = edits[edits.length - 1];
      if (last && (d.s < last.e || (d.s === last.s && d.s === d.e))) continue;
      edits.push(d);
    }
    const prev = typeof o.m === 'string' && VALID_MARK.test(o.m) ? (o.m as StoredMark) : undefined;
    if (!edits.length && prev === undefined) return undefined;
    return { base, edits, ...(prev !== undefined ? { prev } : {}), ...(typeof o.k === 'string' && o.k ? { prevKept: o.k } : {}) };
  } catch { return undefined; }
}
