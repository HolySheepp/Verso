// 快速搜尋（開發者選項）：按快捷鍵（預設 Alt+S）在滑鼠位置叫出圓環選單，點一格就用預設瀏覽器 Google 搜尋。
// 框選的文字自動帶入 {選取}；還有必填沒內容就跳「完成內容」視窗。圓環中間的「編輯」打開管理搜尋庫視窗。
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { tx } from '../i18n';
import { fz } from '../model/fonts';
import { comboOf } from '../model/shortcuts';
import { QS_MAX, composeQuery, hasContent, labelOf, minSlots, prefills, ready, resize, type QsItem, type QsPart, type QuickSearch } from '../model/quickSearch';
import { useStore } from '../state/store';

type Chip = Exclude<QsPart, { t: 'text' }>;
const chipText = (p: Chip) => `{${p.t === 'sel' ? tx('qs.chipSel') : tx('qs.chipFill')}${p.req ? '*' : ''}}`;

/** 用預設瀏覽器打開 Google 搜尋 */
function openSearch(q: string) {
  if (!q.trim()) return;
  if (isTauri()) void invoke('open_search', { q });
  else window.open('https://www.google.com/search?q=' + encodeURIComponent(q), '_blank');
}

/** 按快捷鍵當下框選的文字（輸入框裡的、或畫面上的） */
function selectedText(): string {
  const a = document.activeElement;
  if (a instanceof HTMLTextAreaElement || (a instanceof HTMLInputElement && a.type === 'text') || a instanceof HTMLInputElement && a.type === 'search') {
    const s = a.selectionStart ?? 0, e = a.selectionEnd ?? 0;
    if (e > s) return a.value.slice(s, e).trim();
  }
  return (window.getSelection()?.toString() ?? '').trim();
}

let mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
const track = (ev: MouseEvent) => { mouse = { x: ev.clientX, y: ev.clientY }; };
window.addEventListener('mousemove', track, { passive: true });
window.addEventListener('mousedown', track, { passive: true });

/** 掛在最上層：快捷鍵、圓環、完成內容視窗、管理視窗 */
export function QuickSearchLayer() {
  const qs = useStore((s) => s.quickSearch);
  const manage = useStore((s) => s.qsManage);
  const [ring, setRing] = useState<{ x: number; y: number; sel: string } | null>(null);
  const [complete, setComplete] = useState<{ item: QsItem; sel: string } | null>(null);
  const ringRef = useRef(ring);
  ringRef.current = ring;

  useEffect(() => {
    if (!qs.on) { setRing(null); return; }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.repeat) return;
      if (comboOf(ev) !== qs.key) return;
      // 設定快捷鍵的輸入框正在錄按鍵：不叫出圓環
      if ((ev.target as HTMLElement | null)?.closest?.('[data-qs-capture]')) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (ringRef.current) { setRing(null); return; }
      if (useStore.getState().qsManage) return;
      const r = 130;
      const x = Math.min(Math.max(mouse.x, r + 10), window.innerWidth - r - 10);
      const y = Math.min(Math.max(mouse.y, r + 10), window.innerHeight - r - 10);
      setRing({ x, y, sel: selectedText() });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [qs.on, qs.key]);

  const run = (item: QsItem, sel: string) => {
    setRing(null);
    if (ready(item, sel)) openSearch(composeQuery(item, sel, prefills(item, sel)));
    else setComplete({ item, sel });
  };

  return (
    <>
      {ring && qs.on && <Ring qs={qs} at={ring} onPick={(it) => run(it, ring.sel)} onEdit={() => { setRing(null); useStore.getState().set({ qsManage: true }); }} onClose={() => setRing(null)} />}
      {complete && <CompleteDialog item={complete.item} sel={complete.sel} onClose={() => setComplete(null)} />}
      {manage && <ManageDialog onClose={() => useStore.getState().set({ qsManage: false })} />}
    </>
  );
}

/** 第 i 格在圓上的位置（第 0 格在正上方，順時針） */
const slotPos = (i: number, n: number, r: number) => {
  const a = (i / n) * Math.PI * 2 - Math.PI / 2;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
};

