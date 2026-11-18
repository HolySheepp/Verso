// 還在載入（不是沒有內容）：三個點照順序跳動，下面寫「加載中...」
import { tx } from '../i18n';
import { fz } from '../model/fonts';

export function Loading({ pad = 48 }: { pad?: number }) {
  return (
    <div role="status" aria-live="polite" style={{ padding: `${pad}px 0`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: 'var(--mute)', fontSize: fz(12.5) }}>
      <span aria-hidden="true" style={{ display: 'flex', gap: 6 }}>
        {[0, 1, 2].map((i) => <span key={i} className="load-dot" style={{ animationDelay: i * 0.16 + 's' }} />)}
      </span>
      {tx('common.loading')}
    </div>
  );
}
