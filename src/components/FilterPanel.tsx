// 條目欄的篩選：一個圖標，點開是篩選面板。每個條件點一下輪流「不選 → 勾選 → 排除」；
// 符合任一勾選的就顯示，符合任一排除的一定不顯示，都沒勾時顯示全部（只拿掉排除的）。
import { useEffect, useRef, useState } from 'react';
import { tx } from '../i18n';
import { fz } from '../model/fonts';
import { markName, markVisual } from '../model/marks';
import { hasPlugin } from '../plugins/has';
import type { MarkId } from '../model/types';
import { currentFilters, currentOf, setsOn, useStore, type Filter } from '../state/store';
import { IconLink, IconStack } from './EntrySets';
import { useShallow } from 'zustand/react/shallow';
import { COLS } from '../model/paste';
import { FILTER_OPS, filterKey, newFilterId, type CustomFilter, type FilterOp } from '../model/customFilter';
import { Select } from './Select';
import { MarkIcon } from './MarkIcon';
import { IconCheck, IconPen, IconWarn, IconWinClose } from './icons';

/** 篩選面板列出的條件：內建標記、有問題、原文更新、有備註、有未解決的對話（雲端模式）、自訂標記 */
export function filterKeys(customIds: string[], cloud = false): string[] {
  const marks: MarkId[] = ['untranslated', 'translated', 'verified', 'doubt', 'think', 'ignore', ...(hasPlugin('ai') ? ['ai' as const] : [])];
  return [...marks, 'issues', 'srcupd', 'note', ...(cloud ? ['talk', 'resolved'] : []), ...customIds.map((id) => 'c:' + id)];
}

/** 左鍵：空 → 包含 → 排除 → 空；右鍵（back）反過來：空 → 排除 → 包含 → 空 */
export const next = (v: 1 | -1 | undefined, back = false): 1 | -1 | undefined => (back
  ? (v === undefined ? -1 : v === -1 ? 1 : undefined)
  : (v === undefined ? 1 : v === 1 ? -1 : undefined));
/** 右鍵：不開瀏覽器選單，往回切 */
const onBack = (fn: () => void) => (ev: React.MouseEvent) => { ev.preventDefault(); fn(); };

/** 勾選、排除、不選的小方框 */
export function StateBox({ v }: { v: 1 | -1 | undefined | 'mixed' }) {
  const box: React.CSSProperties = {
    width: 14, height: 14, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4, fontSize: 11, lineHeight: 1,
    border: `1.5px solid ${v === undefined ? 'var(--line4)' : v === -1 ? 'var(--errtx)' : 'var(--accent)'}`,
    background: v === 1 ? 'var(--accent)' : 'transparent', color: v === 1 ? '#ffffff' : v === -1 ? 'var(--errtx)' : 'var(--text2)',
  };
  return <span aria-hidden="true" style={box}>{v === 1 ? '✓' : v === -1 ? '✕' : v === 'mixed' ? '~' : ''}</span>;
}

/** 漏斗圖示；有篩選時換成實心、加一個點（不換顏色） */
export function FunnelIcon({ on, size = 16 }: { on: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round">
      <path d="M4 5h16l-6 7.5V19l-4-2v-4.5z" />
      {on && <circle cx="19.5" cy="17.5" r="2.5" stroke="none" />}
    </svg>
  );
}

