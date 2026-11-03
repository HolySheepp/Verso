// 翻譯記憶：本地記憶檔（存檔資料夾裡的 SQLite）、寫入、比對、管理。
// 團隊共用的 Google 表在雲端外掛裡同步（src/plugins/cloud/tmSync.ts），這裡只記下還沒送上去的變動。
import { create } from 'zustand';
import { isTauri } from '@tauri-apps/api/core';
import { tx } from '../i18n';
import { applyChange, compose, editsOf } from '../model/verify';
import { io } from '../data/fsio';
import { TmIndex, sameText, type TmMatch, type TmRow, type TermSpan } from '../model/tm';
import { SHARED, type Entry, type FileDoc, type Sheet } from '../model/types';
import { currentOf, currentProjectOf, shownSrc, showToast, tmHook, useStore } from './store';
import { activeTermsOf, findHits } from './dictHits';

/** 存檔資料夾裡的記憶檔名稱 */
export const TM_FILE = '翻譯記憶.sqlite';
/** 退回紀錄留幾天 */
export const KEEP_DAYS = 30;
const DAY = 86_400_000;

/** 送上共用表的一筆變動：新增或修改（put）、刪除（del）；op 是這筆變動的 ID，t 是時間 */
export type TmOp = { k: 'put'; op: string; t: number; row: TmRow } | { k: 'del'; op: string; t: number; id: string; project: string };

interface Changes {
  put: TmRow[]; del: string[];
  hist: [string, number, string][];
  outboxAdd: string[]; outboxDel: number[];
  meta: [string, string][];
  purgeBefore: number | null;
}

/** 記憶檔的讀寫：桌面版用 SQLite，瀏覽器預覽時放在記憶體（重新整理就不見） */
interface Backend {
  load(path: string): Promise<{ rows: TmRow[]; outbox: [number, string][]; meta: Record<string, string> }>;
  apply(path: string, c: Changes): Promise<number[]>;
  hist(path: string, rid: string | null, since: number): Promise<[number, string, number, string][]>;
  exportDb(path: string, rows: TmRow[]): Promise<void>;
  readDb(path: string): Promise<TmRow[]>;
}

const tauriBackend: Backend = {
  async load(path) { const { invoke } = await import('@tauri-apps/api/core'); return invoke('tm_load', { path }); },
  async apply(path, c) { const { invoke } = await import('@tauri-apps/api/core'); return invoke('tm_apply', { path, ...c }); },
  async hist(path, rid, since) { const { invoke } = await import('@tauri-apps/api/core'); return invoke('tm_hist', { path, rid, since }); },
  async exportDb(path, rows) { const { invoke } = await import('@tauri-apps/api/core'); await invoke('tm_export', { path, rows }); },
  async readDb(path) { const { invoke } = await import('@tauri-apps/api/core'); return invoke('tm_read', { path }); },
};

/** 瀏覽器預覽和測試用 */
export function memoryBackend(): Backend {
  const dbs = new Map<string, { rows: Map<string, TmRow>; outbox: Map<number, string>; hist: [number, string, number, string][]; meta: Map<string, string>; seq: number }>();
  const db = (p: string) => { let d = dbs.get(p); if (!d) { d = { rows: new Map(), outbox: new Map(), hist: [], meta: new Map(), seq: 0 }; dbs.set(p, d); } return d; };
  return {
    async load(p) { const d = db(p); return { rows: [...d.rows.values()], outbox: [...d.outbox], meta: Object.fromEntries(d.meta) }; },
    async apply(p, c) {
      const d = db(p);
      c.put.forEach((r) => d.rows.set(r.id, r));
      c.del.forEach((id) => d.rows.delete(id));
      c.hist.forEach(([rid, at, row]) => d.hist.push([++d.seq, rid, at, row]));
      const seqs = c.outboxAdd.map((op) => { d.outbox.set(++d.seq, op); return d.seq; });
      c.outboxDel.forEach((s) => d.outbox.delete(s));
      c.meta.forEach(([k, v]) => d.meta.set(k, v));
      if (c.purgeBefore != null) d.hist = d.hist.filter((h) => h[2] >= c.purgeBefore!);
      return seqs;
    },
    async hist(p, rid, since) { return db(p).hist.filter((h) => h[2] >= since && (rid === null || h[1] === rid)).reverse(); },
    async exportDb(p, rows) { const d = db(p); d.rows = new Map(rows.map((r) => [r.id, r])); },
    async readDb(p) { return [...db(p).rows.values()]; },
  };
}