function Ring({ qs, at, onPick, onEdit, onClose }: { qs: QuickSearch; at: { x: number; y: number }; onPick(it: QsItem): void; onEdit(): void; onClose(): void }) {
  const [hover, setHover] = useState<number | null>(null);
  const [down, setDown] = useState<number | null>(null);
  const [shake, setShake] = useState<number | null>(null);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const R = 96;
  // 按下後滑鼠移開再放開＝取消；在同一格放開才算點擊（先小小抖一下再搜尋）
  const release = (i: number, it: QsItem) => {
    if (down !== i) return;
    setDown(null);
    setShake(i);
    setTimeout(() => onPick(it), 170);
  };
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 120 }} onMouseDown={(ev) => { if (ev.target === ev.currentTarget) onClose(); }} onMouseUp={() => setDown(null)}>
      <div role="menu" aria-label={tx('qs.ring')} style={{ position: 'absolute', left: at.x, top: at.y, width: 0, height: 0 }}>
        <div aria-hidden="true" style={{ position: 'absolute', left: -R - 44, top: -R - 44, width: (R + 44) * 2, height: (R + 44) * 2, borderRadius: '50%', background: 'color-mix(in srgb, var(--pop) 70%, transparent)', border: '1px solid var(--line4)', boxShadow: '0 16px 48px rgba(0,0,0,0.35)', pointerEvents: 'none' }} />
        {Array.from({ length: qs.slots }, (_, i) => {
          const it = qs.items[i];
          if (!hasContent(it)) return null;
          const p = slotPos(i, qs.slots, R);
          const big = hover === i && (down === null || down === i);
          return (
            <button key={i} type="button" role="menuitem" className="qs-opt"
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover((h) => (h === i ? null : h))}
              onMouseDown={(ev) => { if (ev.button === 0) { ev.preventDefault(); setDown(i); } }} onMouseUp={(ev) => { ev.stopPropagation(); release(i, it); }}
              onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onPick(it); } }}
              onAnimationEnd={() => setShake(null)}
              style={{
                position: 'absolute', left: p.x, top: p.y, transform: `translate(-50%, -50%) scale(${big ? 1.12 : 1})`, transition: 'transform 120ms ease',
                maxWidth: 110, padding: '6px 11px', borderRadius: 16, border: '1px solid var(--line4)', background: big ? 'var(--hv3)' : 'var(--card)', color: 'var(--text)',
                fontSize: fz(12.5), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                animation: shake === i ? 'qs-shake 170ms ease' : undefined,
              }}>
              {labelOf(it, chipText)}
            </button>
          );
        })}
        <button type="button" role="menuitem" onClick={onEdit}
          style={{ position: 'absolute', left: 0, top: 0, transform: 'translate(-50%, -50%)', width: 64, height: 64, borderRadius: '50%', border: '1px solid var(--line4)', background: 'var(--btn)', color: 'var(--text2)', fontSize: fz(12.5) }}>
          {tx('qs.edit')}
        </button>
      </div>
    </div>
  );
}

