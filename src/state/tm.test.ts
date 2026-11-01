import { describe, expect, it } from 'vitest';
import { useStore } from './store';
import { currentMatches, deleteRows, flushTm, loadTm, memoryBackend, mergeRemote, setTmBackend, startTm, undoTm, useTm, type TmOp } from './tm';
import type { Entry, FileDoc } from '../model/types';

const e = (i: number, src: string, tgt: string): Entry => ({ uid: 'u' + i, id: String(i), speaker: '', src, src0: src, tgt, tgt0: tgt, mark: '', pending: false, skipCheck: false, note: '', sugg: '' });
const rows = () => [...useTm.getState().rows.values()];

async function setup(entries: Entry[]) {
  setTmBackend(memoryBackend());
  const doc: FileDoc = { fid: 'f1', name: 'A', project: 'P', sheets: [{ name: 'S', entries }] };
  useStore.setState({ cloudMode: false, mode: 'translate', saveRoot: '/r' + Math.random(), project: { files: [doc], customMarks: [], nextMarkId: 1, glossary: [], dicts: [], projects: ['P', '共用'], refs: [] }, file: 0, sheetBy: {}, selBy: { '0:0': 0 }, filter: {} });
  startTm();
  await loadTm(useStore.getState().saveRoot);
}

describe('翻譯記憶：寫入、比對、合併', () => {
  it('按下一條寫進記憶；譯文空的不寫；同一條重新翻譯蓋掉', async () => {
    await setup([e(0, '你好嗎', 'How are you'), e(1, '今天天氣很好', ''), e(2, '你好嗎？', '')]);
    useStore.getState().next();
    useStore.getState().next();
    expect(rows().map((r) => [r.src, r.tgt, r.project, r.verified])).toEqual([['你好嗎', 'How are you', 'P', false]]);
    useStore.setState({ selBy: { '0:0': 0 } });
    useStore.getState().updateEntry({ tgt: 'How are you doing' });
    useStore.getState().next();
    expect(rows().map((r) => r.tgt)).toEqual(['How are you doing']);
    // 第 3 條「你好嗎？」比對到 99%
    useStore.setState({ selBy: { '0:0': 2 } });
    const m = currentMatches();
    expect(m.map((x) => [x.pct, x.row.tgt])).toEqual([[99, 'How are you doing']]);
    await flushTm();
    expect(useTm.getState().outbox.length).toBe(2);
  });

  it('驗證模式按下一條算已驗證；刪除可以退回', async () => {
    await setup([e(0, '一二三', 'one two three')]);
    useStore.setState({ mode: 'verify' });
    useStore.getState().next();
    expect(rows()[0].verified).toBe(true);
    deleteRows([rows()[0].id]);
    expect(rows().length).toBe(0);
    undoTm();
    expect(rows().length).toBe(1);
  });

  it('合併共用表的變動：以後改的為準，自己送出的不重複套用', async () => {
    await setup([e(0, '甲', 'A')]);
    useStore.getState().next();
    const mine = rows()[0];
    const later: TmOp = { k: 'put', op: 'x1', t: mine.at + 1000, row: { ...mine, tgt: 'B', at: mine.at + 1000 } };
    const older: TmOp = { k: 'put', op: 'x2', t: mine.at - 1000, row: { ...mine, tgt: 'C', at: mine.at - 1000 } };
    mergeRemote([older], new Set());
    expect(rows()[0].tgt).toBe('A');
    mergeRemote([later], new Set());
    expect(rows()[0].tgt).toBe('B');
    mergeRemote([{ k: 'del', op: 'x3', t: mine.at + 2000, id: mine.id, project: 'P' }], new Set(['x3']));
    expect(rows().length).toBe(1);
    mergeRemote([{ k: 'del', op: 'x4', t: mine.at + 2000, id: mine.id, project: 'P' }], new Set());
    expect(rows().length).toBe(0);
  });
});
