import { describe, it, expect, vi, afterEach } from 'vitest';
import { io } from './fsio';
import { migrateLangProject } from './persist';

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

describe('舊的「語言」專案（夜間檢查 16）', () => {
  it('改名成「語言 (專案)」，字典一起搬，語言包留著', async () => {
    const files = fakeFs(['R/語言/project.json', 'R/語言/劇情.xlsx', 'R/語言/English.xlsx', 'R/字典/語言/詞.xlsx']);
    expect(await migrateLangProject('R')).toBe('語言 (專案)');
    expect([...files.keys()].sort()).toEqual(['R/字典/語言 (專案)/詞.xlsx', 'R/語言 (專案)/project.json', 'R/語言 (專案)/劇情.xlsx', 'R/語言/English.xlsx'].sort());
  });
  it('名稱已被用掉就加編號；沒有 project.json 不動', async () => {
    fakeFs(['R/語言/project.json', 'R/語言 (專案)/project.json']);
    expect(await migrateLangProject('R')).toBe('語言 (專案 2)');
    fakeFs(['R/語言/English.xlsx']);
    expect(await migrateLangProject('R')).toBeNull();
  });
  it('上次搬到一半：接著搬進同一個「語言 (專案)」，不另開新的', async () => {
    const files = fakeFs(['R/語言/project.json', 'R/語言 (專案)/劇情.xlsx']);
    expect(await migrateLangProject('R')).toBe('語言 (專案)');
    expect([...files.keys()].sort()).toEqual(['R/語言 (專案)/project.json', 'R/語言 (專案)/劇情.xlsx'].sort());
  });
});
