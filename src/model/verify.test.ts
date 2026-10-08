import { describe, expect, it } from 'vitest';
import { applyChange, applyOne, compose, rebase, spansOf, textToVerify, verifyToText, type VEdit } from './verify';

// 比對時不看每組修改的編號
const st = (xs: VEdit[]) => xs.map(({ s, e, t }) => ({ s, e, t }));

const T = 'Happy New Year';
// 模擬在修改框把 [a, b) 換成 r
const type = (tgt: string, edits: VEdit[], a: number, b: number, r: string) => {
  const mod = compose(tgt, edits);
  const next = mod.slice(0, a) + r + mod.slice(b);
  return applyChange(tgt, edits, mod, next, a + r.length);
};

describe('驗證修改', () => {
  it('框選取代', () => {
    const { edits } = type(T, [], 6, 14, 'Christmas');
    expect(st(edits)).toEqual([{ s: 6, e: 14, t: 'Christmas' }]);
    expect(compose(T, edits)).toBe('Happy Christmas');
  });
  it('逐字輸入會併進同一組', () => {
    let r = type(T, [], 5, 5, ' a');
    r = type(T, r.edits, 7, 7, 'b');
    expect(st(r.edits)).toEqual([{ s: 5, e: 5, t: ' ab' }]);
  });
  it('刪除', () => {
    const { edits } = type(T, [], 5, 9, '');
    expect(st(edits)).toEqual([{ s: 5, e: 9, t: '' }]);
    expect(compose(T, edits)).toBe('Happy Year');
  });
  it('碰到已有的修改就合併，不碰到是新的一組', () => {
    let r = type(T, [], 0, 5, 'Merry');
    r = type(T, r.edits, 10, 14, 'Xmas');
    expect(r.edits.length).toBe(2);
    // 框選範圍從第一組中間跨到後面
    r = type(T, r.edits, 3, 7, 'ry N');
    expect(r.edits.length).toBe(2);
    expect(compose(T, r.edits)).toBe('Merry New Xmas');
  });
  it('改回原樣就沒有修改', () => {
    let r = type(T, [], 6, 9, 'Old');
    r = type(T, r.edits, 6, 9, 'New');
    expect(st(r.edits)).toEqual([]);
  });
  it('修改框位置', () => {
    const sp = spansOf([{ s: 0, e: 5, t: 'Hi' }, { s: 10, e: 14, t: 'Day' }]);
    expect(sp[1]).toMatchObject({ ms: 7, me: 10 });
  });
  it('套用一組', () => {
    const edits = [{ s: 0, e: 5, t: 'Merry' }, { s: 10, e: 14, t: 'Xmas' }];
    const withId = edits.map((d, i) => ({ ...d, id: 'x' + i }));
    const r = applyOne(T, withId, 'x0');
    expect(r.tgt).toBe('Merry New Year');
    expect(compose(r.tgt, r.edits)).toBe('Merry New Xmas');
  });
  it('譯文被改：改到的那組移除，其他移位置', () => {
    const edits = [{ s: 0, e: 5, t: 'Merry' }, { s: 10, e: 14, t: 'Xmas' }];
    expect(st(rebase(T, 'Happy Big New Year', edits))).toEqual([{ s: 0, e: 5, t: 'Merry' }, { s: 14, e: 18, t: 'Xmas' }]);
    expect(st(rebase(T, 'Hoppy New Year', edits))).toEqual([{ s: 10, e: 14, t: 'Xmas' }]);
  });
  it('以單詞為單位畫底線', () => {
    const T2 = 'You are stupid';
    let r = type(T2, [], 4, 7, 'is');
    const mod = compose(T2, r.edits);
    r = type(T2, r.edits, mod.indexOf('stupid'), mod.length, 'steward');
    expect(st(r.edits)).toEqual([{ s: 4, e: 7, t: 'is' }, { s: 8, e: 14, t: 'steward' }]);
    // 插入新詞不會把前面的詞算進去
    expect(st(type('You are', [], 3, 3, ' really').edits)).toEqual([{ s: 3, e: 3, t: ' really' }]);
    // 中文不往外擴
    expect(st(type('你好嗎', [], 1, 2, '們').edits)).toEqual([{ s: 1, e: 2, t: '們' }]);
  });
  it('存讀', () => {
    const v = { base: T, edits: [{ s: 0, e: 5, t: 'Merry' }], prev: 'verified' as const };
    const back = textToVerify(verifyToText(v))!;
    expect({ ...back, edits: st(back.edits) }).toEqual(v);
    expect(textToVerify('亂碼')).toBeUndefined();
    // 讀檔時：位置要是整數、排序、去掉重疊；不合法的標記不收
    const bad = textToVerify(JSON.stringify({ b: T, d: [[6, 14, 'X'], [1.5, 3, 'Y'], [0, 5, 'A'], [3, 8, 'Z']], m: 'nonsense' }))!;
    expect(st(bad.edits)).toEqual([{ s: 0, e: 5, t: 'A' }, { s: 6, e: 14, t: 'X' }]);
    expect(bad.prev).toBeUndefined();
    // 修改清空了但記著自動疑慮前的標記：照樣存
    expect(textToVerify(verifyToText({ base: T, edits: [], prev: '' }))?.prev).toBe('');
  });
  it('修改組用編號認：套用一組後，另一組還認得', () => {
    let r = type(T, [], 0, 5, 'Merry');
    const firstId = r.active;
    r = type(T, r.edits, 10, 14, 'Xmas');
    const applied = applyOne(T, r.edits, firstId);
    expect(applied.edits.length).toBe(1);
    expect(compose(applied.tgt, applied.edits)).toBe('Merry New Xmas');
  });
});
