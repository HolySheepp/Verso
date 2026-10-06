import { useEffect, useMemo, useRef, useState } from 'react';
import { currentProjectOf, useStore } from '../state/store';
import { leaveFile } from '../state/saver';
import { NEW, ProjectPicker, nameError, picked } from './Pickers';
import { RenameInput } from './RenameInput';
import { ContextMenu } from './ContextMenu';
import { dragWindow } from './windowDrag';
import { IconWinClose } from './icons';
import { fz } from '../model/fonts';
import { sheetNameError } from '../model/names';
import { COLS as ALL_COLS, checkColumns, columnsToEntries, type ColKey } from '../model/paste';
import { colName, emptyFields, fieldLabel, fieldsToColumns, inRect, rectOf, rectsToField, type FieldMap, type Rect } from '../model/importSel';
import { IMPORT_EXTS, readImport, type ImportBook } from '../data/importio';
import { xlsxToFile } from '../data/xlsxio';

interface DraftSheet { id: string; name: string; rows: string[][]; width: number; fields: FieldMap }

let sheetSeq = 0;
const ROW_H = 26;
const COL_W = 180;
const NUM_W = 52;
const TAB_GAP = 6;
// 匯入檔案時不對應備註欄（只有手動貼入、插入頁簽、管理專案有）
const COLS = ALL_COLS.filter((c) => c.key !== 'note');

const label = (k: ColKey) => COLS.find((c) => c.key === k)!.label;

