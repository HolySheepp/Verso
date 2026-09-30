export interface MenuItem {
  key: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
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
        style={{ position: 'fixed', left: Math.min(x, window.innerWidth - 150), top: Math.min(y, window.innerHeight - (items.length * 32 + 20)), zIndex: 61, width: 128 }}>
        {items.map((it, j) => (
          <button key={it.key} type="button" role="menuitem" className="dd pop-item" autoFocus={j === 0} disabled={it.disabled}
            onClick={() => onPick(it.key)}
            style={{
              background: 'transparent', color: it.disabled ? 'var(--dis)' : it.danger ? 'var(--errtx)' : undefined,
              cursor: it.disabled ? 'default' : undefined,
            }}>{it.label}</button>
        ))}
      </div>
    </>
  );
}
