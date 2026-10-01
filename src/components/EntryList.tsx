import { memo, useEffect, useRef, useState } from 'react';
import { currentOf, useStorePick, visibleIssues, type Filter } from '../state/store';
import { effectiveMark, markName, markVisual } from '../model/marks';
import { columnToClipboard, parseHtmlTable, parseTsv, writeColumn } from '../model/clipboard';
import {
  TGT_COL, cellKey, clearCells, copyMatrix, deleteCells, getCell, insertCells, moveCells, parseKey, pasteMatrix, rectKeys, setCell,
  type Cell, type CellCol,
} from '../model/cells';
import { ContextMenu } from './ContextMenu';
import { focusOnMount } from './windowDrag';
import { MarkIcon } from './MarkIcon';
import { rowMenuPos } from './rowMenu';
import { CopyConfirm } from './CopyConfirm';
import { IconCheck, IconCopy, IconRuler, IconScan, IconWarn } from './icons';
import { stdLabel } from '../model/length';
import { fz, overflowOf, type Overflow } from '../model/fonts';
import type { CustomMark, Entry, MarkId } from '../model/types';
import type { Issue } from '../model/checks';
import { CellText } from './CellText';

/** # 欄（對話 id）、發話者欄、原文、譯文：依比例分配寬度 */
const colsOf = (w: number[]) => w.map((x) => `minmax(0, ${x}fr)`).join(' ');
const HEADS = ['#', '發話者', '原文', '譯文'];
/** 條目欄的原文、譯文比工作欄小一點 */
const SRC_FS = 'calc(var(--fs-src) * 13 / 15)';
const TGT_FS = 'calc(var(--fs-tgt) * 13 / 15)';
/** 拖動欄寬時每欄至少留這麼寬 */
const MIN_COL_PX = 24;

/** 往下／往上移動時，前方保留幾條看得到 */
const KEEP_VISIBLE = 3;

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'untranslated', label: '未翻譯' },
  { id: 'doubt', label: '疑慮' },
  { id: 'think', label: '待思考' },
  { id: 'issues', label: '有問題' },
];

/** 條目欄一行要用到的操作；放在 ref 裡，行元件拿到的參照永遠不變，才不會因此整排重畫 */
interface RowHandlers {
  cellDown(ev: React.MouseEvent, i: number, c: CellCol): void;
  cellEnter(ev: React.MouseEvent, i: number, c: CellCol): void;
  startEdit(i: number, c: CellCol): void;
  cellMenu(ev: React.MouseEvent): void;
  openMark(ev: React.MouseEvent<HTMLButtonElement>, i: number): void;
  rowPick(ev: React.MouseEvent, i: number): void;
  rowEnter(ev: React.MouseEvent, i: number): void;
  editText(text: string): void;
  /** refocus：結束後把焦點交回條目欄 */
  commitEdit(refocus: boolean): void;
  cancelEdit(): void;
}

interface RowProps {
  e: Entry;
  i: number;
  m: MarkId;
  issues: Issue[];
  on: boolean;
  /** 這一行選到的欄，例如 "0,3" */
  selCols: string;
  /** 這一行正在格子裡編輯的話 */
  editing: { c: CellCol; text: string } | null;
  customs: CustomMark[];
  cols: string;
  ovfId: Overflow; ovfSpk: Overflow; ovfSrc: Overflow; ovfTgt: Overflow;
  h: React.RefObject<RowHandlers>;
}

