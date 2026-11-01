// 翻譯記憶的畫面：記憶卡片、目前條目的比對結果、記憶分頁（全部記憶、管理、匯入匯出、一致性）
import { tx } from '../i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { fz } from '../model/fonts';
import { effectiveMark } from '../model/marks';
import { SHARED } from '../model/types';
import { inconsistent, parseTmx, toTmx, type TmMatch, type TmRow } from '../model/tm';
import { currentProjectOf, showToast, useStore } from '../state/store';
import { leaveFile } from '../state/saver';
import { io } from '../data/fsio';
import {
  addProjectMemory, addRow, applyMatch, deleteProjectMemory, deleteRows, deletedRows, editRow, exportTmDb, importRows, matchText, moveRows,
  readTmDb, renameProjectMemory, restoreRow, rowsFromFile, sourceOf, tmProjectList, tmProjectsOn, undoTm, useTm, useTmMatches, versionsOf,
} from '../state/tm';
import { ConfirmDialog } from './ConfirmDialog';
import { Select } from './Select';
import { dragWindow } from './windowDrag';
import { IconArrowR, IconChevD, IconGear, IconList, IconPenEdit, IconPlus, IconSearch, IconTrash, IconUndo, IconUse, IconWarn, IconWinClose } from './icons';

const iconBtn: React.CSSProperties = {
  width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'transparent', border: 0, borderRadius: 6, color: 'var(--mute)',
};
const toolBtn: React.CSSProperties = {
  width: 36, height: 36, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, color: 'var(--text2)',
};
const ghostBtn: React.CSSProperties = {
  height: 32, display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px', background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, fontSize: fz(12.5),
};
const primaryBtn: React.CSSProperties = {
  height: 36, padding: '0 18px', background: 'var(--primary)', border: 0, borderRadius: 8, color: '#ffffff', fontSize: fz(13), fontWeight: 600,
};
const smallText: React.CSSProperties = { fontSize: fz(11), color: 'var(--mute)' };

const when = (at: number) => new Date(at).toLocaleString();

/** 跳到記憶的來源條目（別的檔案就打開那個檔案） */
export function jumpToRow(r: TmRow) {
  const t = sourceOf(r);
  const p = useStore.getState().project;
  if (!t || !p) { showToast(tx('tm.notFound')); return; }
  leaveFile(p.files[t.file], (i) => { if (i >= 0) useStore.getState().select(i, t.sheet, t.index); });
}

/** 原文：跟目前條目一樣的部分畫底線 */
function Underlined({ text, under }: { text: string; under: [number, number][] }) {
  if (!under.length) return <>{text}</>;
  const out: React.ReactNode[] = [];
  let at = 0;
  under.forEach(([a, b], k) => {
    if (a > at) out.push(text.slice(at, a));
    out.push(<u key={k} style={{ textDecorationColor: 'var(--accent)', textUnderlineOffset: 3 }}>{text.slice(a, b)}</u>);
    at = b;
  });
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}

/** 一條記憶。m 有值時是比對結果（顯示相似度、可以套用） */
export function TmCard({ row, m, n }: { row: TmRow; m?: TmMatch; n?: number }) {
  const [info, setInfo] = useState(false);
  const mode = useStore((s) => s.mode);
  const label = !m ? '' : m.same ? tx('tm.sameId') : m.kind === 'pattern' ? tx('tm.pattern') : m.kind === 'frag' ? tx('tm.frag') : m.pct + '%';
  const tgt = m && m.kind === 'pattern' ? matchText(m).text : row.tgt;
  return (
    <div className="card" style={{ gap: 4 }}>
      {(m || !row.verified) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 16 }}>
          {m && <span style={{ fontSize: fz(11), color: m.pct === 100 && m.kind === 'fuzzy' ? 'var(--accent2)' : 'var(--mute)', fontWeight: 500 }}>{label}</span>}
          {n !== undefined && n <= 9 && <span className="mono" title={tx('tm.ctrlTip', { n })} style={{ fontSize: fz(10.5), color: 'var(--mute)', padding: '0 5px', border: '1px solid var(--line3)', borderRadius: 4 }}>Ctrl+{n}</span>}
          {!row.verified && <span title={tx('tm.unverified')} aria-label={tx('tm.unverified')} style={{ display: 'flex', color: 'var(--warntx)' }}><IconWarn size={12} sw={2.2} /></span>}
        </div>
      )}
      <div style={{ fontSize: fz(13.5), lineHeight: 1.5, wordBreak: 'break-word' }}><Underlined text={row.src} under={m?.under ?? []} /></div>
      <div style={{ fontSize: fz(12.5), lineHeight: 1.5, color: 'var(--accent3)', wordBreak: 'break-word' }}>{tgt}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ ...smallText, flexGrow: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }} title={[row.project, row.file].filter(Boolean).join(' · ')}>
          {[row.project, row.file].filter(Boolean).join(' · ')}
        </span>
        <button type="button" className="ib" style={{ ...iconBtn, color: info ? 'var(--accent2)' : 'var(--mute)' }} aria-pressed={info} aria-label={tx('tm.info')} title={tx('tm.info')} onClick={() => setInfo(!info)}><IconList size={13} /></button>
        <button type="button" className="ib" style={iconBtn} aria-label={tx('tm.jump')} title={tx('tm.jump')} onClick={() => jumpToRow(row)}><IconArrowR size={13} /></button>
        {m && mode === 'translate' && <button type="button" className="ib" style={iconBtn} aria-label={tx('tm.apply')} title={tx('tm.apply')} onClick={() => applyMatch(m)}><IconUse size={13} /></button>}
      </div>
      {info && <TmInfo row={row} />}
    </div>
  );
}

