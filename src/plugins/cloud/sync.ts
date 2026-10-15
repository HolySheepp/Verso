// 雲端檔案的讀取與寫回：
// - 讀：設定過的分頁照欄位範圍變成條目（同一個 ID 第幾次出現，就對到同一條）；標記、建議翻譯、修改從 Verso 資料表讀
// - 寫：譯文、備註跟上次讀到的不同就寫回原表（正在編輯的那條等離開才寫），寫之前用 ID 重新找列，
//   那格在讀取後被別人改過就先問「用我的／用對方的」；標記等寫進 Verso 資料表
// - 驗證模式的修改、建議翻譯用刪除線和藍字寫在譯文欄，驗證時新加的備註用藍字（見 format.ts）；
//   讀回來時一定還原成原本的譯文，標示不會混進軟體裡的譯文
// - Verso 資料表：「Verso檔案」分頁記各檔案的欄位設定（大家共用，不用再選範圍）；
//   每個檔案一個分頁（名稱是試算表 ID），打開哪個檔案才讀寫那個分頁
// - 檔案選單先列出全部檔案（還沒讀的只是空殼），點開才讀
import { appDataDir, join } from '@tauri-apps/api/path';
import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { tx } from '../../i18n';
import { fieldsToColumns } from '../../model/importSel';
import { columnsToEntries } from '../../model/paste';
import { SHARED, type CustomMark, type Entry, type FileDoc, type Sheet } from '../../model/types';
import { textToVerify, verifyToText } from '../../model/verify';
import { currentOf, isShown, showToast, useStore } from '../../state/store';
import { addTab, appendRows, errText, meta, readCols, readRich, readTabs, sidOf, writeRich, writeRows, type Rich } from './api';
import { blueStart, markToText, noteCell, richSig, stripMarkup, textToMark, tgtCell } from './format';
import { allSheets, setConfig, toFieldMap, useCloud, type CloudSheet, type CloudTab, type Conflict } from './config';

export const fidOf = (sid: string) => 'g:' + sid;

/** 讀過的試算表（重新讀取、寫回只處理這些；還沒點開的只是空殼） */
const loaded = new Set<string>();
const loading = new Set<string>();

const fileOf = (sid: string) => useStore.getState().project?.files.find((f) => f.fid === fidOf(sid));
const confOf = (sid: string) => allSheets().find((x) => x.sid === sid);

/** 同一個 ID 第幾次出現：讀取時、寫回時都用它對條目和列 */
const keysOf = (entries: { id: string }[]) => {
  const seen = new Map<string, number>();
  return entries.map((e) => { const n = seen.get(e.id) ?? 0; seen.set(e.id, n + 1); return e.id + '\u0000' + n; });
};

// ---- 本機暫存：略過檢查、長度標準等；沒設定 Verso 資料表時，標記、建議翻譯也存這裡 ----
type Kept = Pick<Entry, 'mark' | 'keptMark' | 'sugg' | 'ver' | 'skipCheck' | 'skipSugg' | 'lengthStd' | 'pending'>;
async function cacheFile(sid: string) {
  const dir = await join(await appDataDir(), 'cloud', 'cache');
  if (!(await exists(dir))) await mkdir(dir, { recursive: true });
  return join(dir, sid + '.json');
}
async function readCache(sid: string): Promise<Record<string, Record<string, Kept>>> {
  try { const f = await cacheFile(sid); return (await exists(f)) ? JSON.parse(await readTextFile(f)) : {}; } catch { return {}; }
}
const cacheTimers = new Map<string, ReturnType<typeof setTimeout>>();
function saveCacheSoon(doc: FileDoc) {
  const sid = doc.cloud!.sid;
  // 空殼（還沒讀）不寫，免得蓋掉之前記的
  if (doc.cloud!.stub) return;
  clearTimeout(cacheTimers.get(sid));
  cacheTimers.set(sid, setTimeout(async () => {
    const out: Record<string, Record<string, Kept>> = {};
    doc.sheets.forEach((sh) => {
      const keys = keysOf(sh.entries);
      const m: Record<string, Kept> = {};
      sh.entries.forEach((e, i) => {
        if (!e.mark && !e.sugg && !e.ver && !e.skipCheck && !e.skipSugg && !e.lengthStd && !e.keptMark) return;
        m[keys[i]] = { mark: e.mark, keptMark: e.keptMark, sugg: e.sugg, ver: e.ver, skipCheck: e.skipCheck, skipSugg: e.skipSugg, lengthStd: e.lengthStd, pending: e.pending };
      });
      out[String(sh.gid)] = m;
    });
    try { await writeTextFile(await cacheFile(sid), JSON.stringify(out)); } catch { /* 下次再寫 */ }
  }, 3000));
}

