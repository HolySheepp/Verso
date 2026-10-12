import { describe, it, expect, vi, afterEach } from 'vitest';
import { io } from './fsio';
import { isOldPackDir } from './persist';

afterEach(() => vi.restoreAllMocks());

/** 用一個路徑清單假裝檔案系統 */
function fakeFs(paths: string[]) {
  const files = new Map(paths.map((p) => [p, p.endsWith('project.json') ? '{"fileOrder":["劇情"]}' : 'x']));
  const dirs = () => new Set([...files.keys()].flatMap((p) => p.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'))));
  vi.spyOn(io, 'join').mockImplementation((...p: string[]) => p.join('/'));
  vi.spyOn(io, 'exists').mockImplementation(async (p: string) => files.has(p) || dirs().has(p));
  vi.spyOn(io, 'mkdir').mockImplementation(async () => undefined);
  vi.spyOn(io, 'readText').mockImplementation(async (p: string) => files.get(p) ?? '');
  vi.spyOn(io, 'remove').mockImplementation(async () => undefined);
  vi.spyOn(io, 'rename').mockImplementation(async (a: string, b: string) => { files.set(b, files.get(a)!); files.delete(a); });
  vi.spyOn(io, 'list').mockImplementation(async (d: string) => {
    const out = new Map<string, boolean>();
    for (const p of files.keys()) if (p.startsWith(d + '/')) { const rest = p.slice(d.length + 1).split('/'); out.set(rest[0], rest.length > 1); }
    return [...out].map(([name, dir]) => ({ name, dir }));
  });
  return files;
}

describe('存檔資料夾的「語言」資料夾', () => {
  it('舊版放語言包的（沒有 project.json）不是專案；有 project.json 的是一般專案', async () => {
    fakeFs(['R/語言/English.xlsx', 'S/語言/project.json']);
    expect(await isOldPackDir('R', '語言')).toBe(true);
    expect(await isOldPackDir('S', '語言')).toBe(false);
    expect(await isOldPackDir('R', '劇情')).toBe(false);
  });
});

describe('語言包放在主程式資料夾的 lang', () => {
  it('舊版存檔資料夾「語言」裡的語言包複製過去，同名的不蓋，原檔留著', async () => {
    const files = fakeFs(['R/語言/English.xlsx', 'R/語言/日本語.xlsx', 'VersoApp/lang/English.xlsx']);
    files.set('VersoApp/lang/English.xlsx', 'mine');
    vi.spyOn(io, 'readBinary').mockImplementation(async (p: string) => new TextEncoder().encode(files.get(p) ?? ''));
    vi.spyOn(io, 'writeBinary').mockImplementation(async (p: string, d: Uint8Array) => { files.set(p, new TextDecoder().decode(d)); });
    const { copyOldPacks } = await import('./langpacks');
    await copyOldPacks('R');
    expect(files.get('VersoApp/lang/English.xlsx')).toBe('mine');
    expect(files.has('VersoApp/lang/日本語.xlsx')).toBe(true);
    expect(files.has('R/語言/日本語.xlsx')).toBe(true);
  });
  it('有 project.json 的「語言」是一般專案，不複製', async () => {
    const files = fakeFs(['R/語言/project.json', 'R/語言/劇情.xlsx']);
    vi.spyOn(io, 'writeBinary').mockImplementation(async (p: string) => { files.set(p, 'x'); });
    const { copyOldPacks } = await import('./langpacks');
    await copyOldPacks('R');
    expect([...files.keys()].some((k) => k.startsWith('VersoApp/'))).toBe(false);
  });
});