/** 記憶的資訊：時間、譯者、來源；編輯、刪除、舊版本 */
function TmInfo({ row }: { row: TmRow }) {
  const [editing, setEditing] = useState(false);
  const [src, setSrc] = useState(row.src);
  const [tgt, setTgt] = useState(row.tgt);
  const [askDel, setAskDel] = useState(false);
  const [vers, setVers] = useState<{ at: number; row: TmRow }[] | null>(null);
  const line = (k: string, v: string) => v ? <div style={{ display: 'flex', gap: 8 }}><span style={{ color: 'var(--mute)', flexShrink: 0 }}>{k}</span><span style={{ minWidth: 0, wordBreak: 'break-word' }}>{v}</span></div> : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4, padding: '8px 10px', borderRadius: 8, background: 'var(--bg0)', border: '1px solid var(--line2)', fontSize: fz(11.5) }}>
      {line(tx('tm.time'), when(row.at))}
      {line(tx('tm.by'), row.by)}
      {line(tx('tm.status'), row.verified ? tx('tm.verified') : tx('tm.unverified'))}
      {line(tx('tm.from'), [row.project, row.file, row.sheet, row.eid && '#' + row.eid, row.speaker].filter(Boolean).join(' · '))}
      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          <textarea className="field" aria-label={tx('tm.src')} value={src} onChange={(e) => setSrc(e.target.value)} rows={2} style={{ resize: 'vertical', padding: 8, height: 'auto' }} />
          <textarea className="field" aria-label={tx('tm.tgt')} value={tgt} onChange={(e) => setTgt(e.target.value)} rows={2} style={{ resize: 'vertical', padding: 8, height: 'auto' }} />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" style={{ ...ghostBtn, height: 28 }} onClick={() => { setEditing(false); setSrc(row.src); setTgt(row.tgt); }}>{tx('manage.007')}</button>
            <button type="button" className="btn btn-primary" style={{ ...primaryBtn, height: 28, padding: '0 12px' }} disabled={!src.trim() || !tgt.trim()}
              onClick={() => { editRow(row.id, { src, tgt }); setEditing(false); }}>{tx('tm.save')}</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ghost" style={{ ...ghostBtn, height: 26 }} onClick={() => setEditing(true)}><IconPenEdit size={12} />{tx('tm.edit')}</button>
          <button type="button" className="btn btn-ghost" style={{ ...ghostBtn, height: 26, color: 'var(--errtx)' }} onClick={() => setAskDel(true)}><IconTrash size={12} />{tx('tm.delete')}</button>
          <button type="button" className="btn btn-ghost" style={{ ...ghostBtn, height: 26 }} onClick={() => { void versionsOf(row.id).then(setVers); }}>{tx('tm.versions')}</button>
        </div>
      )}
      {vers && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
          {vers.length === 0 && <span style={smallText}>{tx('tm.noVersions')}</span>}
          {vers.map((v, k) => (
            <div key={k} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', paddingTop: 4, borderTop: '1px solid var(--line)' }}>
              <span style={{ flexGrow: 1, minWidth: 0 }}>
                <span style={smallText}>{when(v.at)}</span>
                <div>{v.row.src}</div>
                <div style={{ color: 'var(--accent3)' }}>{v.row.tgt}</div>
              </span>
              <button type="button" className="btn btn-ghost" style={{ ...ghostBtn, height: 24, padding: '0 8px', fontSize: fz(11) }} onClick={() => { restoreRow(v.row); setVers(null); }}>{tx('tm.restore')}</button>
            </div>
          ))}
        </div>
      )}
      {askDel && (
        <ConfirmDialog zIndex={60} title={tx('tm.deleteAsk')} body={row.src}
          choices={[
            { label: tx('manage.007'), onClick: () => setAskDel(false) },
            { label: tx('tm.delete'), danger: true, onClick: () => { setAskDel(false); deleteRows([row.id]); showToast(tx('tm.deleted')); } },
          ]} />
      )}
    </div>
  );
}

