import { describe, expect, it } from 'vitest';
import { clearRows, deleteRows, insertRow, overwriteRows, pasteColumns, replaceCol, type Col } from './paste';
import { defaultBindings, migrateList } from './shortcuts';

const tgt: Col = { rows: ['a', 'b', 'c'], extra: 0, ids: ['1', '2', '3'] };

describe('方框的整欄操作：條目編號跟著譯文走', () => {
  it('刪除、插入時編號跟著移動，清空時保留', () => {
    expect(deleteRows(tgt, [0, 2])).toEqual({ rows: ['b'], extra: 0, ids: ['2'] });
    expect(insertRow(tgt, 0)).toEqual({ rows: ['a', '', 'b', 'c'], extra: 0, ids: ['1', null, '2', '3'] });
    expect(clearRows(tgt, [1])).toEqual({ rows: ['a', '', 'c'], extra: 0, ids: ['1', '2', '3'] });
  });

  it('從某一行往下覆蓋，超出的行補新的', () => {
    expect(overwriteRows(tgt, 2, ['x', 'y'])).toEqual({ rows: ['a', 'b', 'x', 'y'], extra: 0, ids: ['1', '2', '3', null] });
    expect(overwriteRows(null, 1, ['x'])).toEqual({ rows: ['', 'x'], extra: 0, ids: undefined });
  });

  it('整欄換掉時照位置保留編號；多欄貼上往右填', () => {
    expect(replaceCol(tgt, ['p', 'q'])).toEqual({ rows: ['p', 'q'], extra: 0, ids: ['1', '2'] });
    const out = pasteColumns(['src', 'tgt'], 'src', [['s1'], ['t1']], { src: null, tgt }, 1);
    expect(out.src?.rows).toEqual(['', 's1']);
    expect(out.tgt?.rows).toEqual(['a', 't1', 'c']);
  });
});

describe('快捷鍵設定升級', () => {
  it('舊版 Delete 綁在清除上的，改成刪除', () => {
    expect(migrateList({ clearTgt: ['Delete', 'Backspace'] })).toEqual({ clearTgt: ['Backspace'], deleteCells: ['Delete'] });
    const d = defaultBindings().list;
    expect(migrateList(d)).toBe(d);
  });
});