/** 匯入檔案：拖入或選擇檔案；Verso 的檔案直接匯入，其他檔案預覽後指定各欄 */
export function ImportDialog() {
  const open = useStore((s) => s.importOpen);
  const close = () => useStore.getState().set({ importOpen: false });
  const [book, setBook] = useState<ImportBook | null>(null);
  const [err, setErr] = useState('');
  const [over, setOver] = useState(false);
  const [name, setName] = useState('');
  const [projSel, setProjSel] = useState('');
  const [newProj, setNewProj] = useState('');
  const [sheets, setSheets] = useState<DraftSheet[]>([]);
  const [cur, setCur] = useState(0);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [tabMenu, setTabMenu] = useState<{ i: number; x: number; y: number } | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setBook(null); setErr(''); setOver(false); setSheets([]); setCur(0); setRenaming(null); setTabMenu(null);
      setProjSel(currentProjectOf(useStore.getState())); setNewProj('');
    }
  }, [open]);

  // 拖進軟體視窗的檔案：還在選檔案這一步時才讀，已經在設定欄位就不換掉
  const dropped = useStore((s) => s.importFile);
  useEffect(() => {
    if (!open || !dropped) return;
    useStore.getState().set({ importFile: null });
    if (!book) void load(dropped);
  }, [open, dropped]);

  if (!open) return null;

  async function load(file: File | undefined) {
    if (!file) return;
    setErr('');
    const res = readImport(file.name, new Uint8Array(await file.arrayBuffer()));
    if (typeof res === 'string') { setErr(res); return; }
    setBook(res);
    setName(res.name);
    setSheets(res.sheets.map((sh) => ({
      id: 'i' + sheetSeq++, name: sh.name, rows: sh.rows,
      width: Math.max(1, ...sh.rows.map((r) => r.length)), fields: emptyFields(),
    })));
    setCur(0);
  }

  const shell = (title: string, width: number, height: number | undefined, body: React.ReactNode, footer?: React.ReactNode) => (
    <div className="scrim" style={{ zIndex: 45 }} onMouseDown={dragWindow}>
      <div role="dialog" aria-modal="true" aria-labelledby="verso-import-title" className="dialog"
        style={{ width, height, maxWidth: 'calc(100% - 48px)', maxHeight: 'calc(100% - 48px)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>
        <div style={{ height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px 0 20px', borderBottom: '1px solid var(--line)' }}>
          <h2 id="verso-import-title" style={{ margin: 0, fontSize: fz(15), fontWeight: 600 }}>{title}</h2>
          <button type="button" className="ib" aria-label="關閉" onClick={close}
            style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 0, borderRadius: 8, color: 'var(--text2)' }}>
            <IconWinClose size={13} sw={1.4} />
          </button>
        </div>
        {body}
        {footer}
      </div>
    </div>
  );

  // 第一步：拖入或選擇檔案
  if (!book) {
    return shell('匯入檔案', 520, undefined,
      <div style={{ padding: 20 }}>
        <div
          onDragOver={(ev) => { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(ev) => { ev.preventDefault(); ev.stopPropagation(); setOver(false); void load(ev.dataTransfer.files[0]); }}
          data-nodrag
          style={{
            height: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14,
            border: `1.5px dashed ${over ? 'var(--accent)' : 'var(--line6)'}`, borderRadius: 10,
            background: over ? 'var(--acc-soft)' : 'var(--bg0)', transition: 'background 120ms, border-color 120ms',
          }}>
          <span style={{ fontSize: fz(13.5), color: 'var(--text2)' }}>把檔案拖到這裡</span>
          <button type="button" className="btn btn-ghost" onClick={() => picker.current?.click()}
            style={{ height: 34, padding: '0 16px', background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, fontSize: fz(13) }}>選擇檔案</button>
          <input ref={picker} type="file" hidden accept={IMPORT_EXTS.map((e) => '.' + e).join(',')}
            onChange={(ev) => { void load(ev.target.files?.[0]); ev.target.value = ''; }} />
        </div>
        <div role="alert" style={{ minHeight: 18, marginTop: 10, fontSize: fz(12.5), color: 'var(--errtx)' }}>{err}</div>
      </div>);
  }

  const projects = useStore.getState().project!.projects;
  const allFiles = useStore.getState().project!.files;
  const projName = picked(projSel, newProj);
  const projError = nameError('專案', projSel, newProj, projects);
  const fileError = !name.trim() ? '' : nameError('檔案', NEW, name, allFiles.filter((f) => f.project === projName).map((f) => f.name));

  const nameRow = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <label htmlFor="verso-import-name" style={{ fontSize: fz(12), color: 'var(--text2)', flexShrink: 0 }}>檔名</label>
      <input id="verso-import-name" type="text" className="field" value={name} onChange={(e) => setName(e.target.value)}
        placeholder="未命名檔案" aria-invalid={!!fileError} style={{ width: 320, borderColor: fileError ? 'var(--errtx)' : undefined }} />
      <label htmlFor="verso-import-proj" style={{ marginLeft: 8, fontSize: fz(12), color: 'var(--text2)', flexShrink: 0 }}>專案</label>
      <ProjectPicker id="verso-import-proj" sel={projSel} newName={newProj} onSel={setProjSel} onNewName={setNewProj} width={160} />
    </div>
  );

  const footer = (error: string, blocked: boolean, onOk: () => void) => (
    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 20px 16px', borderTop: '1px solid var(--line)' }}>
      <span role="alert" style={{ fontSize: fz(12.5), color: 'var(--errtx)', minWidth: 0 }}>{error}</span>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button type="button" className="btn btn-ghost" onClick={close}
          style={{ height: 36, padding: '0 16px', background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, fontSize: fz(13) }}>取消</button>
        <button type="button" className="btn btn-primary" disabled={blocked} onClick={onOk}
          style={{ height: 36, padding: '0 18px', background: 'var(--primary)', border: 0, borderRadius: 8, color: '#ffffff', fontSize: fz(13), fontWeight: 600 }}>匯入</button>
      </div>
    </div>
  );

  const finish = (doc: Parameters<ReturnType<typeof useStore.getState>['addFile']>[0]) =>
    leaveFile(null, () => useStore.getState().addFile(doc));

  // Verso 的檔案：選專案後直接匯入
  if (book.verso) {
    const error = projError || fileError;
    const blocked = !!error || !projName;
    const ok = () => {
      if (blocked) return;
      const doc = xlsxToFile(name.trim() || '未命名檔案', projName, book.data, useStore.getState().project!.customMarks);
      finish(doc);
    };
    return shell('匯入檔案', 640, undefined,
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '16px 20px' }}>
        {nameRow}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 240, overflowY: 'auto' }}>
          {book.sheets.map((sh, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', borderRadius: 6, background: i % 2 ? 'transparent' : 'var(--ov1)', fontSize: fz(12.5) }}>
              <span>{sh.name}</span>
              <span style={{ color: 'var(--mute)' }}>{Math.max(0, sh.rows.length - 1)} 條</span>
            </div>
          ))}
        </div>
      </div>,
      footer(error, blocked, ok));
  }

  // 其他檔案：預覽並指定各欄
  const sheet = sheets[Math.min(cur, sheets.length - 1)];
  const patch = (i: number, p: Partial<DraftSheet>) => setSheets((all) => all.map((sh, j) => (j === i ? { ...sh, ...p } : sh)));
  const results = sheets.map((sh) => {
    const r = checkColumns(fieldsToColumns(sh.rows, sh.fields));
    return r.ok ? r : { ok: false, msg: r.msg.replace('還沒貼原文', '還沒選原文') };
  });
  const badName = sheets.findIndex((sh, i) => sheetNameError(sh.name, sheets.filter((_, j) => j !== i).map((x) => x.name)));
  const firstBad = results.findIndex((r) => !r.ok);
  const sheetErr = badName >= 0
    ? `「${sheets[badName].name}」` + sheetNameError(sheets[badName].name, sheets.filter((_, j) => j !== badName).map((x) => x.name))
    : firstBad >= 0 ? (sheets.length > 1 ? `「${sheets[firstBad].name}」` : '') + results[firstBad].msg : '';
  const error = projError || fileError || sheetErr;
  const blocked = !!error || !projName;
  const ok = () => {
    if (blocked) return;
    finish({
      name: name.trim() || '未命名檔案',
      project: projName,
      sheets: sheets.map((sh) => ({ name: sh.name.trim(), entries: columnsToEntries(fieldsToColumns(sh.rows, sh.fields)) })),
    });
  };
  const removeSheet = (i: number) => {
    setSheets((all) => all.filter((_, j) => j !== i));
    setCur((c) => Math.max(0, c >= i ? c - 1 : c));
  };

  return shell('匯入檔案', 1040, 700,
    <div style={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 14, padding: '16px 20px' }}>
      {nameRow}
      <div role="tablist" aria-label="頁簽" className="no-scrollbar"
        style={{ display: 'flex', alignItems: 'center', gap: TAB_GAP, minWidth: 0, overflowX: 'auto', overflowY: 'hidden', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        {sheets.map((sh, i) => {
          const on = i === cur;
          return (
            <div key={sh.id} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', borderBottom: `2px solid ${on ? 'var(--accent)' : 'transparent'}` }}>
              {renaming === i ? (
                <RenameInput initial={sh.name} label="頁簽名稱"
                  validate={(v) => sheetNameError(v, sheets.filter((_, j) => j !== i).map((x) => x.name))}
                  onDone={(v) => { if (v) patch(i, { name: v }); setRenaming(null); }}
                  style={{ height: 28, width: 140, margin: '4px 0', padding: '0 8px' }} />
              ) : (
                <button type="button" role="tab" className="stab" aria-selected={on} title="雙擊改名"
                  onClick={() => setCur(i)} onDoubleClick={() => { setCur(i); setRenaming(i); }}
                  onContextMenu={(ev) => { ev.preventDefault(); setCur(i); setTabMenu({ i, x: ev.clientX, y: ev.clientY }); }}
                  style={{ height: 36, padding: '0 10px', background: 'transparent', border: 0, fontSize: fz(13), fontWeight: 500, color: on ? 'var(--text)' : 'var(--mute)', whiteSpace: 'nowrap' }}>
                  {sh.name}
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
      </div>
      {sheet && <Preview key={sheet.id} sheet={sheet} onFields={(fields) => patch(cur, { fields })} />}
      {tabMenu && (
        <ContextMenu x={tabMenu.x} y={tabMenu.y} label={'頁簽「' + (sheets[tabMenu.i]?.name ?? '') + '」'}
          items={[
            { key: 'rename', label: '重新命名' },
            { key: 'delete', label: '移除', danger: true, disabled: sheets.length <= 1 },
          ]}
          onPick={(k) => { const i = tabMenu.i; setTabMenu(null); if (k === 'rename') setRenaming(i); if (k === 'delete' && sheets.length > 1) removeSheet(i); }}
          onClose={() => setTabMenu(null)} />
      )}
    </div>,
    footer(sheets.some((sh) => Object.values(sh.fields).some(Boolean)) || projError || fileError || badName >= 0 ? error : '', blocked, ok));
}

/** 預覽一個頁簽：像條目欄一樣點、拖、Shift、Ctrl 選範圍，再指定成某個欄位 */
function Preview({ sheet, onFields }: { sheet: DraftSheet; onFields(f: FieldMap): void }) {
  const { rows, width, fields } = sheet;
  const [rects, setRects] = useState<Rect[]>([]);
  const [anchor, setAnchor] = useState<{ c: number; r: number } | null>(null);
  const [top, setTop] = useState(0);
  const [viewH, setViewH] = useState(480);
  const [msg, setMsg] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // 拖動中：從哪一格開始，選的是格子、整欄還是整列
  const drag = useRef<{ from: { c: number; r: number }; kind: 'cell' | 'col' | 'row' } | null>(null);
  const last = rows.length - 1;

  useEffect(() => {
    const up = () => { drag.current = null; };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 每個欄位選到的格子
  const marks = useMemo(() => {
    const m = new Map<string, ColKey>();
    (Object.keys(fields) as ColKey[]).forEach((k) => fields[k]?.rows.forEach((r) => m.set(fields[k]!.col + ':' + r, k)));
    return m;
  }, [fields]);

  const rectFor = (kind: 'cell' | 'col' | 'row', a: { c: number; r: number }, b: { c: number; r: number }) =>
    kind === 'col' ? { ...rectOf(a, b), r0: 0, r1: last }
      : kind === 'row' ? { ...rectOf(a, b), c0: 0, c1: width - 1 }
      : rectOf(a, b);

  const press = (ev: React.MouseEvent, kind: 'cell' | 'col' | 'row', at: { c: number; r: number }) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    setMsg('');
    box.current?.focus();
    if (ev.shiftKey && anchor) {
      setRects((rs) => [...rs.slice(0, -1), rectFor(kind, anchor, at)]);
      drag.current = { from: anchor, kind };
      return;
    }
    const add = ev.ctrlKey || ev.metaKey;
    setRects((rs) => [...(add ? rs : []), rectFor(kind, at, at)]);
    setAnchor(at);
    drag.current = { from: at, kind };
  };
  const enter = (at: { c: number; r: number }) => {
    const d = drag.current;
    if (!d) return;
    setRects((rs) => [...rs.slice(0, -1), rectFor(d.kind, d.from, at)]);
  };
  // 拖到上下邊緣時自動捲動
  const onMove = (ev: React.MouseEvent) => {
    const el = box.current;
    if (!drag.current || !el) return;
    const b = el.getBoundingClientRect();
    if (ev.clientY > b.bottom - 24) el.scrollTop += ROW_H;
    else if (ev.clientY < b.top + ROW_H + 24) el.scrollTop -= ROW_H;
  };

  const assign = (k: ColKey) => {
    setMenu(null);
    const f = rectsToField(rects, rows.length);
    if (typeof f === 'string') { setMsg(f); return; }
    // 同一格不能同時是兩個欄位
    const next = { ...fields, [k]: f };
    (Object.keys(next) as ColKey[]).forEach((o) => {
      const g = next[o];
      if (o === k || !g || g.col !== f.col) return;
      const taken = new Set(f.rows);
      const rest = g.rows.filter((r) => !taken.has(r));
      next[o] = rest.length ? { col: g.col, rows: rest } : null;
    });
    onFields(next);
    setRects([]);
    setMsg('');
  };
  const clear = (k: ColKey) => onFields({ ...fields, [k]: null });

  const first = Math.max(0, Math.floor(top / ROW_H) - 5);
  const count = Math.ceil(viewH / ROW_H) + 10;
  const visible = rows.slice(first, first + count);
  const inSel = (c: number, r: number) => rects.some((x) => inRect(x, c, r));
  const colFields = (c: number) => (Object.keys(fields) as ColKey[]).filter((k) => fields[k]?.col === c);
  const total = NUM_W + width * COL_W;

  return (
    <div data-nodrag style={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {COLS.map((c) => {
          const f = fields[c.key];
          return (
            <div key={c.key} className={'imp-chip imp-f-' + c.key} data-set={f ? '' : undefined}>
              <button type="button" className="imp-chip-btn" title={'把選取的範圍設為' + c.label} onClick={() => assign(c.key)}>
                <span style={{ fontWeight: 600 }}>{c.label}</span>
                <span style={{ color: f ? 'var(--text2)' : 'var(--mute)' }}>{f ? `${fieldLabel(f)}（${f.rows.length}）` : '未選'}</span>
              </button>
              {f && (
                <button type="button" className="ib" aria-label={'清除' + c.label} title="清除" onClick={() => clear(c.key)}
                  style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'transparent', border: 0, borderRadius: 5, color: 'var(--mute)' }}>
                  <IconWinClose size={9} sw={1.4} />
                </button>
              )}
            </div>
          );
        })}
        <span role="alert" style={{ fontSize: fz(12.5), color: 'var(--errtx)' }}>{msg}</span>
      </div>

      <div ref={box} tabIndex={-1} className="imp-grid" onScroll={(ev) => setTop(ev.currentTarget.scrollTop)} onMouseMove={onMove}
        onContextMenu={(ev) => { ev.preventDefault(); setMenu({ x: ev.clientX, y: ev.clientY }); }}
        style={{ flexGrow: 1, minHeight: 0, overflow: 'auto', position: 'relative', background: 'var(--bg0)', border: '1px solid var(--line)', borderRadius: 8, outline: 'none' }}>
        <div style={{ position: 'relative', width: total, height: (rows.length + 1) * ROW_H }}>
          <div style={{ position: 'sticky', top: 0, zIndex: 3, display: 'flex', width: total, height: ROW_H, background: 'var(--bar)', borderBottom: '1px solid var(--line)' }}>
            <div className="imp-num" style={{ zIndex: 4, background: 'var(--bar)' }} />
            {Array.from({ length: width }, (_, c) => (
              <div key={c} className="imp-head" onMouseDown={(ev) => press(ev, 'col', { c, r: 0 })} onMouseEnter={() => enter({ c, r: last })}>
                <span>{colName(c)}</span>
                {colFields(c).map((k) => <span key={k} className={'imp-tag imp-f-' + k}>{label(k)}</span>)}
              </div>
            ))}
          </div>
          {visible.map((row, j) => {
            const r = first + j;
            return (
              <div key={r} style={{ position: 'absolute', top: (r + 1) * ROW_H, left: 0, display: 'flex', width: total, height: ROW_H }}>
                <div className="imp-num" onMouseDown={(ev) => press(ev, 'row', { c: 0, r })} onMouseEnter={() => enter({ c: width - 1, r })}>{r + 1}</div>
                {Array.from({ length: width }, (_, c) => {
                  const k = marks.get(c + ':' + r);
                  const v = row[c] ?? '';
                  return (
                    <div key={c} className={'imp-cell' + (k ? ' imp-f-' + k : '')} data-sel={inSel(c, r) ? '' : undefined} title={v.length > 20 ? v : undefined}
                      onMouseDown={(ev) => press(ev, 'cell', { c, r })} onMouseEnter={() => enter({ c, r })}>{v}</div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} label="設為"
          items={COLS.map((c) => ({ key: c.key, label: '設為' + c.label, disabled: !rects.length }))}
          onPick={(k) => assign(k as ColKey)} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}
