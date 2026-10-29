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
import { SHARED, type CloudProgress, type CustomMark, type Entry, type FileDoc, type Sheet } from '../../model/types';
import { textToVerify, verifyToText } from '../../model/verify';
import { currentOf, isShown, showToast, useStore } from '../../state/store';
import { ensureCols, insertRowsAt, moveRowsSeq, deleteRows, renameTab, deleteTab } from './api';
import { colName } from '../../model/importSel';
import { blankEntry, insertRows, moveRows } from '../../model/cells';
import { applyUpdate, type AlignRow, type NewRow } from '../../model/srcUpdate';
import { insertCol, deleteCols } from './api';
import { ENTRY_HEADERS, readUpd } from '../../data/xlsxio';
import { toFields } from './config';
import type { FieldMap } from '../../model/importSel';
import { textToStd, stdToText } from '../../model/length';
import { backupPresets, ensureProjects, readProjects } from './projects';
import { listDicts, loadEnabled, reloadDicts } from './dicts';
import { writeCell } from './api';
import { commentsToText, composeNote, mergeComments, parseNote, textToComments } from '../../model/comments';
import { fileDone, fileProgress } from '../../model/progress';
import { addTab, appendRows, errText, meta, readCols, readRich, readTabs, sidOf, writeRich, writeRows, type Rich } from './api';
import { blueStart, markToText, noteCell, richSig, stripMarkup, textToMark, tgtCell } from './format';
import { allSheets, configSaved, setConfig, toFieldMap, useCloud, type CloudSheet, type CloudTab, type Conflict, type FieldRange, type Fields } from './config';

export const fidOf = (sid: string) => 'g:' + sid;

/** 外掛自己改軟體裡的檔案（重新讀取、整列操作）時設成 true：監看變動的地方就不會當成使用者的操作 */
let internal = false;
const asInternal = (fn: () => void) => { internal = true; try { fn(); } finally { internal = false; } };

/** 讀過的試算表（重新讀取、寫回只處理這些；還沒點開的只是空殼） */
const loaded = new Set<string>();
const loading = new Set<string>();

const fileOf = (sid: string) => useStore.getState().project?.files.find((f) => f.fid === fidOf(sid));
const confOf = (sid: string) => allSheets().find((x) => x.sid === sid);

/**
 * 這台電腦剛移除的頁簽、條目：在讀資料表的途中移除時，讀回來的可能是移除前的設定，
 * 合併進去才不會又讀回來
 */
const localRemoved = new Map<string, NonNullable<CloudSheet['removed']>>();
function mergeRemoved(a: CloudSheet['removed'], b: CloudSheet['removed']): CloudSheet['removed'] {
  if (!a) return b;
  if (!b) return a;
  const rows: Record<string, string[]> = { ...(a.rows ?? {}) };
  for (const [g, ks] of Object.entries(b.rows ?? {})) rows[g] = [...new Set([...(rows[g] ?? []), ...ks])];
  return { tabs: [...new Set([...(a.tabs ?? []), ...(b.tabs ?? [])])], rows };
}
/** 目前要略過的頁簽、條目（資料表上的加上這台電腦剛移除的） */
const removedOf = (sid: string) => mergeRemoved(confOf(sid)?.removed, localRemoved.get(sid));

/** 重新設定時換成新的移除紀錄（恢復的拿掉；不跟這台電腦之前記的合併） */
export function setRemoved(sid: string, removed: CloudSheet['removed']) {
  if (removed) localRemoved.set(sid, removed); else localRemoved.delete(sid);
}
/** 目前的移除紀錄（重新設定的預覽用） */
export const removedNow = (sid: string) => removedOf(sid);
/** 預覽裡每一條的「ID 第幾個」和它在表上的列（對移除紀錄用） */
export function previewKeys(rows: string[][], fields: FieldMap): { key: string; row: number }[] {
  if (!fields.src) return [];
  const fresh = columnsToEntries(fieldsToColumns(rows, fields));
  return keysOf(fresh).map((key, i) => ({ key, row: fields.src!.rows[i] }));
}

/** 同一個 ID 第幾次出現：讀取時、寫回時都用它對條目和列 */
const keysOf = (entries: { id: string }[]) => {
  const seen = new Map<string, number>();
  return entries.map((e) => { const n = seen.get(e.id) ?? 0; seen.set(e.id, n + 1); return e.id + '\u0000' + n; });
};

// ---- 本機暫存：略過檢查、長度標準等；沒設定 Verso 資料表時，標記、建議翻譯也存這裡 ----
/**
 * unsent：還沒寫回 Google 的譯文、備註（寫回失敗、衝突還沒選就關掉）和當時的比較基準；
 * 下次開啟時放回去，跟 Google 現值比對後照一般流程寫回（Google 上也被改過就跳衝突，不直接蓋）
 */
interface Unsent { tgt?: string; bTgt?: string; bCell?: string; note?: string; comments?: string; bNote?: string; bComments?: string }
type Kept = Pick<Entry, 'mark' | 'keptMark' | 'sugg' | 'ver' | 'skipCheck' | 'skipSugg' | 'lengthStd' | 'pending'> & { unsent?: Unsent };
async function cacheFile(sid: string) {
  const dir = await join(await appDataDir(), 'cloud', 'cache');
  if (!(await exists(dir))) await mkdir(dir, { recursive: true });
  return join(dir, sid + '.json');
}
async function readCache(sid: string): Promise<Record<string, Record<string, Kept>>> {
  try { const f = await cacheFile(sid); return (await exists(f)) ? JSON.parse(await readTextFile(f)) : {}; } catch { return {}; }
}
const cacheTimers = new Map<string, ReturnType<typeof setTimeout>>();
const cacheJobs = new Map<string, () => Promise<void>>();
/** 關閉前：還在等的本機暫存馬上寫 */
export async function saveCachesNow() {
  const jobs = [...cacheJobs.values()];
  cacheTimers.forEach((t) => clearTimeout(t));
  cacheTimers.clear();
  cacheJobs.clear();
  await Promise.all(jobs.map((j) => j()));
}
function saveCacheSoon(doc: FileDoc) {
  const sid = doc.cloud!.sid;
  // 空殼（還沒讀）不寫，免得蓋掉之前記的
  if (doc.cloud!.stub) return;
  clearTimeout(cacheTimers.get(sid));
  const job = async () => {
    cacheJobs.delete(sid);
    const out: Record<string, Record<string, Kept>> = {};
    doc.sheets.forEach((sh) => {
      const keys = keysOf(sh.entries);
      const m: Record<string, Kept> = {};
      sh.entries.forEach((e, i) => {
        const b = base.get(e.uid);
        const unsent: Unsent = {};
        if (b && e.tgt !== b.tgt) Object.assign(unsent, { tgt: e.tgt, bTgt: b.tgt, bCell: b.cell });
        if (b && (e.note !== b.note || commentsToText(e.comments) !== (b.comments ?? ''))) Object.assign(unsent, { note: e.note, comments: commentsToText(e.comments), bNote: b.note, bComments: b.comments ?? '' });
        const hasUnsent = Object.keys(unsent).length > 0;
        if (!e.mark && !e.sugg && !e.ver && !e.skipCheck && !e.skipSugg && !e.lengthStd && !e.keptMark && !hasUnsent) return;
        m[keys[i]] = { mark: e.mark, keptMark: e.keptMark, sugg: e.sugg, ver: e.ver, skipCheck: e.skipCheck, skipSugg: e.skipSugg, lengthStd: e.lengthStd, pending: e.pending, ...(hasUnsent ? { unsent } : {}) };
      });
      out[String(sh.gid)] = m;
    });
    try { await writeTextFile(await cacheFile(sid), JSON.stringify(out)); } catch { /* 下次再寫 */ }
  };
  cacheJobs.set(sid, job);
  cacheTimers.set(sid, setTimeout(() => void job(), 3000));
}

// ---- Verso 資料表 ----
const dataSid = () => sidOf(useCloud.getState().cfg.dataUrl ?? '') ?? '';
const is400 = (e: unknown) => /^400\b/.test(String((e as Error)?.message ?? e));

/** 「Verso檔案」分頁：試算表ID、名稱、專案、欄位設定、更新者、更新時間、長度標準、移除、進度（新欄位一律加在右邊，舊資料不動） */
const FILES_TAB = 'Verso檔案';
const FILES_HEAD = ['試算表ID', '名稱', '專案', '欄位設定', '更新者', '更新時間', '長度標準', '移除', '進度', '全部頁簽'];
const PROGRESS_COL = 8;
const ALL_TABS_COL = 9;
const textToProgress = (t?: string): CloudProgress | undefined => {
  try {
    const x = t ? JSON.parse(t) : null;
    return x && Array.isArray(x.t) && Array.isArray(x.v) ? { t: [Number(x.t[0]) || 0, Number(x.t[1]) || 0], v: [Number(x.v[0]) || 0, Number(x.v[1]) || 0], done: !!x.done } : undefined;
  } catch { return undefined; }
};
let filesHeadLen = 0;
const filesRows = new Map<string, number>();
let filesExists = false;

/** 讀資料表裡記的各檔案設定（同一張資料表的人共用） */
export async function readShared() {
  const did = dataSid();
  if (!did) { useCloud.setState({ shared: [] }); return; }
  let rows: string[][] = [];
  try { [rows] = await readTabs(did, [FILES_TAB]); filesExists = true; } catch (e) { if (!is400(e)) throw e; filesExists = false; }
  filesHeadLen = rows[0]?.length ?? 0;
  filesRows.clear();
  const shared: CloudSheet[] = [];
  rows.forEach((v, r) => {
    if (r === 0 || !v[0]) return;
    try {
      const tabs = JSON.parse(v[3] ?? '') as CloudTab[];
      if (!Array.isArray(tabs)) return;
      filesRows.set(v[0], r);
      let removed: CloudSheet['removed'];
      try { removed = v[7] ? JSON.parse(v[7]) : undefined; } catch { removed = undefined; }
      removed = mergeRemoved(removed, localRemoved.get(v[0]));
      const progress = textToProgress(v[PROGRESS_COL]);
      shared.push({ sid: v[0], title: v[1] ?? '', project: v[2] || SHARED, tabs, ...(v[6] ? { lengthStd: textToStd(v[6]) } : {}), ...(removed ? { removed } : {}), ...(progress ? { progress } : {}), ...(v[ALL_TABS_COL] === '1' ? { allTabs: true } : {}) });
    } catch { /* 壞掉的列不理 */ }
  });
  useCloud.setState({ shared });
}

