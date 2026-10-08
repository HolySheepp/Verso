// 介面語言：程式裡只寫文字代號，用 tx('代號') 取目前語言的文字。
// 找字的順序：目前的語言 → 英文（外部語言包缺字時）→ 中文。
import { ZH } from './zh';
import { EN } from './en';

export type TextKey = keyof typeof ZH;
export type Dict = Partial<Record<string, string>>;
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

/**
 * 把 {名稱} 換成 vars 裡的值。
 * 單複數寫成 {名稱|單數|複數}：值是 1 時用單數，其他用複數，例如 {n} {n|entry|entries}。
 */
const fill = (s: string, vars?: Vars) => (vars
  ? s.replace(/\{(\w+)(?:\|([^|{}]*)\|([^|{}]*))?\}/g, (m, k: string, one?: string, many?: string) => {
    if (!(k in vars)) return m;
    if (one === undefined) return String(vars[k]);
    return Number(vars[k]) === 1 ? one : many!;
  })
  : s);

/** 字句裡的 {名稱}（含單複數寫法裡的名稱） */
export const placeholders = (s: string) => new Set(Array.from(s.matchAll(/\{(\w+)(?:\|[^|{}]*\|[^|{}]*)?\}/g), (m) => m[1]));

/** 字典裡有這個代號（空字串也算有：有些語言某段本來就不需要字） */
const pick = (d: Dict | null, key: string) => (d && d[key] !== undefined ? d[key] : undefined);

/** 目前語言的文字；{名稱} 換成 vars 裡的值 */
export function tx(key: TextKey, vars?: Vars): string {
  return fill(pick(active, key) ?? pick(backup, key) ?? ZH[key] ?? key, vars);
}

/** 一定是中文的文字（寫進存檔的名稱用） */
export function tz(key: TextKey, vars?: Vars): string {
  return fill(ZH[key] || key, vars);
}

/** 句子裡夾著輸入框之類的元件時：用 {input} 切成前後兩段 */
export function txSplit(key: TextKey, vars?: Vars): [string, string] {
  const s = tx(key, vars);
  const i = s.indexOf('{input}');
  return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + '{input}'.length)];
}

/**
 * 外部語言包的內容（代號 → 譯文）整理成可用的字典：
 * 不認得的代號、空白的譯文、少了中文原句裡 {名稱} 的譯文都不收，這些代號會用英文、再用中文補。
 */
export function cleanPack(pairs: [string, string][]): Dict {
  const out: Dict = {};
  for (const [key, value] of pairs) {
    const zh = (ZH as Record<string, string>)[key];
    if (zh === undefined || !value.trim()) continue;
    const need = placeholders(zh), have = placeholders(value);
    if ([...need].some((n) => !have.has(n))) continue;
    out[key] = value;
  }
  return out;
}
