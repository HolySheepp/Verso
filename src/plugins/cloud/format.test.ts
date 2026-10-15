import { describe, expect, it } from 'vitest';
import type { Entry } from '../../model/types';
import { blueStart, markToText, noteCell, stripMarkup, textToMark, tgtCell } from './format';

const entry = (p: Partial<Entry>): Entry => ({
  uid: 'u', id: '1', speaker: '', src: '', src0: '', tgt: '', tgt0: '', mark: '', pending: false, skipCheck: false, note: '', sugg: '', ...p,
});

describe('寫回 Google 表的驗證標示', () => {
  it('沒有修改和建議翻譯：就是譯文', () => {
    expect(tgtCell(entry({ tgt: 'Hello there' }))).toEqual({ text: 'Hello there', runs: [] });
  });

  it('改單詞：舊字刪除線，空一格接藍色新字', () => {
    const e = entry({ tgt: 'I like cats', ver: { base: 'I like cats', edits: [{ s: 7, e: 11, t: 'dogs', id: 'a' }] } });
    expect(tgtCell(e)).toEqual({
      text: 'I like cats dogs',
      runs: [{ start: 0 }, { start: 7, strike: true }, { start: 11 }, { start: 12, blue: true }],
    });
  });

  it('有建議翻譯：空兩行，藍色 Suggestion', () => {
    const r = tgtCell(entry({ tgt: 'Hi', sugg: 'Hello' }));
    expect(r.text).toBe('Hi\n\nSuggestion:\nHello');
    expect(r.runs).toEqual([{ start: 0 }, { start: 4, blue: true }]);
  });

  it('整句直接改：原句不動，空兩行藍色「-」接新句子', () => {
    const r = tgtCell(entry({ tgt: 'Go now', ver: { base: 'Go now', edits: [{ s: 0, e: 6, t: 'Leave at once', id: 'a' }] } }));
    expect(r.text).toBe('Go now\n\n-Leave at once');
    expect(stripMarkup(r)).toBe('Go now');
  });

  it('讀回來時去掉標示，還原成原本的譯文', () => {
    const e = entry({ tgt: 'I like cats', sugg: 'I love cats', ver: { base: 'I like cats', edits: [{ s: 7, e: 11, t: 'dogs', id: 'a' }] } });
    const r = tgtCell(e);
    expect(r.text).toBe('I like cats dogs\n\nSuggestion:\nI love cats');
    expect(stripMarkup(r)).toBe('I like cats');
    // Google 可能把一般文字的段落合在一起：照樣還原
    expect(stripMarkup({ text: 'Hi\n\nSuggestion:\nHello', runs: [{ start: 0 }, { start: 4, blue: true }] })).toBe('Hi');
    expect(stripMarkup({ text: 'Plain', runs: [] })).toBe('Plain');
  });

  it('備註：藍色從新加的地方開始，之後再加也沿用', () => {
    expect(blueStart('原本', '原本\n新的')).toBe(2);
    expect(blueStart('原本\n新的', '原本\n新的\n再加', 2)).toBe(2);
    expect(noteCell('原本\n新的', 2)).toEqual({ text: '原本\n新的', runs: [{ start: 0 }, { start: 2, blue: true }] });
    expect(noteCell('原本', undefined)).toEqual({ text: '原本', runs: [] });
  });

  it('自訂標記用名稱存，這台電腦沒有的記著', () => {
    const customs = [{ id: '3', name: '要問', kind: 'text' as const, text: '問', color: 'red' }];
    expect(markToText(entry({ mark: 'c:3' }), customs)).toBe('#要問');
    expect(textToMark('#要問', customs)).toEqual({ mark: 'c:3' });
    expect(textToMark('#別人的', customs)).toEqual({ mark: '', keptMark: '#別人的' });
    expect(textToMark('doubt', customs)).toEqual({ mark: 'doubt' });
  });
});
