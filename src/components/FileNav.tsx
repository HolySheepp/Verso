import { tx } from '../i18n';
import { useRef, useState } from 'react';
import { currentOf, useStore, useStorePick } from '../state/store';
import { requestFile } from '../state/saver';
import { ContextMenu } from './ContextMenu';
import { ConfirmDialog } from './ConfirmDialog';
import { RenameInput } from './RenameInput';
import { sheetNameError } from '../model/names';
import { markName, markVisual } from '../model/marks';
import { fileDone, fileProgress, percentOf, sheetDone, sheetProgress } from '../model/progress';
import type { MarkId } from '../model/types';
import { MarkIcon } from './MarkIcon';
import { IconArrowR, IconCheck, IconChevD, IconChevL, IconChevR, IconFile, IconHideTop, IconList, IconPaste, IconPlus, IconSheet } from './icons';
import { fz } from '../model/fonts';

const navBtn: React.CSSProperties = {
  width: 32, height: 36, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--text2)',
};

const menuItem: React.CSSProperties = {
  width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: 0, borderRadius: 6,
  background: 'transparent', color: 'var(--text2)', textAlign: 'left',
};


/** 頁簽列（目前檔案底下的頁簽）與檔案選擇 */
/** 頁簽、檔案都翻完時名稱旁的勾（主題色） */
function Done({ label }: { label: string }) {
  return <span role="img" aria-label={label} title={label} style={{ flexShrink: 0, display: 'flex', color: 'var(--accent)' }}><IconCheck size={12} sw={2.6} /></span>;
}

