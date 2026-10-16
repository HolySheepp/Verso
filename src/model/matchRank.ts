// 搜尋結果「最相符」的排序：完全相同 → 單字完全相同 → 單字開頭相同 → 在單字中間。
// 中文沒有單字：完全相同 → 開頭相同 → 在中間。數字越小越相符，-1 代表沒找到；同一級照原本的順序
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const WORD = /[\p{L}\p{N}]/u;
/** 算單字的字元：字母、數字（中日韓文字不算，所以前後是中文也算單字的邊界） */
const isWord = (c: string | undefined) => !!c && WORD.test(c) && !CJK.test(c);

export function matchRank(text: string, q: string): number {
  const k = q.trim().toLowerCase();
  if (!k) return -1;
  const t = text.toLowerCase();
  let at = t.indexOf(k);
  if (at < 0) return -1;
  if (t.trim() === k) return 0;
  // 搜尋字是中文（沒有單字）：只看是不是開頭
  if (CJK.test(k)) return t.trimStart().startsWith(k) ? 2 : 3;
  let best = 3;
  while (at >= 0 && best > 1) {
    if (!isWord(t[at - 1]) || !isWord(k[0])) {
      const end = at + k.length;
      best = Math.min(best, !isWord(t[end]) || !isWord(k[k.length - 1]) ? 1 : 2);
    }
    at = t.indexOf(k, at + 1);
  }
  return best;
}

/** 好幾個欄位取最相符的那個 */
export const bestRank = (texts: string[], q: string) => texts.reduce((b, t) => { const r = matchRank(t, q); return r < 0 ? b : b < 0 ? r : Math.min(b, r); }, -1);

/** 照最相符排序（同一級照原本的順序）；沒找到的放最後 */
export function sortByRank<T>(items: T[], rank: (x: T) => number): T[] {
  return items.map((x, i) => ({ x, i, r: rank(x) })).sort((a, b) => (a.r < 0 ? 9 : a.r) - (b.r < 0 ? 9 : b.r) || a.i - b.i).map((y) => y.x);
}
