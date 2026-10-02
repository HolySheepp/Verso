import { useLayoutEffect, useRef } from 'react';
import { canvasWidth, type Overflow } from '../model/fonts';

interface Props {
  mode: Overflow;
  /** 自動縮放：格子能放文字的寬度與字型；有給就用 canvas 算字寬，不量畫面 */
  fit?: { width: number; font: string; text: string };
  /** 字級，CSS 寫法（可以是 var() 或 calc()） */
  fontSize: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}

/** 縮放時最小縮到原本的幾倍 */
const MIN_FIT = 0.4;

/** 條目欄格子裡的文字：依「超框時」設定省略、換行或縮小字級 */
export function CellText({ mode, fontSize, style, children, fit }: Props) {
  if (mode === 'wrap') {
    return <span style={{ ...style, fontSize, minWidth: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{children}</span>;
  }
  if (mode === 'shrink' && fit) {
    const need = canvasWidth(fit.text.replace(/\n/g, ' '), fit.font);
    const k = need > fit.width && need > 0 && fit.width > 0 ? Math.max(MIN_FIT, fit.width / need) : 1;
    return <span style={{ ...style, fontSize: k === 1 ? fontSize : `calc(${fontSize} * ${k})`, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' }}>{children}</span>;
  }
  if (mode === 'shrink') return <FitText fontSize={fontSize} style={style}>{children}</FitText>;
  return <span style={{ ...style, fontSize, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{children}</span>;
}

/** 字太長時縮小字級，剛好塞進格子的寬度；格子變寬時再放大回去 */
function FitText({ fontSize, style, children }: Omit<Props, 'mode'>) {
  const outer = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const o = outer.current, i = inner.current;
    if (!o || !i) return;
    const fit = () => {
      o.style.setProperty('--fit', '1');
      const need = i.offsetWidth, room = o.clientWidth;
      const k = need > room && need > 0 ? Math.max(MIN_FIT, room / need) : 1;
      o.style.setProperty('--fit', String(k));
    };
    fit();
    // 只在格子變寬變窄時重算；縮放字級會改變高度，若也跟著重算會一直循環
    let lastW = o.clientWidth;
    const ro = new ResizeObserver(() => {
      if (o.clientWidth === lastW) return;
      lastW = o.clientWidth;
      fit();
    });
    ro.observe(o);
    return () => ro.disconnect();
  });

  return (
    <span ref={outer} style={{ ...style, flex: '1 1 0', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textAlign: style?.textAlign }}>
      <span ref={inner} style={{ display: 'inline-block', fontSize: `calc(${fontSize} * var(--fit, 1))` }}>{children}</span>
    </span>
  );
}
