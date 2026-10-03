// 匯入檔案：讀進外部的表格或文字檔，給匯入視窗預覽
import * as XLSX from 'xlsx';
import { SETTINGS_SHEET } from '../model/names';
import { isVersoHeader } from '../model/importSel';

export const IMPORT_EXTS = ['xlsx', 'xlsm', 'xls', 'ods', 'csv', 'tsv', 'txt'];

export interface ImportSheet { name: string; rows: string[][] }

export interface ImportBook {
  /** 不含副檔名的檔名 */
  name: string;
  /** 已經是 Verso 的檔案格式，直接匯入 */
  verso: boolean;
  sheets: ImportSheet[];
  data: Uint8Array;
}

const extOf = (name: string) => (name.match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase();

/** 文字檔：UTF-8 讀不了時改用 Big5（舊的繁中檔案） */
function decodeText(data: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('big5').decode(data);
  }
}

/** 工作表的每一列，從 A1 開始算，空白列也保留，列號才會和原檔一樣 */
function sheetRows(ws: XLSX.WorkSheet): string[][] {
  if (!ws['!ref']) return [];
  const range = XLSX.utils.decode_range(ws['!ref']);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1, raw: false, defval: '', blankrows: true, range: { s: { r: 0, c: 0 }, e: range.e },
  });
  return rows.map((r) => r.map((v) => (v == null ? '' : String(v))));
}

const hasContent = (rows: string[][]) => rows.some((r) => r.some((v) => v.trim()));

/** 讀進一個檔案；不支援或讀不了時回傳錯誤訊息 */
export function readImport(fileName: string, data: Uint8Array): ImportBook | string {
  const ext = extOf(fileName);
  if (!IMPORT_EXTS.includes(ext)) return '不支援這種檔案';
  const name = fileName.replace(/\.[^.]+$/, '');
  let sheets: ImportSheet[];
  let verso = false;
  try {
    if (ext === 'txt') {
      // 一行一列；有 Tab 時照 Tab 分欄
      const lines = decodeText(data).split(/\r?\n/);
      if (lines.length && lines[lines.length - 1] === '') lines.pop();
      sheets = [{ name, rows: lines.map((l) => l.split('\t')) }];
    } else {
      const wb = ext === 'csv' || ext === 'tsv'
        ? XLSX.read(decodeText(data), { type: 'string', raw: true, ...(ext === 'tsv' ? { FS: '\t' } : {}) })
        : XLSX.read(data, { type: 'array' });
      const names = wb.SheetNames.filter((n) => n !== SETTINGS_SHEET);
      sheets = names.map((n) => ({ name: ext === 'csv' || ext === 'tsv' ? name : n, rows: sheetRows(wb.Sheets[n]) }));
      verso = (ext === 'xlsx' && sheets.length > 0 && isVersoHeader(sheets[0].rows[0] ?? []));
    }
  } catch {
    return '無法讀取這個檔案';
  }
  sheets = sheets.filter((sh) => hasContent(sh.rows));
  if (!sheets.length) return '檔案裡沒有內容';
  return { name, verso, sheets, data };
}
