// 存檔資料夾的讀寫。
// 結構：
//   <存檔資料夾>/<專案>/<檔案>.xlsx，與 project.json（檔案順序）
//   <存檔資料夾>/字典/<專案>/<字典>.xlsx
//   <存檔資料夾>/verso.json（自訂標記、上次的位置；不分專案）
import { io } from './fsio';
import { dictToXlsxAsync, fileToXlsxAsync } from './xlsxAsync';
import { DICT_DIR, safeName } from '../model/names';
export { DICT_DIR, safeName };
import { isVersoDictData, isVersoFileData, readDictBook, xlsxToVersoFile } from './xlsxio';
import type { CheckSettings } from '../model/checks';
import type { FontSettings } from '../model/fonts';
import type { Bindings } from '../model/shortcuts';
import { SHARED, newFileId, type CustomMark, type DictInfo, type FileDoc, type GlossaryTerm, type ProjectData } from '../model/types';

const META = 'project.json';
const WORKSPACE = 'verso.json';

/** App 層級的設定（存在系統的設定資料夾，不在存檔資料夾裡） */
export interface AppConfig {
  saveRoot?: string;
  /** 自動存檔間隔（分鐘） */
  autosaveMin?: number;
  theme?: 'dark' | 'light' | 'system';
  accent?: string;
  customAccents?: string[];
  rainbowUnlocked?: boolean;
  fonts?: FontSettings;
  recentFonts?: string[];
  shortcuts?: Bindings;
  checkSettings?: CheckSettings;
  /** 手動開關過的字典（key 為「專案/字典」） */
  dictOverrides?: Record<string, boolean>;
  /** 檔案欄裡收合起來的專案 */
  collapsedProjects?: string[];
  colWidths?: number[];
  finishLine?: boolean;
  lengthPresets?: { name: string; std: import('../model/length').LengthStd }[];
}

/** 專案資料夾裡的小設定檔 */
interface ProjectMeta {
  fileOrder: string[];
  /** 舊版的自訂標記放在各專案裡，載入時會搬到工作區 */
  customMarks?: CustomMark[];
  nextMarkId?: number;
}

/** 存檔資料夾最上層的設定檔 */
interface WorkspaceMeta {
  customMarks: CustomMark[];
  nextMarkId: number;
  last?: LastPosition;
}

export interface LastPosition {
  project: string;
  file: string;
  sheet: string;
  index: number;
  /** 對話 id，條目被刪時用來找最接近的一條 */
  id: string;
}

/** 檔名不能有這些字元 */

export async function loadConfig(): Promise<AppConfig> {
  try { return JSON.parse(await io.readText(await io.configPath())) as AppConfig; } catch { return {}; }
}

export async function saveConfig(cfg: AppConfig) {
  const p = await io.configPath();
  await io.mkdir(p.replace(/[\\/][^\\/]*$/, ''));
  await io.writeText(p, JSON.stringify(cfg, null, 2));
  // 給解除安裝程式看的存檔資料夾位置（UTF-16，安裝程式才讀得懂中文路徑）
  const root = cfg.saveRoot || await io.defaultRoot();
  const bytes = new Uint8Array(2 + root.length * 2);
  bytes[0] = 0xff; bytes[1] = 0xfe;
  for (let i = 0; i < root.length; i++) { const c = root.charCodeAt(i); bytes[2 + i * 2] = c & 0xff; bytes[3 + i * 2] = c >> 8; }
  await io.writeBinary(p.replace(/[^\\/]*$/, 'saveroot.txt'), bytes);
}

export const isXlsx = (n: string) => n.toLowerCase().endsWith('.xlsx') && !n.startsWith('~$');

/** 舊版的字典直接放在「字典」底下；搬到「字典/共用」 */
async function migrateDicts(root: string) {
  const dir = io.join(root, DICT_DIR);
  if (!(await io.exists(dir))) return;
  const loose = (await io.list(dir)).filter((e) => !e.dir && isXlsx(e.name));
  if (!loose.length) return;
  const target = io.join(dir, SHARED);
  await io.mkdir(target);
  for (const f of loose) {
    const data = await io.readBinary(io.join(dir, f.name));
    await io.writeBinary(io.join(target, f.name), data);
    await io.remove(io.join(dir, f.name));
  }
}

