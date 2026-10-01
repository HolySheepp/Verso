import { useEffect, useRef, useState } from 'react';
import { fontStack, fz, listFonts } from '../model/fonts';
import { IconChevD, IconSearch } from './icons';

interface Props {
  value: string;
  recent: string[];
  onChange(family: string): void;
  label: string;
  disabled?: boolean;
}

/** 字形選單：可搜尋，最上面是近期用過的字形，每個名稱用該字形顯示 */
export function FontSelect({ value, recent, onChange, label, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [fonts, setFonts] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 260 });

  useEffect(() => { void listFonts().then(setFonts); }, []);

  const toggle = () => {
    if (!open && btn.current) {
      // 選單用 fixed 定位，避免被設定視窗的捲動區域裁掉
      const r = btn.current.getBoundingClientRect();
      const height = 320;
      const top = r.bottom + 4 + height > window.innerHeight ? r.top - 4 - height : r.bottom + 4;
      setPos({ left: r.left, top, width: Math.max(260, r.width) });
      setQ('');
    }
    setOpen(!open);
  };
  const pick = (f: string) => { onChange(f); setOpen(false); };

  const ql = q.trim().toLowerCase();
  const match = (f: string) => !ql || f.toLowerCase().includes(ql);
  const recentShown = recent.filter(match);
  const all = fonts.filter(match);

  const item = (f: string, key: string) => (
    <button key={key} type="button" className="dd pop-item" role="option" aria-selected={f === value} onClick={() => pick(f)}
      style={{ background: f === value ? 'var(--sel)' : 'transparent', fontFamily: fontStack(f), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>
      {f || '預設'}
    </button>
  );
  const head = (t: string) => <div className="pop-title" style={{ padding: '8px 10px 4px' }}>{t}</div>;

  return (
    <>
      <button ref={btn} type="button" className="fs" aria-haspopup="listbox" aria-expanded={open} aria-label={label + '字形'} onClick={toggle} disabled={disabled}
        style={{
          flexGrow: 1, minWidth: 0, height: 34, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px',
          background: 'var(--bg0)', border: '1px solid var(--line4)', borderRadius: 8, textAlign: 'left', opacity: disabled ? 0.5 : 1,
        }}>
        <span style={{ flexGrow: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontFamily: fontStack(value), fontSize: fz(13) }}>{value || '預設'}</span>
        <IconChevD size={13} stroke="var(--mute)" />
      </button>
      {open && (
        <>
          <div onMouseDown={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 60 }} />
          <div role="listbox" aria-label={label + '字形'} className="pop"
            style={{ position: 'fixed', left: pos.left, top: pos.top, width: pos.width, height: 320, zIndex: 61, display: 'flex', flexDirection: 'column' }}>
            <div style={{ position: 'relative', padding: 4 }}>
              <IconSearch size={13} stroke="var(--mute)" style={{ position: 'absolute', left: 14, top: 14, pointerEvents: 'none' }} />
              <input autoFocus className="field" aria-label="搜尋字形" value={q} onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } }}
                style={{ width: '100%', height: 32, padding: '0 10px 0 30px' }} />
            </div>
            <div style={{ flexGrow: 1, minHeight: 0, overflowY: 'auto' }}>
              {recentShown.length > 0 && <>{head('近期')}{recentShown.map((f) => item(f, 'r:' + f))}</>}
              {head('全部')}
              {match('預設') && item('', 'default')}
              {all.map((f) => item(f, 'a:' + f))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
