import { tx } from '../i18n';
import { plugins } from '../plugins/registry';
import { rowHook } from '../plugins/hooks';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { currentFilters, hasResolved, shownCount, currentOf, hasNote, hasTalk, hasPendingUpdate, passesFilter, searchHit, useStorePick, visibleIssues, currentFileStd } from '../state/store';
import { FilterPanel } from './FilterPanel';
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
import { cellFontCss, fz, idAutoPx, overflowOf, type Overflow } from '../model/fonts';
import type { CustomMark, Entry, MarkId } from '../model/types';
import type { Issue } from '../model/checks';
import { CellText } from './CellText';
import { maxOf, minOf } from '../model/num';
import { hasTooLongCell, MAX_CELL_CHARS, tooLongMsg } from '../model/names';
import { entryFits } from '../model/cellLimit';
import { showToast, useStore, displayOf, setsOn, setKey, sheetLayout } from '../state/store';
import { autoName, type Item } from '../model/entrySets';
import { ChainBar, DotsItem, GroupItem, IconLink } from './EntrySets';
import { Loading } from './Loading';
import { matchedKeys } from '../model/customFilter';
const NO_EXTRA: string[] = [];

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
  /** 現在正在編輯的就是這一條的這一欄嗎（舊編輯框的卸載計時器用，免得關掉新開的編輯） */
  isEditing(uid: string, c: CellCol): boolean;
  /** 展開收起的條目串（i 是代表它的那一條） */
  toggleChain(i: number): void;
  /** 點導軌：收起那一組或那一串（g:id、c:id），收起後跳到它下面那一條 */
  railClick(key: string): void;
  /** 滑鼠移到導軌上、離開導軌 */
  railHover(key: string | null): void;
}

interface RowProps {
  e: Entry;
  i: number;
  /** AI 正在處理這一條（不能改） */
  aiLock: boolean;
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
  /** id 欄的字級（CSS 寫法） */
  fsId: string;
  ovfId: Overflow; ovfSpk: Overflow; ovfSrc: Overflow; ovfTgt: Overflow;
  h: React.RefObject<RowHandlers>;
  /** 在展開的收起組、條目串裡面（左邊畫導軌）：1 是組或串、2 是組裡的串 */
  depth?: number;
  /** 展開的條目串裡的條目 */
  inChain?: boolean;
  /** 條目串裡譯文格式跟大多數不同的條目（疑慮的黃色） */
  outlier?: boolean;
  /** 收起的條目串：這一列代表整串（條數、拿掉標籤數字的原文、大多數的譯文格式、有沒有格式不同的） */
  chainN?: number; chainSrc?: string; chainTpl?: string; chainWarn?: boolean;
  /** 剛展開：跑一次彈性動畫；正在收起：跑收起的動畫 */
  enter?: boolean;
  leave?: boolean;
  /** 所在的展開的收起組、條目串（左邊畫導軌，點了收起）；gEnd、cEnd：是最後一條（導軌末端往內折） */
  railG?: string; gEnd?: boolean; railC?: string; cEnd?: boolean;
  /** 滑鼠在這一組（串）的導軌上：整條導軌一起變色 */
  hotG?: boolean; hotC?: boolean;
  /** 量高度用的名字（收起的條目串是 c:串的 id） */
  rowKey?: string;
}

/** 格子裡的編輯框：被捲出畫面、換頁簽而消失時，已打的內容直接確定 */
function CellEditor({ text, h, uid, c }: { text: string; h: React.RefObject<RowHandlers>; uid: string; c: CellCol }) {
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    // 等一下再看：開發模式會先卸載再立刻掛回去，那不算消失
    return () => { alive.current = false; setTimeout(() => { if (!alive.current && h.current.isEditing(uid, c)) h.current.commitEdit(false); }, 0); };
  }, [h, uid, c]);
  return (
    <textarea className="cell-edit" ref={focusOnMount} value={text} spellCheck={false} maxLength={MAX_CELL_CHARS}
      rows={Math.max(1, text.split('\n').length)}
      onMouseDown={(ev) => ev.stopPropagation()}
      onChange={(ev) => h.current.editText(ev.target.value)}
      onKeyDown={(ev) => {
        ev.stopPropagation();
        if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); h.current.commitEdit(true); }
        if (ev.key === 'Escape') { ev.preventDefault(); h.current.cancelEdit(); }
      }}
      onBlur={() => h.current.commitEdit(false)} />
  );
}