async function loadDicts(root: string): Promise<{ dicts: DictInfo[]; terms: GlossaryTerm[]; projects: string[]; unreadable: string[] }> {
  const dir = io.join(root, DICT_DIR);
  const dicts: DictInfo[] = [];
  const terms: GlossaryTerm[] = [];
  const projects: string[] = [];
  const unreadable: string[] = [];
  if (!(await io.exists(dir))) return { dicts, terms, projects, unreadable };
  for (const p of (await io.list(dir)).filter((e) => e.dir)) {
    projects.push(p.name);
    await recoverBackups(io.join(dir, p.name));
    for (const f of (await io.list(io.join(dir, p.name))).filter((e) => !e.dir && isXlsx(e.name))) {
      const name = f.name.slice(0, -5);
      dicts.push({ project: p.name, name });
      try {
        const book = readDictBook(p.name, name, await io.readBinary(io.join(dir, p.name, f.name)));
        terms.push(...book.terms);
        if (book.did) dicts[dicts.length - 1].did = book.did;
      } catch { unreadable.push(`字典 / ${p.name} / ${f.name}`); }
    }
  }
  return { dicts, terms, projects, unreadable };
}

/** 依名稱排序，共用放最後 */
export const sortProjects = (names: Iterable<string>) =>
  [...new Set([...names, SHARED])].sort((a, b) => (a === SHARED ? 1 : b === SHARED ? -1 : a.localeCompare(b)));

/**
 * 存到一半中斷時留下的檔案：原檔不見但有備份（.bak）就把備份放回去；暫存檔（.tmp）刪掉。
 */
async function recoverBackups(dir: string) {
  let entries: { name: string; dir: boolean }[] = [];
  try { entries = await io.list(dir); } catch { return; }
  const names = new Set(entries.map((e) => e.name));
  for (const e of entries) {
    if (e.dir) continue;
    if (e.name.endsWith('.bak')) {
      const orig = e.name.slice(0, -4);
      try {
        if (!names.has(orig)) await io.rename(io.join(dir, e.name), io.join(dir, orig));
        else await io.remove(io.join(dir, e.name));
      } catch { /* 處理不了就留著 */ }
    } else if (e.name.endsWith('.tmp')) {
      try { await io.remove(io.join(dir, e.name)); } catch { /* 留著 */ }
    }
  }
}