/** 條目欄的一行：只有自己的內容、選取、標記等變了才重畫 */
const EntryRow = memo(function EntryRow({ e, i, m, issues, on, selCols, editing, customs, cols, ovfId, ovfSpk, ovfSrc, ovfTgt, h }: RowProps) {
  const doubt = m === 'doubt', ver = m === 'verified', ign = m === 'ignore';
  const label = '標記：' + markName(customs, m) + '，點擊變更';
  const cellProps = (c: CellCol) => {
    const isSel = selCols.includes(String(c));
    return {
      'data-cell': cellKey(i, c),
      'aria-selected': isSel,
      onMouseDown: (ev: React.MouseEvent) => h.current.cellDown(ev, i, c),
      onMouseEnter: (ev: React.MouseEvent) => h.current.cellEnter(ev, i, c),
      onDoubleClick: () => h.current.startEdit(i, c),
      onContextMenu: (ev: React.MouseEvent) => h.current.cellMenu(ev),
      className: 'cell' + (isSel ? ' cell-sel' : ''),
    };
  };
  const editor = (c: CellCol) => (editing && editing.c === c ? (
    <textarea className="cell-edit" ref={focusOnMount} value={editing.text} spellCheck={false}
      rows={Math.max(1, editing.text.split('\n').length)}
      onMouseDown={(ev) => ev.stopPropagation()}
      onChange={(ev) => h.current.editText(ev.target.value)}
      onKeyDown={(ev) => {
        ev.stopPropagation();
        if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); h.current.commitEdit(true); }
        if (ev.key === 'Escape') { ev.preventDefault(); h.current.cancelEdit(); }
      }}
      onBlur={() => h.current.commitEdit(false)} />
  ) : null);
  return (
    <div key={e.uid} className="rw" aria-current={on ? 'true' : undefined} style={{
      display: 'grid', gridTemplateColumns: '24px 16px minmax(0, 1fr)', padding: '0 12px 0 4px',
      borderTop: `1px solid ${doubt ? 'var(--dbline)' : 'transparent'}`,
      borderBottom: `1px solid ${doubt ? 'var(--dbline)' : 'transparent'}`,
      background: doubt ? (on ? 'var(--dbon)' : 'var(--db)') : 'transparent',
    }}>
      <button type="button" className="mk" aria-haspopup="menu" aria-label={label} title={label} onClick={(ev) => h.current.openMark(ev, i)}
        style={{ width: 24, minHeight: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'transparent', border: 0, borderRadius: 4 }}>
        <MarkIcon mark={markVisual(customs, m)} size={14} />
      </button>
      <span className="row-pick" onMouseDown={(ev) => h.current.rowPick(ev, i)} onMouseEnter={(ev) => h.current.rowEnter(ev, i)} style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start', justifyContent: 'center' }}>
        {e.lengthStd !== undefined && (
          <span role="img" aria-label="特殊長度標準" title={'特殊標準：' + stdLabel(e.lengthStd)} style={{ display: 'flex', color: 'var(--accent2)' }}><IconRuler size={11} sw={2.2} /></span>
        )}
        {e.note && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2.2" strokeLinejoin="round" role="img" aria-label="有備註">
            <title>有備註</title><path d="M4 5h16v11H9.5L4 20.5z" />
          </svg>
        )}
      </span>
      <div role="row" style={{ minWidth: 0, minHeight: 38, display: 'grid', gridTemplateColumns: cols, alignItems: 'stretch', fontSize: fz(13) }}>
        <span {...cellProps(0)} title={e.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', minWidth: 0, padding: '4px 0', fontFamily: 'var(--font-id)', fontSize: 'var(--fs-id)' }}>
          {editor(0) ?? <CellText mode={ovfId} fontSize="var(--fs-id)" style={{ paddingRight: 2, textAlign: 'right', color: ver ? 'var(--mute3)' : 'var(--mute)' }}>{e.id}</CellText>}
        </span>
        <span {...cellProps(1)} title={e.speaker} style={{ display: 'flex', alignItems: 'center', minWidth: 0, padding: '4px 8px 4px 4px', fontFamily: 'var(--font-spk)', fontSize: 'var(--fs-spk)', color: ver ? 'var(--mute3)' : 'var(--text2)' }}>
          {editor(1) ?? <CellText mode={ovfSpk} fontSize="var(--fs-spk)">{e.speaker}</CellText>}
        </span>
        <span {...cellProps(2)} style={{ display: 'flex', alignItems: 'center', minWidth: 0, padding: '9px 16px 9px 0', lineHeight: 1.45, color: ver ? 'var(--mute2)' : 'var(--text)', fontSize: SRC_FS, fontFamily: 'var(--font-src)' }}>
          {editor(2) ?? <CellText mode={ovfSrc} fontSize={SRC_FS}>{e.src}</CellText>}
        </span>
        <span {...cellProps(3)} style={{
          fontSize: TGT_FS, fontFamily: 'var(--font-tgt)',
          display: 'flex', alignItems: 'center', minWidth: 0, padding: '9px 16px', lineHeight: 1.45, borderLeft: '1px solid var(--line0)',
          color: ver ? 'var(--mute2)' : e.tgt ? 'var(--textsoft)' : 'var(--mute2)', fontStyle: e.tgt ? 'normal' : 'italic',
        }}>
          {editor(3) ?? (
            <CellText mode={ovfTgt} fontSize={TGT_FS}>
              {issues.length > 0 && (
                <span role="img" aria-label={issues.map((x) => x.msg).join('、')} title={issues.map((x) => x.msg).join('、')}
                  style={{ display: 'inline-flex', verticalAlign: '-2px', marginRight: 6, color: 'var(--warntx)', fontStyle: 'normal' }}>
                  <IconWarn size={13} sw={2.2} />
                </span>
              )}
              {e.tgt || (ign ? '不需翻譯' : '尚未翻譯')}
            </CellText>
          )}
        </span>
      </div>
    </div>
  );
});

