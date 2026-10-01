import { useEffect, useState } from 'react';
import { useStore, type MoveTarget } from '../state/store';
import { saveNow } from '../state/saver';
import { SHARED } from '../model/types';
import { fitsRows, spreadColumns, type Col } from '../model/paste';
import { fz } from '../model/fonts';
import { ConfirmDialog } from './ConfirmDialog';
import { ContextMenu } from './ContextMenu';
import { PasteBox } from './PasteBox';
import { NEW, ProjectPicker, nameError, picked } from './Pickers';
import { dragWindow, focusOnMount } from './windowDrag';
import { handleUndoKeys, useUndoable } from './useUndo';
import { IconChevD, IconFile, IconFolder, IconBook, IconPlus, IconTrash, IconWinClose } from './icons';

const closeBtn: React.CSSProperties = {
  width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 0, borderRadius: 8, color: 'var(--text2)',
};
const ghostBtn: React.CSSProperties = {
  height: 32, display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px', background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, fontSize: fz(12.5),
};
const primaryBtn: React.CSSProperties = {
  height: 36, padding: '0 18px', background: 'var(--primary)', border: 0, borderRadius: 8, color: '#ffffff', fontSize: fz(13), fontWeight: 600,
};
const actBtn: React.CSSProperties = {
  width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'transparent', border: 0, borderRadius: 6, color: 'var(--mute)',
};

/** 結構的變動（新增、刪除、搬移）馬上存檔，硬碟上的檔案跟著變 */
const commit = () => { void saveNow(); };

function Header({ id, title, onClose }: { id: string; title: string; onClose(): void }) {
  return (
    <div style={{ height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px 0 20px', borderBottom: '1px solid var(--line)' }}>
      <h2 id={id} style={{ margin: 0, fontSize: fz(15), fontWeight: 600 }}>{title}</h2>
      <button type="button" className="ib" aria-label="關閉" onClick={onClose} style={closeBtn}><IconWinClose size={13} sw={1.4} /></button>
    </div>
  );
}

/** 樹狀清單的一列：左邊縮排、圖示、名稱，右邊滑過才出現的操作鈕 */
function TreeRow({ depth, icon, label, extra, selected, open, onToggle, onClick, onMenu, actions }: {
  depth: number; icon?: React.ReactNode; label: string; extra?: string; selected?: boolean;
  open?: boolean; onToggle?(): void; onClick?(): void; onMenu?(ev: React.MouseEvent): void; actions?: React.ReactNode;
}) {
  return (
    <div className="tree-row dd" onContextMenu={onMenu ? (ev) => { ev.preventDefault(); onMenu(ev); } : undefined}
      style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 32, padding: `0 6px 0 ${6 + depth * 20}px`, borderRadius: 6, background: selected ? 'var(--sel)' : 'transparent' }}>
      {onToggle
        ? <button type="button" className="ib" aria-expanded={open} aria-label={(open ? '收起' : '展開') + label} onClick={onToggle} style={{ ...actBtn, width: 20, height: 20 }}>
            <IconChevD size={11} sw={2.4} style={{ transform: `rotate(${open ? 0 : -90}deg)`, transition: 'transform 160ms' }} />
          </button>
        : <span style={{ width: 20, flexShrink: 0 }} />}
      {icon}
      <button type="button" onClick={onClick ?? onToggle}
        style={{ flexGrow: 1, minWidth: 0, height: 30, display: 'flex', alignItems: 'center', gap: 8, padding: 0, background: 'transparent', border: 0, color: 'var(--text)', textAlign: 'left', cursor: 'pointer' }}>
        <span style={{ minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontSize: fz(13) }}>{label}</span>
        {extra && <span style={{ flexShrink: 0, fontSize: fz(11.5), color: 'var(--mute)' }}>{extra}</span>}
      </button>
      <span className="tree-act" style={{ display: 'flex', gap: 2, flexShrink: 0 }}>{actions}</span>
    </div>
  );
}

/** 新增專案、新字典的名稱輸入列 */
function NameInput({ placeholder, error, onDone }: { placeholder: string; error(name: string): string; onDone(name: string | null): void }) {
  const [v, setV] = useState('');
  const err = error(v);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '4px 6px' }}>
      <input className="field" ref={focusOnMount} value={v} placeholder={placeholder} aria-label={placeholder}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && v.trim() && !err) onDone(v.trim());
          if (e.key === 'Escape') { e.stopPropagation(); onDone(null); }
        }}
        onBlur={() => onDone(v.trim() && !err ? v.trim() : null)}
        style={{ height: 32 }} />
      {err && <span role="alert" style={{ fontSize: fz(12), color: 'var(--errtx)' }}>{err}</span>}
    </div>
  );
}

