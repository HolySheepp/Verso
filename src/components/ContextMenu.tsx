import { tx } from '../i18n';
export interface MenuItem {
  key: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  /** 項目右邊的數字與上下箭頭（例如插入幾列） */
  stepper?: { value: number; min: number; max: number; onChange(v: number): void };
}

interface Props {
  x: number;
  y: number;
  label: string;
  items: MenuItem[];
  onPick(key: string): void;
  onClose(): void;
}

/** 右鍵選單：出現在滑鼠位置，點選單外面或按 Esc 關閉 */
export function ContextMenu({ x, y, label, items, onPick, onClose }: Props) {
  return (
    <>
      <div onMouseDown={onClose} onContextMenu={(ev) => { ev.preventDefault(); onClose(); }}
        style={{ position: 'fixed', inset: 0, zIndex: 60 }} />
      <div role="menu" aria-label={label} className="pop"
        onKeyDown={(ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); onClose(); } }}
        style={{ position: 'fixed', left: Math.min(x, window.innerWidth - 150), top: Math.min(y, window.innerHeight - (items.length * 32 + 20)), zIndex: 61, width: items.some((it) => it.stepper) ? 156 : 128 }}>
        {items.map((it, j) => {
          const btn = (
            <button key={it.key} type="button" role="menuitem" className="dd pop-item" autoFocus={j === 0} disabled={it.disabled}
              onClick={() => onPick(it.key)}
              onKeyDown={it.stepper ? (ev) => {
                const st = it.stepper!;
                if (ev.key === 'ArrowRight' || ev.key === '+') { ev.preventDefault(); st.onChange(Math.min(st.max, st.value + 1)); }
                if (ev.key === 'ArrowLeft' || ev.key === '-') { ev.preventDefault(); st.onChange(Math.max(st.min, st.value - 1)); }
              } : undefined}
              style={{
                background: 'transparent', color: it.disabled ? 'var(--dis)' : it.danger ? 'var(--errtx)' : undefined,
                cursor: it.disabled ? 'default' : undefined, flexGrow: 1, minWidth: 0,
              }}>{it.label}</button>
          );
          if (!it.stepper) return btn;
          const st = it.stepper;
          const arrow: React.CSSProperties = { width: 18, height: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'transparent', border: 0, borderRadius: 3, color: 'var(--text2)', fontSize: 8, lineHeight: 1 };
          return (
            <div key={it.key} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              {btn}
              <span style={{ minWidth: 18, textAlign: 'right', fontSize: 12, color: 'var(--text)' }}>{st.value}</span>
              <span style={{ display: 'flex', flexDirection: 'column', paddingRight: 4 }}>
                <button type="button" className="ib" aria-label={tx('menu.001')} tabIndex={-1} disabled={st.value >= st.max} onClick={() => st.onChange(Math.min(st.max, st.value + 1))} style={arrow}>▲</button>
                <button type="button" className="ib" aria-label={tx('menu.002')} tabIndex={-1} disabled={st.value <= st.min} onClick={() => st.onChange(Math.max(st.min, st.value - 1))} style={arrow}>▼</button>
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}
