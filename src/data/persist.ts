// 存檔資料夾的讀寫。
// 結構：<存檔資料夾>/<專案>/<檔案>.xlsx 與 project.json；<存檔資料夾>/字典/<字典>.xlsx
import { io } from './fsio';
import { dictToXlsx, fileToXlsx, xlsxToDict, xlsxToFile } from './xlsxio';
import type { CheckSettings } from '../model/checks';
import type { Bindings } from '../model/shortcuts';
import type { CustomMark, FileDoc, GlossaryTerm, ProjectData } from '../model/types';

export const DICT_DIR = '字典';
const META = 'project.json';

/** App 層級的設定（存在系統的設定資料夾，不在存檔資料夾裡） */
export interface AppConfig {
  saveRoot?: string;
  /** 自動存檔間隔（分鐘） */
  autosaveMin?: number;
  lastProject?: string;
  theme?: 'dark' | 'light' | 'system';
  accent?: string;
  customAccents?: string[];
  rainbowUnlocked?: boolean;
  shortcuts?: Bindings;
  checkSettings?: CheckSettings;
  disabledDicts?: string[];
}

/** 專案資料夾裡的小設定檔 */
export interface ProjectMeta {
  customMarks: CustomMark[];
  nextMarkId: number;
  fileOrder: string[];
  last?: LastPosition;
}

export interface LastPosition {
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

export async function listProjects(root: string): Promise<string[]> {
  if (!(await io.exists(root))) return [];
  return (await io.list(root)).filter((e) => e.dir && e.name !== DICT_DIR).map((e) => e.name);
}

export async function loadDicts(root: string): Promise<{ dicts: string[]; terms: GlossaryTerm[] }> {
  const dir = io.join(root, DICT_DIR);
  if (!(await io.exists(dir))) return { dicts: [], terms: [] };
  const files = (await io.list(dir)).filter((e) => !e.dir && e.name.toLowerCase().endsWith('.xlsx'));
  const dicts: string[] = [];
  const terms: GlossaryTerm[] = [];
  for (const f of files) {
    const name = f.name.slice(0, -5);
    dicts.push(name);
    try { terms.push(...xlsxToDict(name, await io.readBinary(io.join(dir, f.name)))); } catch { /* 讀不了的字典略過 */ }
  }
  return { dicts, terms };
}

export async function loadProject(root: string, name: string): Promise<{ project: ProjectData; last?: LastPosition }> {
  const dir = io.join(root, name);
  let meta: ProjectMeta = { customMarks: [], nextMarkId: 1, fileOrder: [] };
  try { meta = { ...meta, ...JSON.parse(await io.readText(io.join(dir, META))) }; } catch { /* 沒有設定檔就用預設 */ }
  const names = (await io.list(dir))
    .filter((e) => !e.dir && e.name.toLowerCase().endsWith('.xlsx') && !e.name.startsWith('~$'))
    .map((e) => e.name.slice(0, -5));
  // 照上次的順序排，新出現的檔案放後面
  names.sort((a, b) => {
    const ia = meta.fileOrder.indexOf(a), ib = meta.fileOrder.indexOf(b);
    return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib) || a.localeCompare(b);
  });
  const files: FileDoc[] = [];
  for (const n of names) {
    try { files.push(xlsxToFile(n, await io.readBinary(io.join(dir, n + '.xlsx')), meta.customMarks)); } catch { /* 讀不了的檔案略過 */ }
  }
  const { dicts, terms } = await loadDicts(root);
  return {
    project: {
      name, files, customMarks: meta.customMarks, nextMarkId: meta.nextMarkId,
      glossary: terms, dicts, projects: [name, '所有專案（共用）'], refs: [],
    },
    last: meta.last,
  };
}

/** 重新讀取一個檔案（放棄未存的修改時用） */
export async function reloadFile(root: string, project: string, name: string, customs: CustomMark[]): Promise<FileDoc | null> {
  const p = io.join(root, project, safeName(name) + '.xlsx');
  if (!(await io.exists(p))) return null;
  return xlsxToFile(name, await io.readBinary(p), customs);
}

export async function writeFile(root: string, project: ProjectData, file: FileDoc) {
  const dir = io.join(root, project.name);
  await io.mkdir(dir);
  await io.writeBinary(io.join(dir, safeName(file.name) + '.xlsx'), fileToXlsx(file, project.customMarks));
}

export async function writeMeta(root: string, project: ProjectData, last?: LastPosition) {
  const dir = io.join(root, project.name);
  await io.mkdir(dir);
  const meta: ProjectMeta = {
    customMarks: project.customMarks,
    nextMarkId: project.nextMarkId ?? 1,
    fileOrder: project.files.map((f) => safeName(f.name)),
    last,
  };
  await io.writeText(io.join(dir, META), JSON.stringify(meta, null, 2));
}

export async function writeDict(root: string, dict: string, terms: GlossaryTerm[]) {
  const dir = io.join(root, DICT_DIR);
  await io.mkdir(dir);
  await io.writeBinary(io.join(dir, safeName(dict) + '.xlsx'), dictToXlsx(terms));
}
