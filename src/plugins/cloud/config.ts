// 雲端模式的設定（這台電腦的 Verso 資料夾裡的 cloud/config.json）：開關、Google 用戶端 ID、設定過的試算表
import { appDataDir, join } from '@tauri-apps/api/path';
import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { create } from 'zustand';
import { emptyFields, rowRuns, type FieldMap, type FieldSel } from '../../model/importSel';
import type { ColKey } from '../../model/paste';

/** 一個欄位在 Google 表上的範圍：哪一欄、哪幾段列；open 代表一直到表的最後一列（之後新增的列也算） */
export interface FieldRange { col: number; runs: [number, number][]; open: boolean }
export type Fields = Record<ColKey, FieldRange | null>;
export interface CloudTab { gid: number; title: string; fields: Fields }
/** 設定過的一份試算表：sid 是試算表 ID，tabs 是有設定欄位的分頁 */
export interface CloudSheet { sid: string; title: string; project: string; tabs: CloudTab[] }
export interface CloudConfig {
  on: boolean; clientId: string; clientSecret: string; sheets: CloudSheet[];
  /** Verso 資料表的網址（標記、建議翻譯、修改、各檔案的欄位設定存在這裡，大家共用） */
  dataUrl?: string;
  /** 這台電腦「不再使用」的試算表（資料表裡別人設定的也不列出來） */
  hidden?: string[];
  /** 上次打開的試算表（打開雲端模式時先讀這份） */
  last?: string;
}

const EMPTY: CloudConfig = { on: false, clientId: '', clientSecret: '', sheets: [] };

/** 設定、登入狀態與對話框（外掛自己的小 store） */
export const useCloud = create<{
  cfg: CloudConfig; loaded: boolean; email: string | null;
  setup: { sid?: string } | null; manage: boolean;
  conflicts: Conflict[];
  /** 同步中、上次同步完成的時間、上次同步的錯誤（給同步按鈕顯示） */
  syncing: boolean; lastSync: number | null; syncError: string;
  /** Verso 資料表裡記的各檔案欄位設定（同一張資料表的人共用） */
  shared: CloudSheet[];
  /** 這個版本內建了 Google 用戶端（不用自己填 ID、密鑰） */
  builtin: boolean;
}>(() => ({ builtin: false, cfg: EMPTY, loaded: false, email: null, setup: null, manage: false, conflicts: [], syncing: false, lastSync: null, syncError: '', shared: [] }));

/** 用得到的試算表：資料表裡共用的設定為準，加上這台電腦自己設定的，扣掉不再使用的 */
export function allSheets(): CloudSheet[] {
  const { cfg, shared } = useCloud.getState();
  const hidden = new Set(cfg.hidden ?? []);
  const out = shared.filter((x) => !hidden.has(x.sid));
  cfg.sheets.forEach((x) => { if (!hidden.has(x.sid) && !out.some((y) => y.sid === x.sid)) out.push(x); });
  return out;
}

/** 寫回前發現別人改過：用我的還是用對方的 */
export interface Conflict { sid: string; gid: number; uid: string; id: string; src: string; field: 'tgt' | 'note'; mine: string; theirs: string }

async function file() {
  const dir = await join(await appDataDir(), 'cloud');
  if (!(await exists(dir))) await mkdir(dir, { recursive: true });
  return join(dir, 'config.json');
}

export async function loadConfig(): Promise<CloudConfig> {
  try {
    const f = await file();
    if (await exists(f)) {
      const cfg = { ...EMPTY, ...JSON.parse(await readTextFile(f)) } as CloudConfig;
      useCloud.setState({ cfg, loaded: true });
      return cfg;
    }
  } catch { /* 讀不到就用空的 */ }
  useCloud.setState({ loaded: true });
  return useCloud.getState().cfg;
}

let saving: Promise<void> = Promise.resolve();
export function setConfig(patch: Partial<CloudConfig>) {
  const cfg = { ...useCloud.getState().cfg, ...patch };
  useCloud.setState({ cfg });
  saving = saving.then(async () => { try { await writeTextFile(await file(), JSON.stringify(cfg, null, 2)); } catch { /* 下次再寫 */ } });
}

/** 預覽裡選的範圍 → 記下來的範圍；選到最後一列的算「到底」 */
export function toFields(fields: FieldMap, lastRow: number): Fields {
  const out = {} as Fields;
  (Object.keys(fields) as ColKey[]).forEach((k) => {
    const f = fields[k];
    if (!f) { out[k] = null; return; }
    const runs = rowRuns(f.rows);
    out[k] = { col: f.col, runs, open: runs[runs.length - 1][1] >= lastRow };
  });
  return out;
}

/** 記下來的範圍 → 這次讀到的表上實際的列（「到底」的延伸到最後一列） */
export function toFieldMap(fields: Fields, lastRow: number): FieldMap {
  const out = emptyFields();
  (Object.keys(out) as ColKey[]).forEach((k) => {
    const f = fields[k];
    if (!f) return;
    const rows: number[] = [];
    f.runs.forEach(([a, b], i) => {
      const end = f.open && i === f.runs.length - 1 ? Math.max(b, lastRow) : b;
      for (let r = a; r <= end; r++) rows.push(r);
    });
    out[k] = { col: f.col, rows } satisfies FieldSel;
  });
  return out;
}
