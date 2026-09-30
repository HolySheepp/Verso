import { useEffect, useRef, useState } from 'react';
import { hexToHsv, hsvToHex, normalizeHex, type Hsv } from '../model/color';

interface Props {
  initial: string;
  /** 拖動時即時預覽 */
  onPreview(hex: string): void;
  onSave(hex: string): void;
  onCancel(): void;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * 自訂主題色的色盤：飽和度／明度色板、色相條、hex 輸入。
 * 打開時設定視窗會先收起來，讓使用者直接在主畫面上看顏色效果。
 */
export function ColorPicker({ initial, onPreview, onSave, onCancel }: Props) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(initial) ?? { h: 217, s: 0.7, v: 1 });
  const [hexText, setHexText] = useState(hsvToHex(hsv));
  const hex = hsvToHex(hsv);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  // 開啟時不改顏色，等使用者真的調整才預覽
  const previewRef = useRef(onPreview);
  previewRef.current = onPreview;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    previewRef.current(hex);
    setHexText(hex);
  }, [hex]);

  /** 拖動：按下後在整個視窗追蹤滑鼠，拖出範圍也能繼續 */
  const track = (fn: (x: number, y: number) => void) => (ev: React.PointerEvent) => {
    ev.preventDefault();
    fn(ev.clientX, ev.clientY);
    const move = (e: PointerEvent) => fn(e.clientX, e.clientY);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const onSv = track((x, y) => {
    const r = svRef.current!.getBoundingClientRect();
    setHsv((c) => ({ ...c, s: clamp01((x - r.left) / r.width), v: 1 - clamp01((y - r.top) / r.height) }));
  });
  const onHue = track((x) => {
    const r = hueRef.current!.getBoundingClientRect();
    setHsv((c) => ({ ...c, h: clamp01((x - r.left) / r.width) * 359.9 }));
  });
  // 面板本身可以用標題列拖動位置
  const onMove = (ev: React.PointerEvent) => {
    const panel = (ev.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
    const dx = ev.clientX - panel.left, dy = ev.clientY - panel.top;
    track((x, y) => setPos({ x: x - dx, y: y - dy }))(ev);
  };

  const commitHex = () => {
    const n = normalizeHex(hexText);
    if (n) setHsv(hexToHsv(n)!);
    else setHexText(hex);
  };

  return (
    <div role="dialog" aria-label="自訂主題色" className="dialog"
      style={{
        position: 'absolute', zIndex: 70, width: 260, boxShadow: '0 20px 56px rgba(0,0,0,0.45)',
        ...(pos ? { left: pos.x, top: pos.y } : { right: 32, top: 72 }),
      }}>
      <div onPointerDown={onMove} style={{ height: 36, display: 'flex', alignItems: 'center', padding: '0 14px', fontSize: 13, fontWeight: 600, cursor: 'move', borderBottom: '1px solid var(--line)', userSelect: 'none' }}>
        自訂主題色
      </div>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div ref={svRef} onPointerDown={onSv} style={{
          position: 'relative', height: 150, borderRadius: 8, cursor: 'crosshair', touchAction: 'none',
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hsvToHex({ h: hsv.h, s: 1, v: 1 })})`,
        }}>
          <span style={{
            position: 'absolute', left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, width: 12, height: 12, marginLeft: -6, marginTop: -6,
            borderRadius: '50%', border: '2px solid #fff', boxShadow: '0 0 0 1px rgba(0,0,0,0.4)', pointerEvents: 'none',
          }} />
        </div>
        <div ref={hueRef} onPointerDown={onHue} style={{
          position: 'relative', height: 12, borderRadius: 6, cursor: 'ew-resize', touchAction: 'none',
          background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
        }}>
          <span style={{
            position: 'absolute', left: `${(hsv.h / 360) * 100}%`, top: -2, width: 8, height: 16, marginLeft: -4, borderRadius: 3,
            background: '#fff', boxShadow: '0 0 0 1px rgba(0,0,0,0.4)', pointerEvents: 'none',
          }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 28, height: 28, flexShrink: 0, borderRadius: 6, background: hex, border: '1px solid var(--line4)' }} />
          <input className="field mono" aria-label="色碼" value={hexText} spellCheck={false}
            onChange={(e) => setHexText(e.target.value)} onBlur={commitHex}
            onKeyDown={(e) => { if (e.key === 'Enter') commitHex(); }}
            style={{ flexGrow: 1, minWidth: 0, height: 30, fontSize: 12.5 }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={onCancel}
            style={{ height: 32, padding: '0 14px', background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, fontSize: 13 }}>取消</button>
          <button type="button" className="btn btn-primary" onClick={() => onSave(hex)}
            style={{ height: 32, padding: '0 16px', background: 'var(--primary)', border: 0, borderRadius: 8, color: '#ffffff', fontSize: 13, fontWeight: 600 }}>儲存</button>
        </div>
      </div>
    </div>
  );
}
