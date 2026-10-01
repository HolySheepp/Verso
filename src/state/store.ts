import { create } from 'zustand';
import { emptyHistory, recordText, selectSlot, type HistoryStore } from '../model/history';
import { effectiveMark, findCustom, toStoredMark } from '../model/marks';
import { TGT_COL, cellKey, parseKey, type Cell } from '../model/cells';
import { DEFAULT_FONTS, type FontSettings } from '../model/fonts';
import { defaultBindings, type ActionId, type Bindings, type ShortcutContext } from '../model/shortcuts';
import { defaultCheckSettings, enabledIssues, type CheckId, type CheckSettings, type Issue } from '../model/checks';
import type { CustomMark, Entry, FileDoc, GlossaryTerm, MarkId, Mode, ProjectData, Sheet } from '../model/types';

export type Filter = 'all' | 'untranslated' | 'doubt' | 'think' | 'issues';
export type SideTab = 'dict' | 'search' | 'web' | 'ref';
export type Theme = 'dark' | 'light' | 'system';
export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';

/** 有未存修改時要先問使用者：關閉 App，或切換到別的檔案 */
export type AskSave = { kind: 'close' } | { kind: 'switch'; file: number };


/** keys：用快捷鍵打開的選單，可以按數字選取 */
export interface RowMenu { index: number; x: number; y: number; keys?: boolean; active?: number }

/** 「標記並下一條」在各模式下不能選的標記 */
export const STAMP_EXCLUDE: Record<Mode, MarkId[]> = {
  translate: ['untranslated', 'translated'],
  verify: ['untranslated', 'translated', 'verified'],
  view: ['untranslated', 'translated'],
  source: ['untranslated', 'translated'],
};

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
export function visibleIssues(e: Entry, reported: Record<string, string[]>, settings: CheckSettings): Issue[] {
  const keys = reported[e.uid];
  if (!keys || !checkable(e)) return [];
  return enabledIssues(e.src, e.tgt, settings).filter((i) => keys.includes(i.key));
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
  /** 手動填入視窗用來在現有檔案插入頁簽時：插在第幾個頁簽後面 */
  pasteInsert: { after: number } | null;
  dictPasteOpen: boolean;
  /** 用下一條、快捷鍵移動選取時遞增，條目列表據此保留前後 3 條可見（滑鼠點選不算） */
  moveSeq: number;
  moveDir: 1 | -1;
  /** 右側字典分頁中停用的字典（查詢時不列出） */
  disabledDicts: string[];

  checkSettings: CheckSettings;
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
  addTerms(dict: string, pairs: [string, string][]): void;
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

const EMPTY_FILE: FileDoc = { name: '', sheets: [{ name: '', entries: [] }] };

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

  // 條目欄與頁簽操作的復原／重做：記下整個檔案
  type Snap = { file: number; doc: FileDoc; sheet: number; keys: string[] };
  const undoStack: Snap[] = [];
  const redoStack: Snap[] = [];

  const snapNow = (): Snap => {
    const s = get();
    return { file: s.file, doc: s.project!.files[s.file], sheet: currentOf(s).sheetIdx, keys: s.cellSel?.keys ?? [] };
  };
  const pushUndo = () => {
    undoStack.push(snapNow());
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
  };

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
  const checkEntries = (entries: Entry[]) => {
    const s = get();
    const reported = { ...s.reported };
    entries.forEach((e) => {
      const issues = checkable(e) ? enabledIssues(e.src, e.tgt, s.checkSettings) : [];
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
    theme: 'dark',
    accent: 'blue',
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
    pasteInsert: null,
    dictPasteOpen: false,
    moveSeq: 0,
    moveDir: 1,
    disabledDicts: [],
    checkSettings: defaultCheckSettings(),
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
      if (f !== get().file) leaveCurrent();
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
      patchEntry(index, (e) => ({ ...e, mark: toStoredMark(id), keptMark: undefined }));
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
      const dictName = d.dict.trim() || '未分類';
      const data = { term: d.term.trim(), en: d.en.trim(), note: d.note.trim(), dict: dictName, proj: d.proj };
      if (!data.term || !data.en) return;
      const glossary: GlossaryTerm[] = d.id
        ? project.glossary.map((g) => (g.id === d.id ? { ...g, ...data } : g))
        : [...project.glossary, { id: 'u' + Date.now(), ...data }];
      const dicts = project.dicts.includes(dictName) ? project.dicts : [...project.dicts, dictName];
      set({ project: { ...project, glossary, dicts }, termDraft: null });
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
      // 同名的檔案加上編號
      let name = f.name, k = 2;
      while (project.files.some((x) => x.name === name)) name = `${f.name} (${k++})`;
      const idx = project.files.length;
      set({
        project: { ...project, files: [...project.files, { ...f, name }] },
        file: idx, sheetBy: { ...get().sheetBy, [idx]: 0 }, pasteOpen: false, filter: 'all',
        ...noPopups, ...noView,
      });
    },

    addTerms(dict, pairs) {
      const project = get().project;
      if (!project) return;
      const base = Date.now().toString(36);
      const terms: GlossaryTerm[] = pairs.map(([term, en], i) => ({
        id: 'p' + base + i, term, en, note: '', dict, proj: project.projects[0],
      }));
      set({
        project: {
          ...project,
          dicts: project.dicts.includes(dict) ? project.dicts : [...project.dicts, dict],
          glossary: [...project.glossary, ...terms],
        },
        dictPasteOpen: false,
      });
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
        return m === 'untranslated' || m === 'doubt' || visibleIssues(e, s.reported, s.checkSettings).length > 0;
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
    else if (s.filter === 'issues') { if (visibleIssues(e, s.reported, s.checkSettings).length) out.push(i); }
    else if (effectiveMark(e) === s.filter) out.push(i);
  });
  return out;
}
