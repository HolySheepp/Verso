import { describe, expect, it } from 'vitest';
import { effectiveStd, stdToText, textToStd } from './length';
import { fileToXlsx, xlsxToFile } from '../data/xlsxio';
import type { FileDoc } from './types';

const std = { family: 'Times New Roman', size: 12, width: 550, lines: 2 };

describe('長度標準', () => {
  it('文字與標準互相轉換', () => {
    expect(textToStd(stdToText(std))).toEqual(std);
    expect(textToStd('無上限')).toBe('none');
    expect(textToStd('')).toBeUndefined();
    expect(textToStd('亂寫')).toBeUndefined();
  });

  it('條目的特殊標準優先，無上限時不檢查', () => {
    expect(effectiveStd(undefined, std)).toEqual(std);
    expect(effectiveStd('none', std)).toBeNull();
    expect(effectiveStd({ ...std, lines: 3 }, 'none')?.lines).toBe(3);
  });

  it('檔案標準存在隱藏工作表、條目標準存在欄位，讀回來一樣', () => {
    const e = { uid: 'x', id: '1', speaker: '無', src: 'a', src0: 'a', tgt: 'b', tgt0: 'b', mark: '' as const, pending: false, skipCheck: false, note: '', sugg: '' };
    const file: FileDoc = { name: 'f', project: 'p', lengthStd: std, sheets: [{ name: 's', entries: [e, { ...e, lengthStd: 'none' }] }] };
    const back = xlsxToFile('f', 'p', fileToXlsx(file, []), []);
    expect(back.lengthStd).toEqual(std);
    expect(back.sheets.map((s) => s.name)).toEqual(['s']);
    expect(back.sheets[0].entries[0].lengthStd).toBeUndefined();
    expect(back.sheets[0].entries[1].lengthStd).toBe('none');
  });
});