/** 載入整個存檔資料夾 */
export async function loadWorkspace(root: string, onProgress?: (p: number, text: string) => void): Promise<{ data: ProjectData; last?: LastPosition; remapped: boolean; unreadable: string[]; newIds: string[] }> {
  const unreadable: string[] = [];
  await recoverBackups(root);
  let ws: WorkspaceMeta | null = null;
  try { ws = JSON.parse(await io.readText(io.join(root, WORKSPACE))); } catch { /* 舊版沒有這個檔 */ }
  try { await migrateDicts(root); } catch { /* 搬不動就照舊讀 */ }

  const projectNames = (await io.exists(root))
    ? (await io.list(root)).filter((e) => e.dir && e.name !== DICT_DIR && !e.name.startsWith('.')).map((e) => e.name)
    : [];

  // 自訂標記不分專案：舊版各專案各有一組，合併時同名的視為同一個，其他重新編號
  let customs: CustomMark[] = ws?.customMarks ?? [];
  let nextId = ws?.nextMarkId ?? 1;
  let remapped = false;
  const files: FileDoc[] = [];
  const versoProjects: string[] = [];
  for (const [pi, name] of projectNames.entries()) {
    const dir = io.join(root, name);
    await recoverBackups(dir);
    onProgress?.(0.15 + 0.7 * (pi / Math.max(1, projectNames.length)), `讀取專案「${name}」`);
    let meta: ProjectMeta = { fileOrder: [] };
    try { meta = { ...meta, ...JSON.parse(await io.readText(io.join(dir, META))) }; } catch { /* 沒有設定檔 */ }
    const idMap = new Map<string, string>();
    if (!ws && meta.customMarks?.length) {
      for (const m of meta.customMarks) {
        const same = customs.find((c) => c.name === m.name);
        if (same) { idMap.set(m.id, same.id); continue; }
        const used = customs.some((c) => c.id === m.id);
        const id = used ? String(Math.max(nextId, ...customs.map((c) => Number(c.id) + 1).filter((n) => !Number.isNaN(n)))) : m.id;
        if (id !== m.id) idMap.set(m.id, id);
        customs = [...customs, { ...m, id }];
        nextId = Math.max(nextId, (meta.nextMarkId ?? 1), Number(id) + 1 || nextId);
      }
    }
    const names = (await io.list(dir)).filter((e) => !e.dir && isXlsx(e.name)).map((e) => e.name.slice(0, -5));
    names.sort((a, b) => {
      const ia = meta.fileOrder.indexOf(a), ib = meta.fileOrder.indexOf(b);
      return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib) || a.localeCompare(b);
    });
    for (const n of names) {
      try {
        // 用合併後的編號讀檔；有改到編號的條目，存檔時會寫回新的編號
        const known = customs.map((c) => ({ ...c, id: [...idMap].find(([, v]) => v === c.id)?.[0] ?? c.id }));
        const read = xlsxToVersoFile(n, name, await io.readBinary(io.join(dir, n + '.xlsx')), idMap.size ? known : customs);
        // 不是 Verso 的 xlsx（使用者自己放的檔案）：不讀、不寫、不移動
        if (!read) continue;
        let f = read;
        if (idMap.size) {
          remapped = true;
          f = { ...f, sheets: f.sheets.map((sh) => ({ ...sh, entries: sh.entries.map((e) => {
            const m = e.mark.startsWith('c:') ? idMap.get(e.mark.slice(2)) : undefined;
            return m ? { ...e, mark: ('c:' + m) as typeof e.mark } : e;
          }) })) };
        }
        files.push(f);
      } catch { unreadable.push(`${name} / ${n}.xlsx`); }
    }
    // 沒有 Verso 檔案、也沒有 project.json 的資料夾不是專案
    if (files.some((f) => f.project === name) || await io.exists(io.join(dir, META)).catch(() => false)) versoProjects.push(name);
  }

  onProgress?.(0.88, '讀取字典');
  const d = await loadDicts(root);
  // 檔案、字典 ID：沒有的（舊檔案）或重複的（在外面複製出來的）給新的，下次存檔寫進去
  const newIds: string[] = [];
  const seenF = new Set<string>();
  files.forEach((f, i) => {
    if (f.fid && !seenF.has(f.fid)) { seenF.add(f.fid); return; }
    files[i] = { ...f, fid: newFileId() };
    seenF.add(files[i].fid!);
    newIds.push(files[i].fid!);
  });
  const seenD = new Set<string>();
  d.dicts.forEach((x) => {
    if (x.did && !seenD.has(x.did)) { seenD.add(x.did); return; }
    x.did = newFileId();
    seenD.add(x.did);
    newIds.push(x.did);
  });
  unreadable.push(...d.unreadable);
  return {
    data: {
      files, customMarks: customs, nextMarkId: nextId, glossary: d.terms, dicts: d.dicts,
      projects: sortProjects([...versoProjects, ...d.projects]), refs: [],
    },
    last: ws?.last,
    remapped: remapped || (!ws && customs.length > 0),
    unreadable,
    newIds,
  };
}

/** 重新讀取一個檔案（放棄未存的修改時用） */
/** 換存檔資料夾前：新資料夾裡已經有同名的檔案或字典 */
export interface RootConflict { kind: 'file' | 'dict'; project: string; name: string }

export async function findRootConflicts(root: string, data: ProjectData): Promise<RootConflict[]> {
  const out: RootConflict[] = [];
  for (const f of data.files) {
    if (await io.exists(io.join(root, f.project, safeName(f.name) + '.xlsx'))) out.push({ kind: 'file', project: f.project, name: f.name });
  }
  for (const d of data.dicts) {
    if (await io.exists(io.join(root, DICT_DIR, d.project, safeName(d.name) + '.xlsx'))) out.push({ kind: 'dict', project: d.project, name: d.name });
  }
  return out;
}