let backend: Backend = isTauri() ? tauriBackend : memoryBackend();
/** 測試用：換掉記憶檔的讀寫 */
export const setTmBackend = (b: Backend) => { backend = b; };

/** 手動改、刪的一步（可以退回） */
interface UndoStep { before: TmRow[]; after: TmRow[] }

export const useTm = create<{
  /** 全部記憶（ID → 記憶） */
  rows: Map<string, TmRow>;
  /** 記憶內容變了就加一 */
  ver: number;
  loaded: boolean;
  /** 讀不到記憶檔時的原因 */
  error: string;
  /** 沒有記憶也要列出來的專案記憶（管理裡新增的） */
  extra: string[];
  /** 還沒送上共用表的變動 */
  outbox: { seq: number; op: TmOp }[];
  /** 記憶檔裡的小設定（同步進度等） */
  meta: Record<string, string>;
  /** 手動改、刪的紀錄（退回用） */
  undo: UndoStep[];
  /** 記憶分頁的管理視窗、匯入匯出、一致性清單 */
  dialog: null | 'manage' | 'import' | 'export' | 'consistency';
}>(() => ({ rows: new Map(), ver: 0, loaded: false, error: '', extra: [], outbox: [], meta: {}, undo: [], dialog: null }));

let path = '';
let index = new TmIndex();

const opId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
export const newTmId = () => 'm' + opId();

// ---- 讀寫 ----

let pending: Changes = emptyChanges();
let pendingOps: TmOp[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let chain: Promise<void> = Promise.resolve();

function emptyChanges(): Changes { return { put: [], del: [], hist: [], outboxAdd: [], outboxDel: [], meta: [], purgeBefore: null }; }

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => { void flushTm(); }, 400);
}

/** 把累積的變動寫進記憶檔 */
export function flushTm(): Promise<void> {
  clearTimeout(timer);
  const c = pending, ops = pendingOps, p = path;
  pending = emptyChanges();
  pendingOps = [];
  if (!p || (!c.put.length && !c.del.length && !c.hist.length && !c.outboxAdd.length && !c.outboxDel.length && !c.meta.length && c.purgeBefore == null)) return chain;
  chain = chain.then(async () => {
    try {
      const seqs = await backend.apply(p, c);
      if (p !== path) return;
      if (seqs.length) useTm.setState((st) => ({ outbox: [...st.outbox, ...ops.map((op, k) => ({ seq: seqs[k], op }))] }));
    } catch (e) {
      showToast(tx('tm.writeFailed', { reason: String(e) }), { warn: true });
    }
  });
  return chain;
}

/** 記憶內容變了：更新畫面、排進寫入 */
function changed(put: TmRow[], del: TmRow[], opts: { ops?: boolean; hist?: TmRow[] } = {}) {
  const rows = new Map(useTm.getState().rows);
  for (const r of del) { rows.delete(r.id); index.remove(r.id); }
  for (const r of put) { rows.set(r.id, r); index.add(r); }
  if (index.stale) index = new TmIndex([...rows.values()]);
  useTm.setState((st) => ({ rows, ver: st.ver + 1 }));
  pending.put.push(...put);
  pending.del.push(...del.map((r) => r.id));
  const now = Date.now();
  for (const h of opts.hist ?? []) pending.hist.push([h.id, now, JSON.stringify(h)]);
  if (opts.ops !== false) {
    for (const r of del) { const op: TmOp = { k: 'del', op: opId(), t: now, id: r.id, project: r.project }; pendingOps.push(op); pending.outboxAdd.push(JSON.stringify(op)); }
    for (const r of put) { const op: TmOp = { k: 'put', op: opId(), t: now, row: r }; pendingOps.push(op); pending.outboxAdd.push(JSON.stringify(op)); }
  }
  schedule();
  matchCache = null;
}

