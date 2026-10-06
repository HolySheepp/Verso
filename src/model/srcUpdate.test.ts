import { describe, expect, it } from 'vitest';
import { applyUpdate, arrowOf, autoAlign, orderRows, sequentialRows, similarity, summarize } from './srcUpdate';
import type { Entry } from './types';

const E = (id: string, src: string, tgt = 'T-' + src, extra: Partial<Entry> = {}): Entry => ({
  uid: 'u' + id + src, id, speaker: 'A', src, src0: src, tgt, tgt0: tgt, mark: 'verified', pending: false, skipCheck: false, note: 'n', sugg: '', ...extra,
});
const R = (src: string, id = '') => ({ id, speaker: '', src });

describe('原文更新：相似度與箭頭', () => {
  it('去掉標籤、統一標點', () => {
    expect(similarity('<b>Hello</b>, “world”!', 'hello world')).toBe(1);
    expect(arrowOf('Hi ', 'Hi')).toBe('same');
    expect(arrowOf('Hi.', 'Hi!')).toBe('yellow');
    expect(arrowOf('Hello there', 'Completely different text')).toBe('red');
    expect(arrowOf('Hi', null)).toBe('red');
  });
});

describe('原文更新：對齊', () => {
  it('ID 相同先配對', () => {
    const rows = autoAlign([{ id: '1', src: 'aaa' }, { id: '2', src: 'bbb' }], [R('zzz', '2'), R('yyy', '1')]);
    expect(rows).toEqual([{ old: 1, new: 0 }, { old: 0, new: 1 }]);
  });
  it('中間新增、刪除', () => {
    const old = ['今天天氣很好', '我們去公園', '晚上吃什麼', '明天見'].map((s) => ({ id: '', src: s }));
    const next = ['今天天氣很好', '我們去公園吧', '新的一句話在這裡', '明天見'].map((s) => R(s));
    const rows = autoAlign(old, next);
    expect(rows).toContainEqual({ old: 0, new: 0 });
    expect(rows).toContainEqual({ old: 1, new: 1 });
    expect(rows).toContainEqual({ old: 3, new: 3 });
  });
  it('順序換過的', () => {
    const old = ['The castle gate is open', 'Bring me the sword', 'Where did the merchant go', 'We sail at dawn tomorrow'].map((s) => ({ id: '', src: s }));
    const next = ['The castle gate is open', 'We sail at dawn tomorrow', 'Bring me the sword', 'Where did the merchant go'].map((s) => R(s));
    const rows = autoAlign(old, next);
    expect(rows.filter((r) => r.old !== null && r.new !== null).length).toBe(4);
    expect(rows.find((r) => r.old === 3)!.new).toBe(1);
  });
  it('移除的條目放在前一條後面', () => {
    expect(orderRows([{ old: 0, new: 0 }, { old: 2, new: 1 }, { old: 1, new: null }])).toEqual([{ old: 0, new: 0 }, { old: 1, new: null }, { old: 2, new: 1 }]);
    expect(sequentialRows(1, 2)).toEqual([{ old: 0, new: 0 }, { old: null, new: 1 }]);
  });
});

describe('原文更新：套用', () => {
  it('保留譯文與標記、暫存新原文、插入、移除', () => {
    const es = [E('1', 'Hello'), E('2', 'Bye'), E('3', 'Gone')];
    const next = [R('Hello', 'a'), R('Bye now', 'b'), R('New one', 'c')];
    const rows = [{ old: 0, new: 0 }, { old: 1, new: 1 }, { old: 2, new: null }, { old: null, new: 2 }];
    expect(summarize(es, next, rows)).toEqual({ same: 1, changed: 1, added: 1, removed: 1 });
    const out = applyUpdate(es, next, rows, { id: true, speaker: false });
    expect(out[0]).toMatchObject({ id: 'a', src: 'Hello', tgt: 'T-Hello', mark: 'verified', note: 'n' });
    expect(out[0].upd).toBeUndefined();
    expect(out[1]).toMatchObject({ src: 'Bye', upd: { src: 'Bye now' }, speaker: 'A' });
    expect(out[2].upd).toEqual({ removed: true });
    expect(out[3]).toMatchObject({ src: 'New one', pending: true, tgt: '' });
  });
  it('原文修正過、新版沒動就保留修正', () => {
    const e = E('1', 'Helo', 'x', { src: 'Hello' });
    e.src0 = 'Helo';
    const out = applyUpdate([e], [R('Helo')], [{ old: 0, new: 0 }], { id: false, speaker: false });
    expect(out[0].src).toBe('Hello');
    expect(out[0].upd).toBeUndefined();
  });
});

describe('原文更新：差異', () => {
  it('逐詞標出改過的地方', async () => {
    const { srcDiff } = await import('./srcUpdate');
    expect(srcDiff('You are stupid', 'You are steward')).toEqual([{ start: 8, end: 15 }]);
    expect(srcDiff('今天天氣很好', '今天天氣不好')).toEqual([{ start: 4, end: 5 }]);
    expect(srcDiff('a b c', 'a c')).toEqual([{ start: 2, end: 2 }]);
  });
});

describe('原文更新：每列資訊', () => {
  it('相似度與別處高相似', async () => {
    const { rowInfos } = await import('./srcUpdate');
    const infos = rowInfos(['Bring me the sword', 'We sail at dawn'], ['We sail at dawn', 'Bring me the sword'], [{ old: 0, new: 0 }, { old: 1, new: 1 }]);
    expect(infos[0].arrow).toBe('red');
    expect(infos[0].elsewhere).toBe(2);
    expect(infos[1].elsewhere).toBe(1);
    expect(rowInfos(['a'], [], [{ old: 0, new: null }])[0].sim).toBeNull();
  });
});

describe('原文更新：手動調整', () => {
  it('拖動、插入、刪除空格', async () => {
    const { moveCells, insertBlank, deleteBlank } = await import('./srcUpdate');
    const rows = [{ old: 0, new: 0 }, { old: 1, new: 1 }, { old: 2, new: 2 }];
    // 把新版第 3 列拖到最前面：原位置留空格，其他往下推
    expect(moveCells(rows, 'new', 2, 2, 0)).toEqual([{ old: 0, new: 2 }, { old: 1, new: 0 }, { old: 2, new: 1 }]);
    expect(insertBlank(rows, 'old', 1)).toEqual([{ old: 0, new: 0 }, { old: null, new: 1 }, { old: 1, new: 2 }, { old: 2, new: null }]);
    expect(deleteBlank(insertBlank(rows, 'old', 1), 'old', 1)).toEqual(rows);
    expect(deleteBlank(rows, 'old', 0)).toBe(rows);
  });
  it('高相似是拿新原文去比別列的舊原文', async () => {
    const { rowInfos } = await import('./srcUpdate');
    const infos = rowInfos(['Bring me the sword', 'Completely other'], ['We sail at dawn', 'Bring me the sword'], [{ old: 0, new: 0 }, { old: 1, new: 1 }]);
    expect(infos[0].elsewhere).toBeNull();
    expect(infos[1].elsewhere).toBe(1);
  });
});
