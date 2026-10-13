import { describe, expect, it } from 'vitest';
import { fileToXlsx, quickFileIdOf } from './xlsxio';
import * as XLSX from 'xlsx';

describe('存檔前確認位置上的檔案是不是自己的（夜間檢查 23）', () => {
  it('Verso 檔讀得到檔案 ID；別人的 xlsx 讀不到', () => {
    const e = { uid: 'u', id: '1', speaker: 'A', src: 's', src0: 's', tgt: 't', tgt0: 't', mark: '' as const, pending: false, skipCheck: false, note: '', sugg: '' };
    const data = fileToXlsx({ fid: 'F123', name: 'a', project: 'P', sheets: [{ name: 'S', entries: [e] }] }, []);
    expect(quickFileIdOf(data)).toBe('F123');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['劇本', 'x']]), 'Sheet1');
    expect(quickFileIdOf(new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer))).toBeNull();
  });
  it('只讀設定頁：大檔也很快', () => {
    const entries = Array.from({ length: 20000 }, (_, i) => ({ uid: 'u' + i, id: String(i), speaker: 'A', src: 'source text ' + i, src0: '', tgt: 'target ' + i, tgt0: '', mark: '' as const, pending: false, skipCheck: false, note: '', sugg: '' }));
    const data = fileToXlsx({ fid: 'BIG', name: 'a', project: 'P', sheets: [{ name: 'S', entries }] }, []);
    const t = Date.now();
    expect(quickFileIdOf(data)).toBe('BIG');
    expect(Date.now() - t).toBeLessThan(500);
  });
});
