import { tx } from '../i18n';
import { useScrollTabs } from './ScrollTabs';
import { DEFAULT_FILE_NAME } from '../model/names';
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
import { colName, emptyFields, fieldLabel, fieldsToColumns, inRect, rectOf, rectsToField, type FieldMap, type FieldSel, type Rect } from '../model/importSel';
import { IMPORT_EXTS, readImport, type ImportBook } from '../data/importio';
import { xlsxToFile } from '../data/xlsxio';
import { maxOf } from '../model/num';

export interface DraftSheet { id: string; name: string; rows: string[][]; width: number; fields: FieldMap;
  /** 設定 Google 表時：格子原本的底色、字的顏色等（預覽照 Google 表的樣子顯示） */
  looks?: ({ bg?: string; fg?: string; b?: boolean; i?: boolean; s?: boolean } | undefined)[][] }

let sheetSeq = 0;
const ROW_H = 26;
const COL_W = 180;
const NUM_W = 52;
const TAB_GAP = 6;
const COLS = ALL_COLS;

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
  // 頁簽列：滾輪左右捲動，放不下時兩邊淡出
  const tabsScroll = useScrollTabs();

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
    // 讀不到、或檔案壞掉時顯示原因，不要沒有反應
    let res: ReturnType<typeof readImport>;
    try { res = readImport(file.name, new Uint8Array(await file.arrayBuffer())); } catch (e) {
      setErr(tx('import.001', { v1: String((e as Error)?.message ?? e).slice(0, 80) }));
      return;
    }
    if (typeof res === 'string') { setErr(res); return; }
    setBook(res);
    setName(res.name);
    setSheets(res.sheets.map((sh) => ({
      id: 'i' + sheetSeq++, name: sh.name, rows: sh.rows,
      width: maxOf(sh.rows.map((r) => r.length), 1), fields: emptyFields(),
    })));
    setCur(0);
  }

  const shell = (title: string, width: number, height: number | undefined, body: React.ReactNode, footer?: React.ReactNode) => (
    <div className="scrim" style={{ zIndex: 45 }} onMouseDown={dragWindow}>
      <div role="dialog" aria-modal="true" aria-labelledby="verso-import-title" className="dialog"
        style={{ width, height, maxWidth: 'calc(100% - 48px)', maxHeight: 'calc(100% - 48px)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>
        <div style={{ height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px 0 20px', borderBottom: '1px solid var(--line)' }}>
          <h2 id="verso-import-title" style={{ margin: 0, fontSize: fz(15), fontWeight: 600 }}>{title}</h2>
          <button type="button" className="ib" aria-label={tx('import.002')} onClick={close}
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
    return shell(tx('import.003'), 520, undefined,
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
          <span style={{ fontSize: fz(13.5), color: 'var(--text2)' }}>{tx('import.004')}</span>
          <button type="button" className="btn btn-ghost" onClick={() => picker.current?.click()}
            style={{ height: 34, padding: '0 16px', background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, fontSize: fz(13) }}>{tx('import.005')}</button>
          <input ref={picker} type="file" hidden accept={IMPORT_EXTS.map((e) => '.' + e).join(',')}
            onChange={(ev) => { void load(ev.target.files?.[0]); ev.target.value = ''; }} />
        </div>
        <div role="alert" style={{ minHeight: 18, marginTop: 10, fontSize: fz(12.5), color: 'var(--errtx)' }}>{err}</div>
      </div>);
  }

  const projects = useStore.getState().project!.projects;
  const allFiles = useStore.getState().project!.files;
  const projName = picked(projSel, newProj);
  const projError = nameError('project', projSel, newProj, projects);
  const fileError = !name.trim() ? '' : nameError('file', NEW, name, allFiles.filter((f) => f.project === projName).map((f) => f.name));

  const nameRow = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <label htmlFor="verso-import-name" style={{ fontSize: fz(12), color: 'var(--text2)', flexShrink: 0 }}>{tx('import.006')}</label>
      <input id="verso-import-name" type="text" className="field" value={name} onChange={(e) => setName(e.target.value)}
        placeholder={DEFAULT_FILE_NAME} aria-invalid={!!fileError} style={{ width: 320, borderColor: fileError ? 'var(--errtx)' : undefined }} />
      <label htmlFor="verso-import-proj" style={{ marginLeft: 8, fontSize: fz(12), color: 'var(--text2)', flexShrink: 0 }}>{tx('import.008')}</label>
      <ProjectPicker id="verso-import-proj" sel={projSel} newName={newProj} onSel={setProjSel} onNewName={setNewProj} width={160} />
    </div>
  );

  const footer = (error: string, blocked: boolean, onOk: () => void) => (
    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 20px 16px', borderTop: '1px solid var(--line)' }}>
      <span role="alert" style={{ fontSize: fz(12.5), color: 'var(--errtx)', minWidth: 0 }}>{error}</span>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button type="button" className="btn btn-ghost" onClick={close}
          style={{ height: 36, padding: '0 16px', background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, fontSize: fz(13) }}>{tx('import.009')}</button>
        <button type="button" className="btn btn-primary" disabled={blocked} onClick={onOk}
          style={{ height: 36, padding: '0 18px', background: 'var(--primary)', border: 0, borderRadius: 8, color: '#ffffff', fontSize: fz(13), fontWeight: 600 }}>{tx('import.010')}</button>
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
      const doc = xlsxToFile(name.trim() || DEFAULT_FILE_NAME, projName, book.data, useStore.getState().project!.customMarks);
      finish(doc);
    };
    return shell(tx('import.003'), 640, undefined,
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '16px 20px' }}>
        {nameRow}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 240, overflowY: 'auto' }}>
          {book.sheets.map((sh, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', borderRadius: 6, background: i % 2 ? 'transparent' : 'var(--ov1)', fontSize: fz(12.5) }}>
              <span>{sh.name}</span>
              <span style={{ color: 'var(--mute)' }}>{tx('import.011', { n: Math.max(0, sh.rows.length - 1) })}</span>
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
    return r.ok ? r : { ok: false, msg: r.msg === tx('pastecol.005') ? tx('import.013') : r.msg };
  });
  const badName = sheets.findIndex((sh, i) => sheetNameError(sh.name, sheets.filter((_, j) => j !== i).map((x) => x.name)));
  const firstBad = results.findIndex((r) => !r.ok);
  const sheetErr = badName >= 0
    ? tx('common.sheetError', { name: sheets[badName].name, msg: sheetNameError(sheets[badName].name, sheets.filter((_, j) => j !== badName).map((x) => x.name)) })
    : firstBad >= 0 ? (sheets.length > 1 ? tx('common.sheetError', { name: sheets[firstBad].name, msg: results[firstBad].msg }) : results[firstBad].msg) : '';
  const error = projError || fileError || sheetErr;
  const blocked = !!error || !projName;
  const ok = () => {
    if (blocked) return;
    finish({
      name: name.trim() || DEFAULT_FILE_NAME,
      project: projName,
      sheets: sheets.map((sh) => ({ name: sh.name.trim(), entries: columnsToEntries(fieldsToColumns(sh.rows, sh.fields)) })),
    });
  };
  const removeSheet = (i: number) => {
    setSheets((all) => all.filter((_, j) => j !== i));
    setCur((c) => Math.max(0, c >= i ? c - 1 : c));
  };

  return shell(tx('import.003'), 1040, 700,
    <div style={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 14, padding: '16px 20px' }}>
      {nameRow}
      <div role="tablist" aria-label={tx('import.014')} className="no-scrollbar" ref={tabsScroll.ref}
        style={{ display: 'flex', alignItems: 'center', gap: TAB_GAP, minWidth: 0, overflowX: 'auto', overflowY: 'hidden', borderBottom: '1px solid var(--line)', flexShrink: 0, ...tabsScroll.style }}>
        {sheets.map((sh, i) => {
          const on = i === cur;
          return (
            <div key={sh.id} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', borderBottom: `2px solid ${on ? 'var(--accent)' : 'transparent'}` }}>
              {renaming === i ? (
                <RenameInput initial={sh.name} label={tx('import.015')}
                  validate={(v) => sheetNameError(v, sheets.filter((_, j) => j !== i).map((x) => x.name))}
                  onDone={(v) => { if (v) patch(i, { name: v }); setRenaming(null); }}
                  style={{ height: 28, width: 140, margin: '4px 0', padding: '0 8px' }} />
              ) : (
                <button type="button" role="tab" className="stab" aria-selected={on} title={tx('import.016')}
                  onClick={() => setCur(i)} onDoubleClick={() => { setCur(i); setRenaming(i); }}
                  onContextMenu={(ev) => { ev.preventDefault(); setCur(i); setTabMenu({ i, x: ev.clientX, y: ev.clientY }); }}
                  style={{ height: 36, padding: '0 10px', background: 'transparent', border: 0, fontSize: fz(13), fontWeight: 500, color: on ? 'var(--text)' : 'var(--mute)', whiteSpace: 'nowrap' }}>
                  {sh.name}
                </button>
              )}
              {sheets.length > 1 && renaming !== i && (
                <button type="button" className="ib" aria-label={tx('import.017', { name: sh.name })} title={tx('import.018')} onClick={() => removeSheet(i)}
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
        <ContextMenu x={tabMenu.x} y={tabMenu.y} label={tx('import.019', { v1: sheets[tabMenu.i]?.name ?? '' })}
          items={[
            { key: 'rename', label: tx('import.020') },
            { key: 'delete', label: tx('import.018'), danger: true, disabled: sheets.length <= 1 },
          ]}
          onPick={(k) => { const i = tabMenu.i; setTabMenu(null); if (k === 'rename') setRenaming(i); if (k === 'delete' && sheets.length > 1) removeSheet(i); }}
          onClose={() => setTabMenu(null)} />
      )}
    </div>,
    footer(sheets.some((sh) => Object.values(sh.fields).some(Boolean)) || projError || fileError || badName >= 0 ? error : '', blocked, ok));
}

/** 預覽一個頁簽：像條目欄一樣點、拖、Shift、Ctrl 選範圍，再指定成某個欄位 */
/** 另外抓的欄：名稱、第幾欄 */
export interface ExtraCol { name: string; col: number }

export function Preview({ sheet, onFields, extras, onExtras, removed, onToggleRow, order: order0, onOrder }: {
  sheet: DraftSheet; onFields(f: FieldMap): void; extras?: ExtraCol[]; onExtras?(e: ExtraCol[]): void;
  /** 欄位按鈕的順序（新增 Google 表時可以拖動調整；只影響按鈕的順序和一次選好幾欄時依序填的順序） */
  order?: ColKey[]; onOrder?(o: ColKey[]): void;
  /** 雲端重新設定：之前移除的列（true＝維持移除、顯示灰色；false＝這次要恢復），點列號切換 */
  removed?: Map<number, boolean>; onToggleRow?(r: number): void;
}) {
  const { rows, width, fields } = sheet;
  // 加號：先選好一欄（或那欄的格子），再輸入名稱
  const [naming, setNaming] = useState<{ col: number; name: string } | null>(null);
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

  const order = order0 ?? COLS.map((c) => c.key);
  const chips = order.map((k) => COLS.find((c) => c.key === k)!).filter(Boolean);
  // 拖動欄位按鈕調整順序：跟拖頁簽一樣，按鈕跟著游標水平滑動，越過旁邊按鈕的中心就交換
  const chipPress = useRef<{ i: number; x: number; moved: boolean } | null>(null);
  const chipDragged = useRef(false);
  const [chipDrag, setChipDrag] = useState<{ from: number; to: number; dx: number; lefts: number[]; widths: number[] } | null>(null);
  const CHIP_GAP = 8;
  const chipDown = (ev: React.PointerEvent<HTMLDivElement>, i: number) => {
    if (!onOrder || ev.button !== 0 || (ev.target as HTMLElement).closest('.ib')) return;
    chipPress.current = { i, x: ev.clientX, moved: false };
  };
  const chipMove = (ev: React.PointerEvent<HTMLDivElement>) => {
    const p = chipPress.current;
    if (!p) return;
    if (!p.moved && Math.abs(ev.clientX - p.x) < 5) return;
    let d = chipDrag;
    if (!p.moved || !d) {
      p.moved = true;
      // 開始拖動才捕捉滑鼠（沒拖動時點按鈕照常設定欄位）
      try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch { /* 無法捕捉時照常運作 */ }
      const items = Array.from((ev.currentTarget.parentElement as HTMLElement).querySelectorAll<HTMLElement>('[data-chip]'));
      d = { from: p.i, to: p.i, dx: 0, lefts: items.map((el) => el.getBoundingClientRect().left), widths: items.map((el) => el.getBoundingClientRect().width) };
    }
    const { from, lefts, widths } = d;
    const n = lefts.length;
    const dx = Math.max(lefts[0] - lefts[from], Math.min(lefts[n - 1] + widths[n - 1] - widths[from] - lefts[from], ev.clientX - p.x));
    const left = lefts[from] + dx, right = left + widths[from];
    let to = from;
    for (let j = 0; j < from; j++) if (left < lefts[j] + widths[j] / 2) { to = j; break; }
    for (let j = n - 1; j > from; j--) if (right > lefts[j] + widths[j] / 2) { to = j; break; }
    setChipDrag({ ...d, dx, to });
  };
  const chipUp = () => {
    const p = chipPress.current;
    chipPress.current = null;
    if (!p?.moved || !chipDrag) { setChipDrag(null); return; }
    chipDragged.current = true;
    setTimeout(() => { chipDragged.current = false; }, 0);
    const { from, to } = chipDrag;
    setChipDrag(null);
    if (to === from || !onOrder) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onOrder(next);
  };
  /** 拖動中各按鈕的位移：被拖的跟著游標，其他的讓出位置 */
  const chipShift = (i: number) => {
    if (!chipDrag) return 0;
    const { from, to, dx, widths } = chipDrag;
    if (i === from) return dx;
    const room = widths[from] + CHIP_GAP;
    if (from < to && i > from && i <= to) return -room;
    if (to < from && i >= to && i < from) return room;
    return 0;
  };
  // 第一個設定的欄位：之後設定其他欄位時，列的範圍自動跟它一樣（跟加欄位一樣，只看選了哪一欄）
  const firstRef = useRef<ColKey | null>(null);
  const firstKey = firstRef.current && fields[firstRef.current] ? firstRef.current : order.find((k) => fields[k]?.rows.length) ?? null;
  // 選整欄：已經設定了欄位的話，照第一個設定的欄位的範圍延伸，不是整欄到底
  const firstSet = firstKey ? fields[firstKey] : null;
  const colSpan = onOrder && firstSet ? { r0: Math.min(...firstSet.rows), r1: Math.max(...firstSet.rows) } : { r0: 0, r1: last };
  const rectFor = (kind: 'cell' | 'col' | 'row', a: { c: number; r: number }, b: { c: number; r: number }) =>
    kind === 'col' ? { ...rectOf(a, b), ...colSpan }
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

  /** 把一欄的範圍設成某個欄位；同一格不能同時是兩個欄位 */
  const put = (base: FieldMap, k: ColKey, f: FieldSel): FieldMap => {
    const next = { ...base, [k]: f };
    (Object.keys(next) as ColKey[]).forEach((o) => {
      const g = next[o];
      if (o === k || !g || g.col !== f.col) return;
      const taken = new Set(f.rows);
      const rest = g.rows.filter((r) => !taken.has(r));
      next[o] = rest.length ? { col: g.col, rows: rest } : null;
    });
    return next;
  };
  const assign = (k: ColKey) => {
    setMenu(null);
    const cols = [...new Set(rects.flatMap((x) => Array.from({ length: x.c1 - x.c0 + 1 }, (_, j) => x.c0 + j)))].sort((a, b) => a - b);
    let next: FieldMap;
    if (cols.length > 1) {
      // 選了好幾欄：從按的欄位開始照按鈕的順序依序填，多出來的欄不填
      const start = order.indexOf(k);
      next = fields;
      for (const [j, col] of cols.entries()) {
        const key = order[start + j];
        if (!key) break;
        const f = rectsToField(rects.filter((x) => x.c0 <= col && col <= x.c1).map((x) => ({ ...x, c0: col, c1: col })), rows.length);
        if (typeof f === 'string') continue;
        // 已經有第一個設定的欄位：列的範圍跟它一樣
        next = put(next, key, onOrder && firstSet && key !== firstKey ? { col, rows: firstSet.rows } : f);
      }
    } else {
      const f = rectsToField(rects, rows.length);
      if (typeof f === 'string') { setMsg(f); return; }
      next = put(fields, k, onOrder && firstSet && k !== firstKey ? { col: f.col, rows: firstSet.rows } : f);
    }
    if (!firstKey) firstRef.current = k;
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
        {chips.map((c, ci) => {
          const f = fields[c.key];
          const dragging = chipDrag?.from === ci;
          return (
            <div key={c.key} data-chip="" className={'imp-chip imp-f-' + c.key} data-set={f ? '' : undefined}
              onPointerDown={(ev) => chipDown(ev, ci)} onPointerMove={chipMove} onPointerUp={chipUp} onPointerCancel={() => { chipPress.current = null; setChipDrag(null); }}
              onClickCapture={(ev) => { if (chipDragged.current) { ev.stopPropagation(); ev.preventDefault(); chipDragged.current = false; } }}
              style={onOrder ? {
                position: 'relative', zIndex: dragging ? 2 : undefined, touchAction: 'none', cursor: chipDrag ? 'grabbing' : undefined,
                transform: `translateX(${chipShift(ci)}px)`, transition: chipDrag && !dragging ? 'transform 160ms cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none',
                boxShadow: dragging ? '0 6px 16px rgba(0,0,0,0.3)' : undefined,
              } : undefined}>
              <button type="button" className="imp-chip-btn" title={tx('import.021', { label: c.label })} onClick={() => assign(c.key)}>
                <span style={{ fontWeight: 600 }}>{c.label}</span>
                <span style={{ color: f ? 'var(--text2)' : 'var(--mute)' }}>{f ? tx('import.fieldRange', { range: fieldLabel(f), n: f.rows.length }) : tx('import.022')}</span>
              </button>
              {f && (
                <button type="button" className="ib" aria-label={tx('import.023', { label: c.label })} title={tx('import.024')} onClick={() => clear(c.key)}
                  style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'transparent', border: 0, borderRadius: 5, color: 'var(--mute)' }}>
                  <IconWinClose size={9} sw={1.4} />
                </button>
              )}
            </div>
          );
        })}
        {extras && onExtras && <>
          {extras.map((x, i) => (
            <div key={x.name + i} className="imp-chip" data-set="">
              <span className="imp-chip-btn" style={{ cursor: 'default' }}>
                <span style={{ fontWeight: 600 }}>{x.name}</span>
                <span style={{ color: 'var(--text2)' }}>{tx('import.extraCol', { col: colName(x.col) })}</span>
              </span>
              <button type="button" className="ib" aria-label={tx('import.023', { label: x.name })} title={tx('import.024')} onClick={() => onExtras(extras.filter((_, j) => j !== i))}
                style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'transparent', border: 0, borderRadius: 5, color: 'var(--mute)' }}>
                <IconWinClose size={9} sw={1.4} />
              </button>
            </div>
          ))}
          {naming ? (
            <form onSubmit={(ev) => { ev.preventDefault(); const n = naming.name.trim(); if (n && !extras.some((x) => x.name === n)) { onExtras([...extras, { name: n, col: naming.col }]); setNaming(null); setRects([]); } }}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <label htmlFor="verso-extra-name" style={{ fontSize: fz(12), color: 'var(--text2)' }}>{tx('import.extraName', { col: colName(naming.col) })}</label>
              <input id="verso-extra-name" className="field" autoFocus value={naming.name} onChange={(ev) => setNaming({ ...naming, name: ev.target.value })}
                onKeyDown={(ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); setNaming(null); } }} style={{ width: 120, height: 28 }} />
              <button type="submit" className="btn btn-ghost" disabled={!naming.name.trim() || extras.some((x) => x.name === naming.name.trim())}
                style={{ height: 28, padding: '0 10px', background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 6, fontSize: fz(12) }}>{tx('import.extraOk')}</button>
            </form>
          ) : (
            <button type="button" className="ib" aria-label={tx('import.extraAdd')} title={tx('import.extraAdd')}
              onClick={() => {
                const cols = [...new Set(rects.flatMap((x) => Array.from({ length: x.c1 - x.c0 + 1 }, (_, j) => x.c0 + j)))];
                if (cols.length !== 1) { setMsg(tx('import.extraPick')); return; }
                setMsg('');
                setNaming({ col: cols[0], name: '' });
              }}
              style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 6, color: 'var(--text2)', fontSize: 16 }}>+</button>
          )}
        </>}
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
                {removed?.has(r) ? (
                  <button type="button" className="imp-num" onClick={() => onToggleRow?.(r)} aria-pressed={!removed.get(r)}
                    title={removed.get(r) ? tx('cloud.removedRow') : tx('cloud.restoredRow')} aria-label={(removed.get(r) ? tx('cloud.removedRow') : tx('cloud.restoredRow')) + ' ' + (r + 1)}
                    style={{ border: 0, borderRight: '1px solid var(--line)', cursor: 'pointer', color: removed.get(r) ? 'var(--mute3)' : 'var(--accent2)', textDecoration: removed.get(r) ? 'line-through' : undefined }}>{r + 1}</button>
                ) : (
                  <div className="imp-num" onMouseDown={(ev) => press(ev, 'row', { c: 0, r })} onMouseEnter={() => enter({ c: width - 1, r })}>{r + 1}</div>
                )}
                {Array.from({ length: width }, (_, c) => {
                  const k = marks.get(c + ':' + r);
                  const v = row[c] ?? '';
                  const sel = inSel(c, r);
                  // Google 表原本的樣子（選了欄位、框選中的格子照 Verso 的標色）
                  const lk = !k && !sel ? sheet.looks?.[r]?.[c] : undefined;
                  const look: React.CSSProperties | undefined = lk ? { background: lk.bg, color: lk.fg, fontWeight: lk.b ? 700 : undefined, fontStyle: lk.i ? 'italic' : undefined, textDecoration: lk.s ? 'line-through' : undefined } : undefined;
                  return (
                    <div key={c} className={'imp-cell' + (k ? ' imp-f-' + k : '')} data-sel={sel ? '' : undefined} title={v.length > 20 ? v : undefined}
                      style={removed?.get(r) ? { ...look, opacity: 0.4 } : look}
                      onMouseDown={(ev) => press(ev, 'cell', { c, r })} onMouseEnter={() => enter({ c, r })}>{v}</div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} label={tx('import.025')}
          items={COLS.map((c) => ({ key: c.key, label: tx('import.026', { label: c.label }), disabled: !rects.length }))}
          onPick={(k) => assign(k as ColKey)} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}