// ---- 更改專案 ----

/** 把檔案或字典移到別的專案 */
export function MoveProjectDialog() {
  const target = useStore((s) => s.moveTarget);
  return target ? <MoveForm target={target} /> : null;
}

function MoveForm({ target }: { target: MoveTarget }) {
  const project = useStore((s) => s.project)!;
  const { set, moveFile, moveDict } = useStore.getState();
  const from = target.kind === 'file' ? project.files[target.index]?.project ?? SHARED : target.project;
  const name = target.kind === 'file' ? project.files[target.index]?.name ?? '' : target.name;
  const [sel, setSel] = useState(from);
  const [newName, setNewName] = useState('');
  const to = picked(sel, newName);
  const err = nameError('專案', sel, newName, project.projects);
  const close = () => set({ moveTarget: null });
  const ok = () => {
    if (!to || err) return;
    if (to !== from) {
      if (target.kind === 'file') moveFile(target.index, to); else moveDict(target.project, target.name, to);
      commit();
    }
    close();
  };
  return (
    <div className="scrim" style={{ zIndex: 55 }} onMouseDown={dragWindow}>
      <div role="dialog" aria-modal="true" aria-labelledby="verso-move-title" className="dialog" style={{ width: 400, boxShadow: '0 24px 64px rgba(0,0,0,0.45)' }}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') ok(); }}>
        <Header id="verso-move-title" title={`更改專案：${name}`} onClose={close} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '18px 20px' }}>
          <label htmlFor="verso-move-proj" style={{ fontSize: fz(12), color: 'var(--text2)' }}>專案</label>
          <ProjectPicker id="verso-move-proj" stack sel={sel} newName={newName} onSel={setSel} onNewName={setNewName} />
          {err && <span role="alert" style={{ fontSize: fz(12.5), color: 'var(--errtx)' }}>{err}</span>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 20px 16px', borderTop: '1px solid var(--line)' }}>
          <button type="button" className="btn btn-ghost" onClick={close} style={{ ...ghostBtn, height: 36, padding: '0 16px', fontSize: fz(13) }}>取消</button>
          <button type="button" className="btn btn-primary" disabled={!to || !!err} onClick={ok} style={primaryBtn}>確定</button>
        </div>
      </div>
    </div>
  );
}

// ---- 刪除確認 ----

type Pending =
  | { kind: 'project'; name: string }
  | { kind: 'file'; index: number }
  | { kind: 'dict'; project: string; name: string };

function DeleteConfirm({ pending, onDone }: { pending: Pending; onDone(): void }) {
  const project = useStore((s) => s.project)!;
  const { deleteProject, deleteFile, deleteDict } = useStore.getState();
  const run = (fn: () => void) => { fn(); commit(); onDone(); };
  const cancel = { label: '取消', onClick: onDone };
  if (pending.kind === 'file') {
    const f = project.files[pending.index];
    return <ConfirmDialog zIndex={58} title={`刪除檔案「${f?.name ?? ''}」？`} body="檔案會移到資源回收筒。"
      choices={[cancel, { label: '刪除', primary: true, onClick: () => run(() => deleteFile(pending.index)) }]} />;
  }
  if (pending.kind === 'dict') {
    return <ConfirmDialog zIndex={58} title={`刪除字典「${pending.name}」？`} body="字典會移到資源回收筒。"
      choices={[cancel, { label: '刪除', primary: true, onClick: () => run(() => deleteDict(pending.project, pending.name)) }]} />;
  }
  const files = project.files.filter((f) => f.project === pending.name).length;
  const dicts = project.dicts.filter((d) => d.project === pending.name).length;
  const parts = [files && `${files} 個檔案`, dicts && `${dicts} 本字典`].filter(Boolean).join('、');
  if (!dicts) {
    return <ConfirmDialog zIndex={58} title={`刪除專案「${pending.name}」？`} body={parts ? `專案裡的 ${parts}會移到資源回收筒。` : undefined}
      choices={[cancel, { label: '刪除', primary: true, onClick: () => run(() => deleteProject(pending.name, false)) }]} />;
  }
  return <ConfirmDialog zIndex={58} title={`刪除專案「${pending.name}」？`}
    body={`專案裡有 ${parts}。檔案會移到資源回收筒，字典要一起刪除，還是移到共用？`}
    choices={[
      cancel,
      { label: '一起刪除', danger: true, onClick: () => run(() => deleteProject(pending.name, false)) },
      { label: '移到共用', primary: true, onClick: () => run(() => deleteProject(pending.name, true)) },
    ]} />;
}