export function EntryList() {
  // 只訂閱這個區塊用到的資料（包含 currentOf 等輔助函式間接用到的）
  const s = useStorePick('project', 'file', 'sheetBy', 'selBy', 'mode', 'fonts', 'colWidths', 'cellSel', 'filter', 'reported', 'checkSettings', 'moveDir', 'moveSeq', 'set', 'select', 'selectCells', 'editSheet', 'undoSheet', 'redoSheet', 'checkAll');
  const project = s.project!;
  const { sheet, sheetIdx, sel } = currentOf(s);
  const filter = s.filter;
  const { set } = s;
  const customs = project.customMarks;
  const listRef = useRef<HTMLDivElement>(null);
  const [confirm, setConfirm] = useState<{ untranslated: number; pending: number } | null>(null);
  const [copied, setCopied] = useState(false);
  // 接收鍵盤、複製貼上用的隱藏文字框；點條目欄時焦點交給它，這樣 Ctrl+C／V 才會作用在條目欄
  const sink = useRef<HTMLTextAreaElement>(null);
  const drag = useRef<Cell | null>(null);
  // 點欄標題選整欄：按下的那一欄，以及按下前已選的格子（Ctrl 加選時保留）
  const colDrag = useRef<{ c: number; base: string[] } | null>(null);
  const headRef = useRef<HTMLDivElement>(null);
  // 從條目最左邊按住拖動：起點那一條，以及按下前已選的格子（Ctrl 加選時保留）
  const rowDrag = useRef<{ i: number; base: string[] } | null>(null);
  // 滑鼠按住期間記下按下的位置：這段時間不自動捲動，也要真的移動了才算拖動選取
  const pressAt = useRef<{ x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState<{ i: number; c: CellCol; text: string } | null>(null);
  const readOnly = s.mode === 'view';
  const ovf = { id: overflowOf(s.fonts, 'id'), speaker: overflowOf(s.fonts, 'speaker'), src: overflowOf(s.fonts, 'src'), tgt: overflowOf(s.fonts, 'tgt') };

  // 換條目時讓目前這條保持在可見範圍。
  // 用下一條或快捷鍵往下（上）移動時，下方（上方）至少保留 3 條看得到；滑鼠點選只確保這條看得到。
  const handledMove = useRef(s.moveSeq);
  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector('[aria-current="true"]')?.closest('.rw') as HTMLElement | null;
    if (!list || !row) return;
    const keyboard = handledMove.current !== s.moveSeq;
    handledMove.current = s.moveSeq;
    // 滑鼠按著時不捲動：捲動會讓游標下的格子變成別格，被當成拖動選取
    if (pressAt.current) return;
    row.scrollIntoView({ block: 'nearest' });
    if (!keyboard) return;
    const rowsEls = Array.from(list.querySelectorAll<HTMLElement>('.rw'));
    const k = rowsEls.indexOf(row);
    const box = list.getBoundingClientRect();
    if (s.moveDir > 0) {
      const edge = rowsEls[Math.min(k + KEEP_VISIBLE, rowsEls.length - 1)].getBoundingClientRect();
      if (edge.bottom > box.bottom) list.scrollTop += edge.bottom - box.bottom;
    } else {
      const edge = rowsEls[Math.max(k - KEEP_VISIBLE, 0)].getBoundingClientRect();
      if (edge.top < box.top) list.scrollTop -= box.top - edge.top;
    }
  }, [s.file, sheetIdx, sel, s.moveSeq]);

  // 複製譯文欄：未翻譯的留空，待確認的照原本譯文輸出
  const doCopy = async () => {
    setConfirm(null);
    await writeColumn(sheet.entries.map((e) => e.tgt));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const askCopy = () => {
    const open = sheet.entries.filter((e) => e.mark !== 'ignore');
    const untranslated = open.filter((e) => !e.tgt).length;
    const pending = open.filter((e) => e.tgt && e.pending).length;
    if (untranslated || pending) setConfirm({ untranslated, pending });
    else void doCopy();
  };

  const fileStd = currentOf(s).fileDoc.lengthStd;
  const issuesOf = (e: (typeof sheet.entries)[number]) => visibleIssues(e, s.reported, s.checkSettings, fileStd);
  const cnt: Record<string, number> = { untranslated: 0, doubt: 0, think: 0, issues: 0 };
  sheet.entries.forEach((e) => {
    const m = effectiveMark(e);
    if (m in cnt) cnt[m]++;
    if (issuesOf(e).length) cnt.issues++;
  });

  const openMark = (ev: React.MouseEvent<HTMLButtonElement>, i: number) => {
    set({ rowMenu: { index: i, ...rowMenuPos(ev.currentTarget, customs.length) }, stampOpen: false, fileMenuOpen: false });
  };

  const rows = sheet.entries
    .map((e, i) => ({ e, i, m: effectiveMark(e), issues: issuesOf(e) }))
    .filter(({ m, issues }) => filter === 'all' || (filter === 'issues' ? issues.length > 0 : m === filter));
  const visible = rows.map((x) => x.i);

  // 選到的格子；沒有特別選時就是目前這條的譯文格
  const keys = s.cellSel?.keys.length ? s.cellSel.keys : [cellKey(sel, TGT_COL)];
  const selected = new Set(keys);
  // 每一行選到哪幾欄（給行元件比對用的字串）
  const selByRow = new Map<number, number[]>();
  keys.forEach((k) => { const { i, c } = parseKey(k); if (!selByRow.has(i)) selByRow.set(i, []); selByRow.get(i)!.push(c); });
  const selColsOf = (i: number) => (selByRow.get(i) ?? []).sort().join(',');
  const cols = colsOf(s.colWidths);
  const anchor = s.cellSel?.anchor ?? { i: sel, c: TGT_COL };
  const order = (a: string, b: string) => {
    const pa = parseKey(a), pb = parseKey(b);
    return visible.indexOf(pa.i) - visible.indexOf(pb.i) || pa.c - pb.c;
  };
  const firstOf = (ks: string[]) => parseKey([...ks].sort(order)[0]).i;
  const pick = (ks: string[], a: Cell) => s.selectCells(ks, a, firstOf(ks));

  // 選取（單擊、Shift 延伸、Ctrl 加選、拖動）
  const onCellDown = (ev: React.MouseEvent, i: number, c: CellCol) => {
    if (editing) commitEdit();
    if (ev.button === 2) {
      if (!selected.has(cellKey(i, c))) pick([cellKey(i, c)], { i, c });
      return;
    }
    if (ev.button !== 0) return;
    ev.preventDefault();
    sink.current?.focus({ preventScroll: true });
    const cell = { i, c };
    if (ev.shiftKey) { pick(rectKeys(visible, anchor, cell), anchor); return; }
    if (ev.ctrlKey || ev.metaKey) {
      const k = cellKey(i, c);
      const next = selected.has(k) ? keys.filter((x) => x !== k) : [...keys, k];
      pick(next.length ? next : [k], cell);
      return;
    }
    drag.current = cell;
    pressAt.current = { x: ev.clientX, y: ev.clientY };
    pick([cellKey(i, c)], cell);
  };
  const onCellEnter = (ev: React.MouseEvent, i: number, c: CellCol) => {
    if (rowDrag.current) { onRowEnter(ev, i); return; }
    if (!drag.current || !(ev.buttons & 1) || !pressAt.current) return;
    if (Math.abs(ev.clientX - pressAt.current.x) + Math.abs(ev.clientY - pressAt.current.y) < 4) return;
    pick(rectKeys(visible, drag.current, { i, c }), drag.current);
  };
  useEffect(() => {
    const up = () => { drag.current = null; rowDrag.current = null; colDrag.current = null; pressAt.current = null; };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  // 編輯某一格（雙擊或右鍵選單的「編輯」）
  // 原文、譯文要在下面工作欄的輸入框編輯；#、發話者只在原文修正模式可以直接在格子裡改
  const canEdit = (c: CellCol) =>
    c === TGT_COL ? s.mode === 'translate' || s.mode === 'verify' : s.mode === 'source';
  const startEdit = (i: number, c: CellCol) => {
    if (!canEdit(c)) return;
    if (c >= 2) {
      if (i !== sel) s.select(s.file, sheetIdx, i);
      // 等工作欄換成這一條再把游標放進輸入框
      setTimeout(() => {
        const el = document.getElementById(c === TGT_COL ? 'verso-target' : 'verso-source') as HTMLTextAreaElement | null;
        if (!el || el.readOnly) return;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }, 0);
      return;
    }
    setEditing({ i, c, text: getCell(sheet.entries[i], c) });
  };

  // 點條目最左邊（標記右邊那一小格）選整條；Shift、Ctrl 一樣可以延伸或加選
  const rowKeys = (i: number) => [0, 1, 2, 3].map((c) => cellKey(i, c));
  const onRowPick = (ev: React.MouseEvent, i: number) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    if (editing) commitEdit();
    sink.current?.focus({ preventScroll: true });
    const cell: Cell = { i, c: 0 };
    if (ev.shiftKey) {
      const a = visible.indexOf(anchor.i), b = visible.indexOf(i);
      const [p0, p1] = a < b ? [a, b] : [b, a];
      pick(visible.slice(Math.max(0, p0), p1 + 1).flatMap(rowKeys), anchor);
      return;
    }
    if (ev.ctrlKey || ev.metaKey) {
      const add = rowKeys(i).some((k) => !selected.has(k));
      const next = add ? [...new Set([...keys, ...rowKeys(i)])] : keys.filter((k) => parseKey(k).i !== i);
      pick(next.length ? next : rowKeys(i), cell);
      rowDrag.current = { i, base: add ? keys : next };
      pressAt.current = { x: ev.clientX, y: ev.clientY };
      return;
    }
    pick(rowKeys(i), cell);
    rowDrag.current = { i, base: [] };
    pressAt.current = { x: ev.clientX, y: ev.clientY };
  };
  // 點欄標題選整欄；Shift 延伸、Ctrl 加選，按住拖過的欄一起選
  const colKeys = (c0: number, c1: number) => {
    const [a, b] = c0 < c1 ? [c0, c1] : [c1, c0];
    return visible.flatMap((i) => Array.from({ length: b - a + 1 }, (_, k) => cellKey(i, a + k)));
  };
  const onHeadDown = (ev: React.MouseEvent, c: number) => {
    if (ev.button !== 0 || !visible.length) return;
    ev.preventDefault();
    if (editing) commitEdit();
    sink.current?.focus({ preventScroll: true });
    const cell: Cell = { i: visible[0], c: c as CellCol };
    if (ev.shiftKey) { pick(colKeys(anchor.c, c), { i: visible[0], c: anchor.c }); return; }
    const base = ev.ctrlKey || ev.metaKey ? keys : [];
    pick([...new Set([...base, ...colKeys(c, c)])], cell);
    colDrag.current = { c, base };
  };
  const onHeadEnter = (ev: React.MouseEvent, c: number) => {
    const d = colDrag.current;
    if (!d || !(ev.buttons & 1)) return;
    pick([...new Set([...d.base, ...colKeys(d.c, c)])], { i: visible[0], c: d.c as CellCol });
  };
  // 拖動欄標題之間的分隔線調整欄寬：只動左右兩欄，總寬不變
  const onResizeDown = (ev: React.MouseEvent, c: number) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    const head = headRef.current;
    if (!head) return;
    const w0 = s.colWidths;
    const total = w0.reduce((a, b) => a + b, 0);
    const px = head.getBoundingClientRect().width;
    const startX = ev.clientX;
    const pair = w0[c] + w0[c + 1];
    const min = Math.min(pair / 2, (MIN_COL_PX / px) * total);
    const move = (e: MouseEvent) => {
      const d = ((e.clientX - startX) / px) * total;
      const left = Math.max(min, Math.min(pair - min, w0[c] + d));
      const next = [...w0];
      next[c] = left;
      next[c + 1] = pair - left;
      s.set({ colWidths: next });
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); document.body.style.cursor = ''; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    document.body.style.cursor = 'col-resize';
  };

  // 按住拖過的條目整條選起來
  const onRowEnter = (ev: React.MouseEvent, i: number) => {
    const d = rowDrag.current;
    if (!d || !(ev.buttons & 1)) return;
    const a = visible.indexOf(d.i), b = visible.indexOf(i);
    const [p0, p1] = a < b ? [a, b] : [b, a];
    const rows = visible.slice(Math.max(0, p0), p1 + 1).flatMap(rowKeys);
    pick([...new Set([...d.base, ...rows])], { i: d.i, c: 0 });
  };
  const commitEdit = () => {
    const ed = editing;
    setEditing(null);
    if (!ed || !sheet.entries[ed.i] || getCell(sheet.entries[ed.i], ed.c) === ed.text) return;
    s.editSheet((es) => ({
      entries: es.map((e, j) => (j !== ed.i ? e : { ...setCell(e, ed.c, ed.text), ...(ed.c === TGT_COL ? { pending: false } : {}) })),
      keys: [cellKey(ed.i, ed.c)],
    }));
  };

  const menuAct = (k: string) => {
    setMenu(null);
    sink.current?.focus({ preventScroll: true });
    if (readOnly) return;
    const first = parseKey([...keys].sort(order)[0]);
    if (k === 'edit') startEdit(first.i, first.c);
    if (k === 'clear') s.editSheet((es) => ({ entries: clearCells(es, keys), keys }));
    if (k === 'delete') s.editSheet((es) => ({ entries: deleteCells(es, keys), keys }));
    if (k === 'insert') {
      const cols = [...new Set(keys.map((x) => parseKey(x).c))];
      s.editSheet((es) => ({ entries: insertCells(es, keys), keys: cols.map((c) => cellKey(first.i + 1, c)) }));
    }
    if (k === 'up' || k === 'down') s.editSheet((es) => moveCells(es, keys, k === 'up' ? -1 : 1));
  };

  // 複製、貼上、全選、復原（只在焦點位於條目欄時）
  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '<br>');
  const onCopy = (ev: React.ClipboardEvent) => {
    ev.preventDefault();
    const m = copyMatrix(sheet.entries, visible, keys);
    ev.clipboardData.setData('text/html', '<table><tbody>' + m.map((r) => '<tr>' + r.map((v) => '<td>' + esc(v) + '</td>').join('') + '</tr>').join('') + '</tbody></table>');
    ev.clipboardData.setData('text/plain', m.map((r) => r.map((v) => columnToClipboard([v]).text).join('\t')).join('\n'));
  };
  const onPaste = (ev: React.ClipboardEvent) => {
    ev.preventDefault();
    if (readOnly) return;
    const html = ev.clipboardData.getData('text/html');
    const matrix = (html && parseHtmlTable(html)) || parseTsv(ev.clipboardData.getData('text/plain'));
    if (!matrix.length) return;
    const top = parseKey([...keys].sort(order)[0]);
    // 空的頁簽從第一欄（#）開始貼
    const firstCol = (sheet.entries.length ? Math.min(...keys.map((x) => parseKey(x).c)) : 0) as CellCol;
    s.editSheet((es) => {
      const r2 = pasteMatrix(es, visible, { i: top.i, c: firstCol }, matrix);
      const width = Math.min(Math.max(...matrix.map((x) => x.length)), 4 - firstCol);
      return { entries: r2.entries, keys: r2.touched.flatMap((i) => Array.from({ length: width }, (_, j) => cellKey(i, firstCol + j))) };
    });
  };
  const onSinkKey = (ev: React.KeyboardEvent) => {
    if (!(ev.ctrlKey || ev.metaKey) || ev.altKey) return;
    const k = ev.code;
    if (k === 'KeyA') { ev.preventDefault(); pick(visible.map((i) => cellKey(i, anchor.c)), anchor); }
    else if (k === 'KeyZ' && !ev.shiftKey) { ev.preventDefault(); s.undoSheet(); }
    else if (k === 'KeyY' || (k === 'KeyZ' && ev.shiftKey)) { ev.preventDefault(); s.redoSheet(); }
  };

  // 行元件透過 ref 拿操作，每次重畫都換成最新的（裡面用到的選取、編輯狀態才會是新的）
  const handlers = useRef<RowHandlers>(null!);
  handlers.current = {
    cellDown: onCellDown,
    cellEnter: onCellEnter,
    startEdit,
    cellMenu: (ev) => { ev.preventDefault(); sink.current?.focus({ preventScroll: true }); setMenu({ x: ev.clientX, y: ev.clientY }); },
    openMark,
    rowPick: onRowPick,
    rowEnter: onRowEnter,
    editText: (text) => setEditing((ed) => (ed ? { ...ed, text } : ed)),
    commitEdit: (refocus) => { commitEdit(); if (refocus) sink.current?.focus({ preventScroll: true }); },
    cancelEdit: () => { setEditing(null); sink.current?.focus({ preventScroll: true }); },
  };

  return (
    <section aria-label="文本條目" style={{
      flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--panel)',
      border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden',
    }}>
      <div style={{ height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px 0 16px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span className="sec-label">文本條目</span>
          <span style={{ fontSize: fz(12), color: 'var(--mute)' }}>共 {sheet.entries.length} 條</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" className="ib" aria-label="設定檔案的長度標準" title={'長度標準：' + stdLabel(fileStd)} onClick={() => s.set({ lengthDialog: 'file' })}
          style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'var(--btn)', border: '1px solid var(--line3)', borderRadius: 8, color: 'var(--text2)' }}>
          <IconRuler size={16} />
        </button>
        <button type="button" className="ib" aria-label="全部檢查" title="全部檢查" onClick={() => s.checkAll()}
          style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'var(--btn)', border: '1px solid var(--line3)', borderRadius: 8, color: 'var(--text2)' }}>
          <IconScan size={15} />
        </button>
        <button type="button" className="ib" aria-label="複製譯文欄" title="複製譯文欄" onClick={askCopy}
          style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'var(--btn)', border: '1px solid var(--line3)', borderRadius: 8, color: copied ? 'var(--accent2)' : 'var(--text2)' }}>
          {copied ? <IconCheck size={14} sw={2.4} /> : <IconCopy size={14} />}
        </button>
        <div role="group" aria-label="篩選條目" className="seg-group">
          {FILTERS.map((f) => {
            const on = filter === f.id;
            return (
              <button key={f.id} type="button" className="seg" aria-pressed={on} onClick={() => set({ filter: f.id })}
                style={{
                  height: 26, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', border: 0, borderRadius: 6, fontSize: fz(12),
                  background: on ? 'var(--segon)' : 'transparent', color: on ? 'var(--text)' : 'var(--text2)',
                }}>
                {f.id === 'issues' ? <IconWarn size={12} sw={2.2} stroke="var(--warntx)" />
                  : f.id !== 'all' && <MarkIcon mark={{ kind: f.id }} size={12} menu />}
                {f.label}
                <span style={{ fontSize: fz(11), color: 'var(--mute)' }}>{f.id === 'all' ? sheet.entries.length : cnt[f.id]}</span>
              </button>
            );
          })}
        </div>
        </div>
      </div>
      <div style={{
        height: 32, flexShrink: 0, display: 'grid', gridTemplateColumns: '40px minmax(0, 1fr)', alignItems: 'stretch',
        padding: '0 12px 0 4px', fontSize: fz(11), fontWeight: 600, letterSpacing: 0.8, color: 'var(--mute)',
        borderBottom: '1px solid var(--line0)', background: 'var(--bar2)', overflowY: 'hidden', scrollbarGutter: 'stable',
      }}>
        <span />
        <div ref={headRef} role="row" style={{ display: 'grid', gridTemplateColumns: colsOf(s.colWidths), minWidth: 0 }}>
          {HEADS.map((h, c) => {
            const allSel = visible.length > 0 && visible.every((i) => selected.has(cellKey(i, c)));
            return (
              <span key={h} role="columnheader" className={'col-head' + (allSel ? ' col-head-sel' : '')}
                onMouseDown={(ev) => onHeadDown(ev, c)} onMouseEnter={(ev) => onHeadEnter(ev, c)}
                style={{
                  position: 'relative', display: 'flex', alignItems: 'center', minWidth: 0, whiteSpace: 'nowrap',
                  justifyContent: c === 0 ? 'flex-end' : 'flex-start',
                  padding: c === 0 ? '0 2px 0 0' : c === 1 ? '0 8px 0 4px' : c === 2 ? '0 16px 0 0' : '0 16px',
                  borderLeft: c === 3 ? '1px solid var(--line)' : undefined, cursor: 'pointer',
                }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{h}</span>
                {c < 3 && (
                  <span className="col-resize" role="separator" aria-orientation="vertical" aria-label={'調整「' + h + '」欄寬'}
                    onMouseDown={(ev) => onResizeDown(ev, c)} onClick={(ev) => ev.stopPropagation()}
                    style={{ position: 'absolute', right: -4, top: 0, bottom: 0, width: 8, cursor: 'col-resize', zIndex: 1 }} />
                )}
              </span>
            );
          })}
        </div>
      </div>
      <div ref={listRef} onMouseDown={(ev) => { if (ev.target === ev.currentTarget || !(ev.target as HTMLElement).closest('.rw')) { ev.preventDefault(); sink.current?.focus({ preventScroll: true }); } }} style={{ position: 'relative', flexGrow: 1, overflowY: 'auto', scrollbarGutter: 'stable', padding: '4px 0', userSelect: 'none' }}>
        <textarea ref={sink} className="list-sink" aria-label="條目欄" value="" onChange={() => {}}
          onCopy={onCopy} onPaste={onPaste} onKeyDown={onSinkKey}
          style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1, padding: 0, border: 0, opacity: 0, resize: 'none', pointerEvents: 'none' }} />
        {rows.map(({ e, i, m, issues }) => (
          <EntryRow key={e.uid} e={e} i={i} m={m} issues={issues} on={i === sel}
            selCols={selColsOf(i)} editing={editing && editing.i === i ? editing : null}
            customs={customs} cols={cols} ovfId={ovf.id} ovfSpk={ovf.speaker} ovfSrc={ovf.src} ovfTgt={ovf.tgt} h={handlers} />
        ))}
        {rows.length === 0 && (
          <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--mute)' }}>
            {project.files.length === 0 ? '目前沒有檔案，請新增檔案' : sheet.entries.length === 0 ? '這個頁簽沒有條目' : '這個篩選條件下沒有條目'}
          </div>
        )}
      </div>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} label="條目"
          items={[
            { key: 'edit', label: '編輯', disabled: readOnly || !canEdit(parseKey([...keys].sort(order)[0]).c) },
            { key: 'clear', label: '清除', disabled: readOnly },
            { key: 'delete', label: '刪除', danger: true, disabled: readOnly },
            { key: 'insert', label: '插入', disabled: readOnly },
            { key: 'up', label: '上移', disabled: readOnly },
            { key: 'down', label: '下移', disabled: readOnly },
          ]}
          onPick={menuAct} onClose={() => { setMenu(null); sink.current?.focus({ preventScroll: true }); }} />
      )}
      {confirm && <CopyConfirm {...confirm} onCancel={() => setConfirm(null)} onConfirm={() => void doCopy()} />}
    </section>
  );
}
