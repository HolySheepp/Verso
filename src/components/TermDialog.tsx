import { useStore, type TermDraft } from '../state/store';
import { IconTrash, IconWinClose } from './icons';

const labelS: React.CSSProperties = { fontSize: 12, color: 'var(--text2)' };
const col: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
const two: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 };

export function TermDialog() {
  const d = useStore((s) => s.termDraft);
  const project = useStore((s) => s.project)!;
  const { set, saveTerm, deleteTerm } = useStore.getState();
  if (!d) return null;

  const patch = (p: Partial<TermDraft>) => set({ termDraft: { ...d, ...p } });
  const close = () => set({ termDraft: null });
  const saveOff = !d.term.trim() || !d.en.trim();

  return (
    <div className="scrim" style={{ zIndex: 45 }}>
      <div role="dialog" aria-modal="true" aria-labelledby="verso-term-title" className="dialog" style={{ width: 480, boxShadow: '0 24px 64px rgba(0,0,0,0.45)' }}>
        <div style={{ height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px 0 20px', borderBottom: '1px solid var(--line)' }}>
          <h2 id="verso-term-title" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{d.id ? '編輯詞條' : '新增詞條'}</h2>
          <button type="button" className="ib" aria-label="關閉" onClick={close}
            style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 0, borderRadius: 8, color: 'var(--text2)' }}>
            <IconWinClose size={13} sw={1.4} />
          </button>
        </div>
        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={two}>
            <div style={col}>
              <label htmlFor="verso-g-term" style={labelS}>原文</label>
              <input id="verso-g-term" type="text" className="field" value={d.term} onChange={(e) => patch({ term: e.target.value })} placeholder="例如：石像鬼" />
            </div>
            <div style={col}>
              <label htmlFor="verso-g-en" style={labelS}>譯文</label>
              <input id="verso-g-en" type="text" className="field" value={d.en} onChange={(e) => patch({ en: e.target.value })} placeholder="例如：Gargoyle" />
            </div>
          </div>
          <div style={col}>
            <label htmlFor="verso-g-note" style={labelS}>備註</label>
            <textarea id="verso-g-note" className="field" value={d.note} onChange={(e) => patch({ note: e.target.value })} placeholder="例如：怪物名，複數 Gargoyles"
              style={{ height: 72, resize: 'none', padding: '9px 12px', lineHeight: 1.5 }} />
          </div>
          <div style={two}>
            <div style={col}>
              <label htmlFor="verso-g-dict" style={labelS}>加入字典</label>
              <select id="verso-g-dict" className="field" value={d.dict} onChange={(e) => patch({ dict: e.target.value })} style={{ padding: '0 10px' }}>
                {project.dicts.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div style={col}>
              <label htmlFor="verso-g-proj" style={labelS}>套用專案</label>
              <select id="verso-g-proj" className="field" value={d.proj} onChange={(e) => patch({ proj: e.target.value })} style={{ padding: '0 10px' }}>
                {project.projects.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px 16px', borderTop: '1px solid var(--line)' }}>
          <div>
            {d.id && (
              <button type="button" className="btn btn-ghost" onClick={() => deleteTerm(d.id!)}
                style={{ height: 36, display: 'flex', alignItems: 'center', gap: 6, padding: '0 14px', background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, color: 'var(--errtx)', fontSize: 13 }}>
                <IconTrash size={13} />刪除詞條
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={close}
              style={{ height: 36, padding: '0 16px', background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, fontSize: 13 }}>取消</button>
            <button type="button" className="btn btn-primary" disabled={saveOff} onClick={() => saveTerm(d)}
              style={{ height: 36, padding: '0 18px', background: '#2f6fe4', border: 0, borderRadius: 8, color: '#ffffff', fontSize: 13, fontWeight: 600 }}>儲存</button>
          </div>
        </div>
      </div>
    </div>
  );
}
