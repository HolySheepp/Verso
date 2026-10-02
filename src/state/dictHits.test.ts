import { describe, expect, it } from 'vitest';
import { findHits } from './dictHits';

const t = (term: string, en: string) => ({ id: term, term, en, note: '', dict: 'd', proj: 'p' });

describe('原文命中字典的詞', () => {
  it('依出現順序排，長的詞優先，空的詞不算', () => {
    const hits = findHits('旅人看見石像鬼王，石像鬼王很大', [t('石像鬼', 'Gargoyle'), t('石像鬼王', 'Gargoyle King'), t('旅人', 'Traveler'), t('', 'x')]);
    expect(hits.map((h) => h.term.en)).toEqual(['Traveler', 'Gargoyle King']);
    expect(hits[1].spans).toEqual([{ start: 4, end: 8 }, { start: 9, end: 13 }]);
  });
});
