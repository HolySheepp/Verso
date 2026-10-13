import { useEffect, useRef } from 'react';
import { idsIn } from '../i18n';
import { useStore } from '../state/store';

/** 從滑鼠底下的元素往外找藏在文字裡的字句 ID（文字、滑鼠提示、螢幕閱讀器的字、輸入框提示） */
function idsAt(el: Element | null): string[] {
  for (let k = 0; el && k < 5; k++, el = el.parentElement) {
    const parts = [el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('placeholder')];
    // 只看自己這一層的文字，避免移到大區塊時把裡面所有的 ID 都列出來
    for (const n of Array.from(el.childNodes)) if (n.nodeType === Node.TEXT_NODE) parts.push(n.textContent);
    const ids = idsIn(parts.filter(Boolean).join(' '));
    if (ids.length) return ids;
  }
  return [];
}

/** 開發者模式「顯示字句 ID」：滑鼠移到介面文字上，游標旁邊跟著顯示它的字句 ID */
export function IdPeek() {
  const on = useStore((s) => s.devMode && s.showIds);
  const tag = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!on) return;
    const move = (ev: MouseEvent) => {
      const el = tag.current;
      if (!el) return;
      const ids = idsAt(ev.target as Element);
      if (!ids.length) { el.style.display = 'none'; return; }
      el.textContent = ids.slice(0, 4).join('  ') + (ids.length > 4 ? '  …' : '');
      el.style.display = 'block';
      // 靠右、靠下時換到游標的另一邊，不要跑出畫面
      const w = el.offsetWidth, h = el.offsetHeight;
      const x = ev.clientX + 14 + w > window.innerWidth ? ev.clientX - 10 - w : ev.clientX + 14;
      const y = ev.clientY + 18 + h > window.innerHeight ? ev.clientY - 8 - h : ev.clientY + 18;
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    };
    const leave = () => { if (tag.current) tag.current.style.display = 'none'; };
    document.addEventListener('mousemove', move, true);
    document.addEventListener('mouseleave', leave);
    return () => { document.removeEventListener('mousemove', move, true); document.removeEventListener('mouseleave', leave); };
  }, [on]);
  if (!on) return null;
  return (
    <div ref={tag} aria-hidden="true" className="mono" style={{
      position: 'fixed', left: 0, top: 0, zIndex: 200, display: 'none', pointerEvents: 'none', whiteSpace: 'nowrap',
      padding: '3px 7px', borderRadius: 5, background: 'var(--pop)', border: '1px solid var(--accent)', color: 'var(--text)',
      fontSize: 11, boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    }} />
  );
}
