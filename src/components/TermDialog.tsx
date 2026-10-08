import { tx } from '../i18n';
import { MAX_CELL_CHARS } from '../model/names';
import { useState } from 'react';
import { useStore, type TermDraft } from '../state/store';
import { DictPicker, NEW, ProjectPicker, firstDict, nameError, picked } from './Pickers';
import { IconTrash, IconWinClose } from './icons';
import { fz } from '../model/fonts';

const labelS: React.CSSProperties = { fontSize: fz(12), color: 'var(--text2)' };
const col: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
const two: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 };

export function TermDialog() {
  const d = useStore((s) => s.termDraft);
  // 每次打開都重新建立表單，下拉選單從詞條目前的專案、字典開始
  return d ? <TermForm init={d} /> : null;
}

function TermForm({ init }: { init: TermDraft }) {
  const project = useStore((s) => s.project)!;
  const { set, saveTerm, deleteTerm } = useStore.getState();
  const [d, setD] = useState(init);
  const [projSel, setProjSel] = useState(project.projects.includes(init.proj) ? init.proj : NEW);
  const [newProj, setNewProj] = useState(project.projects.includes(init.proj) ? '' : init.proj);
  const hasDict = project.dicts.some((x) => x.project === init.proj && x.name === init.dict);
  const [dictSel, setDictSel] = useState(hasDict ? init.dict : init.dict ? NEW : firstDict(init.proj));
  const [newDict, setNewDict] = useState(hasDict ? '' : init.dict);

  const patch = (p: Partial<TermDraft>) => setD({ ...d, ...p });
  const close = () => set({ termDraft: null });
  const projName = picked(projSel, newProj);
  const dictName = picked(dictSel, newDict);
  const pickProject = (v: string) => { setProjSel(v); setDictSel(v === NEW ? NEW : firstDict(v)); };
  const error = nameError('project', projSel, newProj, project.projects)
    || nameError('dict', dictSel, newDict, project.dicts.filter((x) => x.project === projName).map((x) => x.name));
  const saveOff = !d.term.trim() || !d.en.trim() || !projName || !dictName || !!error;

  return (
    <div className="scrim" style={{ zIndex: 45 }}>
      <div role="dialog" aria-modal="true" aria-labelledby="verso-term-title" className="dialog" style={{ width: 480, boxShadow: '0 24px 64px rgba(0,0,0,0.45)' }}>
        <div style={{ height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px 0 20px', borderBottom: '1px solid var(--line)' }}>
          <h2 id="verso-term-title" style={{ margin: 0, fontSize: fz(15), fontWeight: 600 }}>{d.id ? tx('term.001') : tx('term.002')}</h2>
          <button type="button" className="ib" aria-label={tx('term.003')} onClick={close}
            style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 0, borderRadius: 8, color: 'var(--text2)' }}>
            <IconWinClose size={13} sw={1.4} />
          </button>
        </div>
        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={two}>
            <div style={col}>
              <label htmlFor="verso-g-term" style={labelS}>{tx('term.004')}</label>
              <input id="verso-g-term" type="text" className="field" value={d.term} onChange={(e) => patch({ term: e.target.value })} placeholder={tx('term.005')} />
            </div>
            <div style={col}>
              <label htmlFor="verso-g-en" style={labelS}>{tx('term.006')}</label>
              <input id="verso-g-en" type="text" className="field" value={d.en} onChange={(e) => patch({ en: e.target.value })} placeholder={tx('term.007')} />
            </div>
          </div>
          <div style={col}>
            <label htmlFor="verso-g-note" style={labelS}>{tx('term.008')}</label>
            <textarea maxLength={MAX_CELL_CHARS} id="verso-g-note" className="field" value={d.note} onChange={(e) => patch({ note: e.target.value })} placeholder={tx('term.009')}
              style={{ height: 72, resize: 'none', padding: '9px 12px', lineHeight: 1.5 }} />
          </div>
          <div style={two}>
            <div style={col}>
              <label htmlFor="verso-g-proj" style={labelS}>{tx('term.010')}</label>
              <ProjectPicker id="verso-g-proj" stack sel={projSel} newName={newProj} onSel={pickProject} onNewName={setNewProj} />
            </div>
            <div style={col}>
              <label htmlFor="verso-g-dict" style={labelS}>{tx('term.011')}</label>
              <DictPicker id="verso-g-dict" stack focus={projSel !== NEW} project={projName} sel={dictSel} newName={newDict} onSel={setDictSel} onNewName={setNewDict} />
            </div>
          </div>
          {error && <div role="alert" style={{ fontSize: fz(12.5), color: 'var(--errtx)' }}>{error}</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px 16px', borderTop: '1px solid var(--line)' }}>
          <div>
            {d.id && (
              <button type="button" className="btn btn-ghost" onClick={() => deleteTerm(d.id!)}
                style={{ height: 36, display: 'flex', alignItems: 'center', gap: 6, padding: '0 14px', background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, color: 'var(--errtx)', fontSize: fz(13) }}>
                <IconTrash size={13} />{tx('term.012')}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={close}
              style={{ height: 36, padding: '0 16px', background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, fontSize: fz(13) }}>{tx('term.013')}</button>
            <button type="button" className="btn btn-primary" disabled={saveOff} onClick={() => saveTerm({ ...d, proj: projName, dict: dictName })}
              style={{ height: 36, padding: '0 18px', background: 'var(--primary)', border: 0, borderRadius: 8, color: '#ffffff', fontSize: fz(13), fontWeight: 600 }}>{tx('term.014')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
