import { describe, expect, it } from 'vitest';
import { withSugg } from './store';
import type { Entry } from '../model/types';

const entry = (p: Partial<Entry> = {}): Entry => ({
  uid: 'u', id: '1', speaker: '', src: '原文', src0: '原文', tgt: 'Text', tgt0: 'Text', mark: '', pending: false, skipCheck: false, note: '', sugg: '', ...p,
});

describe('建議翻譯與疑慮', () => {
  it('建議翻譯從空的變成有內容：標疑慮，記住原本的標記', () => {
    const e = withSugg(entry({ mark: 'think' }), 'New');
    expect(e.mark).toBe('doubt');
    expect(e.ver?.prev).toBe('think');
  });

  it('清空、也沒有修改：退回原本的標記', () => {
    const e = withSugg(withSugg(entry({ mark: 'verified' }), 'New'), '');
    expect(e.mark).toBe('verified');
    expect(e.ver).toBeUndefined();
  });

  it('還有修改時清空建議翻譯：維持疑慮', () => {
    const base = entry({ mark: 'doubt', ver: { base: 'Text', edits: [{ s: 0, e: 4, t: 'Word', id: 'a' }], prev: '' } });
    const e = withSugg(withSugg(base, 'New'), '');
    expect(e.mark).toBe('doubt');
    expect(e.ver?.prev).toBe('');
  });

  it('本來就是疑慮：不記原本的標記，清空時也不動', () => {
    const e = withSugg(withSugg(entry({ mark: 'doubt' }), 'New'), '');
    expect(e.mark).toBe('doubt');
  });

  it('只有空白不算有內容', () => {
    expect(withSugg(entry({ mark: 'verified' }), '  ').mark).toBe('verified');
  });
});
