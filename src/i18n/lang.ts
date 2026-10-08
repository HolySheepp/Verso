// 介面語言的選擇：內建中文、English，之後加上存檔資料夾「語言」資料夾裡的語言包
import { useDictionary } from './index';

/** 內建語言：值是選單用的代號，label 用該語言自己的寫法顯示 */
export const BUILTIN_LANGS: { id: string; label: string }[] = [
  { id: 'zh', label: '中文' },
  { id: 'en', label: 'English' },
];

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

/** 套用語言：之後的 tx() 都用這個語言 */
export function applyLang(lang: string) {
  useDictionary(lang === 'en' ? 'en' : 'zh');
}