// ---- Verso 資料表 ----
const dataSid = () => sidOf(useCloud.getState().cfg.dataUrl ?? '') ?? '';
const is400 = (e: unknown) => /^400\b/.test(String((e as Error)?.message ?? e));

/** 「Verso檔案」分頁：試算表ID、名稱、專案、欄位設定、更新者、更新時間 */
const FILES_TAB = 'Verso檔案';
const FILES_HEAD = ['試算表ID', '名稱', '專案', '欄位設定', '更新者', '更新時間'];
const filesRows = new Map<string, number>();
let filesExists = false;

/** 讀資料表裡記的各檔案設定（同一張資料表的人共用） */
export async function readShared() {
  const did = dataSid();
  if (!did) { useCloud.setState({ shared: [] }); return; }
  let rows: string[][] = [];
  try { [rows] = await readTabs(did, [FILES_TAB]); filesExists = true; } catch (e) { if (!is400(e)) throw e; filesExists = false; }
  filesRows.clear();
  const shared: CloudSheet[] = [];
  rows.forEach((v, r) => {
    if (r === 0 || !v[0]) return;
    try {
      const tabs = JSON.parse(v[3] ?? '') as CloudTab[];
      if (!Array.isArray(tabs)) return;
      filesRows.set(v[0], r);
      shared.push({ sid: v[0], title: v[1] ?? '', project: v[2] || SHARED, tabs });
    } catch { /* 壞掉的列不理 */ }
  });
  useCloud.setState({ shared });
}

/** 把一份試算表的設定寫進資料表 */
async function writeShared(conf: CloudSheet) {
  const did = dataSid();
  if (!did) return;
  await readShared();
  if (!filesExists) { await addTab(did, FILES_TAB); await writeRows(did, FILES_TAB, [{ row: 0, values: FILES_HEAD }]); filesExists = true; }
  const values = [conf.sid, conf.title, conf.project, JSON.stringify(conf.tabs), useCloud.getState().email ?? '', new Date().toISOString()];
  const row = filesRows.get(conf.sid);
  if (row !== undefined) await writeRows(did, FILES_TAB, [{ row, values }]);
  else await appendRows(did, FILES_TAB, [values]);
  await readShared();
}

/** 每個檔案在資料表裡的分頁（名稱是試算表 ID）：分頁ID、條目ID、第幾個、標記、建議翻譯、修改、譯文、寫入的譯文格、備註藍色起點、更新者、更新時間 */
const DATA_HEAD = ['分頁ID', '條目ID', '第幾個', '標記', '建議翻譯', '修改', '譯文', '寫入的譯文格', '備註藍色起點', '更新者', '更新時間'];
const D = { mark: 3, sugg: 4, ver: 5, tgt: 6, written: 7, blue: 8 } as const;
interface FileData { rows: Map<string, { row: number; v: string[] }>; exists: boolean; at: number }
const fileData = new Map<string, FileData>();
const dataKey = (gid: number, key: string) => [gid, ...key.split('\u0000')].join('\t');

/** 讀這個檔案在資料表裡的分頁（剛讀過就不再讀） */
async function readData(sid: string, force = false): Promise<FileData | undefined> {
  const did = dataSid();
  if (!did) return undefined;
  const old = fileData.get(sid);
  if (!force && old && Date.now() - old.at < 5000) return old;
  const fd: FileData = { rows: new Map(), exists: true, at: Date.now() };
  try {
    const [rows] = await readTabs(did, [sid]);
    rows.forEach((v, r) => { if (r > 0 && v[0]) fd.rows.set([v[0], v[1] ?? '', v[2] ?? ''].join('\t'), { row: r, v }); });
  } catch (e) { if (!is400(e)) throw e; fd.exists = false; }
  fileData.set(sid, fd);
  return fd;
}

