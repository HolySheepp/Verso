import { describe, expect, it } from 'vitest';
import { useStore } from './store';
import { addRow, deleteRows, flushTm, loadTm, memoryBackend, moveRows, setTmBackend, startTm, undoTm, useTm, mergeRemote } from './tm';
import type { FileDoc } from '../model/types';

async function setup() {
  const b = memoryBackend();
  setTmBackend(b);
  const doc: FileDoc = { fid: 'f1', name: 'A', project: 'P', sheets: [{ name: 'S', entries: [] }] };
  useStore.setState({ cloudMode: false, mode: 'translate', saveRoot: '/r' + Math.random(), project: { files: [doc], customMarks: [], nextMarkId: 1, glossary: [], dicts: [], projects: ['P', '共用'], refs: [] }, file: 0, sheetBy: {}, selBy: { '0:0': 0 }, filter: {} } as never);
  startTm();
  await loadTm(useStore.getState().saveRoot);
  return b;
}
const disk = async (b: ReturnType<typeof memoryBackend>) => { const p = useStore.getState().saveRoot + '/翻譯記憶.sqlite'; return (await b.load(p)).rows; };

describe('翻譯記憶：同一條又放又刪不會被刪掉', () => {
  it('搬到別的專案後重開還在', async () => {
    const b = await setup();
    addRow({ project: 'P', src: '你好', tgt: 'hi', verified: false, fid: '', file: '', sheet: '', eid: '', speaker: '' });
    await flushTm();
    expect((await disk(b)).length).toBe(1);
    const id = [...useTm.getState().rows.keys()][0];
    moveRows([id], 'Q');
    await flushTm();
    expect((await disk(b)).length).toBe(1);
  });
  it('刪除後馬上退回，重開還在', async () => {
    const b = await setup();
    addRow({ project: 'P', src: '你好', tgt: 'hi', verified: false, fid: '', file: '', sheet: '', eid: '', speaker: '' });
    await flushTm();
    const id = [...useTm.getState().rows.keys()][0];
    deleteRows([id]); undoTm();
    await flushTm();
    expect((await disk(b)).length).toBe(1);
  });
  it('同步收到換專案，重開還在', async () => {
    const b = await setup();
    addRow({ project: 'P', src: '你好', tgt: 'hi', verified: false, fid: '', file: '', sheet: '', eid: '', speaker: '' });
    await flushTm();
    const r = [...useTm.getState().rows.values()][0];
    mergeRemote([{ k: 'put', op: 'z', t: r.at + 10, row: { ...r, project: 'Q', at: r.at + 10 } }], new Set());
    await flushTm();
    expect((await disk(b)).length).toBe(1);
  });
});
describe('同一時間的刪除和放入', () => {
  it('不管順序，放入都比刪除活下來', async () => {
    await setup();
    addRow({ project: 'P', src: '你好', tgt: 'hi', verified: false, fid: '', file: '', sheet: '', eid: '', speaker: '' });
    const r = [...useTm.getState().rows.values()][0];
    const t = r.at + 5;
    const put = { k: 'put' as const, op: 'a', t, row: { ...r, project: 'Q', at: t } };
    const del = { k: 'del' as const, op: 'b', t, id: r.id, project: 'P' };
    mergeRemote([del, put], new Set());
    expect([...useTm.getState().rows.values()].map((x) => x.project)).toEqual(['Q']);
    useTm.setState({ rows: new Map([[r.id, r]]) });
    mergeRemote([put, del], new Set());
    expect([...useTm.getState().rows.values()].map((x) => x.project)).toEqual(['Q']);
  });
});