/** 讀這個存檔資料夾的記憶檔 */
export async function loadTm(root: string) {
  await flushTm();
  path = io.join(root, TM_FILE);
  const p = path;
  try {
    const r = await backend.load(p);
    if (p !== path) return;
    index = new TmIndex(r.rows);
    const outbox = r.outbox.flatMap(([seq, op]) => { try { return [{ seq, op: JSON.parse(op) as TmOp }]; } catch { return []; } });
    let extra: string[] = [];
    try { extra = JSON.parse(r.meta.projects ?? '[]'); } catch { extra = []; }
    useTm.setState({ rows: new Map(r.rows.map((x) => [x.id, x])), ver: useTm.getState().ver + 1, loaded: true, error: '', outbox, meta: r.meta, extra, undo: [] });
    matchCache = null;
    // 太舊的退回紀錄清掉
    pending.purgeBefore = Date.now() - KEEP_DAYS * DAY;
    schedule();
  } catch (e) {
    index = new TmIndex();
    useTm.setState({ rows: new Map(), ver: useTm.getState().ver + 1, loaded: false, error: String(e), outbox: [], meta: {}, extra: [] });
  }
}

let started = false;
/** 啟動：讀記憶檔、接上條目確認，換存檔資料夾時換一份 */
export function startTm() {
  if (started) return;
  started = true;
  void loadTm(useStore.getState().saveRoot);
  useStore.subscribe((s, prev) => { if (s.saveRoot !== prev.saveRoot) void loadTm(s.saveRoot); });
  tmHook.confirm = commitEntry;
  if (typeof window !== 'undefined') window.addEventListener('beforeunload', () => { void flushTm(); });
}

// ---- 寫入：條目確認時 ----

/** 譯者：雲端模式的暱稱（沒填就空白） */
const me = () => useStore.getState().userName.trim();

/**
 * 條目確認（下一條、標已翻譯等）：寫進這個檔案所屬專案的記憶。
 * 譯文空的不寫；同一條（同檔案、同頁簽、同 id）重新翻譯就蓋掉；原文和譯文都一樣的只更新時間
 */
export function commitEntry(e: Entry, f: FileDoc, sheet: Sheet, verified: boolean) {
  const src = shownSrc(e), tgt = e.tgt;
  if (!tgt.trim() || !src.trim() || !useTm.getState().loaded) return;
  const project = f.project || SHARED;
  const fid = f.fid ?? '';
  const rows = useTm.getState().rows;
  let old: TmRow | undefined;
  if (e.id) for (const r of rows.values()) if (r.project === project && r.fid === fid && r.sheet === sheet.name && r.eid === e.id) { old = r; break; }
  if (!old) for (const r of rows.values()) if (r.project === project && sameText(r, { src, tgt })) { old = r; break; }
  const base = { project, src, tgt, by: me() || old?.by || '', at: Date.now(), fid, file: f.name, sheet: sheet.name, eid: e.id, speaker: e.speaker };
  if (old && sameText(old, { src, tgt })) {
    // 一樣的內容：只更新時間；驗證通過才改成已驗證（不會因為又按了一次下一條變回未驗證）
    const v = old.verified || verified;
    if (v === old.verified && Date.now() - old.at < 60_000) return;
    changed([{ ...old, verified: v, at: Date.now(), ...(old.eid ? {} : { fid, file: f.name, sheet: sheet.name, eid: e.id, speaker: e.speaker }) }], []);
    return;
  }
  changed([{ ...base, id: old?.id ?? newTmId(), verified }], []);
}

