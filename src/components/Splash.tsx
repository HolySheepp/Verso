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

/** 啟動畫面上的「檢測到新版本，是否更新」 */
export function UpdateAsk({ version, onPick }: { version: string; onPick(yes: boolean): void }) {
  return (
    <div role="alertdialog" aria-label="檢測到新版本" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }} data-nodrag>
      <div style={{ fontSize: fz(13.5), color: 'var(--text)' }}>檢測到新版本 {version}，是否更新？</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn btn-ghost" onClick={() => onPick(false)}
          style={{ height: 34, padding: '0 16px', background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, fontSize: fz(13) }}>稍後</button>
        <button type="button" className="btn btn-primary" autoFocus onClick={() => onPick(true)}
          style={{ height: 34, padding: '0 18px', background: 'var(--primary)', border: 0, borderRadius: 8, color: '#ffffff', fontSize: fz(13), fontWeight: 600 }}>更新</button>
      </div>
    </div>
  );
}

/**
 * 啟動畫面：中間是 logo，一開始是很深的顏色，主題色隨載入進度從左到右填滿；
 * 下面的字說明正在做什麼。
 */
export function Splash() {
  const loading = useStore((s) => s.loading);
  const prompt = useStore((s) => s.updatePrompt);
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
      {prompt ? <UpdateAsk version={prompt.version} onPick={prompt.resolve} /> : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: fz(12.5), color: 'var(--mute)', minHeight: 18 }}>{loading?.text ?? ''}</div>
          {loading?.cancel && (
            <button type="button" className="btn btn-ghost" onClick={loading.cancel} data-nodrag
              style={{ height: 30, padding: '0 14px', background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, fontSize: fz(12.5) }}>取消</button>
          )}
        </div>
      )}
    </div>
  );
}
