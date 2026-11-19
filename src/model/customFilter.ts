// 條目篩選器的自訂條件：選一欄、一個條件、（需要的話）要比對的內容，取一個名字。
// 每個頁簽自己的；雲端檔案記在 Verso 資料表跟同事共享，本機檔案記在自己的電腦。
import type { Entry } from './types';

export type FilterOp = 'blank' | 'contains' | 'word' | 'starts' | 'ends' | 'exact' | 'gt' | 'eq';
export const FILTER_OPS: FilterOp[] = ['blank', 'contains', 'word', 'starts', 'ends', 'exact', 'gt', 'eq'];

export interface CustomFilter {
  id: string;
  name: string;
  /** 比對哪一欄：id、speaker、src、tgt、note，或另外抓的欄（x:名稱） */
  col: string;
  op: FilterOp;
  value: string;
}

export const newFilterId = () => 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
/** 篩選條件在篩選器裡的名字（跟標記分開） */
export const filterKey = (id: string) => 'u:' + id;

/** 這一欄的文字 */
function colText(e: Entry, col: string): string {
  if (col === 'id') return e.id;
  if (col === 'speaker') return e.speaker;
  if (col === 'src') return e.upd?.src ?? e.src;
  if (col === 'tgt') return e.tgt;
  if (col === 'note') return e.note;
  if (col.startsWith('x:')) return e.extraNotes?.find((n) => n.name === col.slice(2))?.text ?? '';
  return '';
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** 數字（去掉千分位逗號）；不是數字是 NaN */
const num = (s: string) => Number(s.replace(/,/g, '').trim() || NaN);

/** 條目符不符合這個條件（大小寫不分） */
export function matchFilter(e: Entry, f: CustomFilter): boolean {
  const text = colText(e, f.col);
  const t = text.toLowerCase(), v = f.value.toLowerCase();
  switch (f.op) {
    case 'blank': return !text.trim();
    case 'contains': return !!v && t.includes(v);
    case 'word': {
      if (!v) return false;
      // 要找的內容沒有可以分出單詞的字（例如中文）：跟「包含」一樣
      if (!/[\p{L}\p{N}]/u.test(v) || /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(v)) return t.includes(v);
      return new RegExp(`(?<![\\p{L}\\p{N}_])${esc(v)}(?![\\p{L}\\p{N}_])`, 'u').test(t);
    }
    case 'starts': return !!v && t.trimStart().startsWith(v);
    case 'ends': return !!v && t.trimEnd().endsWith(v);
    case 'exact': return t.trim() === v.trim();
    case 'gt': { const a = num(text), b = num(f.value); return !Number.isNaN(a) && !Number.isNaN(b) && a > b; }
    case 'eq': { const a = num(text), b = num(f.value); return !Number.isNaN(a) && !Number.isNaN(b) ? a === b : t.trim() === v.trim(); }
  }
}

/** 條目符合的自訂條件（篩選器的名字） */
export const matchedKeys = (e: Entry, list: CustomFilter[]) => list.filter((f) => matchFilter(e, f)).map((f) => filterKey(f.id));