/** 完成內容：整句搜尋內容，框框變成小輸入框（框選帶入的也能改） */
function CompleteDialog({ item, sel, onClose }: { item: QsItem; sel: string; onClose(): void }) {
  const [vals, setVals] = useState(() => prefills(item, sel));
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  useEffect(() => {
    // 游標放在第一個空的輸入框
    const k = vals.findIndex((v) => !v);
    refs.current[k >= 0 ? k : 0]?.focus();
  }, []);
  const go = () => { onClose(); openSearch(composeQuery(item, sel, vals.map((v) => v))); };
  let k = -1;
  return (
    <div className="scrim" style={{ zIndex: 130 }}>
      <form role="dialog" aria-modal="true" aria-labelledby="verso-qs-title" className="dialog" onSubmit={(e) => { e.preventDefault(); go(); }}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}
        style={{ width: 520, maxWidth: 'calc(100vw - 32px)', padding: 20, display: 'flex', flexDirection: 'column', gap: 14, boxShadow: '0 24px 64px rgba(0,0,0,0.45)' }}>
        <h2 id="verso-qs-title" style={{ margin: 0, fontSize: fz(15), fontWeight: 600 }}>{tx('qs.completeTitle')}</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 4px', fontSize: fz(13.5), lineHeight: 1.6 }}>
          {item.parts.map((p, i) => {
            if (p.t === 'text') return <span key={i} style={{ whiteSpace: 'pre-wrap' }}>{p.v}</span>;
            const j = ++k;
            return (
              <input key={i} ref={(el) => { refs.current[j] = el; }} className="field" aria-label={chipText(p)} value={vals[j] ?? ''}
                onChange={(e) => setVals((v) => v.map((x, n) => (n === j ? e.target.value : x)))}
                style={{ width: Math.max(80, Math.min(260, (vals[j]?.length ?? 0) * 9 + 30)), height: 28 }} />
            );
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} style={{ height: 34, padding: '0 14px', background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, fontSize: fz(12.5) }}>{tx('qs.cancel')}</button>
          <button type="submit" className="btn btn-primary" style={{ height: 34, padding: '0 18px', background: 'var(--primary)', border: 0, borderRadius: 8, color: '#ffffff', fontSize: fz(13), fontWeight: 600 }}>{tx('qs.search')}</button>
        </div>
      </form>
    </div>
  );
}

/** 搜尋內容的編輯框：文字可以直接打，框框是不能編輯的小框；Backspace 碰到框框第一次停下、再按才刪 */
function ContentEditor({ parts, onChange, editorRef }: { parts: QsPart[]; onChange(p: QsPart[]): void; editorRef: React.RefObject<HTMLDivElement | null> }) {
  const armed = useRef<HTMLElement | null>(null);
  // 內容由外面換掉時（換了一格）才重畫；打字時不重畫，游標才不會跳
  const last = useRef<string>('');
  useLayoutEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const key = JSON.stringify(parts);
    if (key === last.current) return;
    last.current = key;
    el.innerHTML = '';
    for (const p of parts) el.appendChild(p.t === 'text' ? document.createTextNode(p.v) : chipNode(p));
  });
  const read = () => {
    const el = editorRef.current!;
    const out: QsPart[] = [];
    el.childNodes.forEach((n) => {
      if (n instanceof HTMLElement && n.dataset.chip) out.push({ t: n.dataset.chip as 'sel' | 'fill', req: n.dataset.req === '1' });
      else {
        const v = n.textContent ?? '';
        if (!v) return;
        const prev = out[out.length - 1];
        if (prev?.t === 'text') prev.v += v; else out.push({ t: 'text', v });
      }
    });
    last.current = JSON.stringify(out);
    onChange(out);
  };
  const disarm = () => { armed.current?.classList.remove('qs-chip-armed'); armed.current = null; };
  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (ev.key === 'Enter') { ev.preventDefault(); return; }
    if (ev.key !== 'Backspace') { disarm(); return; }
    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed || !sel.rangeCount) { disarm(); return; }
    const r = sel.getRangeAt(0);
    let before: Node | null = null;
    if (r.startContainer.nodeType === Node.TEXT_NODE) { if (r.startOffset === 0) before = r.startContainer.previousSibling; }
    else before = r.startContainer.childNodes[r.startOffset - 1] ?? null;
    if (!(before instanceof HTMLElement) || !before.dataset.chip) { disarm(); return; }
    ev.preventDefault();
    // 第一次（或按住不放的連續刪除）停在框框前；放開再按一次才刪
    if (armed.current !== before || ev.repeat) { disarm(); armed.current = before; before.classList.add('qs-chip-armed'); return; }
    before.remove();
    disarm();
    read();
  };
  return (
    <div ref={editorRef} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="false" aria-label={tx('qs.content')} className="field"
      onInput={() => { disarm(); read(); }} onKeyDown={onKeyDown} onBlur={disarm}
      style={{ minHeight: 34, height: 'auto', padding: '6px 10px', lineHeight: '22px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', cursor: 'text' }} />
  );
}

function chipNode(p: Chip): HTMLElement {
  const s = document.createElement('span');
  s.contentEditable = 'false';
  s.dataset.chip = p.t;
  s.dataset.req = p.req ? '1' : '0';
  s.className = 'qs-chip';
  s.textContent = chipText(p);
  return s;
}

