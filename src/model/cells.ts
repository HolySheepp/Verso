// 條目欄的格子：選取、複製、貼上、清除、刪除、插入、上下移
import { newUid } from './paste';
import type { Entry } from './types';

/** 條目欄的四欄：#（對話 id）、發話者、原文、譯文 */
export const CELL_COLS = ['id', 'speaker', 'src', 'tgt'] as const;
export type CellCol = 0 | 1 | 2 | 3;
export const TGT_COL: CellCol = 3;

export interface Cell { i: number; c: CellCol }
export const cellKey = (i: number, c: number) => i + ':' + c;
export const parseKey = (k: string): Cell => { const [i, c] = k.split(':').map(Number); return { i, c: c as CellCol }; };

/** 格子的內容：原文有暫存的新原文時，用畫面上顯示的新原文 */
export const getCell = (e: Entry, c: number) => (c === 2 && e.upd?.src !== undefined ? e.upd.src : e[CELL_COLS[c]]);

export function setCell(e: Entry, c: number, v: string): Entry {
  // 改的是畫面上顯示的新原文
  if (c === 2 && e.upd?.src !== undefined) return { ...e, upd: { ...e.upd, src: v } };
  return { ...e, [CELL_COLS[c]]: v };
}

export const blankEntry = (): Entry => ({
  uid: newUid(), id: '', speaker: '無', src: '', src0: '', tgt: '', tgt0: '', mark: '', pending: true, skipCheck: false, note: '', sugg: '',
});

/** 兩格之間的長方形（依條目欄目前看得到的順序） */
export function rectKeys(visible: number[], a: Cell, b: Cell): string[] {
  const pa = visible.indexOf(a.i), pb = visible.indexOf(b.i);
  if (pa < 0 || pb < 0) return [cellKey(b.i, b.c)];
  const [r0, r1] = pa < pb ? [pa, pb] : [pb, pa];
  const [c0, c1] = a.c < b.c ? [a.c, b.c] : [b.c, a.c];
  const out: string[] = [];
  for (let p = r0; p <= r1; p++) for (let c = c0; c <= c1; c++) out.push(cellKey(visible[p], c));
  return out;
}

/** 選取範圍涵蓋的條目（依看得到的順序）與欄 */
export function selectionGrid(visible: number[], keys: string[]) {
  const cells = keys.map(parseKey);
  const rowSet = new Set(cells.map((c) => c.i));
  const rows = visible.filter((i) => rowSet.has(i));
  const cols = [...new Set(cells.map((c) => c.c))].sort((a, b) => a - b) as CellCol[];
  return { rows, cols };
}

/** 複製：選取範圍做成表格，沒選到的格子留空 */
export function copyMatrix(entries: Entry[], visible: number[], keys: string[]): string[][] {
  const set = new Set(keys);
  const { rows, cols } = selectionGrid(visible, keys);
  return rows.map((i) => cols.map((c) => (set.has(cellKey(i, c)) ? getCell(entries[i], c) : '')));
}

/**
 * 貼上：從左上角那格開始往右、往下填，超過四欄的部分忽略；
 * 看得到的條目用完了就在最後面新增條目。只拿掉結尾整列空白的行（整欄複製常會多出來），中間的空白行照樣貼成空白。
 * 被貼到的條目一律算待確認。
 */
export function pasteMatrix(entries: Entry[], visible: number[], top: Cell, matrix: string[][]): { entries: Entry[]; touched: number[] } {
  let n = matrix.length;
  while (n > 0 && !matrix[n - 1].some((v) => v.trim() !== '')) n--;
  const rows = matrix.slice(0, n);
  const out = [...entries];
  const touched: number[] = [];
  let pos = visible.indexOf(top.i);
  if (pos < 0) pos = 0;
  rows.forEach((r, k) => {
    let i = visible[pos + k];
    if (i === undefined) { out.push(blankEntry()); i = out.length - 1; }
    let e = out[i];
    r.forEach((v, j) => {
      const c = top.c + j;
      if (c > TGT_COL) return;
      // 發話者空白記為「無」，和手動貼入一樣
      e = setCell(e, c, c === 1 && !v.trim() ? '無' : v);
      if (c === 2 && !entries[i]) e = { ...e, src0: v };
    });
    out[i] = { ...e, pending: true };
    touched.push(i);
  });
  return { entries: out, touched };
}

