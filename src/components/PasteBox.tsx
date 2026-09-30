import { useRef } from 'react';
import { readColumn } from '../model/clipboard';
import { usedLength } from '../model/paste';
import { IconWinClose } from './icons';

interface Props {
  label: string;
  rows: string[] | null;
  onRows(rows: string[] | null): void;
}

/** 貼入一整欄的方框：點一下再按 Ctrl+V，優先讀剪貼簿裡的表格格式 */
export function PasteBox({ label, rows: raw, onRows }: Props) {
  // 結尾的空白行不顯示、不計入行數
  const rows = raw && raw.slice(0, usedLength(raw));
  // 用一個看不見的文字框接收貼上，這樣不管點在方框哪裡、按 Ctrl+V 都一定會觸發貼上
  const input = useRef<HTMLTextAreaElement>(null);

  const onPaste = (ev: React.ClipboardEvent) => {
    ev.preventDefault();
    const html = ev.clipboardData.getData('text/html');
    const text = ev.clipboardData.getData('text/plain');
    const col = readColumn({ html, text });
    onRows(col.length ? col : null);
  };

  return (
    <div style={{ minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ height: 22, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, color: 'var(--text2)' }}>{label}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--mute)' }}>
          {rows && <>{rows.length} 行
            <button type="button" className="ib" aria-label={'清除' + label} title="清除" onClick={() => onRows(null)}
              style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'transparent', border: 0, borderRadius: 5, color: 'var(--mute)' }}>
              <IconWinClose size={10} sw={1.4} />
            </button></>}
        </span>
      </div>
      <div className="paste-box"
        onMouseDown={(ev) => {
          // 點到捲軸以外的地方都把焦點交給接收貼上的文字框
          if (ev.target !== ev.currentTarget || ev.nativeEvent.offsetX < ev.currentTarget.clientWidth) {
            ev.preventDefault();
            input.current?.focus();
          }
        }}
        style={{
          position: 'relative', flexGrow: 1, minHeight: 0, overflow: 'auto', boxSizing: 'border-box', padding: rows ? '6px 0' : 0,
          background: 'var(--bg0)', border: `1px ${rows ? 'solid' : 'dashed'} var(--line4)`, borderRadius: 8, cursor: 'text',
        }}>
        <textarea ref={input} aria-label={label} value="" onChange={() => {}} onPaste={onPaste} spellCheck={false}
          style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1, padding: 0, border: 0, opacity: 0, resize: 'none', pointerEvents: 'none' }} />
        {rows ? rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, padding: '2px 10px', fontSize: 12.5, lineHeight: 1.5 }}>
            <span className="mono" style={{ width: 28, flexShrink: 0, textAlign: 'right', fontSize: 10.5, color: 'var(--mute3)', lineHeight: '19px' }}>{i + 1}</span>
            <span style={{ minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', color: r ? 'var(--text)' : 'var(--mute3)' }}>
              {r ? r.replace(/\n/g, ' ↵ ') : '—'}
            </span>
          </div>
        )) : (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mute3)', fontSize: 12.5, userSelect: 'none' }}>
            Ctrl+V
          </div>
        )}
      </div>
    </div>
  );
}