/** 這條在資料表裡要存的內容（標記、建議翻譯、修改） */
function dataCore(e: Entry, customs: CustomMark[]) {
  return [markToText(e, customs), e.sugg, verifyToText(e.ver)];
}

interface Base {
  /** Google 上的譯文（譯文欄是驗證標示時，是還原後的原本譯文） */
  tgt: string;
  /** 譯文欄實際的文字、格式 */
  cell: string; cellSig: string;
  note: string; noteSig: string;
  /** 備註從第幾個字起是藍色（驗證時加的） */
  blueFrom?: number;
  row: number;
  /** 資料表裡這條的內容（標記、建議翻譯、修改）與整列（標記～備註藍色起點） */
  core: string; data: string;
}
/** 每條最後一次跟 Google 對上的內容（uid → …）；跟軟體裡的不同代表還沒寫回 */
const base = new Map<string, Base>();
const plainSig = (t: string) => richSig({ text: t, runs: [] });

/**
 * 把一個分頁讀到的內容變成條目；prev 是目前軟體裡的那份（標記、還沒寫回的修改都留著）。
 * rich 是譯文欄的格式（只有需要還原驗證標示時才讀）
 */
function buildSheet(tab: CloudTab, rows: string[][], prev: Sheet | undefined, kept: Record<string, Kept> | undefined, fd: FileData | undefined, rich: Rich[] | undefined): Sheet {
  const customs = useStore.getState().project!.customMarks;
  const map = toFieldMap(tab.fields, rows.length - 1);
  const fresh = columnsToEntries(fieldsToColumns(rows, map));
  const keys = keysOf(fresh);
  const old = new Map<string, Entry>();
  if (prev) { const pk = keysOf(prev.entries); prev.entries.forEach((e, i) => old.set(pk[i], e)); }
  const entries = fresh.map((n, i) => {
    const row = map.src!.rows[i];
    const d = fd?.rows.get(dataKey(tab.gid, keys[i]))?.v;
    // 譯文欄是 Verso 寫的驗證標示：還原成原本的譯文（跟寫入時一樣就用資料表記的；被人改過就照格式拿掉標示）
    const written = d?.[D.written] ?? '';
    const tgtRow = map.tgt?.rows[i];
    const composite = !!written && n.tgt === written;
    const rTgt = composite ? d![D.tgt] ?? '' : written && tgtRow !== undefined && rich?.[tgtRow] ? stripMarkup(rich[tgtRow]) : n.tgt;
    const rMark = textToMark(d?.[D.mark] ?? '', customs);
    const rSugg = d?.[D.sugg] ?? '';
    const rVer = textToVerify(d?.[D.ver] ?? '');
    const blue = d?.[D.blue] ? Number(d[D.blue]) : undefined;
    const rCore = JSON.stringify([d?.[D.mark] ?? '', rSugg, d?.[D.ver] ?? '']);
    const rData = JSON.stringify(d ? d.slice(D.mark, D.blue + 1).map((x) => x ?? '') : ['', '', '', '', '', '']);
    const o = old.get(keys[i]);
    const b = o ? base.get(o.uid) : undefined;
    let e: Entry;
    if (o) {
      // 還沒寫回的譯文、備註、標記等留著；其他跟著 Google
      const tgt = b && o.tgt !== b.tgt ? o.tgt : rTgt;
      const note = b && o.note !== b.note ? o.note : n.note;
      const localData = !fd || (b && JSON.stringify(dataCore(o, customs)) !== b.core);
      const marks = localData ? {} : { mark: rMark.mark, keptMark: rMark.keptMark, sugg: rSugg, ver: rVer };
      const next = { ...o, id: n.id, speaker: n.speaker, src: n.src, src0: n.src, tgt, note, ...marks };
      const same = (Object.keys(next) as (keyof Entry)[]).every((k) => next[k] === o[k]);
      e = same ? o : next;
    } else {
      const k = kept?.[keys[i]];
      e = { ...n, tgt: rTgt, tgt0: rTgt, pending: false, ...(k ?? {}) };
      // 有資料表：標記等以資料表為準（資料表裡還沒有的，用這台電腦之前記的，稍後寫上去）
      if (d) Object.assign(e, { mark: rMark.mark, keptMark: rMark.keptMark, sugg: rSugg, ver: rVer });
    }
    base.set(e.uid, {
      tgt: rTgt, cell: n.tgt, cellSig: composite ? richSig(tgtCell({ ...e, tgt: rTgt, sugg: rSugg, ver: rVer })) : plainSig(n.tgt),
      note: n.note, noteSig: richSig(noteCell(n.note, blue)), blueFrom: blue, row,
      core: rCore, data: rData,
    });
    return e;
  });
  const same = prev && prev.name === tab.title && prev.entries.length === entries.length && entries.every((e, i) => e === prev.entries[i]);
  return same ? prev! : { name: tab.title, gid: tab.gid, entries };
}

