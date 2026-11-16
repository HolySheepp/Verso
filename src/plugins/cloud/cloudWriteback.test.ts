import { describe, expect, it, vi } from 'vitest';
const fsFiles = new Map<string, string>();
vi.mock('@tauri-apps/api/core', async () => { const f = await import('./fake'); return { isTauri: () => false, invoke: async (cmd: string, a: any) => f.invoke(cmd, a) }; });
vi.mock('@tauri-apps/api/path', () => ({ appDataDir: async () => '/app', join: async (...p: string[]) => p.join('/') }));
vi.mock('@tauri-apps/plugin-fs', () => ({ exists: async (p: string) => fsFiles.has(p) || p.endsWith('/cache') || p.endsWith('/cloud'), mkdir: async () => {}, readTextFile: async (p: string) => fsFiles.get(p) ?? '', writeTextFile: async (p: string, t: string) => { fsFiles.set(p, t); } }));
import { books, mk } from './fake';
// 假的 Google 試算表（./fake）驗證寫回與重讀
const SID = 'S'.repeat(25), DID = 'D'.repeat(25);
const R = (a: number, b: number) => [[a, b]] as [number, number][];
const F = (n: number) => ({ id: { col: 0, runs: R(1, n), open: true }, speaker: { col: 1, runs: R(1, n), open: true }, src: { col: 2, runs: R(1, n), open: true }, tgt: { col: 3, runs: R(1, n), open: true }, note: { col: 4, runs: R(1, n), open: true } });
const head = ['id', 'sp', 'src', 'tgt', 'note'];
async function boot(rows: string[][] | null, removed?: any) {
  vi.resetModules();
  const { useStore } = await import('../../state/store');
  const { useCloud } = await import('./config');
  const sync = await import('./sync');
  if (rows) { books.clear(); mk(SID, { T1: [head, ...rows] }); mk(DID, {}); }
  const n = books.get(SID)!.tabs[0].rows.length - 1;
  const conf = { sid: SID, title: 'Book ' + SID, project: 'P', tabs: [{ gid: 1, title: 'T1', fields: F(n) }], ...(removed ? { removed } : {}) };
  useStore.setState({ cloudMode: true, file: 0, sheetBy: {}, selBy: {}, project: { files: [], customMarks: [], glossary: [], dicts: [], projects: ['P'], refs: [] } as any });
  useCloud.setState({ cfg: { on: true, clientId: '', clientSecret: '', sheets: [conf as any], dataUrl: DID }, email: 'me@x', shared: [], conflicts: [] });
  sync.watchStore();
  sync.ensureStubs();
  expect(await sync.loadSheet(SID)).toBe(true);
  const ents = () => useStore.getState().project!.files.find((f) => f.fid === 'g:' + SID)!.sheets[0].entries;
  const patch = (uid: string, fn: (e: any) => any) => useStore.getState().aiPatch('g:' + SID, 0, uid, fn);
  return { useStore, useCloud, sync, ents, patch, G: () => books.get(SID)!.tabs[0].rows };
}

describe('雲端寫回後重讀', () => {
  it('剛插入的列設了標記，寫回後重讀還在', async () => {
    fsFiles.clear();
    const a = await boot([['a', '', 'SA', 'ta', ''], ['b', '', 'SB', 'tb', '']]);
    a.useStore.setState({ sheetBy: { 0: 0 }, selBy: { '0:0': 0 } });
    a.sync.rowOp('insert', [0], 1);
    await new Promise((r) => setTimeout(r, 100));
    a.useStore.setState({ selBy: { '0:0': 2 } });
    const n = a.ents()[1];
    a.patch(n.uid, (x) => ({ ...x, id: 'n1', src: 'NS', tgt: 'NT', mark: 'doubt' }));
    await a.sync.flush(SID, true);
    await a.sync.refreshAll(true, SID);
    expect(a.ents().map((e) => e.id + '/' + e.mark)).toEqual(['a/', 'n1/doubt', 'b/']);
  });

  it('改了 ID 的條目寫回後，標記還在', async () => {
    fsFiles.clear();
    const a = await boot([['a', '', 'SA', 'ta', ''], ['b', '', 'SB', 'tb', '']]);
    a.useStore.setState({ sheetBy: { 0: 0 }, selBy: { '0:0': 1 } });
    a.patch(a.ents()[0].uid, (x) => ({ ...x, mark: 'doubt' }));
    await a.sync.flush(SID, true);
    a.patch(a.ents()[0].uid, (x) => ({ ...x, id: 'a2' }));
    await a.sync.flush(SID, true);
    await a.sync.refreshAll(true, SID);
    expect(a.ents().map((e) => e.id + '/' + e.mark)).toEqual(['a2/doubt', 'b/']);
  });

  it('有隱藏列時，沒寫回的譯文重開後仍在原本那一條', async () => {
    fsFiles.clear();
    const rm = { rows: { '1': ['X\u00000'] } };
    let a = await boot([['X', '', 'S1', 't1', ''], ['X', '', 'S2', 't2', ''], ['X', '', 'S3', 't3', '']], rm);
    a.useStore.setState({ selBy: { '0:0': 0 } });
    (globalThis as any).__fail = true; a.patch(a.ents()[1].uid, (x) => ({ ...x, tgt: 'MINE-S3' }));
    await new Promise((r) => setTimeout(r, 2300)); await a.sync.saveCachesNow(); (globalThis as any).__fail = false;
    a = await boot(null, rm);
    expect(a.ents().map((e) => e.src + ':' + e.tgt)).toEqual(['S2:t2', 'S3:MINE-S3']);
  });

  it('更新原文新增的句子，寫回暫停時重讀不會被洗掉', async () => {
    fsFiles.clear();
    const a = await boot([['a', '', 'SA', 'ta', ''], ['b', '', 'SB', 'tb', '']]);
    a.useCloud.setState({ conflicts: [{ sid: SID, gid: 1, uid: 'zz', id: 'a', src: '', field: 'tgt', mine: 'm', theirs: 't' }] });
    const { blankEntry } = await import('../../model/cells');
    const out = [...a.ents(), { ...blankEntry(), id: 'N', src: 'NS', src0: 'NS', speaker: '無', pending: false }];
    await a.sync.applyCloudUpdate(SID, 0, out);
    await a.sync.refreshAll(true, SID);
    expect(a.ents().map((e) => e.id)).toEqual(['a', 'b', 'N']);
  });
});
