import { useEffect, useState } from 'react';
import { currentOf, useStore, useStorePick } from './state/store';
import { effectiveMark, isDone } from './model/marks';
import { TitleBar, MODES } from './components/TitleBar';
import { FileNav } from './components/FileNav';
import { EntryList } from './components/EntryList';
import { WorkPanel } from './components/WorkPanel';
import { SidePanel } from './components/SidePanel';
import { Splitter } from './components/Splitter';
import { MarkMenu } from './components/MarkMenu';
import { TermDialog } from './components/TermDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { PasteDialog } from './components/PasteDialog';
import { DictPasteDialog } from './components/DictPasteDialog';
import { LengthDialog } from './components/LengthDialog';
import { Splash } from './components/Splash';
import { ManageDictsDialog, ManageProjectsDialog, MoveProjectDialog } from './components/ManageDialogs';
import { Shortcuts } from './components/Shortcuts';
import { ConfirmDialog } from './components/ConfirmDialog';
import { resolveAskSave, startApp } from './state/saver';
import { useEffectiveTheme } from './components/useTheme';
import { IconCheck, IconChevD, IconChevL } from './components/icons';
import { fontVars, fz } from './model/fonts';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function useWindowSize() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return size;
}

/** 畫面中間短暫出現、自己消失的提示（例如手動存檔後的「已儲存」） */
function Toast() {
  const toast = useStore((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => useStore.setState({ toast: null }), 1400);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  return (
    // 用 flex 置中而不是 translate(-50%)，避免落在半個像素上讓字變模糊
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <div key={toast.k} role="status" className="toast" style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '12px 22px', background: 'var(--pop)', border: '1px solid var(--line4)', borderRadius: 12, boxShadow: '0 16px 40px rgba(0,0,0,0.35)',
      fontSize: fz(14), fontWeight: 600, color: 'var(--text)',
    }}>
      <IconCheck size={16} sw={2.6} stroke="var(--accent2)" />{toast.text}
    </div>
    </div>
  );
}

/** 存檔時發現有格子超過 Excel 的單格上限 */
function LongCellsNotice() {
  const cells = useStore((st) => st.longCells);
  if (!cells) return null;
  return (
    <ConfirmDialog zIndex={60} title="有格子超過 Excel 的單格上限"
      body={'Excel 一格最多 32767 字，下列條目超過了，用 Excel 開啟時會被截斷：' + cells.slice(0, 8).join('、') + (cells.length > 8 ? ` 等 ${cells.length} 條` : '')}
      choices={[{ label: '知道了', primary: true, onClick: () => useStore.setState({ longCells: null }) }]} />
  );
}

function StatusBar() {
  const files = useStore((s) => s.project!.files);
  const mode = useStore((s) => s.mode);
  let done = 0, total = 0;
  files.forEach((f) => f.sheets.forEach((sh) => sh.entries.forEach((e) => { total++; if (isDone(e)) done++; })));
  return (
    <footer style={{
      height: 28, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px',
      background: 'var(--bar)', borderTop: '1px solid var(--line)', fontSize: fz(11.5), color: 'var(--mute)',
    }}>
      <div style={{ display: 'flex', gap: 18 }}>
        <span>專案進度 {done} / {total} 條</span>
        <span>模式：{MODES.find((m) => m.id === mode)!.label}</span>
      </div>
    </footer>
  );
}

/** 條目標記選單（點條目左邊的標記時打開）；自己訂閱條目內容，主畫面不必跟著重畫 */
function RowMarkMenu() {
  const s = useStorePick('project', 'file', 'sheetBy', 'selBy', 'rowMenu', 'set', 'setEntryMark');
  if (!s.project || !s.rowMenu) return null;
  const { sheet } = currentOf(s);
  const e = sheet.entries[s.rowMenu.index];
  if (!e) return null;
  return (
    <MarkMenu title="變更標記" ariaLabel="變更標記"
      current={effectiveMark(e)}
      style={{ position: 'absolute', left: s.rowMenu.x, top: s.rowMenu.y, boxShadow: '0 16px 40px rgba(0,0,0,0.5)' }}
      numbered={!!s.rowMenu.keys} active={s.rowMenu.keys ? s.rowMenu.active : undefined}
      onPick={(id) => { (s.rowMenu!.indices ?? [s.rowMenu!.index]).forEach((i) => s.setEntryMark(i, id)); s.set({ rowMenu: null }); }} />
  );
}

