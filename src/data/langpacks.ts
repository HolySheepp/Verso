// 外部介面語言包：存檔資料夾「語言」資料夾裡的 Verso 檔案，# 欄是文字代號、原文是中文、譯文是該語言
import * as XLSX from 'xlsx';
import { io } from './fsio';
import { LANG_DIR } from '../model/names';
import { sheetRows } from './xlsxio';

const isPack = (n: string) => n.toLowerCase().endsWith('.xlsx') && !n.startsWith('~$');

/** 一個語言包裡的（代號, 譯文）；讀不了時丟出錯誤 */
export function readPackData(data: Uint8Array): [string, string][] {
  const wb = XLSX.read(data, { type: 'array', cellNF: true });
  const out: [string, string][] = [];
  for (const sn of wb.SheetNames) {
    const rows = sheetRows(wb.Sheets[sn]);
    const head = (rows[0] ?? []).map((v) => v.trim());
    // 照標題找欄位；沒有標題時照 Verso 的欄位順序（# 在 A 欄、譯文在 D 欄）
    const hasHead = head.includes('#') && head.includes('譯文');
    const ki = hasHead ? head.indexOf('#') : 0;
    const vi = hasHead ? head.indexOf('譯文') : 3;
    for (const r of hasHead ? rows.slice(1) : rows) {
      const key = (r[ki] ?? '').trim();
      if (key) out.push([key, r[vi] ?? '']);
    }
  }
  return out;
}

/** 超過這個大小的語言包不讀、不列出（太大的檔案讀起來會卡） */
export const MAX_PACK_BYTES = 5 * 1024 * 1024;

/** 讀過的語言包：大小、修改時間都沒變就不重讀 */
const packCache = new Map<string, { size: number; mtime: number; pairs: [string, string][] | null }>();

/** 「語言」資料夾裡的語言包：檔名（不含 .xlsx）→ 內容；讀不了的是 null */
export async function readLangPacks(root: string): Promise<Map<string, [string, string][] | null>> {
  const out = new Map<string, [string, string][] | null>();
  const dir = io.join(root, LANG_DIR);
  if (!(await io.exists(dir))) return out;
  for (const e of await io.list(dir)) {
    if (e.dir || !isPack(e.name)) continue;
    const name = e.name.slice(0, -5), path = io.join(dir, e.name);
    let st: { size: number; mtime: number | null } | null = null;
    try { st = await io.stat(path); } catch { /* 查不到就照樣讀 */ }
    if (st && st.size > MAX_PACK_BYTES) continue;
    const hit = packCache.get(path);
    if (st && st.mtime !== null && hit && hit.size === st.size && hit.mtime === st.mtime) { out.set(name, hit.pairs); continue; }
    let pairs: [string, string][] | null;
    try { pairs = readPackData(await io.readBinary(path)); } catch { pairs = null; }
    out.set(name, pairs);
    if (st && st.mtime !== null) packCache.set(path, { size: st.size, mtime: st.mtime, pairs });
  }
  return out;
}
