import type { EntryHistory } from './types';

/** 每條最多幾段記錄 */
export const MAX_SLOTS = 3;
/** 全部最多保留幾條條目的記錄 */
export const MAX_ENTRIES = 3;

/**
 * 所有條目的譯文記錄。
 * `order` 依最早開始記錄的順序排列，超過 MAX_ENTRIES 時丟掉最舊那條的全部記錄。
 */
export interface HistoryStore {
  byEntry: Record<string, EntryHistory>;
  order: string[];
}

export const emptyHistory = (): HistoryStore => ({ byEntry: {}, order: [] });

/** 記錄一段譯文。和上一段相同就不重複存，只把目前槽位指回最後一段。 */
export function recordText(h: HistoryStore, entryId: string, text: string): HistoryStore {
  if (!text) return h;
  let order = h.order;
  const byEntry = { ...h.byEntry };
  if (!order.includes(entryId)) {
    order = [...order];
    if (order.length >= MAX_ENTRIES) {
      const oldest = order.shift()!;
      delete byEntry[oldest];
    }
    order.push(entryId);
  }
  const prev = byEntry[entryId]?.texts ?? [];
  if (prev.length && prev[prev.length - 1] === text) {
    byEntry[entryId] = { texts: prev, slot: prev.length - 1 };
    return { byEntry, order };
  }
  const texts = [...prev, text].slice(-MAX_SLOTS);
  byEntry[entryId] = { texts, slot: texts.length - 1 };
  return { byEntry, order };
}

export function selectSlot(h: HistoryStore, entryId: string, slot: number): HistoryStore {
  const cur = h.byEntry[entryId];
  if (!cur || slot < 0 || slot >= cur.texts.length) return h;
  return { ...h, byEntry: { ...h.byEntry, [entryId]: { ...cur, slot } } };
}
