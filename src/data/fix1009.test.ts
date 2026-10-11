import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { fileToXlsx, xlsxToFile } from './xlsxio';

const mk = (src: string) => ({ uid: 'u', id: '1', speaker: 'A', src, src0: src, tgt: 't', tgt0: 't', mark: '' as const, pending: false, skipCheck: false, note: '', sugg: '' });

describe('xlsx _x 跳脫（第 9 項）', () => {
  it.each(['_x0041_x0042_', '_X0041_', '_x005F_', 'a_x0041_b'])('%s 存了再讀回不變', (s) => {
    const doc = { fid: 'f1', name: 'a', project: 'P', sheets: [{ name: 'S', entries: [mk(s)] }] };
    expect(xlsxToFile('a', 'P', fileToXlsx(doc, []), []).sheets[0].entries[0].src).toBe(s);
  });
});

describe('日期格式（第 10 項）', () => {
  it('讀檔加 cellNF 後日期格子才有 z', () => {
    const ws: XLSX.WorkSheet = { A1: { t: 'n', v: 45000, z: 'yyyy-mm-dd' }, '!ref': 'A1' };
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'S');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    expect((XLSX.read(buf, { type: 'array', cellNF: true }).Sheets.S.A1 as XLSX.CellObject).z).toBe('yyyy-mm-dd');
  });
});

describe('sheetRows 範圍是假的（第 23 項）', () => {
  it('!ref 記成 A1:XFD1048576 也立刻回傳實際內容', async () => {
    const { sheetRows } = await import('./xlsxio');
    const ws: XLSX.WorkSheet = { A1: { t: 's', v: 'a' }, B1: { t: 's', v: 'b' }, '!ref': 'A1:XFD1048576' };
    const t0 = Date.now();
    expect(sheetRows(ws)).toEqual([['a', 'b']]);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});

describe('補零、百分比格式用顯示的文字（夜間檢查 39）', () => {
  it('0000 → 0012、0% → 50%，一般數字照原值', async () => {
    const { cellText } = await import('./xlsxio');
    const ws: XLSX.WorkSheet = {
      A1: { t: 'n', v: 12, z: '0000' }, B1: { t: 'n', v: 0.5, z: '0%' }, C1: { t: 'n', v: 100000, z: '#,##0' }, D1: { t: 'n', v: 100000, z: '0.00E+00' },
      '!ref': 'A1:D1',
    };
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'S');
    const back = XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array', cellNF: true }).Sheets.S;
    expect(['A1', 'B1', 'C1', 'D1'].map((a) => cellText(back[a] as XLSX.CellObject))).toEqual(['0012', '50%', '100000', '100000']);
    expect(cellText({ t: 'n', v: 7, z: '000' })).toBe('007');
  });
});

describe('夜間檢查 2026-10-12', () => {
  it('第 1 項：格式 "0" 不算補零，"0000" 才算', async () => {
    const { cellText } = await import('./xlsxio');
    expect(cellText({ t: 'n', v: 12.7, z: '0' })).toBe('12.7');
    expect(cellText({ t: 'n', v: 12, z: '0000' })).toBe('0012');
  });
  it('第 12 項：頁簽名稱不分大小寫去重', () => {
    const e = mk('x');
    const doc = { fid: 'f1', name: 'a', project: 'P', sheets: [{ name: 'Sheet', entries: [e] }, { name: 'sheet', entries: [e] }] };
    const wb = XLSX.read(fileToXlsx(doc, []), { type: 'array' });
    expect(wb.SheetNames.slice(0, 2)).toEqual(['Sheet', 'sheet (2)']);
  });
});