/** 清除：選到的格子變空白 */
export function clearCells(entries: Entry[], keys: string[]): Entry[] {
  const out = [...entries];
  keys.map(parseKey).forEach(({ i, c }) => { if (out[i]) out[i] = setCell(out[i], c, ''); });
  return out;
}

/** 依欄分組：每欄選到哪些條目 */
function byColumn(keys: string[]) {
  const m = new Map<CellCol, number[]>();
  keys.map(parseKey).forEach(({ i, c }) => { if (!m.has(c)) m.set(c, []); m.get(c)!.push(i); });
  m.forEach((v) => v.sort((a, b) => a - b));
  return m;
}

/** 刪除：只刪選到的格子，同一欄下面的格子往上補，最後面空出來的格子留空 */
export function deleteCells(entries: Entry[], keys: string[]): Entry[] {
  const out = [...entries];
  byColumn(keys).forEach((idx, c) => {
    const drop = new Set(idx);
    const values = out.map((e) => getCell(e, c)).filter((_, i) => !drop.has(i));
    while (values.length < out.length) values.push('');
    values.forEach((v, i) => { out[i] = setCell(out[i], c, v); });
  });
  return out;
}

/** 插入：在選取的第一條後面插入空白格，同一欄下面的格子往下移；超出最後一條時新增條目 */
export function insertCells(entries: Entry[], keys: string[]): Entry[] {
  const out = [...entries];
  const cols = byColumn(keys);
  const first = Math.min(...keys.map((k) => parseKey(k).i));
  let needed = out.length;
  const columns = new Map<CellCol, string[]>();
  cols.forEach((_, c) => {
    const values = out.map((e) => getCell(e, c));
    values.splice(first + 1, 0, '');
    // 最後一格被擠出去且不是空白，就要多一條來放
    if (values[values.length - 1] !== '') needed = Math.max(needed, values.length);
    columns.set(c, values);
  });
  while (out.length < needed) out.push(blankEntry());
  columns.forEach((values, c) => out.forEach((_, i) => { out[i] = setCell(out[i], c, values[i] ?? ''); }));
  return out;
}

/** 上移／下移：選到的格子和相鄰的格子交換位置（每欄各自移動）；到頂或到底就不動 */
export function moveCells(entries: Entry[], keys: string[], dir: -1 | 1): { entries: Entry[]; keys: string[] } {
  const out = [...entries];
  const cols = byColumn(keys);
  const moved: string[] = [];
  let blocked = false;
  cols.forEach((idx) => {
    if ((dir < 0 && idx[0] === 0) || (dir > 0 && idx[idx.length - 1] === out.length - 1)) blocked = true;
  });
  if (blocked) return { entries, keys };
  cols.forEach((idx, c) => {
    const values = out.map((e) => getCell(e, c));
    const order = dir < 0 ? idx : [...idx].reverse();
    order.forEach((i) => {
      const j = i + dir;
      [values[i], values[j]] = [values[j], values[i]];
      moved.push(cellKey(j, c));
    });
    values.forEach((v, i) => { out[i] = setCell(out[i], c, v); });
  });
  return { entries: out, keys: moved };
}

// ---- 整列操作：條目本身（含標記、備註等資料）一起動 ----

/** 在第 after 條後面插入 count 條空白條目 */
export function insertRows(entries: Entry[], after: number, count: number): Entry[] {
  const add = Array.from({ length: Math.max(1, count) }, blankEntry);
  return [...entries.slice(0, after + 1), ...add, ...entries.slice(after + 1)];
}

/** 刪掉整條條目 */
export function deleteRows(entries: Entry[], rows: number[]): Entry[] {
  const d = new Set(rows);
  return entries.filter((_, i) => !d.has(i));
}

/** 整條往上或往下移一格；碰到頭尾就不動 */
export function moveRows(entries: Entry[], rows: number[], dir: -1 | 1): { entries: Entry[]; rows: number[] } {
  const sorted = [...rows].sort((a, b) => a - b);
  if ((dir < 0 && sorted[0] === 0) || (dir > 0 && sorted[sorted.length - 1] === entries.length - 1)) return { entries, rows };
  const out = [...entries];
  const order = dir < 0 ? sorted : [...sorted].reverse();
  order.forEach((i) => { [out[i], out[i + dir]] = [out[i + dir], out[i]]; });
  return { entries: out, rows: sorted.map((i) => i + dir) };
}
