import { describe, it, expect, vi, afterEach } from 'vitest';
import { io } from './fsio';
import { recoverBackups } from './persist';

afterEach(() => vi.restoreAllMocks());

describe('recoverBackups 只處理存檔自己留下的檔名（第 14 項）', () => {
  it('使用者的 notes.tmp、draft.docx.bak 不動', async () => {
    const files = ['notes.tmp', 'draft.docx.bak', 'a.xlsx.tmp', 'b.xlsx.bak'];
    vi.spyOn(io, 'list').mockResolvedValue(files.map((name) => ({ name, dir: false })));
    vi.spyOn(io, 'join').mockImplementation((...p: string[]) => p.join('/'));
    const removed: string[] = [], renamed: string[] = [];
    vi.spyOn(io, 'remove').mockImplementation(async (p: string) => { removed.push(p); });
    vi.spyOn(io, 'rename').mockImplementation(async (a: string, b: string) => { renamed.push(a + '>' + b); });
    await recoverBackups('d');
    expect(removed).toEqual(['d/a.xlsx.tmp']);
    expect(renamed).toEqual(['d/b.xlsx.bak>d/b.xlsx']);
  });
});