/** 目前條目的比對結果 */
export function TmMatches({ limit }: { limit?: number }) {
  const list = useTmMatches();
  const loaded = useTm((t) => t.loaded);
  const error = useTm((t) => t.error);
  if (!loaded) return <div className="empty" style={{ padding: '20px 12px' }}>{error ? tx('tm.loadFailed', { reason: error }) : tx('tm.loading')}</div>;
  const shown = limit ? list.slice(0, limit) : list;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {shown.map((m, k) => <TmCard key={m.row.id + m.kind} row={m.row} m={m} n={k + 1} />)}
      {list.length === 0 && <div className="empty" style={{ padding: '20px 12px' }}>{tx('tm.noMatch')}</div>}
    </div>
  );
}

/** 要查哪些專案的記憶（跟字典一樣的開關） */
function ProjectPicker() {
  const [open, setOpen] = useState(false);
  const current = useStore((s) => currentProjectOf(s));
  const overrides = useStore((s) => s.tmOverrides);
  useTm((t) => t.ver);
  useTm((t) => t.extra);
  const all = tmProjectList();
  const on = tmProjectsOn(current, overrides, all);
  const toggle = (p: string) => {
    const k = current + '>' + p;
    const auto = p === current || p === SHARED;
    const next = { ...overrides };
    if (!on.has(p) === auto) delete next[k]; else next[k] = !on.has(p);
    useStore.getState().set({ tmOverrides: next });
  };
  return (
    <div>
      <button type="button" className="ib" aria-expanded={open} onClick={() => setOpen(!open)}
        style={{ height: 26, display: 'flex', alignItems: 'center', gap: 6, padding: '0 6px 0 2px', background: 'transparent', border: 0, borderRadius: 6, color: 'var(--text2)', fontSize: fz(12) }}>
        <IconChevD size={12} sw={2.4} style={{ transform: `rotate(${open ? 0 : -90}deg)`, transition: 'transform 160ms' }} />
        {tx('tm.inUse')}
        <span style={{ color: 'var(--mute)' }}>{on.size} / {all.length}</span>
      </button>
      {open && (
        <div role="group" aria-label={tx('tm.inUse')} style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4, padding: 4, background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 8 }}>
          {all.map((p) => (
            <label key={p} className="dd" style={{ height: 30, display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px', borderRadius: 6, cursor: 'pointer', fontSize: fz(12.5) }}>
              <span style={{ flexGrow: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{p}</span>
              <input type="checkbox" role="switch" className="switch" aria-label={p} checked={on.has(p)} onChange={() => toggle(p)} />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

type Status = 'all' | 'verified' | 'unverified';
type Range = 'all' | 'day' | 'week' | 'month';
type Sort = 'new' | 'old' | 'src';
const RANGE_MS: Record<Range, number> = { all: Infinity, day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000 };

interface RowFilter { q: string; project: string; status: Status; by: string; range: Range; sort: Sort }
const NO_FILTER: RowFilter = { q: '', project: '', status: 'all', by: '', range: 'all', sort: 'new' };

/** 照搜尋、篩選、排序挑出記憶 */
function filterRows(rows: Iterable<TmRow>, f: RowFilter, projects: Set<string> | null): TmRow[] {
  const q = f.q.trim().toLowerCase();
  const now = Date.now();
  const out: TmRow[] = [];
  for (const r of rows) {
    if (projects && !projects.has(r.project)) continue;
    if (f.project && r.project !== f.project) continue;
    if (f.status === 'verified' && !r.verified) continue;
    if (f.status === 'unverified' && r.verified) continue;
    if (f.by && r.by !== f.by) continue;
    if (now - r.at > RANGE_MS[f.range]) continue;
    if (q && !r.src.toLowerCase().includes(q) && !r.tgt.toLowerCase().includes(q)) continue;
    out.push(r);
  }
  return out.sort(f.sort === 'old' ? (a, b) => a.at - b.at : f.sort === 'src' ? (a, b) => a.src.localeCompare(b.src) : (a, b) => b.at - a.at);
}

const BATCH = 30;
/** 長清單：先顯示一批，捲到底再顯示下一批 */
function RowList({ rows, empty, select }: { rows: TmRow[]; empty: string; select?: { on: Set<string>; toggle(id: string): void } }) {
  const [shown, setShown] = useState(BATCH);
  useEffect(() => { setShown(BATCH); }, [rows]);
  const more = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = more.current;
    if (!el) return;
    const ob = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) setShown((n) => n + BATCH); });
    ob.observe(el);
    return () => ob.disconnect();
  }, [shown, rows]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.slice(0, shown).map((r) => select ? (
        <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <input type="checkbox" aria-label={r.src} checked={select.on.has(r.id)} onChange={() => select.toggle(r.id)} style={{ marginTop: 12 }} />
          <div style={{ flexGrow: 1, minWidth: 0 }}><TmCard row={r} /></div>
        </div>
      ) : <TmCard key={r.id} row={r} />)}
      {rows.length > shown && <div ref={more} style={{ height: 1 }} />}
      {rows.length === 0 && <div className="empty" style={{ padding: '20px 12px' }}>{empty}</div>}
    </div>
  );
}

/** 篩選列：專案、狀態、譯者、時間、排序 */
function FilterBar({ f, set, projects, people, hideProject }: { f: RowFilter; set(f: RowFilter): void; projects: string[]; people: string[]; hideProject?: boolean }) {
  const sel = (label: string, value: string, options: { value: string; label: string }[], on: (v: string) => void) => (
    <Select ariaLabel={label} value={value} options={options} onChange={on} style={{ flex: '1 1 110px', minWidth: 0, height: 30 }} />
  );
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {!hideProject && sel(tx('tm.fProject'), f.project, [{ value: '', label: tx('tm.allProjects') }, ...projects.map((p) => ({ value: p, label: p }))], (v) => set({ ...f, project: v }))}
      {sel(tx('tm.status'), f.status, [{ value: 'all', label: tx('tm.allStatus') }, { value: 'unverified', label: tx('tm.unverified') }, { value: 'verified', label: tx('tm.verified') }], (v) => set({ ...f, status: v as Status }))}
      {sel(tx('tm.by'), f.by, [{ value: '', label: tx('tm.allPeople') }, ...people.map((p) => ({ value: p, label: p }))], (v) => set({ ...f, by: v }))}
      {sel(tx('tm.time'), f.range, [{ value: 'all', label: tx('tm.anyTime') }, { value: 'day', label: tx('tm.day') }, { value: 'week', label: tx('tm.week') }, { value: 'month', label: tx('tm.month') }], (v) => set({ ...f, range: v as Range }))}
      {sel(tx('tm.sort'), f.sort, [{ value: 'new', label: tx('tm.sortNew') }, { value: 'old', label: tx('tm.sortOld') }, { value: 'src', label: tx('tm.sortSrc') }], (v) => set({ ...f, sort: v as Sort }))}
    </div>
  );
}

/** 記憶分頁：目前條目的比對結果、勾選專案的全部記憶 */
export function TmTab() {
  const rows = useTm((t) => t.rows);
  const undo = useTm((t) => t.undo.length);
  const current = useStore((s) => currentProjectOf(s));
  const overrides = useStore((s) => s.tmOverrides);
  const [f, setF] = useState<RowFilter>(NO_FILTER);
  const [filters, setFilters] = useState(false);
  const [dq, setDq] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(f.q), 250); return () => clearTimeout(t); }, [f.q]);
  const on = useMemo(() => tmProjectsOn(current, overrides, tmProjectList()), [current, overrides, rows]);
  const people = useMemo(() => [...new Set([...rows.values()].map((r) => r.by).filter(Boolean))].sort(), [rows]);
  const list = useMemo(() => filterRows(rows.values(), { ...f, q: dq }, on), [rows, f.project, f.status, f.by, f.range, f.sort, dq, on]);
  const open = (d: 'manage' | 'import' | 'export' | 'consistency') => useTm.setState({ dialog: d });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <div style={{ position: 'relative', flexGrow: 1, minWidth: 0 }}>
          <IconSearch size={14} stroke="var(--mute)" style={{ position: 'absolute', left: 11, top: 11, pointerEvents: 'none' }} />
          <input type="search" className="field" aria-label={tx('tm.search')} value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder={tx('tm.search')} style={{ width: '100%', padding: '0 12px 0 32px' }} />
        </div>
        <button type="button" className="ib" style={{ ...toolBtn, color: filters ? 'var(--accent2)' : 'var(--text2)' }} aria-pressed={filters} aria-label={tx('tm.filter')} title={tx('tm.filter')} onClick={() => setFilters(!filters)}><IconList size={15} /></button>
        <button type="button" className="ib" style={toolBtn} aria-label={tx('tm.manage')} title={tx('tm.manage')} onClick={() => open('manage')}><IconGear size={15} /></button>
      </div>
      {filters && <FilterBar f={f} set={setF} projects={[...on]} people={people} />}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-ghost" style={{ ...ghostBtn, height: 28 }} onClick={() => open('import')}>{tx('tm.import')}</button>
        <button type="button" className="btn btn-ghost" style={{ ...ghostBtn, height: 28 }} onClick={() => open('export')}>{tx('tm.export')}</button>
        <button type="button" className="btn btn-ghost" style={{ ...ghostBtn, height: 28 }} onClick={() => open('consistency')}>{tx('tm.consistency')}</button>
        {undo > 0 && <button type="button" className="btn btn-ghost" style={{ ...ghostBtn, height: 28 }} onClick={undoTm}><IconUndo size={12} />{tx('tm.undo')}</button>}
      </div>
      <ProjectPicker />
      {!dq && (
        <>
          <div style={smallText}>{tx('tm.forEntry')}</div>
          <TmMatches />
          <div style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />
        </>
      )}
      <div style={smallText}>{tx('tm.count', { n: list.length })}</div>
      <RowList rows={list} empty={dq ? tx('side.020', { q: dq }) : tx('tm.empty')} />
    </div>
  );
}

