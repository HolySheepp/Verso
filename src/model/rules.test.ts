import { describe, expect, it } from 'vitest';
import { emptyHistory, recordText, selectSlot } from './history';
import { effectiveMark, isDone, toStoredMark, checkMarkText } from './marks';

describe('標記', () => {
  it('有譯文算已翻譯，沒有就是未翻譯', () => {
    expect(effectiveMark({ mark: '', tgt: 'Hi' })).toBe('translated');
    expect(effectiveMark({ mark: '', tgt: '' })).toBe('untranslated');
  });
  it('刻意標記優先', () => {
    expect(effectiveMark({ mark: 'doubt', tgt: '' })).toBe('doubt');
    expect(effectiveMark({ mark: 'c:c1', tgt: 'x' })).toBe('c:c1');
  });
  it('已翻譯、未翻譯不會存下來', () => {
    expect(toStoredMark('translated')).toBe('');
    expect(toStoredMark('untranslated')).toBe('');
    expect(toStoredMark('verified')).toBe('verified');
    expect(toStoredMark('c:x')).toBe('c:x');
  });
  it('忽略算完成', () => {
    expect(isDone({ mark: 'ignore', tgt: '' })).toBe(true);
    expect(isDone({ mark: 'doubt', tgt: '' })).toBe(false);
  });
  it('自訂文字標記限制', () => {
    expect(checkMarkText('TM').ok).toBe(true);
    expect(checkMarkText('ABC').ok).toBe(false);
    expect(checkMarkText('長').ok).toBe(true);
    expect(checkMarkText('長長').ok).toBe(false);
  });
});

describe('記錄槽位', () => {
  it('每條最多 3 段，保留最新的', () => {
    let h = emptyHistory();
    for (const t of ['a', 'b', 'c', 'd']) h = recordText(h, 'e1', t);
    expect(h.byEntry.e1.texts).toEqual(['b', 'c', 'd']);
    expect(h.byEntry.e1.slot).toBe(2);
  });
  it('和上一次相同不重複存', () => {
    let h = recordText(emptyHistory(), 'e1', 'a');
    h = recordText(h, 'e1', 'b');
    h = selectSlot(h, 'e1', 0);
    h = recordText(h, 'e1', 'b');
    expect(h.byEntry.e1.texts).toEqual(['a', 'b']);
    expect(h.byEntry.e1.slot).toBe(1);
  });
  it('和更早的記錄相同但不是上一次，仍會存', () => {
    let h = recordText(emptyHistory(), 'e1', 'a');
    h = recordText(h, 'e1', 'b');
    h = recordText(h, 'e1', 'a');
    expect(h.byEntry.e1.texts).toEqual(['a', 'b', 'a']);
  });
  it('全部最多 3 條，第 4 條進來時丟掉最早的', () => {
    let h = emptyHistory();
    for (const id of ['e1', 'e2', 'e3', 'e4']) h = recordText(h, id, 'x');
    expect(Object.keys(h.byEntry).sort()).toEqual(['e2', 'e3', 'e4']);
    expect(h.order).toEqual(['e2', 'e3', 'e4']);
  });
  it('空字串不記錄', () => {
    expect(recordText(emptyHistory(), 'e1', '')).toEqual(emptyHistory());
  });
});
