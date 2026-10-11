import { describe, it, expect, vi, afterEach } from 'vitest';
import { io } from './fsio';
import { MAX_PACK_BYTES, readLangPacks } from './langpacks';
import { saveRootFor } from './persist';

afterEach(() => vi.restoreAllMocks());

describe('語言包：沒改過不重讀、太大跳過（夜間檢查 45）', () => {
  it('修改時間和大小沒變就不再讀檔；超過 5 MB 不列出', async () => {
    vi.spyOn(io, 'join').mockImplementation((...p: string[]) => p.join('/'));
    vi.spyOn(io, 'exists').mockResolvedValue(true);
    vi.spyOn(io, 'list').mockResolvedValue([{ name: 'English.xlsx', dir: false }, { name: 'Big.xlsx', dir: false }]);
    vi.spyOn(io, 'stat').mockImplementation(async (p: string) => (p.endsWith('Big.xlsx') ? { size: MAX_PACK_BYTES + 1, mtime: 1 } : { size: 10, mtime: 5 }));
    const read = vi.spyOn(io, 'readBinary').mockResolvedValue(new Uint8Array([1, 2, 3]));
    const a = await readLangPacks('R');
    expect([...a.keys()]).toEqual(['English']);
    await readLangPacks('R');
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe('存檔資料夾裡只有「語言」（夜間檢查 44）', () => {
  it('當成空資料夾，不改到 Verso 子資料夾', async () => {
    vi.spyOn(io, 'join').mockImplementation((...p: string[]) => p.join('/'));
    vi.spyOn(io, 'exists').mockResolvedValue(true);
    vi.spyOn(io, 'list').mockResolvedValue([{ name: '語言', dir: true }]);
    expect(await saveRootFor('D')).toBe('D');
  });
});
