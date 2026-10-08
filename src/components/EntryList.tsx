import { tx } from '../i18n';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { currentOf, hasPendingUpdate, searchHit, useStorePick, visibleIssues, type Filter } from '../state/store';
import { effectiveMark, markName, markVisual } from '../model/marks';
import { columnToClipboard, parseHtmlTable, parseTsv, writeColumn } from '../model/clipboard';
import {
  TGT_COL, cellKey, clearCells, copyMatrix, deleteRows, getCell, insertRows, moveCells, moveRows, parseKey, pasteMatrix, rectKeys, setCell,
  type Cell, type CellCol,
} from '../model/cells';
import { ContextMenu } from './ContextMenu';
import { focusOnMount } from './windowDrag';
import { MarkIcon } from './MarkIcon';
import { rowMenuPos } from './rowMenu';
import { CopyConfirm } from './CopyConfirm';
import { IconCheck, IconCopy, IconNote, IconRuler, IconScan, IconSrcApplyAll, IconWarn } from './icons';
import { stdLabel } from '../model/length';
import { cellFontCss, fz, overflowOf, type Overflow } from '../model/fonts';
import type { CustomMark, Entry, MarkId } from '../model/types';
import type { Issue } from '../model/checks';
import { CellText } from './CellText';
import { maxOf, minOf } from '../model/num';
import { hasTooLongCell, MAX_CELL_CHARS, tooLongMsg } from '../model/names';
import { showToast } from '../state/store';

/** # 欄（對話 id）、發話者欄、原文、譯文：依比例分配寬度 */
const colsOf = (w: number[]) => w.map((x) => `minmax(0, ${x}fr)`).join(' ');
const headsOf = () => ['#', tx('list.001'), tx('list.002'), tx('list.003')];
/** 條目欄的原文、譯文比工作欄小一點 */
const SRC_FS = 'calc(var(--fs-src) * 13 / 15)';
const TGT_FS = 'calc(var(--fs-tgt) * 13 / 15)';
/** 拖動欄寬時每欄至少留這麼寬 */
const MIN_COL_PX = 24;

/** 往下／往上移動時，前方保留幾條看得到 */
const KEEP_VISIBLE = 3;

// ---- 虛擬捲動：只畫看得到的條目，上下各多畫幾條當緩衝 ----
/** 還沒量過的條目先當成這麼高（一行字的條目） */
const EST_ROW = 40;
/** 上下各多畫幾條 */
const BUFFER = 10;
/** 條目欄上下的留白（跟樣式的 padding 一樣） */
const LIST_PAD = 4;

/** offsets[k] 是第 k 列的上緣；找出 y 落在第幾列 */
function rowAt(offsets: Float64Array, y: number): number {
  let lo = 0, hi = offsets.length - 2;
  if (hi < 0) return 0;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (offsets[mid] <= y) lo = mid; else hi = mid - 1; }
  return lo;
}

/** 讓某一條看得到（例如 Shift 延伸選取時）：條目欄登記的處理函式 */
let revealHandler: ((i: number) => void) | null = null;
export function revealRow(i: number) { revealHandler?.(i); }

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', get label() { return tx('list.004'); } },
  { id: 'untranslated', get label() { return tx('list.005'); } },
  { id: 'doubt', get label() { return tx('list.006'); } },
  { id: 'think', get label() { return tx('list.007'); } },
  { id: 'issues', get label() { return tx('list.008'); } },
  { id: 'srcupd', get label() { return tx('list.009'); } },
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
  rowMenu(ev: React.MouseEvent, i: number): void;
  editText(text: string): void;
  /** refocus：結束後把焦點交回條目欄 */
  commitEdit(refocus: boolean): void;
  cancelEdit(): void;
}

interface RowProps {
  e: Entry;
  i: number;
  /** 在畫面上（篩選後）的第幾列 */
  k: number;
  m: MarkId;
  issues: Issue[];
  on: boolean;
  /** 符合工具欄搜尋 */
  hit: boolean;
  /** 這一行選到的欄，例如 "0,3" */
  selCols: string;
  /** 這一行正在格子裡編輯的話 */
  editing: { c: CellCol; text: string } | null;
  customs: CustomMark[];
  cols: string;
  /** 各欄能放文字的寬度（自動縮放用） */
  fitId: number; fitSpk: number; fitSrc: number; fitTgt: number;
  fontId: string; fontSpk: string; fontSrc: string; fontTgt: string;
  ovfId: Overflow; ovfSpk: Overflow; ovfSrc: Overflow; ovfTgt: Overflow;
  h: React.RefObject<RowHandlers>;
}

