// 離開條目時自動整理 AI 留下的東西（R7）：
// 1. 輸入框（有修改的話是修改後的句子）跟建議翻譯一模一樣：建議翻譯刪掉
// 2. 之後這條沒有修改也沒有建議翻譯：AI 的備註算處理完了
//    雲端：作者是「AI」的留言標成已解決；本機：刪掉「AI：…」那一行，其他行都留著
import { composeNote, parseNote } from './comments';
import { compose, editsOf } from './verify';
import type { Entry } from './types';

/** AI 留言的作者名稱（雲端）；使用者編輯過的會改成編輯者的名字，就不算 AI 的了 */
export const AI_AUTHOR = 'AI';
/** 本機備註裡 AI 那一行的開頭 */
export const AI_NOTE_PREFIX = 'AI：';

/** AI 寫進本機備註的一行：換行改成空格，保證只佔一行（刪的時候才不會刪到使用者的字） */
export const aiNoteLine = (text: string) => AI_NOTE_PREFIX + text.replace(/\s*[\r\n]+\s*/g, ' ').trim();

/** 移除建議翻譯（跟 withSugg 清空時一樣：沒有修改的話，自動標的疑慮退回原本的標記） */
type DropSugg = (e: Entry) => Entry;

/** 整理後的條目；沒有要改的地方回傳原本那個物件 */
export function tidyOnLeave(e: Entry, dropSugg: DropSugg): Entry {
  let next = e;
  const shown = editsOf(e).length ? compose(e.tgt, editsOf(e)) : e.tgt;
  if (e.sugg.trim() && shown === e.sugg) next = dropSugg(next);
  if (editsOf(next).length || next.sugg.trim()) return next;
  if (next.comments) {
    if (!next.comments.some((t) => t.author === AI_AUTHOR && !t.resolved)) return next;
    const comments = next.comments.map((t) => (t.author === AI_AUTHOR && !t.resolved ? { ...t, resolved: true } : t));
    const base = next.noteBase ?? parseNote(next.note, next.comments).base;
    return { ...next, comments, noteBase: base, note: composeNote(base, comments) };
  }
  const lines = next.note.split('\n');
  const kept = lines.filter((l) => !l.startsWith(AI_NOTE_PREFIX));
  return kept.length === lines.length ? next : { ...next, note: kept.join('\n') };
}