export default function App() {
  // 主畫面只訂閱版面、主題、選單開關；條目內容由各區塊自己訂閱，打字時主畫面不重畫
  const s = useStorePick('accent', 'accentPreview', 'fonts', 'hideNav', 'hideSide', 'sideW', 'workH', 'rowMenu', 'stampOpen', 'fileMenuOpen', 'askSave', 'set', 'closePopups');
  const hasProject = useStore((st) => !!st.project);
  const { w, h } = useWindowSize();

  useEffect(() => { void startApp(); }, []);

  // 深淺主題與主題色
  const theme = useEffectiveTheme();
  const accent = s.accentPreview ?? s.accent;
  useEffect(() => {
    // 切換的當下先停掉所有過場動畫，整個畫面同一格一起變色
    const root = document.documentElement;
    root.classList.add('theme-switching');
    document.body.style.background = theme === 'light' ? '#f3f4f6' : '#15171c';
    void root.offsetHeight;
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
  }, [theme]);

  const loading = useStore((st) => !!st.loading);

  // 版面尺寸，規則同設計檔
  const W = Math.max(1024, w), H = Math.max(640, h);
  const showNav = !s.hideNav, showSide = !s.hideSide;
  const sideMax = Math.min(600, W - 700);
  const sideW = Math.round(clamp(s.sideW ?? 340, 260, sideMax));
  const workMax = Math.max(220, H - 44 - 28 - 24 - 56 - 12 - 200) + (showNav ? 0 : 56);
  const workH = Math.round(clamp(s.workH ?? 300, 220, workMax));
  const mainW = showSide ? W - sideW : W;
  const tabW = mainW < 980 ? 150 : 200;

  const anyPop = !!s.rowMenu || s.stampOpen || s.fileMenuOpen;

  // 啟動中：同樣的底色與主題色，中間是啟動畫面
  if (!hasProject || loading) {
    return (
      <div data-root="1" className={theme === 'light' ? 'vl' : 'vd'} data-accent={accent.startsWith('#') ? undefined : accent}
        style={{ ...(accent.startsWith('#') ? { ['--accent' as string]: accent } : {}), width: '100%', height: '100vh', display: 'flex', background: 'var(--bg0)', color: 'var(--text)', fontFamily: 'var(--font-ui)' }}>
        <Splash />
      </div>
    );
  }

  return (
    <div data-root="1" className={theme === 'light' ? 'vl' : 'vd'}
      data-accent={accent.startsWith('#') ? undefined : accent}
      style={{
      ...(accent.startsWith('#') ? { ['--accent' as string]: accent } : {}),
      ...fontVars(s.fonts),
      fontFamily: 'var(--font-ui)',
      width: '100%', height: '100vh', minWidth: 1024, minHeight: 640, position: 'relative', display: 'flex', flexDirection: 'column',
      background: 'var(--bg0)', color: 'var(--text)', overflow: 'hidden', fontSize: fz(13),
    }}>
      <TitleBar />

      <div style={{ flexGrow: 1, display: 'flex', minHeight: 0 }}>
        <main style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minWidth: 0, padding: 12 }}>
          {showNav ? <FileNav tabW={tabW} /> : (
            <div style={{ height: 14, flexShrink: 0, display: 'flex', justifyContent: 'flex-end', margin: '-6px 0 8px' }}>
              <button type="button" className="ib" aria-label="顯示檔案欄" title="顯示檔案欄" onClick={() => s.set({ hideNav: false })}
                style={{ width: 32, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '0 0 8px 8px', color: 'var(--text2)' }}>
                <IconChevD size={12} sw={2.4} />
              </button>
            </div>
          )}
          <EntryList />
          <Splitter dir="h" label="調整工作欄高度" value={workH} min={220} max={workMax} onChange={(v) => s.set({ workH: v })} />
          <WorkPanel height={workH} />
        </main>

        {showSide ? (
          <>
            <Splitter dir="v" label="調整右側欄寬度" value={sideW} min={260} max={sideMax} onChange={(v) => s.set({ sideW: v })} />
            <SidePanel width={sideW} />
          </>
        ) : (
          <div style={{ width: 30, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 16, background: 'var(--bar)', borderLeft: '1px solid var(--line)' }}>
            <button type="button" className="ib" aria-label="顯示右側欄" title="顯示右側欄" onClick={() => s.set({ hideSide: false })}
              style={{ width: 24, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'transparent', border: 0, borderRadius: 6, color: 'var(--text2)' }}>
              <IconChevL size={14} sw={2.4} />
            </button>
          </div>
        )}
      </div>

      <StatusBar />

      {/* 點擊空白處關閉選單 */}
      {anyPop && (
        <button type="button" tabIndex={-1} aria-label="關閉選單" onClick={() => s.closePopups()}
          style={{ position: 'absolute', inset: 0, zIndex: 25, background: 'transparent', border: 0, cursor: 'default' }} />
      )}

      <RowMarkMenu />

      <TermDialog />
      <SettingsDialog />
      <PasteDialog />
      <LongCellsNotice />
      {s.askSave && (
        <ConfirmDialog zIndex={60} title="有未儲存的修改"
          body={s.askSave.kind === 'close' ? '關閉前要儲存嗎？' : '切換檔案前要儲存嗎？'}
          choices={[
            { label: '取消', onClick: () => void resolveAskSave('cancel') },
            { label: '不儲存', danger: true, onClick: () => void resolveAskSave('discard') },
            { label: '儲存', primary: true, onClick: () => void resolveAskSave('save') },
          ]} />
      )}
      <Shortcuts />
      <DictPasteDialog />
      <ManageProjectsDialog />
      <ManageDictsDialog />
      <MoveProjectDialog />
      <LengthDialog />
      <Toast />
    </div>
  );
}
