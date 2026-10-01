// 用瀏覽器實際排版來量行數：畫面外放一個看不見的格子，設成標準的欄寬、字型、字級，
// 跟 Google Sheets 一樣自動換行，再數排出來幾行。沒有畫面（例如跑測試）時不量。
import { fontStack, ptToPx } from './fonts';
import { CELL_PADDING, type LengthStd } from './length';

export interface Measure {
  /** 排出來的行數（空字串是 0 行） */
  lines: number;
  /** 最後一行右邊還剩多少寬度（px，標準的字級） */
  remain: number;
  /** 大約 10 個字元的寬度（px，標準的字級），用來判斷「快到上限」 */
  tenChars: number;
  /** 超過行數上限時：能放進上限內的最長字數（從開頭算）；沒超過時是全文長度 */
  fitLen: number;
}

let box: HTMLDivElement | null = null;

function cell(std: LengthStd) {
  if (typeof document === 'undefined') return null;
  if (!box) {
    box = document.createElement('div');
    box.setAttribute('aria-hidden', 'true');
    Object.assign(box.style, {
      position: 'fixed', left: '-10000px', top: '0', visibility: 'hidden', pointerEvents: 'none',
      boxSizing: 'border-box', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', lineHeight: 'normal',
    });
    document.body.appendChild(box);
  }
  Object.assign(box.style, {
    width: std.width + 'px', padding: `0 ${CELL_PADDING}px`,
    fontFamily: fontStack(std.family), fontSize: ptToPx(std.size) + 'px',
  });
  return box;
}

/** 排版後的行數與最後一行的剩餘寬度 */
function layout(el: HTMLDivElement, text: string): { lines: number; remain: number } {
  el.textContent = text;
  const node = el.firstChild;
  if (!node || !text) return { lines: 0, remain: el.clientWidth - CELL_PADDING * 2 };
  const range = document.createRange();
  range.selectNodeContents(node);
  // 依每個字框的高度位置分行；同一行的字框 top 幾乎一樣
  const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 || r.height > 0);
  const tops: number[] = [];
  rects.forEach((r) => { if (!tops.some((x) => Math.abs(x - r.top) <= 2)) tops.push(r.top); });
  const lastTop = Math.max(...tops);
  const lastRight = Math.max(...rects.filter((r) => Math.abs(r.top - lastTop) <= 2).map((r) => r.right));
  // 結尾是換行時，最後多一個空行
  const lines = tops.length + (text.endsWith('\n') ? 1 : 0);
  const content = el.getBoundingClientRect();
  const right = content.right - CELL_PADDING;
  return { lines, remain: text.endsWith('\n') ? right - content.left - CELL_PADDING : Math.max(0, right - lastRight) };
}

const cache = new Map<string, Measure>();
const MAX_CACHE = 2000;

export function measure(text: string, std: LengthStd): Measure | null {
  const key = `${std.family}|${std.size}|${std.width}|${std.lines}\u0000${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const el = cell(std);
  if (!el) return null;
  const { lines, remain } = layout(el, text);
  el.textContent = '0000000000';
  const tenChars = (el.firstChild && (() => { const r = document.createRange(); r.selectNodeContents(el.firstChild!); return r.getBoundingClientRect().width; })()) || ptToPx(std.size) * 5;
  let fitLen = text.length;
  if (lines > std.lines) {
    // 找出放得進上限的最長開頭
    let lo = 0, hi = text.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (layout(el, text.slice(0, mid)).lines <= std.lines) lo = mid; else hi = mid - 1;
    }
    fitLen = lo;
  }
  const out = { lines, remain, tenChars, fitLen };
  if (cache.size >= MAX_CACHE) cache.clear();
  cache.set(key, out);
  return out;
}

/** 超過行數上限 */
export function overflows(text: string, std: LengthStd): boolean {
  const m = measure(text, std);
  return !!m && m.lines > std.lines;
}

/** 某段文字在指定字型字級下的寬度（px），換算欄寬用 */
export function textWidth(text: string, family: string, size: number): number {
  if (typeof document === 'undefined') return 0;
  const c = document.createElement('canvas').getContext('2d');
  if (!c) return 0;
  c.font = `${ptToPx(size)}px ${fontStack(family)}`;
  return c.measureText(text).width;
}
