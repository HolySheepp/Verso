import { create } from 'zustand';
import { activeSource } from '../data/source';
import { emptyHistory, recordText, selectSlot, type HistoryStore } from '../model/history';
import { toStoredMark } from '../model/marks';
import type { CustomMark, Entry, FileDoc, GlossaryTerm, MarkId, Mode, ProjectData, Sheet } from '../model/types';

export type Filter = 'all' | 'untranslated' | 'doubt' | 'think';
export type SideTab = 'dict' | 'search' | 'web' | 'ref';
export type Theme = 'dark' | 'light';

export interface RowMenu { index: number; x: number; y: number }

export interface TermDraft {
  id: string | null;
  term: string; en: string; note: string; dict: string; proj: string;
}

const selKey = (f: number, sh: number) => f + ':' + sh;

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
  dictPasteOpen: boolean;
}

interface Actions {
  load(): Promise<void>;
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
  deleteCustomMark(id: string): void;
  addFile(f: FileDoc): void;
  addTerms(dict: string, pairs: [string, string][]): void;
}

export type Store = State & Actions;

const noPopups = { fileMenuOpen: false, rowMenu: null, stampOpen: false } as const;
const noView = { viewOn: false, peek: false } as const;

/** 目前的頁簽、條目位置 */
export function currentOf(s: Pick<State, 'project' | 'file' | 'sheetBy' | 'selBy'>) {
  const fileDoc = s.project!.files[s.file];
  const sheetIdx = s.sheetBy[s.file] ?? 0;
  const sheet: Sheet = fileDoc.sheets[sheetIdx];
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
    dictPasteOpen: false,

    async load() {
      const project = await activeSource.load();
      set({ project, file: 0, sheetBy: {}, selBy: {}, history: emptyHistory() });
    },

    set: (p) => set(p),
    closePopups: () => set(noPopups),

    setFile(f) {
      const n = get().project?.files.length ?? 0;
      if (f < 0 || f >= n) return;
      set({ file: f, ...noPopups, ...noView });
    },

    setSheet(sh) {
      const s = get();
      const n = s.project?.files[s.file].sheets.length ?? 0;
      if (sh < 0 || sh >= n) return;
      set({ sheetBy: { ...s.sheetBy, [s.file]: sh }, ...noPopups, ...noView });
    },

    select(f, sh, i) {
      const s = get();
      set({
        file: f, sheetBy: { ...s.sheetBy, [f]: sh }, selBy: { ...s.selBy, [selKey(f, sh)]: i },
        ...noPopups, ...noView,
      });
    },

    next() {
      const s = get();
      const { sheet, sheetIdx, sel, entry } = cur();
      // 翻譯、驗證模式下按下一條，代表確認了這條
      if (entry?.pending && (s.mode === 'translate' || s.mode === 'verify')) patchEntry(sel, (e) => ({ ...e, pending: false }));
      if (sel < sheet.entries.length - 1) get().select(s.file, sheetIdx, sel + 1);
      else set({ stampOpen: false });
    },

    prev() {
      const { sheetIdx, sel } = cur();
      if (sel > 0) get().select(get().file, sheetIdx, sel - 1);
    },

    updateEntry(patch) {
      patchEntry(cur().sel, (e) => {
        const next = { ...e, ...patch };
        if (patch.tgt !== undefined && patch.tgt !== e.tgt) next.pending = false;
        return next;
      });
    },

    setEntryMark(index, id) {
      patchEntry(index, (e) => ({ ...e, mark: toStoredMark(id) }));
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
      const data = { term: d.term.trim(), en: d.en.trim(), note: d.note.trim(), dict: d.dict, proj: d.proj };
      if (!data.term || !data.en) return;
      const glossary: GlossaryTerm[] = d.id
        ? project.glossary.map((g) => (g.id === d.id ? { ...g, ...data } : g))
        : [...project.glossary, { id: 'u' + Date.now(), ...data }];
      set({ project: { ...project, glossary }, termDraft: null });
    },

    deleteTerm(id) {
      const project = get().project;
      if (!project) return;
      set({ project: { ...project, glossary: project.glossary.filter((g) => g.id !== id) }, termDraft: null });
    },

    addCustomMark(c) {
      const project = get().project;
      if (!project) return;
      set({ project: { ...project, customMarks: [...project.customMarks, c] } });
    },

    deleteCustomMark(id) {
      const project = get().project;
      if (!project) return;
      const mid = 'c:' + id;
      const files = project.files.map((f) => ({
        ...f,
        sheets: f.sheets.map((sh) => ({
          ...sh,
          entries: sh.entries.map((e) => (e.mark === mid ? { ...e, mark: '' as const } : e)),
        })),
      }));
      set({ project: { ...project, files, customMarks: project.customMarks.filter((c) => c.id !== id) } });
    },

    addFile(f) {
      const project = get().project;
      if (!project) return;
      const idx = project.files.length;
      set({
        project: { ...project, files: [...project.files, f] },
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
  };
});
