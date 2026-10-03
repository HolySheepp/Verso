import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { effectiveStd, type LengthStd, type StdValue } from '../model/length';
import { emptyHistory, recordText, selectSlot, type HistoryStore } from '../model/history';
import { effectiveMark, findCustom, toStoredMark } from '../model/marks';
import { TGT_COL, cellKey, parseKey, type Cell } from '../model/cells';
import { DEFAULT_FONTS, type FontSettings } from '../model/fonts';
import { defaultBindings, type ActionId, type Bindings, type ShortcutContext } from '../model/shortcuts';
import { defaultCheckSettings, enabledIssues, type CheckId, type CheckSettings, type Issue } from '../model/checks';
import { SHARED, dictKey, type CustomMark, type DictInfo, type Entry, type FileDoc, type GlossaryTerm, type MarkId, type Mode, type ProjectData, type Sheet } from '../model/types';
import { sortProjects, type RootConflict } from '../data/persist';
import { DICT_DIR, safeName, sameName, sheetNameError } from '../model/names';

export type Filter = 'all' | 'untranslated' | 'doubt' | 'think' | 'issues';
export type SideTab = 'dict' | 'search' | 'web' | 'ref';
export type Theme = 'dark' | 'light' | 'system';
export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';

/**
 * 有未存修改時要先問使用者：關閉 App，或離開目前的檔案。
 * leave：target 是要去的檔案（專案/檔名），新建檔案時是 null；決定後呼叫 go，帶入那個檔案現在的位置（找不到是 -1）。
 */
export type AskSave = { kind: 'close' } | { kind: 'leave'; target: string | null; go: (index: number) => void };


/** keys：用快捷鍵打開的選單，可以按數字選取 */
/** indices：從條目欄右鍵打開時，一次改這幾條的標記 */
export interface RowMenu { index: number; x: number; y: number; keys?: boolean; active?: number; indices?: number[] }

/** 「標記並下一條」在各模式下不能選的標記 */
export const STAMP_EXCLUDE: Record<Mode, MarkId[]> = {
  translate: ['untranslated', 'translated'],
  verify: ['untranslated', 'translated', 'verified'],
  view: ['untranslated', 'translated'],
  source: ['untranslated', 'translated'],
};

export interface SaveError { target: string; reason: string }

/** 「更改專案」的對象 */
export type MoveTarget = { kind: 'file'; index: number } | { kind: 'dict'; project: string; name: string };

export interface TermDraft {
  id: string | null;
  term: string; en: string; note: string; dict: string; proj: string;
}

const selKey = (f: number, sh: number) => f + ':' + sh;

/** 需要檢查的條目：有譯文、沒標忽略、沒按略過 */
const checkable = (e: Entry) => !!e.tgt && e.mark !== 'ignore' && !e.skipCheck;

/**
 * 要顯示的問題：只顯示檢查當下報過、而且現在還存在的問題。
 * 所以改對了警示馬上消失，但打字途中新出現的問題要等離開這條時才報。
 */
const NO_ISSUES: Issue[] = [];
/** 檢查結果快取：條目是不可變更新，條目沒改參照就不變；報過的問題或檢查設定換了就重算 */
const issueCache = new WeakMap<Entry, { keys: string[]; settings: CheckSettings; fileStd?: StdValue; out: Issue[] }>();

export function visibleIssues(e: Entry, reported: Record<string, string[]>, settings: CheckSettings, fileStd?: StdValue): Issue[] {
  const keys = reported[e.uid];
  if (!keys || !checkable(e)) return NO_ISSUES;
  const hit = issueCache.get(e);
  if (hit && hit.keys === keys && hit.settings === settings && hit.fileStd === fileStd) return hit.out;
  const found = enabledIssues(e.src, e.tgt, settings, effectiveStd(e.lengthStd, fileStd)).filter((i) => keys.includes(i.key));
  // 沒有問題時回傳同一個空陣列，條目欄的行元件才不會因為「新的空陣列」重畫
  const out = found.length ? found : NO_ISSUES;
  issueCache.set(e, { keys, settings, fileStd, out });
  return out;
}

interface State {
  project: ProjectData | null;
  history: HistoryStore;

  /** 目前的檔案 */
  file: number;
  /** 各檔案目前的頁簽 */
  sheetBy: Record<number, number>;
  /** 各頁簽目前選到的條目，key 為「檔案:頁簽」 */
  selBy: Record<string, number>;
  filter: Filter;
  side: SideTab;
  mode: Mode;
  /** 各模式「標記並下一條」要留下的標記 */
  stamps: Partial<Record<Mode, MarkId>>;
  theme: Theme;
  /** 主題色：內建色的名稱，或自訂的 #rrggbb */
  accent: string;
  /** 使用者存下來的自訂主題色（最多 5 個） */
  customAccents: string[];
  /** 字體：系統字、原文、譯文 */
  fonts: FontSettings;
  /** 近期用過的字形（三條共用） */
  recentFonts: string[];
  /** 彩蛋：解鎖「迷幻」主題色 */
  rainbowUnlocked: boolean;
  /** 色盤拖動中的預覽色（還沒儲存） */
  accentPreview: string | null;
  hideNav: boolean;
  hideSide: boolean;
  sideW: number | null;
  workH: number | null;
  dictQuery: string;
  searchQuery: string;
  suggClosed: boolean;
  noteClosed: boolean;
  /** 查看修改：切換模式 */
  viewOn: boolean;
  /** 查看修改：按住預覽 */
  peek: boolean;