/** 有驗證標示被人改過（跟 Verso 寫入時不一樣）的格子：要讀格式才能還原 */
function needRich(tab: CloudTab, rows: string[][], fd: FileData | undefined): boolean {
  if (!fd?.rows.size || !tab.fields.tgt) return false;
  const map = toFieldMap(tab.fields, rows.length - 1);
  const fresh = columnsToEntries(fieldsToColumns(rows, map));
  const keys = keysOf(fresh);
  return fresh.some((n, i) => { const w = fd.rows.get(dataKey(tab.gid, keys[i]))?.v[D.written]; return !!w && n.tgt !== w; });
}

/** 讀一份試算表（點開時、重新讀取時）；回傳有沒有讀到 */
export async function loadSheet(sid: string, quiet = false): Promise<boolean> {
  const conf = confOf(sid);
  if (!conf || loading.has(sid)) return false;
  loading.add(sid);
  try {
    const m = await meta(sid);
    // 分頁改名：跟著 Google 的名稱；被刪掉的分頁不讀
    const tabs = conf.tabs.map((t) => ({ ...t, title: m.tabs.find((x) => x.gid === t.gid)?.title ?? '' })).filter((t) => t.title);
    if (m.title !== conf.title || tabs.some((t, i) => t.title !== conf.tabs[i]?.title)) {
      const fixed = { ...conf, title: m.title, tabs: conf.tabs.map((t) => tabs.find((y) => y.gid === t.gid) ?? t) };
      const { cfg, shared } = useCloud.getState();
      if (cfg.sheets.some((x) => x.sid === sid)) setConfig({ sheets: cfg.sheets.map((x) => (x.sid === sid ? fixed : x)) });
      useCloud.setState({ shared: shared.map((x) => (x.sid === sid ? fixed : x)) });
    }
    const values = await readTabs(sid, tabs.map((t) => t.title));
    const fd = await readData(sid, true);
    const rich = await Promise.all(tabs.map((t, i) => (needRich(t, values[i], fd) ? readRich(sid, t.title, t.fields.tgt!.col) : Promise.resolve(undefined))));
    const cur0 = fileOf(sid);
    const prev = cur0 && !cur0.cloud?.stub ? cur0 : undefined;
    const kept = prev ? undefined : await readCache(sid);
    const sheets = tabs.map((t, i) => buildSheet(t, values[i], prev?.sheets.find((s) => s.gid === t.gid), kept?.[String(t.gid)], fd, rich[i]));
    if (!sheets.length) return false;
    const p = useStore.getState().project!;
    const project = p.projects.includes(conf.project) ? conf.project : SHARED;
    const unchanged = prev && prev.name === m.title && prev.sheets.length === sheets.length && sheets.every((s, i) => s === prev.sheets[i]);
    if (unchanged) { loaded.add(sid); return true; }
    const doc: FileDoc = { ...(cur0 ?? {}), fid: fidOf(sid), cloud: { sid }, name: m.title, project: cur0?.project ?? project, sheets };
    const cur = useStore.getState().project!;
    const at = cur.files.findIndex((f) => f.fid === doc.fid);
    useStore.setState({ project: { ...cur, files: at >= 0 ? cur.files.map((f, i) => (i === at ? doc : f)) : [...cur.files, doc] } });
    // 收到別人的修改：這個檔案的 Ctrl+Z 紀錄不要了（免得退回別人的修改）
    if (prev) useStore.getState().dropUndo(doc.fid!);
    loaded.add(sid);
    return true;
  } catch (e) {
    const msg = tx('cloud.loadFailed', { name: conf.title || sid, reason: errText(e) });
    useCloud.setState({ syncError: msg });
    if (!quiet) showToast(msg, { warn: true });
    return false;
  } finally {
    loading.delete(sid);
  }
}

