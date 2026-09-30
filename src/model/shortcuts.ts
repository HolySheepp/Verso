// 快捷鍵：兩種情境（在譯文框裡、不在輸入框時）各有一組，可在設定裡錄製改鍵

export type ShortcutContext = 'input' | 'list';

export const CONTEXTS: { id: ShortcutContext; label: string }[] = [
  { id: 'input', label: '在譯文框裡' },
  { id: 'list', label: '不在輸入框時' },
];

export type ActionId =
  | 'main' | 'newline' | 'stampNext' | 'prevEntry' | 'nextEntry' | 'markMenu' | 'record' | 'leaveInput'
  | 'editEntry' | 'clearTgt' | 'prevSheet' | 'nextSheet' | 'close' | 'peek' | 'prevPending' | 'nextPending' | 'save';

export const ACTION_LABELS: Record<ActionId, string> = {
  main: '下一條／驗證並下一條',
  newline: '換行',
  stampNext: '標記並下一條',
  prevEntry: '上一條（不留標記）',
  nextEntry: '下一條（不留標記）',
  markMenu: '開啟標記選單',
  record: '記錄目前譯文',
  leaveInput: '離開譯文框',
  editEntry: '編輯選取條目的譯文',
  clearTgt: '清除選取條目的譯文',
  prevSheet: '上一個頁簽',
  nextSheet: '下一個頁簽',
  close: '關閉選單與視窗',
  peek: '按住查看修改',
  prevPending: '上一個待處理條目',
  nextPending: '下一個待處理條目',
  save: '存檔',
};

/** 這些操作要按住才有效，放開就結束 */
export const HOLD_ACTIONS: ActionId[] = ['peek'];

/** 各情境有哪些操作（依設定頁的顯示順序） */
export const CONTEXT_ACTIONS: Record<ShortcutContext, ActionId[]> = {
  input: ['main', 'newline', 'stampNext', 'prevEntry', 'nextEntry', 'prevPending', 'nextPending', 'markMenu', 'record', 'peek', 'save', 'leaveInput', 'prevSheet', 'nextSheet'],
  list: ['prevEntry', 'nextEntry', 'prevPending', 'nextPending', 'editEntry', 'clearTgt', 'markMenu', 'record', 'peek', 'save', 'prevSheet', 'nextSheet', 'close'],
};

export type Bindings = Record<ShortcutContext, Partial<Record<ActionId, string[]>>>;

export const defaultBindings = (): Bindings => ({
  input: {
    main: ['Enter'],
    newline: ['Ctrl+Enter'],
    stampNext: ['Shift+Enter'],
    prevEntry: ['Alt+↑'],
    nextEntry: ['Alt+↓'],
    prevPending: ['Ctrl+Alt+↑'],
    nextPending: ['Ctrl+Alt+↓'],
    markMenu: ['Ctrl+M'],
    record: ['Ctrl+R'],
    peek: ['Ctrl+D'],
    save: ['Ctrl+S'],
    leaveInput: ['Esc'],
    prevSheet: ['Ctrl+Tab+←'],
    nextSheet: ['Ctrl+Tab+→'],
  },
  list: {
    prevEntry: ['↑', 'Alt+↑'],
    nextEntry: ['↓', 'Alt+↓'],
    prevPending: ['Ctrl+↑'],
    nextPending: ['Ctrl+↓'],
    editEntry: ['Enter'],
    clearTgt: ['Delete', 'Backspace'],
    markMenu: ['Ctrl+M'],
    record: ['Ctrl+R'],
    peek: ['Ctrl+D'],
    save: ['Ctrl+S'],
    prevSheet: ['Ctrl+Tab+←'],
    nextSheet: ['Ctrl+Tab+→'],
    close: ['Esc'],
  },
});

const KEY_NAMES: Record<string, string> = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', ' ': 'Space',
};

/** 把按鍵轉成「Ctrl+Shift+M」這樣的字串；只按了修飾鍵時回傳 null。
 * heldTab：Tab 還按著時再按別的鍵，組成像「Ctrl+Tab+→」這樣的組合。 */
export function comboOf(ev: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>, heldTab = false): string | null {
  const k = ev.key;
  if (k === 'Control' || k === 'Shift' || k === 'Alt' || k === 'Meta' || k === 'Dead' || k === 'Process') return null;
  let key = KEY_NAMES[k] ?? k;
  // 字母與數字用實體按鍵判斷，Shift／Alt 不會把它變成別的字
  if (/^Key[A-Z]$/.test(ev.code)) key = ev.code.slice(3);
  else if (/^Digit\d$/.test(ev.code)) key = ev.code.slice(5);
  else if (key.length === 1) key = key.toUpperCase();
  const mods = [ev.ctrlKey || ev.metaKey ? 'Ctrl' : '', ev.altKey ? 'Alt' : '', ev.shiftKey ? 'Shift' : ''].filter(Boolean);
  if (heldTab && key !== 'Tab') mods.push('Tab');
  return [...mods, key].join('+');
}

/** 找出某情境下這個組合鍵對應的操作 */
export function actionFor(b: Bindings, ctx: ShortcutContext, combo: string): ActionId | null {
  for (const a of CONTEXT_ACTIONS[ctx]) if (b[ctx][a]?.includes(combo)) return a;
  return null;
}

/** 懸停提示用：取某情境下操作的第一個快捷鍵 */
export const keyOf = (b: Bindings, ctx: ShortcutContext, a: ActionId) => b[ctx][a]?.[0] ?? '';

/**
 * 追蹤「Ctrl（或 Alt）+ Tab 按住不放再按別的鍵」這種組合。
 * 只按 Ctrl+Tab 就放開時，放開 Tab 那一刻才算「Ctrl+Tab」。
 */
export function createTabHold() {
  let held = false;
  let used = false;
  let mods = { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
  return {
    /** Tab 按下：有搭配 Ctrl 或 Alt 才開始追蹤，回傳是否要攔下這個按鍵 */
    down(ev: KeyboardEvent): boolean {
      if (ev.key !== 'Tab' || !(ev.ctrlKey || ev.altKey || ev.metaKey)) return false;
      if (!ev.repeat) { held = true; used = false; mods = { ctrlKey: ev.ctrlKey, altKey: ev.altKey, shiftKey: ev.shiftKey, metaKey: ev.metaKey }; }
      return true;
    },
    held: () => held,
    markUsed() { used = true; },
    /** Tab 放開：中間沒按別的鍵就回傳「Ctrl+Tab」這樣的組合 */
    up(ev: KeyboardEvent): string | null {
      if (ev.key !== 'Tab' || !held) return null;
      held = false;
      return used ? null : comboOf({ key: 'Tab', code: 'Tab', ...mods });
    },
    reset() { held = false; used = false; },
  };
}