  fileMenuOpen: boolean;
  rowMenu: RowMenu | null;
  stampOpen: boolean;
  settingsOpen: boolean;
  termDraft: TermDraft | null;
  pasteOpen: boolean;
  /** 匯入檔案視窗 */
  importOpen: boolean;
  /** 手動填入視窗用來在現有檔案插入頁簽時：插在第幾個頁簽後面 */
  pasteInsert: { after: number } | null;
  dictPasteOpen: boolean;
  manageProjectsOpen: boolean;
  /** 畫面中間短暫出現的提示 */
  toast: { text: string; k: number } | null;
  /** 換存檔資料夾時，新資料夾已有同名內容：讓使用者逐項選要用哪一份 */
  rootConflicts: { root: string; items: RootConflict[] } | null;
  /** 啟動時讀不到的檔案、字典 */
  unreadable: string[] | null;
  /** 軟體裡有、但存檔資料夾裡不見了的檔案、字典（下次存檔會寫回） */
  goneFiles: string[] | null;
  /** 存檔時發現超過 Excel 單格上限的格子（給人看的位置） */
  longCells: string[] | null;
  /** 啟動載入中：進度（0–1）與正在做的事；載入完是 null */
  loading: { p: number; text: string } | null;
  /** 上次存檔失敗的項目與原因 */
  saveErrors: SaveError[];
  manageDictsOpen: boolean;
  moveTarget: MoveTarget | null;
  /** 用下一條、快捷鍵移動選取時遞增，條目列表據此保留前後 3 條可見（滑鼠點選不算） */
  moveSeq: number;
  moveDir: 1 | -1;
  /** 手動開關字典：key 是「目前專案>專案/字典」，沒有設定的照預設（目前專案和共用的字典啟用） */
  dictOverrides: Record<string, boolean>;
  /** 檔案選單裡收起來的專案 */
  collapsedProjects: string[];
  /** 條目欄 #、發話者、原文、譯文的欄寬比例，會跟著條目欄的寬度縮放 */
  colWidths: number[];

  checkSettings: CheckSettings;
  /** 譯文框接近長度上限時顯示終點線 */
  finishLine: boolean;
  /** 存起來的常用長度標準 */
  lengthPresets: { name: string; std: LengthStd }[];
  /** 長度標準設定視窗：設定檔案的標準，或只設定目前這一條 */
  lengthDialog: 'file' | 'entry' | null;
  shortcuts: Bindings;

  /** 存檔資料夾 */
  saveRoot: string;
  /** 自動存檔間隔（分鐘） */
  autosaveMin: number;
  saveStatus: SaveStatus;
  askSave: AskSave | null;
  /** 刪除自訂標記前，問要不要一起清掉條目上的標記 */
  askDeleteMark: string | null;
  /** 條目欄選到的格子；null 時就是目前這條的譯文格 */
  cellSel: { keys: string[]; anchor: Cell } | null;
  /** 各條目在檢查當下報出的問題（以條目 uid 為 key），不存進檔案 */
  reported: Record<string, string[]>;
}

interface Actions {
  set(p: Partial<State>): void;
  closePopups(): void;
  setFile(f: number): void;
  setSheet(sh: number): void;
  select(f: number, sh: number, i: number): void;
  next(): void;
  prev(): void;
  updateEntry(patch: Partial<Entry>): void;
  setEntryMark(index: number, id: MarkId): void;
  /** 一次改好幾條的標記（復原時算一步） */
  setEntryMarks(indices: number[], id: MarkId): void;
  /** 開始在工作欄輸入框編輯：這段編輯結束時算條目欄復原的一步 */
  beginEdit(): void;
  /** 離開工作欄輸入框：有改動就把這次編輯記成一步 */
  endEdit(): void;
  record(text?: string): void;
  pickSlot(slot: number): void;
  useShownSlot(): void;
  applySuggestion(): void;
  saveTerm(d: TermDraft): void;
  deleteTerm(id: string): void;
  addCustomMark(c: CustomMark): void;
  /** clear：一起清掉條目上的這個標記；不清的話保留在檔案裡、畫面不顯示 */
  deleteCustomMark(id: string, clear: boolean): void;
  addFile(f: FileDoc): void;
  addTerms(project: string, dict: string, pairs: [string, string][]): void;
  /** 設定目前檔案的長度標準；undefined 是清掉 */
  setFileStd(std: StdValue | undefined): void;
  /** 設定目前條目的特殊標準；undefined 是改回檔案標準 */
  setEntryStd(std: StdValue | undefined): void;
  addProject(name: string): void;
  /** keepDicts：字典移到共用；否則一起刪除 */
  deleteProject(name: string, keepDicts: boolean): void;
  deleteFile(i: number): void;
  moveFile(i: number, project: string): void;
  addDict(project: string, name: string): void;
  renameProject(from: string, to: string): void;
  renameFile(i: number, name: string): void;
  /** 管理專案裡編輯完整個檔案的頁簽與條目 */
  setFileSheets(i: number, sheets: Sheet[]): void;
  renameDict(project: string, from: string, to: string): void;
  deleteDict(project: string, name: string): void;
  moveDict(project: string, name: string, to: string): void;
  /** 整本字典的詞條換成 rows */
  setDictTerms(project: string, name: string, rows: { term: string; en: string; note: string }[]): void;
  checkAll(): void;
  skipCheck(): void;
  setCheck(id: CheckId, on: boolean): void;
  setBinding(ctx: ShortcutContext, action: ActionId, combos: string[]): void;
  /** 主要按鈕：驗證模式是驗證並下一條，其他模式是下一條 */
  mainNext(): void;
  stampNext(): void;
  /** 在目前篩選下看得到的條目間移動，不留標記 */
  step(delta: 1 | -1): void;
  /** 跳到上／下一個待處理條目：有問題、標了疑慮或未翻譯 */
  stepPending(delta: 1 | -1): void;
  /** 選取格子；工作欄顯示選取範圍的第一條 */
  selectCells(keys: string[], anchor: Cell, first: number): void;
  /** 修改目前頁簽的條目（可用 Ctrl+Z 復原） */
  editSheet(fn: (entries: Entry[]) => { entries: Entry[]; keys?: string[] }): void;
  undoSheet(): void;
  redoSheet(): void;
  renameSheet(i: number, name: string): void;
  /** 清除頁簽：拿掉所有條目，頁簽保留 */
  clearSheet(i: number): void;
  deleteSheet(i: number): void;
  /** 在目前檔案的第 after 個頁簽後面插入新頁簽 */
  insertSheets(after: number, sheets: Sheet[]): void;
}

