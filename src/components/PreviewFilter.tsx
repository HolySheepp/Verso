// 設定 Google 表的預覽：某一欄的篩選器（跟 Google 表一樣，依顏色或依值篩選）。
// 每個選項跟條目欄的篩選一樣：左鍵 空 → 包含 → 排除，右鍵反過來；一次只有一欄有篩選器。
import { useEffect, useMemo, useRef, useState } from 'react';
import { tx } from '../i18n';
import { fz } from '../model/fonts';
import { next, StateBox } from './FilterPanel';

export type ColFilterMap = Record<string, 1 | -1>;
export interface ColFilter { col: number; f: ColFilterMap }
type Look = { bg?: string; fg?: string } | undefined;

const WHITE = 'rgb(255, 255, 255)', BLACK = 'rgb(0, 0, 0)';
/** 一格的篩選標籤：值（v:…）、空白或非空白、文字顏色（fg:…）、填滿顏色（bg:…） */
export function cellTags(text: string, look: Look, hasLooks: boolean): string[] {
  const v = text.trim();
  const out = [v ? 'nonblank' : 'blank'];
  if (v) out.push('v:' + v);
  if (hasLooks) out.push('fg:' + (look?.fg ?? BLACK), 'bg:' + (look?.bg ?? WHITE));
  return out;
}
/** 這一列過不過篩選：有排除的不過；有勾選的要符合其中之一 */
export function passTags(f: ColFilterMap, tags: string[]): boolean {
  if (tags.some((t) => f[t] === -1)) return false;
  const inc = Object.values(f).includes(1);
  return !inc || tags.some((t) => f[t] === 1);
}

const PAGE = 50;
const item: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 7, height: 28, padding: '0 8px', border: 0, borderRadius: 6, background: 'transparent', color: 'var(--text)', fontSize: fz(12.5), textAlign: 'left', width: '100%', minWidth: 0 };
const panel: React.CSSProperties = { position: 'fixed', zIndex: 62, minWidth: 150, maxWidth: 280, maxHeight: 360, overflowY: 'auto', padding: 6, display: 'flex', flexDirection: 'column', gap: 1 };

interface Props {
  col: number; x: number; y: number;
  rows: string[][];
  looks?: Look[][];
  filter: ColFilterMap;
  onChange(f: ColFilterMap): void;
  onClose(): void;
}

export function PreviewFilter({ col, x, y, rows, looks, filter, onChange, onClose }: Props) {
  const [sub, setSub] = useState<{ k: 'color' | 'value'; y: number } | null>(null);
  const [colorSub, setColorSub] = useState<{ k: 'fg' | 'bg'; y: number } | null>(null);
  const [shown, setShown] = useState(PAGE);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [onClose]);
  // 這一欄有的值、文字顏色、填滿顏色（照出現的順序，不重複）
  const { values, fgs, bgs } = useMemo(() => {
    const v = new Set<string>(), fg = new Set<string>(), bg = new Set<string>();
    rows.forEach((r, i) => {
      const t = (r[col] ?? '').trim();
      if (t) v.add(t);
      if (looks) { const l = looks[i]?.[col]; fg.add(l?.fg ?? BLACK); bg.add(l?.bg ?? WHITE); }
    });
    return { values: [...v], fgs: [...fg], bgs: [...bg] };
  }, [rows, looks, col]);
  const toggle = (k: string, back: boolean) => {
    const v = next(filter[k], back);
    const f = { ...filter };
    if (v === undefined) delete f[k]; else f[k] = v;
    onChange(f);
  };
  const opt = (k: string, label: React.ReactNode) => (
    <button key={k} type="button" className="dd" style={item} onClick={() => toggle(k, false)} onContextMenu={(ev) => { ev.preventDefault(); toggle(k, true); }}>
      <StateBox v={filter[k]} />{label}
    </button>
  );
  const swatch = (c: string, text: boolean) => (
    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 18, borderRadius: 4, border: '1px solid var(--line4)', background: text ? WHITE : c, color: text ? c : BLACK, fontSize: fz(12), fontWeight: 700 }}>{text ? 'A' : ''}</span>
  );
  const subX = x + 158;
  const left = (px: number) => Math.min(px, window.innerWidth - 290);
  const head = (k: 'color' | 'value', label: string, disabled = false) => (
    <button type="button" className="dd" disabled={disabled} style={{ ...item, justifyContent: 'space-between', background: sub?.k === k ? 'var(--hv2, var(--ov1))' : 'transparent' }}
      onMouseEnter={(ev) => { setSub({ k, y: ev.currentTarget.getBoundingClientRect().top - 6 }); setColorSub(null); }}>
      <span>{label}</span><span aria-hidden="true" style={{ color: 'var(--mute)' }}>›</span>
    </button>
  );
  return (
    <>
      <div onMouseDown={onClose} onContextMenu={(ev) => { ev.preventDefault(); onClose(); }} style={{ position: 'fixed', inset: 0, zIndex: 61 }} />
      <div ref={box} role="menu" className="pop" style={{ ...panel, left: left(x), top: Math.min(y, window.innerHeight - 100), width: 156 }}>
        {head('color', tx('pf.byColor'), !looks)}
        {head('value', tx('pf.byValue'))}
      </div>
      {sub?.k === 'color' && looks && (
        <div role="menu" className="pop" style={{ ...panel, left: left(subX), top: Math.min(sub.y, window.innerHeight - 120), width: 140 }}>
          {(['fg', 'bg'] as const).map((k) => (
            <button key={k} type="button" className="dd" style={{ ...item, justifyContent: 'space-between', background: colorSub?.k === k ? 'var(--hv2, var(--ov1))' : 'transparent' }}
              onMouseEnter={(ev) => setColorSub({ k, y: ev.currentTarget.getBoundingClientRect().top - 6 })}>
              <span>{k === 'fg' ? tx('pf.textColor') : tx('pf.fillColor')}</span><span aria-hidden="true" style={{ color: 'var(--mute)' }}>›</span>
            </button>
          ))}
        </div>
      )}
      {sub?.k === 'color' && colorSub && looks && (
        <div role="menu" className="pop" style={{ ...panel, left: left(subX + 142), top: Math.min(colorSub.y, window.innerHeight - 200), width: 120 }}>
          {(colorSub.k === 'fg' ? fgs : bgs).map((c) => opt(colorSub.k + ':' + c, swatch(c, colorSub.k === 'fg')))}
        </div>
      )}
      {sub?.k === 'value' && (
        <div role="menu" className="pop" style={{ ...panel, left: left(subX), top: Math.min(sub.y, window.innerHeight - 380), width: 260 }}>
          {opt('blank', tx('pf.blank'))}
          {opt('nonblank', tx('pf.nonblank'))}
          {values.slice(0, shown).map((v) => opt('v:' + v, <span className="pf-val" title={v.length > 30 ? v : undefined}>{v}</span>))}
          {values.length > shown && (
            <button type="button" className="dd" style={{ ...item, justifyContent: 'center', color: 'var(--text2)' }} onClick={() => setShown((n) => n + PAGE)}>{tx('pf.more')}</button>
          )}
        </div>
      )}
    </>
  );
}
