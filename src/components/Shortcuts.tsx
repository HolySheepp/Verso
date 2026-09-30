import { useEffect } from 'react';
import { currentOf, useStore } from '../state/store';
import { actionFor, comboOf, type ActionId } from '../model/shortcuts';
import { markMenuIds } from './MarkMenu';
import { rowMenuPos } from './rowMenu';

/** 工作用的輸入框：翻譯、驗證模式是譯文框，原文修正模式是原文框 */
function isWorkInput(el: Element | null, mode: string) {
  if (!el) return false;
  if (el.id === 'verso-target') return true;
  return el.id === 'verso-source' && mode === 'source';
}

function isOtherInput(el: Element | null) {
  if (!el) return false;
  const t = el.tagName;
  return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || (el as HTMLElement).isContentEditable;
}

/** 把游標放進工作用的輸入框最後面 */
function focusWorkInput(mode: string) {
  const el = document.getElementById(mode === 'source' ? 'verso-source' : 'verso-target') as HTMLTextAreaElement | null;
  if (!el || el.readOnly) return;
  el.focus();
  el.setSelectionRange(el.value.length, el.value.length);
}

/** 全域快捷鍵：依焦點是否在譯文框分成兩種情境 */
export function Shortcuts() {
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.defaultPrevented || ev.isComposing) return;
      const s = useStore.getState();
      if (!s.project) return;

      // 對話框開著時只處理 Esc 關閉設定與詞條視窗；貼入視窗怕內容遺失，不用 Esc 關
      if (s.settingsOpen || s.termDraft || s.pasteOpen || s.dictPasteOpen) {
        if (ev.key === 'Escape' && !s.pasteOpen && !s.dictPasteOpen) {
          ev.preventDefault();
          s.set({ settingsOpen: false, termDraft: null });
        }
        return;
      }

      // 用快捷鍵打開的標記選單：按數字選取
      if (s.rowMenu?.keys && /^Digit[1-9]$/.test(ev.code) && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
        ev.preventDefault();
        const ids = markMenuIds(s.project.customMarks);
        const id = ids[Number(ev.code.slice(5)) - 1];
        if (id) s.setEntryMark(s.rowMenu.index, id);
        s.set({ rowMenu: null });
        return;
      }
      // Esc 先關掉開著的選單
      if (ev.key === 'Escape' && (s.rowMenu || s.stampOpen || s.fileMenuOpen)) {
        ev.preventDefault();
        s.closePopups();
        return;
      }

      const el = document.activeElement;
      const inWork = isWorkInput(el, s.mode);
      if (!inWork && isOtherInput(el)) return;
      const combo = comboOf(ev);
      if (!combo) return;
      const action = actionFor(s.shortcuts, inWork ? 'input' : 'list', combo);
      if (!action) return;
      ev.preventDefault();
      run(action, el as HTMLElement | null);
    };

    const run = (action: ActionId, el: HTMLElement | null) => {
      const s = useStore.getState();
      const { sel, entry } = currentOf(s);
      const tgtEditable = s.mode === 'translate' || s.mode === 'verify';
      switch (action) {
        case 'main': s.mainNext(); break;
        case 'stampNext': s.stampNext(); break;
        case 'prevEntry': s.step(-1); break;
        case 'nextEntry': s.step(1); break;
        case 'record': s.record(); break;
        case 'leaveInput': el?.blur(); break;
        case 'editEntry': focusWorkInput(s.mode); break;
        case 'clearTgt': if (tgtEditable && entry?.tgt) s.updateEntry({ tgt: '' }); break;
        case 'prevSheet': s.setSheet(currentOf(s).sheetIdx - 1); break;
        case 'nextSheet': s.setSheet(currentOf(s).sheetIdx + 1); break;
        case 'close': s.closePopups(); break;
        case 'newline': {
          const ta = el as HTMLTextAreaElement | null;
          if (!ta || ta.readOnly) break;
          ta.setRangeText('\n', ta.selectionStart, ta.selectionEnd, 'end');
          if (ta.id === 'verso-target') s.updateEntry({ tgt: ta.value });
          else s.updateEntry({ src: ta.value });
          break;
        }
        case 'markMenu': {
          const btn = document.querySelector<HTMLElement>('.rw .row[aria-current="true"]')?.parentElement?.querySelector<HTMLElement>('.mk');
          const pos = btn ? rowMenuPos(btn, s.project!.customMarks.length) : { x: 40, y: 120 };
          s.set({ rowMenu: { index: sel, ...pos, keys: true }, stampOpen: false, fileMenuOpen: false });
          break;
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return null;
}