/** 存檔資料夾裡現在有的專案資料夾、檔案、字典（名稱不含 .xlsx） */
export async function scanFolder(root: string): Promise<{ projects: string[]; files: { project: string; name: string }[]; dicts: { project: string; name: string }[] }> {
  const out = { projects: [] as string[], files: [] as { project: string; name: string }[], dicts: [] as { project: string; name: string }[] };
  if (!(await io.exists(root))) return out;
  for (const e of await io.list(root)) {
    // 「.」開頭的是軟體自己用的資料夾（例如暫存復原），不是專案
    if (!e.dir || e.name.startsWith('.')) continue;
    if (e.name === DICT_DIR) {
      for (const p of (await io.list(io.join(root, DICT_DIR))).filter((x) => x.dir)) {
        out.projects.push(p.name);
        for (const f of await io.list(io.join(root, DICT_DIR, p.name))) if (!f.dir && isXlsx(f.name)) out.dicts.push({ project: p.name, name: f.name.slice(0, -5) });
      }
      continue;
    }
    const items = await io.list(io.join(root, e.name));
    // 有 project.json 的才確定是專案；只有 xlsx 的，要讀了確定是 Verso 檔案才會加進來
    if (items.some((f) => !f.dir && f.name === META)) out.projects.push(e.name);
    for (const f of items) if (!f.dir && isXlsx(f.name)) out.files.push({ project: e.name, name: f.name.slice(0, -5) });
  }
  return out;
}

/** 讀某個資料夾裡的一本字典 */
export async function readDict(root: string, project: string, name: string): Promise<GlossaryTerm[]> {
  return (await readDictFull(root, project, name)).terms;
}

/** 讀某個資料夾裡的一本字典：詞條與字典 ID */
export async function readDictFull(root: string, project: string, name: string): Promise<{ terms: GlossaryTerm[]; did: string }> {
  return readDictBook(project, name, await io.readBinary(io.join(root, DICT_DIR, project, safeName(name) + '.xlsx')));
}

export async function reloadFile(root: string, project: string, name: string, customs: CustomMark[]): Promise<FileDoc | null> {
  const p = io.join(root, project, safeName(name) + '.xlsx');
  if (!(await io.exists(p))) return null;
  return xlsxToVersoFile(name, project, await io.readBinary(p), customs);
}

export async function writeFile(root: string, file: FileDoc, customs: CustomMark[]) {
  const dir = io.join(root, file.project);
  await io.mkdir(dir);
  await io.writeBinary(io.join(dir, safeName(file.name) + '.xlsx'), await fileToXlsxAsync(file, customs));
}

/** 各專案的檔案順序，與工作區設定（自訂標記、上次位置） */
export async function writeMeta(root: string, data: ProjectData, last?: LastPosition) {
  const byProject = new Map<string, string[]>();
  data.files.forEach((f) => {
    if (!byProject.has(f.project)) byProject.set(f.project, []);
    byProject.get(f.project)!.push(safeName(f.name));
  });
  // 沒有檔案的專案也建資料夾，下次開啟才找得到
  data.projects.forEach((p) => { if (!byProject.has(p)) byProject.set(p, []); });
  for (const [project, order] of byProject) {
    const dir = io.join(root, project);
    await io.mkdir(dir);
    await io.writeText(io.join(dir, META), JSON.stringify({ fileOrder: order } satisfies ProjectMeta, null, 2));
  }
  await io.mkdir(root);
  const ws: WorkspaceMeta = { customMarks: data.customMarks, nextMarkId: data.nextMarkId ?? 1, last };
  await io.writeText(io.join(root, WORKSPACE), JSON.stringify(ws, null, 2));
  await writeUninstallList(root, data).catch(() => undefined);
}

/**
 * 給解除安裝程式看的清單：只列 Verso 自己的檔案和資料夾，解除安裝時只刪這些。
 * 每行「種類|路徑」：F 翻譯檔案、D 字典、R 整個刪的資料夾（暫存復原）、P/Q 專案／字典資料夾（空了才刪）。
 * 用 UTF-16 寫，安裝程式才讀得懂中文路徑。
 */
