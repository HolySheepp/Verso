import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useStore } from '../state/store';
import type { Mode } from '../model/types';
import {
  IconEye, IconGear, IconLogo, IconMoon, IconPen, IconShield, IconSrcEdit, IconSun,
  IconWinClose, IconWinMax, IconWinMin,
} from './icons';

export const MODES: { id: Mode; label: string; Icon: typeof IconPen }[] = [
  { id: 'translate', label: '翻譯', Icon: IconPen },
  { id: 'verify', label: '驗證', Icon: IconShield },
  { id: 'view', label: '檢視', Icon: IconEye },
  { id: 'source', label: '原文修正', Icon: IconSrcEdit },
];

// 在瀏覽器預覽時沒有視窗 API，按鈕不做事
const win = () => (isTauri() ? getCurrentWindow() : null);

const topBtn: React.CSSProperties = {
  width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent', border: '1px solid var(--line3)', borderRadius: 6, color: 'var(--text2)',
};
const winBtn: React.CSSProperties = {
  width: 46, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent', border: 0, color: 'var(--text2)',
};

export function TitleBar() {
  const projectName = useStore((s) => s.project?.name ?? '');
  const mode = useStore((s) => s.mode);
  const theme = useStore((s) => s.theme);
  const set = useStore((s) => s.set);
  const themeLabel = theme === 'light' ? '切換為深色模式' : '切換為淺色模式';

  return (
    <header data-tauri-drag-region style={{
      height: 44, flexShrink: 0, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 0 0 16px', background: 'var(--bar)', borderBottom: '1px solid var(--line)',
    }}>
      <div data-tauri-drag-region style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <IconLogo size={20} stroke="var(--accent)" />
        <span data-tauri-drag-region style={{ fontSize: 15, fontWeight: 600, letterSpacing: 0.3 }}>Verso</span>
        <span data-tauri-drag-region className="proj" style={{ color: 'var(--mute)', fontSize: 12, marginLeft: 6 }}>{projectName}</span>
      </div>

      <div role="radiogroup" aria-label="工作模式" style={{
        position: 'absolute', left: '50%', top: 7, transform: 'translateX(-50%)', display: 'flex', gap: 2, padding: 3,
        background: 'var(--bg0)', border: '1px solid var(--line)', borderRadius: 9,
      }}>
        {MODES.map(({ id, label, Icon }) => {
          const on = mode === id;
          return (
            <button key={id} type="button" role="radio" className="md" aria-checked={on}
              onClick={() => set({ mode: id, stampOpen: false })}
              style={{
                height: 24, display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px', border: 0, borderRadius: 6,
                fontSize: 12.5, fontWeight: 500, background: on ? '#2f6fe4' : 'transparent', color: on ? '#ffffff' : 'var(--text2)',
              }}>
              <Icon size={13} sw={2.2} />{label}
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
        <div style={{ display: 'flex', gap: 6, paddingRight: 12 }}>
          <button type="button" className="ib" aria-label={themeLabel} title={themeLabel} style={topBtn}
            onClick={() => set({ theme: theme === 'light' ? 'dark' : 'light' })}>
            {theme === 'light' ? <IconMoon size={15} /> : <IconSun size={15} />}
          </button>
          <button type="button" className="ib" aria-label="設定" title="設定" style={topBtn}
            onClick={() => set({ settingsOpen: true, rowMenu: null, stampOpen: false, fileMenuOpen: false })}>
            <IconGear size={15} />
          </button>
        </div>
        <button type="button" className="ib" aria-label="最小化" style={winBtn} onClick={() => win()?.minimize()}><IconWinMin /></button>
        <button type="button" className="ib" aria-label="最大化" style={winBtn} onClick={() => win()?.toggleMaximize()}><IconWinMax /></button>
        <button type="button" className="ib" aria-label="關閉" style={winBtn} onClick={() => win()?.close()}><IconWinClose /></button>
      </div>
    </header>
  );
}
