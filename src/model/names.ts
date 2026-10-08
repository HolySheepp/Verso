// 檔案、專案、字典、頁簽的名稱規則

/** 資料夾名稱：存放字典的資料夾，專案不能取這個名字 */
export const DICT_DIR = '字典';
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
  if (!n) return '頁簽名稱不能空白';
  if (/[\\/?*[\]:]/.test(n)) return '頁簽名稱不能有 \\ / ? * [ ] :';
  if (n.length > 31) return '頁簽名稱最多 31 個字';
  if (n.startsWith("'") || n.endsWith("'")) return "頁簽名稱開頭、結尾不能是 '";
  // Excel 的工作表名稱不分大小寫
  if (n.toLowerCase() === SETTINGS_SHEET.toLowerCase()) return `「${SETTINGS_SHEET}」是保留名稱`;
  if (others.some((o) => o.trim().toLowerCase() === n.toLowerCase())) return '已有同名頁簽';
  return '';
}

/** Excel 一格最多放這麼多字 */
export const MAX_CELL_CHARS = 32767;

/** 貼入的內容裡有沒有一格超過 Excel 的上限 */
export const hasTooLongCell = (cells: string[][]) => cells.some((r) => r.some((v) => v.length > MAX_CELL_CHARS));
export const TOO_LONG_MSG = 'Excel 一格最多 32767 字，有一格超過了，沒有貼上';
