// 存檔控制：啟動時載入、偵測修改、自動存檔、Ctrl+S、關閉或切換檔案時詢問
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { io } from '../data/fsio';
import { withFontDefaults } from '../model/fonts';
import {
  loadConfig, loadWorkspace, reloadFile, saveConfig, sortProjects, trashDict, trashFile, trashProject, writeDict, writeFile, writeMeta,
  type AppConfig, type LastPosition,
} from '../data/persist';
import { emptyHistory } from '../model/history';
import { dictKey, type CustomMark, type FileDoc, type GlossaryTerm, type ProjectData } from '../model/types';
import { currentOf, useStore } from './store';

const fileKey = (f: FileDoc) => f.project + '/' + f.name;

/** 上次存檔時的內容（資料都是不可變更新，所以比對參照就知道有沒有改過） */
let saved = {
  files: new Map<string, FileDoc>(),
  customs: null as CustomMark[] | null,
  dicts: new Map<string, string>(),
  projects: [] as string[],
};
let dirtySince = 0;
let lastAttempt = 0;
let closing = false;

const dictSignature = (terms: GlossaryTerm[]) => JSON.stringify(terms.map((t) => [t.term, t.en, t.note]));

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

function markSaved(p: ProjectData) {
  saved = {
    files: new Map(p.files.map((f) => [fileKey(f), f])),
    customs: p.customMarks,
    dicts: new Map([...dictGroups(p)].map(([d, t]) => [d, dictSignature(t)])),
    projects: p.projects,
  };
}

/** 有沒有還沒存的修改 */
export function isDirty(): boolean {
  const p = useStore.getState().project;
  if (!p) return false;
  if (p.customMarks !== saved.customs || p.projects !== saved.projects) return true;
  if (saved.files.size !== p.files.length || saved.dicts.size !== dictGroups(p).size) return true;
  if (p.files.some((f) => saved.files.get(fileKey(f)) !== f)) return true;
  return [...dictGroups(p)].some(([d, t]) => saved.dicts.get(d) !== dictSignature(t));
}

function lastPosition(): LastPosition | undefined {
  const s = useStore.getState();
  if (!s.project || !s.project.files.length) return undefined;
  const { fileDoc, sheet, sel, entry } = currentOf(s);
  return { project: fileDoc.project, file: fileDoc.name, sheet: sheet.name, index: sel, id: entry?.id ?? '' };
}

/** 存檔。成功回傳 true；檔案被 Excel 開著之類的失敗會標成「未存檔」，之後自動重試 */
export async function saveNow(): Promise<boolean> {
  const s = useStore.getState();
  const p = s.project;
  if (!p || !s.saveRoot) return true;
  lastAttempt = Date.now();
  useStore.setState({ saveStatus: 'saving' });
  let ok = true;
  const done = { files: new Map(saved.files), customs: saved.customs, dicts: new Map(saved.dicts), projects: saved.projects };
  // 刪掉（或搬走）的專案、檔案、字典移到資源回收筒
  const gone = saved.projects.filter((x) => !p.projects.includes(x));
  for (const x of gone) { try { await trashProject(s.saveRoot, x); } catch { ok = false; } }
  const keys = new Set(p.files.map(fileKey));
  for (const [k, f] of saved.files) {
    if (keys.has(k)) continue;
    try { if (!gone.includes(f.project)) await trashFile(s.saveRoot, f.project, f.name); done.files.delete(k); } catch { ok = false; }
  }
  const groups = dictGroups(p);
  for (const k of saved.dicts.keys()) {
    if (groups.has(k)) continue;
    const i = k.indexOf('/');
    try { if (!gone.includes(k.slice(0, i))) await trashDict(s.saveRoot, k.slice(0, i), k.slice(i + 1)); done.dicts.delete(k); } catch { ok = false; }
  }
  // 還沒有檔案時不必建立專案資料夾（只存字典）
  if (p.files.length || saved.files.size || p.projects !== saved.projects) {
    const customsChanged = p.customMarks !== saved.customs;
    for (const f of p.files) {
      // 自訂標記改了名稱也要重寫，因為「標記」欄寫的是名稱
      if (saved.files.get(fileKey(f)) === f && !customsChanged) continue;
      try { await writeFile(s.saveRoot, f, p.customMarks); done.files.set(fileKey(f), f); } catch { ok = false; }
    }
    try { await writeMeta(s.saveRoot, p, lastPosition()); if (ok) { done.customs = p.customMarks; done.projects = p.projects; } } catch { ok = false; }
  }
  for (const [k, terms] of groups) {
    const sig = dictSignature(terms);
    if (saved.dicts.get(k) === sig) continue;
    const i = k.indexOf('/');
    try { await writeDict(s.saveRoot, k.slice(0, i), k.slice(i + 1), terms); done.dicts.set(k, sig); } catch { ok = false; }
  }
  saved = done;
  const dirty = isDirty();
  useStore.setState({ saveStatus: !ok ? 'error' : dirty ? 'dirty' : 'saved' });
  return ok;
}

