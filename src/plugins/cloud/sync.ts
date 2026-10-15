// 雲端檔案的讀取與寫回：
// - 讀：設定過的分頁照欄位範圍變成條目（同一個 ID 第幾次出現，就對到同一條，標記等留著）
// - 寫：譯文跟上次讀到的不同就寫回（正在編輯的那條等離開才寫），寫之前用 ID 重新找列，
//   那格在讀取後被別人改過就先問「用我的／用對方的」
// - 每分鐘重新讀一次，看到別人的修改
import { appDataDir, join } from '@tauri-apps/api/path';
import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { tx } from '../../i18n';
import { fieldsToColumns } from '../../model/importSel';
import { columnsToEntries } from '../../model/paste';
import { SHARED, type Entry, type FileDoc, type Sheet } from '../../model/types';
import { currentOf, isShown, showToast, useStore } from '../../state/store';
import { errText, meta, readCols, readTabs, writeCells } from './api';
import { setConfig, toFieldMap, useCloud, type CloudSheet, type CloudTab, type Conflict } from './config';

export const fidOf = (sid: string) => 'g:' + sid;

/** 每條最後一次跟 Google 對上的內容（uid → 譯文、備註）；譯文不同代表還沒寫回 */
const base = new Map<string, { tgt: string; note: string; row: number }>();
/** 讀過的試算表（重新讀取、寫回只處理這些） */
const loaded = new Set<string>();

const fileOf = (sid: string) => useStore.getState().project?.files.find((f) => f.fid === fidOf(sid));
const confOf = (sid: string) => useCloud.getState().cfg.sheets.find((x) => x.sid === sid);

/** 同一個 ID 第幾次出現：讀取時、寫回時都用它對條目和列 */
const keysOf = (entries: { id: string }[]) => {
  const seen = new Map<string, number>();
  return entries.map((e) => { const n = seen.get(e.id) ?? 0; seen.set(e.id, n + 1); return e.id + '\u0000' + n; });
};

// ---- 本機暫存：標記、我的備註、建議翻譯等（之後改存到共用的「Verso 資料表」） ----
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

/** 把一個分頁讀到的內容變成條目；prev 是目前軟體裡的那份（標記、還沒寫回的譯文都留著） */
function buildSheet(tab: CloudTab, rows: string[][], prev: Sheet | undefined, kept: Record<string, Kept> | undefined): Sheet {
  const map = toFieldMap(tab.fields, rows.length - 1);
  const fresh = columnsToEntries(fieldsToColumns(rows, map));
  const keys = keysOf(fresh);
  const old = new Map<string, Entry>();
  if (prev) { const pk = keysOf(prev.entries); prev.entries.forEach((e, i) => old.set(pk[i], e)); }
  const entries = fresh.map((n, i) => {
    const row = map.src!.rows[i];
    const o = old.get(keys[i]);
    const b = o ? base.get(o.uid) : undefined;
    if (o) {
      // 還沒寫回的譯文、改過的備註留著；其他跟著 Google
      const tgt = b && o.tgt !== b.tgt ? o.tgt : n.tgt;
      const note = b && o.note !== b.note ? o.note : n.note;
      base.set(o.uid, { tgt: n.tgt, note: n.note, row });
      const same = o.id === n.id && o.speaker === n.speaker && o.src === n.src && o.tgt === tgt && o.note === note;
      return same ? o : { ...o, id: n.id, speaker: n.speaker, src: n.src, src0: n.src, tgt, note };
    }
    const k = kept?.[keys[i]];
    const e: Entry = { ...n, pending: false, ...(k ?? {}) };
    base.set(e.uid, { tgt: n.tgt, note: n.note, row });
    return e;
  });
  const same = prev && prev.name === tab.title && prev.entries.length === entries.length && entries.every((e, i) => e === prev.entries[i]);
  return same ? prev! : { name: tab.title, gid: tab.gid, entries };
}