// ---- 比對 ----

/** 目前專案要查哪些專案的記憶：目前專案和共用預設勾選，之後照使用者的勾選記住（跟字典一樣） */
export function tmProjectsOn(current: string, overrides: Record<string, boolean>, all: string[]): Set<string> {
  return new Set(all.filter((p) => overrides[current + '>' + p] ?? (p === current || p === SHARED)));
}

/** 全部的專案記憶：有記憶的、管理裡新增的、存檔資料夾的專案、共用 */
export function tmProjectList(): string[] {
  const s = useStore.getState(), t = useTm.getState();
  const set = new Set<string>([SHARED, currentProjectOf(s), ...t.extra, ...(s.project?.projects ?? [])]);
  for (const r of t.rows.values()) set.add(r.project);
  return [...set].sort((a, b) => (a === SHARED ? 1 : b === SHARED ? -1 : a.localeCompare(b)));
}

/** 字典詞（句式比對用）：一段文字裡啟用中字典的詞和譯名 */
function termFinder(): ((text: string) => TermSpan[]) | undefined {
  const s = useStore.getState();
  if (!s.project) return undefined;
  const current = currentProjectOf(s);
  const terms = activeTermsOf(s.project.glossary, s.project.dicts, s.dictOverrides, current);
  if (!terms.length) return undefined;
  return (text) => findHits(text, terms, current).flatMap((h) => h.spans.map((sp) => ({ start: sp.start, end: sp.end, ens: h.terms.map((t) => t.en) })));
}

let matchCache: { key: string; out: TmMatch[] } | null = null;
const NO_MATCHES: TmMatch[] = [];

/** 目前條目的記憶比對結果（同樣的條件不重算） */
export function currentMatches(): TmMatch[] {
  const s = useStore.getState();
  const t = useTm.getState();
  if (!s.project || !t.loaded) return NO_MATCHES;
  const { entry, fileDoc, sheet } = currentOf(s);
  if (!entry) return NO_MATCHES;
  const src = shownSrc(entry);
  const current = currentProjectOf(s);
  const on = tmProjectsOn(current, s.tmOverrides, tmProjectList());
  const key = [entry.uid, src, t.ver, s.tmMin, [...on].join('|'), s.project.glossary.length, s.dictOverrides === lastOverrides ? 0 : 1].join('\u0000');
  lastOverrides = s.dictOverrides;
  if (matchCache?.key === key) return matchCache.out;
  const terms = termFinder();
  if (terms !== lastTerms) { index.clearTerms(); lastTerms = terms; }
  const out = index.query({ src, min: s.tmMin, projects: on, terms, at: { fid: fileDoc.fid ?? '', file: fileDoc.name, sheet: sheet.name, eid: entry.id, speaker: entry.speaker } });
  matchCache = { key, out };
  return out;
}
let lastTerms: ((text: string) => TermSpan[]) | undefined;
let lastOverrides: Record<string, boolean> | null = null;

/** 畫面用：目前條目的比對結果（記憶、條目、勾選、門檻變了才重算） */
export function useTmMatches(): TmMatch[] {
  useTm((t) => t.ver);
  useTm((t) => t.loaded);
  useStore((s) => { const e = currentOf(s).entry; return e ? e.uid + '\u0000' + shownSrc(e) : ''; });
  useStore((s) => s.tmMin);
  useStore((s) => s.tmOverrides);
  useStore((s) => currentProjectOf(s));
  useStore((s) => s.project?.glossary);
  useStore((s) => s.dictOverrides);
  return currentMatches();
}

/** 第一條 100% 相符（灰字、自動套用用）：一般比對、原文完全一樣 */
export function exactMatch(list: TmMatch[]): TmMatch | undefined {
  const m = list.find((x) => x.kind === 'fuzzy' && x.pct === 100);
  return m;
}

// ---- 套用 ----