// ---- 寫回 ----
let chain: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>) => { const r = chain.then(fn, fn); chain = r.catch(() => undefined); return r; };

/** 正在編輯的那條（還沒離開，不寫） */
function editingUid(): string | undefined {
  const s = useStore.getState();
  return currentOf(s).fileDoc.cloud ? currentOf(s).entry?.uid : undefined;
}

/** 這條現在要寫成什麼樣子 */
function wanted(e: Entry, b: Base, customs: CustomMark[], useData: boolean) {
  const verify = useStore.getState().mode === 'verify';
  // 譯文欄：有資料表才寫驗證標示（不然讀回來時認不得）
  const cell = useData ? tgtCell(e) : { text: e.tgt, runs: [] };
  // 備註欄：驗證時新加的是藍色；其他時候沿用原本的藍色起點
  const blueFrom = verify && e.note !== b.note ? blueStart(b.note, e.note, b.blueFrom) : (b.blueFrom !== undefined && b.blueFrom < e.note.length ? b.blueFrom : undefined);
  const note = noteCell(e.note, blueFrom);
  const composite = cell.text !== e.tgt || cell.runs.length > 0;
  const row = [...dataCore(e, customs), composite ? e.tgt : '', composite ? cell.text : '', blueFrom === undefined ? '' : String(blueFrom)];
  return { cell, note, blueFrom, row, core: JSON.stringify(dataCore(e, customs)), dataSig: JSON.stringify(row) };
}

