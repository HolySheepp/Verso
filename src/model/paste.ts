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

/** 去掉結尾的空白行後的行數（整欄複製時結尾常會多出大量空白行） */
export function usedLength(rows: string[]): number {
  let n = rows.length;
  while (n > 0 && !rows[n - 1].trim()) n--;
  return n;
}

/**
 * 檢查一個頁簽：原文必填，已貼的各欄行數要一致。
 * 以原文的行數為準；其他欄結尾的空白行不算，但實際貼入的行數不能比原文少。
 */
export function checkColumns(c: Columns): { ok: boolean; msg: string } {
  const base = c.src ? usedLength(c.src) : 0;
  if (!base) return { ok: false, msg: '還沒貼原文' };
  const pasted = COLS.filter((col) => c[col.key]);
  const fits = pasted.every((col) => {
    const rows = c[col.key]!;
    return usedLength(rows) <= base && rows.length >= base;
  });
  if (!fits) {
    return { ok: false, msg: '各欄行數不一致：' + pasted.map((col) => `${col.label} ${usedLength(c[col.key]!)}`).join('、') };
  }
  return { ok: true, msg: '' };
}

/** 貼入的條目一律待確認；發話者空白記為「無」 */
export function columnsToEntries(c: Columns): Entry[] {
  const src = (c.src ?? []).slice(0, usedLength(c.src ?? []));
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