export type Store = State & Actions;

const noPopups = { fileMenuOpen: false, rowMenu: null, stampOpen: false } as const;
const noView = { viewOn: false, peek: false } as const;

const EMPTY_FILE: FileDoc = { name: '', project: SHARED, sheets: [{ name: '', entries: [] }] };

/** 專案清單加上 name（已有就不變），共用排最後 */
export function withProject(projects: string[], name: string) {
  return projects.includes(name) ? projects : sortProjects([...projects, name]);
}

function withDict(p: ProjectData, project: string, dict: string): ProjectData {
  const projects = withProject(p.projects, project);
  const has = p.dicts.some((d) => d.project === project && d.name === dict);
  return { ...p, projects, dicts: has ? p.dicts : [...p.dicts, { project, name: dict }] };
}

export const DEFAULT_COL_WIDTHS = [9, 12, 39.5, 39.5];

/** 工具欄搜尋：原文、譯文（不分大小寫）或 id 有包含搜尋字 */
export const searchHit = (e: Entry, q: string) => !!q && (e.src.includes(q) || e.tgt.toLowerCase().includes(q.toLowerCase()) || e.id.includes(q));

/** 上次的色彩模式與主題色（存在瀏覽器裡），啟動畫面一開始就用它鋪底色，不用等設定檔讀完 */
export function bootLook(): { theme: Theme; accent: string } {
  try {
    const v = JSON.parse(localStorage.getItem('verso-boot') ?? '{}');
    return { theme: v.theme ?? 'dark', accent: v.accent ?? 'blue' };
  } catch { return { theme: 'dark', accent: 'blue' }; }
}

/** 名稱重複時加上編號 */
export function uniqueName(name: string, taken: string[]) {
  let n = name, k = 2;
  while (taken.some((t) => sameName(t, n))) n = `${name} (${k++})`;
  return n;
}

/** 目前檔案所屬的專案；還沒有檔案時是共用 */
export function currentProjectOf(s: Pick<State, 'project' | 'file' | 'sheetBy' | 'selBy'>) {
  return s.project?.files.length ? currentOf(s).fileDoc.project : SHARED;
}

export const overrideKey = (current: string, d: DictInfo) => current + '>' + dictKey(d.project, d.name);

/** 字典有沒有啟用：目前專案和共用的字典預設啟用，可以手動開關 */
export function dictEnabled(s: Pick<State, 'project' | 'file' | 'sheetBy' | 'selBy' | 'dictOverrides'>, d: DictInfo) {
  return dictEnabledIn(currentProjectOf(s), s.dictOverrides, d);
}

/** 同上，直接給目前專案與手動開關（只訂閱這兩個值的區塊用） */
export function dictEnabledIn(current: string, overrides: Record<string, boolean>, d: DictInfo) {
  return overrides[overrideKey(current, d)] ?? (d.project === current || d.project === SHARED);
}

/** 目前的頁簽、條目位置 */
export function currentOf(s: Pick<State, 'project' | 'file' | 'sheetBy' | 'selBy'>) {
  // 檔案被移除時退回第一個檔案；專案裡還沒有檔案時給一個空的，避免畫面整個壞掉
  const fileDoc = s.project!.files[s.file] ?? s.project!.files[0] ?? EMPTY_FILE;
  const sheetIdx = s.sheetBy[s.file] ?? 0;
  const sheet: Sheet = fileDoc.sheets[sheetIdx] ?? fileDoc.sheets[0];
  const sel = Math.min(s.selBy[selKey(s.file, sheetIdx)] ?? 0, Math.max(0, sheet.entries.length - 1));
  return { fileDoc, sheetIdx, sheet, sel, entry: sheet.entries[sel] as Entry | undefined };
}