/** 把改過的譯文、備註、標記等寫回 Google；all：連正在編輯的那條也寫（結束、關掉雲端模式時） */
export function flush(sid: string, all = false): Promise<void> {
  return serial(async () => {
    const doc = fileOf(sid);
    const conf = confOf(sid);
    if (!doc || !conf || doc.cloud?.stub) return;
    const skip = all ? undefined : editingUid();
    const locked = new Set(useStore.getState().aiLocked);
    const customs = useStore.getState().project!.customMarks;
    const did = dataSid();
    const who = useCloud.getState().email ?? '';
    for (const sh of doc.sheets) {
      const tab = conf.tabs.find((t) => t.gid === sh.gid);
      if (!tab?.fields.id || !tab.fields.tgt) continue;
      const keys = keysOf(sh.entries);
      const changed = sh.entries.map((e, i) => ({ e, key: keys[i], b: base.get(e.uid) }))
        .filter((x): x is { e: Entry; key: string; b: Base } => !!x.b && x.e.uid !== skip && !locked.has(x.e.uid))
        .map((x) => ({ ...x, w: wanted(x.e, x.b, customs, !!did) }))
        .filter(({ b, w }) => richSig(w.cell) !== b.cellSig || richSig(w.note) !== b.noteSig || (!!did && w.dataSig !== b.data));
      if (!changed.length) continue;
      try {
        // 用 ID 重新找列（別人可能插入或刪除了列）
        const cols = [tab.fields.id.col, tab.fields.tgt.col, ...(tab.fields.note ? [tab.fields.note.col] : [])];
        const [ids, tgts, notes = []] = await readCols(sid, tab.title, cols);
        const idRows = toFieldMap(tab.fields, Math.max(ids.length, tgts.length) - 1).id!.rows;
        const rowsOf = new Map<string, number[]>();
        idRows.forEach((r) => { const id = (ids[r] ?? '').trim(); if (!rowsOf.has(id)) rowsOf.set(id, []); rowsOf.get(id)!.push(r); });
        const cells: { gid: number; row: number; col: number; rich: Rich }[] = [];
        const done: { e: Entry; key: string; w: ReturnType<typeof wanted>; row: number }[] = [];
        const missing: string[] = [];
        for (const { e, key, b, w } of changed) {
          const n = Number(key.split('\u0000')[1]);
          // ID 是空的：只能用讀取時的列
          const row = e.id.trim() ? rowsOf.get(e.id.trim())?.[n] : b.row;
          if (row === undefined) { missing.push(e.id || '?'); continue; }
          const writeCell = richSig(w.cell) !== b.cellSig;
          const writeNote = !!tab.fields.note && richSig(w.note) !== b.noteSig;
          // 這格在讀取後被別人改過：先問（這條先不寫）
          const rc = tgts[row] ?? '', rn = notes[row] ?? '';
          if (writeCell && rc !== b.cell && rc !== w.cell.text) { addConflict({ sid, gid: sh.gid!, uid: e.uid, id: e.id, src: e.src, field: 'tgt', mine: w.cell.text, theirs: rc }); continue; }
          if (writeNote && rn !== b.note && rn !== e.note) { addConflict({ sid, gid: sh.gid!, uid: e.uid, id: e.id, src: e.src, field: 'note', mine: e.note, theirs: rn }); continue; }
          if (writeCell) cells.push({ gid: sh.gid!, row, col: tab.fields.tgt.col, rich: w.cell });
          if (writeNote) cells.push({ gid: sh.gid!, row, col: tab.fields.note!.col, rich: w.note });
          done.push({ e, key, w, row });
        }
        await writeRich(sid, cells);
        // 資料表裡這個檔案的分頁：有這條就改那一列，沒有就加在最後（沒有分頁就先建）
        const dataDone = did ? done.filter(({ e, w }) => w.dataSig !== base.get(e.uid)!.data) : [];
        if (dataDone.length) {
          const fd = (await readData(sid, true))!;
          if (!fd.exists) { await addTab(did, sid); await writeRows(did, sid, [{ row: 0, values: DATA_HEAD }]); fd.exists = true; }
          const now = new Date().toISOString();
          const updates: { row: number; values: string[] }[] = [];
          const adds: string[][] = [];
          for (const { key, w } of dataDone) {
            const values = [String(sh.gid), ...key.split('\u0000'), ...w.row, who, now];
            const hit = fd.rows.get(dataKey(sh.gid!, key));
            if (hit) updates.push({ row: hit.row, values }); else adds.push(values);
          }
          await writeRows(did, sid, updates);
          if (adds.length) await appendRows(did, sid, adds);
          fd.at = 0;
        }
        done.forEach(({ e, w, row }) => base.set(e.uid, {
          ...base.get(e.uid)!, tgt: e.tgt, cell: w.cell.text, cellSig: richSig(w.cell), note: e.note, noteSig: richSig(w.note), blueFrom: w.blueFrom, row,
          ...(did ? { core: w.core, data: w.dataSig } : {}),
        }));
        if (missing.length) showToast(tx('cloud.missingId', { name: sh.name, ids: missing.slice(0, 5).join(tx('common.sep')) }), { warn: true });
      } catch (e) {
        const msg = tx('cloud.writeFailed', { name: doc.name, reason: errText(e) });
        useCloud.setState({ syncError: msg });
        showToast(msg, { warn: true });
      }
    }
  });
}

function addConflict(c: Conflict) {
  const list = useCloud.getState().conflicts;
  if (list.some((x) => x.uid === c.uid && x.field === c.field)) return;
  useCloud.setState({ conflicts: [...list, c] });
}

