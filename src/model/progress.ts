// 進度：頁簽進度條、狀態列的檔案進度共用同一個算法，之後要改算法只改這裡
import { isDone } from './marks';
import type { Entry, FileDoc } from './types';

export interface Progress { done: number; total: number }

/** 條目是不可變更新：頁簽的條目陣列沒換就直接用上次算的 */
const cache = new WeakMap<Entry[], Progress>();

/** 一個頁簽的進度 */
export function sheetProgress(entries: Entry[]): Progress {
  let p = cache.get(entries);
  if (!p) {
    let done = 0;
    for (const e of entries) if (isDone(e)) done++;
    p = { done, total: entries.length };
    cache.set(entries, p);
  }
  return p;
}

/** 整個檔案（所有頁簽加起來）的進度 */
export function fileProgress(f: FileDoc | undefined): Progress {
  const out = { done: 0, total: 0 };
  f?.sheets.forEach((sh) => { const p = sheetProgress(sh.entries); out.done += p.done; out.total += p.total; });
  return out;
}

/** 進度百分比（四捨五入） */
export const percentOf = (p: Progress) => (p.total ? Math.round((p.done / p.total) * 100) : 0);