async function writeUninstallList(root: string, data: ProjectData) {
  const lines: string[] = [];
  lines.push('R|' + io.join(root, RECOVERY_DIR));
  data.files.forEach((f) => lines.push('F|' + io.join(root, f.project, safeName(f.name) + '.xlsx')));
  data.projects.forEach((p) => lines.push('F|' + io.join(root, p, META)));
  lines.push('F|' + io.join(root, WORKSPACE));
  data.dicts.forEach((d) => lines.push('D|' + io.join(root, DICT_DIR, d.project, safeName(d.name) + '.xlsx')));
  data.projects.forEach((p) => lines.push('P|' + io.join(root, p)));
  data.projects.forEach((p) => lines.push('Q|' + io.join(root, DICT_DIR, p)));
  const text = lines.join('\r\n') + '\r\n';
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes[0] = 0xff; bytes[1] = 0xfe;
  for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); bytes[2 + i * 2] = c & 0xff; bytes[3 + i * 2] = c >> 8; }
  const cfg = await io.configPath();
  await io.writeBinary(cfg.replace(/[^\\/]*$/, 'versofiles.txt'), bytes);
}

/** 刪除的檔案、字典、專案都移到資源回收筒 */
export const trashFile = (root: string, project: string, name: string) => io.trash(io.join(root, project, safeName(name) + '.xlsx'));
export const trashDict = (root: string, project: string, dict: string) => io.trash(io.join(root, DICT_DIR, project, safeName(dict) + '.xlsx'));
/**
 * 刪除專案：只把 Verso 的檔案、字典和 project.json 移到資源回收筒；
 * 資料夾裡還有別的東西就保留資料夾，空了才一起移走。
 */
export async function trashProject(root: string, project: string) {
  await trashOwned(io.join(root, project), async (name, path) =>
    name === META || (isXlsx(name) && isVersoFileData(await io.readBinary(path))));
  await trashOwned(io.join(root, DICT_DIR, project), async (name, path) => isXlsx(name) && isVersoDictData(await io.readBinary(path)));
}

async function trashOwned(dir: string, owned: (name: string, path: string) => Promise<boolean>) {
  if (!(await io.exists(dir))) return;
  for (const e of await io.list(dir)) {
    if (e.dir) continue;
    const path = io.join(dir, e.name);
    if (await owned(e.name, path).catch(() => false)) await io.trash(path);
  }
  if (!(await io.list(dir)).length) await io.trash(dir);
}

export async function writeDict(root: string, project: string, dict: string, terms: GlossaryTerm[], did?: string) {
  const dir = io.join(root, DICT_DIR, project);
  await io.mkdir(dir);
  await io.writeBinary(io.join(dir, safeName(dict) + '.xlsx'), await dictToXlsxAsync(terms, did));
}

// ---- 暫存復原：自動存檔寫在這裡，正式檔只在手動儲存時才寫 ----

/** 存檔資料夾裡的隱藏資料夾 */
export const RECOVERY_DIR = '.暫存復原';
const RECOVERY_STATE = 'state.json';

/** 暫存復原的清單：目前有哪些檔案（有改過的另外存一份內容）、專案、自訂標記 */
export interface RecoveryState {
  files: { key: string; project: string; name: string; fid?: string; data?: string }[];
  projects: string[];
  customMarks: CustomMark[];
  nextMarkId?: number;
}

/** 讀文字檔；安全存檔中途當機時，原檔可能還在 .bak */
async function readTextSafe(path: string): Promise<string> {
  try { return await io.readText(path); } catch { return await io.readText(path + '.bak'); }
}

