// 手動貼入：把貼上的整欄資料轉成條目
import type { Entry } from './types';

export type ColKey = 'id' | 'speaker' | 'src' | 'tgt';

export const COLS: { key: ColKey; label: string }[] = [
  { key: 'id', label: 'id' },
  { key: 'speaker', label: '發話者' },
  { key: 'src', label: '原文' },
  { key: 'tgt', label: '譯文' },
];

/** 沒貼的欄是 null */
export type Columns = Record<ColKey, string[] | null>;

export const emptyColumns = (): Columns => ({ id: null, speaker: null, src: null, tgt: null });

let seq = 0;
export const newUid = () => 'e' + Date.now().toString(36) + (seq++).toString(36);

/** 檢查一個頁簽：原文必填，已貼的各欄行數要一致 */
export function checkColumns(c: Columns): { ok: boolean; msg: string } {
  if (!c.src?.length) return { ok: false, msg: '還沒貼原文' };
  const pasted = COLS.filter((col) => c[col.key]);
  const counts = pasted.map((col) => c[col.key]!.length);
  if (counts.some((n) => n !== counts[0])) {
    return { ok: false, msg: '各欄行數不一致：' + pasted.map((col, i) => `${col.label} ${counts[i]}`).join('、') };
  }
  return { ok: true, msg: '' };
}

/** 貼入的條目一律待確認；發話者空白記為「無」 */
export function columnsToEntries(c: Columns): Entry[] {
  const src = c.src ?? [];
  return src.map((s, i) => {
    const tgt = c.tgt?.[i] ?? '';
    return {
      uid: newUid(),
      id: c.id?.[i] ?? '',
      speaker: (c.speaker?.[i] ?? '').trim() || '無',
      src: s, src0: s, tgt, tgt0: tgt,
      mark: '', pending: true, skipCheck: false, note: '', sugg: '',
    };
  });
}
