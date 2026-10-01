import { useEffect, useRef, useState } from 'react';
import { readColumns } from '../model/clipboard';
import { clearRows, deleteRows, insertRow, setRow, type Col } from '../model/paste';
import { IconWinClose } from './icons';
import { ContextMenu } from './ContextMenu';
import { focusOnMount } from './windowDrag';
import { fz, overflowOf } from '../model/fonts';
import { useStore } from '../state/store';
import { CellText } from './CellText';

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
}

interface Menu { x: number; y: number }

const range = (a: number, b: number) => Array.from({ length: Math.abs(b - a) + 1 }, (_, k) => Math.min(a, b) + k);

/** 複製成試算表的格式：有換行、Tab 或引號的格子加上引號 */
const toTsv = (rows: string[]) => rows.map((r) => (/[\n\t"]/.test(r) ? `"${r.replace(/"/g, '""')}"` : r)).join('\n');

/**
 * 貼入一整欄的方框：點一下再按 Ctrl+V，優先讀剪貼簿裡的表格格式。
 * 點標題選整欄；點、Shift、Ctrl、拖動可以選多行。
 * Backspace 清除、Delete 刪除；選了行時 Ctrl+V 從那一行往下覆蓋，選整欄（或沒選）時整欄換掉。
 */
export function PasteBox({ label, col, onPaste, onChange, selected, onSelect, fontSlot }: Props) {
  const ovf = useStore((s) => (fontSlot ? overflowOf(s.fonts, fontSlot) : 'ellipsis'));
  const font = fontSlot === 'id' ? { family: 'var(--font-id)', size: 'var(--fs-id)' } : fontSlot === 'speaker' ? { family: 'var(--font-spk)', size: 'var(--fs-spk)' } : null;
  // 用一個看不見的文字框接收貼上，這樣不管點在方框哪裡、按 Ctrl+V 都一定會觸發貼上
  const input = useRef<HTMLTextAreaElement>(null);
  const [editing, setEditing] = useState<{ i: number; text: string } | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const dragFrom = useRef<number | null>(null);
  const rows = col?.rows ?? null;
  const selRows = selected && selected !== 'col' ? selected.rows.filter((i) => rows && i < rows.length) : [];
  const colSel = selected === 'col';

  // 換了內容（例如重新貼上）就結束編輯
  useEffect(() => { setEditing(null); setMenu(null); }, [col === null]);
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
    setEditing(null);
    if (selRows.length) onPaste(cols, Math.min(...selRows));
    else onPaste(cols);
  };

  const handleCopy = (ev: React.ClipboardEvent) => {
    if (!rows) return;
    const out = colSel ? rows : [...selRows].sort((a, b) => a - b).map((i) => rows[i]);
    if (!out.length) return;
    ev.preventDefault();
    ev.clipboardData.setData('text/plain', toTsv(out));
  };

  const commit = () => {
    if (!editing || !col) return;
    if (editing.i < col.rows.length && col.rows[editing.i] !== editing.text) onChange(setRow(col, editing.i, editing.text));
    setEditing(null);
  };

  const focusSink = () => input.current?.focus();

  const clear = () => {
    if (!col) return;
    onChange(clearRows(col, colSel ? col.rows.map((_, i) => i) : selRows));
  };
  const remove = () => {
    if (!col) return;
    if (colSel) { onChange(null); onSelect('col'); return; }
    if (!selRows.length) return;
    const next = deleteRows(col, selRows);
    onChange(next.rows.length ? next : null);
    const at = Math.min(Math.min(...selRows), next.rows.length - 1);
    onSelect(at >= 0 ? { rows: [at], anchor: at } : null);
  };
  const insert = () => {
    if (!col || !selRows.length) return;
    const at = Math.max(...selRows);
    onChange(insertRow(col, at));
    setEditing({ i: at + 1, text: '' });
    onSelect({ rows: [at + 1], anchor: at + 1 });
  };

  const act = (kind: string) => {
    setMenu(null);
    if (!rows) return;
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
      <div className={'pb-head' + (colSel ? ' pb-head-sel' : '')} title="選取整欄"
        onMouseDown={(ev) => { if (ev.button !== 0 || (ev.target as HTMLElement).closest('button')) return; ev.preventDefault(); commit(); onSelect('col'); focusSink(); }}
        style={{ height: 22, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px', borderRadius: 5, cursor: 'pointer' }}>
        <span style={{ fontSize: fz(12), color: colSel ? 'var(--accent2)' : 'var(--text2)' }}>{label}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: fz(11.5), color: 'var(--mute)' }}>
          {rows && <>{rows.length} 行
            <button type="button" className="ib" aria-label={'清除' + label} title="清除" onClick={() => onChange(null)}
              style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'transparent', border: 0, borderRadius: 5, color: 'var(--mute)' }}>
              <IconWinClose size={10} sw={1.4} />
            </button></>}
        </span>
      </div>
      <div className="paste-box" data-colsel={colSel ? '1' : undefined}
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
          position: 'relative', flexGrow: 1, minHeight: 0, overflow: 'auto', boxSizing: 'border-box', padding: rows ? '6px 0' : 0,
          background: 'var(--bg0)', border: `1px ${rows ? 'solid' : 'dashed'} var(--line4)`, borderRadius: 8, cursor: 'text',
        }}>
        <textarea ref={input} className="pb-sink" aria-label={label} value="" onChange={() => {}} onPaste={handlePaste} onCopy={handleCopy} spellCheck={false}
          onKeyDown={(ev) => {
            if (!rows || ev.ctrlKey || ev.altKey || ev.metaKey) return;
            if (!colSel && !selRows.length) return;
            if (ev.key === 'Backspace') { ev.preventDefault(); clear(); }
            if (ev.key === 'Delete') { ev.preventDefault(); remove(); }
          }}
          style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1, padding: 0, border: 0, opacity: 0, resize: 'none', pointerEvents: 'none' }} />
        {rows ? rows.map((r, i) => (
          <div key={i} className="pb-row" data-editing={editing?.i === i ? '1' : undefined} data-selected={selRows.includes(i) ? '1' : undefined}
            onMouseDown={(ev) => rowDown(ev, i)} onMouseEnter={(ev) => rowEnter(ev, i)}
            onDoubleClick={() => setEditing({ i, text: r })}
            onContextMenu={(ev) => {
              ev.preventDefault();
              commit();
              if (!selRows.includes(i)) onSelect({ rows: [i], anchor: i });
              setMenu({ x: ev.clientX, y: ev.clientY });
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 8px 2px 4px', fontSize: fz(12.5), lineHeight: 1.5 }}>
            {/* 行號欄剛好放得下 4 位數 */}
            <span className="mono" style={{ width: '4ch', flexShrink: 0, textAlign: 'right', fontSize: fz(10.5), color: 'var(--mute3)', lineHeight: '19px' }}>{i + 1}</span>
            {editing?.i === i ? (
              <textarea className="pb-edit" ref={focusOnMount} value={editing.text} spellCheck={false}
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
              <CellText mode={ovf} fontSize={font.size} style={{ fontFamily: font.family, color: 'var(--text)', lineHeight: 1.5 }}>{r.replace(/\n/g, ' ↵ ')}</CellText>
            ) : (
              <span style={{ minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', color: r ? 'var(--text)' : 'var(--mute3)' }}>
                {r ? r.replace(/\n/g, ' ↵ ') : '—'}
              </span>
            )}
          </div>
        )) : (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mute3)', fontSize: fz(12.5), userSelect: 'none' }}>
            Ctrl+V
          </div>
        )}
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} label={label + (selRows.length > 1 ? ` ${selRows.length} 行` : ` 第 ${(selRows[0] ?? 0) + 1} 行`)}
          items={[
            { key: 'edit', label: '編輯', disabled: selRows.length !== 1 },
            { key: 'clear', label: '清空' },
            { key: 'delete', label: '刪除', danger: true },
            { key: 'insert', label: '插入' },
          ]}
          onPick={act}
          onClose={() => { setMenu(null); focusSink(); }} />
      )}
    </div>
  );
}
