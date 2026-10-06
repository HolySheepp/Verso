// 匯入檔案：在預覽表格裡選範圍，指定成 id、發話者、原文、譯文
import { emptyColumns, toCol, type ColKey, type Columns } from './paste';

/** 選取的一塊範圍（欄、列都從 0 起算，含頭尾） */
export interface Rect { c0: number; c1: number; r0: number; r1: number }

/** 指定給某個欄位的範圍：只能在同一欄，列可以跳著選 */
export interface FieldSel { col: number; rows: number[] }

export type FieldMap = Record<ColKey, FieldSel | null>;

export const emptyFields = (): FieldMap => ({ id: null, speaker: null, src: null, tgt: null, note: null });

/** 兩個角落圍成的範圍 */
export const rectOf = (a: { c: number; r: number }, b: { c: number; r: number }): Rect => ({
  c0: Math.min(a.c, b.c), c1: Math.max(a.c, b.c), r0: Math.min(a.r, b.r), r1: Math.max(a.r, b.r),
});

export const inRect = (x: Rect, c: number, r: number) => c >= x.c0 && c <= x.c1 && r >= x.r0 && r <= x.r1;

/** 欄名：A、B、…、Z、AA、AB… */
export function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** 把選取的範圍變成一個欄位的範圍；跨了不只一欄時回傳錯誤訊息 */
export function rectsToField(rects: Rect[], rowCount: number): FieldSel | string {
  if (!rects.length) return '還沒選範圍';
  const cols = new Set<number>();
  rects.forEach((x) => { for (let c = x.c0; c <= x.c1; c++) cols.add(c); });
  if (cols.size !== 1) return '一個欄位只能選一欄';
  const rows = new Set<number>();
  rects.forEach((x) => { for (let r = x.r0; r <= Math.min(x.r1, rowCount - 1); r++) rows.add(r); });
  if (!rows.size) return '還沒選範圍';
  return { col: [...cols][0], rows: [...rows].sort((a, b) => a - b) };
}

/** 範圍裡的文字，照列的順序接起來（跳過的列不算） */
export const fieldValues = (rows: string[][], f: FieldSel) => f.rows.map((r) => rows[r]?.[f.col] ?? '');

/** 連續的列合成一段：[[起, 迄], …] */
export function rowRuns(rows: number[]): [number, number][] {
  const out: [number, number][] = [];
  rows.forEach((r) => {
    const last = out[out.length - 1];
    if (last && r === last[1] + 1) last[1] = r;
    else out.push([r, r]);
  });
  return out;
}

/** 顯示用的範圍名稱，例如 B2:B7、B9:B11 */
export function fieldLabel(f: FieldSel, max = 2): string {
  const L = colName(f.col);
  const runs = rowRuns(f.rows).map(([a, b]) => (a === b ? `${L}${a + 1}` : `${L}${a + 1}:${L}${b + 1}`));
  return runs.length > max ? runs.slice(0, max).join('、') + '…' : runs.join('、');
}

/** 照指定的範圍取出各欄，接著就能用手動貼入的檢查與轉換 */
export function fieldsToColumns(rows: string[][], fields: FieldMap): Columns {
  const out = emptyColumns();
  (Object.keys(out) as ColKey[]).forEach((k) => {
    const f = fields[k];
    if (f) out[k] = toCol(fieldValues(rows, f));
  });
  return out;
}

/** Verso 存的檔案：第一列是 Verso 的欄位標題 */
export const isVersoHeader = (header: string[]) =>
  header[0] === '#' && header[1] === '發話者' && header[2] === '原文' && header[3] === '譯文' && header.includes('標記編號');
