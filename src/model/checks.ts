// 標點符號檢測與初步機器驗證（以英文譯文為準）
import type { LengthStd } from './length';
import { overflows } from './measure';

export type CheckId =
  | 'tags' | 'numbers' | 'ending' | 'fullwidth' | 'pairs'
  | 'edgeSpace' | 'doubleSpace' | 'repeatPunct' | 'cjk' | 'ellipsis'
  | 'curlyQuotes' | 'capital' | 'overflow';

export const CHECKS: { id: CheckId; label: string }[] = [
  { id: 'tags', label: '標籤與變數' },
  { id: 'numbers', label: '數字' },
  { id: 'ending', label: '句尾標點' },
  { id: 'fullwidth', label: '全形符號' },
  { id: 'pairs', label: '成對符號' },
  { id: 'edgeSpace', label: '首尾空白' },
  { id: 'doubleSpace', label: '連續空格' },
  { id: 'repeatPunct', label: '連續重複標點' },
  { id: 'cjk', label: '殘留中文' },
  { id: 'ellipsis', label: '刪節號' },
  { id: 'curlyQuotes', label: '中文引號' },
  { id: 'capital', label: '大小寫' },
  { id: 'overflow', label: '超框' },
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
const TOKEN = /\{[^{}\s]*\}|%(?:\d+\$)?[sdif]|<\/?[A-Za-z][^<>]*>|\\n/g;

const tokens = (s: string) => s.match(TOKEN) ?? [];

function countOf(list: string[]) {
  const m = new Map<string, number>();
  list.forEach((t) => m.set(t, (m.get(t) ?? 0) + 1));
  return m;
}

const ENDINGS = ['."', '—"', '?"', '!"', '~"', '♡"', '.', '—', '?', '!', '~', '♡'];

/** 句尾：指定標點，後面可以再接右括號，例如 .) */
const endsWell = (s: string) => ENDINGS.some((e) => s.endsWith(e) || s.endsWith(e + ')'));

/** 檢查一條譯文，回傳所有問題（不看開關） */
export function runChecks(src: string, tgt: string): Issue[] {
  const out: Issue[] = [];
  const add = (check: CheckId, detail: string, msg: string) => out.push({ check, key: check + ':' + detail, msg });

  // 標籤與變數：數量與內容一致
  const a = countOf(tokens(src)), b = countOf(tokens(tgt));
  for (const [t, n] of a) {
    const m = b.get(t) ?? 0;
    if (m < n) add('tags', '-' + t, `缺少 ${t}`);
  }
  for (const [t, n] of b) {
    const m = a.get(t) ?? 0;
    if (n > m) add('tags', '+' + t, `多出 ${t}`);
  }

  // 數字：原文有的數字，譯文要有（多出不報）
  const plainSrc = src.replace(TOKEN, ' '), plainTgt = tgt.replace(TOKEN, ' ');
  const nums = new Set(plainSrc.match(/\d+(?:[.,]\d+)*/g) ?? []);
  for (const n of nums) {
    const re = new RegExp('(?<![\\d.,])' + n.replace(/[.,]/g, '\\$&') + '(?![\\d]|[.,]\\d)');
    if (!re.test(plainTgt)) add('numbers', n, `缺少數字 ${n}`);
  }

  // 只有刪節號：必須剛好 6 個半形句點，可以包在引號裡
  const bare = tgt.trim();
  const dots = bare.match(/^"?(\.+)"?$/);
  if (dots && dots[1].length !== 6) add('ellipsis', String(dots[1].length), `刪節號要 6 個句點（目前 ${dots[1].length} 個）`);

  // 句尾標點
  const end = tgt.trimEnd();
  if (end && !endsWell(end)) add('ending', '', '句尾缺少標點');

  // 全形符號
  const fw = Array.from(new Set(tgt.match(/[　-〿＀-￯]/g) ?? []));
  if (fw.length) add('fullwidth', fw.join(''), '有全形符號 ' + fw.map((c) => (c === '　' ? '全形空格' : c)).join(' '));

  // 成對符號
  const cnt = (ch: string) => tgt.split(ch).length - 1;
  if (cnt('(') !== cnt(')')) add('pairs', '()', '括號 ( ) 沒有成對');
  if (cnt('[') !== cnt(']')) add('pairs', '[]', '括號 [ ] 沒有成對');
  if (cnt('"') % 2) add('pairs', '"', '引號 " 沒有成對');

  // 空白與重複標點
  if (/^\s|\s$/.test(tgt)) add('edgeSpace', '', '開頭或結尾有多餘空白');
  if (/ {2,}/.test(tgt)) add('doubleSpace', '', '有連續兩個空格');
  // 句點、驚嘆號、問號可以重複（刪節號、!!!、??）
  const rep = Array.from(new Set((tgt.match(/([,;:—\-])\1+/g) ?? [])));
  if (rep.length) add('repeatPunct', rep.join(''), '重複標點 ' + rep.join(' '));

  // 中文引號：譯文引號只能用 " 和 '
  const curly = Array.from(new Set(tgt.match(/[“”‘’]/g) ?? []));
  if (curly.length) add('curlyQuotes', curly.join(''), '有中文引號 ' + curly.join(' '));

  // 大小寫：句首、句號/問號/驚嘆號後要大寫；破折號後要小寫（I 除外）
  const firstLetter = tgt.match(/^[\s"'(\[.]*([A-Za-z])/);
  if (firstLetter && /[a-z]/.test(firstLetter[1])) add('capital', 'start', '句首要大寫');
  // 刪節號後不檢查（例如 Are you... are you mad?），只有整句以刪節號開頭時，刪節號後的字算句首
  if (/(?:^|[^.])[.?!]["')]*\s+["'(]*[a-z]/.test(tgt)) add('capital', 'sentence', '句號、問號、驚嘆號後要大寫');
  if (/—\s*["'(]*(?!I\b|I')[A-Z]/.test(tgt)) add('capital', 'dash', '破折號後要小寫');

  // 殘留中文
  if (/[㐀-䶿一-鿿]/.test(tgt)) add('cjk', '', '譯文裡有中文字');

  return out;
}

/** 依開關過濾 */
export function enabledIssues(src: string, tgt: string, settings: CheckSettings, std?: LengthStd | null): Issue[] {
  const out = runChecks(src, tgt).filter((i) => settings[i.check]);
  // 超框：用長度標準實際排版，超過行數上限就報
  if (std && settings.overflow && overflows(tgt, std)) out.push({ check: 'overflow', key: '', msg: `超框（超過 ${std.lines} 行）` });
  return out;
}
