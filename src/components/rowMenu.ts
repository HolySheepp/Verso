/** 條目標記選單的位置：出現在標記按鈕下方，太靠下時改到上方 */
export function rowMenuPos(btn: HTMLElement, customCount: number): { x: number; y: number } {
  const root = btn.closest('[data-root]') as HTMLElement;
  const r = btn.getBoundingClientRect(), rr = root.getBoundingClientRect();
  const h = 44 + (6 + customCount) * 32 + (customCount ? 9 : 0) + 42;
  const x = r.left - rr.left + 2;
  let y = r.bottom - rr.top + 2;
  if (y + h > root.offsetHeight - 10) y = r.top - rr.top - h - 2;
  return { x: Math.round(x), y: Math.round(Math.max(8, y)) };
}