export const useStore = create<Store>((set, get) => {
  /** 對目前頁簽的某一條做不可變更新 */
  const patchEntry = (index: number, fn: (e: Entry) => Entry) => {
    const s = get();
    if (!s.project) return;
    const { sheetIdx } = currentOf(s);
    const files = s.project.files.map((f, fi) => fi !== s.file ? f : {
      ...f,
      sheets: f.sheets.map((sh, si) => si !== sheetIdx ? sh : {
        ...sh, entries: sh.entries.map((e, i) => (i === index ? fn(e) : e)),
      }),
    });
    set({ project: { ...s.project, files } });
  };

  const cur = () => currentOf(get());

  /** 換到沒有長度標準的檔案時，自動套上一個檔案的標準 */
  const inheritStd = (from: number, to: number) => {
    const p = get().project;
    const prev = p?.files[from]?.lengthStd, next = p?.files[to];
    if (!p || !next || next.lengthStd !== undefined || prev === undefined) return;
    set({ project: { ...p, files: p.files.map((f, i) => (i === to ? { ...f, lengthStd: prev } : f)) } });
  };

  // 條目欄與頁簽操作的復原／重做：記下整個檔案
  type Snap = { file: number; doc: FileDoc; sheet: number; keys: string[] };
  const undoStack: Snap[] = [];
  const redoStack: Snap[] = [];

  const snapNow = (): Snap => {
    const s = get();
    return { file: s.file, doc: s.project!.files[s.file], sheet: currentOf(s).sheetIdx, keys: s.cellSel?.keys ?? [] };
  };
  const pushSnap = (snap: Snap) => {
    undoStack.push(snap);
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
  };
  const pushUndo = () => pushSnap(snapNow());

  // 工作欄輸入框的編輯：進輸入框時記下當時的檔案，離開時有改動就把整段編輯算成一步
  let editSnap: Snap | null = null;

  const replaceFile = (fileIdx: number, doc: FileDoc) => {
    const p = get().project!;
    set({ project: { ...p, files: p.files.map((f, fi) => (fi === fileIdx ? doc : f)) } });
  };

  const replaceSheet = (fileIdx: number, sheetIdx: number, entries: Entry[]) => {
    const f = get().project!.files[fileIdx];
    replaceFile(fileIdx, { ...f, sheets: f.sheets.map((sh, si) => (si !== sheetIdx ? sh : { ...sh, entries })) });
  };

  const restore = (from: Snap[], to: Snap[]) => {
    const snap = from.pop();
    const p = get().project;
    if (!snap || !p || !p.files[snap.file]) return;
    const s = get();
    to.push({ file: snap.file, doc: p.files[snap.file], sheet: s.file === snap.file ? currentOf(s).sheetIdx : snap.sheet, keys: s.cellSel?.keys ?? [] });
    replaceFile(snap.file, snap.doc);
    const sheet = Math.min(snap.sheet, snap.doc.sheets.length - 1);
    const n = snap.doc.sheets[sheet]?.entries.length ?? 0;
    const keys = snap.keys.filter((k) => parseKey(k).i < n);
    set({
      file: snap.file, sheetBy: { ...get().sheetBy, [snap.file]: sheet },
      cellSel: keys.length ? { keys, anchor: parseKey(keys[0]) } : null,
      ...noPopups, ...noView,
    });
  };

  /** 檢查條目並記下當下的問題；沒有問題就清掉記錄 */
  const checkEntries = (entries: Entry[], fileStd = cur().fileDoc.lengthStd) => {
    const s = get();
    const reported = { ...s.reported };
    entries.forEach((e) => {
      const issues = checkable(e) ? enabledIssues(e.src, e.tgt, s.checkSettings, effectiveStd(e.lengthStd, fileStd)) : [];
      if (issues.length) reported[e.uid] = issues.map((i) => i.key);
      else delete reported[e.uid];
    });
    set({ reported });
  };

  /** 離開目前條目時檢查它 */
  const leaveCurrent = () => {
    const { entry } = cur();
    if (entry) checkEntries([entry]);
  };

  return {
    project: null,
    history: emptyHistory(),
    file: 0,
    sheetBy: {},
    selBy: {},
    filter: 'all',
    side: 'dict',
    mode: 'translate',
    stamps: {},
    theme: bootLook().theme,
    accent: bootLook().accent,
    customAccents: [],
    rainbowUnlocked: false,
    fonts: DEFAULT_FONTS,
    recentFonts: [],
    accentPreview: null,
    hideNav: false,
    hideSide: false,
    sideW: null,
    workH: null,
    dictQuery: '',
    searchQuery: '',
    suggClosed: false,
    noteClosed: false,
    viewOn: false,
    peek: false,
    fileMenuOpen: false,
    rowMenu: null,
    stampOpen: false,
    settingsOpen: false,
    termDraft: null,
    pasteOpen: false,
    importOpen: false,
    pasteInsert: null,
    dictPasteOpen: false,
    manageProjectsOpen: false,
    toast: null,
    longCells: null,
    unreadable: null,
    goneFiles: null,
    rootConflicts: null,
    saveErrors: [],
    loading: { p: 0, text: '啟動中' },
    manageDictsOpen: false,
    moveTarget: null,
    moveSeq: 0,
    moveDir: 1,
    dictOverrides: {},
    collapsedProjects: [],
    colWidths: DEFAULT_COL_WIDTHS,
    checkSettings: defaultCheckSettings(),
    finishLine: true,
    lengthPresets: [],
    lengthDialog: null,
    shortcuts: defaultBindings(),
    reported: {},
    saveRoot: '',
    autosaveMin: 1,
    saveStatus: 'saved',
    askSave: null,
    askDeleteMark: null,
    cellSel: null,

    set: (p) => set(p),
    closePopups: () => set(noPopups),

    setFile(f) {
      const n = get().project?.files.length ?? 0;
      if (f < 0 || f >= n) return;
      if (f !== get().file) { leaveCurrent(); inheritStd(get().file, f); }
      set({ file: f, cellSel: null, ...noPopups, ...noView });
    },

    setSheet(sh) {
      const s = get();
      const n = s.project?.files[s.file].sheets.length ?? 0;
      if (sh < 0 || sh >= n) return;
      if (sh !== currentOf(s).sheetIdx) leaveCurrent();
      set({ sheetBy: { ...s.sheetBy, [s.file]: sh }, cellSel: null, ...noPopups, ...noView });
    },

    select(f, sh, i) {
      const c = cur();
      if (f !== get().file || sh !== c.sheetIdx || i !== c.sel) leaveCurrent();
      if (f !== get().file) inheritStd(get().file, f);
      const s = get();
      // 換條目時，選取跟著移到那條的同一欄
      const col = s.cellSel?.anchor.c ?? TGT_COL;
      set({
        file: f, sheetBy: { ...s.sheetBy, [f]: sh }, selBy: { ...s.selBy, [selKey(f, sh)]: i },
        cellSel: { keys: [cellKey(i, col)], anchor: { i, c: col } },
        ...noPopups, ...noView,
      });
    },

    selectCells(keys, anchor, first) {
      const s = get();
      const { sheetIdx, sel } = cur();
      if (first !== sel) s.select(s.file, sheetIdx, first);
      set({ cellSel: { keys, anchor } });
    },

    editSheet(fn) {
      const s = get();
      if (!s.project) return;
      const { sheetIdx, sheet } = cur();
      const r = fn(sheet.entries);
      if (r.entries === sheet.entries) return;
      pushUndo();
      replaceSheet(s.file, sheetIdx, r.entries);
      if (r.keys?.length) {
        const first = Math.min(...r.keys.map((k) => parseKey(k).i));
        set({ cellSel: { keys: r.keys, anchor: parseKey(r.keys[0]) }, selBy: { ...get().selBy, [selKey(s.file, sheetIdx)]: first } });
      }
    },

    undoSheet() { restore(undoStack, redoStack); },
    redoSheet() { restore(redoStack, undoStack); },

    renameSheet(i, name) {
      const s = get();
      const f = s.project?.files[s.file];
      if (!f || !f.sheets[i] || !name.trim() || f.sheets[i].name === name.trim()) return;
      if (sheetNameError(name, f.sheets.filter((_, j) => j !== i).map((x) => x.name))) return;
      pushUndo();
      replaceFile(s.file, { ...f, sheets: f.sheets.map((sh, j) => (j === i ? { ...sh, name: name.trim() } : sh)) });
    },

    clearSheet(i) {
      const s = get();
      const f = s.project?.files[s.file];
      if (!f || !f.sheets[i]) return;
      pushUndo();
      replaceFile(s.file, { ...f, sheets: f.sheets.map((sh, j) => (j === i ? { ...sh, entries: [] } : sh)) });
      set({ selBy: { ...get().selBy, [selKey(s.file, i)]: 0 }, cellSel: null });
    },

    deleteSheet(i) {
      const s = get();
      const f = s.project?.files[s.file];
      if (!f || f.sheets.length <= 1 || !f.sheets[i]) return;
      pushUndo();
      const curIdx = currentOf(s).sheetIdx;
      replaceFile(s.file, { ...f, sheets: f.sheets.filter((_, j) => j !== i) });
      const next = Math.max(0, Math.min(curIdx > i ? curIdx - 1 : curIdx, f.sheets.length - 2));
      set({ sheetBy: { ...get().sheetBy, [s.file]: next }, cellSel: null, ...noPopups, ...noView });
    },

    insertSheets(after, sheets) {
      const s = get();
      const f = s.project?.files[s.file];
      if (!f || !sheets.length) return;
      pushUndo();
      replaceFile(s.file, { ...f, sheets: [...f.sheets.slice(0, after + 1), ...sheets, ...f.sheets.slice(after + 1)] });
      set({ sheetBy: { ...get().sheetBy, [s.file]: after + 1 }, cellSel: null, pasteInsert: null, pasteOpen: false, filter: 'all', ...noPopups, ...noView });
    },

    next() {
      const s = get();
      const { sheet, sheetIdx, sel, entry } = cur();
      // 翻譯、驗證模式下按下一條，代表確認了這條
      if (entry?.pending && (s.mode === 'translate' || s.mode === 'verify')) patchEntry(sel, (e) => ({ ...e, pending: false }));
      if (sel < sheet.entries.length - 1) { get().select(s.file, sheetIdx, sel + 1); set({ moveSeq: get().moveSeq + 1, moveDir: 1 }); }
      else { leaveCurrent(); set({ stampOpen: false }); }
    },

    prev() {
      const { sheetIdx, sel } = cur();
      if (sel > 0) { get().select(get().file, sheetIdx, sel - 1); set({ moveSeq: get().moveSeq + 1, moveDir: -1 }); }
    },

    updateEntry(patch) {
      // 不是在輸入框裡打字（例如按清除譯文、套用建議）：這一下就算一步
      if (!editSnap) pushUndo();
      // 第一次改動譯文前（這條還沒有記錄時），自動記下原本的譯文
      const { entry } = cur();
      if (entry && patch.tgt !== undefined && patch.tgt !== entry.tgt && entry.tgt && !get().history.byEntry[entry.uid]) {
        set({ history: recordText(get().history, entry.uid, entry.tgt) });
      }
      patchEntry(cur().sel, (e) => {
        const next = { ...e, ...patch };
        if (patch.tgt !== undefined && patch.tgt !== e.tgt) next.pending = false;
        return next;
      });
    },

    setEntryMark(index, id) {
      // 改標記也算一步
      pushUndo();
      patchEntry(index, (e) => ({ ...e, mark: toStoredMark(id), keptMark: undefined }));
    },

    setEntryMarks(indices, id) {
      pushUndo();
      indices.forEach((i) => patchEntry(i, (e) => ({ ...e, mark: toStoredMark(id), keptMark: undefined })));
    },

    beginEdit() {
      if (!editSnap && get().project?.files[get().file]) editSnap = snapNow();
    },

    endEdit() {
      const snap = editSnap;
      editSnap = null;
      if (snap && get().project?.files[snap.file] !== snap.doc) pushSnap(snap);
    },

    record(text) {
      const { entry } = cur();
      if (!entry) return;
      const t = text ?? entry.tgt;
      if (!t) return;
      set({ history: recordText(get().history, entry.uid, t) });
    },

    pickSlot(slot) {
      const { entry } = cur();
      if (!entry) return;
      set({ history: selectSlot(get().history, entry.uid, slot) });
    },

    useShownSlot() {
      const { entry } = cur();
      if (!entry) return;
      const h = get().history.byEntry[entry.uid];
      if (!h) return;
      get().updateEntry({ tgt: h.texts[h.slot] });
      set(noView);
    },

    applySuggestion() {
      const { entry } = cur();
      if (!entry?.sugg) return;
      if (entry.tgt) get().record(entry.tgt);
      get().updateEntry({ tgt: entry.sugg });
      set(noView);
    },

    saveTerm(d) {
      const project = get().project;
      if (!project) return;
      const dictName = d.dict.trim() ? safeName(d.dict) : '未分類';
      const projName = d.proj.trim() ? safeName(d.proj) : SHARED;
      const data = { term: d.term.trim(), en: d.en.trim(), note: d.note.trim(), dict: dictName, proj: projName };
      if (!data.term || !data.en) return;
      const glossary: GlossaryTerm[] = d.id
        ? project.glossary.map((g) => (g.id === d.id ? { ...g, ...data } : g))
        : [...project.glossary, { id: 'u' + Date.now(), ...data }];
      set({ project: { ...withDict(project, projName, dictName), glossary }, termDraft: null });
    },

    deleteTerm(id) {
      const project = get().project;
      if (!project) return;
      set({ project: { ...project, glossary: project.glossary.filter((g) => g.id !== id) }, termDraft: null });
    },

    addCustomMark(c) {
      const project = get().project;
      if (!project) return;
      // 自訂標記用編號記錄，改名不影響
      const used = project.customMarks.map((m) => Number(m.id)).filter((n) => !Number.isNaN(n));
      const next = Math.max(project.nextMarkId ?? 1, ...used.map((n) => n + 1));
      set({ project: { ...project, customMarks: [...project.customMarks, { ...c, id: String(next) }], nextMarkId: next + 1 } });
    },

    deleteCustomMark(id, clear) {
      const project = get().project;
      if (!project) return;
      const mid = 'c:' + id;
      const files = project.files.map((f) => ({
        ...f,
        sheets: f.sheets.map((sh) => ({
          ...sh,
          entries: sh.entries.map((e) => (e.mark !== mid ? e : clear ? { ...e, mark: '' as const } : { ...e, mark: '' as const, keptMark: mid })),
        })),
      }));
      set({ project: { ...project, files, customMarks: project.customMarks.filter((c) => c.id !== id) }, askDeleteMark: null });
    },

    addFile(f) {
      const project = get().project;
      if (!project) return;
      // 同一個專案裡同名的檔案加上編號
      let name = f.name, k = 2;
      while (project.files.some((x) => x.project === f.project && sameName(x.name, name))) name = `${f.name} (${k++})`;
      const idx = project.files.length;
      // 新檔案沒有長度標準時，沿用剛才那個檔案的
      const prevStd = project.files[get().file]?.lengthStd;
      const lengthStd = f.lengthStd ?? prevStd;
      set({
        project: { ...project, projects: withProject(project.projects, f.project), files: [...project.files, { ...f, name, ...(lengthStd ? { lengthStd } : {}) }] },
        file: idx, sheetBy: { ...get().sheetBy, [idx]: 0 }, pasteOpen: false, importOpen: false, filter: 'all',
        ...noPopups, ...noView,
      });
    },

    addTerms(proj, dict, pairs) {
      const project = get().project;
      if (!project) return;
      const base = Date.now().toString(36);
      const terms: GlossaryTerm[] = pairs.map(([term, en], i) => ({
        id: 'p' + base + i, term, en, note: '', dict, proj,
      }));
      set({
        project: { ...withDict(project, proj, dict), glossary: [...project.glossary, ...terms] },
        dictPasteOpen: false,
      });
    },

    setFileStd(std) {
      const s = get();
      const f = s.project?.files[s.file];
      if (!s.project || !f) return;
      const doc = { ...f, lengthStd: std };
      set({ project: { ...s.project, files: s.project.files.map((x, i) => (i === s.file ? doc : x)) }, lengthDialog: null });
      // 套用到檔案全部條目：整個檔案重新檢查
      checkEntries(doc.sheets.flatMap((sh) => sh.entries), std);
    },

    setEntryStd(std) {
      const { sel, entry } = cur();
      if (!entry) return;
      patchEntry(sel, (e) => {
        const { lengthStd: _drop, ...rest } = e;
        void _drop;
        return std === undefined ? rest : { ...rest, lengthStd: std };
      });
      set({ lengthDialog: null });
      const after = cur().entry;
      if (after) checkEntries([after]);
    },

    addProject(name) {
      const p = get().project;
      if (!p || !name.trim()) return;
      set({ project: { ...p, projects: withProject(p.projects, name.trim()) } });
    },

    deleteProject(name, keepDicts) {
      const p = get().project;
      if (!p || name === SHARED) return;
      // 先拿掉這個專案的檔案（檔案位置會跟著調整）
      for (let i = p.files.length - 1; i >= 0; i--) if (p.files[i].project === name) get().deleteFile(i);
      let q = get().project!;
      if (keepDicts) {
        for (const d of q.dicts.filter((x) => x.project === name)) get().moveDict(name, d.name, SHARED);
        q = get().project!;
      } else {
        q = { ...q, dicts: q.dicts.filter((d) => d.project !== name), glossary: q.glossary.filter((g) => g.proj !== name) };
      }
      set({
        project: { ...q, projects: q.projects.filter((x) => x !== name) },
        collapsedProjects: get().collapsedProjects.filter((x) => x !== name),
      });
    },

    deleteFile(i) {
      const s = get();
      const p = s.project;
      if (!p || !p.files[i]) return;
      // 檔案位置往前移一格；刪掉的那個不再有位置
      const map = (f: number) => (f === i ? -1 : f > i ? f - 1 : f);
      const sheetBy: Record<number, number> = {};
      Object.entries(s.sheetBy).forEach(([k, v]) => { const f = map(Number(k)); if (f >= 0) sheetBy[f] = v; });
      const selBy: Record<string, number> = {};
      Object.entries(s.selBy).forEach(([k, v]) => {
        const [f, sh] = k.split(':').map(Number);
        if (map(f) >= 0) selBy[selKey(map(f), sh)] = v;
      });
      for (const stack of [undoStack, redoStack]) {
        for (let j = stack.length - 1; j >= 0; j--) {
          const f = map(stack[j].file);
          if (f < 0) stack.splice(j, 1); else stack[j] = { ...stack[j], file: f };
        }
      }
      const file = s.file === i ? Math.max(0, Math.min(i, p.files.length - 2)) : map(s.file);
      set({
        project: { ...p, files: p.files.filter((_, j) => j !== i) },
        file, sheetBy, selBy, cellSel: s.file === i ? null : s.cellSel, ...noPopups, ...noView,
      });
    },

    moveFile(i, to) {
      const p = get().project;
      const f = p?.files[i];
      if (!p || !f || f.project === to) return;
      const name = uniqueName(f.name, p.files.filter((x) => x.project === to).map((x) => x.name));
      set({ project: { ...p, projects: withProject(p.projects, to), files: p.files.map((x, j) => (j === i ? { ...x, project: to, name } : x)) } });
    },

    renameProject(from, to) {
      const p = get().project;
      if (!p || from === SHARED || !to || from === to || sameName(to, DICT_DIR) || p.projects.some((x) => x !== from && sameName(x, to))) return;
      const r = (x: string) => (x === from ? to : x);
      set({
        project: {
          ...p,
          projects: sortProjects(p.projects.map(r)),
          files: p.files.map((f) => (f.project === from ? { ...f, project: to } : f)),
          dicts: p.dicts.map((d) => (d.project === from ? { ...d, project: to } : d)),
          glossary: p.glossary.map((g) => (g.proj === from ? { ...g, proj: to } : g)),
        },
        collapsedProjects: get().collapsedProjects.map(r),
      });
    },

    renameFile(i, name) {
      const p = get().project;
      const f = p?.files[i];
      if (!p || !f || !name || f.name === name) return;
      if (p.files.some((x, j) => j !== i && x.project === f.project && sameName(x.name, name))) return;
      set({ project: { ...p, files: p.files.map((x, j) => (j === i ? { ...x, name } : x)) } });
    },

    setFileSheets(i, sheets) {
      const s = get();
      const f = s.project?.files[i];
      if (!f || !sheets.length) return;
      replaceFile(i, { ...f, sheets });
      if (s.file === i) set({ cellSel: null, ...noView });
    },

    renameDict(project, from, to) {
      const p = get().project;
      if (!p || !to || from === to || p.dicts.some((d) => d.project === project && d.name !== from && sameName(d.name, to))) return;
      set({ project: {
        ...p,
        dicts: p.dicts.map((d) => (d.project === project && d.name === from ? { ...d, name: to } : d)),
        glossary: p.glossary.map((g) => (g.proj === project && g.dict === from ? { ...g, dict: to } : g)),
      } });
    },

    addDict(project, name) {
      const p = get().project;
      if (!p || !name.trim()) return;
      set({ project: withDict(p, project, name.trim()) });
    },

    deleteDict(project, name) {
      const p = get().project;
      if (!p) return;
      set({ project: {
        ...p,
        dicts: p.dicts.filter((d) => !(d.project === project && d.name === name)),
        glossary: p.glossary.filter((g) => !(g.proj === project && g.dict === name)),
      } });
    },

    moveDict(project, name, to) {
      const p = get().project;
      if (!p || project === to) return;
      const n = uniqueName(name, p.dicts.filter((d) => d.project === to).map((d) => d.name));
      const q = withDict({ ...p, dicts: p.dicts.filter((d) => !(d.project === project && d.name === name)) }, to, n);
      set({ project: { ...q, glossary: p.glossary.map((g) => (g.proj === project && g.dict === name ? { ...g, proj: to, dict: n } : g)) } });
    },

    setDictTerms(project, name, rows) {
      const p = get().project;
      if (!p) return;
      const base = Date.now().toString(36);
      const terms: GlossaryTerm[] = rows.map((r, i) => ({ id: 'm' + base + i, ...r, dict: name, proj: project }));
      const others = p.glossary.filter((g) => !(g.proj === project && g.dict === name));
      set({ project: { ...withDict(p, project, name), glossary: [...others, ...terms] } });
    },

    checkAll() {
      leaveCurrent();
      checkEntries(cur().sheet.entries);
    },

    skipCheck() {
      const { entry } = cur();
      if (!entry) return;
      get().updateEntry({ skipCheck: true });
      const reported = { ...get().reported };
      delete reported[entry.uid];
      set({ reported });
    },

    setBinding(ctx, action, combos) {
      const b = get().shortcuts;
      set({ shortcuts: { ...b, [ctx]: { ...b[ctx], [action]: combos } } });
    },

    mainNext() {
      const s = get();
      if (s.mode === 'verify') s.setEntryMark(cur().sel, 'verified');
      get().next();
    },

    stampNext() {
      const s = get();
      if (s.mode === 'view') return;
      s.setEntryMark(cur().sel, currentStamp(s));
      get().next();
    },

    step(delta) {
      const s = get();
      const rows = visibleRows(s);
      const { sel, sheetIdx } = cur();
      const pos = rows.indexOf(sel);
      let target: number | undefined;
      if (pos >= 0) target = rows[pos + delta];
      else target = delta > 0 ? rows.find((i) => i > sel) : [...rows].reverse().find((i) => i < sel);
      if (target !== undefined) { s.select(s.file, sheetIdx, target); set({ moveSeq: get().moveSeq + 1, moveDir: delta }); }
    },

    stepPending(delta) {
      const s = get();
      const { sel, sheetIdx, sheet } = cur();
      const pending = visibleRows(s).filter((i) => {
        const e = sheet.entries[i];
        const m = effectiveMark(e);
        return m === 'untranslated' || m === 'doubt' || visibleIssues(e, s.reported, s.checkSettings, cur().fileDoc.lengthStd).length > 0;
      });
      const target = delta > 0 ? pending.find((i) => i > sel) : [...pending].reverse().find((i) => i < sel);
      if (target !== undefined) { s.select(s.file, sheetIdx, target); set({ moveSeq: get().moveSeq + 1, moveDir: delta }); }
    },

    setCheck(id, on) {
      set({ checkSettings: { ...get().checkSettings, [id]: on } });
    },
  };
});

