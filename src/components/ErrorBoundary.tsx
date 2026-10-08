import { tx } from '../i18n';
import { Component, type ReactNode } from 'react';
import { autosaveNow } from '../state/saver';

/**
 * 最外層的保護：程式出錯時不要整個白畫面，顯示「發生錯誤」和「重新載入」，
 * 並先把目前的內容寫進暫存復原，重新載入後可以恢復。
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };

  static getDerivedStateFromError() {
    return { error: true };
  }

  componentDidCatch(error: unknown) {
    console.error(tx('error.001'), error);
    void autosaveNow().catch(() => undefined);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, background: '#16181d', color: '#e6e8ee', fontFamily: 'sans-serif' }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{tx('error.002')}</div>
        <div style={{ fontSize: 13, color: '#9aa1ae' }}>{tx('error.003')}</div>
        <button type="button" onClick={() => location.reload()} autoFocus
          style={{ height: 36, padding: '0 18px', background: '#3b82f6', border: 0, borderRadius: 8, color: '#ffffff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{tx('error.004')}</button>
      </div>
    );
  }
}
