// 雲端模式的專案管理：新增、改名、刪除（沒有檔案的）專案，設定字典檔網址和預設長度標準，把 Google 表移到別的專案。
// 都記在 Verso 資料表，同一張資料表的人共用
import { useState } from 'react';
import { tx } from '../../i18n';
import { fz } from '../../model/fonts';
import { SHARED } from '../../model/types';
import { type StdValue } from '../../model/length';
import { nameError } from '../../components/Pickers';
import { NEW } from '../../components/Pickers';
import { Select } from '../../components/Select';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { dragWindow } from '../../components/windowDrag';
import { IconWinClose } from '../../components/icons';
import { showToast, useStore } from '../../state/store';
import { allSheets, useCloud } from './config';
import { errText, sidOf } from './api';
import { deleteProjectRow, ensureProjects, renameInStore, writeProject, type CloudProject } from './projects';
import { saveSheetMeta } from './sync';
import { listDicts, loadEnabled } from './dicts';

const btn: React.CSSProperties = { height: 30, padding: '0 12px', background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 7, fontSize: fz(12.5) };
const label: React.CSSProperties = { fontSize: fz(12), color: 'var(--text2)' };

export function ProjectsDialog() {
  useCloud((s) => s.projects);
  useCloud((s) => s.shared);
  useCloud((s) => s.cfg);
  const presets = useStore((s) => s.lengthPresets);
  const files = useStore((s) => s.project?.files);
  const close = () => useCloud.setState({ projectsOpen: false });
  const [adding, setAdding] = useState('');
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);
  const [askDelete, setAskDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sheets = allSheets();
  const cloud = useCloud.getState().projects;
  // 資料表裡的專案、Google 表用到的專案、共用
  const names = [...new Set([...cloud.map((p) => p.name), ...sheets.map((x) => x.project || SHARED), SHARED])];
  const projOf = (n: string): CloudProject => cloud.find((p) => p.name === n) ?? { name: n, dictUrl: '' };
  const filesOf = (n: string) => sheets.filter((x) => (x.project || SHARED) === n);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { showToast(tx('cloud.writeFailed', { name: tx('cloud.dataUrl'), reason: errText(e) }), { warn: true }); }
    setBusy(false);
  };
  const save = (p: CloudProject) => run(async () => {
    await writeProject(p);
    // 字典檔換了：重新列出雲端字典
    await listDicts();
    loadEnabled();
  });
  const add = () => {
    const n = adding.trim();
    if (!n || nameError('project', NEW, n, names)) return;
    setAdding('');
    void run(async () => { await writeProject({ name: n, dictUrl: '' }); ensureProjects([n]); });
  };
  const rename = () => {
    if (!renaming) return;
    const { from, to } = renaming;
    const n = to.trim();
    setRenaming(null);
    if (!n || n === from || nameError('project', NEW, n, names.filter((x) => x !== from))) return;
    void run(async () => {
      await writeProject({ ...projOf(from), name: n }, from);
      renameInStore(from, n);
      for (const x of filesOf(from)) {
        const f = useStore.getState().project?.files.find((y) => y.cloud?.sid === x.sid);
        await saveSheetMeta(x.sid, { ...(f ?? { name: x.title, sheets: [] }), project: n, lengthStd: f?.lengthStd ?? x.lengthStd });
      }
    });
  };
  const move = (sid: string, to: string) => {
    const p = useStore.getState().project;
    const f = p?.files.find((y) => y.cloud?.sid === sid);
    const x = sheets.find((y) => y.sid === sid);
    if (!p || !x) return;
    ensureProjects([to]);
    if (f) { const q = useStore.getState().project!; useStore.setState({ project: { ...q, files: q.files.map((y) => (y === f ? { ...y, project: to } : y)) } }); }
    void run(() => saveSheetMeta(sid, { ...(f ?? { name: x.title, sheets: [] }), project: to, lengthStd: f?.lengthStd ?? x.lengthStd }));
  };
  const stdKey = (v?: StdValue) => (v === undefined ? '' : v === 'none' ? 'none' : presets.find((x) => JSON.stringify(x.std) === JSON.stringify(v))?.name ?? '__cur__');
  const stdFrom = (k: string, cur?: StdValue): StdValue | undefined => (k === '' ? undefined : k === 'none' ? 'none' : k === '__cur__' ? cur : presets.find((x) => x.name === k)?.std);
  void files;

  return (
    <div className="scrim" style={{ zIndex: 45 }} onMouseDown={dragWindow}>
      <div role="dialog" aria-modal="true" aria-labelledby="verso-cloud-proj" className="dialog"
        style={{ width: 760, maxWidth: 'calc(100% - 48px)', maxHeight: 'calc(100% - 48px)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>
        <div style={{ height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px 0 20px', borderBottom: '1px solid var(--line)' }}>
          <h2 id="verso-cloud-proj" style={{ margin: 0, fontSize: fz(15), fontWeight: 600 }}>{tx('cloud.projects')}</h2>
          <button type="button" className="ib" aria-label={tx('cloud.close')} onClick={close}
            style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 0, borderRadius: 8, color: 'var(--text2)' }}>
            <IconWinClose size={13} sw={1.4} />
          </button>
        </div>
        <div style={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', padding: '14px 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {!sidOf(useCloud.getState().cfg.dataUrl ?? '') && <div role="alert" style={{ fontSize: fz(12.5), color: 'var(--errtx)' }}>{tx('cloud.needData')}</div>}
          {names.map((n) => {
            const p = projOf(n);
            const fs = filesOf(n);
            const k = stdKey(p.std);
            return (
              <section key={n} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, border: '1px solid var(--line2)', borderRadius: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {renaming?.from === n ? (
                    <input className="field" autoFocus value={renaming.to} onChange={(e) => setRenaming({ from: n, to: e.target.value })}
                      onKeyDown={(e) => { if (e.key === 'Enter') rename(); if (e.key === 'Escape') setRenaming(null); }} onBlur={rename} style={{ width: 220 }} />
                  ) : <span style={{ fontSize: fz(14), fontWeight: 600, flexGrow: 1 }}>{n}</span>}
                  {n !== SHARED && !renaming && <button type="button" className="btn btn-ghost" style={btn} disabled={busy} onClick={() => setRenaming({ from: n, to: n })}>{tx('cloud.renameProject')}</button>}
                  {n !== SHARED && <button type="button" className="btn btn-ghost" style={btn} disabled={busy || fs.length > 0} title={fs.length ? tx('cloud.projectHasFiles') : undefined} onClick={() => setAskDelete(n)}>{tx('cloud.deleteProject')}</button>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '110px minmax(0, 1fr)', alignItems: 'center', gap: '8px 12px' }}>
                  <label htmlFor={'verso-pd-' + n} style={label}>{tx('cloud.dictFile')}</label>
                  <input id={'verso-pd-' + n} className="field" defaultValue={p.dictUrl} placeholder="https://docs.google.com/spreadsheets/d/…"
                    onBlur={(e) => { if (e.target.value.trim() !== p.dictUrl) void save({ ...p, dictUrl: e.target.value.trim() }); }} />
                  <span style={label}>{tx('cloud.projectStd')}</span>
                  <Select value={k} style={{ width: 240 }} onChange={(v) => void save({ ...p, std: stdFrom(v, p.std) })}
                    options={[{ value: '', label: tx('projset.stdUnset') }, { value: 'none', label: tx('projset.stdNone') }, ...presets.map((x) => ({ value: x.name, label: x.name })), ...(k === '__cur__' ? [{ value: '__cur__', label: tx('cloud.stdCustom') }] : [])]} />
                  <span style={label}>{tx('cloud.projectFiles')}</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {!fs.length && <span style={{ fontSize: fz(12), color: 'var(--mute)' }}>{tx('cloud.noFiles')}</span>}
                    {fs.map((x) => (
                      <div key={x.sid} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ flexGrow: 1, minWidth: 0, fontSize: fz(12.5), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.title || x.sid}</span>
                        <Select value={n} style={{ width: 160 }} ariaLabel={tx('cloud.moveTo')} options={names.map((y) => ({ value: y, label: y }))} onChange={(to) => { if (to !== n) move(x.sid, to); }} />
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            );
          })}
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="field" value={adding} placeholder={tx('cloud.newProject')} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} style={{ width: 240 }} />
            <button type="button" className="btn btn-ghost" style={btn} disabled={busy || !adding.trim() || !!nameError('project', NEW, adding.trim(), names)} onClick={add}>{tx('cloud.addProject')}</button>
            <span role="alert" style={{ fontSize: fz(12), color: 'var(--errtx)', alignSelf: 'center' }}>{adding.trim() ? nameError('project', NEW, adding.trim(), names) : ''}</span>
          </div>
        </div>
      </div>
      {askDelete && (
        <ConfirmDialog zIndex={60} title={tx('cloud.deleteProjectAsk', { name: askDelete })} body={tx('cloud.deleteProjectBody')}
          choices={[{ label: tx('cloud.cancel'), onClick: () => setAskDelete(null) }, { label: tx('cloud.deleteProject'), primary: true, onClick: () => {
            const n = askDelete; setAskDelete(null);
            void run(async () => {
              await deleteProjectRow(n);
              const s = useStore.getState();
              if (s.cloudProjects.includes(n) && s.project) useStore.setState({ cloudProjects: s.cloudProjects.filter((x) => x !== n), project: { ...s.project, projects: s.project.projects.filter((x) => x !== n) } });
            });
          } }]} />
      )}
    </div>
  );
}
