// 目前這一條原文裡命中字典的詞：給原文框標色、Alt+數字插入譯名、字典頁的命中清單共用。
// 只算目前選中的這一條，其他條目不比對。
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { dictKey, type GlossaryTerm } from '../model/types';
import { currentOf, currentProjectOf, dictEnabledIn, useStore } from './store';

export interface DictHit {
  term: GlossaryTerm;
  /** 在原文裡出現的所有位置 */
  spans: { start: number; end: number }[];
}

/** 啟用中的字典詞條；字典內容或開關變了才重算 */
export function useActiveTerms(): GlossaryTerm[] {
  const { glossary, dicts, overrides, current } = useStore(useShallow((s) => ({
    glossary: s.project!.glossary,
    dicts: s.project!.dicts,
    overrides: s.dictOverrides,
    current: currentProjectOf(s),
  })));
  return useMemo(() => {
    const on = new Set(dicts.filter((d) => dictEnabledIn(current, overrides, d)).map((d) => dictKey(d.project, d.name)));
    return glossary.filter((g) => g.term && on.has(dictKey(g.proj, g.dict)));
  }, [glossary, dicts, overrides, current]);
}

/**
 * 找出原文裡的命中詞，依第一次出現的位置排序（第 1 個就是 Alt+1）。
 * 長的詞優先：「石像鬼王」命中時，裡面的「石像鬼」不再另外算。
 */
export function findHits(src: string, terms: GlossaryTerm[]): DictHit[] {
  if (!src) return [];
  const taken: boolean[] = new Array(src.length).fill(false);
  const hits: DictHit[] = [];
  const seen = new Set<string>();
  for (const g of [...terms].sort((a, b) => b.term.length - a.term.length)) {
    if (!g.term || seen.has(g.term) || !src.includes(g.term)) continue;
    const spans: { start: number; end: number }[] = [];
    for (let at = src.indexOf(g.term); at >= 0; at = src.indexOf(g.term, at + g.term.length)) {
      const end = at + g.term.length;
      if (taken.slice(at, end).some(Boolean)) continue;
      for (let k = at; k < end; k++) taken[k] = true;
      spans.push({ start: at, end });
    }
    if (!spans.length) continue;
    seen.add(g.term);
    hits.push({ term: g, spans });
  }
  return hits.sort((a, b) => a.spans[0].start - b.spans[0].start);
}

/** 目前這一條原文的命中詞 */
export function useCurrentHits(): DictHit[] {
  const terms = useActiveTerms();
  const src = useStore((s) => currentOf(s).entry?.src ?? '');
  return useMemo(() => findHits(src, terms), [src, terms]);
}
