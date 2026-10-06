import { useMemo, useRef, useState } from 'react';
import { currentOf, useStore } from '../state/store';
import { checkColumns, emptyColumns, pasteColumns, type ColKey, type Columns } from '../model/paste';
import {
  applyUpdate, autoAlign, deleteBlank, insertBlank, moveCells, rowInfos, sequentialRows, summarize,
  type AlignRow, type NewRow, type RowInfo, type Side,
} from '../model/srcUpdate';
import type { Entry } from '../model/types';
import { PasteBox, type BoxSel } from './PasteBox';
import { ConfirmDialog } from './ConfirmDialog';
import { ContextMenu } from './ContextMenu';
import { IconWinClose } from './icons';
import { dragWindow } from './windowDrag';
import { fz } from '../model/fonts';

const KEYS: ColKey[] = ['id', 'speaker', 'src'];
const LABELS: Record<string, string> = { id: 'ID', speaker: '發話者', src: '原文' };

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
  const rows = hist.rows;
  const commit = (next: AlignRow[]) => setHist((h) => ({ rows: next, past: [...h.past.slice(-99), h.rows], future: [] }));
  const undo = () => setHist((h) => (h.past.length ? { rows: h.past[h.past.length - 1], past: h.past.slice(0, -1), future: [h.rows, ...h.future] } : h));
  const redo = () => setHist((h) => (h.future.length ? { rows: h.future[0], past: [...h.past, h.rows], future: h.future.slice(1) } : h));
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const check = checkColumns(cols);
  const next: NewRow[] = useMemo(() => (cols.src?.rows ?? []).map((src, i) => ({ id: cols.id?.rows[i] ?? '', speaker: cols.speaker?.rows[i] ?? '', src })), [cols]);
  const entries = sheet?.entries ?? [];
  const infos = useMemo(() => rowInfos(entries.map((e) => e.src), next.map((n) => n.src), rows), [rows, entries, next]);
  const summary = useMemo(() => summarize(entries, next, rows), [entries, next, rows]);

  if (!sheet) return null;

  const toAlign = () => { setHist({ rows: sequentialRows(entries.length, next.length), past: [], future: [] }); setStep('align'); };
  const analyse = () => {
    setBusy(true);
    // 先讓畫面顯示「解析中」，再開始算
    setTimeout(() => {
      commit(autoAlign(entries.map((e) => ({ id: e.id, src: e.src })), next));
      setBusy(false);
    }, 30);
  };
  const apply = () => {
    applySrcUpdate(sheetIdx, applyUpdate(entries, next, rows, { id: !!cols.id, speaker: !!cols.speaker }));
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
            更新原文：{sheet.name}<span style={{ marginLeft: 10, fontSize: fz(12), fontWeight: 400, color: 'var(--mute)' }}>實驗性功能</span>
          </h2>
          <button type="button" className="ib" aria-label="關閉" onClick={close}
            style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 0, borderRadius: 8, color: 'var(--text2)' }}>
            <IconWinClose size={13} sw={1.4} />
          </button>
        </div>

        {step === 'paste' ? (
          <div style={{ flexGrow: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '120px 145px minmax(0, 1fr)', gap: 12, padding: '16px 20px' }}>
            {KEYS.map((k) => (
              <PasteBox key={k} label={LABELS[k]} col={cols[k]} required={k === 'src'} fontSlot={k === 'id' || k === 'speaker' ? k : undefined}
                onPaste={(values, start) => setCols((c) => ({ ...c, ...pasteColumns(KEYS, k, values, c, start) }))}
                onChange={(col) => setCols((c) => ({ ...c, [k]: col }))}
                selected={sel?.key === k ? sel.sel : null}
                onSelect={(s) => setSel(s === null ? null : { key: k, sel: s })} />
            ))}
          </div>
        ) : (
          <AlignGrid rows={rows} entries={entries} next={next} infos={infos} onChange={commit} />
        )}

        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 20px 16px', borderTop: '1px solid var(--line)' }}>
          <span role="alert" style={{ fontSize: fz(12.5), color: step === 'paste' && cols.src && !check.ok ? 'var(--errtx)' : 'var(--mute)' }}>
            {step === 'paste'
              ? (cols.src && !check.ok ? check.msg : `新版 ${next.length} 條，目前 ${entries.length} 條`)
              : `沒變 ${summary.same}、改了 ${summary.changed}、新增 ${summary.added}、移除 ${summary.removed}`}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {step === 'paste' ? (
              <>
                <button type="button" className="btn btn-ghost" onClick={close} style={btn}>取消</button>
                <button type="button" className="btn btn-primary" disabled={!check.ok} onClick={toAlign} style={{ ...primary, opacity: check.ok ? 1 : 0.5 }}>下一步</button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn-ghost" onClick={() => setStep('paste')} style={btn}>上一步</button>
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={analyse} style={btn}>{busy ? '解析中…' : '解析差異'}</button>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => setConfirm(true)} style={primary}>確定</button>
              </>
            )}
          </div>
        </div>
      </div>
      {confirm && (
        <ConfirmDialog zIndex={60} title="套用新版原文？"
          body={`沒變 ${summary.same}、改了 ${summary.changed}、新增 ${summary.added}、移除 ${summary.removed}。套用後可以在條目欄按 Ctrl+Z 退回。`}
          choices={[{ label: '取消', onClick: () => setConfirm(false) }, { label: '套用', primary: true, onClick: () => { setConfirm(false); apply(); } }]} />
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
    setSel({ side: sel.side, anchor: drop, a: drop, b: drop + len - 1 });
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

  const cell = (side: Side, k: number, text: string | null, id: string): React.ReactNode => {
    const on = inSel(side, k);
    const dropHere = drop !== null && sel?.side === side && (drop === k || (drop === rows.length && k === rows.length - 1));
    const below = drop === rows.length && k === rows.length - 1;
    return (
      <div data-acell="" data-side={side} data-row={k} style={{
        minWidth: 0, minHeight: 34, boxSizing: 'border-box', padding: '6px 10px', borderRadius: 6, cursor: on ? 'grab' : 'default',
        background: on ? 'var(--acc-soft)' : text === null ? 'transparent' : 'var(--bg0)',
        border: `1px ${text === null ? 'dashed' : 'solid'} ${on ? 'var(--accent)' : 'var(--line)'}`,
        boxShadow: dropHere ? (below ? '0 3px 0 var(--accent)' : '0 -3px 0 var(--accent)') : undefined,
        fontSize: fz(12.5), lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: text === null ? 'var(--mute3)' : 'var(--text)', userSelect: 'none',
      }}>
        {text === null ? '（空格）' : <>{id && <span className="mono" style={{ marginRight: 8, fontSize: fz(11), color: 'var(--mute)' }}>{id}</span>}{text}</>}
      </div>
    );
  };

  return (
    <div style={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '12px 20px 0' }}>
      <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 8, padding: '0 4px 8px', fontSize: fz(12), color: 'var(--text2)' }}>
        <span /><span>目前的原文</span><span /><span>新版原文</span><span>相似度</span>
      </div>
      <div ref={box} tabIndex={-1} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onContextMenu={onMenu}
        style={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', display: 'grid', gridTemplateColumns: GRID, gap: '6px 8px', alignContent: 'start', padding: '4px 4px 12px', outline: 'none' }}>
        {rows.map((r, k) => {
          const info = infos[k];
          if (!info) return null;
          const a = info.arrow;
          const o = r.old === null ? null : entries[r.old];
          const n = r.new === null ? null : next[r.new];
          return [
            <div key={k + 'k'} className="mono" style={{ paddingTop: 7, textAlign: 'right', fontSize: fz(11.5), color: 'var(--mute)' }}>{k + 1}</div>,
            <div key={k + 'o'}>{cell('old', k, o ? o.src : null, o?.id ?? '')}</div>,
            <div key={k + 'a'} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {a !== 'same' && (
                <svg width="26" height="16" viewBox="0 0 26 16" aria-label={a === 'yellow' ? '有改' : '差很多或對面是空格'}>
                  <path d="M2 8h20M16 2.5l6 5.5-6 5.5" fill="none" stroke={a === 'yellow' ? YELLOW : RED} strokeWidth={a === 'yellow' ? 2.2 : 2.8} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>,
            <div key={k + 'n'}>{cell('new', k, n ? n.src : null, n?.id ?? '')}</div>,
            <div key={k + 'p'} style={{ paddingTop: 6, fontSize: fz(12), lineHeight: 1.4, color: a === 'same' ? 'var(--mute)' : a === 'yellow' ? YELLOW : RED }}>
              {info.sim === null ? '—' : Math.round(info.sim * 100) + '%'}
              {info.elsewhere !== null && <div style={{ color: 'var(--accent2)' }}>高相似：第 {info.elsewhere} 條</div>}
            </div>,
          ];
        })}
      </div>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} label="對齊" onClose={() => setMenu(null)} onPick={onPick}
          items={[{ key: 'insert', label: '插入空格' }, { key: 'delete', label: '刪除空格', disabled: !menuBlanks.length }]} />
      )}
    </div>
  );
}
