// 雲端模式的專案與共用設定（都記在 Verso 資料表，同一張資料表的人共用）：
// - 「Verso專案」分頁：專案名稱、字典網址（這個專案的雲端字典檔）、預設長度標準
// - 「Verso設定」分頁：一列一種設定（目前有「常用標準」）；之後新增設定只加列，不用再開分頁
// 雲端才有的專案只放在記憶體裡（不存進存檔資料夾），關掉雲端模式時拿掉
import { tx } from '../../i18n';
import { SHARED, type ProjectData } from '../../model/types';
import { stdToText, textToStd, type LengthStd, type StdValue } from '../../model/length';
import { showToast, useStore, withProject } from '../../state/store';
import { addTab, appendRows, deleteRows, errText, readTabs, sidOf, tabGrids, writeRows } from './api';
import { setConfig, useCloud } from './config';

export interface CloudProject { name: string; dictUrl: string; std?: StdValue }

const PROJ_TAB = 'Verso專案';
const PROJ_HEAD = ['專案名稱', '字典網址', '預設長度標準', '更新者', '更新時間'];
const SET_TAB = 'Verso設定';
const SET_HEAD = ['設定', '內容', '更新者', '更新時間'];
const PRESETS = '常用標準';

const projRows = new Map<string, number>();
const setRows = new Map<string, number>();
let tabs: { gid: number; title: string }[] = [];
/** 上次從資料表讀到的常用標準（自己寫上去的不用再寫一次） */
let presetsSig = '';

const dataSid = () => sidOf(useCloud.getState().cfg.dataUrl ?? '') ?? '';
const stamp = () => [useCloud.getState().email ?? '', new Date().toISOString()];

/** 讀「Verso專案」「Verso設定」：專案清單、各專案的字典檔和預設長度標準、常用標準 */
export async function readProjects() {
  const did = dataSid();
  if (!did) { useCloud.setState({ projects: [] }); applyProjects(); return; }
  tabs = await tabGrids(did);
  const want = [PROJ_TAB, SET_TAB].filter((t) => tabs.some((x) => x.title === t));
  const got = await readTabs(did, want);
  const pRows = want.includes(PROJ_TAB) ? got[want.indexOf(PROJ_TAB)] : [];
  const sRows = want.includes(SET_TAB) ? got[want.indexOf(SET_TAB)] : [];
  projRows.clear();
  const projects: CloudProject[] = [];
  pRows.forEach((v, r) => {
    if (r === 0 || !v[0]?.trim()) return;
    projRows.set(v[0].trim(), r);
    projects.push({ name: v[0].trim(), dictUrl: v[1] ?? '', ...(v[2] ? { std: textToStd(v[2]) } : {}) });
  });
  setRows.clear();
  let presets: { name: string; std: LengthStd }[] | null = null;
  sRows.forEach((v, r) => {
    if (r === 0 || !v[0]) return;
    setRows.set(v[0], r);
    if (v[0] === PRESETS) { try { const x = JSON.parse(v[1] ?? '[]'); if (Array.isArray(x)) presets = x; } catch { /* 壞掉就不用 */ } }
  });
  useCloud.setState({ projects });
  applyProjects();
  if (presets) applyPresets(presets);
}

/** 把雲端專案放進 Verso：專案清單、各專案的字典檔、預設長度標準 */
function applyProjects() {
  const ps = useCloud.getState().projects;
  ensureProjects(ps.map((p) => p.name));
  const files: Record<string, string> = {};
  const stds: Record<string, StdValue> = {};
  ps.forEach((p) => { const sid = sidOf(p.dictUrl); if (sid) files[p.name] = sid; if (p.std) stds[p.name] = p.std; });
  useStore.setState({ cloudDictFile: files, cloudProjectStd: stds });
}

/** 雲端檔案、字典用到的專案：本地沒有的加進清單（記成「雲端才有」，存檔時不碰） */
export function ensureProjects(names: string[]) {
  const s = useStore.getState();
  const p = s.project;
  if (!p) return;
  let projects = p.projects;
  const added: string[] = [];
  for (const n of new Set(names.filter(Boolean))) {
    if (projects.includes(n)) continue;
    projects = withProject(projects, n);
    added.push(n);
  }
  if (!added.length) return;
  useStore.setState({ cloudProjects: [...s.cloudProjects, ...added], project: { ...p, projects } });
}

