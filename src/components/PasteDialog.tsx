import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { COLS, checkColumns, columnsToEntries, emptyColumns, spreadColumns, type Columns } from '../model/paste';
import { PasteBox } from './PasteBox';
import { ContextMenu } from './ContextMenu';
import { dragWindow, focusOnMount } from './windowDrag';
import { IconPlus, IconWinClose } from './icons';

interface DraftSheet { name: string; cols: Columns }

const newSheet = (n: number): DraftSheet => ({ name: '頁簽 ' + n, cols: emptyColumns() });

/** 手動貼入：建立一個檔案，底下有一或多個頁簽，每個頁簽貼入 id、發話者、原文、譯文四欄 */
export function PasteDialog() {
  const open = useStore((s) => s.pasteOpen);
  const { set, addFile } = useStore.getState();
  const [name, setName] = useState('');
  const [sheets, setSheets] = useState<DraftSheet[]>([newSheet(1)]);
  const [cur, setCur] = useState(0);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [selRow, setSelRow] = useState<{ key: string; i: number } | null>(null);
  const [tabMenu, setTabMenu] = useState<{ i: number; x: number; y: number } | null>(null);

  // 每次打開都是空白的
  useEffect(() => {
    if (open) { setName(''); setSheets([newSheet(1)]); setCur(0); setRenaming(null); setSelRow(null); setTabMenu(null); }
  }, [open]);

  // 換頁簽時清掉選到的那一行
  useEffect(() => { setSelRow(null); }, [cur]);

  if (!open) return null;

  const sheet = sheets[Math.min(cur, sheets.length - 1)];
  // 用最新的狀態更新，連續貼上多欄時不會互相蓋掉
  const patchSheet = (i: number, fn: (sh: DraftSheet) => Partial<DraftSheet>) =>
    setSheets((prev) => prev.map((sh, j) => (j === i ? { ...sh, ...fn(sh) } : sh)));
  const results = sheets.map((sh) => checkColumns(sh.cols));
  const firstBad = results.findIndex((r) => !r.ok);
  const error = firstBad < 0 ? '' : (sheets.length > 1 ? `「${sheets[firstBad].name}」` : '') + results[firstBad].msg;
  // 還沒貼東西時不顯示錯誤，只擋下建立
  const touched = sheets.some((sh) => COLS.some((c) => sh.cols[c.key]));

  const create = () => {
    if (firstBad >= 0) return;
    addFile({
      name: name.trim() || '未命名檔案',
      sheets: sheets.map((sh, i) => ({ name: sh.name.trim() || '頁簽 ' + (i + 1), entries: columnsToEntries(sh.cols) })),
    });
  };

  const addSheet = () => {
    setSheets([...sheets, newSheet(sheets.length + 1)]);
    setCur(sheets.length);
  };

  const insertSheet = (i: number) => {
    setSheets([...sheets.slice(0, i + 1), newSheet(sheets.length + 1), ...sheets.slice(i + 1)]);
    setCur(i + 1);
  };

  const onTabMenu = (key: string, i: number) => {
    setTabMenu(null);
    if (key === 'rename') { setCur(i); setRenaming(i); }
    if (key === 'clear') patchSheet(i, () => ({ cols: emptyColumns() }));
    if (key === 'delete' && sheets.length > 1) removeSheet(i);
    if (key === 'insert') insertSheet(i);
  };

  const removeSheet = (i: number) => {
    const next = sheets.filter((_, j) => j !== i);
    setSheets(next);
    setCur(Math.max(0, Math.min(cur >= i ? cur - 1 : cur, next.length - 1)));
  };

  return (
    <div className="scrim" style={{ zIndex: 45 }} onMouseDown={dragWindow}>
      <div role="dialog" aria-modal="true" aria-labelledby="verso-paste-title" className="dialog"
        style={{ width: 960, height: 640, maxWidth: 'calc(100% - 48px)', maxHeight: 'calc(100% - 48px)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>
        <div style={{ height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px 0 20px', borderBottom: '1px solid var(--line)' }}>
          <h2 id="verso-paste-title" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>手動貼入</h2>
          <button type="button" className="ib" aria-label="關閉" onClick={() => set({ pasteOpen: false })}
            style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 0, borderRadius: 8, color: 'var(--text2)' }}>
            <IconWinClose size={13} sw={1.4} />
          </button>
        </div>

        <div style={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 14, padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <label htmlFor="verso-paste-name" style={{ fontSize: 12, color: 'var(--text2)', flexShrink: 0 }}>檔名</label>
            <input id="verso-paste-name" type="text" className="field" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="未命名檔案" autoFocus style={{ width: 320 }} />
          </div>

          <div role="tablist" aria-label="頁簽" style={{ display: 'flex', alignItems: 'center', gap: 6, borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
            {sheets.map((sh, i) => {
              const on = i === cur;
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', borderBottom: `2px solid ${on ? 'var(--accent)' : 'transparent'}`, marginBottom: -1 }}>
                  {renaming === i ? (
                    <input className="field" ref={focusOnMount} value={sh.name} aria-label="頁簽名稱"
                      onChange={(e) => { const name = e.target.value; patchSheet(i, () => ({ name })); }}
                      onBlur={() => setRenaming(null)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setRenaming(null); }}
                      style={{ height: 28, width: 140, margin: '4px 0', padding: '0 8px' }} />
                  ) : (
                    <button type="button" role="tab" className="stab" aria-selected={on} title="雙擊改名"
                      onClick={() => setCur(i)} onDoubleClick={() => setRenaming(i)}
                      onContextMenu={(ev) => { ev.preventDefault(); setCur(i); setTabMenu({ i, x: ev.clientX, y: ev.clientY }); }}
                      style={{ height: 36, padding: '0 10px', background: 'transparent', border: 0, fontSize: 13, fontWeight: 500, color: on ? 'var(--text)' : 'var(--mute)', whiteSpace: 'nowrap' }}>
                      {sh.name || '頁簽 ' + (i + 1)}
                    </button>
                  )}
                  {sheets.length > 1 && renaming !== i && (
                    <button type="button" className="ib" aria-label={'移除頁簽「' + sh.name + '」'} title="移除" onClick={() => removeSheet(i)}
                      style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'transparent', border: 0, borderRadius: 5, color: 'var(--mute)' }}>
                      <IconWinClose size={9} sw={1.4} />
                    </button>
                  )}
                </div>
              );
            })}
            <button type="button" className="ib side-hb" aria-label="新增頁簽" title="新增頁簽" onClick={addSheet}>
              <IconPlus size={14} />
            </button>
          </div>

          <div role="tabpanel" style={{ flexGrow: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '0.7fr 0.8fr 1.5fr 1.5fr', gap: 12 }}>
            {COLS.map((c) => (
              <PasteBox key={cur + c.key} label={c.label} col={sheet.cols[c.key]}
                onPaste={(values) => patchSheet(cur, (sh) => ({ cols: { ...sh.cols, ...spreadColumns(COLS.map((x) => x.key), c.key, values) } }))}
                onChange={(col) => patchSheet(cur, (sh) => ({ cols: { ...sh.cols, [c.key]: col } }))}
                selected={selRow?.key === c.key ? selRow.i : null}
                onSelect={(i) => setSelRow(i === null ? null : { key: c.key, i })} />
            ))}
          </div>
        </div>

        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 20px 16px', borderTop: '1px solid var(--line)' }}>
          <span role="alert" style={{ fontSize: 12.5, color: 'var(--errtx)', minWidth: 0 }}>{touched ? error : ''}</span>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button type="button" className="btn btn-ghost" onClick={() => set({ pasteOpen: false })}
              style={{ height: 36, padding: '0 16px', background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, fontSize: 13 }}>取消</button>
            <button type="button" className="btn btn-primary" disabled={firstBad >= 0} onClick={create}
              style={{ height: 36, padding: '0 18px', background: '#2f6fe4', border: 0, borderRadius: 8, color: '#ffffff', fontSize: 13, fontWeight: 600 }}>建立</button>
          </div>
        </div>
      </div>
      {tabMenu && (
        <ContextMenu x={tabMenu.x} y={tabMenu.y} label={'頁簽「' + (sheets[tabMenu.i]?.name ?? '') + '」'}
          items={[
            { key: 'rename', label: '重新命名' },
            { key: 'clear', label: '清空' },
            { key: 'delete', label: '刪除', danger: true, disabled: sheets.length <= 1 },
            { key: 'insert', label: '插入' },
          ]}
          onPick={(k) => onTabMenu(k, tabMenu.i)}
          onClose={() => setTabMenu(null)} />
      )}
    </div>
  );
}
