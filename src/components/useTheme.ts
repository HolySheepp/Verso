import { useEffect, useState } from 'react';
import { useStore } from '../state/store';

const query = () => window.matchMedia('(prefers-color-scheme: dark)');

/** 實際生效的深淺主題：「跟隨系統」時依作業系統設定，系統改了也會跟著變 */
export function useEffectiveTheme(): 'dark' | 'light' {
  const theme = useStore((s) => s.theme);
  const [sysDark, setSysDark] = useState(() => query().matches);
  useEffect(() => {
    const q = query();
    const on = () => setSysDark(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  return theme === 'system' ? (sysDark ? 'dark' : 'light') : theme;
}