/** 把一份試算表的設定寫進資料表 */
export async function writeShared(conf: CloudSheet) {
  const did = dataSid();
  if (!did) return;
  await readShared();
  if (!filesExists) { await addTab(did, FILES_TAB, FILES_HEAD.length); await writeRows(did, FILES_TAB, [{ row: 0, values: FILES_HEAD }]); filesExists = true; }
  // 舊版建的分頁欄位比較少：在右邊補欄位、補標題
  else if (filesHeadLen < FILES_HEAD.length) { await ensureCols(did, FILES_TAB, FILES_HEAD.length); await writeRows(did, FILES_TAB, [{ row: 0, values: FILES_HEAD }]); }
  // 進度欄照資料表現在記的寫回去（這裡是整列一起寫）
  const progress = progressSent.get(conf.sid) ?? (conf.progress ? JSON.stringify(conf.progress) : '');
  const values = [conf.sid, conf.title, conf.project, JSON.stringify(conf.tabs), useCloud.getState().email ?? '', new Date().toISOString(), stdToText(conf.lengthStd), conf.removed ? JSON.stringify(conf.removed) : '', progress, conf.allTabs ? '1' : ''];
  const row = filesRows.get(conf.sid);
  if (row !== undefined) await writeRows(did, FILES_TAB, [{ row, values }]);
  else await appendRows(did, FILES_TAB, [values]);
  await readShared();
}

/** 上次寫進資料表的進度（一樣就不再寫） */
const progressSent = new Map<string, string>();
/**
 * 把讀過的檔案的進度（翻譯、驗證模式各自的完成數／總數、整個檔案有沒有打勾）寫進「Verso檔案」分頁，
 * 別人的檔案選單不用打開檔案就看得到。跟資料表記的一樣就不寫
 */
async function writeProgress(sid: string) {
  const did = dataSid();
  const doc = fileOf(sid);
  if (!did || !doc || doc.cloud?.stub) return;
  const t = fileProgress(doc, 'translate'), v = fileProgress(doc, 'verify');
  const text = JSON.stringify({ t: [t.done, t.total], v: [v.done, v.total], done: fileDone(doc) });
  const known = progressSent.get(sid) ?? JSON.stringify(useCloud.getState().shared.find((x) => x.sid === sid)?.progress ?? null);
  if (known === text) return;
  const row = filesRows.get(sid);
  if (row === undefined) return;
  try {
    if (filesHeadLen < FILES_HEAD.length) { await ensureCols(did, FILES_TAB, FILES_HEAD.length); await writeRows(did, FILES_TAB, [{ row: 0, values: FILES_HEAD }]); filesHeadLen = FILES_HEAD.length; }
    await writeCell(did, FILES_TAB, row, PROGRESS_COL, text);
    progressSent.set(sid, text);
  } catch { /* 進度寫不上去不影響工作，下次寫回時再試 */ }
}

/** 每個檔案在資料表裡的分頁（名稱是試算表 ID）：分頁ID、條目ID、第幾個、標記、建議翻譯、修改、譯文、寫入的譯文格、備註藍色起點、更新者、更新時間 */
const DATA_HEAD = ['分頁ID', '條目ID', '第幾個', '標記', '建議翻譯', '修改', '譯文', '寫入的譯文格', '備註藍色起點', '更新者', '更新時間', '原文更新', '留言'];
const D = { mark: 3, sugg: 4, ver: 5, tgt: 6, written: 7, blue: 8, upd: 11, comments: 12 } as const;

/** Google 上這條的原文：R15 新檔案還沒套用新原文時，Google 上已經是新原文 */
const effSrc = (e: Entry) => (e.upd?.cloudNew && e.upd.src !== undefined ? e.upd.src : e.src);
/** 原文更新的狀態存進資料表（R15 的舊原文一起存，換電腦也看得到） */
const updText = (e: Entry) => (e.upd ? JSON.stringify({ u: e.upd, ...(e.upd.cloudNew ? { o: e.src } : {}) }) : '');
function textToUpd(t: string): { u: NonNullable<Entry['upd']>; o?: string } | null {
  if (!t) return null;
  try { const x = JSON.parse(t); return x && typeof x === 'object' && x.u ? x : null; } catch { return null; }
}
interface FileData { rows: Map<string, { row: number; v: string[] }>; exists: boolean; at: number; head?: number }
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
    fd.head = rows[0]?.length ?? 0;
  } catch (e) { if (!is400(e)) throw e; fd.exists = false; }
  fileData.set(sid, fd);
  return fd;
}

/** 這條在資料表裡要存的內容（標記、建議翻譯、修改） */
function dataCore(e: Entry, customs: CustomMark[]) {
  return [markToText(e, customs), e.sugg, verifyToText(e.ver)];
}

interface Base {
  /** Google 上的 ID、發話者、原文（ID 也用來找列：改了 ID 寫回前，用舊的 ID 找） */
  id: string; speaker: string; src: string;
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
  /** 資料表裡這條的留言（上次對上的；合併別人同時留的留言用） */
  comments?: string;
  /** 讀取時這條是「哪個 ID 的第幾個」（移除了別的條目也不會跑掉） */
  key?: string;
}
/** 每條最後一次跟 Google 對上的內容（uid → …）；跟軟體裡的不同代表還沒寫回 */
const base = new Map<string, Base>();
const plainSig = (t: string) => richSig({ text: t, runs: [] });

/**
 * 把一個分頁讀到的內容變成條目；prev 是目前軟體裡的那份（標記、還沒寫回的修改都留著）。
 * rich 是譯文欄的格式（只有需要還原驗證標示時才讀）
 */
