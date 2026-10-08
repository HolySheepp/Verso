// 目前這一條原文裡命中字典的詞：給原文框標色、Alt+數字插入譯名、字典頁的命中清單共用。
// 只算目前選中的這一條，其他條目不比對。
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { SHARED, dictKey, type GlossaryTerm } from '../model/types';
import { currentOf, shownSrc, currentProjectOf, dictEnabledIn, useStore } from './store';

export interface DictHit {
  /** 第一個譯名（Alt+數字插入這個）：目前專案的字典優先 */
  term: GlossaryTerm;
  /** 同一個原文在各本字典裡的所有譯名，順序同上 */
  terms: GlossaryTerm[];
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
export function findHits(src: string, terms: GlossaryTerm[], current?: string): DictHit[] {
  if (!src) return [];
  const words = prepared(terms, current);
  // 同一份字典、同一段原文（工作欄和字典頁同時要）：直接用上次的結果
  const last = lastHits.get(words);
  if (last && last.src === src) return last.hits;
  const taken: boolean[] = new Array(src.length).fill(false);
  const hits: DictHit[] = [];
  // 長的詞優先：只用來排除被長詞蓋住的位置
  for (const { word, variants } of words) {
    if (!src.includes(word)) continue;
    const spans: { start: number; end: number }[] = [];
    for (let at = src.indexOf(word); at >= 0;) {
      const end = at + word.length;
      // 這個位置被長詞擋住：從下一個字繼續找
      if (taken.slice(at, end).some(Boolean)) { at = src.indexOf(word, at + 1); continue; }
      for (let k = at; k < end; k++) taken[k] = true;
      spans.push({ start: at, end });
      at = src.indexOf(word, end);
    }
    if (!spans.length) continue;
    hits.push({ term: variants[0], terms: variants, spans });
  }
  const out = hits.sort((a, b) => a.spans[0].start - b.spans[0].start);
  lastHits.set(words, { src, hits: out });
  return out;
}

interface Prepared { word: string; variants: GlossaryTerm[] }
/** 字典整理好的樣子：同一個原文的詞條放一起，長的詞排前面；字典內容或目前專案變了才重做 */
const preparedCache = new WeakMap<GlossaryTerm[], { current?: string; words: Prepared[] }>();
const lastHits = new WeakMap<Prepared[], { src: string; hits: DictHit[] }>();
function prepared(terms: GlossaryTerm[], current?: string): Prepared[] {
  const hit = preparedCache.get(terms);
  if (hit && hit.current === current) return hit.words;
  const groups = new Map<string, GlossaryTerm[]>();
  for (const g of terms) {
    if (!g.term) continue;
    const list = groups.get(g.term);
    if (list) list.push(g); else groups.set(g.term, [g]);
  }
  // 目前專案的字典排前面，再來是共用
  const rank = (g: GlossaryTerm) => (g.proj === current ? 0 : g.proj === SHARED ? 1 : 2);
  const words = [...groups].map(([word, list]) => ({ word, variants: list.sort((a, b) => rank(a) - rank(b)) }))
    .sort((a, b) => b.word.length - a.word.length);
  preparedCache.set(terms, { current, words });
  return words;
}

/** 目前這一條原文的命中詞 */
export function useCurrentHits(): DictHit[] {
  const terms = useActiveTerms();
  // 畫面上顯示的原文（有新原文時用新原文）
  const src = useStore((s) => { const e = currentOf(s).entry; return e ? shownSrc(e) : ''; });
  const current = useStore((s) => currentProjectOf(s));
  return useMemo(() => findHits(src, terms, current), [src, terms, current]);
}
