// 條目欄的篩選：一個圖標，點開是篩選面板。每個條件點一下輪流「不選 → 勾選 → 排除」；
// 符合任一勾選的就顯示，符合任一排除的一定不顯示，都沒勾時顯示全部（只拿掉排除的）。
import { useEffect, useRef, useState } from 'react';
import { tx } from '../i18n';
import { fz } from '../model/fonts';
import { markName, markVisual } from '../model/marks';
import { hasPlugin } from '../plugins/has';
import type { MarkId } from '../model/types';
import { useStore, type Filter } from '../state/store';
import { MarkIcon } from './MarkIcon';
import { IconWarn } from './icons';

/** 篩選面板列出的條件：內建標記、有問題、原文更新、自訂標記 */
export function filterKeys(customIds: string[]): string[] {
  const marks: MarkId[] = ['untranslated', 'translated', 'verified', 'doubt', 'think', 'ignore', ...(hasPlugin('ai') ? ['ai' as const] : [])];
  return [...marks, 'issues', 'srcupd', 'note', ...customIds.map((id) => 'c:' + id)];
}

const next = (v: 1 | -1 | undefined): 1 | -1 | undefined => (v === undefined ? 1 : v === 1 ? -1 : undefined);

/** 勾選、排除、不選的小方框 */
function StateBox({ v }: { v: 1 | -1 | undefined | 'mixed' }) {
  const box: React.CSSProperties = {
    width: 14, height: 14, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4, fontSize: 11, lineHeight: 1,
    border: `1.5px solid ${v === undefined ? 'var(--line4)' : v === -1 ? 'var(--errtx)' : 'var(--accent)'}`,
    background: v === 1 ? 'var(--accent)' : 'transparent', color: v === 1 ? '#ffffff' : v === -1 ? 'var(--errtx)' : 'var(--text2)',
  };
  return <span aria-hidden="true" style={box}>{v === 1 ? '✓' : v === -1 ? '✕' : v === 'mixed' ? '~' : ''}</span>;
}

/** 漏斗圖示；有篩選時換成實心、加一個點（不換顏色） */
function FunnelIcon({ on }: { on: boolean }) {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" aria-hidden="true" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round">
      <path d="M4 5h16l-6 7.5V19l-4-2v-4.5z" />
      {on && <circle cx="19.5" cy="17.5" r="2.5" stroke="none" />}
    </svg>
  );
}

export function FilterPanel({ counts }: { counts: Record<string, number> }) {
  const filter = useStore((s) => s.filter);
  const customs = useStore((s) => s.project?.customMarks ?? []);
  const set = useStore((s) => s.set);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const keys = filterKeys(customs.map((c) => c.id));
  const active = keys.some((k) => filter[k] !== undefined);
  const states = keys.map((k) => filter[k]);
  const allState: 1 | -1 | undefined | 'mixed' = states.every((v) => v === states[0]) ? states[0] : 'mixed';
  // 「全部」上次切到哪個狀態（單獨改過條件之後，再按從這裡接下去）
  const lastAll = useRef<1 | -1 | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    const down = (ev: MouseEvent) => { if (!wrap.current?.contains(ev.target as Node)) setOpen(false); };
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key, true); };
  }, [open]);

  const put = (f: Filter) => set({ filter: f, cellSel: null });
  const toggle = (k: string) => {
    const v = next(filter[k]);
    const f = { ...filter };
    if (v === undefined) delete f[k]; else f[k] = v;
    put(f);
  };
  const toggleAll = () => {
    const v = next(allState === 'mixed' ? lastAll.current : allState);
    lastAll.current = v;
    put(v === undefined ? {} : Object.fromEntries(keys.map((k) => [k, v])));
  };
  const stateText = (v: 1 | -1 | undefined | 'mixed') => (v === 1 ? tx('list.filterInclude') : v === -1 ? tx('list.filterExclude') : v === 'mixed' ? tx('list.filterMixed') : tx('list.filterNone'));
  const label = (k: string) => (k === 'issues' ? tx('list.008') : k === 'note' ? tx('list.filterNote') : markName(customs, k as MarkId));
  const item: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, height: 30, padding: '0 8px', border: 0, borderRadius: 6,
    background: 'transparent', color: 'var(--text)', fontSize: fz(12.5), textAlign: 'left',
  };

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <button type="button" className="ib" aria-label={tx('list.026')} title={tx('list.026')} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'var(--btn)', border: '1px solid var(--line3)', borderRadius: 8, color: 'var(--text2)' }}>
        <FunnelIcon on={active} />
      </button>
      {open && (
        <div role="dialog" aria-label={tx('list.026')} className="pop"
          style={{ position: 'absolute', top: 40, right: 0, zIndex: 40, width: 440, maxWidth: 'calc(100vw - 32px)', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button type="button" className="dd" onClick={toggleAll} aria-label={tx('list.004') + tx('common.colon') + stateText(allState)} title={stateText(allState)}
            style={{ ...item, fontWeight: 600, borderBottom: '1px solid var(--line)', borderRadius: 0, paddingBottom: 2 }}>
            <StateBox v={allState} />{tx('list.004')}
          </button>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 2 }}>
            {keys.map((k) => (
              <button key={k} type="button" className="dd" onClick={() => toggle(k)} aria-label={label(k) + tx('common.colon') + stateText(filter[k])} title={stateText(filter[k])} style={item}>
                <StateBox v={filter[k]} />
                {k === 'issues' ? <IconWarn size={12} sw={2.2} stroke="var(--warntx)" />
                  : k === 'note' ? <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth={2.2} strokeLinejoin="round" aria-hidden="true"><path d="M4 5h16v11H9.5L4 20.5z" /></svg>
                  : <MarkIcon mark={markVisual(customs, k as MarkId)} size={12} menu />}
                <span style={{ flexGrow: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{label(k)}</span>
                <span style={{ fontSize: fz(11), color: 'var(--mute)' }}>{counts[k] ?? 0}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
