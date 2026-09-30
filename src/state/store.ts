import { create } from 'zustand';
import { activeSource } from '../data/source';
import { emptyHistory, recordText, selectSlot, type HistoryStore } from '../model/history';
import { toStoredMark } from '../model/marks';
import type { CustomMark, Entry, FileDoc, GlossaryTerm, MarkId, Mode, ProjectData } from '../model/types';

export type Filter = 'all' | 'untranslated' | 'doubt' | 'think';
export type SideTab = 'dict' | 'search' | 'web' | 'ref';
export type Theme = 'dark' | 'light';

export interface RowMenu { index: number; x: number; y: number }

export interface TermDraft {
  id: string | null;
  term: string; en: string; note: string; dict: string; proj: string;
}

export const entryId = (f: FileDoc, e: Entry) => f.path + '#' + e.key;

interface State {
  project: ProjectData | null;
  history: HistoryStore;

  tab: number;
  selBy: Record<number, number>;
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
}

interface Actions {
  load(): Promise<void>;
  set(p: Partial<State>): void;
  closePopups(): void;
  setTab(t: number): void;
  select(t: number, i: number): void;
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
}

export type Store = State & Actions;

const noPopups = { fileMenuOpen: false, rowMenu: null, stampOpen: false } as const;
const noView = { viewOn: false, peek: false } as const;

export const useStore = create<Store>((set, get) => {
  /** 對目前檔案的某一條做不可變更新 */
  const patchEntry = (index: number, fn: (e: Entry) => Entry) => {
    const { project, tab } = get();
    if (!project) return;
    const files = project.files.map((f, t) =>
      t !== tab ? f : { ...f, entries: f.entries.map((e, i) => (i === index ? fn(e) : e)) },
    );
    set({ project: { ...project, files } });
  };

  const current = () => {
    const s = get();
    const file = s.project!.files[s.tab];
    const sel = s.selBy[s.tab] ?? 0;
    return { file, sel, entry: file.entries[sel] };
  };

  return {
    project: null,
    history: emptyHistory(),
    tab: 0,
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

    async load() {
      const project = await activeSource.load();
      set({ project, tab: 0, selBy: {}, history: emptyHistory() });
    },

    set: (p) => set(p),
    closePopups: () => set(noPopups),

    setTab(t) {
      const n = get().project?.files.length ?? 0;
      if (t < 0 || t >= n) return;
      set({ tab: t, ...noPopups, ...noView });
    },

    select(t, i) {
      set({ tab: t, selBy: { ...get().selBy, [t]: i }, ...noPopups, ...noView });
    },

    next() {
      const { file, sel } = current();
      if (sel < file.entries.length - 1) get().select(get().tab, sel + 1);
      else set({ stampOpen: false });
    },

    prev() {
      const { sel } = current();
      if (sel > 0) get().select(get().tab, sel - 1);
    },

    updateEntry(patch) {
      patchEntry(current().sel, (e) => ({ ...e, ...patch }));
    },

    setEntryMark(index, id) {
      patchEntry(index, (e) => ({ ...e, mark: toStoredMark(id) }));
    },

    record(text) {
      const { file, entry } = current();
      const t = text ?? entry.tgt;
      if (!t) return;
      set({ history: recordText(get().history, entryId(file, entry), t) });
    },

    pickSlot(slot) {
      const { file, entry } = current();
      set({ history: selectSlot(get().history, entryId(file, entry), slot) });
    },

    useShownSlot() {
      const { file, entry } = current();
      const h = get().history.byEntry[entryId(file, entry)];
      if (!h) return;
      get().updateEntry({ tgt: h.texts[h.slot] });
      set(noView);
    },

    applySuggestion() {
      const { entry } = current();
      if (!entry.sugg) return;
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
        entries: f.entries.map((e) => (e.mark === mid ? { ...e, mark: '' as const } : e)),
      }));
      set({ project: { ...project, files, customMarks: project.customMarks.filter((c) => c.id !== id) } });
    },
  };
});
