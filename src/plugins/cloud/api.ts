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

/** 有格式的文字：runs 是從第幾個字開始換樣式（刪除線、藍色） */
export interface Rich { text: string; runs: { start: number; strike?: boolean; blue?: boolean }[] }

// Google 試算表色盤裡的「藍色」（#0000ff）
const BLUE = { red: 0, green: 0, blue: 1 };

/** 寫好幾格有格式的文字（gid 是分頁 ID）；沒有 runs 的格子會清掉原本的文字格式 */
export async function writeRich(sid: string, cells: { gid: number; row: number; col: number; rich: Rich }[]) {
  if (!cells.length) return;
  await call('POST', `${sid}:batchUpdate`, {
    requests: cells.map((c) => ({
      updateCells: {
        start: { sheetId: c.gid, rowIndex: c.row, columnIndex: c.col },
        rows: [{ values: [{
          userEnteredValue: { stringValue: c.rich.text },
          textFormatRuns: c.rich.runs.filter((r) => r.start < c.rich.text.length).map((r) => ({
            startIndex: r.start,
            format: { ...(r.strike ? { strikethrough: true } : {}), ...(r.blue || r.strike ? { foregroundColorStyle: { rgbColor: BLUE } } : {}) },
          })),
        }] }],
        fields: 'userEnteredValue,textFormatRuns',
      },
    })),
  });
}

/** 寫好幾列（從第 row 列起，A 欄開始） */
export async function writeRows(sid: string, title: string, rows: { row: number; values: string[] }[]) {
  if (!rows.length) return;
  await call('POST', `${sid}/values:batchUpdate`, {
    valueInputOption: 'RAW',
    data: rows.map((r) => ({ range: `${q(title)}!A${r.row + 1}`, values: [r.values] })),
  });
}

/** 接在表的最後面加幾列；回傳第一列的位置（從 0 起算） */
export async function appendRows(sid: string, title: string, rows: string[][]): Promise<number> {
  const r = await call<{ updates?: { updatedRange?: string } }>('POST',
    `${sid}/values/${encodeURIComponent(q(title) + '!A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { values: rows });
  const m = r.updates?.updatedRange?.match(/![A-Z]+(\d+)/);
  return m ? Number(m[1]) - 1 : -1;
}

/** 新增一個分頁：只有一列、cols 欄（Google 預設 1000 列 26 欄，會佔掉試算表的格子上限）；之後加在最後的列會自動長出來 */
export async function addTab(sid: string, title: string, cols: number) {
  await call('POST', `${sid}:batchUpdate`, { requests: [{ addSheet: { properties: { title, gridProperties: { rowCount: 1, columnCount: cols } } } }] });
}

type GColor = { red?: number; green?: number; blue?: number };
/** Verso 寫的藍字（現在的 #0000ff 或之前的深寶藍色） */
const isBlue = (c?: GColor) => !!c && (c.blue ?? 0) > 0.5 && (c.red ?? 0) < 0.3 && (c.green ?? 0) < 0.45;

/** 讀一欄每一格的文字和格式（刪除線、藍字）；回傳以列為索引（從 0 起算） */
export async function readRich(sid: string, title: string, col: number): Promise<Rich[]> {
  const L = colName(col);
  const fields = 'sheets(data(startRow,rowData(values(formattedValue,textFormatRuns))))';
  const r = await call<{ sheets?: { data?: { startRow?: number; rowData?: { values?: { formattedValue?: string; textFormatRuns?: { startIndex?: number; format?: { strikethrough?: boolean; foregroundColor?: GColor; foregroundColorStyle?: { rgbColor?: GColor } } }[] }[] }[] }[] }[] }>(
    'GET', `${sid}?ranges=${encodeURIComponent(`${q(title)}!${L}:${L}`)}&fields=${encodeURIComponent(fields)}`);
  const d = r.sheets?.[0]?.data?.[0];
  const out: Rich[] = [];
  (d?.rowData ?? []).forEach((row, i) => {
    const v = row.values?.[0];
    out[(d?.startRow ?? 0) + i] = {
      text: v?.formattedValue ?? '',
      runs: (v?.textFormatRuns ?? []).map((x) => ({
        start: x.startIndex ?? 0,
        ...(x.format?.strikethrough ? { strike: true } : {}),
        ...(isBlue(x.format?.foregroundColorStyle?.rgbColor ?? x.format?.foregroundColor) ? { blue: true } : {}),
      })),
    };
  });
  return out;
}
