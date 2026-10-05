// 驗證模式的修改：記下譯文的哪一段（s～e）改成什麼（t）。
// 修改框的內容 = 譯文套上這些修改；底線、高亮、套用、忽略都靠這份記錄。
import type { Entry, StoredMark } from './types';

/** 一組修改：譯文 [s, e) 這一段改成 t（s === e 是插入，t 為空是刪除） */
export interface VEdit { s: number; e: number; t: string }

export interface VerifyData {
  /** 做這些修改時的譯文；譯文後來被改了，就用它重新對位置 */
  base: string;
  edits: VEdit[];
  /** 自動標上疑慮前的標記；undefined 代表不是自動標的 */
  prev?: StoredMark;
}

/** 一組修改在兩個框裡的位置 */
export interface VSpan { s: number; e: number; ms: number; me: number; t: string }

const commonPrefix = (a: string, b: string) => {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
};
const commonSuffix = (a: string, b: string, max: number) => {
  let i = 0;
  while (i < max && a.charCodeAt(a.length - 1 - i) === b.charCodeAt(b.length - 1 - i)) i++;
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
    const sp = { s: d.s, e: d.e, ms: d.s + shift, me: d.s + shift + d.t.length, t: d.t };
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
  if (!r) { r = rebase(v.base, e.tgt, v.edits); live.set(e, r); }
  return r;
}

/**
 * 在修改框把 oldMod 改成 newMod：改到（或碰到）已有修改的部分就併進那一組，否則是新的一組。
 * 回傳新的修改清單，以及這次改到的那一組在譯文的起點（找不到時是 -1，例如改回原樣）。
 */
export function applyChange(tgt: string, edits: VEdit[], oldMod: string, newMod: string, caret?: number): { edits: VEdit[]; active: number } {
  const { p, q } = diffRange(oldMod, newMod, caret);
  const a = p, b = oldMod.length - q;
  const spans = spansOf(edits);
  const hit = spans.filter((sp) => sp.ms <= b && sp.me >= a);
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
  const s = hit.length ? Math.min(...hit.map((h) => h.s), toTgt(A)) : toTgt(A);
  const e = hit.length ? Math.max(...hit.map((h) => h.e), toTgt(B)) : toTgt(B);
  const t = newMod.slice(A, B + newMod.length - oldMod.length);
  const rest = keep.map(({ s: ks, e: ke, t: kt }) => ({ s: ks, e: ke, t: kt }));
  if (t === tgt.slice(s, e)) return { edits: rest, active: -1 };
  return { edits: [...rest, { s, e, t }].sort((x, y) => x.s - y.s), active: s };
}

/** 套用一組修改：譯文那段換成修改後的內容，這組移除，後面的移位置 */
export function applyOne(tgt: string, edits: VEdit[], s: number): { tgt: string; edits: VEdit[] } {
  const d = edits.find((x) => x.s === s);
  if (!d) return { tgt, edits };
  const delta = d.t.length - (d.e - d.s);
  return {
    tgt: tgt.slice(0, d.s) + d.t + tgt.slice(d.e),
    edits: edits.filter((x) => x !== d).map((x) => (x.s >= d.e && x.s >= d.s ? { ...x, s: x.s + delta, e: x.e + delta } : x)),
  };
}

/** 移除一組修改（修改框那段回到原譯文） */
export const removeOne = (edits: VEdit[], s: number) => edits.filter((x) => x.s !== s);

/** 存進 xlsx 的文字 */
export function verifyToText(v: VerifyData | undefined): string {
  if (!v || !v.edits.length) return '';
  return JSON.stringify({ b: v.base, d: v.edits.map((d) => [d.s, d.e, d.t]), ...(v.prev !== undefined ? { m: v.prev } : {}) });
}

export function textToVerify(text: string): VerifyData | undefined {
  if (!text) return undefined;
  try {
    const o = JSON.parse(text) as { b?: unknown; d?: unknown; m?: unknown };
    if (typeof o.b !== 'string' || !Array.isArray(o.d)) return undefined;
    const edits = (o.d as unknown[]).flatMap((x): VEdit[] => {
      if (!Array.isArray(x) || typeof x[0] !== 'number' || typeof x[1] !== 'number' || typeof x[2] !== 'string') return [];
      const [s, e, t] = x as [number, number, string];
      return s >= 0 && e >= s && e <= (o.b as string).length ? [{ s, e, t }] : [];
    });
    if (!edits.length) return undefined;
    return { base: o.b, edits, ...(typeof o.m === 'string' ? { prev: o.m as StoredMark } : {}) };
  } catch { return undefined; }
}
