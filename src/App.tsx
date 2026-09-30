import { useEffect, useState } from 'react';
import { currentOf, useStore } from './state/store';
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
import { Shortcuts } from './components/Shortcuts';
import { ConfirmDialog } from './components/ConfirmDialog';
import { resolveAskSave, startApp } from './state/saver';
import { IconCheck, IconChevD, IconChevL } from './components/icons';

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

function StatusBar() {
  const files = useStore((s) => s.project!.files);
  const mode = useStore((s) => s.mode);
  const status = useStore((s) => s.saveStatus);
  const sample = useStore((s) => !!s.project?.sample);
  let done = 0, total = 0;
  files.forEach((f) => f.sheets.forEach((sh) => sh.entries.forEach((e) => { total++; if (isDone(e)) done++; })));
  return (
    <footer style={{
      height: 28, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px',
      background: 'var(--bar)', borderTop: '1px solid var(--line)', fontSize: 11.5, color: 'var(--mute)',
    }}>
      <div style={{ display: 'flex', gap: 18 }}>
        <span>專案進度 {done} / {total} 條</span>
        <span>模式：{MODES.find((m) => m.id === mode)!.label}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {sample ? <span>範例資料，不會存檔</span>
          : status === 'saved' ? <><IconCheck size={12} sw={2.4} stroke="var(--accent2)" /><span>已儲存</span></>
          : status === 'saving' ? <span>儲存中…</span>
          : status === 'error' ? <span style={{ color: 'var(--errtx)' }}>未存檔，稍後自動重試</span>
          : <span>有未儲存的修改</span>}
      </div>
    </footer>
  );
}

export default function App() {
  const s = useStore();
  const { w, h } = useWindowSize();

  useEffect(() => { void startApp(); }, []);

  if (!s.project) return null;

  // 版面尺寸，規則同設計檔
  const W = Math.max(1024, w), H = Math.max(640, h);
  const showNav = !s.hideNav, showSide = !s.hideSide;
  const sideMax = Math.min(600, W - 700);
  const sideW = Math.round(clamp(s.sideW ?? 340, 260, sideMax));
  const workMax = Math.max(220, H - 44 - 28 - 24 - 56 - 12 - 200) + (showNav ? 0 : 56);
  const workH = Math.round(clamp(s.workH ?? 300, 220, workMax));
  const mainW = showSide ? W - sideW : W;
  const tabW = mainW < 980 ? 150 : 200;

  const { sheet } = currentOf(s);
  const anyPop = !!s.rowMenu || s.stampOpen || s.fileMenuOpen;

  return (
    <div data-root="1" className={s.theme === 'light' ? 'vl' : 'vd'} style={{
      width: '100%', height: '100vh', minWidth: 1024, minHeight: 640, position: 'relative', display: 'flex', flexDirection: 'column',
      background: 'var(--bg0)', color: 'var(--text)', overflow: 'hidden', fontSize: 13,
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

      {s.rowMenu && (
        <MarkMenu title="變更標記" ariaLabel="變更標記"
          current={effectiveMark(sheet.entries[s.rowMenu.index])}
          style={{ position: 'absolute', left: s.rowMenu.x, top: s.rowMenu.y, boxShadow: '0 16px 40px rgba(0,0,0,0.5)' }}
          numbered={!!s.rowMenu.keys} active={s.rowMenu.keys ? s.rowMenu.active : undefined}
          onPick={(id) => { s.setEntryMark(s.rowMenu!.index, id); s.set({ rowMenu: null }); }} />
      )}

      <TermDialog />
      <SettingsDialog />
      <PasteDialog />
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
    </div>
  );
}
