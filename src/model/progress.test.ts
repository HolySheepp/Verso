import { describe, expect, it } from 'vitest';
import { fileDone, percentOf, sheetDone, sheetProgress } from './progress';
import type { Entry, FileDoc } from './types';

const E = (p: Partial<Entry>): Entry => ({ uid: Math.random().toString(36), id: '', speaker: '', src: 's', src0: '', tgt: '', tgt0: '', mark: '', pending: false, skipCheck: false, note: '', sugg: '', ...p });

describe('進度算法', () => {
  const es = [
    E({ tgt: 't' }), // 已翻譯
    E({ tgt: 't', mark: 'verified' }),
    E({ tgt: 't', mark: 'think' }),
    E({ tgt: 't', mark: 'c:1' }), // 自訂標記
    E({ tgt: 't', mark: 'doubt' }),
    E({ tgt: 't', pending: true }), // 待確認
    E({}), // 未翻譯
    E({ mark: 'ignore' }),
    E({ src: '', tgt: '' }), // 原文譯文都空白
    E({ tgt: 't', upd: { src: 'new' } }), // 還沒確認的原文更新
  ];
  it('翻譯模式：已翻譯、已驗證、待思考、自訂標記算完成，忽略不算進分母', () => {
    expect(sheetProgress(es, 'translate')).toEqual({ done: 5, total: 9 });
  });
  it('驗證模式：已驗證和自訂標記算完成', () => {
    expect(sheetProgress(es, 'verify')).toEqual({ done: 2, total: 9 });
  });
  it('沒做完不滿格；空頁簽、整頁忽略算全滿並打勾', () => {
    expect(percentOf({ done: 199, total: 200 })).toBe(99);
    expect(percentOf({ done: 0, total: 0 })).toBe(100);
    expect(sheetDone([])).toBe(true);
    expect(sheetDone([E({ mark: 'ignore' })])).toBe(true);
    expect(sheetDone(es)).toBe(false);
  });
  it('檔案打勾：所有頁簽都打勾', () => {
    const f = (sheets: Entry[][]) => ({ fid: 'f', name: 'f', project: 'P', sheets: sheets.map((entries, i) => ({ name: 'S' + i, entries })) }) as FileDoc;
    expect(fileDone(f([[E({ tgt: 't' })], [E({ tgt: 't', mark: 'think' })]]))).toBe(true);
    expect(fileDone(f([[E({ tgt: 't' })], [E({})]]))).toBe(false);
  });
});