/** 解決一個衝突：mine 用我的（寫回去），否則用對方的（重新讀這份，譯文欄的標示照樣還原） */
export async function resolveConflict(c: Conflict, mine: boolean) {
  useCloud.setState({ conflicts: useCloud.getState().conflicts.filter((x) => !(x.uid === c.uid && x.field === c.field)) });
  const b = base.get(c.uid);
  if (!b) return;
  if (mine) {
    // 對方的內容當成已經看過的，再寫一次就不會又問
    if (c.field === 'tgt') base.set(c.uid, { ...b, cell: c.theirs, cellSig: plainSig(c.theirs) });
    else base.set(c.uid, { ...b, note: c.theirs, noteSig: plainSig(c.theirs) });
    await flush(c.sid, true);
    return;
  }
  // 用對方的：軟體裡的改回上次讀到的，再重新讀（不直接把格子的文字當成譯文）
  const doc = fileOf(c.sid);
  const si = doc?.sheets.findIndex((s) => s.gid === c.gid) ?? -1;
  if (doc && si >= 0) useStore.getState().aiPatch(doc.fid!, si, c.uid, (e) => (c.field === 'tgt' ? { ...e, tgt: b.tgt } : { ...e, note: b.note }));
  await loadSheet(c.sid, true);
}

/** 同步：先寫回，再重新讀取（only：只同步這一份；不指定時連資料表裡的檔案清單也重讀）；同步按鈕、定時、回到 Verso 時用 */
export async function refreshAll(quiet = true, only?: string) {
  if (useCloud.getState().syncing) return;
  useCloud.setState({ syncing: true, syncError: '' });
  let ok = true;
  try {
    if (!only) { try { await readShared(); ensureStubs(); } catch (e) { ok = false; useCloud.setState({ syncError: tx('cloud.loadFailed', { name: tx('cloud.dataUrl'), reason: errText(e) }) }); } }
    for (const sid of [...loaded]) {
      if (only && sid !== only) continue;
      await flush(sid);
      ok = (await loadSheet(sid, quiet)) && ok;
    }
  } finally {
    useCloud.setState({ syncing: false, ...(ok ? { lastSync: Date.now() } : {}) });
  }
}

/** 目前打開的雲端檔案 */
export function currentSid(): string | undefined {
  const s = useStore.getState();
  return s.cloudMode ? currentOf(s).fileDoc.cloud?.sid : undefined;
}

/** 關掉雲端模式或結束時：全部寫回 */
export async function flushAll() {
  for (const sid of [...loaded]) await flush(sid, true);
}

/** 檔案選單列出全部用得到的試算表：還沒讀的先放空殼（頁簽名稱有，條目等點開才讀）；不再使用的拿掉 */
export function ensureStubs() {
  const p = useStore.getState().project;
  if (!p) return;
  const sheets = allSheets();
  const want = new Set(sheets.map((x) => fidOf(x.sid)));
  const add = sheets.filter((x) => !p.files.some((f) => f.fid === fidOf(x.sid))).map((x): FileDoc => ({
    fid: fidOf(x.sid), cloud: { sid: x.sid, stub: true }, name: x.title || x.sid,
    project: p.projects.includes(x.project) ? x.project : SHARED,
    sheets: x.tabs.map((t) => ({ name: t.title, gid: t.gid, entries: [] })),
  }));
  const drop = p.files.map((f, i) => (f.cloud?.stub && !want.has(f.fid!) ? i : -1)).filter((i) => i >= 0);
  for (const i of drop.reverse()) useStore.getState().deleteFile(i);
  if (add.length) { const cur = useStore.getState().project!; useStore.setState({ project: { ...cur, files: [...cur.files, ...add] } }); }
}

/** 不再使用這份試算表（只是這台電腦不列出來，Google 和資料表裡的都不動） */
export async function removeSheet(sid: string) {
  await flush(sid, true);
  loaded.delete(sid);
  const { cfg } = useCloud.getState();
  setConfig({ sheets: cfg.sheets.filter((x) => x.sid !== sid), hidden: [...new Set([...(cfg.hidden ?? []), sid])] });
  const i = useStore.getState().project?.files.findIndex((f) => f.fid === fidOf(sid)) ?? -1;
  if (i >= 0) useStore.getState().deleteFile(i);
}