/** 條目欄的一行：只有自己的內容、選取、標記等變了才重畫 */
const EntryRow = memo(function EntryRow({ e, i, k, m, issues, on, hit, selCols, editing, customs, cols, fitId, fitSpk, fitSrc, fitTgt, fontId, fontSpk, fontSrc, fontTgt, ovfId, ovfSpk, ovfSrc, ovfTgt, h }: RowProps) {
  const doubt = m === 'doubt', ver = m === 'verified', ign = m === 'ignore';
  const label = tx('list.010', { v1: markName(customs, m) });
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
    <textarea className="cell-edit" ref={focusOnMount} value={editing.text} spellCheck={false} maxLength={MAX_CELL_CHARS}
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
    <div key={e.uid} className="rw" data-uid={e.uid} data-k={k} aria-current={on ? 'true' : undefined} style={{
      display: 'grid', gridTemplateColumns: '24px 16px minmax(0, 1fr)', padding: '0 12px 0 4px',
      borderTop: `1px solid ${doubt ? 'var(--dbline)' : 'transparent'}`,
      borderBottom: `1px solid ${doubt ? 'var(--dbline)' : 'transparent'}`,
      background: doubt ? (on ? 'var(--dbon)' : 'var(--db)') : hit ? 'var(--acc-soft)' : 'transparent',
      boxShadow: hit ? 'inset 3px 0 0 var(--accent)' : undefined,
    }}>
      <button type="button" className="mk" aria-haspopup="menu" aria-label={label} title={label} onClick={(ev) => h.current.openMark(ev, i)}
        style={{ width: 24, minHeight: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'transparent', border: 0, borderRadius: 4 }}>
        <MarkIcon mark={markVisual(customs, m)} size={14} />
      </button>
      <span className="row-pick" onMouseDown={(ev) => h.current.rowPick(ev, i)} onMouseEnter={(ev) => h.current.rowEnter(ev, i)} onContextMenu={(ev) => h.current.rowMenu(ev, i)} style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start', justifyContent: 'center' }}>
        {e.lengthStd !== undefined && (
          <span role="img" aria-label={tx('list.011')} title={tx('list.012', { v1: stdLabel(e.lengthStd) })} style={{ display: 'flex', color: 'var(--accent2)' }}><IconRuler size={11} sw={2.2} /></span>
        )}
        {e.note && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2.2" strokeLinejoin="round" role="img" aria-label={tx('list.013')}>
            <title>{tx('list.013')}</title><path d="M4 5h16v11H9.5L4 20.5z" />
          </svg>
        )}
      </span>
      <div role="row" style={{ minWidth: 0, minHeight: 38, display: 'grid', gridTemplateColumns: cols, alignItems: 'stretch', fontSize: fz(13) }}>
        <span {...cellProps(0)} title={e.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', minWidth: 0, padding: '4px 0', fontFamily: 'var(--font-id)', fontSize: 'var(--fs-id)' }}>
          {editor(0) ?? <CellText mode={ovfId} fontSize="var(--fs-id)" fit={{ width: fitId, font: fontId, text: e.id }} style={{ paddingRight: 2, textAlign: 'right', color: ver ? 'var(--mute3)' : 'var(--mute)' }}>{e.id}</CellText>}
        </span>
        <span {...cellProps(1)} title={e.speaker} style={{ display: 'flex', alignItems: 'center', minWidth: 0, padding: '4px 8px 4px 4px', fontFamily: 'var(--font-spk)', fontSize: 'var(--fs-spk)', color: ver ? 'var(--mute3)' : 'var(--text2)' }}>
          {editor(1) ?? <CellText mode={ovfSpk} fontSize="var(--fs-spk)" fit={{ width: fitSpk, font: fontSpk, text: e.speaker }}>{e.speaker}</CellText>}
        </span>
        <span {...cellProps(2)} style={{ display: 'flex', alignItems: 'center', minWidth: 0, padding: '9px 16px 9px 0', lineHeight: 1.45, color: ver ? 'var(--mute2)' : 'var(--text)', fontSize: SRC_FS, fontFamily: 'var(--font-src)' }}>
          {/* 原文更新：顯示新原文 */}
          {editor(2) ?? (e.upd?.removed
            ? <span style={{ fontSize: SRC_FS, color: 'var(--mute3)' }}>{tx('list.014')}</span>
            : <CellText mode={ovfSrc} fontSize={SRC_FS} fit={{ width: fitSrc, font: fontSrc, text: e.upd?.src ?? e.src }}>{e.upd?.src ?? e.src}</CellText>)}
        </span>
        <span {...cellProps(3)} style={{
          fontSize: TGT_FS, fontFamily: 'var(--font-tgt)',
          display: 'flex', alignItems: 'center', minWidth: 0, padding: '9px 16px', lineHeight: 1.45, borderLeft: '1px solid var(--line0)',
          color: ver ? 'var(--mute2)' : e.tgt ? 'var(--textsoft)' : 'var(--mute2)', fontStyle: e.tgt ? 'normal' : 'italic',
        }}>
          {editor(3) ?? (
            <CellText mode={ovfTgt} fontSize={TGT_FS} fit={{ width: fitTgt - (issues.length ? 19 : 0), font: fontTgt, text: e.tgt || (ign ? tx('list.015') : tx('list.016')) }}>
              {issues.length > 0 && (
                <span role="img" aria-label={issues.map((x) => x.msg).join(tx('common.sep'))} title={issues.map((x) => x.msg).join(tx('common.sep'))}
                  style={{ display: 'inline-flex', verticalAlign: '-2px', marginRight: 6, color: 'var(--warntx)', fontStyle: 'normal' }}>
                  <IconWarn size={13} sw={2.2} />
                </span>
              )}
              {e.tgt || (ign ? tx('list.015') : tx('list.016'))}
            </CellText>
          )}
        </span>
      </div>
    </div>
  );
});

