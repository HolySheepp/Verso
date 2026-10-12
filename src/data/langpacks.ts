// 外部介面語言包：主程式資料夾「lang」資料夾裡的 Verso 檔案，# 欄是文字代號、原文是中文、譯文是該語言
import * as XLSX from 'xlsx';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { io } from './fsio';
import { APP_LANG_DIR, LANG_DIR } from '../model/names';
import { sheetRows } from './xlsxio';

export const isPack = (n: string) => n.toLowerCase().endsWith('.xlsx') && !n.startsWith('~$');

/** 放語言包的資料夾：主程式資料夾裡的 lang（安裝版在安裝位置，攜帶版在 Verso.exe 旁邊）；瀏覽器預覽用假的位置 */
let langDirCache: string | null = null;
export async function appLangDir(): Promise<string> {
  if (langDirCache) return langDirCache;
  const base = isTauri() ? await invoke<string>('app_dir') : 'VersoApp';
  langDirCache = io.join(base, APP_LANG_DIR);
  return langDirCache;
}

/**
 * 加入語言包：檔案複製進 lang 資料夾。同名的要先問 replace，回 false 就跳過。
 * 回傳實際加入的名稱。讀不出語言包內容的檔案不加，放在 bad 裡。
 */
export async function addLangPacks(files: { name: string; data: Uint8Array }[], replace: (name: string) => Promise<boolean>): Promise<{ added: string[]; bad: string[] }> {
  const dir = await appLangDir();
  await io.mkdir(dir);
  const added: string[] = [], bad: string[] = [];
  for (const f of files) {
    if (!isPack(f.name)) { bad.push(f.name); continue; }
    try { if (!readPackData(f.data).length) { bad.push(f.name); continue; } } catch { bad.push(f.name); continue; }
    const name = f.name.slice(0, -5);
    const existing = (await io.list(dir)).find((e) => !e.dir && e.name.toLowerCase() === f.name.toLowerCase());
    if (existing && !(await replace(name))) continue;
    await io.writeBinary(io.join(dir, existing?.name ?? f.name), f.data);
    added.push(name);
  }
  return { added, bad };
}

/**
 * 舊版（v0.67.0～v0.76.0）語言包放在存檔資料夾的「語言」資料夾：複製到 lang 資料夾（已經有同名的不蓋），原檔不動。
 * 有 project.json 的「語言」是一般專案，不動。
 */
export async function copyOldPacks(saveRoot: string): Promise<void> {
  const old = io.join(saveRoot, LANG_DIR);
  if (!(await io.exists(old)) || await io.exists(io.join(old, 'project.json'))) return;
  const dir = await appLangDir();
  await io.mkdir(dir);
  const have = new Set((await io.list(dir)).filter((e) => !e.dir).map((e) => e.name.toLowerCase()));
  for (const e of await io.list(old)) {
    if (e.dir || !isPack(e.name) || have.has(e.name.toLowerCase())) continue;
    await io.writeBinary(io.join(dir, e.name), await io.readBinary(io.join(old, e.name)));
  }
}

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
export async function readLangPacks(dir: string): Promise<Map<string, [string, string][] | null>> {
  const out = new Map<string, [string, string][] | null>();
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
