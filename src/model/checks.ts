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

/**
 * 整句只有刪節號時的句點：頭尾的標籤、變數、括號、引號、空白先拿掉再看，例如 <i>......</i>、(......)。
 * 不是只有句點時回傳 null；start 是句點在原字串裡的位置。
 */
export function onlyDots(tgt: string): { dots: string; start: number } | null {
  // 先粗篩：拿掉標籤後只剩句點、括號、引號、空白才細看
  if (!tgt.includes('.') || !/^[\s"'()[\]（）［］【】「」『』〔〕〈〉《》.]*$/.test(tgt.replace(TOKEN, ''))) return null;
  let a = 0, b = tgt.length;
  const tokenAt = (from: number) => { const re = new RegExp(TOKEN_SRC, 'y'); re.lastIndex = from; const m = re.exec(tgt); return m && m.index + m[0].length <= b ? m[0].length : 0; };
  for (let moved = true; moved && a < b;) {
    moved = false;
    if (/[\s"'(\[（［【「『〔〈《]/.test(tgt[a])) { a++; moved = true; continue; }
    const t = tokenAt(a);
    if (t) { a += t; moved = true; continue; }
    if (/[\s"')\]）］】」』〕〉》]/.test(tgt[b - 1])) { b--; moved = true; continue; }
    // 結尾的標籤：找最後一個剛好在 b 結束的
    for (const m of tgt.slice(a, b).matchAll(TOKEN)) {
      if (a + m.index! + m[0].length === b) { b = a + m.index!; moved = true; break; }
    }
  }
  const core = tgt.slice(a, b);
  return /^\.+$/.test(core) ? { dots: core, start: a } : null;
}

const ENDINGS = ['."', '—"', '?"', '!"', '~"', '♡"', '.', '—', '?', '!', '~', '♡'];

/** 句尾：指定標點，後面可以再接右括號，例如 .) */
const endsWell = (s: string) => ENDINGS.some((e) => s.endsWith(e) || s.endsWith(e + ')'));

// 句首、句尾的判斷先拿掉前後的標籤、變數、字面的 \n（例如 Hello.<br> 或 {name} hello）
const EDGE_TOKEN = `(?:${TOKEN_SRC}|\\s)+`;
const LEAD = new RegExp('^' + EDGE_TOKEN);
/** 去掉結尾連續的標籤、變數、空白：從尾巴往回掃（用 (?:標籤|空白)+$ 比對，遇到一長串空白或標籤會大量回溯而凍住） */
const stripTail = (s: string) => {
  const endAt = new Map<number, number>();
  for (const m of s.matchAll(TOKEN)) endAt.set(m.index! + m[0].length, m.index!);
  let pos = s.length;
  for (;;) {
    if (pos > 0 && /\s/.test(s[pos - 1])) { pos--; continue; }
    const st = endAt.get(pos);
    if (st === undefined) break;
    pos = st;
  }
  return s.slice(0, pos);
};
/** 句尾要看的部分：去掉結尾的標籤；還是沒有標點時，再去掉最後的引號看一次 */
const trimEnd = (s: string) => {
  const t = stripTail(s);
  if (endsWell(t)) return t;
  return stripTail(t.replace(/["'”’]+$/, ''));
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

  // 只有刪節號：必須剛好 6 個半形句點，可以包在引號、括號、標籤裡
  const dots = onlyDots(tgt);
  if (dots && dots.dots.length !== 6) add('ellipsis', String(dots.dots.length), tx('check.017', { length: dots.dots.length }));

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
    if (!onlyDots(tgt)) for (const m of badDots(tgt)) out.push({ start: m.index, end: m.index + m.text.length });
  }
  if (checks.has('curlyQuotes')) all(/[“”‘’]/g);
  if (checks.has('cjk')) all(/[㐀-䶿一-鿿]+/g);
  if (checks.has('ellipsis')) { const d = onlyDots(tgt); if (d && d.dots.length !== 6) out.push({ start: d.start, end: d.start + d.dots.length }); }
  if (checks.has('capital')) {
    // 句首小寫、句號問號驚嘆號後小寫、破折號後大寫：標出那個字母
    // 判斷時先去掉開頭的標籤、變數（LEAD），標色的位置要加回去
    const lead = tgt.match(LEAD)?.[0].length ?? 0;
    const first = tgt.slice(lead).match(/^[\s"'(\[.]*([a-z])/);
    if (first) { const i = lead + first[0].length - 1; out.push({ start: i, end: i + 1 }); }
    for (const m of tgt.matchAll(/(?:^|[^.])[.?!]["')]*\s+["'(]*([a-z])/g)) { const i = m.index! + m[0].length - 1; out.push({ start: i, end: i + 1 }); }
    for (const i of dashCapitals(tgt)) out.push({ start: i, end: i + 1 });
  }
  return out;
}
