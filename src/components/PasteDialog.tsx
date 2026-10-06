import { useEffect, useRef, useState } from 'react';
import { currentOf, currentProjectOf, useStore } from '../state/store';
import { leaveFile } from '../state/saver';
import { NEW, ProjectPicker, nameError, picked } from './Pickers';
import { RenameInput } from './RenameInput';
import { sheetNameError } from '../model/names';
import { COLS, COLS_GRID, checkColumns, columnsToEntries, emptyColumns, pasteColumns, type Columns } from '../model/paste';
import { PasteBox, type BoxSel } from './PasteBox';
import { ContextMenu } from './ContextMenu';
import { dragWindow } from './windowDrag';
import { IconPlus, IconWinClose } from './icons';
import { fz } from '../model/fonts';

interface DraftSheet { id: string; name: string; cols: Columns }
interface Snapshot { sheets: DraftSheet[]; cur: number }

let sheetSeq = 0;
const newSheet = (n: number): DraftSheet => ({ id: 's' + sheetSeq++, name: '頁簽 ' + n, cols: emptyColumns() });
const TAB_GAP = 6;

/** 拖動中的頁簽：from 是被拖的頁簽，to 是放開後的位置，dx 是跟著游標移動的距離 */
interface TabDrag { from: number; to: number; dx: number; lefts: number[]; widths: number[] }
const MAX_UNDO = 100;

