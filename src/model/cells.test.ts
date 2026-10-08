import { describe, expect, it } from 'vitest';
import { cellKey, clearCells, copyMatrix, deleteCells, insertCells, moveCells, pasteMatrix, rectKeys } from './cells';
import type { Entry } from './types';

const E = (id: string, src: string, tgt = ''): Entry => ({
  uid: id, id, speaker: '無', src, src0: src, tgt, tgt0: tgt, mark: '', pending: false, skipCheck: false, note: '', sugg: '',
});
const entries = () => [E('1', 'a', 'A'), E('2', 'b', 'B'), E('3', 'c', 'C'), E('4', 'd', '')];
const all = [0, 1, 2, 3];
const tgts = (es: Entry[]) => es.map((e) => e.tgt);

describe('條目欄格子', () => {
  it('拖動選取成長方形，照看得到的順序', () => {
    expect(rectKeys(all, { i: 0, c: 2 }, { i: 1, c: 3 }).sort()).toEqual(['0:2', '0:3', '1:2', '1:3']);
    expect(rectKeys([0, 2, 3], { i: 0, c: 3 }, { i: 3, c: 3 })).toEqual(['0:3', '2:3', '3:3']);
  });
  it('複製選取範圍，沒選到的格子留空', () => {
    expect(copyMatrix(entries(), all, [cellKey(0, 2), cellKey(0, 3), cellKey(2, 3)])).toEqual([['a', 'A'], ['', 'C']]);
  });
  it('貼上從左上角開始往右往下填，中間的空行照樣貼、結尾的空行拿掉，多出的行新增條目，被貼到的算待確認', () => {
    const r = pasteMatrix(entries(), all, { i: 2, c: 3 }, [['X'], [''], ['Y'], ['Z'], [''], ['']]);
    expect(tgts(r.entries)).toEqual(['A', 'B', 'X', '', 'Y', 'Z']);
    expect(r.entries[5].pending).toBe(true);
    expect(r.entries[2].pending).toBe(true);
    expect(r.entries[0].pending).toBe(false);
  });
  it('貼上多欄時超過譯文的欄忽略', () => {
    const r = pasteMatrix(entries(), all, { i: 0, c: 2 }, [['s', 't', 'extra']]);
    expect([r.entries[0].src, r.entries[0].tgt]).toEqual(['s', 't']);
  });
  it('清除只清選到的格子', () => {
    expect(tgts(clearCells(entries(), ['1:3']))).toEqual(['A', '', 'C', '']);
  });
  it('刪除只刪選到的格子，下面的往上補，條目數不變', () => {
    const r = deleteCells(entries(), ['0:3']);
    expect(tgts(r)).toEqual(['B', 'C', '', '']);
    expect(r.map((e) => e.src)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('插入在第一條後面加空白格，擠出去的內容放到新條目', () => {
    const r = insertCells([E('1', 'a', 'A'), E('2', 'b', 'B')], ['0:3']);
    expect(tgts(r)).toEqual(['A', '', 'B']);
    expect(r.length).toBe(3);
  });
  it('上移下移：跟相鄰格子交換，到頂不動', () => {
    const r = moveCells(entries(), ['1:3'], -1);
    expect(tgts(r.entries)).toEqual(['B', 'A', 'C', '']);
    expect(r.keys).toEqual(['0:3']);
    expect(moveCells(entries(), ['0:3'], -1).entries).toEqual(entries());
  });
});
