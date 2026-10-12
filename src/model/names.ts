import { tx } from '../i18n';
// 檔案、專案、字典、頁簽的名稱規則

/** 資料夾名稱：存放字典的資料夾，專案不能取這個名字 */
export const DICT_DIR = '字典';
/** 資料夾名稱：放外部介面語言包的資料夾，專案也不能取這個名字 */
export const LANG_DIR = '語言';
/** 介面語言包放在主程式資料夾裡的這個資料夾 */
export const APP_LANG_DIR = 'lang';
/** 檔案層級設定（長度標準等）放在 xlsx 的這個隱藏工作表，頁簽不能取這個名字 */
export const SETTINGS_SHEET = 'Verso設定';

/** 存成檔名時 Windows 不允許的字元換成 _ */
export const safeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, '_').trim() || '未命名';

/** 比較名稱用：存檔後會變成同一個檔名、或只差大小寫的，都算同名（Windows 的檔名不分大小寫） */
export const nameKey = (name: string) => safeName(name).toLowerCase();
export const sameName = (a: string, b: string) => nameKey(a) === nameKey(b);

/** Excel 工作表名稱的限制：不能有 \ / ? * [ ] :，不能空白，最多 31 字，開頭結尾不能是 ' */
export function sheetNameError(name: string, others: string[]): string {
  const n = name.trim();
  if (!n) return tx('name.001');
  if (/[\\/?*[\]:]/.test(n)) return tx('name.002');
  if (n.length > 31) return tx('name.003');
  if (n.startsWith("'") || n.endsWith("'")) return tx('name.004');
  // Excel 的工作表名稱不分大小寫
  if (n.toLowerCase() === SETTINGS_SHEET.toLowerCase()) return tx('name.005', { SETTINGS_SHEET });
  if (others.some((o) => o.trim().toLowerCase() === n.toLowerCase())) return tx('name.006');
  return '';
}

/** Excel 一格最多放這麼多字 */
// 存檔用的預設名稱：不隨介面語言改變，一律中文
/** 沒取名的頁簽 */
export const defaultSheetName = (n: number) => '頁簽 ' + n;
/** 新頁簽的預設名稱：從 1 開始找第一個沒人用的「頁簽 N」（不分大小寫） */
export function freeSheetName(used: string[]): string {
  const taken = new Set(used.map((x) => x.trim().toLowerCase()));
  let n = 1;
  while (taken.has(defaultSheetName(n).toLowerCase())) n++;
  return defaultSheetName(n);
}
/** 沒取名的檔案 */
export const DEFAULT_FILE_NAME = '未命名檔案';
/** 沒有發話者時 */
export const NO_SPEAKER = '無';

export const MAX_CELL_CHARS = 32767;

/**
 * 存檔時實際寫進格子的長度：文字裡本來就有的 _xHHHH_ 會跳脫成 _x005F_xHHHH_，每個多 6 字
 * （見 xlsxio.ts textSheet）
 */
export const savedLength = (s: string) => (s.includes('_') ? s.length + 6 * (s.match(/_(?=[xX][0-9A-Fa-f]{4}_)/g)?.length ?? 0) : s.length);
/** 存得進 Excel 的一格 */
export const fitsCell = (s: string) => savedLength(s) <= MAX_CELL_CHARS;

/** 貼入的內容裡有沒有一格超過 Excel 的上限 */
export const hasTooLongCell = (cells: string[][]) => cells.some((r) => r.some((v) => !fitsCell(v)));
export const tooLongMsg = () => tx('name.007');
