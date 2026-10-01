// 存檔資料夾的讀寫。
// 結構：
//   <存檔資料夾>/<專案>/<檔案>.xlsx，與 project.json（檔案順序）
//   <存檔資料夾>/字典/<專案>/<字典>.xlsx
//   <存檔資料夾>/verso.json（自訂標記、上次的位置；不分專案）
import { io } from './fsio';
import { dictToXlsx, fileToXlsx, xlsxToDict, xlsxToFile } from './xlsxio';
import type { CheckSettings } from '../model/checks';
import type { FontSettings } from '../model/fonts';
import type { Bindings } from '../model/shortcuts';
import { SHARED, type CustomMark, type DictInfo, type FileDoc, type GlossaryTerm, type ProjectData } from '../model/types';

export const DICT_DIR = '字典';
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
export const safeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, '_').trim() || '未命名';

export async function loadConfig(): Promise<AppConfig> {
  try { return JSON.parse(await io.readText(await io.configPath())) as AppConfig; } catch { return {}; }
}

export async function saveConfig(cfg: AppConfig) {
  const p = await io.configPath();
  await io.mkdir(p.replace(/[\\/][^\\/]*$/, ''));
  await io.writeText(p, JSON.stringify(cfg, null, 2));
}

const isXlsx = (n: string) => n.toLowerCase().endsWith('.xlsx') && !n.startsWith('~$');

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

async function loadDicts(root: string): Promise<{ dicts: DictInfo[]; terms: GlossaryTerm[]; projects: string[] }> {
  const dir = io.join(root, DICT_DIR);
  const dicts: DictInfo[] = [];
  const terms: GlossaryTerm[] = [];
  const projects: string[] = [];
  if (!(await io.exists(dir))) return { dicts, terms, projects };
  for (const p of (await io.list(dir)).filter((e) => e.dir)) {
    projects.push(p.name);
    for (const f of (await io.list(io.join(dir, p.name))).filter((e) => !e.dir && isXlsx(e.name))) {
      const name = f.name.slice(0, -5);
      dicts.push({ project: p.name, name });
      try { terms.push(...xlsxToDict(p.name, name, await io.readBinary(io.join(dir, p.name, f.name)))); } catch { /* 讀不了的字典略過 */ }
    }
  }
  return { dicts, terms, projects };
}

/** 依名稱排序，共用放最後 */
export const sortProjects = (names: Iterable<string>) =>
  [...new Set([...names, SHARED])].sort((a, b) => (a === SHARED ? 1 : b === SHARED ? -1 : a.localeCompare(b)));

/** 載入整個存檔資料夾 */
export async function loadWorkspace(root: string): Promise<{ data: ProjectData; last?: LastPosition; remapped: boolean }> {
  let ws: WorkspaceMeta | null = null;
  try { ws = JSON.parse(await io.readText(io.join(root, WORKSPACE))); } catch { /* 舊版沒有這個檔 */ }
  try { await migrateDicts(root); } catch { /* 搬不動就照舊讀 */ }

  const projectNames = (await io.exists(root))
    ? (await io.list(root)).filter((e) => e.dir && e.name !== DICT_DIR).map((e) => e.name)
    : [];

  // 自訂標記不分專案：舊版各專案各有一組，合併時同名的視為同一個，其他重新編號
  let customs: CustomMark[] = ws?.customMarks ?? [];
  let nextId = ws?.nextMarkId ?? 1;
  let remapped = false;
  const files: FileDoc[] = [];
  for (const name of projectNames) {
    const dir = io.join(root, name);
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
        let f = xlsxToFile(n, name, await io.readBinary(io.join(dir, n + '.xlsx')), idMap.size ? known : customs);
        if (idMap.size) {
          remapped = true;
          f = { ...f, sheets: f.sheets.map((sh) => ({ ...sh, entries: sh.entries.map((e) => {
            const m = e.mark.startsWith('c:') ? idMap.get(e.mark.slice(2)) : undefined;
            return m ? { ...e, mark: ('c:' + m) as typeof e.mark } : e;
          }) })) };
        }
        files.push(f);
      } catch { /* 讀不了的檔案略過 */ }
    }
  }

  const d = await loadDicts(root);
  return {
    data: {
      files, customMarks: customs, nextMarkId: nextId, glossary: d.terms, dicts: d.dicts,
      projects: sortProjects([...projectNames, ...d.projects]), refs: [],
    },
    last: ws?.last,
    remapped: remapped || (!ws && customs.length > 0),
  };
}

/** 重新讀取一個檔案（放棄未存的修改時用） */
export async function reloadFile(root: string, project: string, name: string, customs: CustomMark[]): Promise<FileDoc | null> {
  const p = io.join(root, project, safeName(name) + '.xlsx');
  if (!(await io.exists(p))) return null;
  return xlsxToFile(name, project, await io.readBinary(p), customs);
}

export async function writeFile(root: string, file: FileDoc, customs: CustomMark[]) {
  const dir = io.join(root, file.project);
  await io.mkdir(dir);
  await io.writeBinary(io.join(dir, safeName(file.name) + '.xlsx'), fileToXlsx(file, customs));
}

/** 各專案的檔案順序，與工作區設定（自訂標記、上次位置） */
export async function writeMeta(root: string, data: ProjectData, last?: LastPosition) {
  const byProject = new Map<string, string[]>();
  data.files.forEach((f) => {
    if (!byProject.has(f.project)) byProject.set(f.project, []);
    byProject.get(f.project)!.push(safeName(f.name));
  });
  for (const [project, order] of byProject) {
    const dir = io.join(root, project);
    await io.mkdir(dir);
    await io.writeText(io.join(dir, META), JSON.stringify({ fileOrder: order } satisfies ProjectMeta, null, 2));
  }
  await io.mkdir(root);
  const ws: WorkspaceMeta = { customMarks: data.customMarks, nextMarkId: data.nextMarkId ?? 1, last };
  await io.writeText(io.join(root, WORKSPACE), JSON.stringify(ws, null, 2));
}

export async function writeDict(root: string, project: string, dict: string, terms: GlossaryTerm[]) {
  const dir = io.join(root, DICT_DIR, project);
  await io.mkdir(dir);
  await io.writeBinary(io.join(dir, safeName(dict) + '.xlsx'), dictToXlsx(terms));
}
