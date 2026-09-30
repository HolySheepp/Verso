import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { PasteBox } from './PasteBox';
import { IconWinClose } from './icons';

const NEW = '__new__';

/** 貼入字典：原文、譯文兩欄，建立新字典或加進現有字典 */
export function DictPasteDialog() {
  const open = useStore((s) => s.dictPasteOpen);
  const dicts = useStore((s) => s.project!.dicts);
  const { set, addTerms } = useStore.getState();
  const [target, setTarget] = useState(NEW);
  const [newName, setNewName] = useState('');
  const [src, setSrc] = useState<string[] | null>(null);
  const [tgt, setTgt] = useState<string[] | null>(null);

  useEffect(() => {
    if (open) { setTarget(NEW); setNewName(''); setSrc(null); setTgt(null); }
  }, [open]);

  if (!open) return null;

  const dictName = target === NEW ? newName.trim() : target;
  let error = '';
  if (src && tgt && src.length !== tgt.length) error = `兩欄行數不一致：原文 ${src.length}、譯文 ${tgt.length}`;
  else if (target === NEW && newName.trim() && dicts.includes(newName.trim())) error = '已有同名字典';
  // 原文或譯文空白的行略過
  const pairs: [string, string][] = src && tgt && !error
    ? src.map((s, i): [string, string] => [s.trim(), (tgt[i] ?? '').trim()]).filter(([a, b]) => a && b)
    : [];
  const canSave = !error && !!dictName && pairs.length > 0;

  return (
    <div className="scrim" style={{ zIndex: 45 }}>
      <div role="dialog" aria-modal="true" aria-labelledby="verso-dict-paste-title" className="dialog"
        style={{ width: 640, height: 560, maxWidth: 'calc(100% - 48px)', maxHeight: 'calc(100% - 48px)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>
        <div style={{ height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px 0 20px', borderBottom: '1px solid var(--line)' }}>
          <h2 id="verso-dict-paste-title" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>貼入字典</h2>
          <button type="button" className="ib" aria-label="關閉" onClick={() => set({ dictPasteOpen: false })}
            style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 0, borderRadius: 8, color: 'var(--text2)' }}>
            <IconWinClose size={13} sw={1.4} />
          </button>
        </div>

        <div style={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 14, padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <label htmlFor="verso-dict-target" style={{ fontSize: 12, color: 'var(--text2)', flexShrink: 0 }}>字典</label>
            <select id="verso-dict-target" className="field" value={target} onChange={(e) => setTarget(e.target.value)} style={{ width: 180, padding: '0 10px' }}>
              <option value={NEW}>新字典</option>
              {dicts.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            {target === NEW && (
              <input type="text" className="field" aria-label="新字典名稱" value={newName} onChange={(e) => setNewName(e.target.value)}
                placeholder="字典名稱" autoFocus style={{ flexGrow: 1, minWidth: 0 }} />
            )}
          </div>
          <div style={{ flexGrow: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <PasteBox label="原文" rows={src} onRows={setSrc} />
            <PasteBox label="譯文" rows={tgt} onRows={setTgt} />
          </div>
        </div>

        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 20px 16px', borderTop: '1px solid var(--line)' }}>
          <span role="alert" style={{ fontSize: 12.5, color: error ? 'var(--errtx)' : 'var(--mute)' }}>
            {error || (pairs.length ? `${pairs.length} 筆` : '')}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={() => set({ dictPasteOpen: false })}
              style={{ height: 36, padding: '0 16px', background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, fontSize: 13 }}>取消</button>
            <button type="button" className="btn btn-primary" disabled={!canSave} onClick={() => addTerms(dictName, pairs)}
              style={{ height: 36, padding: '0 18px', background: '#2f6fe4', border: 0, borderRadius: 8, color: '#ffffff', fontSize: 13, fontWeight: 600 }}>加入</button>
          </div>
        </div>
      </div>
    </div>
  );
}