/** 名稱：放不下時末端漸隱，滑鼠移上去像跑馬燈一樣捲動看完整的名稱 */
export function FadeLabel({ text }: { text: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const [over, setOver] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setOver(Math.max(0, (el.firstElementChild as HTMLElement).scrollWidth - el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);
  return (
    <span ref={box} className={'fade-label' + (over ? ' fade-label-over' : '')} style={{ ['--run' as string]: -over + 'px', ['--dur' as string]: Math.max(2, over / 30) + 's' }}>
      <span>{text}</span>
    </span>
  );
}

/** 自訂篩選條件的設定（新增或編輯）：哪一欄、什麼條件、內容、名稱 */
function CustomForm({ init, cols, onDone }: { init: CustomFilter | null; cols: { value: string; label: string }[]; onDone(f: CustomFilter | null): void }) {
  const [col, setCol] = useState(init?.col ?? 'tgt');
  const [op, setOp] = useState<FilterOp>(init?.op ?? 'contains');
  const [value, setValue] = useState(init?.value ?? '');
  const [name, setName] = useState(init?.name ?? '');
  const ok = !!name.trim() && (op === 'blank' || !!value.trim());
  const submit = (ev: React.FormEvent) => { ev.preventDefault(); if (ok) onDone({ id: init?.id ?? newFilterId(), name: name.trim(), col, op, value: op === 'blank' ? '' : value }); };
  const ib: React.CSSProperties = { width: 30, height: 30, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 7, color: 'var(--text2)' };
  return (
    <form onSubmit={submit} onKeyDown={(ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); onDone(null); } }}
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingTop: 6, borderTop: '1px solid var(--line)' }}>
      {/* 第一行：名稱、欄、條件；第二行：內容、確定、取消 */}
      <input className="field" autoFocus aria-label={tx('list.cfName')} placeholder={tx('list.cfName')} value={name} onChange={(e) => setName(e.target.value)} style={{ width: 120, height: 30 }} />
      <Select value={col} options={cols} onChange={setCol} ariaLabel={tx('list.cfCol')} style={{ width: 110, height: 30 }} />
      <Select value={op} options={FILTER_OPS.map((o) => ({ value: o, label: tx(('list.op.' + o) as 'list.op.blank') }))} onChange={(v) => setOp(v as FilterOp)} ariaLabel={tx('list.cfOp')} style={{ width: 110, height: 30 }} />
      <span style={{ flexBasis: '100%', height: 0 }} />
      <input className="field" aria-label={tx('list.cfValue')} placeholder={tx('list.cfValue')} value={op === 'blank' ? '' : value} disabled={op === 'blank'} onChange={(e) => setValue(e.target.value)} style={{ flexGrow: 1, minWidth: 0, height: 30 }} />
      <button type="submit" className="ib" disabled={!ok} aria-label={tx('list.cfOk')} title={tx('list.cfOk')} style={{ ...ib, color: ok ? 'var(--accent2)' : 'var(--mute)' }}><IconCheck size={13} sw={2.4} /></button>
      <button type="button" className="ib" aria-label={tx('list.cfCancel')} title={tx('list.cfCancel')} onClick={() => onDone(null)} style={ib}><IconWinClose size={10} sw={1.6} /></button>
    </form>
  );
}