/** 套用記憶後的譯文（句式比對會換掉數字、標籤、字典詞） */
export function matchText(m: TmMatch): { text: string; misses: string[] } {
  if (m.kind !== 'pattern') return { text: m.row.tgt, misses: [] };
  const e = currentOf(useStore.getState()).entry;
  return index.applyPattern(m.row, e ? shownSrc(e) : '', termFinder());
}

/** 套用：直接蓋掉譯文框（先記錄原本的譯文，可以 Ctrl+Z 退回）；譯文框收起來時先打開 */
export function applyMatch(m: TmMatch) {
  const s = useStore.getState();
  const { entry } = currentOf(s);
  if (!entry) return;
  if (s.mode !== 'translate' && s.mode !== 'verify') { showToast(tx('tm.translateOnly')); return; }
  if (s.aiLocked.includes(entry.uid)) { showToast(tx('list.aiLocked')); return; }
  const { text, misses } = matchText(m);
  // 驗證模式：放進修改框（跟手動在修改框打字一樣變成修改，可以套用或忽略）
  if (s.mode === 'verify') {
    const vb = s.workBoxes.verify;
    if (vb?.mod === false) s.set({ workBoxes: { ...s.workBoxes, verify: { ...vb, mod: true } } });
    const edits = editsOf(entry);
    const r = applyChange(entry.tgt, edits, compose(entry.tgt, edits), text);
    s.setVerify(r.edits);
    if (misses.length) showToast(tx('tm.patternMiss', { list: misses.join(tx('common.sep')) }), { warn: true });
    return;
  }
  const boxes = s.workBoxes.translate;
  if (boxes?.tgt === false) s.set({ workBoxes: { ...s.workBoxes, translate: { ...boxes, tgt: true } } });
  if (text === entry.tgt) return;
  if (entry.tgt) s.record(entry.tgt);
  s.updateEntry({ tgt: text });
  if (misses.length) showToast(tx('tm.patternMiss', { list: misses.join(tx('common.sep')) }), { warn: true });
}

/** 這條記憶的來源條目在哪（檔案、頁簽、第幾條）；檔案或頁簽不在了是 null */
export function sourceOf(r: TmRow): { file: number; sheet: number; index: number } | null {
  const p = useStore.getState().project;
  if (!p) return null;
  let fi = r.fid ? p.files.findIndex((f) => f.fid === r.fid) : -1;
  if (fi < 0) fi = p.files.findIndex((f) => f.project === r.project && f.name === r.file);
  if (fi < 0) fi = p.files.findIndex((f) => f.name === r.file);
  if (fi < 0) return null;
  const si = p.files[fi].sheets.findIndex((sh) => sh.name === r.sheet);
  if (si < 0) return null;
  const list = p.files[fi].sheets[si].entries;
  let ei = r.eid ? list.findIndex((e) => e.id === r.eid) : -1;
  if (ei < 0) ei = list.findIndex((e) => shownSrc(e) === r.src);
  return { file: fi, sheet: si, index: Math.max(0, ei) };
}

// ---- 手動管理 ----

/** 手動改一條（保持原本的驗證狀態） */
export function editRow(id: string, patch: Partial<Pick<TmRow, 'src' | 'tgt' | 'project'>>) {
  const old = useTm.getState().rows.get(id);
  if (!old) return;
  const next = { ...old, ...patch, at: Date.now(), by: me() || old.by };
  if (sameText(old, next) && old.project === next.project) return;
  pushUndo([old], [next]);
  // 換了專案：在舊專案的表上是刪掉，新專案加一條
  changed([next], next.project !== old.project ? [old] : [], { hist: [old] });
}

/** 手動刪掉這些記憶 */
export function deleteRows(ids: string[]) {
  const rows = useTm.getState().rows;
  const del = ids.map((id) => rows.get(id)).filter((r): r is TmRow => !!r);
  if (!del.length) return;
  pushUndo(del, []);
  changed([], del, { hist: del });
}