/** 管理搜尋庫：左邊圓環（拖動條改格數、拖曳互換），右邊編輯選到的那一格 */
function ManageDialog({ onClose }: { onClose(): void }) {
  const qs = useStore((s) => s.quickSearch);
  const put = (patch: Partial<QuickSearch>) => useStore.getState().set({ quickSearch: { ...useStore.getState().quickSearch, ...patch } });
  const [cur, setCur] = useState<number | null>(null);
  const [req, setReq] = useState({ sel: false, fill: false });
  const [drag, setDrag] = useState<number | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const items = Array.from({ length: qs.slots }, (_, i) => qs.items[i] ?? null);
  const it = cur !== null ? items[cur] ?? { name: '', parts: [] } : null;
  const setItem = (next: QsItem | null) => {
    if (cur === null) return;
    const list = Array.from({ length: qs.slots }, (_, i) => qs.items[i] ?? null);
    list[cur] = next && (next.name || next.parts.length) ? next : null;
    put({ items: list });
  };
  const insert = (t: 'sel' | 'fill') => {
    const el = editorRef.current;
    if (!el || !it) return;
    el.focus();
    const sel = window.getSelection();
    let r = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    if (!r || !el.contains(r.startContainer)) { r = document.createRange(); r.selectNodeContents(el); r.collapse(false); }
    r.deleteContents();
    const node = chipNode({ t, req: req[t] });
    r.insertNode(node);
    r.setStartAfter(node);
    r.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(r);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const min = minSlots(items);
  const R = 92;
  return (
    <div className="scrim" style={{ zIndex: 125 }}>
      <div role="dialog" aria-modal="true" aria-labelledby="verso-qsm-title" className="dialog" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
        style={{ width: 760, maxWidth: 'calc(100vw - 32px)', boxShadow: '0 24px 64px rgba(0,0,0,0.45)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 8px' }}>
          <h2 id="verso-qsm-title" style={{ margin: 0, fontSize: fz(15), fontWeight: 600 }}>{tx('qs.managerTitle')}</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose} style={{ height: 30, padding: '0 12px', background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, fontSize: fz(12.5) }}>{tx('qs.close')}</button>
        </div>
        <div style={{ display: 'flex', gap: 20, padding: '8px 20px 20px', flexWrap: 'wrap' }}>
          {/* 圓環 */}
          <div style={{ width: 300, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <div style={{ position: 'relative', width: 280, height: 280 }}>
              <div aria-hidden="true" style={{ position: 'absolute', inset: 6, borderRadius: '50%', border: '1px dashed var(--line4)' }} />
              {items.map((x, i) => {
                const p = slotPos(i, qs.slots, R);
                const on = cur === i;
                return (
                  <button key={i} type="button" draggable onClick={() => setCur(i)}
                    onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = 'move'; }}
                    onDragOver={(e) => { if (drag !== null) e.preventDefault(); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (drag === null || drag === i) return;
                      const list = [...items];
                      [list[drag], list[i]] = [list[i], list[drag]];
                      put({ items: list });
                      if (cur === drag) setCur(i); else if (cur === i) setCur(drag);
                      setDrag(null);
                    }}
                    onDragEnd={() => setDrag(null)}
                    aria-pressed={on} title={tx('qs.dragHint')}
                    style={{
                      position: 'absolute', left: 140 + p.x, top: 140 + p.y, transform: 'translate(-50%, -50%)', maxWidth: 96, minWidth: 40, padding: '5px 9px', borderRadius: 14,
                      border: `1px ${hasContent(x) ? 'solid' : 'dashed'} ${on ? 'var(--accent)' : 'var(--line4)'}`, background: on ? 'var(--sel)' : hasContent(x) ? 'var(--card)' : 'transparent',
                      color: hasContent(x) ? 'var(--text)' : 'var(--mute)', fontSize: fz(12), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer',
                    }}>
                    {hasContent(x) ? labelOf(x, chipText) : tx('qs.empty')}
                  </button>
                );
              })}
              <span style={{ position: 'absolute', left: 140, top: 140, transform: 'translate(-50%, -50%)', fontSize: fz(12), color: 'var(--mute)' }}>{tx('qs.edit')}</span>
            </div>
            <label style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, fontSize: fz(12.5), color: 'var(--text2)' }}>
              {tx('qs.slots')}
              <input type="range" min={2} max={QS_MAX} value={qs.slots} style={{ flexGrow: 1 }}
                onChange={(e) => {
                  const n = Math.max(min, Number(e.target.value));
                  const list = resize(items, qs.slots, n);
                  if (!list) return;
                  put({ slots: n, items: list });
                  if (cur !== null && cur >= n) setCur(null);
                }} />
              <span style={{ width: 22, textAlign: 'right', color: 'var(--text)' }}>{qs.slots}</span>
            </label>
          </div>
          {/* 選到的那一格 */}
          <div style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {it ? (
              <>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: fz(12.5), color: 'var(--text2)' }}>
                  {tx('qs.name')}
                  <input className="field" value={it.name} onChange={(e) => setItem({ ...it, name: e.target.value })} style={{ height: 32 }} />
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: fz(12.5), color: 'var(--text2)' }}>
                  <span>{tx('qs.content')}</span>
                  <ContentEditor key={cur} parts={it.parts} editorRef={editorRef} onChange={(parts) => setItem({ ...it, parts })} />
                </div>
                {(['sel', 'fill'] as const).map((t) => (
                  <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button type="button" className="btn btn-ghost" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(t)}
                      style={{ height: 30, padding: '0 12px', background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, fontSize: fz(12.5) }}>
                      {t === 'sel' ? tx('qs.insSel') : tx('qs.insFill')}
                    </button>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: fz(12.5), color: 'var(--text2)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={req[t]} onChange={(e) => setReq((r) => ({ ...r, [t]: e.target.checked }))} />
                      {tx('qs.required')}
                    </label>
                  </div>
                ))}
                <div>
                  <button type="button" className="btn btn-ghost" onClick={() => { setItem(null); if (editorRef.current) editorRef.current.innerHTML = ''; }}
                    style={{ height: 30, padding: '0 12px', background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, fontSize: fz(12.5), color: 'var(--errtx)' }}>
                    {tx('qs.clear')}
                  </button>
                </div>
              </>
            ) : <div style={{ margin: 'auto', fontSize: fz(12.5), color: 'var(--mute)' }}>{tx('qs.pickSlot')}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 開發者選項：快速搜尋的開關；開啟後才出現快捷鍵設定和管理搜尋庫 */