/** 綜合分頁裡的記憶區塊：小搜尋框、目前條目的比對結果 */
export function TmBlock() {
  const rows = useTm((t) => t.rows);
  const current = useStore((s) => currentProjectOf(s));
  const overrides = useStore((s) => s.tmOverrides);
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(q), 250); return () => clearTimeout(t); }, [q]);
  const on = useMemo(() => tmProjectsOn(current, overrides, tmProjectList()), [current, overrides, rows]);
  const list = useMemo(() => (dq.trim() ? filterRows(rows.values(), { ...NO_FILTER, q: dq }, on) : []), [rows, dq, on]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input type="search" className="field" aria-label={tx('tm.search')} value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx('tm.search')} style={{ height: 30 }} />
      {dq.trim() ? <RowList rows={list} empty={tx('side.020', { q: dq })} /> : <TmMatches />}
    </div>
  );
}

// ---- 對話框 ----

function Shell({ title, onClose, width = 560, children }: { title: string; onClose(): void; width?: number; children: React.ReactNode }) {
  return (
    <div className="scrim" style={{ zIndex: 45 }} onMouseDown={dragWindow}>
      <div role="dialog" aria-modal="true" aria-label={title} className="dialog"
        style={{ width, height: 640, maxWidth: 'calc(100% - 48px)', maxHeight: 'calc(100% - 48px)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>
        <div style={{ height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px 0 20px', borderBottom: '1px solid var(--line)' }}>
          <h2 style={{ margin: 0, fontSize: fz(15), fontWeight: 600 }}>{title}</h2>
          <button type="button" className="ib" aria-label={tx('manage.001')} onClick={onClose}
            style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 0, borderRadius: 8, color: 'var(--text2)' }}><IconWinClose size={13} sw={1.4} /></button>
        </div>
        <div style={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
      </div>
    </div>
  );
}

const close = () => useTm.setState({ dialog: null });

/** 管理專案記憶：選一個專案記憶，搜尋、篩選、排序、新增、改名、刪除、搬移 */
function ManageDialog() {
  const rows = useTm((t) => t.rows);
  useTm((t) => t.extra);
  const current = useStore((s) => currentProjectOf(s));
  const all = tmProjectList();
  const [p, setP] = useState(all.includes(current) ? current : all[0]);
  const [f, setF] = useState<RowFilter>(NO_FILTER);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [naming, setNaming] = useState<null | 'add' | 'rename'>(null);
  const [name, setName] = useState('');
  const [askDel, setAskDel] = useState<null | 'project' | 'rows'>(null);
  const [adding, setAdding] = useState<{ src: string; tgt: string } | null>(null);
  const [deleted, setDeleted] = useState<{ at: number; row: TmRow }[] | null>(null);
  const project = all.includes(p) ? p : SHARED;
  const people = useMemo(() => [...new Set([...rows.values()].map((r) => r.by).filter(Boolean))].sort(), [rows]);
  const list = useMemo(() => filterRows(rows.values(), { ...f, project }, null), [rows, f, project]);
  useEffect(() => { setPicked(new Set()); }, [project]);
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const doName = () => {
    const n = name.trim();
    if (!n) { setNaming(null); return; }
    if (all.some((x) => x !== project && x === n)) { showToast(tx('tm.nameTaken')); return; }
    if (naming === 'add') { addProjectMemory(n); setP(n); } else { renameProjectMemory(project, n); setP(n); }
    setNaming(null);
  };
  return (
    <Shell title={tx('tm.manage')} onClose={close} width={720}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <Select ariaLabel={tx('tm.fProject')} value={project} options={all.map((x) => ({ value: x, label: x }))} onChange={setP} style={{ width: 200, height: 32 }} />
        <button type="button" className="btn btn-ghost" style={ghostBtn} onClick={() => { setName(''); setNaming('add'); }}><IconPlus size={13} sw={2.2} />{tx('tm.newProject')}</button>
        {project !== SHARED && <button type="button" className="btn btn-ghost" style={ghostBtn} onClick={() => { setName(project); setNaming('rename'); }}><IconPenEdit size={13} />{tx('tm.renameProject')}</button>}
        {project !== SHARED && <button type="button" className="btn btn-ghost" style={{ ...ghostBtn, color: 'var(--errtx)' }} onClick={() => setAskDel('project')}><IconTrash size={13} />{tx('tm.deleteProject')}</button>}
        <button type="button" className="btn btn-ghost" style={ghostBtn} onClick={() => { void deletedRows().then(setDeleted); }}>{tx('tm.deletedList')}</button>
      </div>
      {naming && (
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="field" autoFocus aria-label={tx('tm.projectName')} placeholder={tx('tm.projectName')} value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') doName(); if (e.key === 'Escape') setNaming(null); }} style={{ flexGrow: 1 }} />
          <button type="button" className="btn btn-primary" style={{ ...primaryBtn, height: 36 }} onClick={doName}>{tx('tm.ok')}</button>
        </div>
      )}
      {deleted && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, border: '1px solid var(--line2)', borderRadius: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={smallText}>{tx('tm.deletedHint')}</span>
            <button type="button" className="ib" style={iconBtn} aria-label={tx('manage.001')} onClick={() => setDeleted(null)}><IconWinClose size={11} sw={1.4} /></button>
          </div>
          {deleted.length === 0 && <span style={smallText}>{tx('tm.noDeleted')}</span>}
          {deleted.map((d) => (
            <div key={d.row.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: fz(12) }}>
              <span style={{ flexGrow: 1, minWidth: 0 }}><span style={smallText}>{when(d.at)} · {d.row.project}</span><div>{d.row.src}</div><div style={{ color: 'var(--accent3)' }}>{d.row.tgt}</div></span>
              <button type="button" className="btn btn-ghost" style={{ ...ghostBtn, height: 26 }} onClick={() => { restoreRow(d.row); setDeleted(deleted.filter((x) => x !== d)); }}>{tx('tm.restore')}</button>
            </div>
          ))}
        </div>
      )}
      <input type="search" className="field" aria-label={tx('tm.search')} value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder={tx('tm.search')} />
      <FilterBar f={f} set={setF} projects={all} people={people} hideProject />
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ ...smallText, flexGrow: 1 }}>{tx('tm.count', { n: list.length })}{picked.size ? ' · ' + tx('tm.picked', { n: picked.size }) : ''}</span>
        <button type="button" className="btn btn-ghost" style={{ ...ghostBtn, height: 28 }} onClick={() => setAdding({ src: '', tgt: '' })}><IconPlus size={12} sw={2.2} />{tx('tm.addRow')}</button>
        {picked.size > 0 && (
          <>
            <Select ariaLabel={tx('tm.moveTo')} value="" options={[{ value: '', label: tx('tm.moveTo') }, ...all.filter((x) => x !== project).map((x) => ({ value: x, label: x }))]}
              onChange={(v) => { if (v) { moveRows([...picked], v); setPicked(new Set()); } }} style={{ width: 160, height: 28 }} />
            <button type="button" className="btn btn-ghost" style={{ ...ghostBtn, height: 28, color: 'var(--errtx)' }} onClick={() => setAskDel('rows')}><IconTrash size={12} />{tx('tm.delete')}</button>
          </>
        )}
      </div>
      {adding && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <textarea className="field" aria-label={tx('tm.src')} placeholder={tx('tm.src')} value={adding.src} onChange={(e) => setAdding({ ...adding, src: e.target.value })} rows={2} style={{ height: 'auto', padding: 8 }} />
          <textarea className="field" aria-label={tx('tm.tgt')} placeholder={tx('tm.tgt')} value={adding.tgt} onChange={(e) => setAdding({ ...adding, tgt: e.target.value })} rows={2} style={{ height: 'auto', padding: 8 }} />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" style={ghostBtn} onClick={() => setAdding(null)}>{tx('manage.007')}</button>
            <button type="button" className="btn btn-primary" style={{ ...primaryBtn, height: 32 }} disabled={!adding.src.trim() || !adding.tgt.trim()}
              onClick={() => { addRow({ project, src: adding.src, tgt: adding.tgt, verified: false, fid: '', file: '', sheet: '', eid: '', speaker: '' }); setAdding(null); }}>{tx('tm.ok')}</button>
          </div>
        </div>
      )}
      <RowList rows={list} empty={tx('tm.empty')} select={{ on: picked, toggle }} />
      {askDel && (
        <ConfirmDialog zIndex={60} title={askDel === 'project' ? tx('tm.deleteProjectAsk', { p: project }) : tx('tm.deleteRowsAsk', { n: picked.size })}
          choices={[
            { label: tx('manage.007'), onClick: () => setAskDel(null) },
            { label: tx('tm.delete'), danger: true, onClick: () => {
              if (askDel === 'project') { deleteProjectMemory(project); setP(SHARED); } else { deleteRows([...picked]); setPicked(new Set()); }
              setAskDel(null);
            } },
          ]} />
      )}
    </Shell>
  );
}