export function FilterPanel({ counts }: { counts: Record<string, number> }) {
  const filter = useStore((s) => s.filter);
  const customs = useStore((s) => s.project?.customMarks ?? []);
  const set = useStore((s) => s.set);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const cloud = useStore((s) => s.cloudMode);
  // 這個頁簽的自訂篩選條件；form：正在新增（null）或編輯的條件
  const cfs = useStore((s) => currentFilters(s));
  const [form, setForm] = useState<{ edit: CustomFilter | null } | null>(null);
  const extraNames = useStore(useShallow((s) => [...new Set(currentOf(s).sheet.entries.flatMap((e) => e.extraNotes?.map((n) => n.name) ?? []))]));
  const cfCols = [...COLS.map((c) => ({ value: c.key as string, label: c.label })), ...extraNames.map((n) => ({ value: 'x:' + n, label: n }))];
  // 收起組、條目串（雲端模式打開這個功能時）：篩選出組裡、串裡的條目
  const setKeys = useStore((s) => { const f = currentOf(s).fileDoc; return setsOn(s, f) ? (f.skill ? 'gc' : 'g') : ''; });
  const keys = [...filterKeys(customs.map((c) => c.id), cloud), ...(setKeys ? ['group'] : []), ...(setKeys === 'gc' ? ['chain'] : []), ...cfs.map((f) => filterKey(f.id))];
  const cfOf = (k: string) => (k.startsWith('u:') ? cfs.find((f) => filterKey(f.id) === k) : undefined);
  const saveCf = (f: CustomFilter | null) => {
    setForm(null);
    if (!f) return;
    const list = cfs.some((x) => x.id === f.id) ? cfs.map((x) => (x.id === f.id ? f : x)) : [...cfs, f];
    useStore.getState().setSheetFilters(list);
  };
  const active = keys.some((k) => filter[k] !== undefined);
  const states = keys.map((k) => filter[k]);
  const allState: 1 | -1 | undefined | 'mixed' = states.every((v) => v === states[0]) ? states[0] : 'mixed';
  // 「全部」上次切到哪個狀態（單獨改過條件之後，再按從這裡接下去）
  const lastAll = useRef<1 | -1 | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    // 點的地方可能已經不在畫面上了（例如下拉選單收起時的背景），用事件經過的路徑判斷是不是點在篩選器裡
    const down = (ev: MouseEvent) => { if (wrap.current && !ev.composedPath().includes(wrap.current)) { setOpen(false); setForm(null); } };
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key, true); };
  }, [open]);

  const put = (f: Filter) => set({ filter: f, cellSel: null });
  const toggle = (k: string, back = false) => {
    const v = next(filter[k], back);
    const f = { ...filter };
    if (v === undefined) delete f[k]; else f[k] = v;
    put(f);
  };
  const toggleAll = (back = false) => {
    const v = next(allState === 'mixed' ? lastAll.current : allState, back);
    lastAll.current = v;
    put(v === undefined ? {} : Object.fromEntries(keys.map((k) => [k, v])));
  };
  const stateText = (v: 1 | -1 | undefined | 'mixed') => (v === 1 ? tx('list.filterInclude') : v === -1 ? tx('list.filterExclude') : v === 'mixed' ? tx('list.filterMixed') : tx('list.filterNone'));
  const label = (k: string) => (cfOf(k)?.name ?? (k === 'group' ? tx('sets.group') : k === 'chain' ? tx('sets.chain') : k === 'issues' ? tx('list.008') : k === 'note' ? tx('list.filterNote') : k === 'talk' ? tx('list.filterTalk') : k === 'resolved' ? tx('list.filterResolved') : markName(customs, k as MarkId)));
  const item: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, height: 30, padding: '0 8px', border: 0, borderRadius: 6,
    background: 'transparent', color: 'var(--text)', fontSize: fz(12.5), textAlign: 'left',
  };

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <button type="button" className="ib" aria-label={tx('list.026')} title={tx('list.026')} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'var(--btn)', border: '1px solid var(--line3)', borderRadius: 8, color: 'var(--text2)' }}>
        <FunnelIcon on={active} />
      </button>
      {open && (
        <div role="dialog" aria-label={tx('list.026')} className="pop"
          style={{ position: 'absolute', top: 40, right: 0, zIndex: 40, width: 440, maxWidth: 'calc(100vw - 32px)', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button type="button" className="dd" onClick={() => toggleAll()} onContextMenu={onBack(() => toggleAll(true))} aria-label={tx('list.004') + tx('common.colon') + stateText(allState)} title={stateText(allState)}
            style={{ ...item, fontWeight: 600, borderBottom: '1px solid var(--line)', borderRadius: 0, paddingBottom: 2 }}>
            <StateBox v={allState} />{tx('list.004')}
          </button>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 2 }}>
            {keys.map((k) => {
              const cf = cfOf(k);
              return (
              <button key={k} type="button" className="dd cf-item" onClick={() => toggle(k)} onContextMenu={onBack(() => toggle(k, true))} aria-label={label(k) + tx('common.colon') + stateText(filter[k])} title={stateText(filter[k])} style={item}>
                <StateBox v={filter[k]} />
                {cf ? <FunnelIcon on={false} size={12} />
                  : k === 'group' ? <span style={{ display: 'flex', color: 'var(--text2)' }}><IconStack size={12} /></span>
                  : k === 'chain' ? <span style={{ display: 'flex', color: 'var(--text2)' }}><IconLink size={12} /></span>
                  : k === 'issues' ? <IconWarn size={12} sw={2.2} stroke="var(--warntx)" />
                  : k === 'note' ? <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth={2.2} strokeLinejoin="round" aria-hidden="true"><path d="M4 5h16v11H9.5L4 20.5z" /></svg>
                  : k === 'talk' ? <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 12H7l-4 3V4h11v5" /><path d="M9 9h12v11l-4-3H9z" /></svg>
                  : k === 'resolved' ? <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 12H7l-4 3V4h11v5" /><path d="M9 9h12v11l-4-3H9z" /><path d="M12.5 14l2 2 3.5-3.5" /></svg>
                  : <MarkIcon mark={markVisual(customs, k as MarkId)} size={12} menu />}
                <FadeLabel text={label(k)} />
                {/* 自訂條件：數字左邊的編輯、移除（按了不會切換這個條件） */}
                {cf && (
                  <span className="cf-acts" onClick={(ev) => ev.stopPropagation()} onContextMenu={(ev) => { ev.preventDefault(); ev.stopPropagation(); }} onMouseDown={(ev) => ev.stopPropagation()}>
                    <span role="button" tabIndex={-1} className="cf-act" aria-label={tx('list.cfEdit')} title={tx('list.cfEdit')} onClick={() => setForm({ edit: cf })}><IconPen size={11} /></span>
                    <span role="button" tabIndex={-1} className="cf-act" aria-label={tx('list.cfRemove')} title={tx('list.cfRemove')} onClick={() => useStore.getState().setSheetFilters(cfs.filter((x) => x.id !== cf.id))}><IconWinClose size={8} sw={1.6} /></span>
                  </span>
                )}
                <span style={{ flexShrink: 0, fontSize: fz(11), color: 'var(--mute)' }}>{counts[k] ?? 0}</span>
              </button>
              );
            })}
            {/* 新增自訂篩選條件 */}
            {!form && (
              <button type="button" className="dd" aria-label={tx('list.cfAdd')} title={tx('list.cfAdd')} onClick={() => setForm({ edit: null })}
                style={{ ...item, justifyContent: 'center', color: 'var(--text2)', fontSize: fz(16) }}>+</button>
            )}
          </div>
          {form && <CustomForm key={form.edit?.id ?? 'new'} init={form.edit} cols={cfCols} onDone={saveCf} />}
        </div>
      )}
    </div>
  );
}
