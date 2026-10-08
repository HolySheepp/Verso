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

describe('同一個原文有好幾個譯名', () => {
  it('全部列出來，目前專案的排前面；被長詞擋住後還會往後找', async () => {
    const { findHits } = await import('./dictHits');
    const t = (id: string, term: string, en: string, proj: string) => ({ id, term, en, note: '', proj, dict: 'd' });
    const hits = findHits('石像鬼王和石像鬼', [t('1', '石像鬼', 'gargoyle', '共用'), t('2', '石像鬼', 'Gargoyle', 'A'), t('3', '石像鬼王', 'Gargoyle King', '共用')], 'A');
    const g = hits.find((h) => h.term.term === '石像鬼')!;
    expect(g.terms.map((x) => x.id)).toEqual(['2', '1']);
    expect(g.spans).toEqual([{ start: 5, end: 8 }]);
  });
});

describe('字典比對不分大小寫、全形半形', () => {
  it('Sword 和 ｓｗｏｒｄ 都命中 sword，位置是原文裡的位置', async () => {
    const { findHits } = await import('./dictHits');
    const t = (term: string, en: string) => ({ id: term, term, en, note: '', dict: 'D', proj: 'P' });
    const hits = findHits('A Sword and ｓｗｏｒｄ', [t('sword', '劍')]);
    expect(hits.length).toBe(1);
    expect(hits[0].spans).toEqual([{ start: 2, end: 7 }, { start: 12, end: 17 }]);
  });
});
