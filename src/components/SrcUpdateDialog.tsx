import { tx } from '../i18n';
import { memo, useMemo, useRef, useState } from 'react';
import { currentOf, useStore } from '../state/store';
import { checkColumns, emptyColumns, pasteColumns, type ColKey, type Columns } from '../model/paste';
import {
  applyUpdate, deleteBlank, insertBlank, moveCells, rowInfos, sequentialRows, summarize,
  type AlignRow, type NewRow, type RowInfo, type Side,
} from '../model/srcUpdate';
import type { Entry } from '../model/types';
import { autoAlignAsync } from '../model/alignAsync';
import { PasteBox, type BoxSel } from './PasteBox';
import { ConfirmDialog } from './ConfirmDialog';
import { ContextMenu } from './ContextMenu';
import { IconWinClose } from './icons';
import { dragWindow } from './windowDrag';
import { fz } from '../model/fonts';

const KEYS: ColKey[] = ['id', 'speaker', 'src'];
const LABELS: Record<string, string> = { id: 'ID', get speaker() { return tx('srcupd.001'); }, get src() { return tx('srcupd.002'); } };

/** 頁簽右鍵「更新原文（實驗性功能）」 */
export function SrcUpdateDialog() {
  const sheet = useStore((s) => s.srcUpdate);
  return sheet === null ? null : <SrcUpdate sheetIdx={sheet} />;
}

/** 對齊視窗的欄：順序、舊原文、箭頭、新原文、相似度 */
const GRID = '36px minmax(0, 1fr) 40px minmax(0, 1fr) 96px';
const RED = '#ff4d4f';
const YELLOW = '#e8b93a';

const btn: React.CSSProperties = { height: 36, padding: '0 16px', background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, fontSize: fz(13) };
const primary: React.CSSProperties = { height: 36, padding: '0 18px', background: 'var(--primary)', border: 0, borderRadius: 8, color: '#ffffff', fontSize: fz(13), fontWeight: 600 };

