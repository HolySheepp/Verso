import { useStore } from '../state/store';
import { fz } from '../model/fonts';

/** Verso 的標誌（跟標題列的一樣），用來畫啟動畫面的大 logo */
function Logo({ color }: { color: string }) {
  return (
    <svg width="88" height="88" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 5h6l3 11 3-11h6" /><path d="M9 19h6" />
    </svg>
  );
}

/**
 * 啟動畫面：中間是 logo，一開始是很深的顏色，主題色隨載入進度從左到右填滿；
 * 下面的字說明正在做什麼。
 */
export function Splash() {
  const loading = useStore((s) => s.loading);
  const p = Math.max(0, Math.min(1, loading?.p ?? 0));
  return (
    <div role="status" aria-live="polite" style={{
      flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22, userSelect: 'none',
    }} data-tauri-drag-region>
      <div style={{ position: 'relative', width: 88, height: 88 }}>
        <Logo color="var(--line4)" />
        <div style={{ position: 'absolute', inset: 0, clipPath: `inset(0 ${(1 - p) * 100}% 0 0)`, transition: 'clip-path 240ms ease-out' }}>
          <Logo color="var(--accent)" />
        </div>
      </div>
      <div style={{ fontSize: fz(12.5), color: 'var(--mute)', minHeight: 18 }}>{loading?.text ?? ''}</div>
    </div>
  );
}
