import { describe, expect, it } from 'vitest';
import { findSkillHits } from './dictHits';
import type { GlossaryTerm } from '../model/types';

describe('技能檔案的字典比對：標籤裡的數字不算', () => {
  it('拿掉數字後一樣就命中，位置換回原文', () => {
    const terms = [{ term: 'Deal {%} damage', en: '造成 {%} 傷害' }] as unknown as GlossaryTerm[];
    const src = 'Hit: Deal {12%} damage.';
    const hits = findSkillHits(src, terms);
    expect(hits.length).toBe(1);
    const sp = hits[0].spans[0];
    expect(src.slice(sp.start, sp.end)).toBe('Deal {12%} damage');
  });
});
