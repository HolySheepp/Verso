// 進度：頁簽進度條、檔案選單、狀態列的檔案進度共用同一個算法，之後要改算法只改這裡
import { effectiveMark } from './marks';
import type { Entry, FileDoc, Mode } from './types';

export interface Progress {
  /** 已完成的條數 */
  done: number;
  /** 要算進度的條數（全部條目扣掉忽略的） */
  total: number;
}

/**
 * 這一條在這個模式下算不算完成；忽略的條目回傳 null（不算進進度）。只看條目上顯示的標記：
 * - 未翻譯（包含還沒確認、仍顯示未翻譯的）、疑慮、還沒確認的原文更新：不算完成
 * - 自訂標記：都算完成
 * - 驗證模式：只有已驗證算完成；其他模式：已翻譯、已驗證、待思考算完成
 */
export function isComplete(e: Entry, mode: Mode): boolean | null {
  const m = effectiveMark(e);
  if (m === 'ignore') return null;
  if (m.startsWith('c:')) return true;
  if (mode === 'verify') return m === 'verified';
  return m === 'translated' || m === 'verified' || m === 'think';
}

/** 條目是不可變更新：頁簽的條目陣列沒換就直接用上次算的（每種模式各記一份） */
const cache = new WeakMap<Entry[], Map<Mode, Progress>>();

/** 一個頁簽在這個模式下的進度 */
export function sheetProgress(entries: Entry[], mode: Mode): Progress {
  let byMode = cache.get(entries);
  if (!byMode) { byMode = new Map(); cache.set(entries, byMode); }
  let p = byMode.get(mode);
  if (!p) {
    let done = 0, total = 0;
    for (const e of entries) {
      const c = isComplete(e, mode);
      if (c === null) continue;
      total++;
      if (c) done++;
    }
    p = { done, total };
    byMode.set(mode, p);
  }
  return p;
}

/** 整個檔案（所有頁簽加起來）的進度 */
export function fileProgress(f: FileDoc | undefined, mode: Mode): Progress {
  const out = { done: 0, total: 0 };
  f?.sheets.forEach((sh) => { const p = sheetProgress(sh.entries, mode); out.done += p.done; out.total += p.total; });
  return out;
}

/**
 * 進度條的長度（%）：空的或整頁都忽略的算全滿；
 * 沒做完就不顯示滿格（例如 199 / 200 停在 99%，不四捨五入成 100%）
 */
export function percentOf(p: Progress): number {
  if (p.done >= p.total) return 100;
  return Math.min(99, Math.floor((p.done / p.total) * 100));
}

/** 頁簽打勾：每一條都達到翻譯模式的完成標準（空的或整頁都忽略的也打勾）；任何模式都照這個判斷 */
export const sheetDone = (entries: Entry[]) => { const p = sheetProgress(entries, 'translate'); return p.done >= p.total; };

/** 檔案打勾：所有頁簽都打勾 */
export const fileDone = (f: FileDoc) => f.sheets.every((sh) => sheetDone(sh.entries));
