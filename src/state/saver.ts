// 存檔控制：啟動時載入、偵測修改、自動存檔、Ctrl+S、關閉或切換檔案時詢問。
// 自動存檔只寫「暫存復原」（存檔資料夾裡的隱藏資料夾），正式的 xlsx 只在手動儲存時才寫；
// 選「不儲存」就退回上次手動儲存的內容。字典不受影響，改了就馬上存。
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { io } from '../data/fsio';
import { withFontDefaults } from '../model/fonts';
import { MAX_CELL_CHARS, nameKey } from '../model/names';
import { migrateList, migrateSheets } from '../model/shortcuts';
import {
  clearRecovery, findRootConflicts, saveRootFor, mergeMarks, readFolderMeta, safeName as safeFileName, scanFolder, loadConfig, loadWorkspace, readDict, readDictFull, readRecovery, reloadFile, saveConfig, sortProjects, trashDict, trashFile, trashProject, writeDict, writeFile, writeMeta, writeRecovery,
  type AppConfig, type LastPosition, type RecoveryState,
} from '../data/persist';
import { emptyHistory } from '../model/history';
import { editsOf, verifyToText } from '../model/verify';
import { dictKey, newFileId, type CustomMark, type DictInfo, type FileDoc, type GlossaryTerm, type ProjectData } from '../model/types';
import { currentOf, showToast, useStore, type SaveError } from './store';
import { checkAtStartup } from './updater';
import type { RootConflict } from '../data/persist';

/** 軟體內部認檔案用 ID；檔名、專案只是顯示和存檔位置 */
const fileKey = (f: FileDoc) => f.fid ?? f.project + '/' + f.name;

/** 上次存檔時的內容（資料都是不可變更新，所以比對參照就知道有沒有改過） */
let saved = {
  files: new Map<string, FileDoc>(),
  customs: null as CustomMark[] | null,
  dicts: new Map<string, string>(),
  projects: [] as string[],
};
let lastAttempt = 0;
let closing = false;

