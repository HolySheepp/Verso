// 條目存檔時寫進的格子有沒有超過 Excel 一格的上限：存檔、驗證修改、原文更新等共用同一個檢查
import { fitsCell } from './names';
import { editsOf, verifyToText } from './verify';
import type { Entry } from './types';

/** 這一條存檔時寫進的所有格子（程式用的欄位：驗證修改、原文更新存成的文字也算） */
export const savedCells = (e: Entry) => [e.id, e.speaker, e.src, e.tgt, e.note, e.sugg, e.src0, e.tgt0,
  e.ver ? verifyToText({ ...e.ver, base: e.tgt, edits: editsOf(e) }) : '', e.upd ? JSON.stringify(e.upd) : ''];

/** 這一條存得進檔案 */
export const entryFits = (e: Entry) => savedCells(e).every(fitsCell);
