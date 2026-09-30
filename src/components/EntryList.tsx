import { useEffect, useRef } from 'react';
import { useStore, type Filter } from '../state/store';
import { effectiveMark, markName, markVisual } from '../model/marks';
import { MarkIcon } from './MarkIcon';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'untranslated', label: '未翻譯' },
  { id: 'doubt', label: '疑慮' },
  { id: 'think', label: '待思考' },
];

export function EntryList() {
  const project = useStore((s) => s.project)!;
  const tab = useStore((s) => s.tab);
  const sel = useStore((s) => s.selBy[s.tab] ?? 0);
  const filter = useStore((s) => s.filter);
  const { set, select } = useStore.getState();
  const file = project.files[tab];
  const customs = project.customMarks;
  const listRef = useRef<HTMLDivElement>(null);

  // 換條目時讓目前這條保持在可見範圍
  useEffect(() => {
    listRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [tab, sel]);

  const cnt: Record<string, number> = { untranslated: 0, doubt: 0, think: 0 };
  file.entries.forEach((e) => {
    const m = effectiveMark(e);
    if (m in cnt) cnt[m]++;
  });

  const openMark = (ev: React.MouseEvent<HTMLButtonElement>, i: number) => {
    const b = ev.currentTarget;
    const root = b.closest('[data-root]') as HTMLElement;
    const r = b.getBoundingClientRect(), rr = root.getBoundingClientRect();
    const h = 44 + (6 + customs.length) * 32 + (customs.length ? 9 : 0) + 42;
    const x = r.left - rr.left + 2;
    let y = r.bottom - rr.top + 2;
    if (y + h > root.offsetHeight - 10) y = r.top - rr.top - h - 2;
    set({ rowMenu: { index: i, x: Math.round(x), y: Math.round(Math.max(8, y)) }, stampOpen: false, fileMenuOpen: false });
  };

  const rows = file.entries
    .map((e, i) => ({ e, i, m: effectiveMark(e) }))
    .filter(({ m }) => filter === 'all' || m === filter);

  return (
    <section aria-label="文本條目" style={{
      flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--panel)',
      border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden',
    }}>
      <div style={{ height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px 0 16px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span className="sec-label">文本條目</span>
          <span style={{ fontSize: 12, color: 'var(--mute)' }}>共 {file.entries.length} 條</span>
        </div>
        <div role="group" aria-label="篩選條目" className="seg-group">
          {FILTERS.map((f) => {
            const on = filter === f.id;
            return (
              <button key={f.id} type="button" className="seg" aria-pressed={on} onClick={() => set({ filter: f.id })}
                style={{
                  height: 26, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', border: 0, borderRadius: 6, fontSize: 12,
                  background: on ? 'var(--segon)' : 'transparent', color: on ? 'var(--text)' : 'var(--text2)',
                }}>
                {f.id !== 'all' && <MarkIcon mark={{ kind: f.id }} size={12} menu />}
                {f.label}
                <span style={{ fontSize: 11, color: 'var(--mute)' }}>{f.id === 'all' ? file.entries.length : cnt[f.id]}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div style={{
        height: 32, flexShrink: 0, display: 'grid', gridTemplateColumns: '40px 36px minmax(0, 1fr) minmax(0, 1fr)', alignItems: 'center',
        padding: '0 12px 0 4px', fontSize: 11, fontWeight: 600, letterSpacing: 0.8, color: 'var(--mute)',
        borderBottom: '1px solid var(--line0)', background: 'var(--bar2)',
      }}>
        <span />
        <span style={{ textAlign: 'right', paddingRight: 14 }}>#</span>
        <span style={{ padding: '0 16px 0 0' }}>原文</span>
        <span style={{ padding: '0 16px', borderLeft: '1px solid var(--line)' }}>譯文</span>
      </div>
      <div ref={listRef} style={{ flexGrow: 1, overflowY: 'auto', padding: '4px 0' }}>
        {rows.map(({ e, i, m }) => {
          const on = i === sel, doubt = m === 'doubt', ver = m === 'verified', ign = m === 'ignore';
          const label = '標記：' + markName(customs, m) + '，點擊變更';
          return (
            <div key={e.key} className="rw" style={{
              display: 'grid', gridTemplateColumns: '24px 16px minmax(0, 1fr)', padding: '0 12px 0 4px',
              borderTop: `1px solid ${on ? 'rgba(79,140,255,0.55)' : doubt ? 'var(--dbline)' : 'transparent'}`,
              borderBottom: `1px solid ${on ? 'rgba(79,140,255,0.55)' : doubt ? 'var(--dbline)' : 'transparent'}`,
              background: doubt ? (on ? 'var(--dbon)' : 'var(--db)') : on ? 'rgba(79,140,255,0.14)' : 'transparent',
            }}>
              <button type="button" className="mk" aria-haspopup="menu" aria-label={label} title={label} onClick={(ev) => openMark(ev, i)}
                style={{ width: 24, minHeight: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'transparent', border: 0, borderRadius: 4 }}>
                <MarkIcon mark={markVisual(customs, m)} size={14} />
              </button>
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start' }}>
                {e.note && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2.2" strokeLinejoin="round" role="img" aria-label="有備註">
                    <title>有備註</title><path d="M4 5h16v11H9.5L4 20.5z" />
                  </svg>
                )}
              </span>
              <button type="button" className="row" aria-current={on ? 'true' : undefined} onClick={() => select(tab, i)}
                style={{
                  minWidth: 0, minHeight: 38, display: 'grid', gridTemplateColumns: '36px minmax(0, 1fr) minmax(0, 1fr)', alignItems: 'center',
                  padding: 0, background: 'transparent', border: 0, textAlign: 'left', fontSize: 13,
                }}>
                <span className="mono" style={{ textAlign: 'right', paddingRight: 14, fontSize: 11.5, color: ver ? 'var(--mute3)' : 'var(--mute)' }}>{i + 1}</span>
                <span style={{ padding: '9px 16px 9px 0', lineHeight: 1.45, color: ver ? 'var(--mute2)' : 'var(--text)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{e.src}</span>
                <span style={{
                  padding: '9px 16px', lineHeight: 1.45, borderLeft: '1px solid var(--line0)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                  color: ver ? 'var(--mute2)' : e.tgt ? 'var(--textsoft)' : 'var(--mute2)', fontStyle: e.tgt ? 'normal' : 'italic',
                }}>{e.tgt || (ign ? '不需翻譯' : '尚未翻譯')}</span>
              </button>
            </div>
          );
        })}
        {rows.length === 0 && <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--mute)' }}>這個篩選條件下沒有條目</div>}
      </div>
    </section>
  );
}