// ---- 管理專案 ----

export function ManageProjectsDialog() {
  const open = useStore((s) => s.manageProjectsOpen);
  return open ? <ManageProjects /> : null;
}

function ManageProjects() {
  const project = useStore((s) => s.project)!;
  const { set, addProject } = useStore.getState();
  const [closed, setClosed] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; target: Pending } | null>(null);
  const close = () => set({ manageProjectsOpen: false });
  const toggle = (p: string) => setClosed(closed.includes(p) ? closed.filter((x) => x !== p) : [...closed, p]);

  const fileActions = (i: number) => <>
    <button type="button" className="ib" title="更改專案" aria-label="更改專案" style={actBtn} onClick={() => set({ moveTarget: { kind: 'file', index: i } })}><IconFolder size={13} /></button>
    <button type="button" className="ib" title="刪除" aria-label="刪除檔案" style={actBtn} onClick={() => setPending({ kind: 'file', index: i })}><IconTrash size={13} /></button>
  </>;

  return (
    <div className="scrim" style={{ zIndex: 45 }} onMouseDown={dragWindow}>
      <div role="dialog" aria-modal="true" aria-labelledby="verso-mp-title" className="dialog"
        style={{ width: 520, height: 560, maxWidth: 'calc(100% - 48px)', maxHeight: 'calc(100% - 48px)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>
        <Header id="verso-mp-title" title="管理專案" onClose={close} />
        <div style={{ display: 'flex', padding: '12px 20px 4px' }}>
          <button type="button" className="btn btn-ghost" onClick={() => setAdding(true)} style={ghostBtn}><IconPlus size={13} sw={2.2} />新增專案</button>
        </div>
        <div style={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', padding: '6px 14px 14px' }}>
          {adding && <NameInput placeholder="專案名稱" error={(v) => nameError('專案', NEW, v, project.projects)}
            onDone={(n) => { setAdding(false); if (n) { addProject(n); commit(); } }} />}
          {project.projects.map((p) => {
            const isOpen = !closed.includes(p);
            const files = project.files.map((f, i) => ({ f, i })).filter((x) => x.f.project === p);
            return (
              <div key={p}>
                <TreeRow depth={0} label={p} extra={files.length ? `${files.length} 個檔案` : ''} open={isOpen} onToggle={() => toggle(p)}
                  icon={<IconFolder size={14} stroke="var(--mute)" />}
                  onMenu={p === SHARED ? undefined : (ev) => setMenu({ x: ev.clientX, y: ev.clientY, target: { kind: 'project', name: p } })}
                  actions={p !== SHARED && <button type="button" className="ib" title="刪除" aria-label={'刪除專案' + p} style={actBtn} onClick={() => setPending({ kind: 'project', name: p })}><IconTrash size={13} /></button>} />
                {isOpen && files.map(({ f, i }) => (
                  <TreeRow key={i} depth={1} label={f.name} icon={<IconFile size={13} stroke="var(--mute)" />}
                    onMenu={(ev) => setMenu({ x: ev.clientX, y: ev.clientY, target: { kind: 'file', index: i } })}
                    actions={fileActions(i)} />
                ))}
              </div>
            );
          })}
        </div>
      </div>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} label="專案操作"
          items={menu.target.kind === 'file'
            ? [{ key: 'move', label: '更改專案' }, { key: 'delete', label: '刪除', danger: true }]
            : [{ key: 'delete', label: '刪除', danger: true }]}
          onClose={() => setMenu(null)}
          onPick={(k) => {
            const t = menu.target;
            setMenu(null);
            if (k === 'move' && t.kind === 'file') set({ moveTarget: { kind: 'file', index: t.index } });
            if (k === 'delete') setPending(t);
          }} />
      )}
      {pending && <DeleteConfirm pending={pending} onDone={() => setPending(null)} />}
    </div>
  );
}

// ---- 管理字典 ----

export function ManageDictsDialog() {
  const open = useStore((s) => s.manageDictsOpen);
  return open ? <ManageDicts /> : null;
}