export function EntryList() {
  // 只訂閱這個區塊用到的資料（包含 currentOf 等輔助函式間接用到的）
  const s = useStorePick('project', 'file', 'sheetBy', 'selBy', 'searchQuery', 'side', 'hideSide', 'mode', 'fonts', 'colWidths', 'cellSel', 'filter', 'reported', 'checkSettings', 'moveDir', 'moveSeq', 'set', 'select', 'selectCells', 'editSheet', 'undoSheet', 'redoSheet', 'checkAll', 'applyAllNewSources');
  const project = s.project!;
  const { sheet, sheetIdx, sel } = currentOf(s);
  const filter = s.filter;
  const { set } = s;
  const customs = project.customMarks;
  const listRef = useRef<HTMLDivElement>(null);
  const [confirm, setConfirm] = useState<{ untranslated: number; pending: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [notesCopied, setNotesCopied] = useState(false);
  // 接收鍵盤、複製貼上用的隱藏文字框；點條目欄時焦點交給它，這樣 Ctrl+C／V 才會作用在條目欄
  const sink = useRef<HTMLTextAreaElement>(null);
  const drag = useRef<Cell | null>(null);
  // 點欄標題選整欄：按下的那一欄，以及按下前已選的格子（Ctrl 加選時保留）
  const colDrag = useRef<{ c: number; base: string[] } | null>(null);
  const headRef = useRef<HTMLDivElement>(null);
  // 各欄寬度：只在欄寬或視窗大小改變時量一次（量標題列的格子），自動縮放用
  const [colPx, setColPx] = useState([0, 0, 0, 0]);
  useEffect(() => {
    const head = headRef.current;
    if (!head) return;
    const measure = () => {
      const w = Array.from(head.children).map((c) => (c as HTMLElement).getBoundingClientRect().width);
      setColPx((prev) => (prev.every((x, i) => Math.abs(x - (w[i] ?? 0)) < 0.5) ? prev : w));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(head);
    return () => ro.disconnect();
  }, []);
  // 從條目最左邊按住拖動：起點那一條，以及按下前已選的格子（Ctrl 加選時保留）
  const rowDrag = useRef<{ i: number; base: string[] } | null>(null);
  // 滑鼠按住期間記下按下的位置：這段時間不自動捲動，也要真的移動了才算拖動選取
  const pressAt = useRef<{ x: number; y: number } | null>(null);
  /** 右鍵選單：格子、整列（選了整列，或在列最左邊右鍵）、整欄（欄標題右鍵） */
  const [menu, setMenu] = useState<{ x: number; y: number; kind: 'cell' | 'row' | 'col'; col?: number } | null>(null);
  const [insertCount, setInsertCount] = useState(1);
  const [editing, setEditing] = useState<{ i: number; c: CellCol; text: string } | null>(null);
  const readOnly = s.mode === 'view';
  const ovf = { id: overflowOf(s.fonts, 'id'), speaker: overflowOf(s.fonts, 'speaker'), src: overflowOf(s.fonts, 'src'), tgt: overflowOf(s.fonts, 'tgt') };


  // 複製譯文欄：未翻譯的留空，待確認的照原本譯文輸出
  const doCopy = async () => {
    setConfirm(null);
    await writeColumn(sheet.entries.map((e) => e.tgt));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  // 複製備註：一條一格，沒有備註也留空格，貼回原檔正好對齊
  const copyNotes = async () => {
    await writeColumn(sheet.entries.map((e) => e.note));
    setNotesCopied(true);
    setTimeout(() => setNotesCopied(false), 1500);
  };
  const askCopy = () => {
    const open = sheet.entries.filter((e) => e.mark !== 'ignore');
    const untranslated = open.filter((e) => !e.tgt).length;
    // 已經標了驗證（驗證模式下還有疑慮）的條目算處理過了，不管待確認
    const handled = (e: Entry) => e.mark === 'verified' || (s.mode === 'verify' && e.mark === 'doubt');
    const pending = open.filter((e) => e.tgt && e.pending && !handled(e)).length;
    if (untranslated || pending) setConfirm({ untranslated, pending });
    else void doCopy();
  };

  const fileStd = currentOf(s).fileDoc.lengthStd;
  // 工具欄開著搜尋頁時，符合搜尋的條目高亮
  const searchQ = s.searchQuery.trim();
  const searchOn = s.side === 'search' && !s.hideSide && !!searchQ;
  // 每一條的標記和問題、各篩選的數量：條目、檢查結果、篩選變了才重算（選取、捲動不用重算）
  const { all, cnt } = useMemo(() => {
    const cnt: Record<string, number> = { untranslated: 0, doubt: 0, think: 0, issues: 0, srcupd: 0 };
    const all = sheet.entries.map((e, i) => {
      const m = effectiveMark(e);
      const issues = visibleIssues(e, s.reported, s.checkSettings, fileStd);
      if (m in cnt) cnt[m]++;
      if (issues.length) cnt.issues++;
      return { e, i, m, issues };
    });
    return { all, cnt };
  }, [sheet.entries, s.reported, s.checkSettings, fileStd]);

  const openMark = (ev: React.MouseEvent<HTMLButtonElement>, i: number) => {
    set({ rowMenu: { index: i, ...rowMenuPos(ev.currentTarget, customs.length) }, stampOpen: false, fileMenuOpen: false });
  };

  const { rows, visible, posOf } = useMemo(() => {
    const rows = filter === 'all' ? all : all.filter(({ m, issues }) => (filter === 'issues' ? issues.length > 0 : m === filter));
    const visible = rows.map((x) => x.i);
    // 條目 → 在畫面上的第幾列
    const posOf = new Map(visible.map((i, k) => [i, k]));
    return { rows, visible, posOf };
  }, [all, filter]);

  // ---- 虛擬捲動 ----
  // 量過的條目記住實際高度（依條目），沒量過的先用估的；欄寬、字體、模式變了，記住的高度全部作廢
  const heights = useRef(new Map<string, number>());
  const [hVer, setHVer] = useState(0);
  const layoutKey = colPx.map(Math.round).join(',') + '|' + JSON.stringify(s.fonts) + '|' + s.mode;
  const lastLayout = useRef(layoutKey);
  if (lastLayout.current !== layoutKey) { lastLayout.current = layoutKey; heights.current.clear(); }
  const offsets = useMemo(() => {
    const o = new Float64Array(rows.length + 1);
    rows.forEach((r, k) => { o[k + 1] = o[k] + (heights.current.get(r.e.uid) ?? EST_ROW); });
    return o;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, hVer, layoutKey]);
  const offsetsRef = useRef(offsets);
  offsetsRef.current = offsets;
  // 條目欄捲到哪裡、有多高；只在要畫的範圍變了才重畫
  const [view, setView] = useState({ top: 0, h: 800 });
  const rangeOf = (top: number, h: number, o = offsetsRef.current) => {
    const n = o.length - 1;
    return { start: Math.max(0, rowAt(o, top - LIST_PAD) - BUFFER), end: Math.min(n, rowAt(o, top - LIST_PAD + h) + 1 + BUFFER) };
  };
  const { start, end } = rangeOf(view.top, view.h, offsets);
  const rangeRef = useRef({ start, end });
  rangeRef.current = { start, end };
  const syncView = () => {
    const el = listRef.current;
    if (!el) return;
    const r = rangeOf(el.scrollTop, el.clientHeight);
    if (r.start !== rangeRef.current.start || r.end !== rangeRef.current.end) setView({ top: el.scrollTop, h: el.clientHeight });
  };
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setView({ top: el.scrollTop, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 換條目時讓目前這條保持在可見範圍：照算出來的位置捲，不用找畫面上的元素（畫面外的條目沒有畫）。
  // 用下一條或快捷鍵往下（上）移動時，下方（上方）至少保留 3 條看得到；滑鼠點選只確保這條看得到。
  // 估的高度可能不準：畫出來、量好之後再對一次，直到不用再捲
  const handledMove = useRef(s.moveSeq);
  const pending = useRef<{ i: number; keyboard: boolean; dir: number; tries: number } | null>(null);
  const ensure = (): boolean => {
    const p = pending.current, el = listRef.current;
    if (!p || !el) return false;
    const pos = posOf.get(p.i);
    if (pos === undefined) { pending.current = null; return false; }
    const o = offsetsRef.current, n = o.length - 1, vh = el.clientHeight;
    const topOf = (k: number) => LIST_PAD + o[k], bottomOf = (k: number) => LIST_PAD + o[k + 1];
    let top = el.scrollTop;
    // 這條本身看得到
    if (topOf(pos) < top) top = topOf(pos);
    else if (bottomOf(pos) > top + vh) top = bottomOf(pos) - vh;
    if (p.keyboard) {
      if (p.dir > 0) { const b = bottomOf(Math.min(pos + KEEP_VISIBLE, n - 1)); if (b > top + vh) top = b - vh; }
      else { const t = topOf(Math.max(pos - KEEP_VISIBLE, 0)); if (t < top) top = t; }
    }
    top = Math.max(0, Math.round(top));
    if (Math.abs(top - el.scrollTop) < 1 || ++p.tries > 6) { pending.current = null; return false; }
    el.scrollTop = top;
    setView({ top: el.scrollTop, h: vh });
    return true;
  };
  useEffect(() => {
    const keyboard = handledMove.current !== s.moveSeq;
    handledMove.current = s.moveSeq;
    // 滑鼠按著時不捲動：捲動會讓游標下的格子變成別格，被當成拖動選取
    if (pressAt.current) return;
    pending.current = { i: sel, keyboard, dir: s.moveDir, tries: 0 };
    ensure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.file, sheetIdx, sel, s.moveSeq]);
  // Shift 延伸選取等：讓某一條看得到（同步畫出來，之後可以馬上找到它的元素）
  useEffect(() => {
    revealHandler = (i) => flushSync(() => { pending.current = { i, keyboard: false, dir: 0, tries: 0 }; ensure(); });
    return () => { revealHandler = null; };
  });
  // 畫好之後量看得到的條目：高度跟記住的不一樣就記下來；上面的條目變高變矮時，捲動位置跟著補，畫面不會跳
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    let changed = false, above = 0;
    const firstK = rowAt(offsetsRef.current, el.scrollTop - LIST_PAD);
    el.querySelectorAll<HTMLElement>('.rw[data-uid]').forEach((row) => {
      const uid = row.dataset.uid!, k = Number(row.dataset.k), h = row.offsetHeight;
      const known = heights.current.get(uid);
      if (known !== undefined && Math.abs(known - h) < 0.5) return;
      heights.current.set(uid, h);
      const old = known ?? EST_ROW;
      if (Math.abs(old - h) >= 0.5) { changed = true; if (k < firstK) above += h - old; }
    });
    if (above && !pending.current) el.scrollTop += above;
    if (changed) setHVer((v) => v + 1);
    else ensure();
  });

  // 選到的格子；沒有特別選時就是目前這條的譯文格。被篩掉、看不到的格子不算（清除、刪除、貼上都不會動到它們）
  const visSet = posOf;
  const picked = (s.cellSel?.keys ?? []).filter((k) => visSet.has(parseKey(k).i));
  const keys = picked.length ? picked : [cellKey(sel, TGT_COL)];
  const selected = new Set(keys);
  // 選到的列；每一列四欄都選了才算「選整列」
  const selRows = [...new Set(keys.map((k) => parseKey(k).i))].sort((a, b) => a - b);
  const wholeRows = selRows.length > 0 && selRows.every((i) => [0, 1, 2, 3].every((c) => selected.has(cellKey(i, c))));
  // 每一行選到哪幾欄（給行元件比對用的字串）
  const selByRow = new Map<number, number[]>();
  keys.forEach((k) => { const { i, c } = parseKey(k); if (!selByRow.has(i)) selByRow.set(i, []); selByRow.get(i)!.push(c); });
  const selColsOf = (i: number) => (selByRow.get(i) ?? []).sort().join(',');
  const cols = colsOf(s.colWidths);
  const anchor = s.cellSel?.anchor ?? { i: sel, c: TGT_COL };
  // 畫面上最前面的格子（先比列、再比欄）：直接找最小的，不整個排序
  const firstKey = (ks: string[]) => {
    let best = parseKey(ks[0]), bp = posOf.get(best.i) ?? -1;
    for (let k = 1; k < ks.length; k++) {
      const c = parseKey(ks[k]), cp = posOf.get(c.i) ?? -1;
      if (cp < bp || (cp === bp && c.c < best.c)) { best = c; bp = cp; }
    }
    return best;
  };
  const firstOf = (ks: string[]) => firstKey(ks).i;
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
      const a = posOf.get(anchor.i) ?? -1, b = posOf.get(i) ?? -1;
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
    const a = posOf.get(d.i) ?? -1, b = posOf.get(i) ?? -1;
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
    if (k === 'applySrc') { s.applyAllNewSources(selRows); return; }
    const first = firstKey(keys);
    // 標記選單出現在滑鼠位置（相對於整個畫面），太靠下時往上移
    const menuAt = (x: number, y: number) => {
      const root = listRef.current?.closest('[data-root]') as HTMLElement | null;
      const rr = root?.getBoundingClientRect() ?? new DOMRect();
      const h = 44 + (6 + customs.length) * 32 + (customs.length ? 9 : 0) + 42;
      return { x: Math.round(x - rr.left), y: Math.round(Math.max(8, Math.min(y - rr.top, (root?.offsetHeight ?? 800) - h - 10))) };
    };
    if (k === 'mark' && menu) {
      // 框選了幾條就一次改幾條
      const rowsSel = [...new Set(keys.map((x) => parseKey(x).i))].sort((a, b) => a - b);
      set({ rowMenu: { index: rowsSel[0], indices: rowsSel, ...menuAt(menu.x, menu.y) }, stampOpen: false, fileMenuOpen: false });
      return;
    }
    if (k === 'edit') startEdit(first.i, first.c);
    if (k === 'clear') s.editSheet((es) => ({ entries: clearCells(es, keys), keys }));
    if (menu?.kind === 'row') {
      // 整列：條目本身一起刪、插入、移動（標記、備註跟著走）
      const last = selRows[selRows.length - 1];
      if (k === 'delete') {
        const next = Math.min(selRows[0], sheet.entries.length - selRows.length - 1);
        s.editSheet((es) => ({ entries: deleteRows(es, selRows), keys: next >= 0 ? rowKeys(next) : [] }));
      }
      if (k === 'insert') s.editSheet((es) => ({ entries: insertRows(es, last, insertCount), keys: Array.from({ length: insertCount }, (_, j) => rowKeys(last + 1 + j)).flat() }));
      if (k === 'up' || k === 'down') s.editSheet((es) => { const r = moveRows(es, selRows, k === 'up' ? -1 : 1); return { entries: r.entries, keys: r.rows.flatMap(rowKeys) }; });
      return;
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
    // 有一格超過 Excel 的上限：整次不貼
    if (hasTooLongCell(matrix)) { showToast(tooLongMsg()); return; }
    const top = firstKey(keys);
    // 貼上的起點看不到（被篩掉了）就不貼
    if (sheet.entries.length && !visSet.has(top.i)) return;
    // 空的頁簽從第一欄（#）開始貼
    const firstCol = (sheet.entries.length ? minOf(keys.map((x) => parseKey(x).c)) : 0) as CellCol;
    s.editSheet((es) => {
      const r2 = pasteMatrix(es, visible, { i: top.i, c: firstCol }, matrix);
      const width = Math.min(maxOf(matrix.map((x) => x.length), 0), 4 - firstCol);
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
    cellMenu: (ev) => { ev.preventDefault(); sink.current?.focus({ preventScroll: true }); setMenu({ x: ev.clientX, y: ev.clientY, kind: wholeRows ? 'row' : 'cell' }); },
    rowMenu: (ev, i) => {
      ev.preventDefault();
      sink.current?.focus({ preventScroll: true });
      // 在沒選到的列上右鍵：先選那一整列
      if (!selRows.includes(i) || !wholeRows) pick(rowKeys(i), { i, c: 0 });
      setMenu({ x: ev.clientX, y: ev.clientY, kind: 'row' });
    },
    openMark,
    rowPick: onRowPick,
    rowEnter: onRowEnter,
    editText: (text) => setEditing((ed) => (ed ? { ...ed, text } : ed)),
    commitEdit: (refocus) => { commitEdit(); if (refocus) sink.current?.focus({ preventScroll: true }); },
    cancelEdit: () => { setEditing(null); sink.current?.focus({ preventScroll: true }); },
  };

  return (
    <section aria-label={tx('list.017')} style={{
      flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--panel)',
      border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden',
    }}>
      <div style={{ height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px 0 16px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span className="sec-label">{tx('list.017')}</span>
          <span style={{ fontSize: fz(12), color: 'var(--mute)' }}>{tx('list.018', { n: sheet.entries.length })}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" className="ib" aria-label={tx('list.020')} title={tx('list.021', { v1: stdLabel(fileStd) })} onClick={() => s.set({ lengthDialog: 'file' })}
          style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'var(--btn)', border: '1px solid var(--line3)', borderRadius: 8, color: 'var(--text2)' }}>
          <IconRuler size={16} />
        </button>
        {sheet.entries.some(hasPendingUpdate) && (
          <button type="button" className="ib" aria-label={tx('list.022')} title={tx('list.022')} onClick={() => s.applyAllNewSources()}
            style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'var(--btn)', border: '1px solid var(--line3)', borderRadius: 8, color: 'var(--accent2)' }}>
            <IconSrcApplyAll size={16} />
          </button>
        )}
        <button type="button" className="ib" aria-label={tx('list.023')} title={tx('list.023')} onClick={() => s.checkAll()}
          style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'var(--btn)', border: '1px solid var(--line3)', borderRadius: 8, color: 'var(--text2)' }}>
          <IconScan size={15} />
        </button>
        <button type="button" className="ib" aria-label={tx('list.024')} title={tx('list.024')} onClick={askCopy}
          style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'var(--btn)', border: '1px solid var(--line3)', borderRadius: 8, color: copied ? 'var(--accent2)' : 'var(--text2)' }}>
          {copied ? <IconCheck size={14} sw={2.4} /> : <IconCopy size={14} />}
        </button>
        <button type="button" className="ib" aria-label={tx('list.025')} title={tx('list.025')} onClick={() => void copyNotes()}
          style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'var(--btn)', border: '1px solid var(--line3)', borderRadius: 8, color: notesCopied ? 'var(--accent2)' : 'var(--text2)' }}>
          {notesCopied ? <IconCheck size={14} sw={2.4} /> : <IconNote size={14} />}
        </button>
        <div role="group" aria-label={tx('list.026')} className="seg-group">
          {FILTERS.map((f) => {
            const on = filter === f.id;
            return (
              <button key={f.id} type="button" className="seg" aria-pressed={on} onClick={() => set({ filter: f.id, cellSel: null })}
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
          {headsOf().map((h, c) => {
            const allSel = visible.length > 0 && visible.every((i) => selected.has(cellKey(i, c)));
            return (
              <span key={h} role="columnheader" className={'col-head' + (allSel ? ' col-head-sel' : '')}
                onMouseDown={(ev) => onHeadDown(ev, c)} onMouseEnter={(ev) => onHeadEnter(ev, c)}
                onContextMenu={(ev) => {
                  ev.preventDefault();
                  if (!allSel) pick(colKeys(c, c), { i: visible[0], c: c as CellCol });
                  sink.current?.focus({ preventScroll: true });
                  setMenu({ x: ev.clientX, y: ev.clientY, kind: 'col', col: c });
                }}
                style={{
                  position: 'relative', display: 'flex', alignItems: 'center', minWidth: 0, whiteSpace: 'nowrap',
                  justifyContent: c === 0 ? 'flex-end' : 'flex-start',
                  padding: c === 0 ? '0 2px 0 0' : c === 1 ? '0 8px 0 4px' : c === 2 ? '0 16px 0 0' : '0 16px',
                  borderLeft: c === 3 ? '1px solid var(--line)' : undefined, cursor: 'pointer',
                }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{h}</span>
                {c < 3 && (
                  <span className="col-resize" role="separator" aria-orientation="vertical" aria-label={tx('list.027', { h })}
                    onMouseDown={(ev) => onResizeDown(ev, c)} onClick={(ev) => ev.stopPropagation()}
                    style={{ position: 'absolute', right: -4, top: 0, bottom: 0, width: 8, cursor: 'col-resize', zIndex: 1 }} />
                )}
              </span>
            );
          })}
        </div>
      </div>
      <div ref={listRef} onScroll={syncView} onMouseDown={(ev) => { if (ev.target === ev.currentTarget || !(ev.target as HTMLElement).closest('.rw')) { ev.preventDefault(); sink.current?.focus({ preventScroll: true }); } }} style={{ position: 'relative', flexGrow: 1, overflowY: 'auto', scrollbarGutter: 'stable', padding: '4px 0', userSelect: 'none' }}>
        <textarea ref={sink} className="list-sink" aria-label={tx('list.028')} value="" onChange={() => {}}
          onCopy={onCopy} onPaste={onPaste} onKeyDown={onSinkKey}
          style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1, padding: 0, border: 0, opacity: 0, resize: 'none', pointerEvents: 'none' }} />
        {/* 畫面外的條目不畫，用上下兩塊空白撐出整個捲軸的長度 */}
        {start > 0 && <div aria-hidden="true" style={{ height: offsets[start] }} />}
        {rows.slice(start, end).map(({ e, i, m, issues }, j) => (
          <EntryRow key={e.uid} e={e} i={i} k={start + j} m={m} issues={issues} on={i === sel} hit={searchOn && searchHit(e, searchQ)}
            selCols={selColsOf(i)} editing={editing && editing.i === i ? editing : null}
            customs={customs} cols={cols} fitId={colPx[0] - 2} fitSpk={colPx[1] - 12} fitSrc={colPx[2] - 16} fitTgt={colPx[3] - 32}
            fontId={cellFontCss(s.fonts, 'id')} fontSpk={cellFontCss(s.fonts, 'speaker')} fontSrc={cellFontCss(s.fonts, 'src')} fontTgt={cellFontCss(s.fonts, 'tgt')}
            ovfId={ovf.id} ovfSpk={ovf.speaker} ovfSrc={ovf.src} ovfTgt={ovf.tgt} h={handlers} />
        ))}
        {end < rows.length && <div aria-hidden="true" style={{ height: offsets[rows.length] - offsets[end] }} />}
        {rows.length === 0 && (
          <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--mute)' }}>
            {project.files.length === 0 ? tx('list.029') : sheet.entries.length === 0 ? tx('list.030') : tx('list.031')}
          </div>
        )}
      </div>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} label={tx('list.032')}
          items={menu.kind === 'col' ? [
            { key: 'clear', label: tx('list.033'), disabled: readOnly },
          ] : menu.kind === 'row' ? [
            { key: 'mark', label: tx('list.034'), disabled: readOnly },
            ...(selRows.some((i) => sheet.entries[i] && hasPendingUpdate(sheet.entries[i])) ? [{ key: 'applySrc', label: tx('list.035'), disabled: readOnly }] : []),
            { key: 'clear', label: tx('list.036'), disabled: readOnly },
            { key: 'delete', label: tx('list.037', { length: selRows.length }), danger: true, disabled: readOnly },
            { key: 'insert', label: tx('list.038'), disabled: readOnly, stepper: { value: insertCount, min: 1, max: 100, onChange: setInsertCount } },
            { key: 'up', label: tx('list.039'), disabled: readOnly },
            { key: 'down', label: tx('list.040'), disabled: readOnly },
          ] : [
            { key: 'edit', label: tx('list.041'), disabled: readOnly || !canEdit(firstKey(keys).c) },
            { key: 'clear', label: tx('list.036'), disabled: readOnly },
            { key: 'mark', label: tx('list.034'), disabled: readOnly },
            ...(selRows.some((i) => sheet.entries[i] && hasPendingUpdate(sheet.entries[i])) ? [{ key: 'applySrc', label: tx('list.035'), disabled: readOnly }] : []),
            { key: 'up', label: tx('list.039'), disabled: readOnly },
            { key: 'down', label: tx('list.040'), disabled: readOnly },
          ]}
          onPick={menuAct} onClose={() => { setMenu(null); sink.current?.focus({ preventScroll: true }); }} />
      )}
      {confirm && <CopyConfirm {...confirm} onCancel={() => setConfirm(null)} onConfirm={() => void doCopy()} />}
    </section>
  );
}