// ---- 設定檔 ----
let config: AppConfig = {};
let configTimer: ReturnType<typeof setTimeout> | undefined;

async function persistConfig(patch: Partial<AppConfig> = {}) {
  const s = useStore.getState();
  config = {
    ...config, ...patch,
    saveRoot: s.saveRoot, autosaveMin: s.autosaveMin, theme: s.theme, accent: s.accent, customAccents: s.customAccents, rainbowUnlocked: s.rainbowUnlocked, fonts: s.fonts, recentFonts: s.recentFonts,
    shortcuts: s.shortcuts, checkSettings: s.checkSettings, dictOverrides: s.dictOverrides, collapsedProjects: s.collapsedProjects, colWidths: s.colWidths,
  };
  try { await saveConfig(config); } catch { /* 設定存不下不影響使用 */ }
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
    shortcuts: config.shortcuts ? { input: { ...st.shortcuts.input, ...config.shortcuts.input }, list: { ...st.shortcuts.list, ...config.shortcuts.list } } : st.shortcuts,
    checkSettings: config.checkSettings ? { ...st.checkSettings, ...config.checkSettings } : st.checkSettings,
    dictOverrides: config.dictOverrides ?? {},
    collapsedProjects: config.collapsedProjects ?? [],
    colWidths: config.colWidths?.length === 4 ? config.colWidths : st.colWidths,
  });

  let project: ProjectData = { files: [], customMarks: [], nextMarkId: 1, glossary: [], dicts: [], projects: sortProjects([]), refs: [] };
  let last: LastPosition | undefined;
  let migrated = false;
  try {
    const r = await loadWorkspace(saveRoot);
    project = r.data; last = r.last; migrated = r.remapped;
  } catch { /* 讀不到就從空的開始 */ }
  // 先記下已存的內容再換專案，避免監聽到變動時誤判成未存
  markSaved(project);
  useStore.setState({ project, file: 0, sheetBy: {}, selBy: {}, history: emptyHistory(), saveStatus: 'saved' });
  // 舊版的自訂標記合併後要重寫一次（檔案裡的標記編號、工作區設定檔）
  if (migrated) { saved = { ...saved, files: new Map(), customs: null }; useStore.setState({ saveStatus: 'dirty' }); dirtySince = 0; }
  restorePosition(project, last);
  watch();
}

