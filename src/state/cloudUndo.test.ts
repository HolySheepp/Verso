import { describe, expect, it } from 'vitest';
import { useStore } from './store';
import type { Entry, FileDoc } from '../model/types';

const e = (i: number, tgt: string): Entry => ({ uid: 'u' + i, id: String(i), speaker: '', src: 's' + i, src0: 's' + i, tgt, tgt0: tgt, mark: '', pending: false, skipCheck: false, note: '', sugg: '' });
const tick = () => new Promise((r) => setTimeout(r, 0));
const tgts = () => useStore.getState().project!.files[0].sheets[0].entries.map((x) => x.tgt);
/** 模擬同步：別人改了某一條（換成新的物件） */
const remote = (i: number, tgt: string) => {
  const p = useStore.getState().project!;
  const f = p.files[0];
  useStore.setState({ project: { ...p, files: [{ ...f, sheets: [{ ...f.sheets[0], entries: f.sheets[0].entries.map((x, k) => (k === i ? { ...x, tgt } : x)) }] }] } });
};

describe('雲端模式的復原：只動自己改的條目', () => {
  it('同步進來別人的修改，復原只退回自己改的那條，收回復原再改回來', async () => {
    const doc: FileDoc = { fid: 'c1', cloud: { sid: 'x' }, name: 'c', project: '共用', sheets: [{ name: 'S', gid: 1, entries: [e(0, 'a'), e(1, 'b')] }] };
    useStore.setState({ cloudMode: true, project: { files: [doc], customMarks: [], nextMarkId: 1, glossary: [], dicts: [], projects: ['共用'], refs: [] }, file: 0, sheetBy: {}, selBy: { '0:0': 0 } });
    useStore.getState().updateEntry({ tgt: 'mine' });
    await tick();
    remote(1, 'theirs');
    // 別人又改了自己改過的那條：復原照樣退回自己改之前
    remote(0, 'theirs0');
    useStore.getState().undoSheet();
    expect(tgts()).toEqual(['a', 'theirs']);
    useStore.getState().redoSheet();
    expect(tgts()).toEqual(['theirs0', 'theirs']);
  });

  it('在輸入框編輯時遇到同步，沒改內容不算一步', async () => {
    const doc: FileDoc = { fid: 'c2', cloud: { sid: 'y' }, name: 'c', project: '共用', sheets: [{ name: 'S', gid: 1, entries: [e(0, 'a'), e(1, 'b')] }] };
    useStore.setState({ cloudMode: true, project: { files: [doc], customMarks: [], nextMarkId: 1, glossary: [], dicts: [], projects: ['共用'], refs: [] }, file: 0, sheetBy: {}, selBy: { '0:0': 0 } });
    useStore.getState().beginEdit();
    remote(1, 'theirs');
    useStore.getState().endEdit();
    await tick();
    useStore.getState().undoSheet();
    expect(tgts()).toEqual(['a', 'theirs']);
  });

  it('復原自己加的留言時，別人後來加的留言留著；其他欄位也只放回自己改的', async () => {
    const doc: FileDoc = { fid: 'c3', cloud: { sid: 'z' }, name: 'c', project: '共用', sheets: [{ name: 'S', gid: 1, entries: [{ ...e(0, 'a'), comments: [], noteBase: '', note: '' }] }] };
    useStore.setState({ cloudMode: true, userName: 'Me', project: { files: [doc], customMarks: [], nextMarkId: 1, glossary: [], dicts: [], projects: ['共用'], refs: [] }, file: 0, sheetBy: {}, selBy: { '0:0': 0 } });
    const t = '2026-10-29T00:00:00Z';
    useStore.getState().setComments('u0', (l) => [...l, { id: 'mine', author: 'Me', time: t, text: 'hi', replies: [] }]);
    await tick();
    // 同步：別人加了一則留言、改了譯文
    const p = useStore.getState().project!;
    const x = p.files[0].sheets[0].entries[0];
    const comments = [...x.comments!, { id: 'theirs', author: 'Ann', time: t, text: 'yo', replies: [] }];
    useStore.setState({ project: { ...p, files: [{ ...p.files[0], sheets: [{ ...p.files[0].sheets[0], entries: [{ ...x, comments, tgt: 'changed' }] }] }] } });
    useStore.getState().undoSheet();
    const y = useStore.getState().project!.files[0].sheets[0].entries[0];
    expect(y.comments!.map((c) => c.id)).toEqual(['theirs']);
    expect(y.note).toBe('[Ann] yo');
    expect(y.tgt).toBe('changed');
  });
});