/** 關掉雲端模式：雲端才有的專案、字典檔、預設長度標準都拿掉，常用標準換回這台電腦的 */
export function leaveProjects() {
  const s = useStore.getState();
  const extra = s.cloudProjects;
  const p = s.project;
  if (p && extra.length) {
    // 還有本地檔案或本地字典在用的專案留著
    const used = new Set([...p.files.filter((f) => !f.cloud).map((f) => f.project), ...p.dicts.filter((d) => !d.cloud).map((d) => d.project)]);
    useStore.setState({ project: { ...p, projects: p.projects.filter((x) => !extra.includes(x) || used.has(x)) } });
  }
  useStore.setState({ cloudProjects: [], cloudDictFile: {}, cloudProjectStd: {} });
  const local = useCloud.getState().cfg.localPresets;
  if (local) { useStore.setState({ lengthPresets: local }); setConfig({ localPresets: undefined }); }
  presetsSig = '';
}

/** 打開雲端模式時記下這台電腦原本的常用標準（資料表裡還沒有常用標準時，先沿用這份） */
export function backupPresets() {
  if (!useCloud.getState().cfg.localPresets) setConfig({ localPresets: useStore.getState().lengthPresets });
}

/** 雲端模式用資料表裡的常用標準；這台電腦原本的先記著，關掉雲端模式時換回來 */
function applyPresets(list: { name: string; std: LengthStd }[]) {
  presetsSig = JSON.stringify(list);
  backupPresets();
  if (JSON.stringify(useStore.getState().lengthPresets) !== presetsSig) useStore.setState({ lengthPresets: list });
}

async function ensureTab(title: string, head: string[]) {
  const did = dataSid();
  if (tabs.some((x) => x.title === title)) return;
  const gid = await addTab(did, title, head.length);
  await writeRows(did, title, [{ row: 0, values: head }]);
  tabs.push({ gid, title });
}

/** 常用標準改了（雲端模式）：寫進資料表 */
export async function writePresets(list: { name: string; std: LengthStd }[]) {
  const did = dataSid();
  if (!did || JSON.stringify(list) === presetsSig) return;
  presetsSig = JSON.stringify(list);
  try {
    await ensureTab(SET_TAB, SET_HEAD);
    const values = [PRESETS, JSON.stringify(list), ...stamp()];
    const row = setRows.get(PRESETS);
    if (row !== undefined) await writeRows(did, SET_TAB, [{ row, values }]);
    else { const at = await appendRows(did, SET_TAB, [values]); if (at >= 0) setRows.set(PRESETS, at); }
  } catch (e) { showToast(tx('cloud.writeFailed', { name: tx('cloud.dataUrl'), reason: errText(e) }), { warn: true }); }
}

/** 新增或修改一個專案（oldName：改名前的名稱） */
export async function writeProject(p: CloudProject, oldName?: string) {
  const did = dataSid();
  if (!did) return;
  await ensureTab(PROJ_TAB, PROJ_HEAD);
  await readProjects();
  const values = [p.name, p.dictUrl, stdToText(p.std), ...stamp()];
  const row = projRows.get(oldName ?? p.name) ?? projRows.get(p.name);
  if (row !== undefined) await writeRows(did, PROJ_TAB, [{ row, values }]);
  else await appendRows(did, PROJ_TAB, [values]);
  await readProjects();
}

/** 刪掉一個專案的那一列 */
export async function deleteProjectRow(name: string) {
  const did = dataSid();
  const row = projRows.get(name);
  const gid = tabs.find((x) => x.title === PROJ_TAB)?.gid;
  if (!did || row === undefined || gid === undefined) return;
  await deleteRows(did, gid, [row]);
  await readProjects();
}

/** 軟體裡跟著改名：雲端檔案、雲端字典、專案清單 */
export function renameInStore(from: string, to: string) {
  const s = useStore.getState();
  const p = s.project;
  if (!p) return;
  // 本地檔案、本地字典還在用舊名稱的話，舊名稱留著
  const used = p.files.some((f) => !f.cloud && f.project === from) || p.dicts.some((d) => !d.cloud && d.project === from) || from === SHARED;
  const next: ProjectData = {
    ...p,
    projects: withProject(used ? p.projects : p.projects.filter((x) => x !== from), to),
    files: p.files.map((f) => (f.cloud && f.project === from ? { ...f, project: to } : f)),
    dicts: p.dicts.map((d) => (d.cloud && d.project === from ? { ...d, project: to } : d)),
    glossary: p.glossary.map((g) => (g.proj === from && p.dicts.some((d) => d.cloud && d.project === from && d.name === g.dict) ? { ...g, proj: to } : g)),
  };
  useStore.setState({ project: next, cloudProjects: [...s.cloudProjects.filter((x) => x !== from), to] });
}