export function QuickSearchSettings() {
  const qs = useStore((s) => s.quickSearch);
  const put = (patch: Partial<QuickSearch>) => useStore.getState().set({ quickSearch: { ...useStore.getState().quickSearch, ...patch } });
  const [capturing, setCapturing] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: fz(13), cursor: 'pointer' }}>
        <input type="checkbox" role="switch" className="switch" checked={qs.on} onChange={() => put({ on: !qs.on })} />
        {tx('qs.enable')}
      </label>
      <div style={{ fontSize: fz(12), color: 'var(--mute)' }}>{tx('qs.enableHint')}</div>
      {qs.on && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingLeft: 4 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: fz(12.5), color: 'var(--text2)' }}>
            {tx('qs.key')}
            <input data-qs-capture className="field mono" readOnly value={capturing ? tx('qs.keyPress') : qs.key}
              onFocus={() => setCapturing(true)} onBlur={() => setCapturing(false)}
              onKeyDown={(e) => {
                if (e.key === 'Tab') return;
                e.preventDefault();
                e.stopPropagation();
                if (e.key === 'Escape') { (e.target as HTMLInputElement).blur(); return; }
                const c = comboOf(e.nativeEvent);
                if (!c) return;
                put({ key: c });
                (e.target as HTMLInputElement).blur();
              }}
              style={{ width: 150, height: 30, cursor: 'pointer' }} />
          </label>
          <div>
            <button type="button" className="btn btn-ghost" onClick={() => useStore.getState().set({ qsManage: true })}
              style={{ height: 32, padding: '0 14px', background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, fontSize: fz(12.5) }}>{tx('qs.manage')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