/** 讀一份試算表（第一次或重新讀取）；回傳有沒有讀到 */
export async function loadSheet(sid: string, quiet = false): Promise<boolean> {
  const conf = confOf(sid);
  if (!conf) return false;
  try {
    const m = await meta(sid);
    // 分頁改名：跟著 Google 的名稱；被刪掉的分頁不讀
    const tabs = conf.tabs.map((t) => ({ ...t, title: m.tabs.find((x) => x.gid === t.gid)?.title ?? '' })).filter((t) => t.title);
    if (m.title !== conf.title || tabs.some((t, i) => t.title !== conf.tabs[i]?.title)) {
      setConfig({ sheets: useCloud.getState().cfg.sheets.map((x) => (x.sid === sid ? { ...x, title: m.title, tabs: conf.tabs.map((t) => tabs.find((y) => y.gid === t.gid) ?? t) } : x)) });
    }
    const values = await readTabs(sid, tabs.map((t) => t.title));
    const prev = fileOf(sid);
    const kept = prev ? undefined : await readCache(sid);
    const sheets = tabs.map((t, i) => buildSheet(t, values[i], prev?.sheets.find((s) => s.gid === t.gid), kept?.[String(t.gid)]));
    if (!sheets.length) return false;
    const p = useStore.getState().project!;
    const project = p.projects.includes(conf.project) ? conf.project : SHARED;
    const unchanged = prev && prev.name === m.title && prev.sheets.length === sheets.length && sheets.every((s, i) => s === prev.sheets[i]);
    if (unchanged) { loaded.add(sid); return true; }
    const doc: FileDoc = { ...(prev ?? {}), fid: fidOf(sid), cloud: { sid }, name: m.title, project: prev?.project ?? project, sheets };
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

/** 把改過的譯文寫回 Google；all：連正在編輯的那條也寫（結束、關掉雲端模式時） */
export function flush(sid: string, all = false): Promise<void> {
  return serial(async () => {
    const doc = fileOf(sid);
    const conf = confOf(sid);
    if (!doc || !conf) return;
    const skip = all ? undefined : editingUid();
    const locked = new Set(useStore.getState().aiLocked);
    for (const sh of doc.sheets) {
      const tab = conf.tabs.find((t) => t.gid === sh.gid);
      if (!tab?.fields.tgt || !tab.fields.id) continue;
      const keys = keysOf(sh.entries);
      const changed = sh.entries.map((e, i) => ({ e, key: keys[i] })).filter(({ e }) => e.uid !== skip && !locked.has(e.uid) && base.has(e.uid) && e.tgt !== base.get(e.uid)!.tgt);
      if (!changed.length) continue;
      try {
        // 用 ID 重新找列（別人可能插入或刪除了列）
        const [ids, tgts] = await readCols(sid, tab.title, [tab.fields.id.col, tab.fields.tgt.col]);
        const idMap = toFieldMap({ ...tab.fields }, Math.max(ids.length, tgts.length) - 1).id!;
        const rowsOf = new Map<string, number[]>();
        idMap.rows.forEach((r) => { const id = (ids[r] ?? '').trim(); if (!rowsOf.has(id)) rowsOf.set(id, []); rowsOf.get(id)!.push(r); });
        const cells: { title: string; row: number; col: number; value: string }[] = [];
        const wrote: { uid: string; tgt: string; row: number }[] = [];
        const missing: string[] = [];
        for (const { e, key } of changed) {
          const n = Number(key.split('\u0000')[1]);
          // ID 是空的：只能用讀取時的列
          const row = e.id.trim() ? rowsOf.get(e.id.trim())?.[n] : base.get(e.uid)!.row;
          if (row === undefined) { missing.push(e.id || '?'); continue; }
          const remote = tgts[row] ?? '';
          const b = base.get(e.uid)!;
          if (remote !== b.tgt && remote !== e.tgt) {
            addConflict({ sid, gid: sh.gid!, uid: e.uid, id: e.id, src: e.src, mine: e.tgt, theirs: remote });
            continue;
          }
          cells.push({ title: tab.title, row, col: tab.fields.tgt.col, value: e.tgt });
          wrote.push({ uid: e.uid, tgt: e.tgt, row });
        }
        await writeCells(sid, cells);
        wrote.forEach((w) => base.set(w.uid, { ...base.get(w.uid)!, tgt: w.tgt, row: w.row }));
        if (missing.length) showToast(tx('cloud.missingId', { name: sh.name, ids: missing.slice(0, 5).join(tx('common.sep')) }), { warn: true });
      } catch (e) {
        showToast(tx('cloud.writeFailed', { name: doc.name, reason: errText(e) }), { warn: true });
      }
    }
  });
}

function addConflict(c: Conflict) {
  const list = useCloud.getState().conflicts;
  if (list.some((x) => x.uid === c.uid)) return;
  useCloud.setState({ conflicts: [...list, c] });
}

/** 解決一個衝突：mine 用我的（寫回去），否則用對方的（改掉軟體裡的譯文） */
export async function resolveConflict(c: Conflict, mine: boolean) {
  useCloud.setState({ conflicts: useCloud.getState().conflicts.filter((x) => x.uid !== c.uid) });
  const b = base.get(c.uid);
  if (!b) return;
  if (mine) {
    // 對方的內容當成已經看過的，再寫一次就不會又問
    base.set(c.uid, { ...b, tgt: c.theirs });
    await flush(c.sid, true);
    return;
  }
  base.set(c.uid, { ...b, tgt: c.theirs });
  const doc = fileOf(c.sid);
  const si = doc?.sheets.findIndex((s) => s.gid === c.gid) ?? -1;
  if (doc && si >= 0) useStore.getState().aiPatch(doc.fid!, si, c.uid, (e) => ({ ...e, tgt: c.theirs }));
}

/** 同步：先寫回，再重新讀取（only：只同步這一份）；同步按鈕、定時、回到 Verso 時用 */
export async function refreshAll(quiet = true, only?: string) {
  if (useCloud.getState().syncing) return;
  useCloud.setState({ syncing: true, syncError: '' });
  let ok = true;
  try {
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

/** 不再使用這份試算表（Google 上的不動） */
export async function removeSheet(sid: string) {
  await flush(sid, true);
  loaded.delete(sid);
  setConfig({ sheets: useCloud.getState().cfg.sheets.filter((x) => x.sid !== sid) });
  const i = useStore.getState().project?.files.findIndex((f) => f.fid === fidOf(sid)) ?? -1;
  if (i >= 0) useStore.getState().deleteFile(i);
}

/** 新設定或重新設定一份試算表 */
export async function putSheet(conf: CloudSheet) {
  const sheets = useCloud.getState().cfg.sheets;
  setConfig({ sheets: sheets.some((x) => x.sid === conf.sid) ? sheets.map((x) => (x.sid === conf.sid ? conf : x)) : [...sheets, conf] });
  // 重新設定：欄位可能換了，整份重讀
  const i = useStore.getState().project?.files.findIndex((f) => f.fid === fidOf(conf.sid)) ?? -1;
  if (i >= 0) { await flush(conf.sid, true); loaded.delete(conf.sid); useStore.getState().deleteFile(i); }
  if (await loadSheet(conf.sid)) selectSheet(conf.sid);
}

export function selectSheet(sid: string) {
  const i = useStore.getState().project?.files.findIndex((f) => f.fid === fidOf(sid)) ?? -1;
  if (i >= 0) useStore.getState().setFile(i);
}

/** 打開雲端模式：讀全部設定過的試算表，換到第一個 */
export async function enterCloud() {
  for (const x of useCloud.getState().cfg.sheets) if (!loaded.has(x.sid)) await loadSheet(x.sid);
  pickShown();
}

/** 目前的檔案在這個模式看不到：換到看得到的第一個 */
export function pickShown() {
  const s = useStore.getState();
  const f = s.project?.files[s.file];
  if (f && isShown(s, f)) return;
  const i = s.project?.files.findIndex((x) => isShown(s, x)) ?? -1;
  if (i >= 0) s.setFile(i);
}

/** 軟體裡的雲端檔案有變動：稍後寫回，並記下本機暫存；被換掉（例如換存檔資料夾）的放回去 */
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
      const lost = [...last.keys()].filter((sid) => !now.has(sid) && loaded.has(sid) && confOf(sid));
      if (lost.length) {
        const p = s.project;
        useStore.setState({ project: { ...p, files: [...p.files, ...lost.map((sid) => last.get(sid)!)] } });
        return;
      }
      last = now;
      if (dirty.length) { clearTimeout(flushTimer); flushTimer = setTimeout(() => dirty.forEach((sid) => void flush(sid)), 2000); }
    }
    // 離開某一條：那條馬上寫回
    const a = currentOf(prev), b = currentOf(s);
    if (a.fileDoc.cloud && a.entry && a.entry.uid !== b.entry?.uid) void flush(a.fileDoc.cloud.sid);
  });
}