/** 目前「標記並下一條」會留下的標記 */
export function currentStamp(s: Pick<State, 'mode' | 'stamps' | 'project'>): MarkId {
  const exclude = STAMP_EXCLUDE[s.mode];
  const fallback: MarkId = s.mode === 'verify' ? 'doubt' : 'think';
  const stamp = s.stamps[s.mode] ?? fallback;
  if (exclude.includes(stamp) || (stamp.startsWith('c:') && !findCustom(s.project?.customMarks ?? [], stamp))) return fallback;
  return stamp;
}

/** 目前篩選下，條目列表裡看得到的條目 */
export function visibleRows(s: State): number[] {
  const { sheet } = currentOf(s);
  const out: number[] = [];
  sheet.entries.forEach((e, i) => {
    if (s.filter === 'all') out.push(i);
    else if (s.filter === 'issues') { if (visibleIssues(e, s.reported, s.checkSettings, currentOf(s).fileDoc.lengthStd).length) out.push(i); }
    else if (effectiveMark(e) === s.filter) out.push(i);
  });
  return out;
}

/**
 * 只訂閱列出的欄位：其中任一個換了（參照不同）才重畫。
 * 回傳的型別只有這些欄位，少列了用到的欄位會直接編譯錯誤，不會漏訂。
 */
export function useStorePick<K extends keyof Store>(...keys: K[]): Pick<Store, K> {
  return useStore(useShallow((s: Store) => {
    const o = {} as Pick<Store, K>;
    for (const k of keys) o[k] = s[k];
    return o;
  }));
}
