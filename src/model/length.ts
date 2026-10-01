// 句子長度標準：譯文在指定欄寬、字型、字級下，最多能排幾行（模擬 Google Sheets 的儲存格）

export interface LengthStd {
  /** 譯文字型 */
  family: string;
  /** 字級（pt） */
  size: number;
  /** 欄寬（px），含儲存格兩側內距 */
  width: number;
  /** 行數上限 */
  lines: number;
}

/** 檔案或條目的標準；'none' 是「無上限」 */
export type StdValue = LengthStd | 'none';

/** Google Sheets 儲存格左右各留的內距（px） */
export const CELL_PADDING = 4;

/** 中文上限、視覺兩種方式換算欄寬時用的字型 */
export const CJK_FAMILY = 'Microsoft JhengHei';
export const CJK_SIZE = 12;

const NONE_TEXT = '無上限';

/** 存進 xlsx 的文字，例如「Times New Roman|12|550|2」 */
export function stdToText(v: StdValue | undefined): string {
  if (!v) return '';
  if (v === 'none') return NONE_TEXT;
  return [v.family, v.size, v.width, v.lines].join('|');
}

export function textToStd(t: string): StdValue | undefined {
  const s = t.trim();
  if (!s) return undefined;
  if (s === NONE_TEXT) return 'none';
  const [family, size, width, lines] = s.split('|');
  const n = [Number(size), Number(width), Number(lines)];
  if (!family || n.some((x) => !Number.isFinite(x) || x <= 0)) return undefined;
  return { family, size: n[0], width: n[1], lines: Math.round(n[2]) };
}

/** 給人看的簡短說明 */
export function stdLabel(v: StdValue | undefined): string {
  if (!v) return '未設定';
  if (v === 'none') return NONE_TEXT;
  return `${v.family} ${v.size}pt・欄寬 ${v.width}px・${v.lines} 行`;
}

export const sameStd = (a: StdValue | undefined, b: StdValue | undefined) => stdToText(a) === stdToText(b);

/** 條目實際用的標準：有特殊標準用特殊標準，否則用檔案標準 */
export const effectiveStd = (entry: StdValue | undefined, file: StdValue | undefined): LengthStd | null => {
  const v = entry ?? file;
  return v && v !== 'none' ? v : null;
};
