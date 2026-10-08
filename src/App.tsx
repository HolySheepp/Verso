import { tx } from './i18n';
import { useEffect, useState } from 'react';
import { currentOf, showToast, useStore, useStorePick } from './state/store';
import { effectiveMark } from './model/marks';
import { fileProgress } from './model/progress';
import { TitleBar, MODES } from './components/TitleBar';
import { FileNav } from './components/FileNav';
import { EntryList } from './components/EntryList';
import { WorkPanel } from './components/WorkPanel';
import { SidePanel } from './components/SidePanel';
import { Splitter } from './components/Splitter';
import { MarkMenu } from './components/MarkMenu';
import { TermDialog } from './components/TermDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { SrcUpdateDialog } from './components/SrcUpdateDialog';
import { PasteDialog } from './components/PasteDialog';
import { ImportDialog } from './components/ImportDialog';
import { DictPasteDialog } from './components/DictPasteDialog';
import { LengthDialog } from './components/LengthDialog';
import { Splash } from './components/Splash';
import { RootConflictDialog } from './components/RootConflictDialog';
import { ManageDictsDialog, ManageProjectsDialog, MoveProjectDialog } from './components/ManageDialogs';
import { Shortcuts } from './components/Shortcuts';
import { ConfirmDialog } from './components/ConfirmDialog';
import { resolveAskSave, resolveRecovery } from './state/saver';
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
  // 貼進有字數上限的輸入框（一格最多 32767 字）時，貼了會超過就整段不貼，並提示（瀏覽器預設會默默截掉）
  useEffect(() => {
    const onPaste = (ev: ClipboardEvent) => {
      const el = ev.target as HTMLTextAreaElement | null;
      if (!el || el.tagName !== 'TEXTAREA' || el.maxLength <= 0 || el.readOnly) return;
      const add = ev.clipboardData?.getData('text/plain').replace(/\r\n?/g, '\n') ?? '';
      if (el.value.length - (el.selectionEnd - el.selectionStart) + add.length <= el.maxLength) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      showToast(tx('app.001'));
    };
    document.addEventListener('paste', onPaste, true);
    return () => document.removeEventListener('paste', onPaste, true);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => useStore.setState({ toast: null }), toast.text.length > 20 ? 3000 : 1400);
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
    <ConfirmDialog zIndex={60} title={tx('app.002')}
      body={tx('app.003', { v1: cells.slice(0, 8).join(tx('common.sep')), v2: cells.length > 8 ? tx('common.moreEntries', { n: cells.length }) : '' })}
      choices={[{ label: tx('app.004'), primary: true, onClick: () => useStore.setState({ longCells: null }) }]} />
  );
}

/** 啟動時有檔案或字典讀不到 */
function UnreadableNotice() {
  const list = useStore((st) => st.unreadable);
  if (!list) return null;
  return (
    <ConfirmDialog zIndex={60} title={tx('app.005')}
      body={tx('app.006', { v1: list.slice(0, 8).join(tx('common.sep')), v2: list.length > 8 ? tx('common.moreItems', { n: list.length }) : '' })}
      choices={[{ label: tx('app.004'), primary: true, onClick: () => useStore.setState({ unreadable: null }) }]} />
  );
}

/** 存檔資料夾裡有檔案或字典不見了（軟體裡的還在） */
function GoneNotice() {
  const list = useStore((st) => st.goneFiles);
  if (!list?.length) return null;
  return (
    <ConfirmDialog zIndex={60} title={tx('app.007')}
      body={tx('app.008', { v1: list.slice(0, 8).join(tx('common.sep')), v2: list.length > 8 ? tx('common.moreItems', { n: list.length }) : '' })}
      choices={[{ label: tx('app.004'), primary: true, onClick: () => useStore.setState({ goneFiles: null }) }]} />
  );
}

/** 按了標題列的更新圖示：問要不要更新 */
/** 上次沒有正常關閉，留下了自動暫存的內容：問要恢復還是捨棄 */
function RecoveryDialog() {
  const ask = useStore((st) => st.recoveryAsk);
  if (!ask) return null;
  return (
    <ConfirmDialog zIndex={70} title={tx('app.009')} body={tx('app.010')}
      choices={[
        { label: tx('app.011'), onClick: () => void resolveRecovery('discard') },
        { label: tx('app.012'), primary: true, onClick: () => void resolveRecovery('restore') },
      ]} />
  );
}

function UpdatePromptDialog() {
  const prompt = useStore((st) => st.updatePrompt);
  if (!prompt) return null;
  return (
    <ConfirmDialog zIndex={70} title={tx('app.013', { version: prompt.version })} body={tx('app.014')}
      choices={[
        { label: tx('app.015'), onClick: () => prompt.resolve(false) },
        { label: tx('app.016'), primary: true, onClick: () => prompt.resolve(true) },
      ]} />
  );
}

