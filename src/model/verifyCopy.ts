// 驗證模式複製譯文欄：把修改和建議翻譯用藍色標出來，貼到 Google Sheets
import { escapeHtml, type RichCell } from './clipboard';
import { compose, editsOf } from './verify';
import type { Entry } from './types';

const BLUE = '#1155cc';
const br = (s: string) => escapeHtml(s).replace(/\n/g, '<br>');
const blue = (s: string) => `<span style="font-weight:normal;font-style:normal;color:${BLUE};">${br(s)}</span>`;
const struck = (s: string) => `<span style="font-weight:normal;font-style:normal;text-decoration:line-through;color:${BLUE};">${br(s)}</span>`;
const WORD = /[\p{L}\p{N}]/u;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** 整句改：譯文裡每個字（不算空白和標點）都落在某組修改裡 */
export function wholeChanged(tgt: string, edits: { s: number; e: number }[]): boolean {
  let any = false;
  for (let i = 0; i < tgt.length; i++) {
    if (!WORD.test(tgt[i])) continue;
    any = true;
    if (!edits.some((d) => d.s <= i && i < d.e)) return false;
  }
  return any;
}

/** 刪掉的字和新字之間要不要空一格（兩邊都是英文之類的字才空） */
const needSpace = (a: string, b: string) => {
  const x = a[a.length - 1] ?? '', y = b[0] ?? '';
  return WORD.test(x) && WORD.test(y) && !CJK.test(x) && !CJK.test(y);
};

/** 一條的輸出：沒有修改和建議翻譯時照原樣 */
export function verifyCell(e: Entry): string | RichCell {
  const edits = editsOf(e);
  if (!edits.length && !e.sugg) return e.tgt;
  const mod = compose(e.tgt, edits);
  let html = '';
  let text = mod;
  if (!edits.length) html = br(e.tgt);
  else if (wholeChanged(e.tgt, edits)) {
    // 情況二：整句改，原句不動，換行寫新句子
    html = br(e.tgt) + '<br>' + blue(mod);
  } else {
    // 情況一：部分修改，被改掉的字加刪除線，後面接新字
    let at = 0;
    for (const d of [...edits].sort((a, b) => a.s - b.s)) {
      html += br(e.tgt.slice(at, d.s));
      const old = e.tgt.slice(d.s, d.e);
      if (old) html += struck(old);
      if (old && d.t && needSpace(old, d.t)) html += ' ';
      if (d.t) html += blue(d.t);
      at = d.e;
    }
    html += br(e.tgt.slice(at));
  }
  if (e.sugg) {
    // 情況三：有建議翻譯
    html += '<br>' + blue('Suggestion:') + '<br>' + blue(e.sugg);
    text += '\nSuggestion:\n' + e.sugg;
  }
  return { html, text };
}
