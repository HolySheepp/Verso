import { describe, expect, it } from 'vitest';
import { matchRank, sortByRank } from './matchRank';

describe('最相符排序', () => {
  it('英文：完全相同 → 單字完全相同 → 單字開頭相同 → 在單字中間', () => {
    expect(matchRank('Cat', 'cat')).toBe(0);
    expect(matchRank('A black cat sleeps', 'cat')).toBe(1);
    expect(matchRank('Catalog of items', 'cat')).toBe(2);
    expect(matchRank('Bobcat', 'cat')).toBe(3);
    expect(matchRank('Dog', 'cat')).toBe(-1);
  });

  it('中文：完全相同 → 開頭相同 → 在中間', () => {
    expect(matchRank('火球', '火球')).toBe(0);
    expect(matchRank('火球術', '火球')).toBe(2);
    expect(matchRank('大火球', '火球')).toBe(3);
  });

  it('同一級照原本順序', () => {
    const list = ['Bobcat', 'cat food', 'Cat', 'concatenate', 'catalog'];
    expect(sortByRank(list, (x) => matchRank(x, 'cat'))).toEqual(['Cat', 'cat food', 'catalog', 'Bobcat', 'concatenate']);
  });
});
