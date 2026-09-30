import { useStore } from '../state/store';
import { isDone, markName, markVisual } from '../model/marks';
import type { MarkId } from '../model/types';
import { MarkIcon } from './MarkIcon';
import { IconArrowR, IconChevD, IconChevL, IconChevR, IconFile, IconFolder, IconHideTop, IconPlus } from './icons';

const navBtn: React.CSSProperties = {
  width: 32, height: 36, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--text2)',
};

export function FileNav({ tabW }: { tabW: number }) {
  const project = useStore((s) => s.project)!;
  const tab = useStore((s) => s.tab);
  const menuOpen = useStore((s) => s.fileMenuOpen);
  const { set, setTab } = useStore.getState();

  const carW = tabW * 3 + 16;
  const carMask = `linear-gradient(90deg, transparent 0, #000 40px, #000 ${carW - 40}px, transparent ${carW}px)`;
  const file = project.files[tab];
  const badgeOrder: MarkId[] = ['doubt', 'think', ...project.customMarks.map((c) => `c:${c.id}` as MarkId)];

  return (
    <nav aria-label="檔案頁簽" style={{ height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <button type="button" className="ib" aria-label="上一個頁簽" style={navBtn} onClick={() => setTab(tab - 1)}>
        <IconChevL sw={2.2} />
      </button>
      <div style={{ width: carW, height: 44, flexShrink: 0, overflow: 'hidden', position: 'relative', WebkitMaskImage: carMask, maskImage: carMask }}>
        <div style={{
          display: 'flex', gap: 8, height: 44, alignItems: 'center',
          transform: `translateX(${(1 - tab) * (tabW + 8)}px)`, transition: 'transform 320ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        }}>
          {project.files.map((f, i) => {
            const on = i === tab, near = Math.abs(i - tab) === 1;
            const pct = Math.round((f.entries.filter(isDone).length / f.entries.length) * 100);
            const kinds = badgeOrder
              .map((id) => ({ id, n: f.entries.filter((e) => e.mark === id).length }))
              .filter((k) => k.n > 0);
            const tip = kinds.map((k) => markName(project.customMarks, k.id) + ' ' + k.n).join('、');
            return (
              <button key={f.path} type="button" className="tb" aria-current={on ? 'page' : undefined} onClick={() => setTab(i)}
                tabIndex={on || near ? 0 : -1}
                style={{
                  width: tabW, height: 36, flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4,
                  padding: '0 12px', textAlign: 'left', borderRadius: 8, border: `1px solid ${on ? 'var(--tabline)' : 'var(--line)'}`,
                  background: on ? 'var(--tabon)' : 'var(--panel)', opacity: on ? 1 : near ? 0.55 : 0, transform: `scale(${on ? 1 : 0.92})`,
                  transition: 'opacity 320ms, transform 320ms', boxSizing: 'border-box',
                }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, width: '100%' }}>
                  <IconFile size={12} style={{ flexShrink: 0, color: 'var(--mute)' }} />
                  <span style={{ flexGrow: 1, minWidth: 0, fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
                  {kinds.length > 0 && (
                    <span title={tip} aria-label={tip} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 3 }}>
                      {kinds.slice(0, 5).map((k) => <MarkIcon key={k.id} mark={markVisual(project.customMarks, k.id)} size={11} menu />)}
                      {kinds.length > 5 && (
                        <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="var(--mute)" strokeWidth="2" /><circle cx="7.5" cy="12" r="1.6" fill="var(--text2)" /><circle cx="12" cy="12" r="1.6" fill="var(--text2)" /><circle cx="16.5" cy="12" r="1.6" fill="var(--text2)" /></svg>
                      )}
                    </span>
                  )}
                </span>
                <span style={{ display: 'block', width: '100%', height: 3, borderRadius: 2, background: 'var(--line2)', overflow: 'hidden' }}>
                  <span style={{ display: 'block', height: 3, width: pct + '%', background: 'var(--accent)', borderRadius: 2 }} />
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <button type="button" className="ib" aria-label="下一個頁簽" style={navBtn} onClick={() => setTab(tab + 1)}>
        <IconChevR sw={2.2} />
      </button>

      <div style={{ flexGrow: 1, position: 'relative', minWidth: 160, marginLeft: 4 }}>
        <button type="button" className="fs" aria-haspopup="listbox" aria-expanded={menuOpen}
          onClick={() => set({ fileMenuOpen: !menuOpen, rowMenu: null, stampOpen: false })}
          style={{
            width: '100%', height: 36, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px',
            background: 'var(--panel)', border: '1px solid var(--line3)', borderRadius: 8, textAlign: 'left',
          }}>
          <IconFolder size={15} stroke="var(--mute)" style={{ flexShrink: 0 }} />
          <span className="mono" style={{ flexGrow: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontSize: 12, color: 'var(--textsoft)' }}>{file.path}</span>
          <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text2)', padding: '2px 8px', borderRadius: 10, background: 'var(--chip)' }}>
            繁中<span role="img" aria-label="譯為" style={{ display: 'flex' }}><IconArrowR size={10} sw={2.4} /></span>EN
          </span>
          <IconChevD size={14} stroke="var(--mute)" style={{ flexShrink: 0 }} />
        </button>
        {menuOpen && (
          <div role="listbox" aria-label="選擇要翻譯的檔案" className="pop" style={{ position: 'absolute', top: 42, left: 0, right: 0, zIndex: 30 }}>
            <div className="pop-title" style={{ padding: '6px 10px 8px' }}>專案檔案</div>
            {project.files.map((f, i) => (
              <button key={f.path} type="button" className="dd" role="option" aria-selected={i === tab}
                onClick={() => setTab(i)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: 0, borderRadius: 6,
                  background: i === tab ? 'var(--sel)' : 'transparent', textAlign: 'left',
                }}>
                <span className="mono" style={{ flexGrow: 1, fontSize: 12 }}>{f.path}</span>
                <span style={{ fontSize: 11.5, color: 'var(--text2)' }}>{f.entries.filter(isDone).length} / {f.entries.length}</span>
              </button>
            ))}
            <div className="pop-sep" style={{ margin: '6px 4px' }} />
            {/* 開啟檔案：尚未實作，等匯入方式討論後再接 */}
            <button type="button" className="dd" style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: 0, borderRadius: 6,
              background: 'transparent', color: 'var(--text2)', textAlign: 'left',
            }}>
              <IconPlus size={14} />開啟其他檔案…
            </button>
          </div>
        )}
      </div>
      <button type="button" className="ib" aria-label="隱藏檔案欄" title="隱藏檔案欄" style={navBtn}
        onClick={() => set({ hideNav: true, fileMenuOpen: false })}>
        <IconHideTop size={15} />
      </button>
    </nav>
  );
}
