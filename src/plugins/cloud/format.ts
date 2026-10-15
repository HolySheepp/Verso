// 寫回 Google 表的樣子：
// - 譯文欄：有修改時，被改掉的字加刪除線（藍色），空一格後用藍色寫新的字；
//   整句直接改時，同一格空兩行，用藍色寫「-」接改好的整句；
//   有建議翻譯時，同一格空兩行，用藍色寫「Suggestion:」，換行再用藍色寫建議的翻譯
// - 備註欄：驗證時新加的備註用藍色（blueFrom 起）
import { compose, editsOf } from '../../model/verify';
import { wholeChanged } from '../../model/verifyCopy';
import type { CustomMark, Entry, StoredMark } from '../../model/types';
import type { Rich } from './api';

const WORD = /[\p{L}\p{N}]/u;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const needSpace = (a: string, b: string) => {
  const x = a[a.length - 1] ?? '', y = b[0] ?? '';
  return WORD.test(x) && WORD.test(y) && !CJK.test(x) && !CJK.test(y);
};

type Kind = 'p' | 'b' | 's';
function build(parts: [string, Kind][]): Rich {
  let text = '';
  const runs: Rich['runs'] = [];
  let last: Kind | null = null;
  for (const [t, k] of parts) {
    if (!t) continue;
    if (k !== last) { runs.push({ start: text.length, ...(k === 's' ? { strike: true } : {}), ...(k === 'b' ? { blue: true } : {}) }); last = k; }
    text += t;
  }
  // 全部都是一般文字：不用格式
  return runs.every((r) => !r.strike && !r.blue) ? { text, runs: [] } : { text, runs };
}

/** 譯文欄要寫的內容；沒有修改和建議翻譯時就是譯文本身 */
export function tgtCell(e: Entry): Rich {
  const edits = editsOf(e);
  const sugg = e.sugg.trim() ? e.sugg : '';
  if (!edits.length && !sugg) return { text: e.tgt, runs: [] };
  const parts: [string, Kind][] = [];
  if (edits.length && wholeChanged(e.tgt, edits)) {
    // 整句改：原句不動，空兩行用藍色寫「-」接改好的整句
    parts.push([e.tgt, 'p']);
    parts.push(['\n\n', 'p']);
    parts.push(['-' + compose(e.tgt, edits), 'b']);
  } else if (edits.length) {
    let at = 0;
    for (const d of [...edits].sort((a, b) => a.s - b.s)) {
      parts.push([e.tgt.slice(at, d.s), 'p']);
      const old = e.tgt.slice(d.s, d.e);
      if (old) parts.push([old, 's']);
      if (old && d.t && needSpace(old, d.t)) parts.push([' ', 'p']);
      if (d.t) parts.push([d.t, 'b']);
      at = d.e;
    }
    parts.push([e.tgt.slice(at), 'p']);
  } else parts.push([e.tgt, 'p']);
  if (sugg) {
    parts.push(['\n\n', 'p']);
    parts.push(['Suggestion:\n' + sugg, 'b']);
  }
  return build(parts);
}

/**
 * 從 Google 讀到的譯文欄去掉 Verso 寫的驗證標示，還原成原本的譯文：
 * 藍字（新字、「-」整句、Suggestion）拿掉，刪除線的字留著，
 * 新字前面補的空格、整句和 Suggestion 前面的空行也拿掉
 */
export function stripMarkup(r: Rich): string {
  if (!r.runs.some((x) => x.strike || x.blue)) return r.text;
  const segs: { t: string; k: Kind }[] = [];
  const first = r.runs[0]?.start ?? 0;
  if (first > 0) segs.push({ t: r.text.slice(0, first), k: 'p' });
  r.runs.forEach((x, i) => segs.push({ t: r.text.slice(x.start, r.runs[i + 1]?.start ?? r.text.length), k: x.strike ? 's' : x.blue ? 'b' : 'p' }));
  let out = '';
  segs.forEach((s, i) => {
    if (s.k === 'b') return;
    let t = s.t;
    const next = segs[i + 1];
    if (s.k === 'p' && next?.k === 'b') {
      if (/^(-|Suggestion:)/.test(next.t)) t = t.replace(/\n\n$/, '');
      else if (segs[i - 1]?.k === 's' && t === ' ') t = '';
    }
    out += t;
  });
  return out;
}

/** 備註欄要寫的內容：blueFrom 以後是藍色 */
export function noteCell(note: string, blueFrom?: number): Rich {
  if (blueFrom === undefined || blueFrom >= note.length) return { text: note, runs: [] };
  return build([[note.slice(0, blueFrom), 'p'], [note.slice(blueFrom), 'b']]);
}

/** 驗證時改了備註：藍色從哪裡開始（原本的內容不動，後面加的才是藍色） */
export function blueStart(before: string, after: string, old?: number): number | undefined {
  if (old !== undefined && old <= after.length && after.startsWith(before.slice(0, old))) return old;
  let i = 0;
  while (i < before.length && i < after.length && before[i] === after[i]) i++;
  return i < after.length ? i : old;
}

/** 格式的比對用 */
export const richSig = (r: Rich) => JSON.stringify(r);

/** 標記寫進資料表：內建標記用代號，自訂標記用「#名稱」（每台電腦的自訂標記編號不一樣） */
export function markToText(e: Entry, customs: CustomMark[]): string {
  if (e.mark.startsWith('c:')) { const c = customs.find((x) => 'c:' + x.id === e.mark); return c ? '#' + c.name : ''; }
  if (!e.mark && e.keptMark?.startsWith('#')) return e.keptMark;
  return e.mark;
}

const BUILTIN = new Set(['verified', 'doubt', 'think', 'ignore', 'ai']);
export function textToMark(t: string, customs: CustomMark[]): { mark: StoredMark; keptMark?: string } {
  if (BUILTIN.has(t)) return { mark: t as StoredMark };
  if (t.startsWith('#')) {
    const c = customs.find((x) => x.name === t.slice(1));
    // 這台電腦沒有這個自訂標記：記著，寫回時照樣寫
    return c ? { mark: `c:${c.id}` } : { mark: '', keptMark: t };
  }
  return { mark: '' };
}
