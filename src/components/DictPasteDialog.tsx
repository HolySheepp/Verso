import { useEffect, useState } from 'react';
import { currentProjectOf, useStore } from '../state/store';
import { DictPicker, NEW, ProjectPicker, firstDict, nameError, picked } from './Pickers';
import { PasteBox, type BoxSel } from './PasteBox';
import { dragWindow } from './windowDrag';
import { handleUndoKeys, useUndoable } from './useUndo';
import { fitsRows, pasteColumns, type Col } from '../model/paste';
import { IconWinClose } from './icons';
import { fz } from '../model/fonts';

/** 貼入字典：原文、譯文兩欄，建立新字典或加進現有字典 */
export function DictPasteDialog() {
  const open = useStore((s) => s.dictPasteOpen);
  const dicts = useStore((s) => s.project!.dicts);
  const projects = useStore((s) => s.project!.projects);
  const { set, addTerms } = useStore.getState();
  const [projSel, setProjSel] = useState('');
  const [newProj, setNewProj] = useState('');
  const [target, setTarget] = useState(NEW);
  const [newName, setNewName] = useState('');
  // 原文、譯文兩欄的內容可以復原
  const cols = useUndoable<{ src: Col | null; tgt: Col | null }>({ src: null, tgt: null });
  const { src, tgt } = cols.value;
  const setSrc = (c: Col | null) => cols.commit({ ...cols.current.current, src: c });
  const setTgt = (c: Col | null) => cols.commit({ ...cols.current.current, tgt: c });
  const [selRow, setSelRow] = useState<{ key: string; sel: BoxSel } | null>(null);

  useEffect(() => {
    if (open) {
      const p = currentProjectOf(useStore.getState());
      setProjSel(p); setNewProj(''); setTarget(firstDict(p)); setNewName('');
      cols.reset({ src: null, tgt: null }); setSelRow(null); }
  }, [open]);

  if (!open) return null;

  // 一次貼兩欄到原文時，譯文一起填上
  const spread = (from: 'src' | 'tgt', values: string[][], start?: number) => {
    const out = pasteColumns(['src', 'tgt'], from, values, cols.current.current, start);
    cols.commit({ ...cols.current.current, ...out });
  };

  const projName = picked(projSel, newProj);
  const dictName = picked(target, newName);
  const pickProject = (v: string) => { setProjSel(v); setTarget(v === NEW ? NEW : firstDict(v)); };
  const sn = src?.rows.length ?? 0;
  let error = nameError('專案', projSel, newProj, projects)
    || nameError('字典', target, newName, dicts.filter((d) => d.project === projName).map((d) => d.name));
  if (!error && src && tgt && !fitsRows(tgt, sn)) error = `兩欄行數不一致：原文 ${sn}、譯文 ${tgt.rows.length}`;
  // 原文或譯文空白的行略過
  const pairs: [string, string][] = src && tgt && !error
    ? src.rows.map((s, i): [string, string] => [s.trim(), (tgt.rows[i] ?? '').trim()]).filter(([a, b]) => a && b)
    : [];
  const canSave = !error && !!projName && !!dictName && pairs.length > 0;

  return (
    <div className="scrim" style={{ zIndex: 45 }} onMouseDown={dragWindow}
      onKeyDown={(ev) => handleUndoKeys(ev, () => { if (cols.undo()) setSelRow(null); }, () => { if (cols.redo()) setSelRow(null); })}>
      <div role="dialog" aria-modal="true" aria-labelledby="verso-dict-paste-title" className="dialog"
        style={{ width: 640, height: 560, maxWidth: 'calc(100% - 48px)', maxHeight: 'calc(100% - 48px)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>
        <div style={{ height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px 0 20px', borderBottom: '1px solid var(--line)' }}>
          <h2 id="verso-dict-paste-title" style={{ margin: 0, fontSize: fz(15), fontWeight: 600 }}>貼入字典</h2>
          <button type="button" className="ib" aria-label="關閉" onClick={() => set({ dictPasteOpen: false })}
            style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 0, borderRadius: 8, color: 'var(--text2)' }}>
            <IconWinClose size={13} sw={1.4} />
          </button>
        </div>

        <div style={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 14, padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <label htmlFor="verso-dict-proj" style={{ width: 28, fontSize: fz(12), color: 'var(--text2)', flexShrink: 0 }}>專案</label>
            <ProjectPicker id="verso-dict-proj" sel={projSel} newName={newProj} onSel={pickProject} onNewName={setNewProj} width={180} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <label htmlFor="verso-dict-target" style={{ width: 28, fontSize: fz(12), color: 'var(--text2)', flexShrink: 0 }}>字典</label>
            <DictPicker id="verso-dict-target" focus={projSel !== NEW} project={projName} sel={target} newName={newName} onSel={setTarget} onNewName={setNewName} width={180} />
          </div>
          <div style={{ flexGrow: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <PasteBox label="原文" col={src} onChange={setSrc} onPaste={(v, st) => spread('src', v, st)}
              selected={selRow?.key === 'src' ? selRow.sel : null} onSelect={(sel) => setSelRow(sel === null ? null : { key: 'src', sel })} />
            <PasteBox label="譯文" col={tgt} onChange={setTgt} onPaste={(v, st) => spread('tgt', v, st)}
              selected={selRow?.key === 'tgt' ? selRow.sel : null} onSelect={(sel) => setSelRow(sel === null ? null : { key: 'tgt', sel })} />
          </div>
        </div>

        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 20px 16px', borderTop: '1px solid var(--line)' }}>
          <span role="alert" style={{ fontSize: fz(12.5), color: error ? 'var(--errtx)' : 'var(--mute)' }}>
            {error || (pairs.length ? `${pairs.length} 筆` : '')}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={() => set({ dictPasteOpen: false })}
              style={{ height: 36, padding: '0 16px', background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, fontSize: fz(13) }}>取消</button>
            <button type="button" className="btn btn-primary" disabled={!canSave} onClick={() => addTerms(projName, dictName, pairs)}
              style={{ height: 36, padding: '0 18px', background: 'var(--primary)', border: 0, borderRadius: 8, color: '#ffffff', fontSize: fz(13), fontWeight: 600 }}>加入</button>
          </div>
        </div>
      </div>
    </div>
  );
}
