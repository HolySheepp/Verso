import { describe, expect, it } from 'vitest';
import { searchHit } from './store';
import type { Entry } from '../model/types';

const entry = (src: string, tgt: string, id = ''): Entry => ({ uid: 'u', id, speaker: '無', src, src0: src, tgt, tgt0: tgt, mark: '', pending: false, skipCheck: false, note: '', sugg: '' } as Entry);

describe('搜尋命中', () => {
  it('原文、譯文、ID 都不分大小寫', () => {
    expect(searchHit(entry('Hello World', ''), 'hello')).toBe(true);
    expect(searchHit(entry('x', 'Hello World'), 'WORLD')).toBe(true);
    expect(searchHit(entry('x', '', 'ABC1'), '#abc')).toBe(true);
    expect(searchHit(entry('x', 'y'), 'z')).toBe(false);
  });
});
