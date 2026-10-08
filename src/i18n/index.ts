// 介面語言：程式裡只寫文字代號，用 tx('代號') 取目前語言的文字。
// 找字的順序：目前的語言 → 英文（外部語言包缺字時）→ 中文。
import { ZH } from './zh';
import { EN } from './en';

export type TextKey = keyof typeof ZH;
type Dict = Partial<Record<string, string>>;
type Vars = Record<string, string | number>;

/** 目前的語言（null 是中文）和它缺字時的備用 */
let active: Dict | null = null;
let backup: Dict = {};

/** 換語言：中文、內建英文，或外部語言包（缺字用英文補） */
export function useDictionary(lang: 'zh' | 'en' | Dict) {
  if (lang === 'zh') { active = null; backup = {}; }
  else if (lang === 'en') { active = EN; backup = {}; }
  else { active = lang; backup = EN; }
}

const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s);

/** 目前語言的文字；{名稱} 換成 vars 裡的值 */
export function tx(key: TextKey, vars?: Vars): string {
  return fill((active && (active[key] || backup[key])) || ZH[key] || key, vars);
}

/** 一定是中文的文字（寫進存檔的名稱用） */
export function tz(key: TextKey, vars?: Vars): string {
  return fill(ZH[key] || key, vars);
}