function SrcUpdate({ sheetIdx }: { sheetIdx: number }) {
  const { set, applySrcUpdate } = useStore.getState();
  const sheet = useStore((s) => currentOf(s).fileDoc.sheets[sheetIdx]);
  const close = () => set({ srcUpdate: null });
  const [cols, setCols] = useState<Columns>(emptyColumns);
  const [sel, setSel] = useState<{ key: string; sel: BoxSel } | null>(null);
  const [step, setStep] = useState<'paste' | 'align'>('paste');
  // 對齊結果與視窗內的復原紀錄
  const [hist, setHist] = useState<{ rows: AlignRow[]; past: AlignRow[][]; future: AlignRow[][] }>({ rows: [], past: [], future: [] });
  /** 回到貼入步驟或原文欄改了：舊的對齊結果對不上了，清掉 */
  const resetAlign = () => setHist({ rows: [], past: [], future: [] });
  const rows = hist.rows;
  const commit = (next: AlignRow[]) => setHist((h) => ({ rows: next, past: [...h.past.slice(-99), h.rows], future: [] }));
  const undo = () => setHist((h) => (h.past.length ? { rows: h.past[h.past.length - 1], past: h.past.slice(0, -1), future: [h.rows, ...h.future] } : h));
  const redo = () => setHist((h) => (h.future.length ? { rows: h.future[0], past: [...h.past, h.rows], future: h.future.slice(1) } : h));
  const [busy, setBusy] = useState(false);
  const alignRun = useRef(0);
  const [confirm, setConfirm] = useState(false);

  const check = checkColumns(cols);
  const next: NewRow[] = useMemo(() => (cols.src?.rows ?? []).map((src, i) => ({ id: cols.id?.rows[i] ?? '', speaker: cols.speaker?.rows[i] ?? '', src })), [cols]);
  const entries = sheet?.entries ?? [];
  // 只在對齊步驟才算；對不上的索引（例如原文欄改過）當成空格，避免整個畫面出錯
  const safeRows = useMemo(() => (step === 'align' ? rows.map((r) => ({
    old: r.old !== null && r.old < entries.length ? r.old : null,
    new: r.new !== null && r.new < next.length ? r.new : null,
  })) : []), [step, rows, entries.length, next.length]);
  const infos = useMemo(() => rowInfos(entries.map((e) => e.src), next.map((n) => n.src), safeRows, !busy), [safeRows, entries, next, busy]);
  const summary = useMemo(() => summarize(entries, next, safeRows), [entries, next, safeRows]);

  if (!sheet) return null;

  // 下一步：先照順序對應，接著自動比對（在視窗裡按 Ctrl+Z 可以回到照順序對應）
  const toAlign = () => {
    setHist({ rows: sequentialRows(entries.length, next.length), past: [], future: [] });
    setStep('align');
    setBusy(true);
    // 在背景執行緒算，畫面不會卡住；算完前按了「上一步」就丟掉結果
    const run = ++alignRun.current;
    autoAlignAsync(entries.map((e) => ({ id: e.id, src: e.src })), next)
      .then((r) => { if (run === alignRun.current) commit(r); })
      .catch(() => { /* 比對失敗：留在照順序對應 */ })
      .finally(() => { if (run === alignRun.current) setBusy(false); });
  };
  const apply = () => {
    applySrcUpdate(sheetIdx, applyUpdate(entries, next, safeRows, { id: !!cols.id, speaker: !!cols.speaker }));
  };

  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (step !== 'align' || !(ev.ctrlKey || ev.metaKey)) return;
    const k = ev.key.toLowerCase();
    if (k === 'z' && !ev.shiftKey) { ev.preventDefault(); ev.stopPropagation(); undo(); }
    else if (k === 'y' || (k === 'z' && ev.shiftKey)) { ev.preventDefault(); ev.stopPropagation(); redo(); }
  };

  return (
    <div className="scrim" style={{ zIndex: 45 }} onKeyDown={onKeyDown}>
      <div role="dialog" aria-modal="true" aria-labelledby="verso-upd-title" className="dialog" tabIndex={-1}
        style={{ width: 960, height: 640, maxWidth: 'calc(100% - 48px)', maxHeight: 'calc(100% - 48px)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)', outline: 'none' }}>
        <div onMouseDown={dragWindow} style={{ height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px 0 20px', borderBottom: '1px solid var(--line)' }}>
          <h2 id="verso-upd-title" style={{ margin: 0, fontSize: fz(15), fontWeight: 600 }}>
            {tx('srcupd.003')}{sheet.name}<span style={{ marginLeft: 10, fontSize: fz(12), fontWeight: 400, color: 'var(--mute)' }}>{tx('srcupd.004')}</span>
          </h2>
          <button type="button" className="ib" aria-label={tx('srcupd.005')} onClick={close}
            style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 0, borderRadius: 8, color: 'var(--text2)' }}>
            <IconWinClose size={13} sw={1.4} />
          </button>
        </div>

        {step === 'paste' ? (
          <div style={{ flexGrow: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '120px 145px minmax(0, 1fr)', gap: 12, padding: '16px 20px' }}>
            {KEYS.map((k) => (
              <PasteBox key={k} label={LABELS[k]} col={cols[k]} required={k === 'src'} fontSlot={k === 'id' || k === 'speaker' ? k : undefined}
                onPaste={(values, start) => { resetAlign(); setCols((c) => ({ ...c, ...pasteColumns(KEYS, k, values, c, start) })); }}
                onChange={(col) => { resetAlign(); setCols((c) => ({ ...c, [k]: col })); }}
                selected={sel?.key === k ? sel.sel : null}
                onSelect={(s) => setSel(s === null ? null : { key: k, sel: s })} />
            ))}
          </div>
        ) : (
          <AlignGrid rows={safeRows} entries={entries} next={next} infos={infos} onChange={commit} />
        )}

        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 20px 16px', borderTop: '1px solid var(--line)' }}>
          <span role="alert" style={{ fontSize: fz(12.5), color: step === 'paste' && cols.src && !check.ok ? 'var(--errtx)' : 'var(--mute)' }}>
            {step === 'paste'
              ? (cols.src && !check.ok ? check.msg : tx('srcupd.006', { length: next.length, v1: entries.length }))
              : busy ? tx('srcupd.007') : tx('srcupd.008', { same: summary.same, changed: summary.changed, added: summary.added, removed: summary.removed })}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {step === 'paste' ? (
              <>
                <button type="button" className="btn btn-ghost" onClick={close} style={btn}>{tx('srcupd.009')}</button>
                <button type="button" className="btn btn-primary" disabled={!check.ok} onClick={toAlign} style={{ ...primary, opacity: check.ok ? 1 : 0.5 }}>{tx('srcupd.010')}</button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn-ghost" onClick={() => { alignRun.current++; setBusy(false); resetAlign(); setStep('paste'); }} style={btn}>{tx('srcupd.011')}</button>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => setConfirm(true)} style={primary}>{tx('srcupd.012')}</button>
              </>
            )}
          </div>
        </div>
      </div>
      {confirm && (
        <ConfirmDialog zIndex={60} title={tx('srcupd.013')}
          body={tx('srcupd.014', { same: summary.same, changed: summary.changed, added: summary.added, removed: summary.removed })}
          choices={[{ label: tx('srcupd.009'), onClick: () => setConfirm(false) }, { label: tx('srcupd.015'), primary: true, onClick: () => { setConfirm(false); apply(); } }]} />
      )}
    </div>
  );
}

type Sel = { side: Side; anchor: number; a: number; b: number };

