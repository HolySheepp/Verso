// 介面語言的選擇：內建中文、English，加上存檔資料夾「語言」資料夾裡的語言包
import { cleanPack, useDictionary, type Dict } from './index';

/** 內建語言：值是選單用的代號，label 用該語言自己的寫法顯示 */
export const BUILTIN_LANGS: { id: string; label: string }[] = [
  { id: 'zh', label: '中文' },
  { id: 'en', label: 'English' },
];

/** 外部語言包在選單裡的代號：pack:檔名 */
export const PACK = 'pack:';

/** 已讀到的外部語言包：檔名 → 整理過的字典（讀不了的是空字典，全部用英文補） */
let packs = new Map<string, Dict>();

/** 換上新讀到的語言包；回傳 lang 這個語言的內容有沒有變 */
export function setPacks(found: Map<string, [string, string][] | null>, lang: string): boolean {
  const before = lang.startsWith(PACK) ? JSON.stringify(packs.get(lang.slice(PACK.length)) ?? null) : '';
  packs = new Map([...found].map(([name, pairs]) => [name, pairs ? cleanPack(pairs) : {}]));
  const after = lang.startsWith(PACK) ? JSON.stringify(packs.get(lang.slice(PACK.length)) ?? null) : '';
  return before !== after;
}

/** 第一次開啟時跟 Windows（系統）語言：中文系統用中文，其他用英文 */
export function systemLang(): string {
  const l = (typeof navigator !== 'undefined' && (navigator.languages?.[0] || navigator.language)) || '';
  return l.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/** 上次用的語言（啟動畫面還沒讀到設定前就要用）；沒有就跟系統 */
export function bootLang(): string {
  try {
    const v = JSON.parse(localStorage.getItem('verso-boot') || '{}').lang;
    if (typeof v === 'string' && v) return v;
  } catch { /* 沒有記錄 */ }
  return systemLang();
}

/** 套用語言：之後的 tx() 都用這個語言。語言包還沒讀到、或已經不在了，就用英文 */
export function applyLang(lang: string) {
  if (lang === 'zh') useDictionary('zh');
  else if (lang.startsWith(PACK)) useDictionary(packs.get(lang.slice(PACK.length)) ?? {});
  else useDictionary('en');
}
