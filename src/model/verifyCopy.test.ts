import { describe, expect, it } from 'vitest';
import { verifyCell, wholeChanged } from './verifyCopy';
import type { Entry } from './types';

const entry = (tgt: string, edits: { s: number; e: number; t: string }[], sugg = ''): Entry => ({
  uid: 'u', id: '1', speaker: 'A', src: '', src0: '', tgt, tgt0: tgt, mark: '', pending: false, skipCheck: false, note: '', sugg,
  ...(edits.length ? { ver: { base: tgt, edits } } : {}),
});

describe('驗證模式複製譯文欄', () => {
  it('沒修改照原樣', () => {
    expect(verifyCell(entry('Happy', []))).toBe('Happy');
  });
  it('部分修改：刪除線加新字', () => {
    const c = verifyCell(entry('Happy New Year', [{ s: 6, e: 14, t: 'Christmas' }]));
    expect(typeof c).toBe('object');
    if (typeof c === 'string') return;
    expect(c.text).toBe('Happy Christmas');
    expect(c.html).toContain('line-through;color:#1155cc;">New Year</span> <span');
  });
  it('整句改：換行寫新句子', () => {
    expect(wholeChanged('Hi there!', [{ s: 0, e: 2 }, { s: 3, e: 8 }])).toBe(true);
    expect(wholeChanged('Hi there!', [{ s: 0, e: 2 }])).toBe(false);
    const c = verifyCell(entry('Hi', [{ s: 0, e: 2, t: 'Hello' }]));
    if (typeof c === 'string') throw new Error();
    expect(c.html).toBe('Hi<br><span style="font-weight:normal;font-style:normal;color:#1155cc;">Hello</span>');
  });
  it('建議翻譯', () => {
    const c = verifyCell(entry('Hi', [], 'Hello'));
    if (typeof c === 'string') throw new Error();
    expect(c.text).toBe('Hi\nSuggestion:\nHello');
  });
});