/** 搬到別的專案記憶 */
export function moveRows(ids: string[], project: string) {
  const rows = useTm.getState().rows;
  const old = ids.map((id) => rows.get(id)).filter((r): r is TmRow => !!r && r.project !== project);
  if (!old.length) return;
  const next = old.map((r) => ({ ...r, project, at: Date.now() }));
  pushUndo(old, next);
  changed(next, old, { hist: old });
}

/** 新增一條（管理裡手動加） */
export function addRow(r: Omit<TmRow, 'id' | 'at' | 'by'>) {
  if (!r.src.trim() || !r.tgt.trim()) return;
  const row: TmRow = { ...r, id: newTmId(), at: Date.now(), by: me() };
  pushUndo([], [row]);
  changed([row], []);
}

function pushUndo(before: TmRow[], after: TmRow[]) {
  useTm.setState((st) => ({ undo: [...st.undo.slice(-49), { before, after }] }));
}

/** 退回上一次手動修改、刪除 */
export function undoTm() {
  const st = useTm.getState();
  const step = st.undo[st.undo.length - 1];
  if (!step) return;
  useTm.setState({ undo: st.undo.slice(0, -1) });
  const now = Date.now();
  const back = step.before.map((r) => ({ ...r, at: now }));
  const backIds = new Set(back.map((r) => r.id));
  changed(back, step.after.filter((r) => !backIds.has(r.id) || step.before.find((b) => b.id === r.id)?.project !== r.project), {});
}

/** 這條記憶的舊版本（30 天內） */
export async function versionsOf(id: string): Promise<{ at: number; row: TmRow }[]> {
  await flushTm();
  const list = await backend.hist(path, id, Date.now() - KEEP_DAYS * DAY);
  return list.flatMap(([, , at, row]) => { try { return [{ at, row: JSON.parse(row) as TmRow }]; } catch { return []; } });
}

/** 30 天內刪掉、現在不在的記憶（可以恢復） */
export async function deletedRows(): Promise<{ at: number; row: TmRow }[]> {
  await flushTm();
  const live = useTm.getState().rows;
  const seen = new Set<string>();
  const list = await backend.hist(path, null, Date.now() - KEEP_DAYS * DAY);
  return list.flatMap(([, rid, at, row]) => {
    if (live.has(rid) || seen.has(rid)) return [];
    seen.add(rid);
    try { return [{ at, row: JSON.parse(row) as TmRow }]; } catch { return []; }
  });
}

/** 把舊版本放回去（算一次新的修改） */
export function restoreRow(r: TmRow) {
  const cur = useTm.getState().rows.get(r.id);
  const next = { ...r, at: Date.now() };
  pushUndo(cur ? [cur] : [], [next]);
  changed([next], cur && cur.project !== r.project ? [cur] : [], { hist: cur ? [cur] : [] });
}

/** 新增、改名、刪除專案記憶 */
export function addProjectMemory(name: string) {
  const n = name.trim();
  if (!n || tmProjectList().includes(n)) return;
  setExtra([...useTm.getState().extra, n]);
}
export function renameProjectMemory(from: string, to: string) {
  const n = to.trim();
  if (!n || n === from || from === SHARED) return;
  const ids = [...useTm.getState().rows.values()].filter((r) => r.project === from).map((r) => r.id);
  moveRows(ids, n);
  setExtra([...useTm.getState().extra.filter((x) => x !== from), n]);
  renameOverrides(from, n);
}
export function deleteProjectMemory(name: string) {
  if (name === SHARED) return;
  deleteRows([...useTm.getState().rows.values()].filter((r) => r.project === name).map((r) => r.id));
  setExtra(useTm.getState().extra.filter((x) => x !== name));
}
function setExtra(extra: string[]) {
  useTm.setState({ extra });
  pending.meta.push(['projects', JSON.stringify(extra)]);
  schedule();
}
function renameOverrides(from: string, to: string) {
  const s = useStore.getState();
  const next: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(s.tmOverrides)) {
    const [cur, p] = k.split('>');
    next[(cur === from ? to : cur) + '>' + (p === from ? to : p)] = v;
  }
  s.set({ tmOverrides: next });
}