/** 寫暫存復原：先寫有改過的檔案內容，再寫清單，最後刪掉用不到的舊內容 */
export async function writeRecovery(root: string, state: RecoveryState, changed: { data: string; file: FileDoc }[]) {
  const dir = io.join(root, RECOVERY_DIR);
  const fresh = !(await io.exists(dir));
  await io.mkdir(dir);
  if (fresh) {
    try { const { invoke, isTauri } = await import('@tauri-apps/api/core'); if (isTauri()) await invoke('hide_path', { path: dir }); } catch { /* 設不了隱藏也能用 */ }
  }
  for (const c of changed) await io.writeText(io.join(dir, c.data), JSON.stringify(c.file));
  await io.writeText(io.join(dir, RECOVERY_STATE), JSON.stringify(state));
  const used = new Set(state.files.map((f) => f.data).filter(Boolean));
  for (const e of await io.list(dir)) {
    if (e.dir || e.name === RECOVERY_STATE || used.has(e.name)) continue;
    await io.remove(io.join(dir, e.name)).catch(() => undefined);
  }
}

/** 讀暫存復原；沒有或讀不懂時回傳 null */
export async function readRecovery(root: string): Promise<{ state: RecoveryState; files: Map<string, FileDoc> } | null> {
  const dir = io.join(root, RECOVERY_DIR);
  if (!(await io.exists(dir))) return null;
  try {
    const state = JSON.parse(await readTextSafe(io.join(dir, RECOVERY_STATE))) as RecoveryState;
    if (!Array.isArray(state.files) || !Array.isArray(state.projects)) return null;
    const files = new Map<string, FileDoc>();
    for (const f of state.files) {
      if (!f.data) continue;
      try { files.set(f.key, JSON.parse(await readTextSafe(io.join(dir, f.data))) as FileDoc); } catch { /* 這個檔案讀不到就用正式檔 */ }
    }
    return { state, files };
  } catch { return null; }
}

/** 刪掉暫存復原（手動儲存後、選「不儲存」或「捨棄」時） */
export async function clearRecovery(root: string) {
  const dir = io.join(root, RECOVERY_DIR);
  if (await io.exists(dir)) await io.remove(dir, { recursive: true });
}

// ---- 換到已經有 Verso 資料的資料夾 ----

/**
 * 新資料夾裡原本的設定：自訂標記（verso.json）、各專案的檔案順序（project.json）。
 * 沒有就是 null。
 */
export async function readFolderMeta(root: string): Promise<{ customMarks: CustomMark[]; nextMarkId: number; orders: Map<string, string[]> } | null> {
  let ws: WorkspaceMeta | null = null;
  try { ws = JSON.parse(await io.readText(io.join(root, WORKSPACE))); } catch { /* 沒有 */ }
  const orders = new Map<string, string[]>();
  if (await io.exists(root)) {
    for (const e of await io.list(root)) {
      if (!e.dir || e.name === DICT_DIR || e.name.startsWith('.')) continue;
      try {
        const meta = JSON.parse(await io.readText(io.join(root, e.name, META))) as ProjectMeta;
        if (Array.isArray(meta.fileOrder)) orders.set(e.name, meta.fileOrder);
      } catch { /* 沒有 project.json */ }
    }
  }
  if (!ws && !orders.size) return null;
  return { customMarks: ws?.customMarks ?? [], nextMarkId: ws?.nextMarkId ?? 1, orders };
}

/**
 * 合併自訂標記：以資料夾裡原本的為主；名稱一樣的當成同一個，其他的接在後面（編號撞到就重新編）。
 * 回傳合併後的標記，以及目前的編號要換成什麼（idMap）。
 */
export function mergeMarks(theirs: CustomMark[], theirNext: number, ours: CustomMark[], ourNext: number) {
  let customs = [...theirs];
  let next = Math.max(theirNext, 1);
  const idMap = new Map<string, string>();
  const nextFree = () => String(Math.max(next, ...customs.map((c) => Number(c.id) + 1).filter((n) => !Number.isNaN(n))));
  for (const m of ours) {
    const same = customs.find((c) => c.name === m.name);
    if (same) { if (same.id !== m.id) idMap.set(m.id, same.id); continue; }
    const id = customs.some((c) => c.id === m.id) ? nextFree() : m.id;
    if (id !== m.id) idMap.set(m.id, id);
    customs = [...customs, { ...m, id }];
    next = Math.max(next, Number(id) + 1 || next);
  }
  return { customs, nextMarkId: Math.max(next, ourNext), idMap };
}
