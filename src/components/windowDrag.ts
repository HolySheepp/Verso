import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

/** 這些元素上按下滑鼠時不拖動視窗 */
const INTERACTIVE = 'input, textarea, select, button, a, label, [role="menu"], [role="tab"], .paste-box';

/**
 * 在對話框的空白處按住滑鼠拖動，就移動整個軟體視窗。
 * 用在對話框的遮罩和對話框本身；瀏覽器預覽時沒有作用。
 */
export function dragWindow(ev: React.MouseEvent) {
  if (ev.button !== 0 || !isTauri()) return;
  if ((ev.target as HTMLElement).closest(INTERACTIVE)) return;
  ev.preventDefault();
  void getCurrentWindow().startDragging();
}

/**
 * 給從右鍵選單打開的輸入框用：選單關閉時焦點可能被搶走，所以等一下再把焦點給它（只做一次）。
 */
export function focusOnMount(el: HTMLInputElement | HTMLTextAreaElement | null) {
  if (!el || el.dataset.focused) return;
  el.dataset.focused = '1';
  setTimeout(() => { el.focus(); el.select(); }, 0);
}
