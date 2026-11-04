// 快速搜尋：圓環選單上的每一格是一句搜尋內容，由一般文字和兩種框框組成：
// {選取}（按快捷鍵前框選的文字）、{填寫}（每次手動填）；框框可以設成必填（顯示 {選取*}、{填寫*}）。

export type QsPart = { t: 'text'; v: string } | { t: 'sel' | 'fill'; req: boolean };
export interface QsItem { name: string; parts: QsPart[] }
export interface QuickSearch {
  on: boolean;
  /** 叫出圓環的快捷鍵（comboOf 的格式，例如 Alt+S） */
  key: string;
  /** 圓環有幾格（2～12） */
  slots: number;
  /** 每一格的內容；沒設定的是 null（圓環上不顯示，但位置保留） */
  items: (QsItem | null)[];
  /** 圓環中間：編輯（打開管理）、取消（叉叉，關掉圓環）、無（透明、點了沒反應） */
  center?: 'edit' | 'cancel' | 'none';
}

export const QS_MIN = 2, QS_MAX = 12;
export const DEFAULT_QS: QuickSearch = { on: true, key: 'Alt+S', slots: 8, items: [], center: 'edit' };

/** 這一格有沒有設定內容（有文字或框框） */
export const hasContent = (it: QsItem | null | undefined): it is QsItem => !!it && it.parts.some((p) => p.t !== 'text' || p.v.trim());

/** 圓環上顯示的字：名稱，沒填就用搜尋內容的前幾個字 */
export function labelOf(it: QsItem, chip: (p: Exclude<QsPart, { t: 'text' }>) => string, max = 10): string {
  if (it.name.trim()) return it.name.trim();
  const s = it.parts.map((p) => (p.t === 'text' ? p.v : chip(p))).join('').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/** 組成要搜尋的文字：{選取} 用框選的文字，{填寫} 用 fills 依序（沒填的是空的；必填但空的當作一個空格） */
export function composeQuery(it: QsItem, selected: string, fills: string[]): string {
  let k = 0;
  return it.parts.map((p) => {
    if (p.t === 'text') return p.v;
    const v = fills[k++] ?? (p.t === 'sel' ? selected : '');
    return v === '' && p.req ? ' ' : v;
  }).join('').replace(/\s+/g, ' ').trim();
}

/** 每個框框的預填內容：{選取} 用框選的文字，{填寫} 是空的 */
export const prefills = (it: QsItem, selected: string) => it.parts.filter((p) => p.t !== 'text').map((p) => (p.t === 'sel' ? selected : ''));

/** 必填的框框都有內容（不用跳「完成內容」視窗） */
export function ready(it: QsItem, selected: string): boolean {
  return it.parts.every((p) => p.t === 'text' || !p.req || (p.t === 'sel' && selected.trim() !== ''));
}

/**
 * 改格數：被拿掉的格子有內容就搬到最近的空格；不能少於有內容的格數（回傳 null）
 */
export function resize(items: (QsItem | null)[], from: number, to: number): (QsItem | null)[] | null {
  const n = Math.max(QS_MIN, Math.min(QS_MAX, to));
  const list = Array.from({ length: Math.max(from, n) }, (_, i) => items[i] ?? null);
  if (list.filter(hasContent).length > n) return null;
  const out = list.slice(0, n);
  for (let i = n; i < list.length; i++) {
    if (!hasContent(list[i])) continue;
    // 從被拿掉的位置往回找最近的空格
    let j = n - 1;
    while (j >= 0 && hasContent(out[j])) j--;
    if (j < 0) return null;
    out[j] = list[i];
  }
  return out;
}

/** 至少要幾格（有內容的格數，最少 2） */
export const minSlots = (items: (QsItem | null)[]) => Math.max(QS_MIN, items.filter(hasContent).length);
