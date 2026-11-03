import { describe, expect, it } from 'vitest';
import { composeQuery, hasContent, minSlots, ready, resize, type QsItem } from './quickSearch';

const item = (...parts: QsItem['parts']): QsItem => ({ name: '', parts });

describe('快速搜尋', () => {
  it('組成搜尋文字：選取帶入框選的字，填寫照順序；必填但空的當作一個空格', () => {
    const it1 = item({ t: 'sel', req: true }, { t: 'text', v: ' 與 ' }, { t: 'fill', req: true }, { t: 'text', v: ' 的差別' });
    expect(composeQuery(it1, 'apple', ['apple', 'orange'])).toBe('apple 與 orange 的差別');
    expect(composeQuery(it1, '', ['', ''])).toBe('與 的差別');
    expect(ready(it1, 'apple')).toBe(false);
    expect(ready(item({ t: 'sel', req: true }, { t: 'text', v: ' 意思' }), 'apple')).toBe(true);
    expect(ready(item({ t: 'fill', req: false }), '')).toBe(true);
  });

  it('改格數：被拿掉的格子內容搬到最近的空格；不能少於有內容的格數', () => {
    const a = item({ t: 'text', v: 'a' }), b = item({ t: 'text', v: 'b' });
    const list = [a, null, null, null, b, null];
    const r = resize(list, 6, 3)!;
    expect(r).toEqual([a, null, b]);
    expect(resize([a, b, a, b], 4, 2)).toBeNull();
    expect(resize([a, b, a], 3, 2)).toBeNull();
    expect(minSlots([a, null, b])).toBe(2);
    expect(hasContent(item({ t: 'text', v: '  ' }))).toBe(false);
  });
});
