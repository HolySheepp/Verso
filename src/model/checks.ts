// 標點符號檢測與初步機器驗證（以英文譯文為準）
import { tx } from '../i18n';
import type { LengthStd } from './length';
import { overflows } from './measure';

export type CheckId =
  | 'tags' | 'numbers' | 'ending' | 'fullwidth' | 'pairs'
  | 'edgeSpace' | 'doubleSpace' | 'repeatPunct' | 'cjk' | 'ellipsis'
  | 'curlyQuotes' | 'capital' | 'overflow';

export const CHECKS: { id: CheckId; label: string }[] = [
  { id: 'tags', get label() { return tx('check.001'); } },
  { id: 'numbers', get label() { return tx('check.002'); } },
  { id: 'ending', get label() { return tx('check.003'); } },
  { id: 'fullwidth', get label() { return tx('check.004'); } },
  { id: 'pairs', get label() { return tx('check.005'); } },
  { id: 'edgeSpace', get label() { return tx('check.006'); } },
  { id: 'doubleSpace', get label() { return tx('check.007'); } },
  { id: 'repeatPunct', get label() { return tx('check.008'); } },
  { id: 'cjk', get label() { return tx('check.009'); } },
  { id: 'ellipsis', get label() { return tx('check.010'); } },
  { id: 'curlyQuotes', get label() { return tx('check.011'); } },
  { id: 'capital', get label() { return tx('check.012'); } },
  { id: 'overflow', get label() { return tx('check.013'); } },
];

export type CheckSettings = Record<CheckId, boolean>;

export const defaultCheckSettings = (): CheckSettings =>
  Object.fromEntries(CHECKS.map((c) => [c.id, true])) as CheckSettings;

export interface Issue {
  check: CheckId;
  /** 同一個問題的識別字串，用來判斷問題是否已經改掉 */
  key: string;
  msg: string;
}

/** {0}、{name}、%s、%1$s、<color=#fff>、</color>、字面的 \n */
// 標籤、變數：{name}、printf 格式（%s、%5.2f、%1$d…；%% 是百分號本身）、<b>／<color=#fff>、字面的 \n。
// 標籤名稱後面直接接中文或空白的不算標籤（例如「<這>」「< 3」）。
const TOKEN_SRC = String.raw`\{[^{}\s]*\}|%%|%(?:\d+\$)?[-+0#]*\d*(?:\.\d+)?[sdifcxXeEgG]|<\/?[A-Za-z][\w-]*(?:=[^<>\s]+)?\/?>|\\n`;
const TOKEN = new RegExp(TOKEN_SRC, 'g');

const tokens = (s: string) => (s.match(TOKEN) ?? []).filter((t) => t !== '%%');

function countOf(list: string[]) {
  const m = new Map<string, number>();
  list.forEach((t) => m.set(t, (m.get(t) ?? 0) + 1));
  return m;
}

const ENDINGS = ['."', '—"', '?"', '!"', '~"', '♡"', '.', '—', '?', '!', '~', '♡'];

/** 句尾：指定標點，後面可以再接右括號，例如 .) */
const endsWell = (s: string) => ENDINGS.some((e) => s.endsWith(e) || s.endsWith(e + ')'));

