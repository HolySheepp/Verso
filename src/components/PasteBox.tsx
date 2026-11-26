import { tx } from '../i18n';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { readColumns } from '../model/clipboard';
import { hasTooLongCell, MAX_CELL_CHARS, tooLongMsg } from '../model/names';
import { showToast } from '../state/store';
import { clearRows, deleteRows, insertRow, setRow, usedLength, type Col } from '../model/paste';
import { IconWinClose } from './icons';
import { ContextMenu } from './ContextMenu';
import { focusOnMount } from './windowDrag';
import { cellFontCss, fz, overflowOf } from '../model/fonts';
import { useStore } from '../state/store';
import { CellText } from './CellText';
import { maxOf, minOf } from '../model/num';

/** 方框裡選到的東西：幾行（同一欄裡），或整欄 */
export type BoxSel = { rows: number[]; anchor: number } | 'col';

interface Props {
  label: string;
  col: Col | null;
  /** 貼上：可能一次貼了多欄，由外層決定怎麼往右填。start 有值時從那一行往下覆蓋，沒有時整欄換掉 */
  onPaste(columns: string[][], start?: number): void;
  /** 在方框裡編輯後的整欄 */
  onChange(col: Col | null): void;
  /** 整個視窗同時只有一個方框有選取 */
  selected: BoxSel | null;
  onSelect(sel: BoxSel | null): void;
  /** id、發話者欄照設定裡的字體與超框時行為顯示 */
  fontSlot?: 'id' | 'speaker';
  /** 標題旁標「＊必填」 */
  required?: boolean;
  /** 至少顯示幾行（不夠的補空白行，可以直接編輯）；沒給時，還沒貼的欄放 20 行 */
  minRows?: number;
  /** 同一組的方框一起捲動 */
  sync?: ScrollSync;
  /** 一打開就捲到最下面 */
  atBottom?: boolean;
}

/** 一起捲動的一組方框 */
export type ScrollSync = Set<HTMLDivElement>;

interface Menu { x: number; y: number }

/** 欄裡什麼都沒有時先放的空白行數（看得出來可以一次貼很多行，也能直接點選、右鍵、編輯） */
const BLANK_ROWS = 20;
const BLANK_COL: Col = { rows: Array<string>(BLANK_ROWS).fill(''), extra: 0 };
/** 從補上的空白行改出來的欄：補上的、結尾還是空白的行不算（記成略過的空白行），整欄都空白就還是沒貼 */
const trimBlank = (c: Col, keep: number): Col | null => {
  const n = Math.max(keep, usedLength(c.rows));
  return n ? { ...c, rows: c.rows.slice(0, n), extra: Math.max(c.extra, c.rows.length - n), ids: c.ids?.slice(0, n) } : null;
};
/** 一次只畫畫面附近的行（上下各多畫一些），其他的用空白撐住高度：幾萬行時也不卡 */
const OVERSCAN = 30;

const range = (a: number, b: number) => Array.from({ length: Math.abs(b - a) + 1 }, (_, k) => Math.min(a, b) + k);

