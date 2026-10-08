import { tx } from '../i18n';
import { useState } from 'react';
import { fz } from '../model/fonts';
import { focusOnMount } from './windowDrag';

interface Props {
  initial: string;
  /** 回傳錯誤訊息；沒問題回傳空字串 */
  validate(name: string): string;
  /** 結束改名：name 是新名稱，null 是取消 */
  onDone(name: string | null): void;
  style?: React.CSSProperties;
  label?: string;
}

/**
 * 改名用的輸入框：名稱不合規則時按 Enter 不會送出，下面顯示原因；
 * 按 Esc 或點別處（名稱不合規則時）就取消，維持原名。
 */
export function RenameInput({ initial, validate, onDone, style, label = tx('rename.001') }: Props) {
  const [v, setV] = useState(initial);
  const err = v.trim() === initial.trim() ? '' : validate(v);
  const finish = (submit: boolean) => {
    if (!submit || err || v.trim() === initial.trim()) { onDone(null); return; }
    onDone(v.trim());
  };
  return (
    <span style={{ position: 'relative', display: 'inline-flex', flexGrow: style?.flexGrow, minWidth: 0 }}>
      <input ref={focusOnMount} className="field" aria-label={label} aria-invalid={!!err} value={v}
        onPointerDown={(ev) => ev.stopPropagation()} onClick={(ev) => ev.stopPropagation()}
        onChange={(ev) => setV(ev.target.value)}
        onKeyDown={(ev) => {
          ev.stopPropagation();
          if (ev.key === 'Enter') { ev.preventDefault(); if (!err) finish(true); }
          if (ev.key === 'Escape') finish(false);
        }}
        onBlur={() => finish(true)}
        style={{ ...style, borderColor: err ? 'var(--errtx)' : undefined }} />
      {err && (
        <span role="alert" style={{
          position: 'absolute', left: 0, top: '100%', marginTop: 4, zIndex: 40, whiteSpace: 'nowrap', padding: '4px 8px',
          background: 'var(--pop)', border: '1px solid var(--line4)', borderRadius: 6, color: 'var(--errtx)', fontSize: fz(12), boxShadow: '0 6px 18px rgba(0,0,0,0.3)',
        }}>{err}</span>
      )}
    </span>
  );
}