function buildSheet(tab: CloudTab, rows: string[][], prev: Sheet | undefined, kept: Record<string, Kept> | undefined, fd: FileData | undefined, rich: Rich[] | undefined, removed: Set<string> = new Set()): Sheet {
  const customs = useStore.getState().project!.customMarks;
  const map = toFieldMap(tab.fields, rows.length - 1);
  const fresh = columnsToEntries(fieldsToColumns(rows, map));
  const keys = keysOf(fresh);
  const old = new Map<string, Entry>();
  if (prev) { const pk = keysOf(prev.entries); prev.entries.forEach((e, i) => old.set(base.get(e.uid)?.key ?? pk[i], e)); }
  const entries = fresh.map((n, i): Entry | null => {
    // 移除的條目：不讀
    if (removed.has(keys[i])) return null;
    const row = map.src!.rows[i];
    const d = fd?.rows.get(dataKey(tab.gid, keys[i]))?.v;
    // 譯文欄是 Verso 寫的驗證標示：還原成原本的譯文（跟寫入時一樣就用資料表記的；被人改過就照格式拿掉標示）
    const written = d?.[D.written] ?? '';
    const tgtRow = map.tgt?.rows[i];
    const composite = !!written && n.tgt === written;
    const rTgt = composite ? d![D.tgt] ?? '' : written && tgtRow !== undefined && rich?.[tgtRow] ? stripMarkup(rich[tgtRow]) : n.tgt;
    const rUpd = textToUpd(d?.[D.upd] ?? '');
    const rMark = textToMark(d?.[D.mark] ?? '', customs);
    const rSugg = d?.[D.sugg] ?? '';
    const rVer = textToVerify(d?.[D.ver] ?? '');
    const blue = d?.[D.blue] ? Number(d[D.blue]) : undefined;
    const rCore = JSON.stringify([d?.[D.mark] ?? '', rSugg, d?.[D.ver] ?? '']);
    const rData = JSON.stringify([...(d ? d.slice(D.mark, D.blue + 1).map((x) => x ?? '') : ['', '', '', '', '', '']), d?.[D.upd] ?? '', d?.[D.comments] ?? '']);
    // 備註：資料表記的留言對上 Google 備註格，分出原備註和留言（Google 上直接打的 [名字] 內容 也算留言）
    const rComments = textToComments(d?.[D.comments]);
    const parsed = parseNote(n.note, rComments);
    const extraNotes = tab.extras?.length ? tab.extras.map((x) => ({ name: x.name, text: rows[row]?.[x.col] ?? '' })) : undefined;
    const o = old.get(keys[i]);
    const b = o ? base.get(o.uid) : undefined;
    let e: Entry;
    /** 留著自己還沒寫回的欄位：那些欄位的比較基準也留舊的，寫回時才比得出 Google 上被人改過（跳衝突，不直接蓋掉） */
    const keep = { tgt: false, note: false, id: false, speaker: false, src: false };
    let unsentBase: Unsent | undefined;
    if (o) {
      // 還沒寫回的譯文、備註、標記等留著；其他跟著 Google
      const tgt = b && o.tgt !== b.tgt ? o.tgt : rTgt;
      keep.tgt = !!b && o.tgt !== b.tgt;
      // 自己的留言、備註還沒寫回：留著；否則照 Google 和資料表
      const localNote = !!b && (o.note !== b.note || commentsToText(o.comments) !== (b.comments ?? ''));
      const note = localNote ? o.note : n.note;
      const comments = localNote ? o.comments : parsed.threads;
      const noteBase = localNote ? o.noteBase : parsed.base;
      keep.note = localNote;
      // ID、發話者、原文：自己改了還沒寫回的留著
      const id = b && o.id !== b.id ? o.id : n.id;
      const speaker = b && o.speaker !== b.speaker ? o.speaker : n.speaker;
      // R15 還沒套用新原文：條目的 src 是舊原文，Google 上的新原文放在 upd.src
      const cloudNew = o.upd?.cloudNew && o.upd.src !== undefined;
      const srcNow = b && effSrc(o) !== b.src ? o.src : cloudNew ? o.src : n.src;
      keep.id = !!b && o.id !== b.id;
      keep.speaker = !!b && o.speaker !== b.speaker;
      keep.src = !!b && effSrc(o) !== b.src;
      const updNow = cloudNew && !(b && effSrc(o) !== b.src) && o.upd!.src !== n.src ? { ...o.upd!, src: n.src } : o.upd;
      const localData = !fd || (b && JSON.stringify(dataCore(o, customs)) !== b.core);
      const marks = localData ? {} : { mark: rMark.mark, keptMark: rMark.keptMark, sugg: rSugg, ver: rVer };
      const next = { ...o, id, speaker, src: srcNow, src0: n.src, tgt, note, upd: updNow, ...marks, comments: sameComments(o.comments, comments) ? o.comments : comments, noteBase,
        extraNotes: JSON.stringify(o.extraNotes) === JSON.stringify(extraNotes) ? o.extraNotes : extraNotes };
      if (!next.extraNotes) delete next.extraNotes;
      if (!next.upd) delete next.upd;
      const same = (Object.keys(next) as (keyof Entry)[]).every((k) => next[k] === o[k]);
      e = same ? o : next;
    } else {
      const { unsent: u, ...k } = kept?.[keys[i]] ?? {};
      e = { ...n, tgt: rTgt, tgt0: rTgt, pending: false, ...k, comments: parsed.threads, noteBase: parsed.base, ...(extraNotes ? { extraNotes } : {}) };
      // 上次沒寫回的譯文、備註：放回去，比較基準用當時的（寫回時 Google 上也被改過就跳衝突）
      if (u?.tgt !== undefined) { e.tgt = u.tgt; keep.tgt = true; }
      if (u?.note !== undefined) { e.note = u.note; e.comments = textToComments(u.comments); keep.note = true; }
      unsentBase = u;
      // 有資料表：標記等以資料表為準（資料表裡還沒有的，用這台電腦之前記的，稍後寫上去）
      if (d) Object.assign(e, { mark: rMark.mark, keptMark: rMark.keptMark, sugg: rSugg, ver: rVer });
      // 原文更新：R15 的條目換回舊原文、新原文放在 upd（Google 上的新原文被人改過就用改過的）
      if (rUpd) {
        if (rUpd.u.cloudNew && rUpd.u.src !== undefined) Object.assign(e, { src: rUpd.o ?? n.src, upd: { ...rUpd.u, src: n.src } });
        else e.upd = rUpd.u;
      }
    }
    const ob = o ? base.get(o.uid) : unsentBase ? {
      id: n.id, speaker: n.speaker, src: n.src, tgt: unsentBase.bTgt ?? rTgt, cell: unsentBase.bCell ?? n.tgt, cellSig: plainSig(unsentBase.bCell ?? n.tgt),
      note: unsentBase.bNote ?? n.note, noteSig: plainSig(unsentBase.bNote ?? n.note), blueFrom: undefined, comments: unsentBase.bComments, row, core: rCore, data: rData,
    } as Base : undefined;
    unsentBase = undefined;
    base.set(e.uid, {
      id: keep.id ? ob!.id : n.id, speaker: keep.speaker ? ob!.speaker : n.speaker, src: keep.src ? ob!.src : n.src,
      ...(keep.tgt ? { tgt: ob!.tgt, cell: ob!.cell, cellSig: ob!.cellSig } : { tgt: rTgt, cell: n.tgt, cellSig: composite ? richSig(tgtCell({ ...e, tgt: rTgt, sugg: rSugg, ver: rVer })) : plainSig(n.tgt) }),
      ...(keep.note ? { note: ob!.note, noteSig: ob!.noteSig, blueFrom: ob!.blueFrom, comments: ob!.comments } : { note: n.note, noteSig: richSig(noteCell(n.note, blue)), blueFrom: blue, comments: commentsToText(d ? rComments : parsed.threads) }),
      row, core: rCore, data: rData, key: keys[i],
    });
    return e;
  }).filter((e): e is Entry => !!e);
  // 空的頁簽：放一條空白條目，讓使用者直接打字（離開時寫進 Google 的第一列資料）
  if (!entries.length) {
    const prevBlank = prev?.entries.length === 1 && (pendingNew.has(prev.entries[0].uid) || placeholders.has(prev.entries[0].uid)) ? prev.entries[0] : undefined;
    const e = prevBlank ?? { ...blankEntry(), pending: false };
    if (!prevBlank) {
      const customs = useStore.getState().project!.customMarks;
      base.set(e.uid, { id: '', speaker: e.speaker, src: '', tgt: '', cell: '', cellSig: plainSig(''), note: '', noteSig: plainSig(''), row: firstRowOf(tab.fields), core: JSON.stringify(dataCore(e, customs)), data: JSON.stringify(['', '', '', '', '', '']) });
      // 佔位的空白條目：Google 上本來就是空的，當成已經寫回，不擋整個檔案重讀（打了字才算還沒寫回）
      placeholders.add(e.uid);
    }
    entries.push(e);
  }
  const same = prev && prev.name === tab.title && prev.entries.length === entries.length && entries.every((e, i) => e === prev.entries[i]);
  return same ? prev! : { name: tab.title, gid: tab.gid, entries };
}

const sameComments = (a: Entry['comments'], b: Entry['comments']) => a === b || commentsToText(a) === commentsToText(b);

/** 有驗證標示被人改過（跟 Verso 寫入時不一樣）的格子：要讀格式才能還原 */
function needRich(tab: CloudTab, rows: string[][], fd: FileData | undefined): boolean {
  if (!fd?.rows.size || !tab.fields.tgt) return false;
  const map = toFieldMap(tab.fields, rows.length - 1);
  const fresh = columnsToEntries(fieldsToColumns(rows, map));
  const keys = keysOf(fresh);
  return fresh.some((n, i) => { const w = fd.rows.get(dataKey(tab.gid, keys[i]))?.v[D.written]; return !!w && n.tgt !== w; });
}

/** 讀一份試算表（點開時、重新讀取時）；回傳有沒有讀到 */
// 同一份正在讀時，再叫一次就等同一次讀完（例如開雲端模式時換檔案觸發的讀取，跟回到上次位置要等的是同一次）
const inflight = new Map<string, Promise<boolean>>();
export function loadSheet(sid: string, quiet = false): Promise<boolean> {
  const now = inflight.get(sid);
  if (now) return now;
  const run = (async () => {
    // 讀的途中有寫回：讀到的是寫回前的舊內容，丟掉重讀（最多三次）
    for (let n = 0; ; n++) {
      const r = await loadSheetInner(sid, quiet, n < 2);
      if (r !== 'again') return r;
    }
  })().finally(() => inflight.delete(sid));
  inflight.set(sid, run);
  return run;
}

/** 每份試算表寫回了幾次：讀取前後不一樣，代表讀的途中有寫回 */
const flushVer = new Map<string, number>();

