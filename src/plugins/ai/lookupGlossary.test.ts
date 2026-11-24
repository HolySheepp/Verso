import { describe, expect, it } from 'vitest';
import { lookupGlossary } from './ai';
import type { GlossaryTerm } from '../../model/types';

describe('AI 查字典', () => {
  const terms = [
    { term: '蘇青', en: 'Cyan' },
    { term: '蘇青的劍', en: "Cyan's Sword" },
  ] as unknown as GlossaryTerm[];
  it('一樣的詞優先，沒有才找包含的', () => {
    expect(lookupGlossary(['蘇青'], terms)[0].matches).toEqual([{ term: '蘇青', translations: ['Cyan'] }]);
    expect(lookupGlossary(['劍'], terms)[0].matches.map((m) => m.term)).toEqual(['蘇青的劍']);
    expect(lookupGlossary(['王五'], terms)[0].matches).toEqual([]);
  });
});