function StatusBar() {
  // 目前這個檔案所有頁簽加起來的進度（每個頁簽的結果有快取，打字時只重算那個頁簽）
  const file = useStore((s) => s.project!.files[s.file]);
  const mode = useStore((s) => s.mode);
  const { done, total } = fileProgress(file, mode);
  return (
    <footer style={{
      height: 28, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px',
      background: 'var(--bar)', borderTop: '1px solid var(--line)', fontSize: fz(11.5), color: 'var(--mute)',
    }}>
      <div style={{ display: 'flex', gap: 18 }}>
        {file && <span>{tx('app.017')}{' '}{done} / {total}{' '}{tx('app.018')}</span>}
        <span>{tx('app.019')}{MODES.find((m) => m.id === mode)!.label}</span>
      </div>
    </footer>
  );
}

/** 條目標記選單（點條目左邊的標記時打開）；自己訂閱條目內容，主畫面不必跟著重畫 */
function RowMarkMenu() {
  const s = useStorePick('project', 'file', 'sheetBy', 'selBy', 'rowMenu', 'set', 'setEntryMarks');
  if (!s.project || !s.rowMenu) return null;
  const { sheet } = currentOf(s);
  const e = sheet.entries[s.rowMenu.index];
  if (!e) return null;
  return (
    <MarkMenu title={tx('app.020')} ariaLabel={tx('app.020')}
      current={effectiveMark(e)}
      style={{ position: 'absolute', left: s.rowMenu.x, top: s.rowMenu.y, boxShadow: '0 16px 40px rgba(0,0,0,0.5)' }}
      numbered={!!s.rowMenu.keys} active={s.rowMenu.keys ? s.rowMenu.active : undefined}
      onPick={(id) => { s.setEntryMarks(s.rowMenu!.indices ?? [s.rowMenu!.index], id); s.set({ rowMenu: null }); }} />
  );
}

export default function App() {
  // 主畫面只訂閱版面、主題、選單開關；條目內容由各區塊自己訂閱，打字時主畫面不重畫
  const s = useStorePick('accent', 'accentPreview', 'fonts', 'hideNav', 'hideSide', 'sideW', 'workH', 'rowMenu', 'stampOpen', 'fileMenuOpen', 'askSave', 'set', 'closePopups');
  const hasProject = useStore((st) => !!st.project);
  const { w, h } = useWindowSize();

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
              <button type="button" className="ib" aria-label={tx('app.021')} title={tx('app.021')} onClick={() => s.set({ hideNav: false })}
                style={{ width: 32, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '0 0 8px 8px', color: 'var(--text2)' }}>
                <IconChevD size={12} sw={2.4} />
              </button>
            </div>
          )}
          <EntryList />
          <WorkPanel height={workH} maxH={workMax} />
        </main>

        {showSide ? (
          <>
            <Splitter dir="v" label={tx('app.022')} value={sideW} min={260} max={sideMax} onChange={(v) => s.set({ sideW: v })} />
            <SidePanel width={sideW} />
          </>
        ) : (
          <div style={{ width: 30, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 16, background: 'var(--bar)', borderLeft: '1px solid var(--line)' }}>
            <button type="button" className="ib" aria-label={tx('app.023')} title={tx('app.023')} onClick={() => s.set({ hideSide: false })}
              style={{ width: 24, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'transparent', border: 0, borderRadius: 6, color: 'var(--text2)' }}>
              <IconChevL size={14} sw={2.4} />
            </button>
          </div>
        )}
      </div>

      <StatusBar />

      {/* 點擊空白處關閉選單 */}
      {anyPop && (
        <button type="button" tabIndex={-1} aria-label={tx('app.024')} onClick={() => s.closePopups()}
          style={{ position: 'absolute', inset: 0, zIndex: 25, background: 'transparent', border: 0, cursor: 'default' }} />
      )}

      <RowMarkMenu />

      <TermDialog />
      <SettingsDialog />
      <PasteDialog />
      <SrcUpdateDialog />
      <ImportDialog />
      <LongCellsNotice />
      <UnreadableNotice />
      <GoneNotice />
      <UpdatePromptDialog />
      <RecoveryDialog />
      <RootConflictDialog />
      {s.askSave && (
        <ConfirmDialog zIndex={60} title={tx('app.025')}
          body={s.askSave.kind === 'close' ? tx('app.026') : s.askSave.kind === 'update' ? tx('app.027') : s.askSave.kind === 'root' ? tx('app.028') : tx('app.029')}
          choices={[
            { label: tx('app.030'), onClick: () => void resolveAskSave('cancel') },
            { label: tx('app.031'), danger: true, onClick: () => void resolveAskSave('discard') },
            { label: tx('app.032'), primary: true, onClick: () => void resolveAskSave('save') },
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
