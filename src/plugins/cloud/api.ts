// 跟 Google 打交道：登入在桌面外殼（src-tauri/src/plugins/cloud），這裡只組請求、整理結果
import { invoke } from '@tauri-apps/api/core';
import { tx } from '../../i18n';
import { colName } from '../../model/importSel';

/** 呼叫 Google Sheets API（path 接在 spreadsheets/ 後面） */
const call = <T = unknown>(method: 'GET' | 'POST', path: string, body?: unknown) => invoke<T>('cloud_api', { method, path, body: body ?? null });

export const login = (clientId: string, clientSecret: string) => invoke<string>('cloud_login', { clientId, clientSecret });
export const loginStatus = () => invoke<string | null>('cloud_status');
export const logout = () => invoke('cloud_logout');

/** 從網址取出試算表 ID（直接貼 ID 也可以） */
export function sidOf(url: string): string | null {
  const t = url.trim();
  const m = t.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(t) ? t : null;
}

/** 分頁名稱放進範圍時要加引號 */
const q = (title: string) => `'${title.replace(/'/g, "''")}'`;

export interface Meta { title: string; tabs: { gid: number; title: string }[] }

/** 試算表名稱與各分頁 */
export async function meta(sid: string): Promise<Meta> {
  const r = await call<{ properties: { title: string }; sheets: { properties: { sheetId: number; title: string; index: number } }[] }>(
    'GET', `${sid}?fields=properties.title,sheets.properties(sheetId,title,index)`);
  return {
    title: r.properties.title,
    tabs: [...r.sheets].sort((a, b) => a.properties.index - b.properties.index).map((s) => ({ gid: s.properties.sheetId, title: s.properties.title })),
  };
}

const cell = (v: unknown) => (v === undefined || v === null ? '' : String(v));

/** 讀好幾個分頁的全部內容（顯示的文字） */
export async function readTabs(sid: string, titles: string[]): Promise<string[][][]> {
  if (!titles.length) return [];
  const ranges = titles.map((t) => 'ranges=' + encodeURIComponent(q(t))).join('&');
  const r = await call<{ valueRanges?: { values?: unknown[][] }[] }>('GET', `${sid}/values:batchGet?${ranges}&majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`);
  return titles.map((_, i) => (r.valueRanges?.[i]?.values ?? []).map((row) => row.map(cell)));
}

/** 讀一個分頁的幾欄（每欄從第 1 列起的內容） */
export async function readCols(sid: string, title: string, cols: number[]): Promise<string[][]> {
  const ranges = cols.map((c) => 'ranges=' + encodeURIComponent(`${q(title)}!${colName(c)}:${colName(c)}`)).join('&');
  const r = await call<{ valueRanges?: { values?: unknown[][] }[] }>('GET', `${sid}/values:batchGet?${ranges}&majorDimension=COLUMNS&valueRenderOption=FORMATTED_VALUE`);
  return cols.map((_, i) => (r.valueRanges?.[i]?.values?.[0] ?? []).map(cell));
}

/** 寫好幾格（照原樣寫入文字，不會被當成公式） */
export async function writeCells(sid: string, cells: { title: string; row: number; col: number; value: string }[]) {
  if (!cells.length) return;
  await call('POST', `${sid}/values:batchUpdate`, {
    valueInputOption: 'RAW',
    data: cells.map((c) => ({ range: `${q(c.title)}!${colName(c.col)}${c.row + 1}`, values: [[c.value]] })),
  });
}

/** 在分頁的第 at 欄（從 0 起算）插入一個空白欄 */
export async function insertCol(sid: string, gid: number, at: number) {
  await call('POST', `${sid}:batchUpdate`, {
    requests: [{ insertDimension: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: at, endIndex: at + 1 }, inheritFromBefore: true } }],
  });
}

/** 錯誤翻成看得懂的話 */
export function errText(e: unknown): string {
  const m = String((e as { message?: string })?.message ?? e);
  if (m === 'not-signed-in') return tx('cloud.errLogin');
  if (m === 'no-client') return tx('cloud.errClient');
  if (m === 'timeout') return tx('cloud.errTimeout');
  if (/^403\b/.test(m)) return tx('cloud.errDenied');
  if (/^404\b/.test(m)) return tx('cloud.errNotFound');
  if (/error sending request|dns|connect/i.test(m)) return tx('cloud.errNetwork');
  return tx('cloud.errOther', { msg: m.length > 120 ? m.slice(0, 120) + '…' : m });
}