type ImportFrom = 'file' | 'db' | 'tmx';

/** 選一個檔案（桌面版用系統的對話框；瀏覽器預覽只能讀 TMX） */
async function pickPath(ext: string[]): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const r = await open({ multiple: false, filters: [{ name: ext.join(', '), extensions: ext }] });
  return typeof r === 'string' ? r : null;
}

/** 匯入：Verso 裡的檔案、SQLite 記憶檔、TMX；選要放進哪個專案記憶 */
function ImportDialog() {
  const files = useStore((s) => s.project?.files ?? []);
  const current = useStore((s) => currentProjectOf(s));
  useTm((t) => t.extra);
  const all = tmProjectList();
  const [from, setFrom] = useState<ImportFrom>('file');
  const usable = files.map((f, i) => ({ f, i })).filter(({ f }) => !f.cloud?.stub);
  const [fi, setFi] = useState(String(usable[0]?.i ?? ''));
  const [project, setProject] = useState(current);
  const [picked, setPicked] = useState<{ name: string; rows: Omit<TmRow, 'id' | 'project'>[] } | null>(null);
  const fileDoc = files[Number(fi)];
  useEffect(() => { if (from === 'file' && fileDoc) setProject(fileDoc.project); }, [fi, from]);
  useEffect(() => { setPicked(null); }, [from]);
  const choose = async () => {
    try {
      if (isTauri()) {
        const p = await pickPath(from === 'db' ? ['sqlite', 'db'] : ['tmx', 'xml']);
        if (!p) return;
        const rows = from === 'db' ? await readTmDb(p) : parseTmx(await io.readText(p));
        setPicked({ name: p.split(/[\\/]/).pop() ?? p, rows });
      } else {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.tmx,.xml';
        input.onchange = () => { const file = input.files?.[0]; if (file) void file.text().then((t) => setPicked({ name: file.name, rows: parseTmx(t) })); };
        input.click();
      }
    } catch (e) { showToast(tx('tm.importFailed', { reason: String(e) }), { warn: true }); }
  };
  const run = () => {
    const rows = from === 'file' ? (fileDoc ? rowsFromFile(fileDoc, (e) => effectiveMark(e) === 'verified') : []) : picked?.rows ?? [];
    const n = importRows(rows, project);
    showToast(tx('tm.imported', { n }));
    close();
  };
  const ready = from === 'file' ? !!fileDoc : !!picked;
  return (
    <Shell title={tx('tm.import')} onClose={close} width={480}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: fz(12.5) }}>{tx('tm.importFrom')}
        <Select ariaLabel={tx('tm.importFrom')} value={from} onChange={(v) => setFrom(v as ImportFrom)} style={{ height: 34 }}
          options={[{ value: 'file', label: tx('tm.fromFile') }, ...(isTauri() ? [{ value: 'db', label: tx('tm.fromDb') }] : []), { value: 'tmx', label: tx('tm.fromTmx') }]} />
      </label>
      {from === 'file' ? (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: fz(12.5) }}>{tx('tm.file')}
          <Select ariaLabel={tx('tm.file')} value={fi} onChange={setFi} style={{ height: 34 }}
            options={usable.map(({ f, i }) => ({ value: String(i), label: `${f.project} / ${f.name}` }))} />
        </label>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button type="button" className="btn btn-ghost" style={ghostBtn} onClick={() => { void choose(); }}>{tx('tm.chooseFile')}</button>
          <span style={{ ...smallText, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{picked ? tx('tm.pickedFile', { name: picked.name, n: picked.rows.length }) : ''}</span>
        </div>
      )}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: fz(12.5) }}>{tx('tm.into')}
        <Select ariaLabel={tx('tm.into')} value={all.includes(project) ? project : SHARED} onChange={setProject} style={{ height: 34 }} options={all.map((p) => ({ value: p, label: p }))} />
      </label>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 'auto' }}>
        <button type="button" className="btn btn-ghost" style={{ ...ghostBtn, height: 36 }} onClick={close}>{tx('manage.007')}</button>
        <button type="button" className="btn btn-primary" style={primaryBtn} disabled={!ready} onClick={run}>{tx('tm.import')}</button>
      </div>
    </Shell>
  );
}

