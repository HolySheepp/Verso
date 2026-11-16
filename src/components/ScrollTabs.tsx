// 頁簽列：滑鼠移上去直接用滾輪、或按住 Shift 用滾輪，都能左右捲動；也可以按住左右拖動
// （移動不到 5px 算點一下；拖動放開不會切換頁簽；拉過頭會彈回來）。
// 頁簽本身可以拖動排序的，在頁簽上加 data-noscrolldrag，在那上面按住就不捲動；
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
      // 放得下就不攔；觸控板本來就能左右滑的也不攔（按住 Shift 時有的瀏覽器把滾輪換成左右，照樣自己處理）
      if (el.scrollWidth <= el.clientWidth || (!ev.shiftKey && Math.abs(ev.deltaX) > Math.abs(ev.deltaY))) return;
      ev.preventDefault();
      el.scrollLeft += ev.deltaY || ev.deltaX;
    };
    // 按住拖動：超過 5px 才算拖動；拖動後放開的那一下點擊吃掉，不會切換頁簽
    let drag: { x: number; left: number; id: number; moved: boolean } | null = null;
    let shifted = 0;
    const kids = () => [...el.children] as HTMLElement[];
    const shift = (px: number) => {
      shifted = px;
      for (const k of kids()) k.style.translate = px ? `${px}px 0` : '';
    };
    const springBack = () => {
      if (!shifted) return;
      const from = shifted;
      shift(0);
      for (const k of kids()) k.animate([{ translate: `${from}px 0` }, { translate: '0px 0' }], { duration: 320, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
    };
    let eat = false;
    const onDown = (ev: PointerEvent) => {
      if (ev.button !== 0 || el.scrollWidth <= el.clientWidth) return;
      const t = ev.target as Element;
      if (t.closest('[data-noscrolldrag], input, textarea')) return;
      drag = { x: ev.clientX, left: el.scrollLeft, id: ev.pointerId, moved: false };
    };
    const onMove = (ev: PointerEvent) => {
      if (!drag || ev.pointerId !== drag.id) return;
      const dx = ev.clientX - drag.x;
      if (!drag.moved) {
        if (Math.abs(dx) < 5) return;
        drag.moved = true;
        try { el.setPointerCapture(drag.id); } catch { /* 無法捕捉時照常運作 */ }
      }
      const max = el.scrollWidth - el.clientWidth;
      const want = drag.left - dx;
      el.scrollLeft = Math.max(0, Math.min(max, want));
      // 拉過頭：裡面的頁簽跟著移一點點（越拉越緊），放開再彈回。
      // 只移頁簽、不移整列，頁簽列外面的東西不會被蓋到（超出的部分被頁簽列裁掉）；
      // 用 translate 不用 transform，頁簽自己的 transform（例如拖動排序）不受影響
      const over = want < 0 ? -want : want > max ? max - want : 0;
      shift(over ? Math.sign(over) * Math.min(60, Math.abs(over) * 0.35) : 0);
    };
    const onUp = (ev: PointerEvent) => {
      if (!drag || ev.pointerId !== drag.id) return;
      if (drag.moved) {
        eat = true;
        setTimeout(() => { eat = false; }, 0);
        springBack();
      }
      drag = null;
    };
    const onClick = (ev: MouseEvent) => { if (eat) { eat = false; ev.stopPropagation(); ev.preventDefault(); } };
    update();
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('click', onClick, true);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('scroll', update);
    // 視窗大小或頁簽數量變了：重新看要不要淡出
    const ro = new ResizeObserver(update);
    ro.observe(el);
    const mo = new MutationObserver(update);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp); el.removeEventListener('click', onClick, true);
      el.removeEventListener('wheel', onWheel); el.removeEventListener('scroll', update); ro.disconnect(); mo.disconnect(); };
  }, [el]);
  const mask = edge.l || edge.r
    ? `linear-gradient(90deg, ${edge.l ? `transparent 0, #000 ${FADE}px` : '#000 0'}, ${edge.r ? `#000 calc(100% - ${FADE}px), transparent 100%` : '#000 100%'})`
    : undefined;
  const ref = useCallback((node: HTMLDivElement | null) => setEl(node), []);
  return { ref, style: { WebkitMaskImage: mask, maskImage: mask } as React.CSSProperties };
}