/** 複製成試算表的格式：有換行、Tab 或引號的格子加上引號 */
const toTsv = (rows: string[]) => rows.map((r) => (/[\n\t"]/.test(r) ? `"${r.replace(/"/g, '""')}"` : r)).join('\n');

/**
 * 貼入一整欄的方框：點一下再按 Ctrl+V，優先讀剪貼簿裡的表格格式。
 * 點標題選整欄；點、Shift、Ctrl、拖動可以選多行。
 * Backspace 清除、Delete 刪除；選了行時 Ctrl+V 從那一行往下覆蓋，選整欄（或沒選）時整欄換掉。
 */
/**
 * 外層重畫（例如在檔名欄打字）時，方框的內容沒變就不重畫：貼了幾千行時才不會每打一個字都卡。
 * 傳進來的函式每次都是新的，所以不比較它們（它們用的都是會拿最新狀態的寫法）。
 */
export const PasteBox = memo(PasteBoxImpl, (a, b) =>
  a.label === b.label && a.col === b.col && a.selected === b.selected && a.fontSlot === b.fontSlot && a.required === b.required && a.minRows === b.minRows && a.sync === b.sync);

function PasteBoxImpl({ label, col: real, onPaste, onChange: change, selected, onSelect, fontSlot, required, minRows, sync, atBottom }: Props) {
  // 還沒貼：顯示 20 行空白；有給 minRows 時補到那麼多行。補上的行跟一般的行一樣操作，改了之後才變成真的
  const realN = real?.rows.length ?? 0;
  const want = minRows ?? (real ? 0 : BLANK_ROWS);
  const col = useMemo<Col>(() => (want <= realN ? real ?? BLANK_COL : { ...(real ?? BLANK_COL), rows: [...(real?.rows ?? []), ...Array<string>(want - realN).fill('')] }), [real, want, realN]);
  const padded = col !== real;
  const onChange = (c: Col | null) => change(c && padded ? trimBlank(c, realN) : c);
  const ovf = useStore((s) => (fontSlot ? overflowOf(s.fonts, fontSlot) : 'ellipsis'));
  // 「縮小字級」用量字寬的方式算，不必每一行都去量畫面（幾千行時量畫面會非常慢）
  const fitFont = useStore((s) => (fontSlot ? cellFontCss(s.fonts, fontSlot) : ''));
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxW, setBoxW] = useState(0);
  // 只畫畫面附近的行：行高量第一行，捲動位置、方框高度變了才重算
  const [view, setView] = useState({ top: 0, h: 600 });
  const [rowH, setRowH] = useState(23);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setView((v) => (v.h === el.clientHeight ? v : { ...v, h: el.clientHeight })));
    ro.observe(el);
    if (atBottom) el.scrollTop = el.scrollHeight;
    setView({ top: el.scrollTop, h: el.clientHeight });
    sync?.add(el);
    return () => { ro.disconnect(); sync?.delete(el); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const onScroll = (ev: React.UIEvent<HTMLDivElement>) => {
    const el = ev.currentTarget;
    setView((v) => (v.top === el.scrollTop ? v : { ...v, top: el.scrollTop }));
    // 同一組的方框跟著捲到同一個位置
    if (sync) for (const o of sync) if (o !== el && o.scrollTop !== el.scrollTop) o.scrollTop = el.scrollTop;
  };
  const measureRow = (el: HTMLDivElement | null) => { if (el && el.dataset.editing !== '1' && el.offsetHeight && el.offsetHeight !== rowH) setRowH(el.offsetHeight); };
  useEffect(() => {
    const el = boxRef.current;
    if (!el || ovf !== 'shrink') return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ovf]);
  // 行號欄只留最大行號需要的位數（8 行就 1 位數），行號靠右對齊
  const digits = Math.max(1, String(col.rows.length).length);
  // 方框寬度扣掉行號欄、間距和內距（原本以 4 位數算 50px，每少一位約少 6.5px）
  const fitW = Math.max(0, boxW - 50 + (4 - digits) * 6.5);
  const font = fontSlot === 'id' ? { family: 'var(--font-id)', size: 'var(--fs-id)' } : fontSlot === 'speaker' ? { family: 'var(--font-spk)', size: 'var(--fs-spk)' } : null;
  // 用一個看不見的文字框接收貼上，這樣不管點在方框哪裡、按 Ctrl+V 都一定會觸發貼上
  const input = useRef<HTMLTextAreaElement>(null);
  const [editing, setEditing] = useState<{ i: number; text: string } | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const dragFrom = useRef<number | null>(null);
  const rows = col.rows;
  const from = Math.max(0, Math.floor(view.top / rowH) - OVERSCAN);
  const to = Math.min(rows.length, Math.ceil((view.top + view.h) / rowH) + OVERSCAN);
  useEffect(() => { const el = boxRef.current; if (atBottom && el) { el.scrollTop = el.scrollHeight; setView((v) => ({ ...v, top: el.scrollTop })); } }, [rowH]); // eslint-disable-line react-hooks/exhaustive-deps
  const selRows = selected && selected !== 'col' ? selected.rows.filter((i) => rows && i < rows.length) : [];
  const selSet = useMemo(() => new Set(selRows), [selected, rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const colSel = selected === 'col';

  // 換了內容（例如重新貼上）就結束編輯
  useEffect(() => { setEditing(null); setMenu(null); }, [real === null]);
  useEffect(() => {
    const up = () => { dragFrom.current = null; };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  const handlePaste = (ev: React.ClipboardEvent) => {
    ev.preventDefault();
    const html = ev.clipboardData.getData('text/html');
    const text = ev.clipboardData.getData('text/plain');
    const cols = readColumns({ html, text });
    if (!cols.length) return;
    // 還沒貼時點了空白行再貼：照樣從那一行往下貼
    // 有一格超過 Excel 的上限：整次不貼
    if (hasTooLongCell(cols)) { showToast(tooLongMsg()); return; }
    setEditing(null);
    if (selRows.length) onPaste(cols, minOf(selRows));
    else onPaste(cols);
  };

  const handleCopy = (ev: React.ClipboardEvent) => {
    const out = colSel ? rows : [...selRows].sort((a, b) => a - b).map((i) => rows[i]);
    if (!out.length) return;
    ev.preventDefault();
    ev.clipboardData.setData('text/plain', toTsv(out));
  };

  const commit = () => {
    if (!editing) return;
    if (editing.i < col.rows.length && col.rows[editing.i] !== editing.text) onChange(setRow(col, editing.i, editing.text));
    setEditing(null);
  };

  const focusSink = () => input.current?.focus({ preventScroll: true });

  const clear = () => {
    onChange(clearRows(col, colSel ? col.rows.map((_, i) => i) : selRows));
  };
  const remove = () => {
    if (colSel) { onChange(null); onSelect('col'); return; }
    if (!selRows.length) return;
    const next = deleteRows(col, selRows);
    onChange(next.rows.length ? next : null);
    const at = Math.min(minOf(selRows), next.rows.length - 1);
    onSelect(at >= 0 ? { rows: [at], anchor: at } : null);
  };
  const insert = () => {
    if (!selRows.length) return;
    const at = maxOf(selRows);
    onChange(insertRow(col, at));
    setEditing({ i: at + 1, text: '' });
    onSelect({ rows: [at + 1], anchor: at + 1 });
  };

  const act = (kind: string) => {
    setMenu(null);
    if (kind === 'edit' && selRows.length) setEditing({ i: selRows[0], text: rows[selRows[0]] });
    if (kind === 'clear') clear();
    if (kind === 'delete') remove();
    if (kind === 'insert') insert();
  };

  // 點行：單選；Shift 延伸；Ctrl 加選或取消；按住拖動選連續的幾行
  const rowDown = (ev: React.MouseEvent, i: number) => {
    if (ev.button !== 0) return;
    if (ev.shiftKey && selected && selected !== 'col') { onSelect({ rows: range(selected.anchor, i), anchor: selected.anchor }); return; }
    if (ev.ctrlKey || ev.metaKey) {
      const has = selRows.includes(i);
      const next = has ? selRows.filter((x) => x !== i) : [...selRows, i];
      onSelect(next.length ? { rows: next, anchor: i } : null);
      return;
    }
    dragFrom.current = i;
    onSelect({ rows: [i], anchor: i });
  };
  const rowEnter = (ev: React.MouseEvent, i: number) => {
    const from = dragFrom.current;
    if (from === null || !(ev.buttons & 1)) return;
    onSelect({ rows: range(from, i), anchor: from });
  };

  return (
    <div style={{ minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className={'pb-head' + (colSel ? ' pb-head-sel' : '')} title={tx('pastebox.001')}
        onMouseDown={(ev) => { if (ev.button !== 0 || (ev.target as HTMLElement).closest('button')) return; ev.preventDefault(); commit(); onSelect('col'); focusSink(); }}
        style={{ height: 22, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px', borderRadius: 5, cursor: 'pointer' }}>
        <span style={{ fontSize: fz(12), color: colSel ? 'var(--accent2)' : 'var(--text2)' }}>
          {label}{required && <span style={{ marginLeft: 6, fontSize: fz(11), color: 'var(--warntx)' }}>{tx('pastebox.002')}</span>}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: fz(11.5), color: 'var(--mute)' }}>
          {real && <>{tx('pastebox.003', { n: realN })}
            <button type="button" className="ib" aria-label={tx('pastebox.004', { label })} title={tx('pastebox.005')} onClick={() => onChange(null)}
              style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'transparent', border: 0, borderRadius: 5, color: 'var(--mute)' }}>
              <IconWinClose size={10} sw={1.4} />
            </button></>}
        </span>
      </div>
      <div ref={boxRef} className="paste-box" data-colsel={colSel ? '1' : undefined} onScroll={onScroll}
        onMouseDown={(ev) => {
          // 編輯中的文字框自己處理滑鼠；點到捲軸以外的地方都把焦點交給接收貼上的文字框
          if ((ev.target as HTMLElement).closest('.pb-edit')) return;
          if (ev.button !== 0) return;
          if (ev.target !== ev.currentTarget || ev.nativeEvent.offsetX < ev.currentTarget.clientWidth) {
            ev.preventDefault();
            commit();
            // 點在行以外的空白處：選整欄
            if (!(ev.target as HTMLElement).closest('.pb-row')) onSelect('col');
            focusSink();
          }
        }}
        style={{
          position: 'relative', flexGrow: 1, minHeight: 0, overflow: 'auto', boxSizing: 'border-box', padding: '6px 0',
          background: 'var(--bg0)', border: `1px ${real ? 'solid' : 'dashed'} var(--line4)`, borderRadius: 8, cursor: 'text',
        }}>
        <textarea ref={input} className="pb-sink" aria-label={label} value="" onChange={() => {}} onPaste={handlePaste} onCopy={handleCopy} spellCheck={false}
          onKeyDown={(ev) => {
            if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
            if (!colSel && !selRows.length) return;
            if (ev.key === 'Backspace') { ev.preventDefault(); clear(); }
            if (ev.key === 'Delete') { ev.preventDefault(); remove(); }
          }}
          style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1, padding: 0, border: 0, opacity: 0, resize: 'none', pointerEvents: 'none' }} />
        {from > 0 && <div style={{ height: from * rowH }} />}
        {rows.slice(from, to).map((r, k) => { const i = from + k; return (
          <div key={i} ref={k === 0 ? measureRow : undefined} className="pb-row" data-editing={editing?.i === i ? '1' : undefined} data-selected={selSet.has(i) ? '1' : undefined}
            onMouseDown={(ev) => rowDown(ev, i)} onMouseEnter={(ev) => rowEnter(ev, i)}
            onDoubleClick={() => setEditing({ i, text: r })}
            onContextMenu={(ev) => {
              ev.preventDefault();
              commit();
              if (!selSet.has(i)) onSelect({ rows: [i], anchor: i });
              setMenu({ x: ev.clientX, y: ev.clientY });
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 8px 2px 4px', fontSize: fz(12.5), lineHeight: 1.5 }}>
            <span className="mono" style={{ width: digits + 'ch', flexShrink: 0, textAlign: 'right', fontSize: fz(10.5), color: 'var(--mute3)', lineHeight: '19px' }}>{i + 1}</span>
            {editing?.i === i ? (
              <textarea maxLength={MAX_CELL_CHARS} className="pb-edit" ref={focusOnMount} value={editing.text} spellCheck={false}
                rows={Math.max(1, editing.text.split('\n').length)}
                onChange={(ev) => setEditing({ i, text: ev.target.value })}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); commit(); focusSink(); }
                  if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); setEditing(null); focusSink(); }
                }}
                onBlur={commit}
                style={{
                  flexGrow: 1, minWidth: 0, margin: '-2px 0', padding: '1px 6px', resize: 'none', boxSizing: 'border-box',
                  background: 'var(--panel)', border: '1px solid var(--accent)', borderRadius: 4, color: 'var(--text)', fontSize: fz(12.5), lineHeight: 1.5,
                }} />
            ) : font && r ? (
              <CellText mode={ovf === 'shrink' && !boxW ? 'ellipsis' : ovf} fontSize={font.size} fit={boxW ? { width: fitW, font: fitFont, text: r.replace(/\n/g, ' ↵ ') } : undefined} style={{ fontFamily: font.family, color: 'var(--text)', lineHeight: 1.5 }}>{r.replace(/\n/g, ' ↵ ')}</CellText>
            ) : (
              <span style={{ minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', color: r ? 'var(--text)' : 'var(--mute3)' }}>
                {r ? r.replace(/\n/g, ' ↵ ') : '—'}
              </span>
            )}
          </div>
        ); })}
        {to < rows.length && <div style={{ height: (rows.length - to) * rowH }} />}
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} label={label + (selRows.length > 1 ? tx('pastebox.006', { length: selRows.length }) : tx('pastebox.007', { v1: (selRows[0] ?? 0) + 1 }))}
          items={[
            { key: 'edit', label: tx('pastebox.008'), disabled: selRows.length !== 1 },
            { key: 'clear', label: tx('pastebox.009') },
            { key: 'delete', label: tx('pastebox.010'), danger: true },
            { key: 'insert', label: tx('pastebox.011') },
          ]}
          onPick={act}
          onClose={() => { setMenu(null); focusSink(); }} />
      )}
    </div>
  );
}
