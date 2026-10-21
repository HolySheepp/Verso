import { useState } from 'react';
import { tx } from '../i18n';
export interface MenuItem {
  key: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  /** 有值時左邊顯示勾勾（true 打勾、false 留空），用在切換顯示的項目 */
  checked?: boolean;
  /** 項目右邊的數字與上下箭頭（例如插入幾列） */
  stepper?: { value: number; min: number; max: number; onChange(v: number): void };
  /** 子選單：滑鼠移上去（或按 → ）在右邊展開，選了照樣走 onPick(子項目的 key) */
  sub?: MenuItem[];
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
  const [open, setOpen] = useState<{ key: string; x: number; y: number; kb?: boolean } | null>(null);
  // 用鍵盤打開時焦點移進子選單；滑鼠移上去時不搶焦點
  const openSub = (key: string, el: HTMLElement, kb = false) => { const r = el.getBoundingClientRect(); setOpen({ key, x: r.right + 2, y: r.top - 6, kb }); };
  const sub = open ? items.find((it) => it.key === open.key)?.sub : undefined;
  return (
    <>
      <div onMouseDown={onClose} onContextMenu={(ev) => { ev.preventDefault(); onClose(); }}
        style={{ position: 'fixed', inset: 0, zIndex: 60 }} />
      <div role="menu" aria-label={label} className="pop"
        onKeyDown={(ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); onClose(); } }}
        style={{ position: 'fixed', left: Math.min(x, window.innerWidth - 150), top: Math.min(y, window.innerHeight - (items.length * 32 + 20)), zIndex: 61, width: items.some((it) => it.stepper) ? 156 : 128 }}>
        {items.map((it, j) => {
          const btn = (
            <button key={it.key} type="button" role={it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'} aria-checked={it.checked} className="dd pop-item" autoFocus={j === 0} disabled={it.disabled}
              onClick={(ev) => (it.sub ? openSub(it.key, ev.currentTarget) : onPick(it.key))}
              onMouseEnter={(ev) => (it.sub ? openSub(it.key, ev.currentTarget) : setOpen(null))}
              aria-haspopup={it.sub ? 'menu' : undefined} aria-expanded={it.sub ? open?.key === it.key : undefined}
              onKeyDown={it.sub ? (ev) => { if (ev.key === 'ArrowRight' || ev.key === 'Enter') { ev.preventDefault(); openSub(it.key, ev.currentTarget, true); } } : it.stepper ? (ev) => {
                const st = it.stepper!;
                if (ev.key === 'ArrowRight' || ev.key === '+') { ev.preventDefault(); st.onChange(Math.min(st.max, st.value + 1)); }
                if (ev.key === 'ArrowLeft' || ev.key === '-') { ev.preventDefault(); st.onChange(Math.max(st.min, st.value - 1)); }
              } : undefined}
              style={{
                background: 'transparent', color: it.disabled ? 'var(--dis)' : it.danger ? 'var(--errtx)' : undefined,
                cursor: it.disabled ? 'default' : undefined, flexGrow: 1, minWidth: 0,
                ...(it.sub ? { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } : {}),
              }}>{it.checked !== undefined && <span aria-hidden="true" style={{ display: 'inline-block', width: 18 }}>{it.checked ? '✓' : ''}</span>}{it.sub ? <><span>{it.label}</span><span aria-hidden="true" style={{ color: 'var(--mute)' }}>›</span></> : it.label}</button>
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
      {open && sub && (
        <div role="menu" aria-label={items.find((it) => it.key === open.key)?.label} className="pop"
          onKeyDown={(ev) => { if (ev.key === 'Escape' || ev.key === 'ArrowLeft') { ev.stopPropagation(); setOpen(null); } }}
          style={{ position: 'fixed', left: Math.min(open.x, window.innerWidth - 140), top: Math.min(open.y, window.innerHeight - (sub.length * 32 + 20)), zIndex: 62, width: 128 }}>
          {sub.map((it, j) => (
            <button key={it.key} type="button" role={it.checked !== undefined ? 'menuitemradio' : 'menuitem'} aria-checked={it.checked} className="dd pop-item" autoFocus={j === 0 && open.kb} disabled={it.disabled}
              onClick={() => onPick(it.key)} style={{ background: 'transparent', width: '100%' }}>
              {it.checked !== undefined && <span aria-hidden="true" style={{ display: 'inline-block', width: 18 }}>{it.checked ? '✓' : ''}</span>}{it.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
