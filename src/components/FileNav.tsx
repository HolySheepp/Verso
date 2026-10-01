import { useRef, useState } from 'react';
import { currentOf, useStore } from '../state/store';
import { requestFile } from '../state/saver';
import { ContextMenu } from './ContextMenu';
import { ConfirmDialog } from './ConfirmDialog';
import { focusOnMount } from './windowDrag';
import { isDone, markName, markVisual } from '../model/marks';
import type { Entry, MarkId } from '../model/types';
import { MarkIcon } from './MarkIcon';
import { IconArrowR, IconChevD, IconChevL, IconChevR, IconFile, IconHideTop, IconPaste, IconPlus, IconSheet } from './icons';
import { fz } from '../model/fonts';

const navBtn: React.CSSProperties = {
  width: 32, height: 36, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--text2)',
};

const menuItem: React.CSSProperties = {
  width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: 0, borderRadius: 6,
  background: 'transparent', color: 'var(--text2)', textAlign: 'left',
};

const doneOf = (entries: Entry[]) => entries.filter(isDone).length;

/** 頁簽列（目前檔案底下的頁簽）與檔案選擇 */
export function FileNav({ tabW }: { tabW: number }) {
  const s = useStore();
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
  const [ask, setAsk] = useState<{ kind: 'clear' | 'delete'; i: number } | null>(null);
  const onTabMenu = (k: string, i: number) => {
    setTabMenu(null);
    if (k === 'rename') setRenaming({ i, name: fileDoc.sheets[i].name });
    if (k === 'clear' || k === 'delete') setAsk({ kind: k, i });
    if (k === 'insert') s.set({ pasteOpen: true, pasteInsert: { after: i } });
  };
  const endRename = (commit: boolean) => {
    if (renaming && commit) s.renameSheet(renaming.i, renaming.name);
    setRenaming(null);
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
    <nav aria-label="頁簽與檔案" style={{ height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <button type="button" className="ib" aria-label="上一個頁簽" style={navBtn} onClick={() => s.setSheet(sheetIdx - 1)}>
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
            const pct = sh.entries.length ? Math.round((doneOf(sh.entries) / sh.entries.length) * 100) : 0;
            const kinds = badgeOrder
              .map((id) => ({ id, n: sh.entries.filter((e) => e.mark === id).length }))
              .filter((k) => k.n > 0);
            const tip = kinds.map((k) => markName(project.customMarks, k.id) + ' ' + k.n).join('、');
            return (
              <button key={s.file + ':' + i} type="button" className="tb" aria-current={on ? 'page' : undefined} onClick={() => s.setSheet(i)}
                onDoubleClick={() => setRenaming({ i, name: sh.name })}
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
                    <input ref={focusOnMount} className="field" aria-label="頁簽名稱" value={renaming.name}
                      onPointerDown={(ev) => ev.stopPropagation()} onClick={(ev) => ev.stopPropagation()}
                      onChange={(ev) => setRenaming({ i, name: ev.target.value })}
                      onKeyDown={(ev) => { ev.stopPropagation(); if (ev.key === 'Enter') endRename(true); if (ev.key === 'Escape') endRename(false); }}
                      onBlur={() => endRename(true)}
                      style={{ flexGrow: 1, minWidth: 0, height: 22, padding: '0 6px', fontSize: fz(12.5) }} />
                  ) : (
                    <span style={{ flexGrow: 1, minWidth: 0, fontSize: fz(12.5), fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sh.name}</span>
                  )}
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
      <button type="button" className="ib" aria-label="下一個頁簽" style={navBtn} onClick={() => s.setSheet(sheetIdx + 1)}>
        <IconChevR sw={2.2} />
      </button>

      <div style={{ flexGrow: 1, position: 'relative', minWidth: 160, marginLeft: 4 }}>
        <button type="button" className={'fs' + (noFiles && !menuOpen ? ' attention' : '')} aria-haspopup="listbox" aria-expanded={menuOpen} aria-label="選擇檔案"
          onClick={() => s.set({ fileMenuOpen: !menuOpen, rowMenu: null, stampOpen: false })}
          style={{
            width: '100%', height: 36, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px',
            background: 'var(--panel)', border: '1px solid var(--line3)', borderRadius: 8, textAlign: 'left',
          }}>
          <IconFile size={15} stroke="var(--mute)" style={{ flexShrink: 0 }} />
          <span style={{ flexGrow: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontSize: fz(12.5), color: noFiles ? 'var(--accent2)' : 'var(--textsoft)' }}>{noFiles ? '新增檔案' : fileDoc.name}</span>
          <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5, fontSize: fz(11), color: 'var(--text2)', padding: '2px 8px', borderRadius: 10, background: 'var(--chip)' }}>
            繁中<span role="img" aria-label="譯為" style={{ display: 'flex' }}><IconArrowR size={10} sw={2.4} /></span>EN
          </span>
          <IconChevD size={14} stroke="var(--mute)" style={{ flexShrink: 0 }} />
        </button>
        {menuOpen && (
          <div role="listbox" aria-label="選擇檔案" className="pop" style={{ position: 'absolute', top: 42, left: 0, right: 0, zIndex: 30 }}>
            <div className="pop-title" style={{ padding: '6px 10px 8px' }}>專案檔案</div>
            {project.files.map((f, i) => {
              const all = f.sheets.flatMap((sh) => sh.entries);
              return (
                <button key={i} type="button" className="dd" role="option" aria-selected={i === s.file}
                  onClick={() => requestFile(i)}
                  style={{ ...menuItem, gap: 10, color: undefined, background: i === s.file ? 'var(--sel)' : 'transparent' }}>
                  <span style={{ flexGrow: 1, fontSize: fz(12.5) }}>{f.name}</span>
                  <span style={{ fontSize: fz(11.5), color: 'var(--mute)' }}>{f.sheets.length} 個頁簽</span>
                  <span style={{ fontSize: fz(11.5), color: 'var(--text2)' }}>{doneOf(all)} / {all.length}</span>
                </button>
              );
            })}
            <div className="pop-sep" style={{ margin: '6px 4px' }} />
            <button type="button" className="dd" style={menuItem} onClick={() => s.set({ pasteOpen: true, fileMenuOpen: false })}>
              <IconPaste size={14} />手動貼入…
            </button>
            {/* 開啟檔案：尚未實作，等匯入方式討論後再接 */}
            <button type="button" className="dd" style={menuItem}>
              <IconPlus size={14} />開啟其他檔案…
            </button>
          </div>
        )}
      </div>
      <button type="button" className="ib" aria-label="隱藏檔案欄" title="隱藏檔案欄" style={navBtn}
        onClick={() => s.set({ hideNav: true, fileMenuOpen: false })}>
        <IconHideTop size={15} />
      </button>
      {tabMenu && (
        <ContextMenu x={tabMenu.x} y={tabMenu.y} label={'頁簽「' + (fileDoc.sheets[tabMenu.i]?.name ?? '') + '」'}
          items={[
            { key: 'rename', label: '重新命名' },
            { key: 'clear', label: '清除' },
            { key: 'delete', label: '刪除', danger: true, disabled: fileDoc.sheets.length <= 1 },
            { key: 'insert', label: '插入' },
          ]}
          onPick={(k) => onTabMenu(k, tabMenu.i)} onClose={() => setTabMenu(null)} />
      )}
      {ask && (
        <ConfirmDialog zIndex={60}
          title={(ask.kind === 'clear' ? '清除' : '刪除') + '頁簽「' + (fileDoc.sheets[ask.i]?.name ?? '') + '」？'}
          body={ask.kind === 'clear' ? '頁簽裡的條目會全部拿掉，頁簽保留。' : undefined}
          choices={[
            { label: '取消', onClick: () => setAsk(null) },
            { label: ask.kind === 'clear' ? '清除' : '刪除', primary: true, onClick: () => {
              if (ask.kind === 'clear') s.clearSheet(ask.i); else s.deleteSheet(ask.i);
              setAsk(null);
            } },
          ]} />
      )}
    </nav>
  );
}
