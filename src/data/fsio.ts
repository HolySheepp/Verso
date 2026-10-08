// 檔案存取：桌面版用 Tauri 的檔案系統；瀏覽器預覽時存在 localStorage，方便測試
import { tx } from '../i18n';
import { isTauri } from '@tauri-apps/api/core';

export interface FileIO {
  readBinary(path: string): Promise<Uint8Array>;
  writeBinary(path: string, data: Uint8Array): Promise<void>;
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  /** 列出資料夾裡的項目名稱 */
  list(path: string): Promise<{ name: string; dir: boolean }[]>;
  /** 刪除；資料夾要加 recursive 才會連裡面的東西一起刪 */
  remove(path: string, opts?: { recursive?: boolean }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** 移到資源回收筒（瀏覽器預覽時直接刪掉） */
  trash(path: string): Promise<void>;
  join(...parts: string[]): string;
  /** 預設的存檔資料夾（文件\Verso） */
  defaultRoot(): Promise<string>;
  /** App 設定檔的位置 */
  configPath(): Promise<string>;
  /** 讓使用者選一個資料夾 */
  pickFolder(start?: string): Promise<string | null>;
  /** 監看資料夾（含子資料夾），有變動時呼叫 onChange（連續的變動合成一次）；回傳停止監看的函式 */
  watch(path: string, onChange: () => void): Promise<() => void>;
}

type FsPlugin = typeof import('@tauri-apps/plugin-fs');

/**
 * 安全存檔：先寫到暫存檔、讀回確認完整，再取代原檔。
 * 取代時原檔先改名成備份，新檔就位後才刪掉備份；中途失敗就把原檔放回去。
 * 所以不管在哪一步出事（當機、斷電、被別的程式鎖住），原本的檔案都還在。
 */
async function safeWrite(fs: FsPlugin, p: string, d: Uint8Array) {
  const tmp = p + '.tmp', bak = p + '.bak';
  await fs.writeFile(tmp, d);
  const back = await fs.readFile(tmp);
  if (back.length !== d.length) {
    await fs.remove(tmp).catch(() => undefined);
    throw new Error(tx('fs.001'));
  }
  const had = await fs.exists(p);
  if (had) {
    if (await fs.exists(bak)) await fs.remove(bak);
    await fs.rename(p, bak);
  }
  try {
    await fs.rename(tmp, p);
  } catch (e) {
    if (had) await fs.rename(bak, p).catch(() => undefined);
    throw e;
  }
  if (had) await fs.remove(bak).catch(() => undefined);
}

const tauriIO = (): FileIO => {
  const fsp = import('@tauri-apps/plugin-fs');
  const pathp = import('@tauri-apps/api/path');
  const sep = '\\';
  return {
    async readBinary(p) { return (await fsp).readFile(p); },
    async writeBinary(p, d) { await safeWrite(await fsp, p, d); },
    async readText(p) { return (await fsp).readTextFile(p); },
    async writeText(p, t) { await safeWrite(await fsp, p, new TextEncoder().encode(t)); },
    async rename(a, b) { await (await fsp).rename(a, b); },
    async exists(p) { return (await fsp).exists(p); },
    async mkdir(p) { await (await fsp).mkdir(p, { recursive: true }); },
    async list(p) { return (await (await fsp).readDir(p)).map((e) => ({ name: e.name, dir: e.isDirectory })); },
    async remove(p, opts) { await (await fsp).remove(p, opts?.recursive ? { recursive: true } : undefined); },
    async trash(p) {
      if (!(await (await fsp).exists(p))) return;
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('move_to_trash', { path: p });
    },
    join: (...parts) => parts.join(sep).replace(/[\\/]+/g, sep),
    async defaultRoot() { return (await (await pathp).documentDir()) + sep + 'Verso'; },
    async configPath() { return (await (await pathp).appConfigDir()) + sep + 'config.json'; },
    async pickFolder(start) {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const r = await open({ directory: true, defaultPath: start });
      return typeof r === 'string' ? r : null;
    },
    async watch(p, onChange) {
      const stop = await (await fsp).watch(p, () => onChange(), { recursive: true, delayMs: 800 });
      return () => { try { stop(); } catch { /* 已經停了 */ } };
    },
  };
};

/** 瀏覽器預覽用：路徑當成 localStorage 的 key */
const browserIO = (): FileIO => {
  const P = 'verso-fs:';
  const b64 = (d: Uint8Array) => { let s = ''; d.forEach((c) => { s += String.fromCharCode(c); }); return btoa(s); };
  const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const get = (p: string) => { try { return localStorage.getItem(P + p); } catch { return null; } };
  const put = (p: string, v: string) => { try { localStorage.setItem(P + p, v); } catch { /* 預覽時存不下就算了 */ } };
  const keys = () => { try { return Object.keys(localStorage).filter((k) => k.startsWith(P)).map((k) => k.slice(P.length)); } catch { return []; } };
  return {
    async readBinary(p) { const v = get(p); if (v == null) throw new Error('not found'); return unb64(v); },
    async writeBinary(p, d) { put(p, b64(d)); },
    async readText(p) { const v = get(p); if (v == null) throw new Error('not found'); return v; },
    async writeText(p, t) { put(p, t); },
    async exists(p) { return get(p) != null || keys().some((k) => k.startsWith(p + '/')); },
    async mkdir() {},
    async list(p) {
      const out = new Map<string, boolean>();
      keys().filter((k) => k.startsWith(p + '/')).forEach((k) => {
        const rest = k.slice(p.length + 1);
        const i = rest.indexOf('/');
        out.set(i < 0 ? rest : rest.slice(0, i), i >= 0);
      });
      return [...out].map(([name, dir]) => ({ name, dir }));
    },
    async remove(p) { keys().filter((k) => k === p || k.startsWith(p + '/')).forEach((k) => { try { localStorage.removeItem(P + k); } catch { /* 忽略 */ } }); },
    async trash(p) { await this.remove(p); },
    async rename(a, b) { const v = get(a); if (v == null) throw new Error('not found'); put(b, v); await this.remove(a); },
    join: (...parts) => parts.join('/').replace(/\/+/g, '/'),
    async defaultRoot() { return 'Verso'; },
    async configPath() { return 'config.json'; },
    async pickFolder() { return null; },
    async watch() { return () => {}; },
  };
};

export const io: FileIO = isTauri() ? tauriIO() : browserIO();
