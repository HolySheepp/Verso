import { useRef, useState } from 'react';
import { currentOf, useStore } from '../state/store';
import { CELL_PADDING, CJK_FAMILY, CJK_SIZE, sameStd, stdLabel, type LengthStd, type StdValue } from '../model/length';
import { measure, textWidth } from '../model/measure';
import { MAX_PT, MIN_PT, fontStack, fz, ptToPx, pushRecent } from '../model/fonts';
import { FontSelect } from './FontSelect';
import { Select } from './Select';
import { dragWindow } from './windowDrag';
import { IconWinClose } from './icons';

type Way = 'params' | 'cjk' | 'visual';
const WAYS: { id: Way; label: string }[] = [
  { id: 'params', label: '既有參數' },
  { id: 'cjk', label: '中文上限' },
  { id: 'visual', label: '視覺' },
];

const DEFAULT_STD: LengthStd = { family: 'Times New Roman', size: 12, width: 550, lines: 2 };
const DIGITS = '一二三四五六七八九十';
/** 視覺方式的示範文字：一二三…十一二…到指定字數 */
const sample = (n: number) => Array.from({ length: n }, (_, i) => DIGITS[i % 10]).join('');

const label: React.CSSProperties = { fontSize: fz(12), color: 'var(--text2)' };
const num: React.CSSProperties = { width: 90, height: 34 };
const ghost: React.CSSProperties = { height: 36, padding: '0 14px', background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, fontSize: fz(13) };

function NumField({ id, value, onChange, min = 1 }: { id: string; value: number; onChange(v: number): void; min?: number }) {
  return (
    <input id={id} type="number" className="field" min={min} value={Number.isFinite(value) ? value : ''} style={num}
      onChange={(e) => onChange(Math.max(min, Math.round(Number(e.target.value) || min)))} />
  );
}

/** 長度標準設定視窗：設定檔案的標準，或只設定目前這一條 */
export function LengthDialog() {
  const target = useStore((s) => s.lengthDialog);
  return target ? <LengthForm target={target} /> : null;
}

