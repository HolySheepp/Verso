import { tx } from '../i18n';
import { useState } from 'react';
import { useStore } from '../state/store';
import { resolveRootConflicts } from '../state/saver';
import { fz } from '../model/fonts';

/** 換存檔資料夾時，新資料夾已有同名的檔案或字典：逐項選要用哪一份 */
export function RootConflictDialog() {
  const rc = useStore((s) => s.rootConflicts);
  return rc ? <ConflictForm key={rc.root} /> : null;
}

function ConflictForm() {
  const rc = useStore((s) => s.rootConflicts)!;
  // 每一項預設用目前軟體裡的
  const [folder, setFolder] = useState<Set<number>>(new Set());
  const toggle = (i: number, useFolder: boolean) => {
    const next = new Set(folder);
    if (useFolder) next.add(i); else next.delete(i);
    setFolder(next);
  };
  const seg = (on: boolean): React.CSSProperties => ({
    height: 26, padding: '0 10px', border: 0, borderRadius: 6, fontSize: fz(12), whiteSpace: 'nowrap',
    background: on ? 'var(--segon)' : 'transparent', color: on ? 'var(--text)' : 'var(--text2)',
  });
  return (
    <div className="scrim" style={{ zIndex: 60 }}>
      <div role="dialog" aria-modal="true" aria-labelledby="verso-rc-title" className="dialog" style={{ width: 600, maxHeight: 'calc(100% - 48px)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>
        <div style={{ padding: '20px 20px 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 id="verso-rc-title" style={{ margin: 0, fontSize: fz(15), fontWeight: 600 }}>{tx('rootconflict.001')}</h2>
          <div style={{ fontSize: fz(13), color: 'var(--text2)', lineHeight: 1.5 }}>{tx('rootconflict.002')}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 20px', overflowY: 'auto' }}>
          {rc.items.map((it, i) => {
            const useFolder = folder.has(i);
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 8 }}>
                <span style={{ flexGrow: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontSize: fz(13) }}>
                  <span style={{ color: 'var(--mute)', fontSize: fz(11.5), marginRight: 8 }}>{it.kind === 'file' ? tx('rootconflict.003') : tx('rootconflict.004')}</span>
                  {it.project} / {it.name}
                </span>
                <div role="radiogroup" aria-label={it.name} style={{ display: 'flex', gap: 2, padding: 2, background: 'var(--bg0)', border: '1px solid var(--line)', borderRadius: 8 }}>
                  <button type="button" role="radio" aria-checked={!useFolder} className="seg" onClick={() => toggle(i, false)} style={seg(!useFolder)}>{tx('rootconflict.005')}</button>
                  <button type="button" role="radio" aria-checked={useFolder} className="seg" onClick={() => toggle(i, true)} style={seg(useFolder)}>{tx('rootconflict.006')}</button>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 20px 16px', borderTop: '1px solid var(--line)' }}>
          <button type="button" className="btn btn-ghost" onClick={() => useStore.setState({ rootConflicts: null })}
            style={{ height: 36, padding: '0 16px', background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, fontSize: fz(13) }}>{tx('rootconflict.007')}</button>
          <button type="button" className="btn btn-primary" onClick={() => void resolveRootConflicts(rc.items.filter((_, i) => folder.has(i)))}
            style={{ height: 36, padding: '0 18px', background: 'var(--primary)', border: 0, borderRadius: 8, color: '#ffffff', fontSize: fz(13), fontWeight: 600 }}>{tx('rootconflict.008')}</button>
        </div>
      </div>
    </div>
  );
}
