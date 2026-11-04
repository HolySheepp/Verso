// Ctrl+F：打開右側欄的搜尋頁、範圍設成當前頁簽，游標放進搜尋框；Ctrl+H：一樣，範圍設成當前檔案
import { useEffect } from 'react';
import { comboOf } from '../model/shortcuts';
import { useStore } from '../state/store';

export function FindKeys() {
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const c = comboOf(ev);
      if (c !== 'Ctrl+F' && c !== 'Ctrl+H') return;
      // 對話框開著時不搶（例如設定、匯入）
      if (document.querySelector('.scrim')) return;
      ev.preventDefault();
      useStore.getState().set({ side: 'search', hideSide: false, searchScope: c === 'Ctrl+F' ? 'sheet' : 'file' });
      // 等搜尋頁畫出來再把游標放進去，原本的字整段選起來方便直接改
      const focus = (n: number) => {
        const el = document.getElementById('verso-search') as HTMLInputElement | null;
        if (el) { el.focus(); el.select(); } else if (n > 0) requestAnimationFrame(() => focus(n - 1));
      };
      requestAnimationFrame(() => focus(10));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  return null;
}