/** 手動貼入：建立一個檔案，底下有一或多個頁簽，每個頁簽貼入 id、發話者、原文、譯文四欄 */
export function PasteDialog() {
  const open = useStore((s) => s.pasteOpen);
  // 從頁簽右鍵「插入」打開時，是在目前的檔案插入頁簽，不建立新檔案
  const insert = useStore((s) => s.pasteInsert);
  const existingSheets = useStore((s) => (s.project && s.pasteInsert ? currentOf(s).fileDoc.sheets.length : 0));
  const { set, addFile, insertSheets } = useStore.getState();
  const close = () => set({ pasteOpen: false, pasteInsert: null });
  const [name, setName] = useState('');
  const [projSel, setProjSel] = useState('');
  const [newProj, setNewProj] = useState('');
  const projects = useStore((s) => s.project!.projects);
  const allFiles = useStore((s) => s.project!.files);
  const [sheets, setSheetsState] = useState<DraftSheet[]>([newSheet(1)]);
  const [cur, setCur] = useState(0);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [selRow, setSelRow] = useState<{ key: string; sel: BoxSel } | null>(null);
  const [tabMenu, setTabMenu] = useState<{ i: number; x: number; y: number } | null>(null);
  const [tabDrag, setTabDrag] = useState<TabDrag | null>(null);
  const press = useRef<{ i: number; x: number; moved: boolean } | null>(null);
  // 拖動後放開時會觸發一次點擊，要略過
  const justDragged = useRef(false);
  // 改名開始前的內容，改完有變才算一次改動

  // 復原／重做：記下每次改動前的頁簽內容
  const sheetsRef = useRef(sheets);
  const curRef = useRef(cur);
  curRef.current = cur;
  const undo = useRef<Snapshot[]>([]);
  const redo = useRef<Snapshot[]>([]);

  /** 改動頁簽內容（可復原）。連續快速貼上時用 ref 裡最新的內容，不會互相蓋掉 */
  const commit = (next: DraftSheet[], nextCur?: number) => {
    undo.current = [...undo.current, { sheets: sheetsRef.current, cur: curRef.current }].slice(-MAX_UNDO);
    redo.current = [];
    sheetsRef.current = next;
    setSheetsState(next);
    if (nextCur !== undefined) setCur(nextCur);
  };

  const restore = (from: React.RefObject<Snapshot[]>, to: React.RefObject<Snapshot[]>) => {
    const snap = from.current.pop();
    if (!snap) return;
    to.current.push({ sheets: sheetsRef.current, cur: curRef.current });
    sheetsRef.current = snap.sheets;
    setSheetsState(snap.sheets);
    setCur(Math.min(snap.cur, snap.sheets.length - 1));
    setRenaming(null);
    setSelRow(null);
  };

  // 每次打開都是空白的
  useEffect(() => {
    if (open) {
      const init = [newSheet(existingSheets + 1)];
      sheetsRef.current = init;
      setSheetsState(init);
      undo.current = [];
      redo.current = [];
      setName(''); setProjSel(currentProjectOf(useStore.getState())); setNewProj(''); setCur(0); setRenaming(null); setSelRow(null); setTabMenu(null); setTabDrag(null);
    }
  }, [open]);

  // 換頁簽時清掉選到的那一行
  useEffect(() => { setSelRow(null); }, [cur]);

  if (!open) return null;

  const sheet = sheets[Math.min(cur, sheets.length - 1)];
  const patchSheet = (i: number, fn: (sh: DraftSheet) => Partial<DraftSheet>, record = true) => {
    const next = sheetsRef.current.map((sh, j) => (j === i ? { ...sh, ...fn(sh) } : sh));
    if (record) commit(next);
    else { sheetsRef.current = next; setSheetsState(next); }
  };
  const results = sheets.map((sh) => checkColumns(sh.cols));
  const firstBad = results.findIndex((r) => !r.ok);
  const projName = picked(projSel, newProj);
  const projError = insert ? '' : nameError('專案', projSel, newProj, projects);
  // 同一個專案裡不能有同名檔案（大小寫、存檔後會變成同一個檔名的都算）
  const fileError = insert || !name.trim() ? '' : nameError('檔案', NEW, name, allFiles.filter((f) => f.project === projName).map((f) => f.name));
  const error = projError || fileError || (firstBad < 0 ? '' : (sheets.length > 1 ? `「${sheets[firstBad].name}」` : '') + results[firstBad].msg);
  // 新增專案但還沒打名稱時不能建立
  const blocked = !!error || (!insert && !projName);
  // 還沒貼東西時不顯示錯誤，只擋下建立
  const touched = sheets.some((sh) => COLS.some((c) => sh.cols[c.key]));

  const create = () => {
    if (blocked) return;
    if (insert) {
      insertSheets(insert.after, sheets.map((sh, i) => ({ name: sh.name.trim() || '頁簽 ' + (existingSheets + i + 1), entries: columnsToEntries(sh.cols) })));
      return;
    }
    const doc = {
      name: name.trim() || '未命名檔案',
      project: projName,
      sheets: sheets.map((sh, i) => ({ name: sh.name.trim() || '頁簽 ' + (i + 1), entries: columnsToEntries(sh.cols) })),
    };
    // 建立新檔案會換到新檔案：目前的檔案有未存的修改就先問
    leaveFile(null, () => addFile(doc));
  };

  const addSheet = () => commit([...sheets, newSheet(existingSheets + sheets.length + 1)], sheets.length);

  const insertSheet = (i: number) =>
    commit([...sheets.slice(0, i + 1), newSheet(sheets.length + 1), ...sheets.slice(i + 1)], i + 1);

  const removeSheet = (i: number) => {
    const next = sheets.filter((_, j) => j !== i);
    commit(next, Math.max(0, Math.min(cur >= i ? cur - 1 : cur, next.length - 1)));
  };

  /** 整段改名算一次改動 */
  const startRename = (i: number) => {
    setCur(i);
    setRenaming(i);
  };


  const onTabMenu = (key: string, i: number) => {
    setTabMenu(null);
    if (key === 'rename') startRename(i);
    if (key === 'clear') patchSheet(i, () => ({ cols: emptyColumns() }));
    if (key === 'delete' && sheets.length > 1) removeSheet(i);
    if (key === 'insert') insertSheet(i);
  };

  // 拖動頁簽：像瀏覽器分頁一樣，被拖的頁簽跟著游標走，其他頁簽滑開讓位
  const onTabPointerDown = (ev: React.PointerEvent<HTMLButtonElement>, i: number) => {
    if (ev.button !== 0) return;
    press.current = { i, x: ev.clientX, moved: false };
    try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch { /* 無法捕捉時照常運作 */ }
  };
  const onTabPointerMove = (ev: React.PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p) return;
    if (!p.moved && Math.abs(ev.clientX - p.x) < 5) return;
    let d = tabDrag;
    if (!p.moved || !d) {
      // 開始拖動時量好每個頁簽的位置
      p.moved = true;
      const list = ev.currentTarget.closest('[role=tablist]') as HTMLElement;
      const items = Array.from(list.querySelectorAll<HTMLElement>('[data-tab-idx]'));
      d = { from: p.i, to: p.i, dx: 0, lefts: items.map((el) => el.getBoundingClientRect().left), widths: items.map((el) => el.getBoundingClientRect().width) };
    }
    const { from, lefts, widths } = d;
    const n = lefts.length;
    // 不能拖出頁簽列的範圍
    const minDx = lefts[0] - lefts[from];
    const maxDx = lefts[n - 1] + widths[n - 1] - widths[from] - lefts[from];
    const dx = Math.max(minDx, Math.min(maxDx, ev.clientX - p.x));
    // 被拖的頁簽邊緣一越過旁邊頁簽的中心點就交換：往左看左邊緣，往右看右邊緣
    const left = lefts[from] + dx, right = left + widths[from];
    let to = from;
    for (let j = 0; j < from; j++) {
      if (left < lefts[j] + widths[j] / 2) { to = j; break; }
    }
    for (let j = n - 1; j > from; j--) {
      if (right > lefts[j] + widths[j] / 2) { to = j; break; }
    }
    setTabDrag({ ...d, dx, to });
  };
  const onTabPointerUp = () => {
    const p = press.current;
    press.current = null;
    if (!p?.moved || !tabDrag) { setTabDrag(null); return; }
    justDragged.current = true;
    setTimeout(() => { justDragged.current = false; }, 0);
    const { from, to } = tabDrag;
    setTabDrag(null);
    if (to === from) return;
    const next = [...sheets];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    commit(next, to);
  };

  /** 拖動中各頁簽的位移：被拖的跟著游標，其他的讓出位置 */
  const tabShift = (i: number) => {
    if (!tabDrag) return 0;
    const { from, to, dx, widths } = tabDrag;
    if (i === from) return dx;
    const room = widths[from] + TAB_GAP;
    if (from < to && i > from && i <= to) return -room;
    if (to < from && i >= to && i < from) return room;
    return 0;
  };

  const onKeyDown = (ev: React.KeyboardEvent) => {
    const t = ev.target as HTMLElement;
    // 輸入框裡照一般的文字復原；接收貼上用的隱藏框除外
    if ((t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && !t.classList.contains('pb-sink')) return;
    if (!(ev.ctrlKey || ev.metaKey)) return;
    const k = ev.key.toLowerCase();
    if (k === 'z' && !ev.shiftKey) { ev.preventDefault(); restore(undo, redo); }
    else if (k === 'y' || (k === 'z' && ev.shiftKey)) { ev.preventDefault(); restore(redo, undo); }
  };

  return (
    <div className="scrim" style={{ zIndex: 45 }} onKeyDown={onKeyDown}>
      <div role="dialog" aria-modal="true" aria-labelledby="verso-paste-title" className="dialog"
        style={{ width: 960, height: 640, maxWidth: 'calc(100% - 48px)', maxHeight: 'calc(100% - 48px)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>
        {/* 只有拖最上面的橫條才會移動整個軟體 */}
        <div onMouseDown={dragWindow} style={{ height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px 0 20px', borderBottom: '1px solid var(--line)' }}>
          <h2 id="verso-paste-title" style={{ margin: 0, fontSize: fz(15), fontWeight: 600 }}>{insert ? '插入頁簽' : '手動貼入'}</h2>
          <button type="button" className="ib" aria-label="關閉" onClick={close}
            style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 0, borderRadius: 8, color: 'var(--text2)' }}>
            <IconWinClose size={13} sw={1.4} />
          </button>
        </div>

        <div style={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 14, padding: '16px 20px' }}>
          {!insert && <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <label htmlFor="verso-paste-name" style={{ fontSize: fz(12), color: 'var(--text2)', flexShrink: 0 }}>檔名</label>
            <input id="verso-paste-name" type="text" className="field" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="未命名檔案" autoFocus aria-invalid={!!fileError} style={{ width: 320, borderColor: fileError ? 'var(--errtx)' : undefined }} />
            <label htmlFor="verso-paste-proj" style={{ marginLeft: 8, fontSize: fz(12), color: 'var(--text2)', flexShrink: 0 }}>專案</label>
            <ProjectPicker id="verso-paste-proj" sel={projSel} newName={newProj} onSel={setProjSel} onNewName={setNewProj} width={160} />
          </div>}

          <div style={{ display: 'flex', alignItems: 'center', gap: TAB_GAP, borderBottom: '1px solid var(--line)' }}>
          <div role="tablist" aria-label="頁簽" className="no-scrollbar" style={{ display: 'flex', alignItems: 'center', gap: TAB_GAP, minWidth: 0, overflowX: 'auto', overflowY: 'hidden' }}>
            {sheets.map((sh, i) => {
              const on = i === cur;
              const dragging = tabDrag?.from === i;
              return (
                <div key={sh.id} data-tab-idx={i} style={{
                  position: 'relative', flexShrink: 0, display: 'flex', alignItems: 'center', borderBottom: `2px solid ${on ? 'var(--accent)' : 'transparent'}`,
                  transform: `translateX(${tabShift(i)}px)`,
                  // 只有拖動中的其他頁簽有滑動動畫；放開後直接定位，不會跳動
                  transition: tabDrag && !dragging ? 'transform 160ms cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none',
                  zIndex: dragging ? 2 : undefined,
                  background: dragging ? 'var(--hv1)' : undefined,
                  borderRadius: dragging ? '6px 6px 0 0' : undefined,
                  boxShadow: dragging ? '0 4px 14px rgba(0,0,0,0.25)' : undefined,
                }}>
                  {renaming === i ? (
                    <RenameInput initial={sh.name} label="頁簽名稱"
                      validate={(v) => sheetNameError(v, sheets.filter((_, j) => j !== i).map((x) => x.name))}
                      onDone={(v) => { if (v) patchSheet(i, () => ({ name: v })); setRenaming(null); }}
                      style={{ height: 28, width: 140, margin: '4px 0', padding: '0 8px' }} />
                  ) : (
                    <button type="button" role="tab" className="stab" aria-selected={on} title="雙擊改名"
                      onClick={() => { if (justDragged.current) { justDragged.current = false; return; } setCur(i); }}
                      onDoubleClick={() => startRename(i)}
                      onPointerDown={(ev) => onTabPointerDown(ev, i)} onPointerMove={onTabPointerMove}
                      onPointerUp={onTabPointerUp} onPointerCancel={() => { press.current = null; setTabDrag(null); }}
                      onContextMenu={(ev) => { ev.preventDefault(); setCur(i); setTabMenu({ i, x: ev.clientX, y: ev.clientY }); }}
                      style={{
                        height: 36, padding: '0 10px', background: 'transparent', border: 0, fontSize: fz(13), fontWeight: 500,
                        color: on ? 'var(--text)' : 'var(--mute)', whiteSpace: 'nowrap', cursor: tabDrag ? 'grabbing' : undefined, touchAction: 'none',
                      }}>
                      {sh.name || '頁簽 ' + (i + 1)}
                    </button>
                  )}
                  {sheets.length > 1 && renaming !== i && (
                    <button type="button" className="ib" aria-label={'移除頁簽「' + sh.name + '」'} title="移除" onClick={() => removeSheet(i)}
                      style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'transparent', border: 0, borderRadius: 5, color: 'var(--mute)' }}>
                      <IconWinClose size={9} sw={1.4} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
            <button type="button" className="ib side-hb" aria-label="新增頁簽" title="新增頁簽" onClick={addSheet}>
              <IconPlus size={14} />
            </button>
          </div>

          <div role="tabpanel" style={{ flexGrow: 1, minHeight: 0, display: 'grid', gridTemplateColumns: COLS_GRID, gap: 12, overflowX: 'auto' }}>
            {COLS.map((c) => (
              <PasteBox key={cur + c.key} label={c.label} required={c.key === 'src'} col={sheet.cols[c.key]} fontSlot={c.key === 'id' || c.key === 'speaker' ? c.key : undefined}
                onPaste={(values, start) => patchSheet(cur, (sh) => ({ cols: { ...sh.cols, ...pasteColumns(COLS.map((x) => x.key), c.key, values, sh.cols, start) } }))}
                onChange={(col) => patchSheet(cur, (sh) => ({ cols: { ...sh.cols, [c.key]: col } }))}
                selected={selRow?.key === c.key ? selRow.sel : null}
                onSelect={(sel) => setSelRow(sel === null ? null : { key: c.key, sel })} />
            ))}
          </div>
        </div>

        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 20px 16px', borderTop: '1px solid var(--line)' }}>
          <span role="alert" style={{ fontSize: fz(12.5), color: 'var(--errtx)', minWidth: 0 }}>{touched || projError || fileError ? error : ''}</span>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button type="button" className="btn btn-ghost" onClick={close}
              style={{ height: 36, padding: '0 16px', background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, fontSize: fz(13) }}>取消</button>
            <button type="button" className="btn btn-primary" disabled={blocked} onClick={create}
              style={{ height: 36, padding: '0 18px', background: 'var(--primary)', border: 0, borderRadius: 8, color: '#ffffff', fontSize: fz(13), fontWeight: 600 }}>建立</button>
          </div>
        </div>
      </div>
      {tabMenu && (
        <ContextMenu x={tabMenu.x} y={tabMenu.y} label={'頁簽「' + (sheets[tabMenu.i]?.name ?? '') + '」'}
          items={[
            { key: 'rename', label: '重新命名' },
            { key: 'clear', label: '清空' },
            { key: 'delete', label: '刪除', danger: true, disabled: sheets.length <= 1 },
            { key: 'insert', label: '插入' },
          ]}
          onPick={(k) => onTabMenu(k, tabMenu.i)}
          onClose={() => setTabMenu(null)} />
      )}
    </div>
  );
}