type EditCols = { term: Col | null; en: Col | null; note: Col | null };
const EDIT_KEYS: (keyof EditCols)[] = ['term', 'en', 'note'];
const EDIT_LABELS: Record<keyof EditCols, string> = { term: '原文', en: '譯文', note: '備註' };

function ManageDicts() {
  const project = useStore((s) => s.project)!;
  const { set, addDict, setDictTerms } = useStore.getState();
  const [closed, setClosed] = useState<string[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; project: string; name: string } | null>(null);
  const [cur, setCur] = useState<{ project: string; name: string } | null>(null);
  const [askLeave, setAskLeave] = useState<(() => void) | null>(null);
  const cols = useUndoable<EditCols>({ term: null, en: null, note: null });
  const [selRow, setSelRow] = useState<{ key: string; i: number } | null>(null);
  const toggle = (p: string) => setClosed(closed.includes(p) ? closed.filter((x) => x !== p) : [...closed, p]);

  // 目前字典的詞條轉成三欄
  const load = (c: { project: string; name: string } | null) => {
    const terms = c ? project.glossary.filter((g) => g.proj === c.project && g.dict === c.name) : [];
    const col = (f: (t: (typeof terms)[number]) => string): Col | null => (terms.length ? { rows: terms.map(f), extra: 0 } : null);
    return { term: col((t) => t.term), en: col((t) => t.en), note: col((t) => t.note) };
  };
  const [base, setBase] = useState<EditCols>(() => load(null));
  const same = (a: Col | null, b: Col | null) => JSON.stringify(a?.rows ?? []) === JSON.stringify(b?.rows ?? []);
  const dirty = !!cur && EDIT_KEYS.some((k) => !same(cols.value[k], base[k]));
  // 字典被刪掉或搬走時取消選取
  const exists = !!cur && project.dicts.some((d) => d.project === cur.project && d.name === cur.name);
  useEffect(() => { if (cur && !exists) { setCur(null); cols.reset(load(null)); setBase(load(null)); } }, [exists]);

  const guard = (fn: () => void) => { if (dirty) setAskLeave(() => fn); else fn(); };
  const open = (c: { project: string; name: string }) => guard(() => {
    const v = load(c);
    setCur(c); setBase(v); cols.reset(v); setSelRow(null);
  });
  const close = () => guard(() => set({ manageDictsOpen: false }));

  const { term, en, note } = cols.value;
  const n = term?.rows.length ?? 0;
  let error = '';
  if (en && !fitsRows(en, n)) error = `原文 ${n} 行、譯文 ${en.rows.length} 行，行數不一致`;
  else if (note && note.rows.length > n) error = `備註比原文多了 ${note.rows.length - n} 行`;
  const save = () => {
    if (!cur || error) return;
    const rows = (term?.rows ?? []).map((t, i) => ({ term: t.trim(), en: (en?.rows[i] ?? '').trim(), note: (note?.rows[i] ?? '').trim() }))
      .filter((r) => r.term && r.en);
    setDictTerms(cur.project, cur.name, rows);
    commit();
    const v = { term: rows.length ? { rows: rows.map((r) => r.term), extra: 0 } : null, en: rows.length ? { rows: rows.map((r) => r.en), extra: 0 } : null, note: rows.length ? { rows: rows.map((r) => r.note), extra: 0 } : null };
    setBase(v); cols.reset(v);
  };
  const spread = (from: keyof EditCols, values: string[][]) => cols.commit({ ...cols.current.current, ...spreadColumns(EDIT_KEYS, from, values) });

  return (
    <div className="scrim" style={{ zIndex: 45 }} onMouseDown={dragWindow}
      onKeyDown={(ev) => handleUndoKeys(ev, () => { if (cols.undo()) setSelRow(null); }, () => { if (cols.redo()) setSelRow(null); })}>
      <div role="dialog" aria-modal="true" aria-labelledby="verso-md-title" className="dialog"
        style={{ width: 960, height: 640, maxWidth: 'calc(100% - 48px)', maxHeight: 'calc(100% - 48px)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>
        <Header id="verso-md-title" title="管理字典" onClose={close} />
        <div style={{ flexGrow: 1, minHeight: 0, display: 'flex' }}>
          <div style={{ width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--line)' }}>
            <div style={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', padding: '10px 10px 14px' }}>
              {project.projects.map((p) => {
                const isOpen = !closed.includes(p);
                const dicts = project.dicts.filter((d) => d.project === p);
                return (
                  <div key={p}>
                    <TreeRow depth={0} label={p} open={isOpen} onToggle={() => toggle(p)} icon={<IconFolder size={14} stroke="var(--mute)" />}
                      actions={<button type="button" className="ib" title="新字典" aria-label={'在' + p + '新增字典'} style={actBtn}
                        onClick={() => { setAdding(p); setClosed(closed.filter((x) => x !== p)); }}><IconPlus size={13} sw={2.2} /></button>} />
                    {isOpen && <>
                      {adding === p && <div style={{ paddingLeft: 26 }}>
                        <NameInput placeholder="字典名稱" error={(v) => nameError('字典', NEW, v, dicts.map((d) => d.name))}
                          onDone={(name) => { setAdding(null); if (name) { addDict(p, name); commit(); open({ project: p, name }); } }} />
                      </div>}
                      {dicts.map((d) => {
                        const count = project.glossary.filter((g) => g.proj === p && g.dict === d.name).length;
                        return (
                          <TreeRow key={d.name} depth={1} label={d.name} extra={String(count)} icon={<IconBook size={13} stroke="var(--mute)" />}
                            selected={cur?.project === p && cur.name === d.name} onClick={() => open({ project: p, name: d.name })}
                            onMenu={(ev) => setMenu({ x: ev.clientX, y: ev.clientY, project: p, name: d.name })}
                            actions={<>
                              <button type="button" className="ib" title="更改專案" aria-label="更改專案" style={actBtn}
                                onClick={() => guard(() => set({ moveTarget: { kind: 'dict', project: p, name: d.name } }))}><IconFolder size={13} /></button>
                              <button type="button" className="ib" title="刪除" aria-label="刪除字典" style={actBtn}
                                onClick={() => setPending({ kind: 'dict', project: p, name: d.name })}><IconTrash size={13} /></button>
                            </>} />
                        );
                      })}
                    </>}
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            {!cur
              ? <div className="empty" style={{ margin: 20, flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>選擇左邊的字典</div>
              : <>
                <div style={{ padding: '14px 20px 0', fontSize: fz(13), color: 'var(--text2)' }}>{cur.project} / <span style={{ color: 'var(--text)', fontWeight: 600 }}>{cur.name}</span></div>
                <div style={{ flexGrow: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, padding: '12px 20px' }}>
                  {EDIT_KEYS.map((k) => (
                    <PasteBox key={cur.project + '/' + cur.name + k} label={EDIT_LABELS[k]} col={cols.value[k]}
                      onChange={(c) => cols.commit({ ...cols.current.current, [k]: c })} onPaste={(v) => spread(k, v)}
                      selected={selRow?.key === k ? selRow.i : null} onSelect={(i) => setSelRow(i === null ? null : { key: k, i })} />
                  ))}
                </div>
                <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 20px 16px', borderTop: '1px solid var(--line)' }}>
                  <span role="alert" style={{ fontSize: fz(12.5), color: error ? 'var(--errtx)' : 'var(--mute)' }}>{error || `${n} 筆`}</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="btn btn-ghost" disabled={!dirty} onClick={() => { cols.reset(base); setSelRow(null); }}
                      style={{ ...ghostBtn, height: 36, padding: '0 16px', fontSize: fz(13), opacity: dirty ? 1 : 0.5 }}>還原</button>
                    <button type="button" className="btn btn-primary" disabled={!dirty || !!error} onClick={save} style={primaryBtn}>儲存</button>
                  </div>
                </div>
              </>}
          </div>
        </div>
      </div>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} label={'字典「' + menu.name + '」'}
          items={[{ key: 'move', label: '更改專案' }, { key: 'delete', label: '刪除', danger: true }]}
          onClose={() => setMenu(null)}
          onPick={(k) => {
            const m = menu;
            setMenu(null);
            if (k === 'move') guard(() => set({ moveTarget: { kind: 'dict', project: m.project, name: m.name } }));
            if (k === 'delete') setPending({ kind: 'dict', project: m.project, name: m.name });
          }} />
      )}
      {pending && <DeleteConfirm pending={pending} onDone={() => setPending(null)} />}
      {askLeave && (
        <ConfirmDialog zIndex={58} title="有未儲存的修改" body="這本字典的修改還沒儲存。"
          choices={[
            { label: '取消', onClick: () => setAskLeave(null) },
            { label: '不儲存', danger: true, onClick: () => { const fn = askLeave; setAskLeave(null); cols.reset(base); fn(); } },
          ]} />
      )}
    </div>
  );
}
