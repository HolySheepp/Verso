import { describe, expect, it } from 'vitest';
import { entryFits } from './cellLimit';
import { fitsCell, savedLength } from './names';
import type { Entry } from './types';

const E = (p: Partial<Entry>): Entry => ({ uid: 'u', id: '', speaker: '', src: '', src0: '', tgt: '', tgt0: '', mark: '', pending: false, skipCheck: false, note: '', sugg: '', ...p });

describe('存檔時一格的實際長度（夜間檢查 9）', () => {
  it('_xHHHH_ 跳脫後每個多 6 字', () => {
    expect(savedLength('abc')).toBe(3);
    expect(savedLength('_x0041_')).toBe(13);
    expect(fitsCell('a'.repeat(32767))).toBe(true);
    expect(fitsCell('a'.repeat(32760) + '_x0041_')).toBe(false);
  });
  it('驗證修改、原文更新存成的文字也算', () => {
    const big = 'a'.repeat(20000);
    expect(entryFits(E({ tgt: big }))).toBe(true);
    // 修改存成 JSON：引號會跳脫成兩個字
    const quotes = '"'.repeat(17000);
    expect(entryFits(E({ tgt: quotes }))).toBe(true);
    expect(entryFits(E({ tgt: quotes, ver: { base: quotes, edits: [{ s: 0, e: 1, t: 'b' }] } }))).toBe(false);
    expect(entryFits(E({ src: big, upd: { src: big } }))).toBe(true);
    expect(entryFits(E({ src: 'x', upd: { src: '"'.repeat(17000) } }))).toBe(false);
  });
});
