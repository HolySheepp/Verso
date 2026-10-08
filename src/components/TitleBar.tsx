import { tx } from '../i18n';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { currentProjectOf, useStore } from '../state/store';
import { manualSave } from '../state/saver';
import { onUpdateIcon } from '../state/updater';
import { keyOf } from '../model/shortcuts';
import { useEffectiveTheme } from './useTheme';
import type { Mode } from '../model/types';
import { fz } from '../model/fonts';
import {
  IconCheck, IconEye, IconGear, IconSave, IconUpdate, IconLogo, IconMoon, IconPen, IconShield, IconSrcEdit, IconSun,
  IconWinClose, IconWinMax, IconWinMin,
} from './icons';

export const MODES: { id: Mode; label: string; Icon: typeof IconPen }[] = [
  { id: 'translate', get label() { return tx('title.001'); }, Icon: IconPen },
  { id: 'verify', get label() { return tx('title.002'); }, Icon: IconShield },
  { id: 'view', get label() { return tx('title.003'); }, Icon: IconEye },
  { id: 'source', get label() { return tx('title.004'); }, Icon: IconSrcEdit },
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
  const projectName = useStore((s) => (s.project?.files.length ? currentProjectOf(s) : ''));
  const status = useStore((s) => s.saveStatus);
  const update = useStore((s) => s.updateAvailable);
  const errors = useStore((s) => s.saveErrors);
  const saveKey = useStore((s) => keyOf(s.shortcuts, 'list', 'save'));
  const mode = useStore((s) => s.mode);
  const theme = useEffectiveTheme();
  const set = useStore((s) => s.set);
  const themeLabel = theme === 'light' ? tx('title.005') : tx('title.006');

  return (
    <header data-tauri-drag-region style={{
      height: 44, flexShrink: 0, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 0 0 16px', background: 'var(--bar)', borderBottom: '1px solid var(--line)',
    }}>
      <div data-tauri-drag-region style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <IconLogo size={20} stroke="var(--accent)" />
        <span data-tauri-drag-region style={{ fontSize: fz(15), fontWeight: 600, letterSpacing: 0.3 }}>Verso</span>
        <span data-tauri-drag-region className="proj" style={{ color: 'var(--mute)', fontSize: fz(12), marginLeft: 6 }}>{projectName}</span>
        <span data-tauri-drag-region title={status === 'error' ? errors.map((x) => x.target + '：' + x.reason).join('\n') : undefined}
          style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, maxWidth: 420, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontSize: fz(11.5), color: status === 'error' ? 'var(--errtx)' : 'var(--mute)', marginLeft: 4 }}>
          {status === 'saved' ? <><IconCheck size={11} sw={2.4} stroke="var(--accent2)" />{tx('title.007')}</>
            : status === 'saving' ? tx('title.008')
            : status === 'error' ? (errors[0] ? (errors.length > 1 ? tx('title.009', { target: errors[0].target, reason: errors[0].reason, v1: errors.length - 1 }) : tx('title.010', { target: errors[0].target, reason: errors[0].reason })) : tx('title.011'))
            : tx('title.012')}
        </span>
        <button type="button" className="ib" aria-label={tx('title.013')} title={tx('title.014', { v1: saveKey ? `（${saveKey}）` : '' })} onClick={() => void manualSave()}
          style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'transparent', border: 0, borderRadius: 6, color: 'var(--text2)' }}>
          <IconSave size={14} />
        </button>
        {update && (
          <button type="button" className="ib update-dot" aria-label={tx('title.015', { update })} title={tx('title.016', { update })} onClick={() => void onUpdateIcon()}
            style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'var(--acc-soft)', border: 0, borderRadius: 6, color: 'var(--accent2)' }}>
            <IconUpdate size={14} sw={2.2} />
          </button>
        )}
      </div>

      <div role="radiogroup" aria-label={tx('title.017')} style={{
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
                fontSize: fz(12.5), fontWeight: 500, background: on ? 'var(--primary)' : 'transparent', color: on ? '#ffffff' : 'var(--text2)',
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
          <button type="button" className="ib" aria-label={tx('title.018')} title={tx('title.018')} style={topBtn}
            onClick={() => set({ settingsOpen: true, rowMenu: null, stampOpen: false, fileMenuOpen: false })}>
            <IconGear size={15} />
          </button>
        </div>
        <button type="button" className="ib" aria-label={tx('title.019')} style={winBtn} onClick={() => win()?.minimize()}><IconWinMin /></button>
        <button type="button" className="ib" aria-label={tx('title.020')} style={winBtn} onClick={() => win()?.toggleMaximize()}><IconWinMax /></button>
        <button type="button" className="ib" aria-label={tx('title.021')} style={winBtn} onClick={() => win()?.close()}><IconWinClose /></button>
      </div>
    </header>
  );
}
