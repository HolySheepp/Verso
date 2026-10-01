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
  /** 每一行對應的條目編號（只有管理專案編輯檔案時的譯文欄有） */
  ids?: (string | null)[];
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

// ---- 方框裡的整欄操作 ----
// 管理專案編輯檔案時，譯文欄的每一行帶著條目的編號（ids），條目的標記、備註等資料跟著譯文走；
// 下面這些操作都會讓 ids 跟 rows 保持對齊。

const withIds = (c: Col, rows: string[], ids: (string | null)[] | undefined): Col => ({ ...c, rows, ids: c.ids ? ids : undefined });

/** 清空幾行的內容，行數不變 */
export const clearRows = (c: Col, idx: number[]): Col => {
  const d = new Set(idx);
  return { ...c, rows: c.rows.map((r, i) => (d.has(i) ? '' : r)) };
};

/** 刪掉幾行，下面的往上補 */
export const deleteRows = (c: Col, idx: number[]): Col => {
  const d = new Set(idx);
  return withIds(c, c.rows.filter((_, i) => !d.has(i)), c.ids?.filter((_, i) => !d.has(i)));
};

/** 在第 at 行後面插入一行空白 */
export const insertRow = (c: Col, at: number): Col =>
  withIds(c, [...c.rows.slice(0, at + 1), '', ...c.rows.slice(at + 1)], c.ids && [...c.ids.slice(0, at + 1), null, ...c.ids.slice(at + 1)]);

/** 改一行的內容 */
export const setRow = (c: Col, i: number, text: string): Col => ({ ...c, rows: c.rows.map((r, j) => (j === i ? text : r)) });

/** 從第 start 行開始往下覆蓋，不夠的行數補上 */
export function overwriteRows(c: Col | null, start: number, values: string[]): Col {
  const rows = [...(c?.rows ?? [])];
  const ids = c?.ids ? [...c.ids] : undefined;
  while (rows.length < start) { rows.push(''); ids?.push(null); }
  values.forEach((v, j) => {
    if (start + j >= rows.length) ids?.push(null);
    rows[start + j] = v;
  });
  return { rows, extra: 0, ids };
}

/** 整欄換掉；原本帶著條目編號的話，照行的位置保留 */
export function replaceCol(prev: Col | null, values: string[]): Col {
  const c = toCol(values);
  return prev?.ids ? { ...c, ids: c.rows.map((_, i) => prev.ids![i] ?? null) } : c;
}

/** 貼上多欄：從貼上的那一欄開始往右填。start 有值時從那一行往下覆蓋，沒有時整欄換掉 */
export function pasteColumns<K extends string>(keys: K[], from: K, values: string[][], current: Partial<Record<K, Col | null>>, start?: number): Partial<Record<K, Col>> {
  const out: Partial<Record<K, Col>> = {};
  const s = keys.indexOf(from);
  values.forEach((v, j) => {
    const k = keys[s + j];
    if (!k) return;
    out[k] = start === undefined ? replaceCol(current[k] ?? null, v) : overwriteRows(current[k] ?? null, start, v);
  });
  return out;
}
