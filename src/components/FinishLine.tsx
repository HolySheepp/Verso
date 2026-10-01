import { useEffect, useState } from 'react';
import type { LengthStd } from '../model/length';
import { measure } from '../model/measure';
import { ptToPx } from '../model/fonts';

interface Props {
  /** 譯文框 */
  target: HTMLTextAreaElement | null;
  text: string;
  std: LengthStd | null;
}

/** 譯文框裡第 index 個字前面的位置（相對於譯文框左上角，已扣掉捲動） */
function caretAt(ta: HTMLTextAreaElement, index: number) {
  const cs = getComputedStyle(ta);
  const mirror = document.createElement('div');
  const copy = ['boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'textTransform', 'wordSpacing', 'tabSize'] as const;
  copy.forEach((k) => { mirror.style[k] = cs[k]; });
  Object.assign(mirror.style, { position: 'absolute', visibility: 'hidden', left: '-10000px', top: '0', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', borderStyle: 'solid' });
  mirror.textContent = ta.value.slice(0, index);
  const mark = document.createElement('span');
  mark.textContent = '​';
  mirror.appendChild(mark);
  document.body.appendChild(mirror);
  const out = { x: mark.offsetLeft, y: mark.offsetTop - ta.scrollTop, lh: parseFloat(cs.lineHeight) || mark.offsetHeight, right: ta.clientWidth - parseFloat(cs.paddingRight) };
  mirror.remove();
  return out;
}

/**
 * 終點線：快到長度上限（剩約 10 個字元寬）時，在上限的位置浮現主題色的點，越接近越長，
 * 碰到時是一條約一字高的線；超過後一直顯示在上限的位置，直到縮回線內。
 */
export function FinishLine({ target, text, std }: Props) {
  const [, redraw] = useState(0);
  // 捲動或改變大小時重新定位
  useEffect(() => {
    if (!target) return;
    const on = () => redraw((n) => n + 1);
    target.addEventListener('scroll', on);
    const ro = new ResizeObserver(on);
    ro.observe(target);
    return () => { target.removeEventListener('scroll', on); ro.disconnect(); };
  }, [target]);

  if (!target || !std || !text) return null;
  const m = measure(text, std);
  if (!m) return null;
  const over = m.lines > std.lines;
  const near = m.lines === std.lines && m.remain < m.tenChars;
  if (!over && !near) return null;

  const progress = over ? 1 : Math.min(1, 1 - m.remain / m.tenChars);
  const c = caretAt(target, over ? m.fitLen : text.length);
  // 剩下的寬度換算成譯文框的字級
  const scale = parseFloat(getComputedStyle(target).fontSize) / ptToPx(std.size);
  const x = Math.min(c.x + (over ? 0 : m.remain * scale), c.right);
  const full = c.lh * 0.8;
  const h = progress >= 0.97 ? full : Math.max(3, full * progress);
  if (c.y + c.lh < 0 || c.y > target.clientHeight) return null;
  return (
    <span aria-hidden="true" className="finish-line" style={{
      position: 'absolute', left: target.offsetLeft + x - 1, top: target.offsetTop + c.y + (c.lh - h) / 2,
      width: 2, height: h, borderRadius: 1, background: 'var(--accent)', pointerEvents: 'none',
      opacity: 0.35 + 0.65 * progress,
    }} />
  );
}
