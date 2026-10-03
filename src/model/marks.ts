import type { BuiltinMarkId, CustomMark, Entry, MarkId, StoredMark, SymbolId } from './types';

export const BUILTIN_MARKS: { id: BuiltinMarkId; label: string; desc: string }[] = [
  { id: 'untranslated', label: '未翻譯', desc: '灰色小點' },
  { id: 'translated', label: '已翻譯', desc: '條目不顯示標記' },
  { id: 'verified', label: '已驗證', desc: '不顯示標記，條目文字轉灰' },
  { id: 'doubt', label: '疑慮', desc: '黃色驚嘆號，條目底色轉黃' },
  { id: 'think', label: '待思考', desc: '之後再回來想這句' },
  { id: 'ignore', label: '忽略', desc: '不需翻譯，不計入未翻譯' },
];

export const SYMBOLS: { id: SymbolId; label: string }[] = [
  { id: 'star', label: '星形' }, { id: 'heart', label: '愛心' }, { id: 'diamond', label: '菱形' },
  { id: 'square', label: '方塊' }, { id: 'bolt', label: '閃電' }, { id: 'bookmark', label: '書籤' },
  { id: 'bell', label: '鈴鐺' }, { id: 'eye', label: '眼睛' }, { id: 'chat', label: '對話' },
  { id: 'pin', label: '圖釘' }, { id: 'hash', label: '井號' }, { id: 'question', label: '問號' },
];

/** 自訂標記的顏色設成這個值時跟隨主題色 */
export const ACCENT_COLOR = 'accent';
/** 標記顏色實際畫出來的 CSS 顏色 */
export const markColorCss = (c: string) => (c === ACCENT_COLOR ? 'var(--accent)' : c);

export const MARK_COLORS: { hex: string; label: string }[] = [
  { hex: ACCENT_COLOR, label: '跟隨主題色' },
  { hex: '#4fb3a9', label: '青綠' }, { hex: '#b48cf2', label: '紫' }, { hex: '#ec8a6a', label: '珊瑚' },
  { hex: '#7cc47a', label: '綠' }, { hex: '#e27aa8', label: '粉紅' }, { hex: '#9aa1ae', label: '灰' },
];

/** MarkIcon 畫圖用的描述 */
export type MarkVisual =
  | { kind: BuiltinMarkId }
  | { kind: 'sym'; sym: SymbolId; color: string }
  | { kind: 'text'; text: string; color: string };

type MarkFields = Pick<Entry, 'mark' | 'tgt'> & { pending?: boolean; src?: string };

/** 有譯文、且不是待確認，才算已翻譯；原文和譯文都空白的條目沒有東西要翻，也算已翻譯 */
export function isTranslated(e: MarkFields): boolean {
  if (e.src !== undefined && !e.src.trim() && !e.tgt.trim()) return true;
  return !!e.tgt && !e.pending;
}

/** 條目實際顯示的標記：刻意標記優先，否則看是否已翻譯 */
export function effectiveMark(e: MarkFields): MarkId {
  return e.mark || (isTranslated(e) ? 'translated' : 'untranslated');
}

/** 把選單選到的標記轉成要存的值：已翻譯／未翻譯不存 */
export function toStoredMark(id: MarkId): StoredMark {
  return id === 'translated' || id === 'untranslated' ? '' : id;
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
  if (id.startsWith('c:')) return findCustom(customs, id)?.name ?? '已翻譯';
  return BUILTIN_MARKS.find((b) => b.id === id)?.label ?? id;
}

/** 自訂文字標記的限制：英文最多 2 個字母、中日韓最多 1 字，或 1 個 emoji */
export function checkMarkText(v: string): { ok: boolean; msg: string } {
  if (!v) return { ok: false, msg: '' };
  if (/^[A-Za-z]{1,2}$/.test(v)) return { ok: true, msg: '' };
  if (/^[A-Za-z]+$/.test(v)) return { ok: false, msg: '英文字母最多 2 個' };
  const chars = Array.from(v);
  const cjk = /[ᄀ-ᇿ぀-ヿ㄰-㆏㐀-䶿一-鿿가-힯豈-﫿]/;
  if (chars.every((ch) => cjk.test(ch))) {
    return chars.length === 1 ? { ok: true, msg: '' } : { ok: false, msg: '中文、日文、韓文最多 1 個字' };
  }
  const n = typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? Array.from(new Intl.Segmenter().segment(v)).length
    : chars.length;
  if (n === 1 && /\p{Extended_Pictographic}/u.test(v)) return { ok: true, msg: '' };
  return { ok: false, msg: '只能輸入 1 到 2 個英文字母、1 個中日韓文字，或 1 個 emoji' };
}