export function FileNav({ tabW }: { tabW: number }) {
  // 只訂閱這個區塊用到的資料（包含 currentOf 等輔助函式間接用到的）
  const s = useStorePick('project', 'mode', 'file', 'sheetBy', 'selBy', 'collapsedProjects', 'fileMenuOpen', 'set', 'setSheet', 'renameSheet', 'deleteSheet', 'clearSheet');
  const project = s.project!;
  const { fileDoc, sheetIdx } = currentOf(s);
  const menuOpen = s.fileMenuOpen;

  const carW = tabW * 3 + 16;
  const step = tabW + 8;

  // 用滑鼠左右拖動頁簽欄：旁邊的頁簽拖過中線大約四分之一時，就切換到那個頁簽並滑到中間
  const [dragDx, setDragDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  // 頁簽右鍵選單、改名、清除／刪除前的確認
  const [tabMenu, setTabMenu] = useState<{ i: number; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<{ i: number; name: string } | null>(null);
  // 最近兩下點的頁簽：雙擊改名必須兩下都點在同一個頁簽上（頁簽列會滑動，快速點兩個不同頁簽時瀏覽器可能誤判為雙擊）
  const lastClicks = useRef<number[]>([]);
  const [ask, setAsk] = useState<{ kind: 'clear' | 'delete'; i: number } | null>(null);
  const [fileMenu, setFileMenu] = useState<{ i: number; x: number; y: number } | null>(null);
  const onTabMenu = (k: string, i: number) => {
    setTabMenu(null);
    if (k === 'rename') setRenaming({ i, name: fileDoc.sheets[i].name });
    if (k === 'clear' || k === 'delete') setAsk({ kind: k, i });
    if (k === 'insert') s.set({ pasteOpen: true, pasteInsert: { after: i } });
    if (k === 'srcupd') { s.setSheet(i); s.set({ srcUpdate: i }); }
  };
  const drag = useRef<{ x: number; moved: boolean; id: number } | null>(null);
  const justDragged = useRef(false);
  const n = fileDoc.sheets.length;

  const onPointerDown = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (ev.button !== 0) return;
    drag.current = { x: ev.clientX, moved: false, id: ev.pointerId };
  };
  const onPointerMove = (ev: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    let dx = ev.clientX - d.x;
    if (!d.moved) {
      if (Math.abs(dx) < 5) return;
      d.moved = true;
      setDragging(true);
      try { ev.currentTarget.setPointerCapture(d.id); } catch { /* 無法捕捉時照常運作 */ }
    }
    const cross = tabW * 0.75 + 8;
    const idx = currentOf(useStore.getState()).sheetIdx;
    if (dx <= -cross && idx < n - 1) { s.setSheet(idx + 1); d.x = ev.clientX; dx = 0; }
    else if (dx >= cross && idx > 0) { s.setSheet(idx - 1); d.x = ev.clientX; dx = 0; }
    // 已經是第一個或最後一個頁簽時，只能拉動一點點
    if ((dx < 0 && idx >= n - 1) || (dx > 0 && idx <= 0)) dx = Math.sign(dx) * Math.min(Math.abs(dx) * 0.3, cross * 0.4);
    setDragDx(dx);
  };
  const endDrag = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) {
      justDragged.current = true;
      setTimeout(() => { justDragged.current = false; }, 0);
    }
    setDragging(false);
    setDragDx(0);
  };
  const carMask = `linear-gradient(90deg, transparent 0, #000 40px, #000 ${carW - 40}px, transparent ${carW}px)`;
  // 專案裡還沒有檔案：不顯示頁簽，檔案框高亮閃動，提示使用者新增檔案
  const noFiles = project.files.length === 0;
  const badgeOrder: MarkId[] = ['doubt', 'think', ...project.customMarks.map((c) => `c:${c.id}` as MarkId)];

  return (
    <nav aria-label={tx('nav.001')} style={{ height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <button type="button" className="ib" aria-label={tx('nav.002')} style={navBtn} onClick={() => s.setSheet(sheetIdx - 1)}>
        <IconChevL sw={2.2} />
      </button>
      <div onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
        onClickCapture={(ev) => { if (justDragged.current) { ev.stopPropagation(); ev.preventDefault(); justDragged.current = false; } }}
        style={{
          width: carW, height: 44, flexShrink: 0, overflow: 'hidden', position: 'relative', WebkitMaskImage: carMask, maskImage: carMask,
          cursor: dragging ? 'grabbing' : undefined, touchAction: 'none', userSelect: 'none',
        }}>
        <div style={{
          display: 'flex', gap: 8, height: 44, alignItems: 'center',
          transform: `translateX(${(1 - sheetIdx) * step + dragDx}px)`,
          transition: dragging ? 'transform 140ms ease-out' : 'transform 320ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        }}>
          {!noFiles && fileDoc.sheets.map((sh, i) => {
            const on = i === sheetIdx, near = Math.abs(i - sheetIdx) === 1;
            const pct = percentOf(sheetProgress(sh.entries, s.mode));
            const kinds = badgeOrder
              .map((id) => ({ id, n: sh.entries.filter((e) => e.mark === id).length }))
              .filter((k) => k.n > 0);
            const tip = kinds.map((k) => markName(project.customMarks, k.id) + ' ' + k.n).join(tx('common.sep'));
            return (
              <button key={s.file + ':' + i} type="button" className="tb" aria-current={on ? 'page' : undefined} onClick={() => { lastClicks.current = [...lastClicks.current.slice(-1), i]; s.setSheet(i); }}
                onDoubleClick={() => { const c = lastClicks.current; if (c.length === 2 && c[0] === i && c[1] === i) setRenaming({ i, name: sh.name }); }}
                onContextMenu={(ev) => { ev.preventDefault(); s.setSheet(i); setTabMenu({ i, x: ev.clientX, y: ev.clientY }); }}
                tabIndex={on || near ? 0 : -1}
                style={{
                  width: tabW, height: 36, flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4,
                  padding: '0 12px', textAlign: 'left', borderRadius: 8, border: `1px solid ${on ? 'var(--tabline)' : 'var(--line)'}`,
                  background: on ? 'var(--tabon)' : 'var(--panel)', opacity: on ? 1 : near ? 0.55 : 0, transform: `scale(${on ? 1 : 0.92})`,
                  transition: 'opacity 320ms, transform 320ms', boxSizing: 'border-box',
                }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, width: '100%' }}>
                  <IconSheet size={12} style={{ flexShrink: 0, color: 'var(--mute)' }} />
                  {renaming?.i === i ? (
                    <RenameInput initial={renaming.name} label={tx('nav.003')}
                      validate={(v) => sheetNameError(v, fileDoc.sheets.filter((_, j) => j !== i).map((x) => x.name))}
                      onDone={(v) => { if (v) s.renameSheet(i, v); setRenaming(null); }}
                      style={{ flexGrow: 1, minWidth: 0, width: '100%', height: 22, padding: '0 6px', fontSize: fz(12.5) }} />
                  ) : (
                    <span style={{ flexGrow: 1, minWidth: 0, fontSize: fz(12.5), fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sh.name}</span>
                  )}
                  {sheetDone(sh.entries) && <Done label={tx('nav.004')} />}
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
      <button type="button" className="ib" aria-label={tx('nav.005')} style={navBtn} onClick={() => s.setSheet(sheetIdx + 1)}>
        <IconChevR sw={2.2} />
      </button>

      <div style={{ flexGrow: 1, position: 'relative', minWidth: 160, marginLeft: 4 }}>
        <button type="button" className={'fs' + (noFiles && !menuOpen ? ' attention' : '')} aria-haspopup="listbox" aria-expanded={menuOpen} aria-label={tx('nav.006')}
          onClick={() => s.set({ fileMenuOpen: !menuOpen, rowMenu: null, stampOpen: false })}
          style={{
            width: '100%', height: 36, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px',
            background: 'var(--panel)', border: '1px solid var(--line3)', borderRadius: 8, textAlign: 'left',
          }}>
          <IconFile size={15} stroke="var(--mute)" style={{ flexShrink: 0 }} />
          <span style={{ flexGrow: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontSize: fz(12.5), color: noFiles ? 'var(--accent2)' : 'var(--textsoft)' }}>{noFiles ? tx('nav.007') : fileDoc.name}</span>
          {!noFiles && fileDone(fileDoc) && <Done label={tx('nav.008')} />}
          <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5, fontSize: fz(11), color: 'var(--text2)', padding: '2px 8px', borderRadius: 10, background: 'var(--chip)' }}>
            {tx('nav.009')}<span role="img" aria-label={tx('nav.010')} style={{ display: 'flex' }}><IconArrowR size={10} sw={2.4} /></span>{tx('nav.targetLang')}
          </span>
          <IconChevD size={14} stroke="var(--mute)" style={{ flexShrink: 0 }} />
        </button>
        {menuOpen && (
          <div role="listbox" aria-label={tx('nav.006')} className="pop" style={{ position: 'absolute', top: 42, left: 0, right: 0, zIndex: 30 }}>
            {/* 依專案分組，每組可以收合 */}
            <div style={{ maxHeight: 'min(60vh, 520px)', overflowY: 'auto' }}>
              {project.projects.filter((p) => project.files.some((f) => f.project === p)).map((p) => {
                const closed = s.collapsedProjects.includes(p);
                const toggle = () => s.set({ collapsedProjects: closed ? s.collapsedProjects.filter((x) => x !== p) : [...s.collapsedProjects, p] });
                return (
                  <div key={p} role="group" aria-label={p}>
                    <button type="button" className="dd" aria-expanded={!closed} onClick={toggle}
                      style={{ ...menuItem, padding: '6px 8px', gap: 6, fontSize: fz(11.5), color: 'var(--mute)' }}>
                      <IconChevD size={11} sw={2.4} style={{ transform: `rotate(${closed ? -90 : 0}deg)`, transition: 'transform 160ms' }} />
                      {p}
                    </button>
                    {!closed && project.files.map((f, i) => {
                      if (f.project !== p) return null;
                      return (
                        <button key={i} type="button" className="dd" role="option" aria-selected={i === s.file}
                          onClick={() => requestFile(i)}
                          onContextMenu={(ev) => { ev.preventDefault(); setFileMenu({ i, x: ev.clientX, y: ev.clientY }); }}
                          style={{ ...menuItem, gap: 10, paddingLeft: 27, color: undefined, background: i === s.file ? 'var(--sel)' : 'transparent' }}>
                          <span style={{ flexGrow: 1, display: 'flex', alignItems: 'center', gap: 6, fontSize: fz(12.5) }}>{f.name}{fileDone(f) && <Done label={tx('nav.008')} />}</span>
                          <span style={{ fontSize: fz(11.5), color: 'var(--mute)' }}>{tx('nav.011', { n: f.sheets.length })}</span>
                          <span style={{ fontSize: fz(11.5), color: 'var(--text2)' }}>{fileProgress(f, s.mode).done} / {fileProgress(f, s.mode).total}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            {!noFiles && <div className="pop-sep" style={{ margin: '6px 4px' }} />}
            <button type="button" className="dd" style={menuItem} onClick={() => s.set({ pasteOpen: true, fileMenuOpen: false })}>
              <IconPaste size={14} />{tx('nav.012')}
            </button>
            <button type="button" className="dd" style={menuItem} onClick={() => s.set({ importOpen: true, fileMenuOpen: false })}>
              <IconPlus size={14} />{tx('nav.013')}
            </button>
            <button type="button" className="dd" style={menuItem} onClick={() => s.set({ manageProjectsOpen: true, fileMenuOpen: false })}>
              <IconList size={14} />{tx('nav.014')}
            </button>
          </div>
        )}
      </div>
      <button type="button" className="ib" aria-label={tx('nav.015')} title={tx('nav.015')} style={navBtn}
        onClick={() => s.set({ hideNav: true, fileMenuOpen: false })}>
        <IconHideTop size={15} />
      </button>
      {tabMenu && (
        <ContextMenu x={tabMenu.x} y={tabMenu.y} label={tx('nav.016', { v1: fileDoc.sheets[tabMenu.i]?.name ?? '' })}
          items={[
            { key: 'rename', label: tx('nav.017') },
            { key: 'clear', label: tx('nav.018') },
            { key: 'delete', label: tx('nav.019'), danger: true, disabled: fileDoc.sheets.length <= 1 },
            { key: 'insert', label: tx('nav.020') },
            { key: 'srcupd', label: tx('nav.021') },
          ]}
          onPick={(k) => onTabMenu(k, tabMenu.i)} onClose={() => setTabMenu(null)} />
      )}
      {fileMenu && (
        <ContextMenu x={fileMenu.x} y={fileMenu.y} label={tx('nav.022', { v1: project.files[fileMenu.i]?.name ?? '' })}
          items={[{ key: 'move', label: tx('nav.023') }]}
          onPick={() => { s.set({ moveTarget: { kind: 'file', index: fileMenu.i }, fileMenuOpen: false }); setFileMenu(null); }}
          onClose={() => setFileMenu(null)} />
      )}
      {ask && (
        <ConfirmDialog zIndex={60}
          title={tx(ask.kind === 'clear' ? 'nav.clearSheetAsk' : 'nav.deleteSheetAsk', { name: fileDoc.sheets[ask.i]?.name ?? '' })}
          body={ask.kind === 'clear' ? tx('nav.025') : undefined}
          choices={[
            { label: tx('nav.026'), onClick: () => setAsk(null) },
            { label: ask.kind === 'clear' ? tx('nav.018') : tx('nav.019'), primary: true, onClick: () => {
              if (ask.kind === 'clear') s.clearSheet(ask.i); else s.deleteSheet(ask.i);
              setAsk(null);
            } },
          ]} />
      )}
    </nav>
  );
}
