import { tx } from '../i18n';
import type { BuiltinMarkId, CustomMark, Entry, MarkId, StoredMark, SymbolId } from './types';

export const BUILTIN_MARKS: { id: BuiltinMarkId; label: string; desc: string }[] = [
  { id: 'untranslated', get label() { return tx('mark.001'); }, get desc() { return tx('mark.002'); } },
  { id: 'translated', get label() { return tx('mark.003'); }, get desc() { return tx('mark.004'); } },
  { id: 'verified', get label() { return tx('mark.005'); }, get desc() { return tx('mark.006'); } },
  { id: 'doubt', get label() { return tx('mark.007'); }, get desc() { return tx('mark.008'); } },
  { id: 'think', get label() { return tx('mark.009'); }, get desc() { return tx('mark.010'); } },
  { id: 'ignore', get label() { return tx('mark.011'); }, get desc() { return tx('mark.012'); } },
];

export const SYMBOLS: { id: SymbolId; label: string }[] = [
  { id: 'star', get label() { return tx('mark.013'); } }, { id: 'heart', get label() { return tx('mark.014'); } }, { id: 'diamond', get label() { return tx('mark.015'); } },
  { id: 'square', get label() { return tx('mark.016'); } }, { id: 'bolt', get label() { return tx('mark.017'); } }, { id: 'bookmark', get label() { return tx('mark.018'); } },
  { id: 'bell', get label() { return tx('mark.019'); } }, { id: 'eye', get label() { return tx('mark.020'); } }, { id: 'chat', get label() { return tx('mark.021'); } },
  { id: 'pin', get label() { return tx('mark.022'); } }, { id: 'hash', get label() { return tx('mark.023'); } }, { id: 'question', get label() { return tx('mark.024'); } },
];

/** 自訂標記的顏色設成這個值時跟隨主題色 */
export const ACCENT_COLOR = 'accent';
/** 標記顏色實際畫出來的 CSS 顏色 */
export const markColorCss = (c: string) => (c === ACCENT_COLOR ? 'var(--accent)' : c);

export const MARK_COLORS: { hex: string; label: string }[] = [
  { hex: ACCENT_COLOR, get label() { return tx('mark.025'); } },
  { hex: '#4fb3a9', get label() { return tx('mark.026'); } }, { hex: '#b48cf2', get label() { return tx('mark.027'); } }, { hex: '#ec8a6a', get label() { return tx('mark.028'); } },
  { hex: '#7cc47a', get label() { return tx('mark.029'); } }, { hex: '#e27aa8', get label() { return tx('mark.030'); } }, { hex: '#9aa1ae', get label() { return tx('mark.031'); } },
];

/** MarkIcon 畫圖用的描述 */
export type MarkVisual =
  | { kind: BuiltinMarkId }
  | { kind: 'sym'; sym: SymbolId; color: string }
  | { kind: 'text'; text: string; color: string };

type MarkFields = Pick<Entry, 'mark' | 'tgt'> & { pending?: boolean; src?: string; upd?: Entry['upd'] };

/** 有譯文、且不是待確認，才算已翻譯；原文和譯文都空白的條目沒有東西要翻，也算已翻譯 */
export function isTranslated(e: MarkFields): boolean {
  if (e.src !== undefined && !e.src.trim() && !e.tgt.trim()) return true;
  return !!e.tgt && !e.pending;
}

/** 條目實際顯示的標記：刻意標記優先，否則看是否已翻譯 */
export function effectiveMark(e: MarkFields): MarkId {
  // 原文更新優先顯示，清掉後原本的標記才出現
  if (e.upd && !e.upd.hidden) return 'srcupd';
  return e.mark || (isTranslated(e) ? 'translated' : 'untranslated');
}

/** 把選單選到的標記轉成要存的值：已翻譯／未翻譯不存 */
export function toStoredMark(id: MarkId): StoredMark {
  return id === 'translated' || id === 'untranslated' || id === 'srcupd' ? '' : id;
}

/** 算進度用：已翻譯或被忽略就算完成 */
export function isDone(e: MarkFields): boolean {
  return isTranslated(e) || e.mark === 'ignore';
}

export function findCustom(customs: CustomMark[], id: MarkId): CustomMark | undefined {
  if (!id.startsWith('c:')) return undefined;
  return customs.find((c) => 'c:' + c.id === id);
}

export function markVisual(customs: CustomMark[], id: MarkId): MarkVisual {
  if (id.startsWith('c:')) {
    const c = findCustom(customs, id);
    if (!c) return { kind: 'translated' };
    return c.kind === 'sym' ? { kind: 'sym', sym: c.sym, color: c.color } : { kind: 'text', text: c.text, color: c.color };
  }
  return { kind: id as BuiltinMarkId };
}

export function markName(customs: CustomMark[], id: MarkId): string {
  if (id.startsWith('c:')) return findCustom(customs, id)?.name ?? tx('mark.003');
  if (id === 'srcupd') return tx('mark.032');
  return BUILTIN_MARKS.find((b) => b.id === id)?.label ?? id;
}

/** 自訂文字標記的限制：英文最多 2 個字母、中日韓最多 1 字，或 1 個 emoji */
export function checkMarkText(v: string): { ok: boolean; msg: string } {
  if (!v) return { ok: false, msg: '' };
  if (/^[A-Za-z]{1,2}$/.test(v)) return { ok: true, msg: '' };
  if (/^[A-Za-z]+$/.test(v)) return { ok: false, msg: tx('mark.033') };
  const chars = Array.from(v);
  const cjk = /[ᄀ-ᇿ぀-ヿ㄰-㆏㐀-䶿一-鿿가-힯豈-﫿]/;
  if (chars.every((ch) => cjk.test(ch))) {
    return chars.length === 1 ? { ok: true, msg: '' } : { ok: false, msg: tx('mark.034') };
  }
  const n = typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? Array.from(new Intl.Segmenter().segment(v)).length
    : chars.length;
  if (n === 1 && /\p{Extended_Pictographic}/u.test(v)) return { ok: true, msg: '' };
  return { ok: false, msg: tx('mark.035') };
}