async function loadSheetInner(sid: string, quiet: boolean, retry: boolean): Promise<boolean | 'again'> {
  const v0 = flushVer.get(sid) ?? 0;
  const conf = confOf(sid);
  if (!conf || loading.has(sid)) return false;
  // 有剛插入、還沒寫進內容的條目：先不重讀（Google 上是空白列，可能讀不到）
  const cur1 = fileOf(sid);
  if (cur1?.sheets.some((sh) => sh.entries.some((e) => pendingNew.has(e.uid) || (placeholders.has(e.uid) && !!(e.id || e.src || e.tgt || e.note))))) return true;
  loading.add(sid);
  try {
    const m = await meta(sid);
    // 分頁改名：跟著 Google 的名稱；被刪掉的分頁不讀
    // 移除的頁簽不讀
    const tabs = conf.tabs.map((t) => ({ ...t, title: m.tabs.find((x) => x.gid === t.gid)?.title ?? '' })).filter((t) => t.title && !removedOf(sid)?.tabs?.includes(t.gid));
    if (m.title !== conf.title || tabs.some((t, i) => t.title !== conf.tabs[i]?.title)) {
      const fixed = { ...conf, title: m.title, tabs: conf.tabs.map((t) => tabs.find((y) => y.gid === t.gid) ?? t) };
      const { cfg, shared } = useCloud.getState();
      if (cfg.sheets.some((x) => x.sid === sid)) setConfig({ sheets: cfg.sheets.map((x) => (x.sid === sid ? fixed : x)) });
      useCloud.setState({ shared: shared.map((x) => (x.sid === sid ? fixed : x)) });
    }
    const values = await readTabs(sid, tabs.map((t) => t.title));
    const fd = await readData(sid, true);
    const rich = await Promise.all(tabs.map((t, i) => (needRich(t, values[i], fd) ? readRich(sid, t.title, t.fields.tgt!.col) : Promise.resolve(undefined))));
    const kept = fileOf(sid) && !fileOf(sid)!.cloud?.stub ? undefined : await readCache(sid);
    // 等正在寫回的做完；讀的途中有寫回（例如改完一條馬上換下一條）的話，這次讀到的是舊值，用了會把剛改的蓋回去，重讀。
    // 這之後到換上新內容之間沒有 await，寫回不會插進來
    await serial(async () => {});
    if (retry && (flushVer.get(sid) ?? 0) !== v0) return 'again';
    const cur0 = fileOf(sid);
    const prev = cur0 && !cur0.cloud?.stub ? cur0 : undefined;
    // 用讀完時最新的移除紀錄（讀的途中可能剛移除了條目或頁簽）
    const rm = removedOf(sid);
    const built = tabs.map((t, i) => (rm?.tabs?.includes(t.gid) ? null : buildSheet(t, values[i], prev?.sheets.find((s) => s.gid === t.gid), kept?.[String(t.gid)], fd, rich[i], new Set(rm?.rows?.[String(t.gid)] ?? []))))
      .filter((x): x is Sheet => !!x);
    // R15 檔：還沒設定欄位的分頁也列出來（空的，點開時選範圍），照 Google 上的順序
    const extra = conf.allTabs ? m.tabs.filter((t) => !conf.tabs.some((c) => c.gid === t.gid) && !rm?.tabs?.includes(t.gid)).map((t): Sheet => {
      const old = prev?.sheets.find((s) => s.gid === t.gid && s.setup && s.name === t.title);
      return old ?? { name: t.title, gid: t.gid, entries: [], setup: true };
    }) : [];
    const order = (g?: number) => m.tabs.findIndex((t) => t.gid === g);
    const sheets = extra.length ? [...built, ...extra].sort((a, b) => order(a.gid) - order(b.gid)) : built;
    if (!sheets.length) return false;
    const p = useStore.getState().project!;
    ensureProjects([conf.project]);
    const project = conf.project || SHARED;
    void p;
    const unchanged = prev && prev.name === m.title && prev.sheets.length === sheets.length && sheets.every((s, i) => s === prev.sheets[i]);
    if (unchanged) { loaded.add(sid); return true; }
    const doc: FileDoc = { ...(cur0 ?? {}), fid: fidOf(sid), cloud: { sid }, name: m.title, project: cur0?.project ?? project, sheets, lengthStd: conf.lengthStd };
    const cur = useStore.getState().project!;
    const at = cur.files.findIndex((f) => f.fid === doc.fid);
    asInternal(() => useStore.setState({ project: { ...cur, files: at >= 0 ? cur.files.map((f, i) => (i === at ? doc : f)) : [...cur.files, doc] } }));
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
  const upd = updText(e);
  const comments = commentsToText(e.comments);
  return { cell, note, blueFrom, row, upd, comments, core: JSON.stringify(dataCore(e, customs)), dataSig: JSON.stringify([...row, upd, comments]) };
}

/** 把改過的譯文、備註、標記等寫回 Google；all：連正在編輯的那條也寫（結束、關掉雲端模式時） */
export function flush(sid: string, all = false): Promise<void> {
  return serial(async () => {
    try { await flushInner(sid, all); } finally { flushVer.set(sid, (flushVer.get(sid) ?? 0) + 1); }
    await writeProgress(sid);
  });
}

async function flushInner(sid: string, all: boolean): Promise<void> {
  // 衝突視窗開著、還沒選：暫停寫回（不寫任何東西回 Google），選完才恢復
  if (useCloud.getState().conflicts.length) return;
  {
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
      // 用 Google 上的 ID 算「第幾個」（自己改了 ID 還沒寫回時，用舊的找列）
      const computed = keysOf(sh.entries.map((e) => ({ id: base.get(e.uid)?.id ?? e.id })));
      // 讀取時記下的「第幾個」為準（移除了同 ID 的別條也不會對錯列）；ID 改過寫回後才用重算的
      const keys = sh.entries.map((e, i) => { const b = base.get(e.uid); return b?.key && b.key.split('\u0000')[0] === b.id ? b.key : computed[i]; });
      const textChanged = (e: Entry, b: Base) => e.id !== b.id || e.speaker !== b.speaker || effSrc(e) !== b.src;
      const changed = sh.entries.map((e, i) => ({ e, key: keys[i], b: base.get(e.uid) }))
        .filter((x): x is { e: Entry; key: string; b: Base } => !!x.b && x.e.uid !== skip && !locked.has(x.e.uid))
        .map((x) => ({ ...x, w: wanted(x.e, x.b, customs, !!did) }))
        .filter(({ e, b, w }) => textChanged(e, b) || richSig(w.cell) !== b.cellSig || richSig(w.note) !== b.noteSig || (!!did && w.dataSig !== b.data));
      if (!changed.length) continue;
      try {
        // 用 ID 重新找列（別人可能插入或刪除了列）
        const cols = [tab.fields.id.col, tab.fields.tgt.col, tab.fields.note?.col ?? tab.fields.tgt.col, tab.fields.speaker?.col ?? tab.fields.tgt.col, tab.fields.src?.col ?? tab.fields.tgt.col];
        const [ids, tgts, notes, speakers, srcs] = await readCols(sid, tab.title, cols);
        const idRows = toFieldMap(tab.fields, Math.max(ids.length, tgts.length) - 1).id!.rows;
        const rowsOf = new Map<string, number[]>();
        idRows.forEach((r) => { const id = (ids[r] ?? '').trim(); if (!rowsOf.has(id)) rowsOf.set(id, []); rowsOf.get(id)!.push(r); });
        const cells: { gid: number; row: number; col: number; rich: Rich }[] = [];
        const done: { e: Entry; key: string; w: ReturnType<typeof wanted>; row: number }[] = [];
        const missing: string[] = [];
        // 留言：資料表現在記的（別人可能同時留了）跟自己的合併
        const fdNow = did && tab.fields.note ? await readData(sid, true) : undefined;
        const merged: Entry[] = [];
        for (const x of changed) {
          const { e: e0, key, b } = x;
          let e = e0, w = x.w;
          if (tab.fields.note) {
            const n = Number(key.split('\u0000')[1]);
            const row0 = b.id.trim() ? rowsOf.get(b.id.trim())?.[n] : b.row;
            const rn0 = row0 !== undefined ? notes[row0] ?? '' : b.note;
            const theirs = parseNote(rn0, textToComments(fdNow?.rows.get(dataKey(sh.gid!, key))?.v[D.comments]));
            const comments = mergeComments(textToComments(b.comments), e.comments ?? [], theirs.threads);
            const note = composeNote(theirs.base, comments);
            if (note !== e.note || !sameComments(comments, e.comments) || theirs.base !== e.noteBase) {
              e = { ...e, note, comments, noteBase: theirs.base };
              merged.push(e);
              w = wanted(e, b, customs, !!did);
            }
          }
          Object.assign(x, { e, w });
        }
        if (merged.length) {
          const byUid = new Map(merged.map((m) => [m.uid, m]));
          const p = useStore.getState().project!;
          asInternal(() => useStore.setState({ project: { ...p, files: p.files.map((f) => (f.fid !== doc.fid ? f : { ...f, sheets: f.sheets.map((s2) => (s2.gid !== sh.gid ? s2 : { ...s2, entries: s2.entries.map((y) => { const m = byUid.get(y.uid); return m ? { ...y, note: m.note, comments: m.comments, noteBase: m.noteBase } : y; }) })) })) } }));
        }
        for (const { e, key, b, w } of changed) {
          const n = Number(key.split('\u0000')[1]);
          // ID 是空的：只能用讀取時的列
          const row = b.id.trim() ? rowsOf.get(b.id.trim())?.[n] : b.row;
          if (row === undefined) { missing.push(b.id || '?'); continue; }
          // ID、發話者、原文：在讀取後被別人改過就先問（ID 是用來找列的，找得到就是沒被改）
          const plain = (v: string) => ({ text: v, runs: [] });
          const sp = (v: string) => (v === '無' ? '' : v);
          const rs = speakers[row] ?? '', rsrc = srcs[row] ?? '';
          if (tab.fields.speaker && e.speaker !== b.speaker && (rs.trim() || '無') !== b.speaker && (rs.trim() || '無') !== e.speaker) { addConflict({ sid, gid: sh.gid!, uid: e.uid, id: e.id, src: e.src, field: 'speaker', mine: e.speaker, theirs: rs }); continue; }
          if (tab.fields.src && effSrc(e) !== b.src && rsrc !== b.src && rsrc !== effSrc(e)) { addConflict({ sid, gid: sh.gid!, uid: e.uid, id: e.id, src: e.src, field: 'src', mine: effSrc(e), theirs: rsrc }); continue; }
          if (e.id !== b.id) cells.push({ gid: sh.gid!, row, col: tab.fields.id.col, rich: plain(e.id) });
          if (tab.fields.speaker && e.speaker !== b.speaker) cells.push({ gid: sh.gid!, row, col: tab.fields.speaker.col, rich: plain(sp(e.speaker)) });
          if (tab.fields.src && effSrc(e) !== b.src) cells.push({ gid: sh.gid!, row, col: tab.fields.src.col, rich: plain(effSrc(e)) });
          const writeCell = richSig(w.cell) !== b.cellSig;
          const writeNote = !!tab.fields.note && richSig(w.note) !== b.noteSig;
          // 這格在讀取後被別人改過：先問（這條先不寫）
          const rc = tgts[row] ?? '', rn = notes[row] ?? '';
          if (writeCell && rc !== b.cell && rc !== w.cell.text) { addConflict({ sid, gid: sh.gid!, uid: e.uid, id: e.id, src: e.src, field: 'tgt', mine: w.cell.text, theirs: rc }); continue; }
          // 備註格：上面已經照 Google 現在的內容合併過留言，不用再問
          if (writeNote && !tab.fields.note && rn !== b.note && rn !== e.note) { addConflict({ sid, gid: sh.gid!, uid: e.uid, id: e.id, src: e.src, field: 'note', mine: e.note, theirs: rn }); continue; }
          if (writeCell) cells.push({ gid: sh.gid!, row, col: tab.fields.tgt.col, rich: w.cell });
          if (writeNote) cells.push({ gid: sh.gid!, row, col: tab.fields.note!.col, rich: w.note });
          done.push({ e, key, w, row });
        }
        await writeRich(sid, cells);
        // 資料表裡這個檔案的分頁：有這條就改那一列，沒有就加在最後（沒有分頁就先建）
        const dataDone = did ? done.filter(({ e, w }) => w.dataSig !== base.get(e.uid)!.data) : [];
        if (dataDone.length) {
          const fd = (await readData(sid, true))!;
          if (!fd.exists) { await addTab(did, sid, DATA_HEAD.length); await writeRows(did, sid, [{ row: 0, values: DATA_HEAD }]); fd.exists = true; fd.head = DATA_HEAD.length; }
          // 舊版建的分頁欄位比較少：在右邊補欄位、補標題（舊資料不動）
          else if ((fd.head ?? 0) < DATA_HEAD.length) { await ensureCols(did, sid, DATA_HEAD.length); await writeRows(did, sid, [{ row: 0, values: DATA_HEAD }]); fd.head = DATA_HEAD.length; }
          const now = new Date().toISOString();
          const updates: { row: number; values: string[] }[] = [];
          const adds: string[][] = [];
          for (const { key, w } of dataDone) {
            const values = [String(sh.gid), ...key.split('\u0000'), ...w.row, who, now, w.upd, w.comments];
            const hit = fd.rows.get(dataKey(sh.gid!, key));
            if (hit) updates.push({ row: hit.row, values }); else adds.push(values);
          }
          await writeRows(did, sid, updates);
          if (adds.length) await appendRows(did, sid, adds);
          fd.at = 0;
        }
        done.forEach(({ e }) => { pendingNew.delete(e.uid); placeholders.delete(e.uid); });
        done.forEach(({ e, w, row }) => base.set(e.uid, {
          ...base.get(e.uid)!, id: e.id, speaker: e.speaker, src: effSrc(e), tgt: e.tgt, cell: w.cell.text, cellSig: richSig(w.cell), note: e.note, noteSig: richSig(w.note), blueFrom: w.blueFrom, row,
          ...(did ? { core: w.core, data: w.dataSig, comments: w.comments } : {}),
        }));
        // 寫回成功：本機暫存裡「還沒寫回」的記錄跟著更新（免得下次開啟又當成沒寫回）
        if (done.length) { const f = fileOf(sid); if (f) saveCacheSoon(f); }
        if (missing.length) showToast(tx('cloud.missingId', { name: sh.name, ids: missing.slice(0, 5).join(tx('common.sep')) }), { warn: true });
      } catch (e) {
        const msg = tx('cloud.writeFailed', { name: doc.name, reason: errText(e) });
        useCloud.setState({ syncError: msg });
        showToast(msg, { warn: true });
      }
    }
  }
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
    else if (c.field === 'note') base.set(c.uid, { ...b, note: c.theirs, noteSig: plainSig(c.theirs) });
    else if (c.field === 'speaker') base.set(c.uid, { ...b, speaker: c.theirs.trim() || '無' });
    else base.set(c.uid, { ...b, src: c.theirs });
    await flush(c.sid, true);
    return;
  }
  // 用對方的：軟體裡的改回上次讀到的，再重新讀（不直接把格子的文字當成譯文）
  const doc = fileOf(c.sid);
  const si = doc?.sheets.findIndex((s) => s.gid === c.gid) ?? -1;
  if (doc && si >= 0) useStore.getState().aiPatch(doc.fid!, si, c.uid, (e) => ({ ...e, [c.field]: b[c.field] }));
  await loadSheet(c.sid, true);
}

