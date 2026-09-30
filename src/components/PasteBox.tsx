import { readColumn } from '../model/clipboard';
import { IconWinClose } from './icons';

interface Props {
  label: string;
  rows: string[] | null;
  onRows(rows: string[] | null): void;
}

/** 貼入一整欄的方框：點一下再按 Ctrl+V，優先讀剪貼簿裡的表格格式 */
export function PasteBox({ label, rows, onRows }: Props) {
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
      {/* 可編輯區只用來接收貼上，打字會被擋下 */}
      <div role="textbox" aria-label={label} tabIndex={0} contentEditable suppressContentEditableWarning spellCheck={false}
        onPaste={onPaste}
        onBeforeInput={(ev) => ev.preventDefault()}
        onDrop={(ev) => ev.preventDefault()}
        onKeyDown={(ev) => {
          if (ev.key === 'Backspace' || ev.key === 'Delete' || ev.key === 'Enter') ev.preventDefault();
        }}
        className="paste-box"
        style={{
          flexGrow: 1, minHeight: 0, overflow: 'auto', boxSizing: 'border-box', padding: rows ? '6px 0' : 0,
          background: 'var(--bg0)', border: `1px ${rows ? 'solid' : 'dashed'} var(--line4)`, borderRadius: 8,
          caretColor: 'transparent', cursor: 'text',
        }}>
        {rows ? rows.map((r, i) => (
          <div key={i} contentEditable={false} style={{ display: 'flex', gap: 8, padding: '2px 10px', fontSize: 12.5, lineHeight: 1.5 }}>
            <span className="mono" style={{ width: 28, flexShrink: 0, textAlign: 'right', fontSize: 10.5, color: 'var(--mute3)', lineHeight: '19px' }}>{i + 1}</span>
            <span style={{ minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', color: r ? 'var(--text)' : 'var(--mute3)' }}>
              {r ? r.replace(/\n/g, ' ↵ ') : '—'}
            </span>
          </div>
        )) : (
          <div contentEditable={false} style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mute3)', fontSize: 12.5, userSelect: 'none' }}>
            Ctrl+V
          </div>
        )}
      </div>
    </div>
  );
}