/**
 * 對齊結果：左舊右新。可以像 Excel 一樣框選一邊的格子拖到別的位置
 * （插在放下的位置，原本的格子往下推，拖走的地方留空格），右鍵插入或刪除空格。
 */
function AlignGrid({ rows, entries, next, infos, onChange }: {
  rows: AlignRow[]; entries: Entry[]; next: NewRow[]; infos: RowInfo[]; onChange(rows: AlignRow[]): void;
}) {
  const [sel, setSel] = useState<Sel | null>(null);
  const [drop, setDrop] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; side: Side; row: number } | null>(null);
  const mode = useRef<'select' | 'move' | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const inSel = (side: Side, k: number) => !!sel && sel.side === side && k >= sel.a && k <= sel.b;
  /** 滑鼠底下是哪一格；在格子下半部時，放下的位置算下一列 */
  const cellAt = (x: number, y: number) => {
    const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-acell]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const k = Number(el.dataset.row);
    return { side: el.dataset.side as Side, row: k, edge: y > r.top + r.height / 2 ? k + 1 : k };
  };

  const onDown = (ev: React.PointerEvent) => {
    if (ev.button !== 0) return;
    const c = cellAt(ev.clientX, ev.clientY);
    if (!c) return;
    ev.preventDefault();
    // 焦點放在這裡，Ctrl+Z 才會作用在這個視窗
    box.current?.focus({ preventScroll: true });
    box.current?.setPointerCapture(ev.pointerId);
    if (inSel(c.side, c.row) && !ev.shiftKey) { mode.current = 'move'; setDrop(null); return; }
    mode.current = 'select';
    if (ev.shiftKey && sel && sel.side === c.side) setSel({ ...sel, a: Math.min(sel.anchor, c.row), b: Math.max(sel.anchor, c.row) });
    else setSel({ side: c.side, anchor: c.row, a: c.row, b: c.row });
  };
  const onMove = (ev: React.PointerEvent) => {
    if (!mode.current || !sel) return;
    // 拖到邊緣時自動捲動
    const el = box.current;
    if (el) {
      const r = el.getBoundingClientRect();
      if (ev.clientY < r.top + 24) el.scrollTop -= 14;
      else if (ev.clientY > r.bottom - 24) el.scrollTop += 14;
    }
    const c = cellAt(ev.clientX, ev.clientY);
    if (mode.current === 'select') {
      if (c && c.side === sel.side) setSel({ ...sel, a: Math.min(sel.anchor, c.row), b: Math.max(sel.anchor, c.row) });
    } else {
      const r = box.current?.getBoundingClientRect();
      // 拖到最後一格下面：放到最後
      if (!c && r && ev.clientY > r.top) setDrop(rows.length);
      else setDrop(c ? c.edge : null);
    }
  };
  const onUp = () => {
    const m = mode.current;
    mode.current = null;
    if (m !== 'move' || !sel || drop === null) { setDrop(null); return; }
    setDrop(null);
    // 放回原本的範圍裡等於沒動
    if (drop >= sel.a && drop <= sel.b + 1) return;
    const len = sel.b - sel.a + 1;
    onChange(moveCells(rows, sel.side, sel.a, sel.b, drop));
    const at = drop > sel.b ? drop - len : drop;
    setSel({ side: sel.side, anchor: at, a: at, b: at + len - 1 });
  };

  const onMenu = (ev: React.MouseEvent) => {
    const c = cellAt(ev.clientX, ev.clientY);
    if (!c) return;
    ev.preventDefault();
    if (!inSel(c.side, c.row)) setSel({ side: c.side, anchor: c.row, a: c.row, b: c.row });
    setMenu({ x: ev.clientX, y: ev.clientY, side: c.side, row: c.row });
  };
  const blanksIn = (side: Side, a: number, b: number) => {
    const out: number[] = [];
    for (let k = a; k <= b; k++) if (rows[k]?.[side] === null) out.push(k);
    return out;
  };
  const menuRange = menu && sel && sel.side === menu.side && inSel(menu.side, menu.row) ? { a: sel.a, b: sel.b } : menu ? { a: menu.row, b: menu.row } : null;
  const menuBlanks = menu && menuRange ? blanksIn(menu.side, menuRange.a, menuRange.b) : [];
  const onPick = (key: string) => {
    if (!menu || !menuRange) return;
    setMenu(null);
    if (key === 'insert') {
      // 在選取範圍上面插入同樣數量的空格
      let r = rows;
      for (let k = 0; k <= menuRange.b - menuRange.a; k++) r = insertBlank(r, menu.side, menuRange.a);
      onChange(r);
    } else {
      // 從下往上刪，前面的位置才不會跑掉
      let r = rows;
      for (const k of [...menuBlanks].reverse()) r = deleteBlank(r, menu.side, k);
      onChange(r);
      setSel(null);
    }
  };

  /** 這一邊在第 k 列的落點：放在上緣或（拖到最後時）下緣 */
  const dropOf = (side: Side, k: number): 'top' | 'bottom' | null => {
    if (drop === null || sel?.side !== side) return null;
    if (drop === rows.length && k === rows.length - 1) return 'bottom';
    return drop === k ? 'top' : null;
  };

  return (
    <div style={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '12px 20px 0' }}>
      <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 8, padding: '0 4px 8px', fontSize: fz(12), color: 'var(--text2)' }}>
        <span /><span>{tx('srcupd.016')}</span><span /><span>{tx('srcupd.017')}</span><span>{tx('srcupd.018')}</span>
      </div>
      <div ref={box} tabIndex={-1} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onContextMenu={onMenu}
        style={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 4px 12px', outline: 'none' }}>
        {rows.map((r, k) => {
          const info = infos[k];
          if (!info) return null;
          return (
            <AlignRowView key={k} k={k} info={info} o={r.old === null ? null : entries[r.old]} n={r.new === null ? null : next[r.new]}
              onOld={inSel('old', k)} onNew={inSel('new', k)} dropOld={dropOf('old', k)} dropNew={dropOf('new', k)} />
          );
        })}
      </div>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} label={tx('srcupd.019')} onClose={() => setMenu(null)} onPick={onPick}
          items={[{ key: 'insert', label: tx('srcupd.020') }, { key: 'delete', label: tx('srcupd.021'), disabled: !menuBlanks.length }]} />
      )}
    </div>
  );
}

