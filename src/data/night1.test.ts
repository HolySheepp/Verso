// 夜間檢查第一批的回歸測試
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { fileToXlsx, isVersoDictData, isVersoFileData, dictToXlsx, xlsxToVersoFile } from './xlsxio';
import { mergeMarks } from './persist';

const plainXlsx = () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['名稱', '價格'], ['蘋果', '10']]), '工作表1');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
};

describe('只認 Verso 自己的檔案', () => {
  it('有檔案 ID 或 Verso 標題的才算', () => {
    const doc = { fid: 'f1', name: 'a', project: 'P', sheets: [{ name: 'S', entries: [] }] };
    expect(isVersoFileData(fileToXlsx(doc, []))).toBe(true);
    expect(isVersoFileData(fileToXlsx({ ...doc, fid: undefined }, []))).toBe(true);
    expect(isVersoFileData(plainXlsx())).toBe(false);
    expect(xlsxToVersoFile('x', 'P', plainXlsx(), [])).toBeNull();
    expect(isVersoDictData(dictToXlsx([], 'd1'))).toBe(true);
    expect(isVersoDictData(plainXlsx())).toBe(false);
  });
});

describe('換到已有 Verso 資料的資料夾：合併自訂標記', () => {
  it('同名的當成同一個，編號撞到的重新編', () => {
    const theirs = [{ id: '1', name: '甲', kind: 'text' as const, text: 'A', color: '#fff' }, { id: '2', name: '乙', kind: 'text' as const, text: 'B', color: '#fff' }];
    const ours = [{ id: '1', name: '乙', kind: 'text' as const, text: 'B', color: '#fff' }, { id: '2', name: '丙', kind: 'text' as const, text: 'C', color: '#fff' }];
    const m = mergeMarks(theirs, 3, ours, 3);
    expect(m.customs.map((c) => c.name)).toEqual(['甲', '乙', '丙']);
    expect(m.idMap.get('1')).toBe('2');
    expect(m.idMap.get('2')).toBe('3');
    expect(m.nextMarkId).toBeGreaterThanOrEqual(4);
  });
});