/** 條目欄的一行：只有自己的內容、選取、標記等變了才重畫 */
const EntryRow = memo(function EntryRow({ e, i, aiLock, k, m, issues, on, hit, selCols, editing, customs, cols, fitId, fitSpk, fitSrc, fitTgt, fontId, fsId, fontSpk, fontSrc, fontTgt, ovfId, ovfSpk, ovfSrc, ovfTgt, h, rowKey, depth = 0, outlier, chainN, chainSrc, chainTpl, chainWarn, enter, leave, railG, gEnd, railC, cEnd, hotG, hotC }: RowProps) {
  const doubt = m === 'doubt' || !!outlier || !!chainWarn, ver = m === 'verified', ign = m === 'ignore';
  // 收起的條目串：原文、譯文欄顯示整串的（拿掉標籤數字）
  const srcText = chainN ? chainSrc ?? '' : e.upd?.src ?? e.src;
  const tgtText = chainN ? chainTpl ?? '' : e.tgt;
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
  const editor = (c: CellCol) => (editing && editing.c === c ? <CellEditor text={editing.text} h={h} uid={e.uid} c={c} /> : null);
  return (
    <div key={e.uid} className={'rw' + (chainN ? ' chain-row' : '') + (enter ? ' set-in' : '') + (leave ? ' set-out' : '')} data-uid={e.uid} data-key={rowKey ?? e.uid} data-k={k} aria-current={on ? 'true' : undefined}
      aria-label={chainN ? tx('sets.chain') + tx('common.colon') + tx('sets.count', { n: chainN }) : undefined} style={{
      position: 'relative', display: 'grid', gridTemplateColumns: '24px 16px minmax(0, 1fr)', padding: '0 12px 0 4px',
      // 收起的條目串：上下有線框起來（左右不加框、不留邊距，跟一般條目一樣寬，不會看起來內縮）
      borderTop: `1px solid ${doubt ? 'var(--dbline)' : chainN ? 'var(--line3)' : 'transparent'}`,
      borderBottom: `1px solid ${doubt ? 'var(--dbline)' : chainN ? 'var(--line3)' : 'transparent'}`,
      // 組、串裡的條目和收起的串：底色稍微不同（不用主題色）
      backgroundColor: doubt ? (on ? 'var(--dbon)' : 'var(--db)') : hit ? 'var(--acc-soft)' : chainN || railC ? 'var(--chainbg)' : railG || depth ? 'var(--setbg)' : 'transparent',
      boxShadow: hit ? 'inset 3px 0 0 var(--accent)' : undefined,
    }}>
      {railG && <span className={'set-rail' + (gEnd ? ' set-rail-end' : '') + (hotG ? ' set-rail-on' : '')} style={{ left: 0 }} aria-hidden="true" title={tx('sets.fold')}
        onMouseEnter={() => h.current.railHover('g:' + railG)} onMouseLeave={() => h.current.railHover(null)}
        onMouseDown={(ev) => { ev.stopPropagation(); ev.preventDefault(); }} onClick={() => h.current.railClick('g:' + railG)} />}
      {railC && <span className={'set-rail' + (cEnd ? ' set-rail-end' : '') + (hotC ? ' set-rail-on' : '')} style={{ left: railG ? 7 : 0 }} aria-hidden="true" title={tx('sets.fold')}
        onMouseEnter={() => h.current.railHover('c:' + railC)} onMouseLeave={() => h.current.railHover(null)}
        onMouseDown={(ev) => { ev.stopPropagation(); ev.preventDefault(); }} onClick={() => h.current.railClick('c:' + railC)} />}
      <button type="button" className="mk" aria-haspopup="menu" aria-label={label} title={label} onClick={(ev) => h.current.openMark(ev, i)}
        style={{ width: 24, minHeight: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'transparent', border: 0, borderRadius: 4 }}>
        <MarkIcon mark={markVisual(customs, m)} size={14} />
      </button>
      <span className="row-pick" onMouseDown={(ev) => h.current.rowPick(ev, i)} onMouseEnter={(ev) => h.current.rowEnter(ev, i)} onContextMenu={(ev) => h.current.rowMenu(ev, i)} style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start', justifyContent: 'center' }}>
        {/* 收起的條目串：條數，點了展開 */}
        {!!chainN && (
          <button type="button" className="ib" aria-label={tx('sets.expand')} title={tx('sets.expand')} onMouseDown={(ev) => ev.stopPropagation()} onClick={() => h.current.toggleChain(i)}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, padding: '2px 0', background: 'transparent', border: 0, borderRadius: 4, color: 'var(--text2)', fontSize: 9, fontWeight: 700, lineHeight: 1 }}>
            <IconLink size={12} />{chainN}
          </button>
        )}
        {aiLock && (
          <span role="img" aria-label={tx('list.aiLocked')} title={tx('list.aiLocked')} className="ai-busy" style={{ fontSize: 9, fontWeight: 800, color: 'var(--accent)', lineHeight: 1 }}>AI</span>
        )}
        {e.lengthStd !== undefined && (
          <span role="img" aria-label={tx('list.011')} title={tx('list.012', { v1: stdLabel(e.lengthStd) })} style={{ display: 'flex', color: 'var(--accent2)' }}><IconRuler size={11} sw={2.2} /></span>
        )}
        {/* 雲端檔案：有沒解決的留言是兩個交疊的對話氣泡；只有原備註、自訂欄是一個 */}
        {e.comments?.some((t) => !t.resolved) ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={tx('list.openComments')}>
            <title>{tx('list.openComments')}</title><path d="M9 12H7l-4 3V4h11v5" /><path d="M9 9h12v11l-4-3H9z" />
          </svg>
        ) : (e.comments ? !!e.noteBase?.trim() || !!e.extraNotes?.some((x) => x.text.trim()) : !!e.note) && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2.2" strokeLinejoin="round" role="img" aria-label={tx('list.013')}>
            <title>{tx('list.013')}</title><path d="M4 5h16v11H9.5L4 20.5z" />
          </svg>
        )}
      </span>
      <div role="row" style={{ minWidth: 0, minHeight: 38, display: 'grid', gridTemplateColumns: cols, alignItems: 'stretch', fontSize: fz(13) }}>
        <span {...cellProps(0)} title={e.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', minWidth: 0, padding: '4px 0', fontFamily: 'var(--font-id)', fontSize: 'var(--fs-id)' }}>
          {editor(0) ?? <CellText mode={ovfId} fontSize={fsId} fit={{ width: fitId, font: fontId, text: e.id }} style={{ paddingRight: 2, textAlign: 'right', color: ver ? 'var(--mute3)' : 'var(--mute)' }}>{e.id}</CellText>}
        </span>
        <span {...cellProps(1)} title={e.speaker} style={{ display: 'flex', alignItems: 'center', minWidth: 0, padding: '4px 8px 4px 4px', fontFamily: 'var(--font-spk)', fontSize: 'var(--fs-spk)', color: ver ? 'var(--mute3)' : 'var(--text2)' }}>
          {editor(1) ?? <CellText mode={ovfSpk} fontSize="var(--fs-spk)" fit={{ width: fitSpk, font: fontSpk, text: e.speaker }}>{e.speaker}</CellText>}
        </span>
        <span {...cellProps(2)} style={{ display: 'flex', alignItems: 'center', minWidth: 0, padding: '9px 16px 9px 0', lineHeight: 1.45, color: ver ? 'var(--mute2)' : 'var(--text)', fontSize: SRC_FS, fontFamily: 'var(--font-src)' }}>
          {/* 原文更新：顯示新原文 */}
          {editor(2) ?? (e.upd?.removed
            ? <span style={{ fontSize: SRC_FS, color: 'var(--mute3)' }}>{tx('list.014')}</span>
            : <CellText mode={ovfSrc} fontSize={SRC_FS} fit={{ width: fitSrc, font: fontSrc, text: srcText }}>{srcText}</CellText>)}
        </span>
        <span {...cellProps(3)} style={{
          fontSize: TGT_FS, fontFamily: 'var(--font-tgt)',
          display: 'flex', alignItems: 'center', minWidth: 0, padding: '9px 16px', lineHeight: 1.45, borderLeft: '1px solid var(--line0)',
          color: ver ? 'var(--mute2)' : tgtText ? 'var(--textsoft)' : 'var(--mute2)', fontStyle: tgtText ? 'normal' : 'italic',
        }}>
          {editor(3) ?? (
            <CellText mode={ovfTgt} fontSize={TGT_FS} fit={{ width: fitTgt - (issues.length ? 19 : 0), font: fontTgt, text: tgtText || (ign ? tx('list.015') : tx('list.016')) }}>
              {issues.length > 0 && (
                <span role="img" aria-label={issues.map((x) => x.msg).join(tx('common.sep'))} title={issues.map((x) => x.msg).join(tx('common.sep'))}
                  style={{ display: 'inline-flex', verticalAlign: '-2px', marginRight: 6, color: 'var(--warntx)', fontStyle: 'normal' }}>
                  <IconWarn size={13} sw={2.2} />
                </span>
              )}
              {tgtText || (ign ? tx('list.015') : tx('list.016'))}
            </CellText>
          )}
        </span>
      </div>
    </div>
  );
});