// 暫存復原：已經寫進去的檔案內容（依檔案 key）與清單；recPending 代表有新的變動還沒暫存
let rec = { files: new Map<string, FileDoc>(), state: '' };
let recPending = false;
let recSince = 0;
/** 暫存復原刪不掉時記下來（狀態照樣重設，下次存檔或開啟時會再試） */
const warnClear = (e: unknown) => { console.warn('清除暫存復原失敗', e); };
const resetRec = () => { rec = { files: new Map(), state: '' }; recPending = false; };
/** 暫存復原裡每個檔案內容的檔名 */
const recName = (f: FileDoc) => (f.fid ?? fileKey(f)).replace(/[\\/:*?"<>|]/g, '_') + '.json';

/** 自動存檔：把跟上次手動儲存不同的內容寫進暫存復原（只寫有改過的檔案） */
async function autosave() {
  const s = useStore.getState();
  const p = s.project;
  if (!p || !s.saveRoot) return;
  recPending = false;
  if (!isDirty()) {
    // 改回跟正式檔一樣了：暫存復原用不到
    if (rec.state) { await clearRecovery(s.saveRoot).catch(warnClear); resetRec(); }
    return;
  }
  const files: RecoveryState['files'] = [];
  const changed: { data: string; file: FileDoc }[] = [];
  const keep = new Map<string, FileDoc>();
  for (const f of p.files) {
    const k = fileKey(f);
    const same = saved.files.get(k) === f;
    const data = same ? undefined : recName(f);
    files.push({ key: k, project: f.project, name: f.name, ...(f.fid ? { fid: f.fid } : {}), ...(data ? { data } : {}) });
    if (!data) continue;
    keep.set(k, f);
    if (rec.files.get(k) !== f) changed.push({ data, file: f });
  }
  const state: RecoveryState = { files, projects: p.projects, customMarks: p.customMarks, nextMarkId: p.nextMarkId };
  const sig = JSON.stringify(state);
  if (!changed.length && sig === rec.state) return;
  try {
    await writeRecovery(s.saveRoot, state, changed);
    rec = { files: keep, state: sig };
  } catch { recPending = true; /* 下次再試 */ }
}

/** 馬上寫一次暫存復原（例如更新前） */
export function autosaveNow(): Promise<void> {
  return serial(autosave);
}

/** 有變動：稍後自動存檔（管理專案之類的操作用） */
export function requestAutosave() {
  recPending = true; recSince = 0;
}

const dictSignature = (terms: GlossaryTerm[], did = '') => JSON.stringify([did, ...terms.map((t) => [t.term, t.en, t.note])]);
/** 各本字典的 ID（依「專案/字典」） */
const dictIds = (p: ProjectData) => new Map(p.dicts.map((d) => [dictKey(d.project, d.name), d.did ?? '']));

/** 依「專案/字典」分組的詞條；沒有詞條的字典也算一組 */
function dictGroups(p: ProjectData) {
  const groups = new Map<string, GlossaryTerm[]>();
  p.dicts.forEach((d) => groups.set(dictKey(d.project, d.name), []));
  p.glossary.forEach((t) => {
    const k = dictKey(t.proj, t.dict);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(t);
  });
  return groups;
}

/**
 * 記下「正式檔目前的內容」。字典的已存紀錄只在真的寫進字典檔時才更新，
 * 所以平常不動（withDicts 只在剛從硬碟讀進來時用）。
 */
function markSaved(p: ProjectData, withDicts = false) {
  saved = {
    files: new Map(p.files.map((f) => [fileKey(f), f])),
    customs: p.customMarks,
    dicts: withDicts ? new Map([...dictGroups(p)].map(([d, t]) => [d, dictSignature(t, dictIds(p).get(d))])) : saved.dicts,
    projects: p.projects,
  };
}

const warnedLong = new Set<string>();

/** 存檔失敗的原因，翻成看得懂的話（Windows 的錯誤代碼） */
export function saveReason(e: unknown): string {
  const m = String((e as { message?: string })?.message ?? e);
  if (/os error 32|os error 33|being used by another process|used by another/i.test(m)) return '檔案被其他程式開著（例如 Excel），關掉後會自動重試';
  if (/os error 5\b|access is denied|permission denied/i.test(m)) return '沒有寫入權限';
  if (/os error 123|os error 161|invalid filename|syntax is incorrect/i.test(m)) return '名稱不合法';
  if (/os error 112|not enough space|no space/i.test(m)) return '磁碟空間不足';
  if (/os error (2|3)\b|cannot find|not found/i.test(m)) return '找不到存檔資料夾';
  return m.length > 80 ? m.slice(0, 80) + '…' : m;
}

/** Excel 一格最多 32767 字；超過的格子列出位置 */
function longCellsOf(f: FileDoc): string[] {
  const out: string[] = [];
  f.sheets.forEach((sh) => sh.entries.forEach((e, i) => {
    // 程式用的欄位（驗證修改、原文更新）也會寫進格子，一樣有字數上限
    const cells = [e.id, e.speaker, e.src, e.tgt, e.note, e.sugg, e.src0, e.tgt0,
      e.ver ? verifyToText({ ...e.ver, base: e.tgt, edits: editsOf(e) }) : '', e.upd ? JSON.stringify(e.upd) : ''];
    if (cells.some((c) => c.length > MAX_CELL_CHARS)) out.push(`${f.project} / ${f.name} / ${sh.name} #${e.id || i + 1}`);
  }));
  return out;
}

/** 檔案有沒有還沒存的修改（字典另外存，不算在這裡） */
export function isDirty(): boolean {
  const p = useStore.getState().project;
  if (!p) return false;
  if (p.customMarks !== saved.customs || p.projects !== saved.projects) return true;
  if (saved.files.size !== p.files.length) return true;
  return p.files.some((f) => saved.files.get(fileKey(f)) !== f);
}

/** 字典有沒有還沒存的修改 */
function dictsDirty(): boolean {
  const p = useStore.getState().project;
  if (!p) return false;
  const groups = dictGroups(p);
  if (saved.dicts.size !== groups.size) return true;
  const ids = dictIds(p);
  return [...groups].some(([d, t]) => saved.dicts.get(d) !== dictSignature(t, ids.get(d)));
}

// 存檔一次只做一件事：檔案和字典的存檔排隊進行，避免同時寫入、互相蓋掉「已存」的紀錄
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

function lastPosition(): LastPosition | undefined {
  const s = useStore.getState();
  if (!s.project || !s.project.files.length) return undefined;
  const { fileDoc, sheet, sel, entry } = currentOf(s);
  return { project: fileDoc.project, file: fileDoc.name, sheet: sheet.name, index: sel, id: entry?.id ?? '' };
}

/** 存檔。成功回傳 true；檔案被 Excel 開著之類的失敗會標成「未存檔」，之後自動重試 */
export function saveNow(): Promise<boolean> {
  return serial(saveNowInner);
}

/** 存檔本身（已經在排隊裡時直接呼叫，避免排隊等自己） */
async function saveNowInner(): Promise<boolean> {
  {
    const ok = await saveAll();
    const s = useStore.getState();
    if (ok && !isDirty()) {
      // 正式檔已經是最新的：記下這個版本（含檔案順序），刪掉暫存復原
      if (s.project) markSaved(s.project);
      await clearRecovery(s.saveRoot).catch(warnClear);
      resetRec();
    } else {
      // 還有沒存進去的修改：暫存復原馬上改成只剩這些
      requestAutosave();
    }
    return ok;
  }
}

/** 字典改了就馬上存（新增詞條、新字典、修改字典），不等自動存檔 */
export function saveDicts(): Promise<boolean> {
  return serial(async () => {
    const s = useStore.getState();
    const p = s.project;
    if (!p || !s.saveRoot || !dictsDirty()) return true;
    const errors: SaveError[] = [];
    const dicts = new Map(saved.dicts);
    const groups = dictGroups(p);
    for (const k of saved.dicts.keys()) {
      if (groups.has(k)) continue;
      const i = k.indexOf('/');
      // 整個專案被刪掉時，交給檔案存檔一起處理
      if (!p.projects.includes(k.slice(0, i))) continue;
      try { await trashDict(s.saveRoot, k.slice(0, i), k.slice(i + 1)); dicts.delete(k); } catch (e) { errors.push({ target: '字典 ' + k, reason: saveReason(e) }); }
    }
    const ids = dictIds(p);
    for (const [k, terms] of groups) {
      const sig = dictSignature(terms, ids.get(k));
      if (saved.dicts.get(k) === sig) continue;
      const i = k.indexOf('/');
      try { await writeDict(s.saveRoot, k.slice(0, i), k.slice(i + 1), terms, ids.get(k)); dicts.set(k, sig); } catch (e) { errors.push({ target: '字典 ' + k, reason: saveReason(e) }); }
    }
    saved = { ...saved, dicts };
    if (errors.length) useStore.setState({ saveStatus: 'error', saveErrors: errors });
    return !errors.length;
  });
}

async function saveAll(): Promise<boolean> {
  const s = useStore.getState();
  const p = s.project;
  if (!p || !s.saveRoot) return true;
  lastAttempt = Date.now();
  useStore.setState({ saveStatus: 'saving' });
  let ok = true;
  const errors: SaveError[] = [];
  const fail = (target: string, e: unknown) => { ok = false; errors.push({ target, reason: saveReason(e) }); };
  const done = { files: new Map(saved.files), customs: saved.customs, dicts: new Map(saved.dicts), projects: saved.projects };
  // 刪掉（或搬走）的專案、檔案、字典移到資源回收筒
  const gone = saved.projects.filter((x) => !p.projects.includes(x));
  for (const x of gone) { try { await trashProject(s.saveRoot, x); } catch (e) { fail('專案資料夾「' + x + '」', e); } }
  const byKey = new Map(p.files.map((f) => [fileKey(f), f]));
  for (const [k, f] of saved.files) {
    if (byKey.has(k)) continue;
    try { if (!gone.includes(f.project)) await trashFile(s.saveRoot, f.project, f.name); done.files.delete(k); } catch (e) { fail(`${f.project} / ${f.name}`, e); }
  }
  const groups = dictGroups(p);
  for (const k of saved.dicts.keys()) {
    if (groups.has(k)) continue;
    const i = k.indexOf('/');
    try { if (!gone.includes(k.slice(0, i))) await trashDict(s.saveRoot, k.slice(0, i), k.slice(i + 1)); done.dicts.delete(k); } catch (e) { fail('字典 ' + k, e); }
  }
  // 還沒有檔案時不必建立專案資料夾（只存字典）
  if (p.files.length || saved.files.size || p.projects !== saved.projects) {
    const customsChanged = p.customMarks !== saved.customs;
    const long: string[] = [];
    // 改名、搬專案的舊位置：等所有檔案都寫好之後才移走（兩個檔案互換名稱時，舊位置正好是另一個檔案的新位置）
    const moved: FileDoc[] = [];
    for (const f of p.files) {
      // 自訂標記改了名稱也要重寫，因為「標記」欄寫的是名稱
      if (saved.files.get(fileKey(f)) === f && !customsChanged) continue;
      long.push(...longCellsOf(f));
      const old = saved.files.get(fileKey(f));
      try {
        await writeFile(s.saveRoot, f, p.customMarks);
        done.files.set(fileKey(f), f);
        // 改了名稱或搬了專案：記下舊位置（只差大小寫時是同一個檔案，不用移）
        if (old && diskKey(old.project, old.name) !== diskKey(f.project, f.name) && !gone.includes(old.project)) moved.push(old);
      } catch (e) { fail(`${f.project} / ${f.name}`, e); }
    }
    // 舊位置移到資源回收筒；正好是現在某個檔案的位置就不動
    const taken = new Set(p.files.map((f) => diskKey(f.project, f.name)));
    for (const old of moved) {
      if (taken.has(diskKey(old.project, old.name))) continue;
      await trashFile(s.saveRoot, old.project, old.name).catch(() => undefined);
    }
    // 新出現的超長格子才提示，同一格不重複提示
    const fresh = long.filter((x) => !warnedLong.has(x));
    fresh.forEach((x) => warnedLong.add(x));
    if (fresh.length) useStore.setState({ longCells: fresh });
    try { await writeMeta(s.saveRoot, p, lastPosition()); if (ok) { done.customs = p.customMarks; done.projects = p.projects; } } catch (e) { fail('專案設定檔', e); }
  }
  const ids = dictIds(p);
  for (const [k, terms] of groups) {
    const sig = dictSignature(terms, ids.get(k));
    if (saved.dicts.get(k) === sig) continue;
    const i = k.indexOf('/');
    try { await writeDict(s.saveRoot, k.slice(0, i), k.slice(i + 1), terms, ids.get(k)); done.dicts.set(k, sig); } catch (e) { fail('字典 ' + k, e); }
  }
  saved = done;
  const dirty = isDirty();
  useStore.setState({ saveStatus: !ok ? 'error' : dirty ? 'dirty' : 'saved', saveErrors: errors });
  return ok;
}

/** 手動存檔（儲存鈕、Ctrl+S）：存好後在畫面中間提示 */
export async function manualSave() {
  const ok = await saveNow();
  if (ok) useStore.setState((s) => ({ toast: { text: '已儲存', k: (s.toast?.k ?? 0) + 1 } }));
}

// ---- 設定檔 ----
let config: AppConfig = {};
let configTimer: ReturnType<typeof setTimeout> | undefined;

async function persistConfig(patch: Partial<AppConfig> = {}) {
  const s = useStore.getState();
  config = {
    ...config, ...patch,
    saveRoot: s.saveRoot, autosaveMin: s.autosaveMin, theme: s.theme, accent: s.accent, customAccents: s.customAccents, rainbowUnlocked: s.rainbowUnlocked, fonts: s.fonts, recentFonts: s.recentFonts,
    shortcuts: s.shortcuts, checkSettings: s.checkSettings, dictOverrides: s.dictOverrides, collapsedProjects: s.collapsedProjects, colWidths: s.colWidths, finishLine: s.finishLine, lengthPresets: s.lengthPresets,
  };
  try { await saveConfig(config); } catch { /* 設定存不下不影響使用 */ }
  // 啟動畫面用：下次一開就知道要鋪什麼底色
  try { localStorage.setItem('verso-boot', JSON.stringify({ theme: s.theme, accent: s.accent })); } catch { /* 存不下就算了 */ }
}

/** 回到上次的位置；條目被刪了就停在最接近的一條，頁簽不在就回到檔案開頭 */
function restorePosition(p: ProjectData, last?: LastPosition) {
  if (!last) return;
  const f = p.files.findIndex((x) => x.name === last.file && (!last.project || x.project === last.project));
  if (f < 0) return;
  const sh = p.files[f].sheets.findIndex((x) => x.name === last.sheet);
  if (sh < 0) { useStore.setState({ file: f }); return; }
  const entries = p.files[f].sheets[sh].entries;
  let i = last.id ? entries.findIndex((e) => e.id === last.id) : -1;
  if (i < 0) i = Math.min(last.index, Math.max(0, entries.length - 1));
  useStore.setState({ file: f, sheetBy: { [f]: sh }, selBy: { [f + ':' + sh]: i } });
}

/** 啟動：讀設定、載入存檔資料夾裡所有專案的檔案和字典 */
export async function startApp() {
  // 先檢查更新：選了更新就會裝好並重開，不必繼續啟動
  if (await checkAtStartup()) return;
  const step = (p: number, text: string) => useStore.setState({ loading: { p, text } });
  step(0.05, '讀取設定');
  config = await loadConfig();
  const saveRoot = config.saveRoot || await io.defaultRoot();
  const st = useStore.getState();
  useStore.setState({
    saveRoot,
    autosaveMin: config.autosaveMin ?? 1,
    theme: config.theme ?? st.theme,
    accent: config.accent ?? st.accent,
    customAccents: config.customAccents ?? [],
    rainbowUnlocked: config.rainbowUnlocked ?? false,
    fonts: withFontDefaults(config.fonts),
    recentFonts: config.recentFonts ?? [],
    shortcuts: config.shortcuts ? { input: { ...st.shortcuts.input, ...migrateSheets(config.shortcuts.input) }, list: { ...st.shortcuts.list, ...migrateSheets(migrateList(config.shortcuts.list)) } } : st.shortcuts,
    checkSettings: config.checkSettings ? { ...st.checkSettings, ...config.checkSettings } : st.checkSettings,
    dictOverrides: config.dictOverrides ?? {},
    collapsedProjects: config.collapsedProjects ?? [],
    colWidths: config.colWidths?.length === 4 ? config.colWidths : st.colWidths,
    finishLine: config.finishLine ?? true,
    lengthPresets: config.lengthPresets ?? [],
  });

  let project: ProjectData = { files: [], customMarks: [], nextMarkId: 1, glossary: [], dicts: [], projects: sortProjects([]), refs: [] };
  let last: LastPosition | undefined;
  let migrated = false;
  let newIds: string[] = [];
  try {
    try { localStorage.setItem('verso-boot', JSON.stringify({ theme: useStore.getState().theme, accent: useStore.getState().accent })); } catch { /* 存不下就算了 */ }
    step(0.12, '讀取專案');
    const r = await loadWorkspace(saveRoot, step);
    project = r.data; last = r.last; migrated = r.remapped; newIds = r.newIds;
    if (r.unreadable.length) useStore.setState({ unreadable: r.unreadable });
  } catch { /* 讀不到就從空的開始 */ }
  // 先記下已存的內容再換專案，避免監聽到變動時誤判成未存
  markSaved(project, true);
  useStore.setState({ project, file: 0, sheetBy: {}, selBy: {}, history: emptyHistory(), saveStatus: 'saved' });
  // 舊版的自訂標記合併後要重寫一次（檔案裡的標記編號、工作區設定檔）
  // 格式轉換，不是使用者的修改：直接寫回正式檔
  if (migrated) { saved = { ...saved, files: new Map(), customs: null }; useStore.setState({ saveStatus: 'dirty' }); setTimeout(() => { void saveNow(); }, 0); }
  // 舊檔案剛配了 ID：記成未存，馬上存一次把 ID 寫進去
  if (newIds.length) {
    const ids = new Set(newIds);
    project.files.forEach((f) => { if (f.fid && ids.has(f.fid)) saved.files.delete(fileKey(f)); });
    project.dicts.forEach((d) => { if (d.did && ids.has(d.did)) saved.dicts.delete(dictKey(d.project, d.name)); });
    setTimeout(() => { void saveNow(); }, 0);
  }
  restorePosition(project, last);
  // 上次沒有正常關閉，留下了暫存復原：進主畫面後問要不要恢復
  try {
    const r = await readRecovery(saveRoot);
    // 暫存的內容跟正式檔一模一樣（例如存好之後沒來得及清掉）：不用問，直接清掉
    if (r && sameAsOfficial(r, project)) await clearRecovery(saveRoot).catch(warnClear);
    else if (r) { pendingRecovery = r; useStore.setState({ recoveryAsk: true }); }
  } catch { /* 讀不到就當沒有 */ }
  step(1, '完成');
  startFolderWatch();
  // 讓進度條停在填滿的樣子一下再進主畫面
  setTimeout(() => useStore.setState({ loading: null }), 220);
  watch();
}

let watching = false;
function watch() {
  if (watching) return;
  watching = true;

  // 內容一有變動就標成未存
  let dictTimer: ReturnType<typeof setTimeout> | undefined;
  useStore.subscribe((s, prev) => {
    // 字典內容變了：稍等一下（連續修改合成一次）就存
    if (s.project && (s.project.glossary !== prev.project?.glossary || s.project.dicts !== prev.project?.dicts)) {
      clearTimeout(dictTimer);
      dictTimer = setTimeout(() => { void saveDicts(); }, 300);
    }
    if (s.project !== prev.project) {
      if (!recPending) { recPending = true; recSince = Date.now(); }
      if (s.saveStatus !== 'saving') {
        const dirty = isDirty();
        if (dirty && s.saveStatus === 'saved') useStore.setState({ saveStatus: 'dirty' });
        if (!dirty && s.saveStatus === 'dirty') useStore.setState({ saveStatus: 'saved' });
      }
    }
    // 設定改了就存到設定檔
    if (s.theme !== prev.theme || s.accent !== prev.accent || s.customAccents !== prev.customAccents || s.rainbowUnlocked !== prev.rainbowUnlocked || s.fonts !== prev.fonts || s.recentFonts !== prev.recentFonts || s.shortcuts !== prev.shortcuts || s.checkSettings !== prev.checkSettings
      || s.dictOverrides !== prev.dictOverrides || s.collapsedProjects !== prev.collapsedProjects || s.colWidths !== prev.colWidths || s.finishLine !== prev.finishLine || s.lengthPresets !== prev.lengthPresets || s.autosaveMin !== prev.autosaveMin || s.saveRoot !== prev.saveRoot) {
      clearTimeout(configTimer);
      configTimer = setTimeout(() => void persistConfig(), 400);
    }
  });

  // 定時檢查：到了間隔就自動存到暫存復原；手動儲存失敗的話每 10 秒重試
  setInterval(() => {
    const s = useStore.getState();
    if (s.saveStatus === 'saving' || s.recoveryAsk) return;
    if (s.saveStatus === 'error' && Date.now() - lastAttempt >= 10_000) { void saveNow(); return; }
    if (recPending && Date.now() - recSince >= s.autosaveMin * 60_000) void serial(autosave);
  }, 5_000);

  // 關閉視窗時，有未存的修改就先問
  if (isTauri()) {
    void getCurrentWindow().onCloseRequested(async (ev) => {
      if (closing) return;
      if (isDirty() || useStore.getState().saveStatus === 'error') {
        ev.preventDefault();
        useStore.setState({ askSave: { kind: 'close' } });
        return;
      }
      ev.preventDefault();
      await finishAndClose();
    });
  }
}

/** 關閉前記下位置，然後真的關掉視窗 */
async function finishAndClose() {
  closing = true;
  await flushBeforeExit();
  if (isTauri()) await getCurrentWindow().destroy();
}

/** 軟體要結束前（關閉、更新）：字典、專案設定（含目前位置）、軟體設定都寫進去 */
export async function flushBeforeExit() {
  await saveDicts();
  const p = useStore.getState().project;
  if (p && p.files.length) { try { await writeMeta(useStore.getState().saveRoot, p, lastPosition()); } catch { /* 忽略 */ } }
  await persistConfig();
}

/**
 * 離開目前檔案的總入口：任何會換到別的檔案的操作都經過這裡。
 * 有未存的修改就先問；target 是要去的檔案（新建檔案時是 null），go 拿到那個檔案現在的位置再執行。
 */
export function leaveFile(target: FileDoc | null, go: (index: number) => void) {
  const s = useStore.getState();
  const key = target ? fileKey(target) : null;
  const cur = s.project?.files[s.file];
  if (target && cur && fileKey(cur) === key) { go(s.file); return; }
  if (isDirty()) { useStore.setState({ askSave: { kind: 'leave', target: key, go }, fileMenuOpen: false }); return; }
  go(indexOf(key));
}

const indexOf = (key: string | null) => (key === null ? -1 : useStore.getState().project?.files.findIndex((f) => fileKey(f) === key) ?? -1);

/** 內容已經跟正式檔一樣時，刪掉暫存復原（更新前用） */
export async function dropRecovery() {
  if (isDirty()) return;
  await serial(async () => { await clearRecovery(useStore.getState().saveRoot).catch(warnClear); resetRec(); });
}

/** 會關掉目前內容的動作（例如更新）：有未儲存的修改就先問「儲存／不儲存／取消」，選好了才執行 */
export function askSaveThen(go: () => void, kind: 'update' | 'root' = 'update') {
  if (!isDirty() && useStore.getState().saveStatus !== 'error') { go(); return; }
  useStore.setState({ askSave: { kind, go }, fileMenuOpen: false });
}

/** 檔案選單切換檔案 */
export function requestFile(i: number) {
  const s = useStore.getState();
  if (i === s.file) { s.set({ fileMenuOpen: false }); return; }
  const target = s.project?.files[i];
  if (!target) return;
  leaveFile(target, (idx) => { if (idx >= 0) useStore.getState().setFile(idx); });
}

/**
 * 不儲存：整個退回上次手動儲存的內容（檔案內容、新增刪除改名的檔案、專案、自訂標記），並刪掉暫存復原。
 * 上次儲存的內容一直記在記憶體裡，不用重讀硬碟。字典不受影響。
 */
async function discardChanges(target: string | null) {
  const s = useStore.getState();
  const p = s.project;
  if (!p) return;
  const files = [...saved.files.values()];
  const next: ProjectData = { ...p, files, customMarks: saved.customs ?? p.customMarks, projects: saved.projects.length ? saved.projects : p.projects };
  const idx = Math.max(0, files.findIndex((f) => fileKey(f) === target));
  // 檔案可能少了，位置一律重設，避免指到不存在的檔案
  useStore.setState({ project: next, file: idx, sheetBy: {}, selBy: {}, cellSel: null, reported: {}, viewOn: false, peek: false, saveStatus: 'saved' });
  markSaved(next);
  // 復原紀錄是退回之前的內容，已經對不上了
  useStore.getState().clearUndo();
  await clearRecovery(s.saveRoot).catch(warnClear);
  resetRec();
}

// ---- 開啟時的暫存復原 ----

/** 檔案內容的指紋（不含軟體內部的條目編號）：用來比對暫存復原和正式檔是不是一樣 */
const docSig = (f: FileDoc) => JSON.stringify([f.project, f.name, f.lengthStd ?? null, f.sheets.map((sh) => [sh.name, sh.entries.map((e) => [
  e.id, e.speaker, e.src, e.tgt, e.mark, e.keptMark ?? '', e.note, e.sugg, e.pending, e.skipCheck, e.skipSugg ?? false, e.lengthStd ?? null, e.ver ?? null, e.upd ?? null,
])])]);

/** 暫存復原的內容跟剛讀進來的正式檔是不是完全一樣 */
function sameAsOfficial(r: NonNullable<Awaited<ReturnType<typeof readRecovery>>>, official: ProjectData): boolean {
  if (r.state.files.length !== official.files.length) return false;
  if (JSON.stringify(sortProjects(r.state.projects)) !== JSON.stringify(official.projects)) return false;
  if (JSON.stringify(r.state.customMarks ?? []) !== JSON.stringify(official.customMarks)) return false;
  const byKey = new Map(official.files.map((f) => [fileKey(f), f]));
  return r.state.files.every((x) => {
    const off = byKey.get(x.key);
    if (!off) return false;
    const rec = r.files.get(x.key);
    return !rec || docSig(rec) === docSig(off);
  });
}

let pendingRecovery: Awaited<ReturnType<typeof readRecovery>> = null;

/** 上次沒有正常關閉：恢復暫存的內容（之後要手動儲存才會寫進正式檔），或捨棄 */
export async function resolveRecovery(choice: 'restore' | 'discard') {
  const r = pendingRecovery;
  pendingRecovery = null;
  useStore.setState({ recoveryAsk: false });
  const s = useStore.getState();
  if (!r || !s.project) return;
  if (choice === 'discard') { await clearRecovery(s.saveRoot).catch(warnClear); resetRec(); return; }
  const official = new Map(s.project.files.map((f) => [fileKey(f), f]));
  const files = r.state.files.map((x) => r.files.get(x.key) ?? official.get(x.key)).filter((f): f is FileDoc => !!f);
  const next: ProjectData = {
    ...s.project, files,
    projects: sortProjects(r.state.projects),
    customMarks: Array.isArray(r.state.customMarks) ? r.state.customMarks : s.project.customMarks,
    nextMarkId: r.state.nextMarkId ?? s.project.nextMarkId,
  };
  // 停在原本開著的檔案
  const curKey = s.project.files[s.file] ? fileKey(s.project.files[s.file]) : null;
  const idx = Math.max(0, files.findIndex((f) => fileKey(f) === curKey));
  useStore.setState({ project: next, file: idx, cellSel: null, reported: {} });
  useStore.getState().clearUndo();
  // 暫存復原裡已經是這些內容，不必馬上重寫
  rec = { files: new Map([...r.files].filter(([k]) => files.some((f) => fileKey(f) === k))), state: '' };
}

/** 詢問對話框的選擇 */
export async function resolveAskSave(choice: 'save' | 'discard' | 'cancel') {
  const ask = useStore.getState().askSave;
  useStore.setState({ askSave: null });
  if (!ask || choice === 'cancel') return;
  if (choice === 'save') {
    const ok = await saveNow();
    if (!ok) return; // 存不進去就不關、不切換，標題列會顯示「未存檔」
  }
  if (choice === 'discard') await discardChanges(ask.kind === 'leave' ? ask.target : null);
  if (ask.kind === 'close') {
    await finishAndClose();
    return;
  }
  if (ask.kind === 'update' || ask.kind === 'root') { ask.go(); return; }
  ask.go(indexOf(ask.target));
}

/** 更換存檔資料夾：之後的存檔都存到新資料夾，目前的內容馬上存一份過去 */
export async function changeSaveRoot(root: string) {
  // 有未儲存的修改：先問「儲存／不儲存／取消」，選好了才換
  askSaveThen(() => { void changeSaveRootNow(root); }, 'root');
}

async function changeSaveRootNow(picked: string) {
  // 選的資料夾裡有別的東西：改存到裡面的「Verso」資料夾
  const root = await saveRootFor(picked).catch(() => picked);
  if (root !== picked) showToast('資料夾裡有其他東西，改存到裡面的「Verso」資料夾');
  const p = useStore.getState().project;
  // 新資料夾已有同名的檔案或字典：先列出來讓使用者逐項選
  const items = p ? await findRootConflicts(root, p).catch(() => []) : [];
  if (items.length) { useStore.setState({ rootConflicts: { root, items } }); return; }
  await switchRoot(root);
}

/**
 * 處理同名衝突的選擇：useFolder 裡的項目改用資料夾裡原有的那份（讀進來取代軟體裡的），
 * 其他的用目前軟體裡的（存過去覆蓋）。
 */
export async function resolveRootConflicts(useFolder: RootConflict[]) {
  const s = useStore.getState();
  const rc = s.rootConflicts;
  useStore.setState({ rootConflicts: null });
  if (!rc || !s.project) return;
  let p = s.project;
  for (const c of useFolder) {
    try {
      if (c.kind === 'file') {
        const doc = await reloadFile(rc.root, c.project, c.name, p.customMarks);
        if (doc) p = { ...p, files: p.files.map((f) => (f.project === c.project && f.name === c.name ? doc : f)) };
      } else {
        const terms = await readDict(rc.root, c.project, c.name);
        p = { ...p, glossary: [...p.glossary.filter((g) => !(g.proj === c.project && g.dict === c.name)), ...terms] };
      }
    } catch { /* 讀不到就用軟體裡的 */ }
  }
  useStore.setState({ project: p });
  await switchRoot(rc.root);
}

/** 換存檔資料夾：排隊執行，不跟自動存檔、存檔同時進行 */
function switchRoot(root: string): Promise<void> {
  return serial(() => switchRootNow(root));
}

async function switchRootNow(root: string) {
  useStore.getState().clearUndo();
  // 舊資料夾的暫存復原用不到了
  const oldRoot = useStore.getState().saveRoot;
  if (oldRoot && oldRoot !== root) { await clearRecovery(oldRoot).catch(warnClear); resetRec(); }
  // 新資料夾已經有 Verso 的資料：自訂標記合併（同名當成同一個），檔案順序以資料夾裡原本的為主
  const folder = await readFolderMeta(root).catch(() => null);
  const cur = useStore.getState().project;
  if (folder && cur) {
    const m = mergeMarks(folder.customMarks, folder.nextMarkId, cur.customMarks, cur.nextMarkId ?? 1);
    const remap = (mark: string) => (mark.startsWith('c:') && m.idMap.has(mark.slice(2)) ? 'c:' + m.idMap.get(mark.slice(2)) : mark);
    const files = m.idMap.size ? cur.files.map((f) => ({ ...f, sheets: f.sheets.map((sh) => ({ ...sh, entries: sh.entries.map((e) => {
      const mark = remap(e.mark), kept = e.keptMark ? remap(e.keptMark) : e.keptMark;
      return mark === e.mark && kept === e.keptMark ? e : { ...e, mark: mark as typeof e.mark, keptMark: kept };
    }) })) })) : cur.files;
    useStore.setState({ project: { ...cur, files, customMarks: m.customs, nextMarkId: m.nextMarkId } });
  }
  useStore.setState({ saveRoot: root });
  saved = { files: new Map(), customs: null, dicts: new Map(), projects: [] };
  await persistConfig();
  await saveNowInner();
  if (folder?.orders.size) {
    // 把資料夾裡原本的檔案讀進來，再照資料夾原本的順序排（目前多出來的接在後面），存一次寫回順序
    await syncFolder();
    const p = useStore.getState().project;
    if (p) {
      const rank = (f: FileDoc) => { const o = folder.orders.get(f.project); const i = o ? o.indexOf(safeFileName(f.name)) : -1; return i < 0 ? 1e9 : i; };
      const first = new Map<string, number>();
      p.files.forEach((f, i) => { if (!first.has(f.project)) first.set(f.project, i); });
      const files = p.files.map((f, i) => ({ f, i })).sort((a, b) => first.get(a.f.project)! - first.get(b.f.project)! || rank(a.f) - rank(b.f) || a.i - b.i).map((x) => x.f);
      useStore.setState({ project: { ...p, files } });
      await saveNowInner();
    }
  }
}

/** 讓使用者選新的存檔資料夾 */
export async function pickSaveRoot() {
  const r = await io.pickFolder(useStore.getState().saveRoot);
  if (r) await changeSaveRoot(r);
}

// ---- 監看存檔資料夾：資料夾裡多了檔案或字典就載入，軟體裡有、資料夾裡不見了就提示並在下次存檔寫回 ----

/** 比對資料夾裡的名稱用：不分大小寫，特殊符號照存檔時的換法 */
const diskKey = (project: string, name: string) => project.toLowerCase() + '/' + nameKey(name);
const splitKey = (k: string) => { const i = k.indexOf('/'); return [k.slice(0, i), k.slice(i + 1)] as const; };

async function syncFolder() {
  const s0 = useStore.getState();
  if (!s0.project || !s0.saveRoot || s0.loading) return;
  const root = s0.saveRoot;
  let scan: Awaited<ReturnType<typeof scanFolder>>;
  try { scan = await scanFolder(root); } catch { return; }

  // 已知的：軟體裡有的，以及剛在軟體裡刪掉、還沒從資料夾移走的
  const known = () => {
    const p = useStore.getState().project!;
    return {
      files: new Set([...p.files, ...saved.files.values()].map((f) => diskKey(f.project, f.name))),
      dicts: new Set([...p.dicts.map((d) => diskKey(d.project, d.name)), ...[...saved.dicts.keys()].map((k) => diskKey(...splitKey(k)))]),
      projects: new Set([...p.projects, ...saved.projects].map((x) => x.toLowerCase())),
    };
  };
  let k = known();
  const customs = useStore.getState().project!.customMarks;
  const added: FileDoc[] = [];
  for (const f of scan.files) {
    if (k.files.has(diskKey(f.project, f.name))) continue;
    // 讀不到（例如還在複製中）就先略過，下次有變動時再試
    try { const doc = await reloadFile(root, f.project, f.name, customs); if (doc) added.push(doc); } catch { /* 下次再試 */ }
  }
  const addedDicts: { info: DictInfo; terms: GlossaryTerm[] }[] = [];
  for (const d of scan.dicts) {
    if (k.dicts.has(diskKey(d.project, d.name))) continue;
    try { const book = await readDictFull(root, d.project, d.name); addedDicts.push({ info: { ...d, ...(book.did ? { did: book.did } : {}) }, terms: book.terms }); } catch { /* 下次再試 */ }
  }

  // 讀檔期間使用者可能改了東西：用最新的內容再比一次
  if (useStore.getState().saveRoot !== root) return;
  const p = useStore.getState().project!;
  k = known();
  const files = added.filter((f) => !k.files.has(diskKey(f.project, f.name)));
  const dicts = addedDicts.filter((d) => !k.dicts.has(diskKey(d.info.project, d.info.name)));
  const newProjects = scan.projects.filter((x) => !k.projects.has(x.toLowerCase()));

  // 存過、但資料夾裡不見了：留在軟體裡，下次存檔寫回去
  const onDisk = new Set(scan.files.map((f) => diskKey(f.project, f.name)));
  const gone = p.files.filter((f) => saved.files.get(fileKey(f)) === f && !onDisk.has(diskKey(f.project, f.name)));
  const dictsOnDisk = new Set(scan.dicts.map((d) => diskKey(d.project, d.name)));
  const goneDicts = p.dicts.filter((d) => saved.dicts.has(dictKey(d.project, d.name)) && !dictsOnDisk.has(diskKey(d.project, d.name)));

  // 在外面改名或搬到別的專案資料夾：同一個 ID 就是同一個檔案，只改軟體裡的名稱，不會變成兩份
  // （軟體裡的內容為準，條目的修改紀錄等也都保留）。舊檔案還沒有 ID 時，內容完全一樣才算同一個。
  const renamed: { from: FileDoc; to: FileDoc }[] = [];
  const copies: FileDoc[] = [];
  for (const f of [...files]) {
    const same = f.fid ? p.files.find((x) => x.fid === f.fid) : undefined;
    if (!same) continue;
    files.splice(files.indexOf(f), 1);
    if (!onDisk.has(diskKey(same.project, same.name))) {
      renamed.push({ from: same, to: f });
      if (gone.includes(same)) gone.splice(gone.indexOf(same), 1);
    } else {
      // 原本的還在：這是在外面複製出來的，當成新檔案、給新的 ID（存檔時寫進去）
      copies.push({ ...f, fid: newFileId() });
    }
  }
  for (const g of [...gone]) {
    const sig = fileSignature(g);
    const j = files.findIndex((f) => !f.fid && fileSignature(f) === sig);
    if (j < 0) continue;
    renamed.push({ from: g, to: files[j] });
    files.splice(j, 1);
    gone.splice(gone.indexOf(g), 1);
  }
  const renamedDicts: { from: DictInfo; to: DictInfo }[] = [];
  for (const d of [...dicts]) {
    const same = d.info.did ? p.dicts.find((x) => x.did === d.info.did) : undefined;
    if (!same) continue;
    if (!dictsOnDisk.has(diskKey(same.project, same.name))) {
      dicts.splice(dicts.indexOf(d), 1);
      renamedDicts.push({ from: same, to: { ...d.info, did: same.did } });
      if (goneDicts.includes(same)) goneDicts.splice(goneDicts.indexOf(same), 1);
    } else {
      // 複製出來的字典：給新的 ID
      d.info = { ...d.info, did: newFileId() };
    }
  }
  for (const g of [...goneDicts]) {
    const sig = dictSignature(p.glossary.filter((t) => t.proj === g.project && t.dict === g.name));
    const j = dicts.findIndex((d) => !d.info.did && dictSignature(d.terms) === sig);
    if (j < 0) continue;
    renamedDicts.push({ from: g, to: { ...dicts[j].info, did: g.did } });
    dicts.splice(j, 1);
    goneDicts.splice(goneDicts.indexOf(g), 1);
  }

  if (!files.length && !copies.length && !dicts.length && !newProjects.length && !gone.length && !goneDicts.length && !renamed.length && !renamedDicts.length) return;

  gone.forEach((f) => saved.files.delete(fileKey(f)));
  goneDicts.forEach((d) => saved.dicts.delete(dictKey(d.project, d.name)));
  files.forEach((f) => saved.files.set(fileKey(f), f));
  // 剛讀進來、本來就有 ID 的字典算已存；新配 ID 的（沒有 ID、或複製出來的）等存檔寫進去
  dicts.forEach((d) => { if (d.info.did && addedDicts.some((a) => a.info.did === d.info.did && a.info.name === d.info.name)) saved.dicts.set(dictKey(d.info.project, d.info.name), dictSignature(d.terms, d.info.did)); });
  // 改名的檔案：沿用軟體裡的內容，只換名稱與專案；本來沒有未存修改的，記成已存（資料夾裡已經是新名稱）
  const renamedDocs = new Map(renamed.map(({ from, to }) => [from, { ...from, fid: from.fid ?? to.fid ?? newFileId(), name: to.name, project: to.project }]));
  renamed.forEach(({ from, to }) => {
    const doc = renamedDocs.get(from)!;
    const wasSaved = saved.files.get(fileKey(from)) === from;
    saved.files.delete(fileKey(from));
    // 資料夾裡那份的 ID 跟軟體裡的一樣，才算已存（不然要存一次把 ID 寫進去）
    if (wasSaved && doc.fid === to.fid) saved.files.set(fileKey(doc), doc);
  });
  renamedDicts.forEach(({ from, to: t }) => {
    const sig = saved.dicts.get(dictKey(from.project, from.name));
    saved.dicts.delete(dictKey(from.project, from.name));
    if (sig !== undefined && from.did) saved.dicts.set(dictKey(t.project, t.name), sig);
  });
  const moved = [...renamed.map((r) => r.to.project), ...renamedDicts.map((r) => r.to.project)];
  const projects = files.length || dicts.length || newProjects.length || moved.length
    ? sortProjects([...p.projects, ...newProjects, ...files.map((f) => f.project), ...dicts.map((d) => d.info.project), ...moved])
    : p.projects;
  // 專案清單本來沒有未存的修改，加進來的專案也算已存
  if (saved.projects === p.projects) saved = { ...saved, projects };
  const isRenamedDict = (project: string, name: string) => renamedDicts.find((r) => r.from.project === project && r.from.name === name)?.to;
  useStore.setState({
    project: {
      ...p, projects,
      files: [...p.files.map((f) => renamedDocs.get(f) ?? f), ...files, ...copies],
      dicts: [...p.dicts.map((d) => isRenamedDict(d.project, d.name) ?? d), ...dicts.map((d) => d.info)],
      glossary: [
        ...(renamedDicts.length ? p.glossary.map((t) => { const to = isRenamedDict(t.proj, t.dict); return to ? { ...t, proj: to.project, dict: to.name } : t; }) : p.glossary),
        ...dicts.flatMap((d) => d.terms),
      ],
    },
  });
  const names = [...files.map((f) => f.name), ...copies.map((f) => f.name), ...dicts.map((d) => d.info.name)];
  const renames = [...renamed.map((r) => `${r.from.name} → ${r.to.name}`), ...renamedDicts.map((r) => `${r.from.name} → ${r.to.name}`)];
  const toastText = [names.length ? '已載入：' + names.slice(0, 3).join('、') + (names.length > 3 ? ` 等 ${names.length} 個` : '') : '', renames.length ? '已改名：' + renames.slice(0, 2).join('、') + (renames.length > 2 ? ` 等 ${renames.length} 個` : '') : ''].filter(Boolean).join('；');
  if (toastText) useStore.setState((st) => ({ toast: { text: toastText, k: (st.toast?.k ?? 0) + 1 } }));
  const goneNames = [...gone.map((f) => `${f.project} / ${f.name}`), ...goneDicts.map((d) => `字典 / ${d.project} / ${d.name}`)];
  if (goneNames.length) useStore.setState((st) => ({ goneFiles: [...new Set([...(st.goneFiles ?? []), ...goneNames])] }));
  // 不見的字典馬上寫回（排在這次檢查之後）
  if (goneDicts.length) void saveDicts();
}

/** 比對檔案內容用：頁簽名稱與每一條的 id、發話者、原文、譯文、備註 */
const fileSignature = (f: FileDoc) => JSON.stringify(f.sheets.map((sh) => [sh.name, sh.entries.map((e) => [e.id, e.speaker, e.src, e.tgt, e.note])]));

let syncTimer: ReturnType<typeof setTimeout> | undefined;
/** 稍等一下再檢查資料夾（連續的變動合成一次），和存檔排隊、不同時進行 */
function requestSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { void serial(syncFolder); }, 300);
}

let stopWatch: (() => void) | null = null;
let watchedRoot = '';
let folderWatchOn = false;

async function watchRoot(root: string) {
  if (root === watchedRoot) return;
  stopWatch?.();
  stopWatch = null;
  watchedRoot = root;
  try {
    await io.mkdir(root);
    const stop = await io.watch(root, requestSync);
    // 等待期間又換了資料夾：這個監看不要了
    if (watchedRoot !== root) stop(); else stopWatch = stop;
  } catch { /* 監看不了時，至少切回軟體時會檢查 */ }
}

function startFolderWatch() {
  if (folderWatchOn) return;
  folderWatchOn = true;
  void watchRoot(useStore.getState().saveRoot);
  useStore.subscribe((s, prev) => {
    if (s.saveRoot !== prev.saveRoot) { void watchRoot(s.saveRoot); requestSync(); }
  });
  // 監看漏掉時的保險：切回軟體時也檢查一次
  window.addEventListener('focus', requestSync);
}