let watching = false;
function watch() {
  if (watching) return;
  watching = true;

  // 內容一有變動就標成未存
  useStore.subscribe((s, prev) => {
    if (s.project !== prev.project && s.saveStatus !== 'saving') {
      const dirty = isDirty();
      if (dirty && s.saveStatus === 'saved') { dirtySince = Date.now(); useStore.setState({ saveStatus: 'dirty' }); }
      if (!dirty && s.saveStatus === 'dirty') useStore.setState({ saveStatus: 'saved' });
    }
    // 設定改了就存到設定檔
    if (s.theme !== prev.theme || s.accent !== prev.accent || s.customAccents !== prev.customAccents || s.rainbowUnlocked !== prev.rainbowUnlocked || s.fonts !== prev.fonts || s.recentFonts !== prev.recentFonts || s.shortcuts !== prev.shortcuts || s.checkSettings !== prev.checkSettings
      || s.dictOverrides !== prev.dictOverrides || s.collapsedProjects !== prev.collapsedProjects || s.colWidths !== prev.colWidths || s.autosaveMin !== prev.autosaveMin || s.saveRoot !== prev.saveRoot) {
      clearTimeout(configTimer);
      configTimer = setTimeout(() => void persistConfig(), 400);
    }
    // 建立第一個檔案時馬上存，讓專案資料夾出現
    if (prev.project && s.project && !prev.project.files.length && s.project.files.length) void saveNow();
  });

  // 定時檢查：到了間隔就自動存；存檔失敗的話每 10 秒重試
  setInterval(() => {
    const s = useStore.getState();
    if (s.saveStatus === 'saving') return;
    if (s.saveStatus === 'error') { if (Date.now() - lastAttempt >= 10_000) void saveNow(); return; }
    if (s.saveStatus === 'dirty' && Date.now() - dirtySince >= s.autosaveMin * 60_000) void saveNow();
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
  const p = useStore.getState().project;
  if (p && p.files.length) { try { await writeMeta(useStore.getState().saveRoot, p, lastPosition()); } catch { /* 忽略 */ } }
  await persistConfig();
  if (isTauri()) await getCurrentWindow().destroy();
}

/** 切換檔案：有未存的修改就先問 */
export function requestFile(i: number) {
  const s = useStore.getState();
  if (i === s.file) { s.set({ fileMenuOpen: false }); return; }
  if (isDirty()) { useStore.setState({ askSave: { kind: 'switch', file: i }, fileMenuOpen: false }); return; }
  s.setFile(i);
}

/** 放棄未存的修改：改過的檔案重新從硬碟讀回來，從沒存過的檔案拿掉；然後切到 target 那個檔案 */
async function discardChanges(target?: FileDoc) {
  const s = useStore.getState();
  const p = s.project;
  if (!p) return;
  const files: FileDoc[] = [];
  for (const f of p.files) {
    if (saved.files.get(fileKey(f)) === f) { files.push(f); continue; }
    const back = await reloadFile(s.saveRoot, f.project, f.name, p.customMarks).catch(() => null);
    if (back) files.push(back);
  }
  const customMarks = saved.customs ?? p.customMarks;
  const next = { ...p, files, customMarks };
  const idx = Math.max(0, files.findIndex((f) => target && fileKey(f) === fileKey(target)));
  // 檔案可能少了，位置一律重設，避免指到不存在的檔案
  useStore.setState({ project: next, file: idx, sheetBy: {}, selBy: {}, reported: {}, viewOn: false, peek: false, saveStatus: 'saved' });
  markSaved(next);
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
  if (ask.kind === 'close') {
    await finishAndClose();
    return;
  }
  const target = useStore.getState().project?.files[ask.file];
  if (choice === 'discard') { await discardChanges(target); return; }
  const p = useStore.getState().project!;
  const idx = Math.max(0, p.files.findIndex((f) => target && fileKey(f) === fileKey(target)));
  if (idx !== useStore.getState().file) useStore.getState().setFile(idx);
}

/** 更換存檔資料夾：之後的存檔都存到新資料夾，目前的內容馬上存一份過去 */
export async function changeSaveRoot(root: string) {
  useStore.setState({ saveRoot: root });
  saved = { files: new Map(), customs: null, dicts: new Map(), projects: [] };
  await persistConfig();
  await saveNow();
}

/** 讓使用者選新的存檔資料夾 */
export async function pickSaveRoot() {
  const r = await io.pickFolder(useStore.getState().saveRoot);
  if (r) await changeSaveRoot(r);
}
