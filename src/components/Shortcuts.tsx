import { useEffect } from 'react';
import { currentOf, useStore } from '../state/store';
import { HOLD_ACTIONS, actionFor, comboOf, createTabHold, type ActionId } from '../model/shortcuts';
import { effectiveMark } from '../model/marks';
import { markMenuIds } from './MarkMenu';
import { rowMenuPos } from './rowMenu';
import { saveNow } from '../state/saver';
import { TGT_COL, cellKey, clearCells } from '../model/cells';

/** 工作用的輸入框：翻譯、驗證模式是譯文框，原文修正模式是原文框 */
function isWorkInput(el: Element | null, mode: string) {
  if (!el) return false;
  if (el.id === 'verso-target') return true;
  return el.id === 'verso-source' && mode === 'source';
}

function isOtherInput(el: Element | null) {
  if (!el) return false;
  // 條目欄用來接收複製貼上的隱藏框不算輸入框
  if (el.classList.contains('list-sink')) return false;
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
    const tab = createTabHold();
    // 按住型的快捷鍵：記下是哪個主鍵，放開主鍵或修飾鍵就結束
    let holding: { key: string; mods: string[] } | null = null;
    const stopHold = () => {
      if (!holding) return;
      holding = null;
      useStore.getState().set({ peek: false });
    };

    const onKey = (ev: KeyboardEvent) => {
      if (ev.defaultPrevented || ev.isComposing) return;
      const s = useStore.getState();
      if (!s.project) return;

      // 擋掉瀏覽器的重新整理，避免整個軟體被刷新、內容遺失
      if (ev.key === 'F5' || ((ev.ctrlKey || ev.metaKey) && ev.code === 'KeyR')) ev.preventDefault();

      // 對話框開著時只處理 Esc 關閉設定與詞條視窗；貼入視窗怕內容遺失，不用 Esc 關
      if (s.settingsOpen || s.termDraft || s.pasteOpen || s.dictPasteOpen || s.manageProjectsOpen || s.manageDictsOpen || s.moveTarget) {
        if (ev.key === 'Escape' && s.moveTarget) { ev.preventDefault(); s.set({ moveTarget: null }); return; }
        // 管理字典裡可能有還沒存的詞條修改，不用 Esc 關
        if (ev.key === 'Escape' && !s.pasteOpen && !s.dictPasteOpen && !s.manageDictsOpen) {
          ev.preventDefault();
          s.set({ settingsOpen: false, termDraft: null, accentPreview: null, manageProjectsOpen: false });
        }
        return;
      }

      // 用快捷鍵打開的標記選單：按數字直接選，或用上下鍵移動、Enter 確認
      if (s.rowMenu?.keys && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
        const ids = markMenuIds(s.project.customMarks);
        const menu = s.rowMenu;
        const pick = (id: string | undefined) => {
          if (id) s.setEntryMark(menu.index, id as (typeof ids)[number]);
          s.set({ rowMenu: null });
        };
        if (/^Digit[1-9]$/.test(ev.code)) { ev.preventDefault(); pick(ids[Number(ev.code.slice(5)) - 1]); return; }
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
          ev.preventDefault();
          const d = ev.key === 'ArrowDown' ? 1 : -1;
          s.set({ rowMenu: { ...menu, active: ((menu.active ?? 0) + d + ids.length) % ids.length } });
          return;
        }
        if (ev.key === 'Enter') { ev.preventDefault(); pick(ids[menu.active ?? 0]); return; }
      }

      // Ctrl+Tab 按住時等下一個鍵（例如 →），不直接動作
      if (tab.down(ev)) { ev.preventDefault(); return; }
      // Esc 先關掉開著的選單
      if (ev.key === 'Escape' && (s.rowMenu || s.stampOpen || s.fileMenuOpen)) {
        ev.preventDefault();
        s.closePopups();
        return;
      }

      const combo = comboOf(ev, tab.held());
      if (!combo) return;
      if (tab.held()) { tab.markUsed(); ev.preventDefault(); }
      if (handle(combo)) ev.preventDefault();
    };

    /** 依目前焦點的情境執行快捷鍵，有執行就回傳 true */
    const handle = (combo: string) => {
      const s = useStore.getState();
      if (!s.project || s.settingsOpen || s.termDraft || s.pasteOpen || s.dictPasteOpen) return false;
      const el = document.activeElement;
      const inWork = isWorkInput(el, s.mode);
      // 在備註、搜尋框之類的地方，只有存檔快捷鍵有效
      if (!inWork && isOtherInput(el)) {
        if (actionFor(s.shortcuts, 'list', combo) !== 'save') return false;
        void saveNow();
        return true;
      }
      // 不在輸入框時，Ctrl+Z／Ctrl+Y 復原或重做條目欄與頁簽的操作
      if (!inWork && combo === 'Ctrl+Z') { s.undoSheet(); return true; }
      if (!inWork && (combo === 'Ctrl+Y' || combo === 'Ctrl+Shift+Z')) { s.redoSheet(); return true; }
      const action = actionFor(s.shortcuts, inWork ? 'input' : 'list', combo);
      if (!action) return false;
      // 用滑鼠點過的條目按鈕留著焦點時會顯示外框，用鍵盤移動前先放掉
      if (!inWork && (el as HTMLElement | null)?.closest?.('.rw')) (el as HTMLElement).blur();
      if (HOLD_ACTIONS.includes(action)) {
        const parts = combo.split('+');
        holding = { key: parts[parts.length - 1], mods: parts.slice(0, -1) };
      }
      run(action, el as HTMLElement | null);
      return true;
    };

    // 只按 Ctrl+Tab 就放開時，放開那一刻才算
    const onKeyUp = (ev: KeyboardEvent) => {
      if (holding) {
        const released = comboOf({ key: ev.key, code: ev.code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false });
        const modReleased = (ev.key === 'Control' || ev.key === 'Meta') ? 'Ctrl' : ev.key;
        if (released === holding.key || holding.mods.includes(modReleased)) stopHold();
      }
      const combo = tab.up(ev);
      if (combo) handle(combo);
    };
    const onBlur = () => { tab.reset(); stopHold(); };

    const run = (action: ActionId, el: HTMLElement | null) => {
      const s = useStore.getState();
      const { sel, entry } = currentOf(s);
      switch (action) {
        case 'main': s.mainNext(); break;
        case 'stampNext': s.stampNext(); break;
        case 'prevEntry': s.step(-1); break;
        case 'nextEntry': s.step(1); break;
        case 'prevPending': s.stepPending(-1); break;
        case 'nextPending': s.stepPending(1); break;
        case 'record': s.record(); break;
        case 'leaveInput': el?.blur(); break;
        case 'editEntry': focusWorkInput(s.mode); break;
        case 'clearTgt': {
          // 清除選取的格子（沒特別選時就是這條的譯文）；檢視模式不能改
          if (s.mode === 'view') break;
          const keys = s.cellSel?.keys.length ? s.cellSel.keys : [cellKey(sel, TGT_COL)];
          s.editSheet((es) => ({ entries: clearCells(es, keys), keys }));
          break;
        }
        case 'prevSheet': s.setSheet(currentOf(s).sheetIdx - 1); break;
        case 'nextSheet': s.setSheet(currentOf(s).sheetIdx + 1); break;
        case 'close': s.closePopups(); break;
        case 'save': void saveNow(); break;
        case 'peek': {
          const h = entry && s.history.byEntry[entry.uid];
          if (h?.texts.length) s.set({ peek: true });
          break;
        }
        case 'newline': {
          const ta = el as HTMLTextAreaElement | null;
          if (!ta || ta.readOnly) break;
          ta.setRangeText('\n', ta.selectionStart, ta.selectionEnd, 'end');
          if (ta.id === 'verso-target') s.updateEntry({ tgt: ta.value });
          else s.updateEntry({ src: ta.value });
          break;
        }
        case 'markMenu': {
          if (!entry) break;
          const btn = document.querySelector<HTMLElement>('.rw[aria-current="true"] .mk');
          const pos = btn ? rowMenuPos(btn, s.project!.customMarks.length) : { x: 40, y: 120 };
          const ids = markMenuIds(s.project!.customMarks);
          const active = Math.max(0, ids.indexOf(effectiveMark(currentOf(s).sheet.entries[sel])));
          s.set({ rowMenu: { index: sel, ...pos, keys: true, active }, stampOpen: false, fileMenuOpen: false });
          break;
        }
      }
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
  return null;
}
