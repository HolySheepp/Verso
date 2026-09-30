import { useEffect, useRef } from 'react';

interface Props {
  /** h：上下拉（調工作欄高度）；v：左右拉（調右側欄寬度） */
  dir: 'h' | 'v';
  label: string;
  value: number;
  min: number;
  max: number;
  /** 往上／往左拉時數值增加 */
  onChange(v: number): void;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 可拖拉的分隔線。滑鼠靠近時，藍色握把會跟著游標並變長。 */
export function Splitter({ dir, label, value, min, max, onChange }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const grip = useRef<HTMLSpanElement>(null);
  const drag = useRef<{ p: number; v: number } | null>(null);
  const focused = useRef(false);

  const paint = (ev: { clientX: number; clientY: number } | null) => {
    const el = ref.current, g = grip.current;
    if (!el || !g) return;
    const r = el.getBoundingClientRect();
    const len = dir === 'h' ? r.width : r.height;
    let t = 0, pos = len / 2;
    if (ev) {
      const along = dir === 'h' ? ev.clientX : ev.clientY;
      const lo = dir === 'h' ? r.left : r.top, hi = dir === 'h' ? r.right : r.bottom;
      const across = dir === 'h' ? ev.clientY - (r.top + r.height / 2) : ev.clientX - (r.left + r.width / 2);
      if (along >= lo && along <= hi) t = Math.max(0, 1 - Math.abs(across) / 40);
      pos = along - lo;
    }
    if (drag.current || (!ev && focused.current)) t = 1;
    const L = 80 * (0.2 + 0.8 * t);
    const p = clamp(pos - L / 2, 0, Math.max(0, len - L));
    if (dir === 'h') { g.style.width = L + 'px'; g.style.transform = `translateX(${p}px)`; }
    else { g.style.height = L + 'px'; g.style.transform = `translateY(${p}px)`; }
    g.style.opacity = t > 0 ? String(Math.min(1, t * 1.5)) : '0';
  };

  useEffect(() => {
    const move = (ev: PointerEvent) => paint(ev);
    const leave = () => { if (!drag.current) paint(null); };
    window.addEventListener('pointermove', move);
    document.documentElement.addEventListener('pointerleave', leave);
    return () => {
      window.removeEventListener('pointermove', move);
      document.documentElement.removeEventListener('pointerleave', leave);
    };
  });

  const step = (d: number) => onChange(clamp(value + d, min, max));

  return (
    <div ref={ref} role="separator" aria-orientation={dir === 'h' ? 'horizontal' : 'vertical'} aria-label={label} tabIndex={0}
      aria-valuenow={value} aria-valuemin={min} aria-valuemax={max} className="spl"
      onPointerDown={(ev) => {
        try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch { /* 無法捕捉時照常運作 */ }
        drag.current = { p: dir === 'h' ? ev.clientY : ev.clientX, v: value };
      }}
      onPointerMove={(ev) => {
        const d = drag.current;
        if (!d) return;
        onChange(clamp(d.v - ((dir === 'h' ? ev.clientY : ev.clientX) - d.p), min, max));
      }}
      onPointerUp={(ev) => { drag.current = null; paint(ev); }}
      onPointerCancel={(ev) => { drag.current = null; paint(ev); }}
      onFocus={() => { focused.current = true; paint(null); }}
      onBlur={() => { focused.current = false; paint(null); }}
      onKeyDown={(ev) => {
        const inc = dir === 'h' ? 'ArrowUp' : 'ArrowLeft', dec = dir === 'h' ? 'ArrowDown' : 'ArrowRight';
        if (ev.key === inc) { ev.preventDefault(); step(16); }
        if (ev.key === dec) { ev.preventDefault(); step(-16); }
      }}
      style={dir === 'h'
        ? { height: 12, flexShrink: 0, position: 'relative', cursor: 'row-resize', touchAction: 'none' }
        : { width: 8, flexShrink: 0, marginRight: -4, position: 'relative', zIndex: 2, cursor: 'col-resize', touchAction: 'none' }}>
      <span ref={grip} className={'grip ' + (dir === 'h' ? 'grip-h' : 'grip-v')} />
    </div>
  );
}