/** 新設定或重新設定一份試算表：記在這台電腦，也寫進資料表給大家用 */
export async function putSheet(conf: CloudSheet) {
  const { cfg } = useCloud.getState();
  setConfig({
    sheets: cfg.sheets.some((x) => x.sid === conf.sid) ? cfg.sheets.map((x) => (x.sid === conf.sid ? conf : x)) : [...cfg.sheets, conf],
    hidden: (cfg.hidden ?? []).filter((x) => x !== conf.sid),
  });
  try { await writeShared(conf); } catch (e) { showToast(tx('cloud.writeFailed', { name: tx('cloud.dataUrl'), reason: errText(e) }), { warn: true }); }
  useCloud.setState({ shared: useCloud.getState().shared.map((x) => (x.sid === conf.sid ? conf : x)) });
  // 重新設定：欄位可能換了，整份重讀
  const i = useStore.getState().project?.files.findIndex((f) => f.fid === fidOf(conf.sid)) ?? -1;
  if (i >= 0) { await flush(conf.sid, true); loaded.delete(conf.sid); useStore.getState().deleteFile(i); }
  if (await loadSheet(conf.sid)) selectSheet(conf.sid);
}

export function selectSheet(sid: string) {
  const i = useStore.getState().project?.files.findIndex((f) => f.fid === fidOf(sid)) ?? -1;
  if (i >= 0) useStore.getState().setFile(i);
}

/** 打開雲端模式：列出全部試算表（空殼），換到上次打開的那份，只讀那一份 */
export async function enterCloud() {
  try { await readShared(); } catch (e) { showToast(tx('cloud.loadFailed', { name: tx('cloud.dataUrl'), reason: errText(e) }), { warn: true }); }
  ensureStubs();
  const last = useCloud.getState().cfg.last;
  if (last && fileOf(last)) selectSheet(last); else pickShown();
  const sid = currentSid();
  if (sid && fileOf(sid)?.cloud?.stub) await loadSheet(sid);
}

/** 目前的檔案在這個模式看不到：換到看得到的第一個 */
export function pickShown() {
  const s = useStore.getState();
  const f = s.project?.files[s.file];
  if (f && isShown(s, f)) return;
  const i = s.project?.files.findIndex((x) => isShown(s, x)) ?? -1;
  if (i >= 0) s.setFile(i);
}

/** 軟體裡的雲端檔案有變動：稍後寫回，並記下本機暫存；被換掉（例如換存檔資料夾）的放回去；點開空殼就讀 */
let flushTimer: ReturnType<typeof setTimeout> | undefined;
export function watchStore() {
  let last = new Map<string, FileDoc>();
  useStore.subscribe((s, prev) => {
    if (!s.project || !prev.project) return;
    if (s.project !== prev.project) {
      const now = new Map(s.project.files.filter((f) => f.cloud).map((f) => [f.cloud!.sid, f]));
      const dirty: string[] = [];
      now.forEach((f, sid) => { if (last.get(sid) !== f) { dirty.push(sid); saveCacheSoon(f); } });
      // 換了存檔資料夾等整個重新載入時，雲端檔案不見了：放回去
      const lost = [...last.keys()].filter((sid) => !now.has(sid) && confOf(sid) && (loaded.has(sid) || last.get(sid)!.cloud?.stub));
      if (lost.length) {
        const p = s.project;
        useStore.setState({ project: { ...p, files: [...p.files, ...lost.map((sid) => last.get(sid)!)] } });
        return;
      }
      last = now;
      if (dirty.length) { clearTimeout(flushTimer); flushTimer = setTimeout(() => dirty.forEach((sid) => void flush(sid)), 2000); }
    }
    const a = currentOf(prev), b = currentOf(s);
    // 離開某一條：那條馬上寫回
    if (a.fileDoc.cloud && a.entry && a.entry.uid !== b.entry?.uid) void flush(a.fileDoc.cloud.sid);
    // 換到別的雲端檔案：記下來（下次先開這份）；是空殼就讀
    const sid = b.fileDoc.cloud?.sid;
    if (sid && sid !== a.fileDoc.cloud?.sid) {
      if (useCloud.getState().cfg.last !== sid) setConfig({ last: sid });
      if (b.fileDoc.cloud?.stub) void loadSheet(sid);
    }
  });
}