// 句首、句尾的判斷先拿掉前後的標籤、變數、字面的 \n（例如 Hello.<br> 或 {name} hello）
const EDGE_TOKEN = `(?:${TOKEN_SRC}|\\s)+`;
const TRAIL = new RegExp(EDGE_TOKEN + '$');
const LEAD = new RegExp('^' + EDGE_TOKEN);
/** 句尾要看的部分：去掉結尾的標籤；還是沒有標點時，再去掉最後的引號看一次 */
const trimEnd = (s: string) => {
  const t = s.replace(TRAIL, '');
  if (endsWell(t)) return t;
  return t.replace(/["'”’]+$/, '').replace(TRAIL, '');
};

/** 檢查一條譯文，回傳所有問題（不看開關） */
export function runChecks(src: string, tgt: string): Issue[] {
  const out: Issue[] = [];
  const add = (check: CheckId, detail: string, msg: string) => out.push({ check, key: check + ':' + detail, msg });

  // 標籤與變數：數量與內容一致
  const a = countOf(tokens(src)), b = countOf(tokens(tgt));
  for (const [t, n] of a) {
    const m = b.get(t) ?? 0;
    if (m < n) add('tags', '-' + t, tx('check.014', { t }));
  }
  for (const [t, n] of b) {
    const m = a.get(t) ?? 0;
    if (n > m) add('tags', '+' + t, tx('check.015', { t }));
  }

  // 數字：原文有的數字，譯文要有（多出不報）
  const plainSrc = src.replace(TOKEN, ' '), plainTgt = tgt.replace(TOKEN, ' ');
  const nums = new Set(plainSrc.match(/\d+(?:[.,]\d+)*/g) ?? []);
  for (const n of nums) {
    const re = new RegExp('(?<![\\d.,])' + n.replace(/[.,]/g, '\\$&') + '(?![\\d]|[.,]\\d)');
    if (!re.test(plainTgt)) add('numbers', n, tx('check.016', { n }));
  }

  // 只有刪節號：必須剛好 6 個半形句點，可以包在引號裡
  const bare = tgt.trim();
  const dots = bare.match(/^"?(\.+)"?$/);
  if (dots && dots[1].length !== 6) add('ellipsis', String(dots[1].length), tx('check.017', { length: dots[1].length }));

  // 句尾標點
  const end = trimEnd(tgt);
  if (end && !endsWell(end)) add('ending', '', tx('check.018'));

  // 全形符號
  const fw = Array.from(new Set(tgt.match(/[　-〿＀-￯…‥]/g) ?? []));
  if (fw.length) add('fullwidth', fw.join(''), tx('check.019', { v1: fw.map((c) => (c === '　' ? tx('check.fullwidthSpace') : c)).join(' ') }));

  // 成對符號
  const cnt = (ch: string) => tgt.split(ch).length - 1;
  if (cnt('(') !== cnt(')')) add('pairs', '()', tx('check.020'));
  if (cnt('[') !== cnt(']')) add('pairs', '[]', tx('check.021'));
  if (cnt('"') % 2) add('pairs', '"', tx('check.022'));

  // 空白與重複標點
  if (/^\s|\s$/.test(tgt)) add('edgeSpace', '', tx('check.023'));
  if (/ {2,}/.test(tgt)) add('doubleSpace', '', tx('check.024'));
  // 驚嘆號、問號可以重複（!!!、??）。句點：整句只有句點時看刪節號的規則；
  // 句子有其他內容時，句點只能是 1 個（句點）或 3 個（刪節號），其他數量都算重複標點
  const rep = Array.from(new Set([...(tgt.match(/([,;:—\-])\1+/g) ?? []), ...(dots ? [] : badDots(tgt).map((m) => m.text))]));
  if (rep.length) add('repeatPunct', rep.join(''), tx('check.025', { v1: rep.join(' ') }));

  // 中文引號：譯文引號只能用 " 和 '
  const curly = Array.from(new Set(tgt.match(/[“”‘’]/g) ?? []));
  if (curly.length) add('curlyQuotes', curly.join(''), tx('check.026', { v1: curly.join(' ') }));

  // 大小寫：句首、句號/問號/驚嘆號後要大寫；破折號後要小寫（I 除外）
  const firstLetter = tgt.replace(LEAD, '').match(/^[\s"'(\[.]*([A-Za-z])/);
  if (firstLetter && /[a-z]/.test(firstLetter[1])) add('capital', 'start', tx('check.027'));
  // 刪節號後不檢查（例如 Are you... are you mad?），只有整句以刪節號開頭時，刪節號後的字算句首
  if (/(?:^|[^.])[.?!]["')]*\s+["'(]*[a-z]/.test(tgt)) add('capital', 'sentence', tx('check.028'));
  if (dashCapitals(tgt).length) add('capital', 'dash', tx('check.029'));

  // 殘留中文
  if (/[㐀-䶿一-鿿]/.test(tgt)) add('cjk', '', tx('check.030'));

  return out;
}

/**
 * 破折號後的大寫字母位置（I 除外）。
 * 破折號在句子開頭時（整段開頭，或句號、問號、驚嘆號之後），後面本來就是句首，大寫不算錯。
 */
function dashCapitals(tgt: string): number[] {
  const out: number[] = [];
  for (const m of tgt.matchAll(/—\s*["'(]*(?!I\b|I')([A-Z])/g)) {
    const before = tgt.slice(0, m.index).replace(/[\s"'(\[]+$/, '');
    if (before === '' || /[.?!]["')\]]*$/.test(before)) continue;
    out.push(m.index! + m[0].length - 1);
  }
  return out;
}

/** 依開關過濾 */
export function enabledIssues(src: string, tgt: string, settings: CheckSettings, std?: LengthStd | null): Issue[] {
  const out = runChecks(src, tgt).filter((i) => settings[i.check]);
  // 超框：用長度標準實際排版，超過行數上限就報
  if (std && settings.overflow && overflows(tgt, std)) out.push({ check: 'overflow', key: '', msg: tx('check.031', { lines: std.lines }) });
  return out;
}

/** 句子有句點以外的內容時，數量不是 1 或 3 的連續句點 */
function badDots(tgt: string): { text: string; index: number }[] {
  return [...tgt.matchAll(/\.{2,}/g)].filter((m) => m[0].length !== 3).map((m) => ({ text: m[0], index: m.index! }));
}

/**
 * 問題在譯文裡的位置（給譯文框標色用）。
 * 缺數字、缺標籤、句尾缺標點、成對符號、超框這類沒有具體位置的問題不標。
 */
export function locateIssues(tgt: string, checks: Set<CheckId>): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const all = (re: RegExp) => { for (const m of tgt.matchAll(re)) out.push({ start: m.index!, end: m.index! + m[0].length }); };
  if (checks.has('fullwidth')) all(/[　-〿＀-￯…‥]/g);
  if (checks.has('doubleSpace')) all(/ {2,}/g);
  if (checks.has('edgeSpace')) all(/^\s+|\s+$/g);
  if (checks.has('repeatPunct')) {
    all(/([,;:—-])\1+/g);
    if (!/^"?\.+"?$/.test(tgt.trim())) for (const m of badDots(tgt)) out.push({ start: m.index, end: m.index + m.text.length });
  }
  if (checks.has('curlyQuotes')) all(/[“”‘’]/g);
  if (checks.has('cjk')) all(/[㐀-䶿一-鿿]+/g);
  if (checks.has('ellipsis')) { const m = tgt.match(/\.+/); if (m && /^"?\.+"?$/.test(tgt.trim())) out.push({ start: m.index!, end: m.index! + m[0].length }); }
  if (checks.has('capital')) {
    // 句首小寫、句號問號驚嘆號後小寫、破折號後大寫：標出那個字母
    const first = tgt.match(/^[\s"'(\[.]*([a-z])/);
    if (first) { const i = first[0].length - 1; out.push({ start: i, end: i + 1 }); }
    for (const m of tgt.matchAll(/(?:^|[^.])[.?!]["')]*\s+["'(]*([a-z])/g)) { const i = m.index! + m[0].length - 1; out.push({ start: i, end: i + 1 }); }
    for (const i of dashCapitals(tgt)) out.push({ start: i, end: i + 1 });
  }
  return out;
}