export function EntryList() {
  // 只訂閱這個區塊用到的資料（包含 currentOf 等輔助函式間接用到的）
  const s = useStorePick('project', 'file', 'sheetBy', 'selBy', 'searchQuery', 'side', 'general', 'hideSide', 'mode', 'fonts', 'colWidths', 'cellSel', 'filter', 'reported', 'checkSettings', 'moveDir', 'moveSeq', 'set', 'select', 'selectCells', 'editSheet', 'undoSheet', 'redoSheet', 'checkAll', 'applyAllNewSources', 'collapseRows', 'splitAt', 'mergeChains', 'setGroupAuto', 'mergeSets', 'dissolveGroup', 'renameGroup');
  const project = s.project!;
  const { sheet, sheetIdx, sel, fileDoc } = currentOf(s);
  // 收起組、條目串（雲端模式、開發者選項打開時）
  const setsActive = useStore((st) => setsOn(st, currentOf(st).fileDoc));
  const setOpen = useStore((st) => st.setOpen);
  const groupNaming = useStore((st) => st.groupNaming);
  // Ctrl、Shift 點選的收起組（合併用）
  const [groupSel, setGroupSel] = useState<string[]>([]);
  const [groupMenu, setGroupMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  // 剛展開、收起的組或串：跑一次彈性動畫
  const recent = useRef<{ key: string; t: number } | null>(null);
  // 正在收起的組或串：裡面的條目先跑收起的動畫，跑完才真的收起
  const [closing, setClosing] = useState<string | null>(null);
  // 滑鼠在哪一組（串）的導軌上
  const [railHot, setRailHot] = useState<string | null>(null);
  // 按住拖過好幾個收起組的名稱列：選取（合併用）
  const groupDrag = useRef<{ from: string; moved: boolean } | null>(null);
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
  // 格子裡正在編輯的內容：記條目的 uid 和所在的檔案、頁簽，條目移動或換頁簽後還找得回來
  type Editing = { uid: string; file: number; sheet: number; c: CellCol; text: string };
  const [editing, setEditingState] = useState<Editing | null>(null);
  // 同一份放在 ref：確定、取消後立刻清掉，編輯框消失時才不會再寫一次
  const editRef = useRef<Editing | null>(null);
  const setEditing = (ed: Editing | null) => { editRef.current = ed; setEditingState(ed); };
  const readOnly = s.mode === 'view';
  // 雲端檔案：右鍵多一個「移除」
  const cloudFile = !!s.project?.files[s.file]?.cloud;
  // AI 處理中的條目鎖住（AI 外掛不在時永遠是空的）
  const aiLocked = useStore((st) => st.aiLocked);
  const ovf = { id: overflowOf(s.fonts, 'id'), speaker: overflowOf(s.fonts, 'speaker'), src: overflowOf(s.fonts, 'src'), tgt: overflowOf(s.fonts, 'tgt') };
  // id 欄自動縮放：不看字級設定，照欄寬放大縮小，最大跟原文、譯文一樣大（列高不會變）
  const idAuto = ovf.id === 'shrink' ? idAutoPx(s.fonts) : 0;
  const fontId = idAuto ? cellFontCss(s.fonts, 'id').replace(/^[\d.]+px/, idAuto + 'px') : cellFontCss(s.fonts, 'id');
  const fsId = idAuto ? idAuto + 'px' : 'var(--fs-id)';


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
    const untranslated = open.filter((e) => !e.tgt && e.src.trim()).length; // 原文是空的不算未翻譯
    // 已經標了驗證（驗證模式下還有疑慮）的條目算處理過了，不管待確認
    const handled = (e: Entry) => e.mark === 'verified' || (s.mode === 'verify' && e.mark === 'doubt');
    const pending = open.filter((e) => e.tgt && e.pending && !handled(e)).length;
    if (untranslated || pending) setConfirm({ untranslated, pending });
    else void doCopy();
  };

  const fileStd = currentFileStd(s);
  // 工具欄開著搜尋頁（或綜合頁的搜尋區塊）時，符合搜尋的條目高亮
  const searchQ = s.searchQuery.trim();
  // 搜尋分頁開著，或綜合分頁裡的搜尋區塊沒收起來時，都算搜尋中
  const searchOn = (s.side === 'search' || (s.side === 'general' && !s.general.closed.includes('search'))) && !s.hideSide && !!searchQ;
  // 每一條的標記和問題、各篩選的數量：條目、檢查結果、篩選變了才重算（選取、捲動不用重算）
  // 這個頁簽的自訂篩選條件：每一條符合哪些
  const cfs = useStore((st) => currentFilters(st));
  // 收起組、條目串的篩選：在組裡、串裡的條目（展開與否都算）
  const setsLayout = setsActive ? sheetLayout(fileDoc, sheet, true) : null;
  const { all, cnt } = useMemo(() => {
    const cnt: Record<string, number> = {};
    const inGroup = new Set(setsLayout?.groups.flatMap((g) => g.uids) ?? []);
    const all = sheet.entries.map((e, i) => {
      let extra = cfs.length ? matchedKeys(e, cfs) : NO_EXTRA;
      if (hasResolved(e)) extra = [...extra, 'resolved'];
      if (setsLayout) {
        const t = [...(inGroup.has(e.uid) ? ['group'] : []), ...(setsLayout.chainOf.has(i) ? ['chain'] : [])];
        if (t.length) extra = [...extra, ...t];
      }
      extra.forEach((k) => { cnt[k] = (cnt[k] ?? 0) + 1; });
      const m = effectiveMark(e);
      const issues = visibleIssues(e, s.reported, s.checkSettings, fileStd);
      cnt[m] = (cnt[m] ?? 0) + 1;
      if (issues.length) cnt.issues = (cnt.issues ?? 0) + 1;
      const note = hasNote(e), talk = hasTalk(e);
      if (note) cnt.note = (cnt.note ?? 0) + 1;
      if (talk) cnt.talk = (cnt.talk ?? 0) + 1;
      return { e, i, m, issues, note, talk, extra };
    });
    return { all, cnt };
  }, [sheet.entries, s.reported, s.checkSettings, fileStd, cfs, setsLayout]);

  const openMark = (ev: React.MouseEvent<HTMLButtonElement>, i: number) => {
    set({ rowMenu: { index: i, ...rowMenuPos(ev.currentTarget, customs.length) }, stampOpen: false, fileMenuOpen: false });
  };

  // 要畫的項目（條目、收起組、條目串）；visible 是畫面上算一列的條目，posOf 是條目 → 第幾項（藏在收起的組、串裡的指向那一項）
  const { items, visible, posOf } = useMemo(() => {
    const filtering = Object.keys(filter).length > 0;
    if (!setsActive) {
      const rows = !filtering ? all : all.filter(({ m, issues, note, talk, extra }) => passesFilter(filter, m, issues.length > 0, note, talk, extra));
      const items: Item[] = rows.map((r) => ({ t: 'row', key: r.e.uid, i: r.i, depth: 0 }));
      const visible = rows.map((x) => x.i);
      return { items, visible, posOf: new Map(visible.map((i, k) => [i, k])) };
    }
    const pass = filtering ? (i: number) => { const r = all[i]; return passesFilter(filter, r.m, r.issues.length > 0, r.note, r.talk, r.extra); } : null;
    const hit = searchOn ? (i: number) => searchHit(sheet.entries[i], searchQ) : null;
    const d = displayOf(useStore.getState(), pass, hit);
    return { items: d.items, visible: d.rows, posOf: d.posOf };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, filter, setsActive, setOpen, sel, searchOn, searchQ, sheet, fileDoc]);
  // 條目 → 畫面上第幾列（Shift 延伸選取、拖動選取用）
  const vpos = useMemo(() => new Map(visible.map((i, k) => [i, k])), [visible]);
  const layout = setsActive ? sheetLayout(fileDoc, sheet, true) : null;
  /** 展開或收起；收起時裡面的條目先跑一下收起的動畫（jump：收起後跳到下面那一條） */
  const toggleSet = (key: string, open?: boolean, jump?: boolean) => {
    const st = useStore.getState();
    const k = setKey(fileDoc, sheetIdx, sheet, key);
    const next = open ?? !st.setOpen[k];
    const done = () => { recent.current = { key, t: performance.now() }; setClosing(null); s.set({ cellSel: null }); useStore.getState().toggleSet(key, next, jump); };
    if (next || closing || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { done(); return; }
    setClosing(key);
    setTimeout(done, 190);
  };

  // ---- 虛擬捲動 ----
  // 量過的條目記住實際高度（依條目），沒量過的先用估的；
  // 欄寬、字體、模式變了，舊高度留著當估計值（畫出來的列會重新量），捲動位置才不會跳走
  const heights = useRef(new Map<string, number>());
  const [hVer, setHVer] = useState(0);
  const layoutKey = colPx.map(Math.round).join(',') + '|' + JSON.stringify(s.fonts) + '|' + s.mode;
  const offsets = useMemo(() => {
    const o = new Float64Array(items.length + 1);
    items.forEach((r, k) => { o[k + 1] = o[k] + (heights.current.get(r.key) ?? (r.t === 'dots' ? 22 : EST_ROW)); });
    return o;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, hVer, layoutKey]);
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
    if (p.keyboard && p.dir === 2) {
      // 收起組、串之後跳到下一條：放在畫面下方，底下留三條（跟一路按 Enter 下來的位置一樣）
      top = Math.max(0, bottomOf(Math.min(pos + KEEP_VISIBLE, n - 1)) - vh);
      if (topOf(pos) < top) top = topOf(pos);
    } else if (p.keyboard) {
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
    const o = offsetsRef.current;
    const firstK = rowAt(o, el.scrollTop - LIST_PAD);
    el.querySelectorAll<HTMLElement>('[data-k][data-key]').forEach((row) => {
      const uid = row.dataset.key!, k = Number(row.dataset.k), h = row.getBoundingClientRect().height;
      const known = heights.current.get(uid);
      if (known !== undefined && Math.abs(known - h) < 0.5) return;
      heights.current.set(uid, h);
      const old = known ?? EST_ROW;
      // 頂端在畫面上緣之上的列（包含只露出下半截的第一列）變高變矮：捲動位置跟著補，看得到的內容不動
      if (Math.abs(old - h) >= 0.5) { changed = true; if (k < firstK || (k === firstK && LIST_PAD + o[k] < el.scrollTop - 0.5)) above += h - old; }
    });
    if (above && !pending.current) el.scrollTop += above;
    if (changed) setHVer((v) => v + 1);
    else if (!ensure()) {
      // 換頁簽、篩選後條目變少時，瀏覽器會自己把捲動位置往回收，但不一定發出捲動事件：
      // 照實際的捲動位置再對一次要畫的範圍，不然會一條都沒畫，要滾一下才出現
      const r = rangeOf(el.scrollTop, el.clientHeight);
      if (r.start !== rangeRef.current.start || r.end !== rangeRef.current.end) setView({ top: el.scrollTop, h: el.clientHeight });
    }
  });
  // 換頁簽、檔案、篩選後：等瀏覽器排好版、捲動位置定下來，再照實際位置對一次要畫的範圍
  useEffect(() => {
    const t = setTimeout(syncView, 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // 選到的格子；沒有特別選時就是目前這條的譯文格。被篩掉、看不到的格子不算（清除、刪除、貼上都不會動到它們）
  const visSet = vpos;
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
      // 要編輯的框：譯文欄在驗證模式是修改框；工作欄收起或那個框被隱藏就先打開（之後保持顯示）
      const box = c === TGT_COL ? (s.mode === 'verify' ? 'mod' : 'tgt') : 'src';
      const st = useStore.getState();
      const shown = st.workBoxes[st.mode]?.[box];
      if (st.hideWork || shown === false) st.set({ hideWork: false, ...(shown === false ? { workBoxes: { ...st.workBoxes, [st.mode]: { ...st.workBoxes[st.mode], [box]: true } } } : {}) });
      // 等工作欄換成這一條（或剛打開）再把游標放進輸入框
      setTimeout(() => {
        const el = document.getElementById(box === 'mod' ? 'verso-edit' : box === 'tgt' ? 'verso-target' : 'verso-source') as HTMLTextAreaElement | null;
        if (!el || el.readOnly) return;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }, 30);
      return;
    }
    setEditing({ uid: sheet.entries[i].uid, file: s.file, sheet: sheetIdx, c, text: getCell(sheet.entries[i], c) });
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
      const a = vpos.get(anchor.i) ?? -1, b = vpos.get(i) ?? -1;
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
    const a = vpos.get(d.i) ?? -1, b = vpos.get(i) ?? -1;
    const [p0, p1] = a < b ? [a, b] : [b, a];
    const rows = visible.slice(Math.max(0, p0), p1 + 1).flatMap(rowKeys);
    pick([...new Set([...d.base, ...rows])], { i: d.i, c: 0 });
  };
  const commitEdit = () => {
    const ed = editRef.current;
    if (!ed) return;
    setEditing(null);
    // 用 uid 找回這一條；換了頁簽、檔案也寫回原本那一頁
    s.editSheet((es) => {
      const j = es.findIndex((e) => e.uid === ed.uid);
      if (j < 0 || getCell(es[j], ed.c) === ed.text) return { entries: es };
      // 存檔後會超過 Excel 一格的上限：不收這次編輯
      if (!entryFits(setCell(es[j], ed.c, ed.text))) { showToast(tooLongMsg()); return { entries: es }; }
      return {
        entries: es.map((e, k) => (k !== j ? e : { ...setCell(e, ed.c, ed.text), ...(ed.c === TGT_COL ? { pending: false } : {}) })),
        keys: [cellKey(j, ed.c)],
      };
    }, { file: ed.file, sheet: ed.sheet });
  };
  // 換檔案、換頁簽、換篩選：編輯中的內容先確定
  useEffect(() => { commitEdit(); }, [s.file, sheetIdx, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const menuAct = (k: string) => {
    setMenu(null);
    sink.current?.focus({ preventScroll: true });
    if (readOnly) return;
    if (k === 'applySrc') { s.applyAllNewSources(withChains(selRows)); return; }
    // 收起組、條目串
    if (k === 'collapse') { s.collapseRows(selRows); return; }
    if (k === 'split') { s.splitAt(selRows[0]); return; }
    if (k === 'mergeChain') { s.mergeChains(selRows.map((i) => sheet.entries[i].uid)); return; }
    const first = firstKey(keys);
    // 標記選單出現在滑鼠位置（相對於整個畫面），太靠下時往上移
    const menuAt = (x: number, y: number) => {
      const root = listRef.current?.closest('[data-root]') as HTMLElement | null;
      const rr = root?.getBoundingClientRect() ?? new DOMRect();
      const h = 44 + (6 + customs.length) * 32 + (customs.length ? 9 : 0) + 42;
      return { x: Math.round(x - rr.left), y: Math.round(Math.max(8, Math.min(y - rr.top, (root?.offsetHeight ?? 800) - h - 10))) };
    };
    if (k === 'mark' && menu) {
      // 框選了幾條就一次改幾條（收起的條目串是整串）
      const rowsSel = withChains([...new Set(keys.map((x) => parseKey(x).i))]);
      set({ rowMenu: { index: rowsSel[0], indices: rowsSel, ...menuAt(menu.x, menu.y) }, stampOpen: false, fileMenuOpen: false });
      return;
    }
    // 雲端模式「移除」：選到的條目整條不再讀取
    if (k === 'remove') { rowHook.fn?.('remove', withChains(selRows), 0); return; }
    if (k === 'edit') startEdit(first.i, first.c);
    if (k === 'clear') { const ks = keys.flatMap((x) => { const { i, c } = parseKey(x); return withChains([i]).map((j) => cellKey(j, c)); }); s.editSheet((es) => ({ entries: clearCells(es, ks), keys })); }
    if (menu?.kind === 'row') {
      // 整列：條目本身一起刪、插入、移動（標記、備註跟著走）
      const last = selRows[selRows.length - 1];
      // 雲端檔案：交給雲端外掛（同時改 Google 上的列）
      if (s.project?.files[s.file]?.cloud && (k === 'delete' || k === 'insert' || k === 'up' || k === 'down') && rowHook.fn?.(k, selRows, insertCount)) return;
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
    editText: (text) => { if (editRef.current) setEditing({ ...editRef.current, text }); },
    commitEdit: (refocus) => { commitEdit(); if (refocus) sink.current?.focus({ preventScroll: true }); },
    cancelEdit: () => { setEditing(null); sink.current?.focus({ preventScroll: true }); },
    isEditing: (uid, c) => editRef.current?.uid === uid && editRef.current.c === c,
    toggleChain: (i) => { const c = layout?.chainOf.get(i); if (c) toggleSet('c:' + c.id); },
    railClick: (key) => { setRailHot(null); toggleSet(key, false, true); },
    railHover: (key) => setRailHot(key),
  };

  // ---- 收起組、條目串的右鍵選單項目 ----
  const inGroup = (i: number) => !!sheet.entries[i] && !!layout?.groups.some((g) => g.uids.includes(sheet.entries[i].uid));
  const lastOfSet = (i: number) => {
    const u = sheet.entries[i]?.uid;
    const g = layout?.groups.find((x) => x.uids.includes(u));
    if (g) return g.uids[g.uids.length - 1] === u;
    const c = layout?.chainOf.get(i);
    return !c || c.uids[c.uids.length - 1] === u;
  };
  const canSplit = selRows.length === 1 && (inGroup(selRows[0]) || !!layout?.chainOf.get(selRows[0])) && !lastOfSet(selRows[0])
    && !(layout?.chainOf.get(selRows[0]) && !inGroup(selRows[0]) && !setOpen[setKey(fileDoc, sheetIdx, sheet, 'c:' + layout!.chainOf.get(selRows[0])!.id)]);
  const cuts = new Set(sheet.chainCuts ?? []);
  const canMergeChain = !!fileDoc.skill && selRows.length >= 2 && sheet.entries.slice(selRows[0], selRows[selRows.length - 1]).some((e) => cuts.has(e.uid));
  const setItems = setsActive ? [
    { key: 'collapse', label: tx('sets.collapse'), disabled: readOnly || !selRows.length },
    ...(canSplit ? [{ key: 'split', label: tx('sets.split'), disabled: readOnly }] : []),
    ...(canMergeChain ? [{ key: 'mergeChain', label: tx('sets.merge'), disabled: readOnly }] : []),
  ] : [];

  // 收起組的名稱列：按住拖過好幾個是選取（合併用），沒拖動就是點一下（展開或收起）
  const groupOrder = () => items.flatMap((it) => (it.t === 'group' ? [it.g.id] : []));
  const groupDown = (ev: React.MouseEvent, id: string) => {
    if (ev.button !== 0) return;
    if (ev.ctrlKey || ev.metaKey || ev.shiftKey) { ev.preventDefault(); return; }
    ev.preventDefault();
    groupDrag.current = { from: id, moved: false };
    const up = () => { window.removeEventListener('mouseup', up); setTimeout(() => { groupDrag.current = null; }, 0); };
    window.addEventListener('mouseup', up);
  };
  const groupEnter = (ev: React.MouseEvent, id: string) => {
    const d = groupDrag.current;
    if (!d || !(ev.buttons & 1) || id === d.from) return;
    d.moved = true;
    const order = groupOrder();
    const a = order.indexOf(d.from), b = order.indexOf(id);
    if (a >= 0 && b >= 0) { const [x, y] = a < b ? [a, b] : [b, a]; setGroupSel(order.slice(x, y + 1)); }
  };
  const groupClick = (ev: React.MouseEvent, id: string) => {
    if (groupDrag.current?.moved) return;
    if (pickGroup(ev, id)) return;
    toggleSet('g:' + id);
  };
  // 收起組：Ctrl 點加選、Shift 點選一段（合併用）
  const pickGroup = (ev: React.MouseEvent, id: string) => {
    if (ev.ctrlKey || ev.metaKey) { setGroupSel((g) => (g.includes(id) ? g.filter((x) => x !== id) : [...g, id])); return true; }
    if (ev.shiftKey && groupSel.length) {
      const order = items.flatMap((it) => (it.t === 'group' ? [it.g.id] : []));
      const a = order.indexOf(groupSel[groupSel.length - 1]), b = order.indexOf(id);
      if (a >= 0 && b >= 0) { const [x, y] = a < b ? [a, b] : [b, a]; setGroupSel(order.slice(x, y + 1)); return true; }
    }
    if (ev.shiftKey) { setGroupSel([id]); return true; }
    if (groupSel.length) setGroupSel([]);
    return false;
  };
  const groupAct = (k: string) => {
    const gm = groupMenu;
    setGroupMenu(null);
    if (!gm) return;
    const g = layout?.groups.find((x) => x.id === gm.id);
    if (!g) return;
    if (k === 'g-toggle') toggleSet('g:' + g.id);
    if (readOnly) return;
    if (k === 'g-rename') s.set({ groupNaming: g.id });
    if (k === 'g-auto') s.setGroupAuto(g.id, !g.auto);
    if (k === 'g-merge') { s.mergeSets([...new Set([...groupSel, g.id])]); setGroupSel([]); }
    if (k === 'g-dissolve') s.dissolveGroup(g.id);
    // 對整組（選了好幾組就是每一組）的條目一次操作：標記、不再使用
    const ids = new Set([...groupSel, g.id]);
    const members = [...new Set((layout?.groups ?? []).filter((x) => ids.has(x.id)).flatMap((x) => x.uids))]
      .map((u) => sheet.entries.findIndex((e) => e.uid === u)).filter((i) => i >= 0).sort((a, b) => a - b);
    if (!members.length) return;
    if (k === 'g-mark') {
      const root = listRef.current?.closest('[data-root]') as HTMLElement | null;
      const rr = root?.getBoundingClientRect() ?? new DOMRect();
      const h = 44 + (6 + customs.length) * 32 + (customs.length ? 9 : 0) + 42;
      set({ rowMenu: { index: members[0], indices: members, x: Math.round(gm.x - rr.left), y: Math.round(Math.max(8, Math.min(gm.y - rr.top, (root?.offsetHeight ?? 800) - h - 10))) }, stampOpen: false, fileMenuOpen: false });
    }
    if (k === 'g-remove') { rowHook.fn?.('remove', members, 0); setGroupSel([]); }
  };
  /** 收起的條目串在條目欄是一列（代表它的那一條）：對它操作就是對整串 */
  const withChains = (rows: number[]) => [...new Set(rows.flatMap((i) => {
    const c = layout?.chainOf.get(i);
    return c && i === c.rep && !setOpen[setKey(fileDoc, sheetIdx, sheet, 'c:' + c.id)] ? c.idx : [i];
  }))].sort((a, b) => a - b);
  // 組、串裡有哪些標記、各幾條（照頁簽的順序：未翻譯、已翻譯、AI、已驗證、疑慮、待思考、忽略、自訂）
  const MARK_ORDER: MarkId[] = ['untranslated', 'translated', 'ai', 'verified', 'doubt', 'think', 'ignore', ...customs.map((c) => `c:${c.id}` as MarkId)];
  const marksOf = (idx: number[]) => {
    const n = new Map<MarkId, number>();
    idx.forEach((i) => { const m = all[i]?.m; if (m) n.set(m, (n.get(m) ?? 0) + 1); });
    return MARK_ORDER.filter((id) => n.get(id)).map((id) => ({ id, n: n.get(id)! }));
  };
  // 剛展開的組或串：底下的條目跑一次彈性動畫
  const fresh = recent.current && performance.now() - recent.current.t < 700 ? recent.current.key : null;
  const entering = new Set<string>();
  if (fresh) {
    const at = items.findIndex((it) => it.key === fresh);
    const head = items[at];
    if (head && (head.t === 'group' || head.t === 'chain') && head.open) {
      const d0 = head.t === 'chain' ? head.depth : 0;
      for (let q = at + 1; q < items.length; q++) {
        const it = items[q];
        if ((it.t === 'row' || it.t === 'chain') && it.depth > d0) entering.add(it.key); else break;
      }
    }
  }

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
        {/* 外掛的按鈕（例如 AI） */}
        {plugins.map((p) => p.ListToolbar && <p.ListToolbar key={p.id} />)}
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
        <FilterPanel counts={cnt} />
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
      <div ref={listRef} onScroll={syncView} onMouseDown={(ev) => { if (ev.target === ev.currentTarget || !(ev.target as HTMLElement).closest('.rw')) { ev.preventDefault(); sink.current?.focus({ preventScroll: true }); } }} style={{ position: 'relative', flexGrow: 1, overflowY: 'auto', overflowAnchor: 'none', scrollbarGutter: 'stable', padding: '4px 0', userSelect: 'none' }}>
        <textarea ref={sink} className="list-sink" aria-label={tx('list.028')} value="" onChange={() => {}}
          onCopy={onCopy} onPaste={onPaste} onKeyDown={onSinkKey}
          style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1, padding: 0, border: 0, opacity: 0, resize: 'none', pointerEvents: 'none' }} />
        {/* 畫面外的條目不畫，用上下兩塊空白撐出整個捲軸的長度 */}
        {start > 0 && <div aria-hidden="true" style={{ height: offsets[start] }} />}
        {items.slice(start, end).map((it, j) => {
          const k = start + j;
          if (it.t === 'group') {
            return (
              <div key={it.key} data-key={it.key} data-k={k}>
                <GroupItem g={it.g} name={it.g.name || autoName(sheet.entries, it.g)} open={it.open} count={it.members.length} marks={marksOf(it.members)} customs={customs} shown={it.shown}
                  naming={groupNaming === it.g.id} picked={groupSel.includes(it.g.id)} bounce={fresh === it.key}
                  onRename={(name) => s.renameGroup(it.g.id, name)}
                  onMenu={(ev) => { ev.preventDefault(); ev.stopPropagation(); setGroupMenu({ x: ev.clientX, y: ev.clientY, id: it.g.id }); }}
                  onDown={(ev) => groupDown(ev, it.g.id)} onEnter={(ev) => groupEnter(ev, it.g.id)} onClick={(ev) => groupClick(ev, it.g.id)} />
              </div>
            );
          }
          if (it.t === 'dots') return <div key={it.key} data-key={it.key} data-k={k}><DotsItem n={it.n} onOpen={() => toggleSet('g:' + it.gid, true)} /></div>;
          if (it.t === 'chain' && it.open) {
            return (
              <div key={it.key} data-key={it.key} data-k={k} className={closing === 'g:' + it.g ? 'set-out' : undefined}>
                <ChainBar c={it.c} depth={it.depth} bounce={fresh === it.key} marks={marksOf(it.c.idx)} customs={customs} onToggle={() => toggleSet('c:' + it.c.id)} />
              </div>
            );
          }
          const { e, i, m, issues } = all[it.i];
          const ch = it.t === 'chain' ? it.c : null;
          return (
            <EntryRow key={it.key} rowKey={it.key} e={e} i={i} aiLock={aiLocked.includes(e.uid)} k={k} m={m} issues={issues} on={ch ? ch.idx.includes(sel) : i === sel}
              hit={searchOn && (ch ? ch.idx.some((x) => searchHit(sheet.entries[x], searchQ)) : searchHit(e, searchQ))}
              selCols={selColsOf(i)} editing={editing && editing.uid === e.uid ? editing : null}
              customs={customs} cols={cols} fitId={colPx[0] - 2} fitSpk={colPx[1] - 12} fitSrc={colPx[2] - 16} fitTgt={colPx[3] - 32}
              fontId={fontId} fsId={fsId} fontSpk={cellFontCss(s.fonts, 'speaker')} fontSrc={cellFontCss(s.fonts, 'src')} fontTgt={cellFontCss(s.fonts, 'tgt')}
              ovfId={ovf.id} ovfSpk={ovf.speaker} ovfSrc={ovf.src} ovfTgt={ovf.tgt} h={handlers}
              depth={it.depth} inChain={it.t === 'row' && it.inChain} outlier={it.t === 'row' && it.outlier} enter={entering.has(it.key)}
              railG={it.g} gEnd={it.gEnd} railC={it.t === 'row' ? it.c : undefined} cEnd={it.t === 'row' && it.cEnd}
              hotG={!!it.g && railHot === 'g:' + it.g} hotC={it.t === 'row' && !!it.c && railHot === 'c:' + it.c}
              leave={!!closing && (closing === 'g:' + it.g || (it.t === 'row' && closing === 'c:' + it.c))}
              chainN={ch?.uids.length} chainSrc={ch?.src} chainTpl={ch ? (ch.tpl ? ch.tpl : '') : undefined} chainWarn={!!ch && ch.outliers.size > 0} />
          );
        })}
        {end < items.length && <div aria-hidden="true" style={{ height: offsets[items.length] - offsets[end] }} />}
        {items.length === 0 && (fileDoc.cloud?.stub
          // 雲端檔案還沒讀好：不是沒有條目，是還在載入
          ? <Loading />
          : (
          <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--mute)' }}>
            {shownCount(useStore.getState()) === 0 ? tx('list.029') : sheet.entries.length === 0 ? tx('list.030') : tx('list.031')}
          </div>
        ))}
      </div>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} label={tx('list.032')}
          items={menu.kind === 'col' ? [
            { key: 'clear', label: tx('list.033'), disabled: readOnly },
          ] : menu.kind === 'row' ? [
            { key: 'mark', label: tx('list.034'), disabled: readOnly },
            ...setItems,
            ...(selRows.some((i) => sheet.entries[i] && hasPendingUpdate(sheet.entries[i])) ? [{ key: 'applySrc', label: tx('list.035'), disabled: readOnly }] : []),
            { key: 'clear', label: tx('list.036'), disabled: readOnly },
            { key: 'delete', label: tx('list.037', { length: selRows.length }), danger: true, disabled: readOnly },
            { key: 'insert', label: tx('list.038'), disabled: readOnly, stepper: { value: insertCount, min: 1, max: 100, onChange: setInsertCount } },
            { key: 'up', label: tx('list.039'), disabled: readOnly },
            { key: 'down', label: tx('list.040'), disabled: readOnly },
            ...(cloudFile ? [{ key: 'remove', label: tx('cloud.remove'), danger: true, disabled: readOnly }] : []),
          ] : [
            { key: 'edit', label: tx('list.041'), disabled: readOnly || !canEdit(firstKey(keys).c) },
            { key: 'clear', label: tx('list.036'), disabled: readOnly },
            { key: 'mark', label: tx('list.034'), disabled: readOnly },
            ...setItems,
            ...(selRows.some((i) => sheet.entries[i] && hasPendingUpdate(sheet.entries[i])) ? [{ key: 'applySrc', label: tx('list.035'), disabled: readOnly }] : []),
            { key: 'up', label: tx('list.039'), disabled: readOnly },
            { key: 'down', label: tx('list.040'), disabled: readOnly },
            ...(cloudFile ? [{ key: 'remove', label: tx('cloud.remove'), danger: true, disabled: readOnly }] : []),
          ]}
          onPick={menuAct} onClose={() => { setMenu(null); sink.current?.focus({ preventScroll: true }); }} />
      )}
      {groupMenu && (() => {
        const g = layout?.groups.find((x) => x.id === groupMenu.id);
        if (!g) return null;
        const open = !!setOpen[setKey(fileDoc, sheetIdx, sheet, 'g:' + g.id)];
        return (
          <ContextMenu x={groupMenu.x} y={groupMenu.y} label={tx('sets.group')}
            items={[
              { key: 'g-toggle', label: open ? tx('sets.fold') : tx('sets.expand') },
              { key: 'g-rename', label: tx('sets.rename'), disabled: readOnly },
              { key: 'g-auto', label: tx('sets.auto'), checked: !!g.auto, disabled: readOnly },
              { key: 'g-mark', label: tx('list.034'), disabled: readOnly },
              ...(cloudFile ? [{ key: 'g-remove', label: tx('cloud.remove'), danger: true, disabled: readOnly }] : []),
              { key: 'g-merge', label: tx('sets.merge'), disabled: readOnly || new Set([...groupSel, g.id]).size < 2 },
              { key: 'g-dissolve', label: tx('sets.dissolve'), danger: true, disabled: readOnly },
            ]}
            onPick={groupAct} onClose={() => setGroupMenu(null)} />
        );
      })()}
      {confirm && <CopyConfirm {...confirm} onCancel={() => setConfirm(null)} onConfirm={() => void doCopy()} />}
    </section>
  );
}
