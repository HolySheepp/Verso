import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface MarkRange {
  start: number; end: number;
  /** issue：檢查到的問題；hit：字典命中；edit：驗證修改（start === end 時畫成一個小標記） */
  kind: 'issue' | 'hit' | 'edit';
  /** 滑鼠所在的那一段：畫上底色 */
  on?: boolean;
  /** 給外層找出滑鼠在哪一段用 */
  ref?: number;
}

interface Props {
  /** 要標的輸入框 */
  target: HTMLTextAreaElement | null;
  text: string;
  ranges: MarkRange[];
}

const COPY = ['boxSizing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'textTransform', 'wordSpacing', 'tabSize'] as const;

/**
 * 在輸入框上疊一層一模一樣排版的文字，只把指定範圍畫上底色；
 * 文字本身透明，看到的還是輸入框裡的字，捲動也跟著輸入框走。
 */
export function TextMarks({ target, text, ranges }: Props) {
  const layer = useRef<HTMLDivElement>(null);
  const [, redraw] = useState(0);

  // 輸入框大小改變或捲動時，跟著調整
  useEffect(() => {
    if (!target) return;
    const on = () => redraw((n) => n + 1);
    const sync = () => { if (layer.current) layer.current.scrollTop = target.scrollTop; };
    target.addEventListener('scroll', sync);
    const ro = new ResizeObserver(on);
    ro.observe(target);
    return () => { target.removeEventListener('scroll', sync); ro.disconnect(); };
  }, [target]);

  useLayoutEffect(() => { if (layer.current && target) layer.current.scrollTop = target.scrollTop; });

  if (!target || !ranges.length) return null;
  // 照輸入框目前的樣式排版（輸入框已經在畫面上，直接讀它的樣式）
  const cs = getComputedStyle(target);
  const copied: Record<string, string> = {};
  COPY.forEach((k) => { copied[k] = cs[k]; });
  // 輸入框有捲軸時，文字可用的寬度少了捲軸那一條，右邊內距補上同樣寬度才會在同一個地方換行
  const bar = target.offsetWidth - target.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
  const box: React.CSSProperties = {
    ...copied, paddingRight: parseFloat(cs.paddingRight) + Math.max(0, bar), position: 'absolute', left: target.offsetLeft, top: target.offsetTop, width: target.offsetWidth, height: target.offsetHeight,
    borderStyle: 'solid', borderColor: 'transparent', overflow: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word',
    color: 'transparent', pointerEvents: 'none', margin: 0,
  };
  // 依位置切成一段一段，有標記的段落包起來
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const parts: React.ReactNode[] = [];
  let at = 0;
  sorted.forEach((r, i) => {
    const s = Math.max(r.start, at), e = Math.min(r.end, text.length);
    // 沒有文字的修改（插入、刪除）：在那個位置放一個不佔寬度的小標記
    if (r.start === r.end && r.start >= at && r.start <= text.length) {
      if (r.start > at) parts.push(text.slice(at, r.start));
      parts.push(<mark key={i} className="tm-gap" data-on={r.on ? '' : undefined} data-ref={r.ref} />);
      at = r.start;
      return;
    }
    if (e <= s) return;
    if (s > at) parts.push(text.slice(at, s));
    parts.push(<mark key={i} className={'tm-' + r.kind} data-on={r.on ? '' : undefined} data-ref={r.ref}>{text.slice(s, e)}</mark>);
    at = e;
  });
  parts.push(text.slice(at) + '​');
  return <div ref={layer} aria-hidden="true" style={box}>{parts}</div>;
}
