// 頁簽列：滑鼠移上去直接用滾輪就能左右捲動（不用按 Shift）；
// 頁簽多到放不下時，看不到的那一邊漸漸淡出，提示還有更多頁簽。
// 用法：const tabs = useScrollTabs(); <div ref={tabs.ref} style={{ ...原本的樣式, ...tabs.style }}>
import { useCallback, useEffect, useState } from 'react';

const FADE = 36;

export function useScrollTabs() {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [edge, setEdge] = useState({ l: false, r: false });
  useEffect(() => {
    if (!el) return;
    const update = () => {
      const l = el.scrollLeft > 1, r = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setEdge((e) => (e.l === l && e.r === r ? e : { l, r }));
    };
    const onWheel = (ev: WheelEvent) => {
      // 放得下就不攔；觸控板本來就能左右滑的也不攔
      if (el.scrollWidth <= el.clientWidth || Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) return;
      ev.preventDefault();
      el.scrollLeft += ev.deltaY;
    };
    update();
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('scroll', update);
    // 視窗大小或頁簽數量變了：重新看要不要淡出
    const ro = new ResizeObserver(update);
    ro.observe(el);
    const mo = new MutationObserver(update);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => { el.removeEventListener('wheel', onWheel); el.removeEventListener('scroll', update); ro.disconnect(); mo.disconnect(); };
  }, [el]);
  const mask = edge.l || edge.r
    ? `linear-gradient(90deg, ${edge.l ? `transparent 0, #000 ${FADE}px` : '#000 0'}, ${edge.r ? `#000 calc(100% - ${FADE}px), transparent 100%` : '#000 100%'})`
    : undefined;
  const ref = useCallback((node: HTMLDivElement | null) => setEl(node), []);
  return { ref, style: { WebkitMaskImage: mask, maskImage: mask } as React.CSSProperties };
}
