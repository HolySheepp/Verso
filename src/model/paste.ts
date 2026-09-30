// 手動貼入：把貼上的整欄資料轉成條目
import type { Entry } from './types';

export type ColKey = 'id' | 'speaker' | 'src' | 'tgt';

export const COLS: { key: ColKey; label: string }[] = [
  { key: 'id', label: 'id' },
  { key: 'speaker', label: '發話者' },
  { key: 'src', label: '原文' },
  { key: 'tgt', label: '譯文' },
];

/**
 * 貼入的一欄。結尾的空白行（整欄複製時常會多出一大堆）不放進 rows，只記下有幾行。
 */
export interface Col {
  rows: string[];
  /** 貼入時結尾被略過的空白行數 */
  extra: number;
}

/** 沒貼的欄是 null */
export type Columns = Record<ColKey, Col | null>;

export const emptyColumns = (): Columns => ({ id: null, speaker: null, src: null, tgt: null });

let seq = 0;
export const newUid = () => 'e' + Date.now().toString(36) + (seq++).toString(36);

/** 去掉結尾的空白行後的行數 */
export function usedLength(rows: string[]): number {
  let n = rows.length;
  while (n > 0 && !rows[n - 1].trim()) n--;
  return n;
}

/** 剛貼上的一欄：去掉結尾的空白行 */
export function toCol(values: string[]): Col {
  const n = usedLength(values);
  return { rows: values.slice(0, n), extra: values.length - n };
}

/**
 * 一次貼上多欄時，從貼上的那一欄開始往右填（依 keys 的順序），超出的欄忽略。
 * 回傳要覆蓋的欄。
 */
export function spreadColumns<K extends string>(keys: K[], from: K, values: string[][]): Partial<Record<K, Col>> {
  const out: Partial<Record<K, Col>> = {};
  const start = keys.indexOf(from);
  values.forEach((v, j) => {
    const k = keys[start + j];
    if (k) out[k] = toCol(v);
  });
  return out;
}

/**
 * 某欄能不能對上 base 行：實際的行數不能多於 base，
 * 也不能比 base 少（結尾略過的空白行可以補上）。
 */
export const fitsRows = (c: Col, base: number) => c.rows.length <= base && c.rows.length + c.extra >= base;

/** 檢查一個頁簽：原文必填，以原文的行數為準，已貼的各欄行數要一致 */
export function checkColumns(c: Columns): { ok: boolean; msg: string } {
  const base = c.src?.rows.length ?? 0;
  if (!base) return { ok: false, msg: '還沒貼原文' };
  const pasted = COLS.filter((col) => c[col.key]);
  if (!pasted.every((col) => fitsRows(c[col.key]!, base))) {
    return { ok: false, msg: '各欄行數不一致：' + pasted.map((col) => `${col.label} ${c[col.key]!.rows.length}`).join('、') };
  }
  return { ok: true, msg: '' };
}

/** 貼入的條目一律待確認；發話者空白記為「無」 */
export function columnsToEntries(c: Columns): Entry[] {
  const src = c.src?.rows ?? [];
  return src.map((s, i) => {
    const tgt = c.tgt?.rows[i] ?? '';
    return {
      uid: newUid(),
      id: c.id?.rows[i] ?? '',
      speaker: (c.speaker?.rows[i] ?? '').trim() || '無',
      src: s, src0: s, tgt, tgt0: tgt,
      mark: '', pending: true, skipCheck: false, note: '', sugg: '',
    };
  });
}