function LengthForm({ target }: { target: 'file' | 'entry' }) {
  const s = useStore.getState();
  const { fileDoc, entry } = currentOf(s);
  const fileStd = fileDoc.lengthStd;
  const entryStd = entry?.lengthStd;
  const current: StdValue | undefined = target === 'entry' ? entryStd ?? fileStd : fileStd;
  // 打開時預填目前的值
  const init = current && current !== 'none' ? current : DEFAULT_STD;
  const presets = useStore((st) => st.lengthPresets);
  const recent = useStore((st) => st.recentFonts);
  const [way, setWay] = useState<Way>('params');
  const [family, setFamily] = useState(init.family);
  const [size, setSize] = useState(init.size);
  const [width, setWidth] = useState(init.width);
  const [lines, setLines] = useState(init.lines);
  // 中文上限：每行最多幾個字、幾行
  const [cjkChars, setCjkChars] = useState(20);
  const [cjkLines, setCjkLines] = useState(init.lines);
  // 視覺：示範字數與拖出來的欄寬
  const [visCount, setVisCount] = useState(30);
  const [visWidth, setVisWidth] = useState(init.width);
  const [presetName, setPresetName] = useState('');
  const close = () => s.set({ lengthDialog: null });

  // 中文上限：微軟正黑體 12pt 的 N 個字寬，加上儲存格兩側內距
  const cjkWidth = Math.ceil(textWidth(sample(cjkChars), CJK_FAMILY, CJK_SIZE) + CELL_PADDING * 2);
  const visStd: LengthStd = { family: CJK_FAMILY, size: CJK_SIZE, width: visWidth, lines: 999 };
  const visLines = measure(sample(visCount), visStd)?.lines ?? 1;

  const std: LengthStd = way === 'params' ? { family, size, width, lines }
    : way === 'cjk' ? { family, size, width: cjkWidth, lines: cjkLines }
    : { family, size, width: visWidth, lines: Math.max(1, visLines) };
  const valid = std.width > CELL_PADDING * 2 && std.lines >= 1 && std.size > 0;

  const apply = (v: StdValue | undefined) => {
    if (target === 'file') s.setFileStd(v);
    else s.setEntryStd(v);
  };
  const savePreset = () => {
    const name = presetName.trim();
    if (!name || !valid) return;
    s.set({ lengthPresets: [...presets.filter((p) => p.name !== name), { name, std }] });
    setPresetName('');
  };
  const usePreset = (name: string) => {
    const p = presets.find((x) => x.name === name);
    if (!p) return;
    setWay('params'); setFamily(p.std.family); setSize(p.std.size); setWidth(p.std.width); setLines(p.std.lines);
  };
  const sizes = Array.from({ length: MAX_PT - MIN_PT + 1 }, (_, i) => MIN_PT + i);

  // 視覺方式：拖格子右邊框調欄寬
  const drag = useRef<{ x: number; w: number } | null>(null);
  const onEdgeDown = (ev: React.MouseEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    drag.current = { x: ev.clientX, w: visWidth };
    const move = (e: MouseEvent) => { if (drag.current) setVisWidth(Math.max(40, Math.round(drag.current.w + e.clientX - drag.current.x))); };
    const up = () => { drag.current = null; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); document.body.style.cursor = ''; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    document.body.style.cursor = 'col-resize';
  };

  const fontRow = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ ...label, width: 64, flexShrink: 0 }}>譯文字型</span>
      <FontSelect value={family} recent={recent} label="譯文" onChange={(f) => { setFamily(f); s.set({ recentFonts: pushRecent(recent, f) }); }} />
      <Select ariaLabel="譯文字級" value={String(size)} onChange={(v) => setSize(Number(v))}
        options={sizes.map((n) => ({ value: String(n), label: n + ' pt' }))} style={{ width: 84, height: 34, flexShrink: 0 }} />
    </div>
  );

  return (
    <div className="scrim" style={{ zIndex: 50 }} onMouseDown={dragWindow}>
      <div role="dialog" aria-modal="true" aria-labelledby="verso-len-title" className="dialog"
        style={{ width: 640, maxWidth: 'calc(100% - 48px)', maxHeight: 'calc(100% - 48px)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>
        <div style={{ height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px 0 20px', borderBottom: '1px solid var(--line)' }}>
          <h2 id="verso-len-title" style={{ margin: 0, fontSize: fz(15), fontWeight: 600 }}>{target === 'file' ? '檔案的長度標準' : '這一條的特殊標準'}</h2>
          <button type="button" className="ib" aria-label="關閉" onClick={close}
            style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 0, borderRadius: 8, color: 'var(--text2)' }}>
            <IconWinClose size={13} sw={1.4} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '16px 20px', overflowY: 'auto' }}>
          <div style={{ fontSize: fz(12.5), color: 'var(--mute)' }}>
            目前：{stdLabel(current)}{target === 'entry' && entryStd === undefined && fileStd !== undefined ? '（檔案標準）' : ''}
          </div>

          {presets.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ ...label, width: 64, flexShrink: 0 }}>常用標準</span>
              <Select ariaLabel="套用常用標準" value={presets.find((p) => sameStd(p.std, std))?.name ?? ''} onChange={usePreset}
                options={[{ value: '', label: '選擇常用標準…' }, ...presets.map((p) => ({ value: p.name, label: p.name }))]} style={{ width: 240, height: 34 }} />
            </div>
          )}

          <div role="radiogroup" aria-label="設定方式" style={{ display: 'flex', gap: 2, padding: 3, alignSelf: 'flex-start', background: 'var(--bg0)', border: '1px solid var(--line)', borderRadius: 9 }}>
            {WAYS.map((w) => (
              <button key={w.id} type="button" role="radio" aria-checked={way === w.id} className="seg" onClick={() => setWay(w.id)}
                style={{ height: 28, padding: '0 14px', border: 0, borderRadius: 6, fontSize: fz(12.5), background: way === w.id ? 'var(--segon)' : 'transparent', color: way === w.id ? 'var(--text)' : 'var(--text2)' }}>
                {w.label}
              </button>
            ))}
          </div>

          {way === 'params' && <>
            {fontRow}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label htmlFor="verso-len-w" style={{ ...label, width: 64 }}>欄寬</label>
              <NumField id="verso-len-w" value={width} onChange={setWidth} /><span style={label}>px</span>
              <label htmlFor="verso-len-l" style={{ ...label, marginLeft: 16 }}>行數</label>
              <NumField id="verso-len-l" value={lines} onChange={setLines} />
            </div>
          </>}

          {way === 'cjk' && <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label htmlFor="verso-len-c" style={{ ...label, width: 64 }}>每行最多</label>
              <NumField id="verso-len-c" value={cjkChars} onChange={setCjkChars} /><span style={label}>字</span>
              <label htmlFor="verso-len-cl" style={{ ...label, marginLeft: 16 }}>行數</label>
              <NumField id="verso-len-cl" value={cjkLines} onChange={setCjkLines} />
            </div>
            <div style={{ fontSize: fz(12.5), color: 'var(--mute)' }}>以微軟正黑體 12pt 換算，欄寬 {cjkWidth}px</div>
            {fontRow}
          </>}

          {way === 'visual' && <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label htmlFor="verso-len-v" style={{ ...label, width: 64 }}>示範字數</label>
              <NumField id="verso-len-v" value={visCount} onChange={setVisCount} />
              <span style={{ ...label, marginLeft: 16 }}>欄寬 {visWidth}px・{visLines} 行</span>
            </div>
            <div data-nodrag style={{ overflowX: 'auto', paddingBottom: 4 }}>
              <div style={{
                position: 'relative', width: visWidth, boxSizing: 'border-box', padding: `2px ${CELL_PADDING}px`,
                background: '#ffffff', color: '#000000', border: '1px solid var(--line6)',
                fontFamily: fontStack(CJK_FAMILY), fontSize: ptToPx(CJK_SIZE), lineHeight: 'normal', whiteSpace: 'pre-wrap', overflowWrap: 'break-word',
              }}>
                {sample(visCount)}
                <span role="separator" aria-label="拖動調整欄寬" onMouseDown={onEdgeDown}
                  style={{ position: 'absolute', top: 0, right: -5, bottom: 0, width: 10, cursor: 'col-resize', background: 'linear-gradient(to right, transparent 4px, var(--accent) 4px, var(--accent) 6px, transparent 6px)' }} />
              </div>
            </div>
            {fontRow}
          </>}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input className="field" value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="常用標準名稱" aria-label="常用標準名稱" style={{ width: 200, height: 34 }} />
            <button type="button" className="btn btn-ghost" disabled={!presetName.trim() || !valid} onClick={savePreset} style={{ ...ghost, height: 34, opacity: presetName.trim() && valid ? 1 : 0.5 }}>存成常用標準</button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '12px 20px 16px', borderTop: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={() => apply('none')} style={ghost}>無上限</button>
            {target === 'entry' && (
              <button type="button" className="btn btn-ghost" disabled={entryStd === undefined} onClick={() => apply(undefined)}
                style={{ ...ghost, opacity: entryStd === undefined ? 0.5 : 1 }}>改回檔案標準</button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={close} style={ghost}>取消</button>
            <button type="button" className="btn btn-primary" disabled={!valid} onClick={() => apply(std)}
              style={{ height: 36, padding: '0 18px', background: 'var(--primary)', border: 0, borderRadius: 8, color: '#ffffff', fontSize: fz(13), fontWeight: 600 }}>套用</button>
          </div>
        </div>
      </div>
    </div>
  );
}
