import { useRef, useState } from 'react';

const MAX_UNDO = 100;

/**
 * 可復原的狀態。commit 會記下改動前的內容；current 永遠是最新的內容，
 * 連續快速改動（例如一次貼上多欄）時不會互相蓋掉。
 */
export function useUndoable<T>(initial: T) {
  const [value, setValue] = useState(initial);
  const current = useRef(initial);
  const undoStack = useRef<T[]>([]);
  const redoStack = useRef<T[]>([]);

  const commit = (next: T) => {
    undoStack.current = [...undoStack.current, current.current].slice(-MAX_UNDO);
    redoStack.current = [];
    current.current = next;
    setValue(next);
  };

  const move = (from: React.RefObject<T[]>, to: React.RefObject<T[]>) => {
    const prev = from.current.pop();
    if (prev === undefined) return false;
    to.current.push(current.current);
    current.current = prev;
    setValue(prev);
    return true;
  };

  const reset = (v: T) => {
    undoStack.current = [];
    redoStack.current = [];
    current.current = v;
    setValue(v);
  };

  return { value, current, commit, reset, undo: () => move(undoStack, redoStack), redo: () => move(redoStack, undoStack) };
}

/**
 * Ctrl+Z 復原、Ctrl+Y 或 Ctrl+Shift+Z 重做。
 * 游標在一般輸入框裡時交給輸入框自己處理文字復原；接收貼上用的隱藏框除外。
 */
export function handleUndoKeys(ev: React.KeyboardEvent, undo: () => void, redo: () => void) {
  const t = ev.target as HTMLElement;
  if ((t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && !t.classList.contains('pb-sink')) return;
  if (!(ev.ctrlKey || ev.metaKey)) return;
  const k = ev.key.toLowerCase();
  if (k === 'z' && !ev.shiftKey) { ev.preventDefault(); undo(); }
  else if (k === 'y' || (k === 'z' && ev.shiftKey)) { ev.preventDefault(); redo(); }
}