// ---- 匯入、匯出 ----

/** 匯入一批記憶到某個專案記憶：原文和譯文都一樣的只更新驗證狀態；回傳加了幾條 */
export function importRows(list: Omit<TmRow, 'id' | 'project'>[], project: string): number {
  const rows = useTm.getState().rows;
  const have = new Map<string, TmRow>();
  for (const r of rows.values()) if (r.project === project) have.set(r.src + '\u0000' + r.tgt, r);
  const put: TmRow[] = [];
  let added = 0;
  for (const x of list) {
    if (!x.src.trim() || !x.tgt.trim()) continue;
    const k = x.src + '\u0000' + x.tgt;
    const old = have.get(k);
    if (old) { if (x.verified && !old.verified) { const n = { ...old, verified: true }; have.set(k, n); put.push(n); } continue; }
    const n: TmRow = { ...x, id: newTmId(), project, at: x.at || Date.now() };
    have.set(k, n);
    put.push(n);
    added++;
  }
  if (put.length) changed(put, []);
  return added;
}

/** 從 Verso 裡的檔案匯入：有譯文的條目，照原本的標記判斷已驗證、未驗證 */
export function rowsFromFile(f: FileDoc, isVerified: (e: Entry) => boolean): Omit<TmRow, 'id' | 'project'>[] {
  const at = Date.now();
  return f.sheets.flatMap((sh) => sh.entries.filter((e) => e.tgt.trim() && shownSrc(e).trim() && !e.pending).map((e) => ({
    src: shownSrc(e), tgt: e.tgt, verified: isVerified(e), by: '', at, fid: f.fid ?? '', file: f.name, sheet: sh.name, eid: e.id, speaker: e.speaker,
  })));
}

export const readTmDb = (p: string) => backend.readDb(p);
export const exportTmDb = (p: string, rows: TmRow[]) => backend.exportDb(p, rows);

// ---- 給同步用（雲端外掛） ----

/** 已經送上共用表的變動：從待送清單拿掉 */
export function ackOutbox(seqs: number[]) {
  if (!seqs.length) return;
  const set = new Set(seqs);
  useTm.setState((st) => ({ outbox: st.outbox.filter((x) => !set.has(x.seq)) }));
  pending.outboxDel.push(...seqs);
  schedule();
}

export function setTmMeta(k: string, v: string) {
  useTm.setState((st) => ({ meta: { ...st.meta, [k]: v } }));
  pending.meta.push([k, v]);
  schedule();
}

/**
 * 合併從共用表下載的變動：以後改的為準。被蓋掉的本地版本記進退回紀錄。
 * mine：自己送出的變動（不再套用一次）
 */
export function mergeRemote(ops: TmOp[], mine: Set<string>) {
  const rows = useTm.getState().rows;
  const latest = new Map<string, TmOp>();
  for (const op of ops) {
    if (mine.has(op.op)) continue;
    const id = op.k === 'put' ? op.row.id : op.id;
    const prev = latest.get(id);
    if (!prev || prev.t <= op.t) latest.set(id, op);
  }
  const put: TmRow[] = [], del: TmRow[] = [], hist: TmRow[] = [];
  for (const [id, op] of latest) {
    const cur = rows.get(id);
    if (op.k === 'put') {
      if (cur && cur.at > op.t) continue;
      if (cur && sameText(cur, op.row) && cur.verified === op.row.verified && cur.project === op.row.project) continue;
      if (cur) { hist.push(cur); if (cur.project !== op.row.project) del.push(cur); }
      put.push(op.row);
    } else if (cur && cur.at <= op.t) { hist.push(cur); del.push(cur); }
  }
  if (put.length || del.length) changed(put, del, { ops: false, hist });
  return put.length + del.length;
}

/** 測試用：目前的索引 */
export const tmIndex = () => index;