/** 對齊表格的一格 */
function AlignCell({ side, k, text, id, on, drop }: { side: Side; k: number; text: string | null; id: string; on: boolean; drop: 'top' | 'bottom' | null }) {
  return (
    <div data-acell="" data-side={side} data-row={k} style={{
      minWidth: 0, minHeight: 34, boxSizing: 'border-box', padding: '6px 10px', borderRadius: 6, cursor: on ? 'grab' : 'default',
      background: on ? 'var(--acc-soft)' : text === null ? 'transparent' : 'var(--bg0)',
      border: `1px ${text === null ? 'dashed' : 'solid'} ${on ? 'var(--accent)' : 'var(--line)'}`,
      boxShadow: drop ? (drop === 'bottom' ? '0 3px 0 var(--accent)' : '0 -3px 0 var(--accent)') : undefined,
      fontSize: fz(12.5), lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: text === null ? 'var(--mute3)' : 'var(--text)', userSelect: 'none',
    }}>
      {text === null ? tx('srcupd.022') : <>{id && <span className="mono" style={{ marginRight: 8, fontSize: fz(11), color: 'var(--mute)' }}>{id}</span>}{text}</>}
    </div>
  );
}

/**
 * 對齊表格的一列。拖曳、選取時只有選取或落點有變的列會重畫；
 * 畫面外的列不排版、不繪製（content-visibility），上萬列也順。
 */
const AlignRowView = memo(function AlignRowView({ k, info, o, n, onOld, onNew, dropOld, dropNew }: {
  k: number; info: RowInfo; o: Entry | null; n: NewRow | null; onOld: boolean; onNew: boolean; dropOld: 'top' | 'bottom' | null; dropNew: 'top' | 'bottom' | null;
}) {
  const a = info.arrow;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 8, flexShrink: 0, contentVisibility: 'auto', containIntrinsicSize: 'auto 40px' }}>
      <div className="mono" style={{ paddingTop: 7, textAlign: 'right', fontSize: fz(11.5), color: 'var(--mute)' }}>{k + 1}</div>
      <div><AlignCell side="old" k={k} text={o ? o.src : null} id={o?.id ?? ''} on={onOld} drop={dropOld} /></div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {a !== 'same' && (
          <svg width="26" height="16" viewBox="0 0 26 16" aria-label={a === 'yellow' ? tx('srcupd.023') : tx('srcupd.024')}>
            <path d="M2 8h20M16 2.5l6 5.5-6 5.5" fill="none" stroke={a === 'yellow' ? YELLOW : RED} strokeWidth={a === 'yellow' ? 2.2 : 2.8} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      <div><AlignCell side="new" k={k} text={n ? n.src : null} id={n?.id ?? ''} on={onNew} drop={dropNew} /></div>
      <div style={{ paddingTop: 6, fontSize: fz(12), lineHeight: 1.4, color: a === 'same' ? 'var(--mute)' : a === 'yellow' ? YELLOW : RED }}>
        {info.sim === null ? '—' : Math.round(info.sim * 100) + '%'}
        {info.elsewhere !== null && <div style={{ color: 'var(--accent2)' }}>{tx('srcupd.025', { n: info.elsewhere })}</div>}
      </div>
    </div>
  );
});