/** 同步：先寫回，再重新讀取（only：只同步這一份；不指定時連資料表裡的檔案清單也重讀）；同步按鈕、定時、回到 Verso 時用 */
export async function refreshAll(quiet = true, only?: string) {
  if (useCloud.getState().syncing) return;
  useCloud.setState({ syncing: true, syncError: '' });
  let ok = true;
  try {
    if (!only) { try { await readShared(); ensureStubs(); await readProjects(); await reloadDicts(); } catch (e) { ok = false; useCloud.setState({ syncError: tx('cloud.loadFailed', { name: tx('cloud.dataUrl'), reason: errText(e) }) }); } }
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
  ensureProjects(sheets.map((x) => x.project || SHARED));
  const progressOf = (sid: string) => useCloud.getState().shared.find((y) => y.sid === sid)?.progress;
  // 還沒讀的檔案：進度換成資料表最新記的
  const files = p.files.map((f) => {
    if (!f.cloud?.stub) return f;
    const pr = progressOf(f.cloud.sid);
    return JSON.stringify(pr ?? null) === JSON.stringify(f.cloud.progress ?? null) ? f : { ...f, cloud: { ...f.cloud, progress: pr } };
  });
  if (files.some((f, i) => f !== p.files[i])) useStore.setState({ project: { ...p, files } });
  const add = sheets.filter((x) => !p.files.some((f) => f.fid === fidOf(x.sid))).map((x): FileDoc => ({
    fid: fidOf(x.sid), cloud: { sid: x.sid, stub: true, ...(progressOf(x.sid) ? { progress: progressOf(x.sid) } : {}) }, name: x.title || x.sid,
    project: x.project || SHARED, lengthStd: x.lengthStd,
    sheets: x.tabs.filter((t) => !x.removed?.tabs?.includes(t.gid)).map((t) => ({ name: t.title, gid: t.gid, entries: [] })),
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

/** 打開雲端模式：列出全部試算表（空殼），換到上次打開的那份，只讀那一份；step 回報進度（啟動畫面用） */
export async function enterCloud(step: (p: number, text: string) => void = () => {}) {
  step(0.1, tx('cloud.boot1'));
  try {
    await readShared();
    // 這台電腦之前自己設定、資料表裡還沒有的：補寫進去，別人也看得到
    const shared = useCloud.getState().shared;
    if (dataSid()) for (const x of useCloud.getState().cfg.sheets) if (!shared.some((y) => y.sid === x.sid)) await writeShared(x);
  } catch (e) { showToast(tx('cloud.loadFailed', { name: tx('cloud.dataUrl'), reason: errText(e) }), { warn: true }); }
  ensureStubs();
  step(0.35, tx('cloud.boot2'));
  // 專案（字典檔、預設長度標準）、常用標準、雲端字典的頁簽名稱（勾選的才讀內容）
  try { backupPresets(); await readProjects(); await listDicts(); loadEnabled(); } catch (e) { showToast(tx('cloud.loadFailed', { name: tx('cloud.dataUrl'), reason: errText(e) }), { warn: true }); }
  const { last, lastPos } = useCloud.getState().cfg;
  // 上次的檔案不在了：留空（不自動換到別的檔案）
  if (last && fileOf(last)) selectSheet(last); else if (!last) pickShown();
  const sid = currentSid();
  step(0.65, tx('cloud.boot3'));
  if (sid && fileOf(sid)?.cloud?.stub) await loadSheet(sid);
  if (sid && lastPos?.sid === sid) restorePos(lastPos);
  step(1, tx('cloud.boot3'));
}

/** 回到上次停的頁簽與條目；頁簽不在就到上一個頁簽，條目不在就到上一條（不跳提示） */
function restorePos(pos: NonNullable<CloudConfigPos>) {
  const s = useStore.getState();
  const doc = s.project?.files[s.file];
  if (!doc || doc.cloud?.sid !== pos.sid || doc.cloud.stub || !doc.sheets.length) return;
  let sh = doc.sheets.findIndex((x) => x.gid === pos.gid);
  let i = 0;
  if (sh < 0) sh = Math.max(0, Math.min(pos.tab - 1, doc.sheets.length - 1));
  else {
    const es = doc.sheets[sh].entries;
    if (es[pos.index]?.id === pos.id) i = pos.index;
    else {
      // 條目前後移動了：找同一個 id 裡最靠近的；找不到就是被刪了，停在上一條
      let best = -1;
      es.forEach((e, k) => { if (e.id === pos.id && pos.id && (best < 0 || Math.abs(k - pos.index) < Math.abs(best - pos.index))) best = k; });
      i = best >= 0 ? best : Math.max(0, Math.min(pos.index - 1, es.length - 1));
    }
  }
  useStore.setState({ sheetBy: { ...s.sheetBy, [s.file]: sh }, selBy: { ...s.selBy, [s.file + ':' + sh]: i } });
}
type CloudConfigPos = ReturnType<typeof useCloud.getState>['cfg']['lastPos'];

/** 記下目前停的位置（換條目後稍等一下、結束前） */
export function rememberPos(): Promise<void> {
  const s = useStore.getState();
  if (!s.cloudMode || !s.project) return Promise.resolve();
  const { fileDoc, sheetIdx, sheet, sel, entry } = currentOf(s);
  const sid = fileDoc.cloud?.sid;
  if (!sid || fileDoc.cloud?.stub) return Promise.resolve();
  const pos = { sid, gid: sheet.gid ?? -1, tab: sheetIdx, index: sel, id: entry?.id ?? '' };
  const old = useCloud.getState().cfg.lastPos;
  if (!old || JSON.stringify(old) !== JSON.stringify(pos)) setConfig({ last: sid, lastPos: pos });
  return configSaved();
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
      now.forEach((f, sid) => {
        const was = last.get(sid);
        if (was === f) return;
        dirty.push(sid);
        saveCacheSoon(f);
        // 「新版已移除」的條目套用了（軟體裡不見了）：Google 上那一列也刪掉
        if (!internal && was && !was.cloud?.stub && !f.cloud?.stub) {
          for (const sh of f.sheets) {
            const old = was.sheets.find((x) => x.gid === sh.gid);
            if (!old || old.entries === sh.entries) continue;
            const now = new Set(sh.entries.map((e) => e.uid));
            const gone = old.entries.filter((e) => e.upd?.removed && !now.has(e.uid));
            if (gone.length) void deleteRemoved(sid, sh.gid!, gone);
          }
        }
        // 檔案的長度標準、專案改了：記進資料表（大家共用）
        if (was && !f.cloud?.stub && !was.cloud?.stub && (stdToText(was.lengthStd) !== stdToText(f.lengthStd) || was.project !== f.project)) void saveSheetMeta(sid, f);
      });
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
    if (a.fileDoc.cloud && a.entry && a.entry.uid !== b.entry?.uid) {
      // 剛插入的條目離開時還是空白：不用再等它寫入
      const e = a.entry;
      if (pendingNew.has(e.uid) && !e.id && !e.src && !e.tgt && !e.note) pendingNew.delete(e.uid);
      void flush(a.fileDoc.cloud.sid);
    }
    // 換到別的雲端檔案：記下來（下次先開這份）；是空殼就讀
    const sid = b.fileDoc.cloud?.sid;
    if (sid && sid !== a.fileDoc.cloud?.sid) {
      if (useCloud.getState().cfg.last !== sid) setConfig({ last: sid });
      if (b.fileDoc.cloud?.stub) void loadSheet(sid);
    }
  });
}

/** 檔案的長度標準、專案改了：更新這台電腦和資料表裡的設定（管理專案搬檔案也用） */
export async function saveSheetMeta(sid: string, f: FileDoc) {
  const conf = confOf(sid);
  if (!conf) return;
  const next = { ...conf, project: f.project, lengthStd: f.lengthStd };
  const { cfg, shared } = useCloud.getState();
  if (cfg.sheets.some((x) => x.sid === sid)) setConfig({ sheets: cfg.sheets.map((x) => (x.sid === sid ? next : x)) });
  useCloud.setState({ shared: shared.map((x) => (x.sid === sid ? next : x)) });
  try { await writeShared(next); } catch (e) { showToast(tx('cloud.writeFailed', { name: f.name, reason: errText(e) }), { warn: true }); }
}

// ---- 整列操作：刪除、插入、上移、下移（馬上改 Google 上的列，不能 Ctrl+Z） ----
/** 剛插入、還沒寫進內容的條目（Google 上是空白列，重新讀取時可能讀不到，先不重讀那份） */
const pendingNew = new Set<string>();
/** 空頁簽裡佔位的空白條目（還沒打字前不算還沒寫回） */
const placeholders = new Set<string>();

/** Google 上插入或刪除了列：記下來的欄位範圍跟著移（插入 delta 為正，刪除為 -1） */
function shiftFields(fields: Fields, at: number, delta: number): Fields {
  const out = {} as Fields;
  (Object.keys(fields) as (keyof Fields)[]).forEach((k) => {
    const f = fields[k];
    if (!f) { out[k] = null; return; }
    const runs = f.runs.flatMap(([a, b]): [number, number][] => {
      if (delta > 0) return a >= at ? [[a + delta, b + delta]] : at <= b + 1 ? [[a, b + delta]] : [[a, b]];
      if (a > at) return [[a - 1, b - 1]];
      if (at <= b) return b - 1 >= a ? [[a, b - 1]] : [];
      return [[a, b]];
    });
    out[k] = runs.length ? { ...f, runs } : null;
  });
  return out;
}

/** 一份試算表某個分頁的欄位範圍改了：更新這台電腦和資料表裡的設定 */
async function saveTabFields(sid: string, gid: number, fields: Fields) {
  const conf = confOf(sid);
  if (!conf) return;
  const next = { ...conf, tabs: conf.tabs.map((t) => (t.gid === gid ? { ...t, fields } : t)) };
  const { cfg, shared } = useCloud.getState();
  if (cfg.sheets.some((x) => x.sid === sid)) setConfig({ sheets: cfg.sheets.map((x) => (x.sid === sid ? next : x)) });
  useCloud.setState({ shared: shared.map((x) => (x.sid === sid ? next : x)) });
  try { await writeShared(next); } catch { /* 下次存設定時再寫 */ }
}

/** 這個分頁其他條目在 Google 上的列跟著移 */
function remapRows(entries: Entry[], map: (r: number) => number) {
  entries.forEach((e) => { const b = base.get(e.uid); if (b) base.set(e.uid, { ...b, row: map(b.row) }); });
}

/** 右鍵的整列操作（雲端檔案）：接手時回傳 true */
export function rowOp(kind: 'delete' | 'insert' | 'up' | 'down', rows: number[], count: number): boolean {
  const s = useStore.getState();
  const { fileDoc, sheet, sheetIdx } = currentOf(s);
  const sid = fileDoc.cloud?.sid;
  const tab = sid ? confOf(sid)?.tabs.find((t) => t.gid === sheet.gid) : undefined;
  if (!sid || fileDoc.cloud?.stub || !tab) return false;
  const at = { file: s.file, sheet: sheetIdx };
  const gid = tab.gid;
  const sorted = [...rows].sort((a, b) => a - b);
  const fail = (e: unknown) => showToast(tx('cloud.writeFailed', { name: fileDoc.name, reason: errText(e) }), { warn: true });
  const done = () => useStore.getState().dropUndo(fidOf(sid));
  void (async () => {
    try {
      // 先把還沒寫回的寫回去，列的位置才對得上
      await flush(sid, true);
      const entries = currentOf(useStore.getState()).sheet.entries;
      const rowOf = (i: number) => base.get(entries[i]?.uid)?.row;
      if (kind === 'delete') {
        const list = sorted.map((i) => ({ i, row: rowOf(i) })).filter((x): x is { i: number; row: number } => x.row !== undefined);
        if (!list.length) return;
        // 刪之前先給使用者看 Google 上這幾列的全部內容（用標題列的名稱）
        const [vals] = await readTabs(sid, [tab.title]);
        const first = Math.min(...(Object.values(tab.fields).filter(Boolean) as FieldRange[]).map((f) => f.runs[0][0]));
        const head = first > 0 ? vals[first - 1] ?? [] : [];
        const preview = list.map((x) => ({ row: x.row, cells: (vals[x.row] ?? []).map((v, c): [string, string] => [head[c]?.trim() || colName(c), v]).filter(([, v]) => v.trim()) }));
        useCloud.setState({ askDelete: { title: tx('cloud.deleteRowsAsk', { n: list.length }), rows: preview, run: async () => {
          try {
            await deleteRows(sid, gid, list.map((x) => x.row));
            let fields = tab.fields;
            for (const r of [...list].sort((a, b) => b.row - a.row)) {
              fields = shiftFields(fields, r.row, -1);
              remapRows(currentOf(useStore.getState()).sheet.entries, (y) => (y > r.row ? y - 1 : y));
            }
            asInternal(() => useStore.getState().editSheet((es) => ({ entries: es.filter((e) => !list.some((x) => entries[x.i]?.uid === e.uid)), keys: [] }), at, true));
            done();
            await saveTabFields(sid, gid, fields);
          } catch (e) { fail(e); }
        } } });
        return;
      }
      if (kind === 'insert') {
        const last = sorted[sorted.length - 1];
        const r0 = (rowOf(last) ?? (tab.fields.src?.runs[0][0] ?? 1) - 1) + 1;
        const n = Math.max(1, count);
        await insertRowsAt(sid, gid, r0, n);
        remapRows(entries, (y) => (y >= r0 ? y + n : y));
        asInternal(() => useStore.getState().editSheet((es) => ({ entries: insertRows(es, last, n), keys: [] }), at, true));
        // 新的條目：Google 上是空白列，內容在離開那條時寫入
        const now = currentOf(useStore.getState()).sheet.entries.slice(last + 1, last + 1 + n);
        const customs = useStore.getState().project!.customMarks;
        now.forEach((e, j) => {
          base.set(e.uid, {
            id: '', speaker: e.speaker, src: '', tgt: '', cell: '', cellSig: plainSig(''), note: '', noteSig: plainSig(''), row: r0 + j,
            core: JSON.stringify(dataCore(e, customs)), data: JSON.stringify(['', '', '', '', '', '']),
          });
          pendingNew.add(e.uid);
        });
        done();
        await saveTabFields(sid, gid, shiftFields(tab.fields, r0, n));
        return;
      }
      // 上移、下移：照條目欄的做法一步一步跟旁邊那條換位置，Google 上也一樣搬
      const dir = kind === 'up' ? -1 : 1;
      if ((dir < 0 && sorted[0] === 0) || (dir > 0 && sorted[sorted.length - 1] === entries.length - 1)) return;
      const pos = entries.map((_, i) => rowOf(i));
      if (sorted.some((i) => pos[i] === undefined || pos[i + dir] === undefined)) return;
      const moves: { from: number; to: number }[] = [];
      const apply = (map: (r: number) => number) => { for (let k = 0; k < pos.length; k++) if (pos[k] !== undefined) pos[k] = map(pos[k]!); };
      for (const i of dir < 0 ? sorted : [...sorted].reverse()) {
        const a = pos[i]!, b = pos[i + dir]!;
        if (dir < 0) { moves.push({ from: a, to: b }); apply((r) => (r === a ? b : r >= b && r < a ? r + 1 : r)); }
        else { moves.push({ from: a, to: b + 1 }); apply((r) => (r === a ? b : r > a && r <= b ? r - 1 : r)); }
        [pos[i], pos[i + dir]] = [pos[i + dir], pos[i]];
      }
      await moveRowsSeq(sid, gid, moves);
      const r = moveRows(entries, sorted, dir);
      r.entries.forEach((e, k) => { const b = base.get(e.uid); if (b && pos[k] !== undefined) base.set(e.uid, { ...b, row: pos[k]! }); });
      asInternal(() => useStore.getState().editSheet(() => ({ entries: r.entries, keys: r.rows.flatMap((k) => [0, 1, 2, 3].map((c) => k + ':' + c)) }), at, true));
      done();
    } catch (e) { fail(e); }
  })();
  return true;
}

// ---- 頁簽：新增、改名、刪除（馬上改 Google 試算表的分頁） ----
/** 這個分頁的資料從第幾列開始、標題列是哪一列 */
const firstRowOf = (fields: Fields) => Math.min(...(Object.values(fields).filter(Boolean) as FieldRange[]).map((f) => f.runs[0][0]));

/** 一份試算表的分頁設定改了：更新這台電腦和資料表裡的設定 */
async function saveTabs(sid: string, tabs: CloudTab[]) {
  const conf = confOf(sid);
  if (!conf) return;
  const next = { ...conf, tabs };
  const { cfg, shared } = useCloud.getState();
  if (cfg.sheets.some((x) => x.sid === sid)) setConfig({ sheets: cfg.sheets.map((x) => (x.sid === sid ? next : x)) });
  useCloud.setState({ shared: shared.map((x) => (x.sid === sid ? next : x)) });
  try { await writeShared(next); } catch { /* 下次存設定時再寫 */ }
}

/** 頁簽改名：直接改 Google 上的分頁名稱 */
export function tabRename(i: number, name: string): boolean {
  const s = useStore.getState();
  const { fileDoc } = currentOf(s);
  const sid = fileDoc.cloud?.sid;
  const sh = fileDoc.sheets[i];
  const conf = sid ? confOf(sid) : undefined;
  if (!sid || !conf || sh?.gid === undefined) return false;
  void (async () => {
    try {
      await renameTab(sid, sh.gid!, name);
      await saveTabs(sid, conf.tabs.map((t) => (t.gid === sh.gid ? { ...t, title: name } : t)));
      useStore.getState().renameSheet(i, name);
    } catch (e) { showToast(tx('cloud.writeFailed', { name: fileDoc.name, reason: errText(e) }), { warn: true }); }
  })();
  return true;
}

/** 刪除頁簽：先預覽 Google 上這個分頁的內容，確認後刪掉分頁 */
export function tabDelete(i: number): boolean {
  const s = useStore.getState();
  const { fileDoc } = currentOf(s);
  const fileIdx = s.file;
  const sid = fileDoc.cloud?.sid;
  const sh = fileDoc.sheets[i];
  const conf = sid ? confOf(sid) : undefined;
  if (!sid || !conf || sh?.gid === undefined) return false;
  void (async () => {
    try {
      await flush(sid, true);
      const [vals] = await readTabs(sid, [sh.name]);
      const PREVIEW = 30;
      const rows = vals.slice(0, PREVIEW).map((v, r) => ({ row: r, cells: v.map((x, c): [string, string] => [colName(c), x]).filter(([, x]) => x.trim()) })).filter((r) => r.cells.length);
      useCloud.setState({ askDelete: { title: tx('cloud.deleteTabAsk', { name: sh.name, n: vals.length }), rows, run: async () => {
        try {
          await deleteTab(sid, sh.gid!);
          await saveTabs(sid, conf.tabs.filter((t) => t.gid !== sh.gid));
          const st = useStore.getState();
          if (st.file === fileIdx) asInternal(() => st.deleteSheet(i));
          useStore.getState().dropUndo(fidOf(sid));
        } catch (e) { showToast(tx('cloud.writeFailed', { name: fileDoc.name, reason: errText(e) }), { warn: true }); }
      } } });
    } catch (e) { showToast(tx('cloud.loadFailed', { name: sh.name, reason: errText(e) }), { warn: true }); }
  })();
  return true;
}

/** 新增頁簽：在 Google 試算表新增分頁，標題列和欄位位置照目前這個頁簽；貼入的內容一起寫進去 */
export function tabInsert(after: number, sheets: { name: string; entries: Entry[] }[]): boolean {
  const s = useStore.getState();
  const { fileDoc } = currentOf(s);
  const sid = fileDoc.cloud?.sid;
  const conf = sid ? confOf(sid) : undefined;
  const tpl = conf?.tabs.find((t) => t.gid === fileDoc.sheets[after]?.gid) ?? conf?.tabs[0];
  if (!sid || !conf || !tpl) return false;
  void (async () => {
    try {
      await flush(sid, true);
      const [tplRows] = await readTabs(sid, [tpl.title]);
      const start = firstRowOf(tpl.fields);
      const fcols = (Object.values(tpl.fields).filter(Boolean) as FieldRange[]).map((f) => f.col);
      const width = Math.max(...fcols, ...(start > 0 ? [(tplRows[start - 1]?.length ?? 1) - 1] : [])) + 1;
      const tabs = [...conf.tabs];
      const at = tabs.findIndex((t) => t.gid === tpl.gid);
      for (const [k, sh] of sheets.entries()) {
        const gid = await addTab(sid, sh.name, width);
        // 標題列以上照原本的頁簽，條目從同一列開始寫
        const head = tplRows.slice(0, start).map((r) => Array.from({ length: width }, (_, c) => r[c] ?? ''));
        const body = sh.entries.filter((e) => e.id || e.src || e.tgt || e.note || e.speaker !== '無').map((e) => {
          const r = Array.from({ length: width }, () => '');
          const put = (f: FieldRange | null, v: string) => { if (f) r[f.col] = v; };
          put(tpl.fields.id, e.id); put(tpl.fields.speaker, e.speaker === '無' ? '' : e.speaker); put(tpl.fields.src, e.src); put(tpl.fields.tgt, e.tgt); put(tpl.fields.note, e.note);
          return r;
        });
        const all = [...head, ...body];
        if (all.length) {
          // 新分頁只有一列：列數不夠時接在後面長出來
          await writeRows(sid, sh.name, all.slice(0, 1).map((values) => ({ row: 0, values })));
          if (all.length > 1) await appendRows(sid, sh.name, all.slice(1));
        }
        const fields = {} as Fields;
        (Object.keys(tpl.fields) as (keyof Fields)[]).forEach((key) => { const f = tpl.fields[key]; fields[key] = f ? { col: f.col, runs: [[start, start + Math.max(0, body.length - 1)]], open: true } : null; });
        tabs.splice(at + 1 + k, 0, { gid, title: sh.name, fields });
      }
      await saveTabs(sid, tabs);
      await loadSheet(sid, false);
      useStore.getState().dropUndo(fidOf(sid));
    } catch (e) { showToast(tx('cloud.writeFailed', { name: fileDoc.name, reason: errText(e) }), { warn: true }); }
  })();
  return true;
}

/** 「新版已移除」的條目套用了（軟體裡刪掉了）：Google 上那一列也刪掉 */
async function deleteRemoved(sid: string, gid: number, gone: Entry[]) {
  const conf = confOf(sid);
  const tab = conf?.tabs.find((t) => t.gid === gid);
  if (!tab?.fields.id) return;
  try {
    const [ids] = await readCols(sid, tab.title, [tab.fields.id.col]);
    const rows: number[] = [];
    for (const e of gone) {
      const b = base.get(e.uid);
      if (!b) continue;
      // 讀取時的列還是同一個 ID 就刪那列，不然找第一個同 ID 的列
      const r = (ids[b.row] ?? '') === b.id ? b.row : ids.findIndex((x, k) => k >= firstRowOf(tab.fields) && x === b.id && !rows.includes(k));
      if (r >= 0 && !rows.includes(r)) rows.push(r);
      base.delete(e.uid);
    }
    if (!rows.length) return;
    await deleteRows(sid, gid, rows);
    let fields = tab.fields;
    const doc = fileOf(sid);
    const sh = doc?.sheets.find((x) => x.gid === gid);
    for (const r of [...rows].sort((a, b) => b - a)) {
      fields = shiftFields(fields, r, -1);
      if (sh) remapRows(sh.entries, (y) => (y > r ? y - 1 : y));
    }
    await saveTabFields(sid, gid, fields);
  } catch (e) { showToast(tx('cloud.writeFailed', { name: tab.title, reason: errText(e) }), { warn: true }); }
}

// ---- 更新原文（雲端模式）：套用到原本那份 Google 表 ----
/**
 * 一個頁簽的比對結果套用到軟體裡，並把新版多出來的句子插進 Google 上（ID、發話者、原文寫入）；
 * 有改的句子先暫存新原文，按「套用新原文」才寫回
 */
export async function applyCloudUpdate(sid: string, sheetIdx: number, out: Entry[]) {
  const s = useStore.getState();
  const fi = s.project?.files.findIndex((f) => f.fid === fidOf(sid)) ?? -1;
  const doc = s.project?.files[fi];
  const sh = doc?.sheets[sheetIdx];
  const tab = sh ? confOf(sid)?.tabs.find((t) => t.gid === sh.gid) : undefined;
  if (!doc || !sh || !tab) return;
  await flush(sid, true);
  asInternal(() => useStore.getState().editSheet(() => ({ entries: out, keys: [] }), { file: fi, sheet: sheetIdx }, true));
  let fields = tab.fields;
  let prevRow = firstRowOf(fields) - 1;
  const customs = useStore.getState().project!.customMarks;
  for (let i = 0; i < out.length;) {
    const b = base.get(out[i].uid);
    if (b) { prevRow = b.row; i++; continue; }
    // 新版多出來的一段：插在前一句在 Google 上的列後面
    let j = i;
    while (j < out.length && !base.get(out[j].uid)) j++;
    const n = j - i, at = prevRow + 1;
    await insertRowsAt(sid, tab.gid, at, n);
    remapRows(out.filter((e) => base.has(e.uid)), (y) => (y >= at ? y + n : y));
    fields = shiftFields(fields, at, n);
    out.slice(i, j).forEach((e, k) => base.set(e.uid, {
      id: '', speaker: '無', src: '', tgt: '', cell: '', cellSig: plainSig(''), note: '', noteSig: plainSig(''), row: at + k,
      core: JSON.stringify(dataCore({ ...e, mark: '', sugg: '', ver: undefined }, customs)), data: JSON.stringify(['', '', '', '', '', '', '']),
    }));
    prevRow = at + n - 1;
    i = j;
  }
  await saveTabFields(sid, tab.gid, fields);
  useStore.getState().dropUndo(fidOf(sid));
  await flush(sid, true);
}

// ---- R15：用新連結建一個新檔案，原本的檔案不動 ----
export interface R15Tab {
  /** 原本檔案的頁簽 */
  sheetIdx: number;
  /** 新連結的分頁 */
  gid: number; title: string; rows: string[][];
  /** 選的 ID、發話者、原文範圍 */
  fields: FieldMap;
  /** 比對結果 */
  align: AlignRow[]; next: NewRow[];
}

/** 建 R15 檔案：新連結的分頁照選的範圍，譯文從原本的檔案帶過去，改過的原文標「原文更新」可以看舊原文 */
export async function createR15(sid: string, link: string, linkTitle: string, tabs: R15Tab[]) {
  const conf = confOf(sid);
  const doc = fileOf(sid);
  if (!conf || !doc) return;
  await flush(sid, true);
  const did = dataSid();
  const who = useCloud.getState().email ?? '';
  const now = new Date().toISOString();
  const newTabs: CloudTab[] = [];
  const dataRows: string[][] = [];
  for (const t of tabs) {
    const sh = doc.sheets[t.sheetIdx];
    const old = conf.tabs.find((x) => x.gid === sh.gid);
    if (!old) continue;
    // 標題列：在選的範圍上面一列；譯文、備註照原本頁簽的標題名稱找
    const first = Math.min(...(['id', 'speaker', 'src'] as const).map((k) => t.fields[k]?.rows[0] ?? Infinity));
    const head = first > 0 ? t.rows[first - 1] ?? [] : [];
    const [oldRows] = await readTabs(sid, [old.title]);
    const oldFirst = firstRowOf(old.fields);
    const oldHead = oldFirst > 0 ? oldRows[oldFirst - 1] ?? [] : [];
    const nameAt = (f: FieldRange | null) => (f ? (oldHead[f.col] ?? '').trim() : '');
    const findCol = (name: string) => (name ? head.findIndex((h) => (h ?? '').trim() === name) : -1);
    let fields = { ...t.fields };
    let tgtCol = findCol(nameAt(old.fields.tgt));
    const noteCol = findCol(nameAt(old.fields.note));
    if (tgtCol < 0) {
      // 找不到譯文欄：在原文右邊插入一欄（標題照原本的頁簽）
      tgtCol = t.fields.src!.col + 1;
      await insertCol(link, t.gid, tgtCol);
      (Object.keys(fields) as (keyof FieldMap)[]).forEach((k) => { const f = fields[k]; if (f && f.col >= tgtCol) fields[k] = { ...f, col: f.col + 1 }; });
      if (first > 0 && nameAt(old.fields.tgt)) await writeRich(link, [{ gid: t.gid, row: first - 1, col: tgtCol, rich: { text: nameAt(old.fields.tgt), runs: [] } }]);
    }
    const srcRows = fields.src!.rows;
    fields = { ...fields, tgt: { col: tgtCol, rows: srcRows }, note: noteCol >= 0 ? { col: noteCol + (noteCol >= tgtCol && tgtCol === t.fields.src!.col + 1 && findCol(nameAt(old.fields.tgt)) < 0 ? 1 : 0), rows: srcRows } : null };
    // 譯文帶過去；原文有改的記成「原文更新」（新原文已經在 Google 上，舊原文存進資料表）
    const out = applyUpdate(sh.entries, t.next, t.align, { id: true, speaker: true });
    const cells: { gid: number; row: number; col: number; rich: Rich }[] = [];
    const newIds = t.next.map((n) => n.id);
    const occ = keysOf(newIds.map((id) => ({ id })));
    t.align.forEach((r) => {
      if (r.old === null || r.new === null) return;
      const e = sh.entries[r.old];
      if (e.tgt) cells.push({ gid: t.gid, row: srcRows[r.new], col: tgtCol, rich: { text: e.tgt, runs: [] } });
      const o = out.find((x) => x.uid === e.uid);
      if (o?.upd?.src !== undefined) {
        const upd = JSON.stringify({ u: { src: o.upd.src, cloudNew: true }, o: e.src });
        dataRows.push([String(t.gid), ...occ[r.new].split('\u0000'), '', '', '', '', '', '', who, now, upd]);
      }
    });
    await writeRich(link, cells);
    newTabs.push({ gid: t.gid, title: t.title, fields: toFields(fields, t.rows.length - 1) });
  }
  // 原檔其他的頁簽不搬過去：R15 表保持原樣；R15 表上沒選範圍的分頁（例如對照用）照樣列出來，點開時選範圍
  // 原文更新的狀態寫進資料表（新檔案的分頁）
  if (did && dataRows.length) {
    const fd = await readData(link, true);
    if (fd && !fd.exists) { await addTab(did, link, DATA_HEAD.length); await writeRows(did, link, [{ row: 0, values: DATA_HEAD }]); }
    await appendRows(did, link, dataRows);
    fileData.delete(link);
  }
  await putSheet({ sid: link, title: linkTitle, project: conf.project, tabs: newTabs, lengthStd: conf.lengthStd, allTabs: true });
}

// ---- 移除：Verso 不再讀取這些頁簽、條目（Google 上不動），紀錄存在資料表，同專案的人都不會再讀到 ----
async function saveRemoved(sid: string, removed: NonNullable<CloudSheet['removed']>) {
  // 先重讀共用設定，免得把別人剛存的移除紀錄蓋掉
  await readShared();
  const conf = confOf(sid);
  if (!conf) return;
  localRemoved.set(sid, mergeRemoved(localRemoved.get(sid), removed)!);
  const next = { ...conf, removed: mergeRemoved(conf.removed, removed) };
  const { cfg, shared } = useCloud.getState();
  if (cfg.sheets.some((x) => x.sid === sid)) setConfig({ sheets: cfg.sheets.map((x) => (x.sid === sid ? next : x)) });
  useCloud.setState({ shared: shared.map((x) => (x.sid === sid ? next : x)) });
  await writeShared(next);
}

/** 移除條目（選了哪幾條就整條移除） */
export function removeRows(rows: number[]): boolean {
  const s = useStore.getState();
  const { fileDoc, sheet, sheetIdx } = currentOf(s);
  const sid = fileDoc.cloud?.sid;
  const conf = sid ? confOf(sid) : undefined;
  if (!sid || !conf || sheet.gid === undefined || fileDoc.cloud?.stub) return false;
  const pick = rows.map((i) => sheet.entries[i]).filter(Boolean);
  if (!pick.length) return true;
  const at = { file: s.file, sheet: sheetIdx };
  useCloud.setState({ confirm: { title: tx('cloud.removeRowsAsk', { n: pick.length }), body: tx('cloud.removeRowsBody'), ok: tx('cloud.removeOk'), run: async () => {
    try {
      await flush(sid, true);
      const keys = pick.map((e) => base.get(e.uid)?.key).filter((k): k is string => !!k);
      const g = String(sheet.gid);
      await saveRemoved(sid, { rows: { [g]: keys } });
      const gone = new Set(pick.map((e) => e.uid));
      asInternal(() => useStore.getState().editSheet((es) => ({ entries: es.filter((e) => !gone.has(e.uid)), keys: [] }), at, true));
      useStore.getState().dropUndo(fidOf(sid));
    } catch (e) { showToast(tx('cloud.writeFailed', { name: fileDoc.name, reason: errText(e) }), { warn: true }); }
  } } });
  return true;
}

/** 移除頁簽 */
export function tabRemove(i: number): boolean {
  const s = useStore.getState();
  const { fileDoc } = currentOf(s);
  const fileIdx = s.file;
  const sid = fileDoc.cloud?.sid;
  const sh = fileDoc.sheets[i];
  const conf = sid ? confOf(sid) : undefined;
  if (!sid || !conf || sh?.gid === undefined || fileDoc.cloud?.stub) return false;
  if (fileDoc.sheets.length <= 1) { showToast(tx('cloud.removeLastTab'), { warn: true }); return true; }
  useCloud.setState({ confirm: { title: tx('cloud.removeTabAsk', { name: sh.name }), body: tx('cloud.removeTabBody'), ok: tx('cloud.removeOk'), run: async () => {
    try {
      await flush(sid, true);
      await saveRemoved(sid, { tabs: [sh.gid!] });
      const st = useStore.getState();
      if (st.file === fileIdx) asInternal(() => st.deleteSheet(i));
      useStore.getState().dropUndo(fidOf(sid));
    } catch (e) { showToast(tx('cloud.writeFailed', { name: fileDoc.name, reason: errText(e) }), { warn: true }); }
  } } });
  return true;
}

// ---- Verso 存檔格式的表：轉成雲端檔 ----
const VERSO_KEEP = ['#', '發話者', '原文', '譯文', '備註'];
/** 分頁是不是 Verso 的存檔格式（第一列是 Verso 的欄位標題） */
export function isVersoTab(rows: string[][]) {
  const h = (rows[0] ?? []).map((x) => x.trim());
  return h[0] === '#' && h[1] === '發話者' && h[2] === '原文' && h[3] === '譯文' && h.includes('備註') && rows.length > 1;
}

/**
 * 把 Verso 存檔格式的分頁轉成雲端檔：標記、建議翻譯、驗證修改、原文更新寫進 Verso 資料表，
 * 表上這些 Verso 用的欄刪掉（只留 #、發話者、原文、譯文、備註和使用者自己的欄）。回傳刪欄後的欄位範圍
 */
export async function convertVersoTab(sid: string, gid: number, title: string, rows: string[][]): Promise<FieldMap> {
  const did = dataSid();
  const head = rows[0].map((x) => x.trim());
  const col = (n: string) => head.indexOf(n);
  const get = (r: string[], n: string) => (col(n) >= 0 ? r[col(n)] ?? '' : '');
  const body = rows.slice(1);
  const keys = keysOf(body.map((r) => ({ id: r[0] ?? '' })));
  const customs = useStore.getState().project!.customMarks;
  const who = useCloud.getState().email ?? '';
  const now = new Date().toISOString();
  if (did) {
    const out: string[][] = [];
    body.forEach((r, i) => {
      const raw = get(r, '標記編號').trim();
      // 標記：內建的用代號；自訂的用名稱（每台電腦的自訂標記編號不一樣）
      const mark = ['verified', 'doubt', 'think', 'ignore', 'ai'].includes(raw) ? raw : raw.startsWith('c:') ? (get(r, '標記').trim() ? '#' + get(r, '標記').trim() : '') : '';
      const sugg = get(r, '建議翻譯');
      const ver = verifyToText(textToVerify(get(r, '驗證修改')));
      const upd = readUpd(get(r, '原文更新'));
      if (!mark && !sugg && !ver && !upd) return;
      void customs;
      out.push([String(gid), ...keys[i].split('\u0000'), mark, sugg, ver, '', '', '', who, now, upd ? JSON.stringify({ u: upd }) : '']);
    });
    if (out.length) {
      const fd = await readData(sid, true);
      if (fd && !fd.exists) { await addTab(did, sid, DATA_HEAD.length); await writeRows(did, sid, [{ row: 0, values: DATA_HEAD }]); }
      await appendRows(did, sid, out);
      fileData.delete(sid);
    }
  }
  // 表上 Verso 用的欄刪掉
  const drop = head.map((h, c) => (ENTRY_HEADERS.includes(h) && !VERSO_KEEP.includes(h) ? c : -1)).filter((c) => c >= 0);
  if (did) await deleteCols(sid, gid, drop);
  const left = did ? head.filter((_, c) => !drop.includes(c)) : head;
  const data = body.map((_, i) => i + 1);
  const at = (n: string) => (left.indexOf(n) >= 0 ? { col: left.indexOf(n), rows: data } : null);
  void title;
  return { id: at('#'), speaker: at('發話者'), src: at('原文'), tgt: at('譯文'), note: at('備註') };
}