/** 匯出：選專案記憶，存成 SQLite 或 TMX */
function ExportDialog() {
  const rows = useTm((t) => t.rows);
  useTm((t) => t.extra);
  const all = tmProjectList();
  const [on, setOn] = useState<Set<string>>(new Set(all));
  const [fmt, setFmt] = useState<'tmx' | 'db'>('tmx');
  const pick = [...rows.values()].filter((r) => on.has(r.project));
  const run = async () => {
    try {
      const name = (fmt === 'db' ? '翻譯記憶' : 'Verso') + (fmt === 'db' ? '.sqlite' : '.tmx');
      if (isTauri()) {
        const { save } = await import('@tauri-apps/plugin-dialog');
        const p = await save({ defaultPath: name, filters: [{ name: fmt === 'db' ? 'SQLite' : 'TMX', extensions: [fmt === 'db' ? 'sqlite' : 'tmx'] }] });
        if (!p) return;
        if (fmt === 'db') await exportTmDb(p, pick); else await io.writeText(p, toTmx(pick));
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([toTmx(pick)], { type: 'application/xml' }));
        a.download = 'Verso.tmx';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }
      showToast(tx('tm.exported', { n: pick.length }));
      close();
    } catch (e) { showToast(tx('tm.exportFailed', { reason: String(e) }), { warn: true }); }
  };
  return (
    <Shell title={tx('tm.export')} onClose={close} width={480}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: fz(12.5) }}>{tx('tm.format')}
        <Select ariaLabel={tx('tm.format')} value={fmt} onChange={(v) => setFmt(v as 'tmx' | 'db')} style={{ height: 34 }}
          options={[{ value: 'tmx', label: 'TMX' }, ...(isTauri() ? [{ value: 'db', label: 'SQLite' }] : [])]} />
      </label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {all.map((p) => (
          <label key={p} className="dd" style={{ height: 30, display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px', borderRadius: 6, cursor: 'pointer', fontSize: fz(12.5) }}>
            <input type="checkbox" checked={on.has(p)} onChange={() => setOn((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; })} />
            <span style={{ flexGrow: 1 }}>{p}</span>
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 'auto', alignItems: 'center' }}>
        <span style={{ ...smallText, marginRight: 'auto' }}>{tx('tm.count', { n: pick.length })}</span>
        <button type="button" className="btn btn-ghost" style={{ ...ghostBtn, height: 36 }} onClick={close}>{tx('manage.007')}</button>
        <button type="button" className="btn btn-primary" style={primaryBtn} disabled={!pick.length} onClick={() => { void run(); }}>{tx('tm.export')}</button>
      </div>
    </Shell>
  );
}

/** 一致性清單：同一個原文有不同譯文的記憶（只看勾選的專案） */
function ConsistencyDialog() {
  const rows = useTm((t) => t.rows);
  const current = useStore((s) => currentProjectOf(s));
  const overrides = useStore((s) => s.tmOverrides);
  const groups = useMemo(() => {
    const on = tmProjectsOn(current, overrides, tmProjectList());
    return inconsistent([...rows.values()].filter((r) => on.has(r.project)));
  }, [rows, current, overrides]);
  return (
    <Shell title={tx('tm.consistency')} onClose={close} width={640}>
      <div style={smallText}>{tx('tm.consistencyCount', { n: groups.length })}</div>
      {groups.length === 0 && <div className="empty" style={{ padding: '20px 12px' }}>{tx('tm.consistent')}</div>}
      {groups.slice(0, 300).map((g) => (
        <div key={g.src} style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 10, borderBottom: '1px solid var(--line)' }}>
          <div style={{ fontSize: fz(13.5), fontWeight: 500 }}>{g.src}</div>
          {g.rows.map((r) => <TmCard key={r.id} row={r} />)}
        </div>
      ))}
    </Shell>
  );
}

/** 記憶的對話框（放在畫面最上層） */
export function TmDialogs() {
  const d = useTm((t) => t.dialog);
  if (d === 'manage') return <ManageDialog />;
  if (d === 'import') return <ImportDialog />;
  if (d === 'export') return <ExportDialog />;
  if (d === 'consistency') return <ConsistencyDialog />;
  return null;
}
