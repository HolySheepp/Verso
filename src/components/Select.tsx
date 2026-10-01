import { useRef, useState } from 'react';
import { fz } from '../model/fonts';
import { IconChevD } from './icons';

export interface SelectOption { value: string; label: string }

interface Props {
  value: string;
  options: SelectOption[];
  onChange(value: string): void;
  id?: string;
  ariaLabel?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
}

const MAX_H = 280;

/** 下拉選單：外觀跟檔案選單一樣，套用主題色（系統內建的下拉清單由 Windows 畫，套不到） */
export function Select({ value, options, onChange, id, ariaLabel, style, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 160 });
  const cur = options.find((o) => o.value === value);

  const show = () => {
    if (!btn.current) return;
    // 用 fixed 定位，避免被視窗的捲動區域裁掉；下面放不下就往上開
    const r = btn.current.getBoundingClientRect();
    const h = Math.min(MAX_H, options.length * 32 + 14);
    const top = r.bottom + 4 + h > window.innerHeight ? r.top - 4 - h : r.bottom + 4;
    setPos({ left: r.left, top, width: r.width });
    setHi(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const close = () => { setOpen(false); btn.current?.focus(); };
  const pick = (v: string) => { if (v !== value) onChange(v); close(); };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(); }
      return;
    }
    e.stopPropagation();
    if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(options.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (options[hi]) pick(options[hi].value); }
  };

  return (
    <>
      <button ref={btn} id={id} type="button" className="fs" aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel}
        onClick={() => (open ? close() : show())} onKeyDown={onKey} disabled={disabled}
        style={{
          height: 36, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', minWidth: 0,
          background: 'var(--bg0)', border: '1px solid var(--line4)', borderRadius: 8, color: 'var(--text)', textAlign: 'left', opacity: disabled ? 0.5 : 1, ...style,
        }}>
        <span style={{ flexGrow: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontSize: fz(13) }}>{cur?.label ?? ''}</span>
        <IconChevD size={13} stroke="var(--mute)" style={{ flexShrink: 0 }} />
      </button>
      {open && (
        <>
          <div onMouseDown={(e) => { e.preventDefault(); close(); }} style={{ position: 'fixed', inset: 0, zIndex: 60 }} />
          <div role="listbox" aria-label={ariaLabel} className="pop" onKeyDown={onKey}
            style={{ position: 'fixed', left: pos.left, top: pos.top, minWidth: pos.width, maxHeight: MAX_H, overflowY: 'auto', zIndex: 61, boxSizing: 'border-box' }}>
            {options.map((o, i) => (
              <button key={o.value} type="button" className="dd pop-item" role="option" aria-selected={o.value === value}
                onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setHi(i)} onClick={() => pick(o.value)}
                style={{
                  whiteSpace: 'nowrap', color: 'var(--text)',
                  background: o.value === value ? 'var(--sel)' : i === hi ? 'var(--hv1)' : 'transparent',
                }}>
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
