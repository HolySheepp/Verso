import { useEffect, useRef, useState } from 'react';
import { readColumns } from '../model/clipboard';
import type { Col } from '../model/paste';
import { IconWinClose } from './icons';

interface Props {
  label: string;
  col: Col | null;
  /** 貼上：可能一次貼了多欄，由外層決定怎麼往右填 */
  onPaste(columns: string[][]): void;
  /** 在方框裡編輯後的整欄 */
  onChange(col: Col | null): void;
}

interface Menu { i: number; x: number; y: number }

/**
 * 貼入一整欄的方框：點一下再按 Ctrl+V，優先讀剪貼簿裡的表格格式。
 * 貼上後可以雙擊某一行編輯，右鍵可以編輯、清空、刪除、插入。
 */
export function PasteBox({ label, col, onPaste, onChange }: Props) {
  // 用一個看不見的文字框接收貼上，這樣不管點在方框哪裡、按 Ctrl+V 都一定會觸發貼上
  const input = useRef<HTMLTextAreaElement>(null);
  const [editing, setEditing] = useState<{ i: number; text: string } | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const rows = col?.rows ?? null;

  // 換了內容（例如重新貼上）就結束編輯
  useEffect(() => { setEditing(null); setMenu(null); }, [col === null]);

  const handlePaste = (ev: React.ClipboardEvent) => {
    ev.preventDefault();
    const html = ev.clipboardData.getData('text/html');
    const text = ev.clipboardData.getData('text/plain');
    const cols = readColumns({ html, text });
    if (cols.length) { setEditing(null); onPaste(cols); }
  };

  const setRows = (next: string[]) => col && onChange({ ...col, rows: next });

  const commit = () => {
    if (!editing || !rows) return;
    if (editing.i < rows.length && rows[editing.i] !== editing.text) {
      setRows(rows.map((r, j) => (j === editing.i ? editing.text : r)));
    }
    setEditing(null);
  };

  const act = (kind: 'edit' | 'clear' | 'delete' | 'insert', i: number) => {
    setMenu(null);
    if (!rows) return;
    if (kind === 'edit') setEditing({ i, text: rows[i] });
    if (kind === 'clear') setRows(rows.map((r, j) => (j === i ? '' : r)));
    if (kind === 'delete') setRows(rows.filter((_, j) => j !== i));
    if (kind === 'insert') {
      setRows([...rows.slice(0, i + 1), '', ...rows.slice(i + 1)]);
      setEditing({ i: i + 1, text: '' });
    }
  };

  return (
    <div style={{ minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ height: 22, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, color: 'var(--text2)' }}>{label}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--mute)' }}>
          {rows && <>{rows.length} 行
            <button type="button" className="ib" aria-label={'清除' + label} title="清除" onClick={() => onChange(null)}
              style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'transparent', border: 0, borderRadius: 5, color: 'var(--mute)' }}>
              <IconWinClose size={10} sw={1.4} />
            </button></>}
        </span>
      </div>
      <div className="paste-box"
        onMouseDown={(ev) => {
          // 編輯中的文字框自己處理滑鼠；點到捲軸以外的地方都把焦點交給接收貼上的文字框
          if ((ev.target as HTMLElement).closest('.pb-edit')) return;
          if (ev.button !== 0) return;
          if (ev.target !== ev.currentTarget || ev.nativeEvent.offsetX < ev.currentTarget.clientWidth) {
            ev.preventDefault();
            commit();
            input.current?.focus();
          }
        }}
        style={{
          position: 'relative', flexGrow: 1, minHeight: 0, overflow: 'auto', boxSizing: 'border-box', padding: rows ? '6px 0' : 0,
          background: 'var(--bg0)', border: `1px ${rows ? 'solid' : 'dashed'} var(--line4)`, borderRadius: 8, cursor: 'text',
        }}>
        <textarea ref={input} aria-label={label} value="" onChange={() => {}} onPaste={handlePaste} spellCheck={false}
          style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1, padding: 0, border: 0, opacity: 0, resize: 'none', pointerEvents: 'none' }} />
        {rows ? rows.map((r, i) => (
          <div key={i} className="pb-row" data-editing={editing?.i === i ? '1' : undefined}
            onDoubleClick={() => setEditing({ i, text: r })}
            onContextMenu={(ev) => { ev.preventDefault(); commit(); setMenu({ i, x: ev.clientX, y: ev.clientY }); }}
            style={{ display: 'flex', gap: 8, padding: '2px 10px', fontSize: 12.5, lineHeight: 1.5 }}>
            <span className="mono" style={{ width: 28, flexShrink: 0, textAlign: 'right', fontSize: 10.5, color: 'var(--mute3)', lineHeight: '19px' }}>{i + 1}</span>
            {editing?.i === i ? (
              <textarea className="pb-edit" autoFocus value={editing.text} spellCheck={false}
                rows={Math.max(1, editing.text.split('\n').length)}
                onFocus={(ev) => ev.currentTarget.select()}
                onChange={(ev) => setEditing({ i, text: ev.target.value })}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); commit(); input.current?.focus(); }
                  if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); setEditing(null); input.current?.focus(); }
                }}
                onBlur={commit}
                style={{
                  flexGrow: 1, minWidth: 0, margin: '-2px 0', padding: '1px 6px', resize: 'none', boxSizing: 'border-box',
                  background: 'var(--panel)', border: '1px solid var(--accent)', borderRadius: 4, color: 'var(--text)', fontSize: 12.5, lineHeight: 1.5,
                }} />
            ) : (
              <span style={{ minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', color: r ? 'var(--text)' : 'var(--mute3)' }}>
                {r ? r.replace(/\n/g, ' ↵ ') : '—'}
              </span>
            )}
          </div>
        )) : (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mute3)', fontSize: 12.5, userSelect: 'none' }}>
            Ctrl+V
          </div>
        )}
      </div>

      {menu && (
        <>
          <div onMouseDown={() => setMenu(null)} onContextMenu={(ev) => { ev.preventDefault(); setMenu(null); }}
            style={{ position: 'fixed', inset: 0, zIndex: 60 }} />
          <div role="menu" aria-label={label + '第 ' + (menu.i + 1) + ' 行'} className="pop"
            onKeyDown={(ev) => { if (ev.key === 'Escape') setMenu(null); }}
            style={{ position: 'fixed', left: Math.min(menu.x, window.innerWidth - 150), top: Math.min(menu.y, window.innerHeight - 160), zIndex: 61, width: 128 }}>
            {([['edit', '編輯'], ['clear', '清空'], ['delete', '刪除'], ['insert', '插入']] as const).map(([k, t], j) => (
              <button key={k} type="button" role="menuitem" className="dd pop-item" autoFocus={j === 0}
                onClick={() => act(k, menu.i)}
                style={{ background: 'transparent', color: k === 'delete' ? 'var(--errtx)' : undefined }}>{t}</button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
