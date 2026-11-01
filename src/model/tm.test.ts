import { describe, expect, it } from 'vitest';
import { TmIndex, headOf, inconsistent, parseTmx, tailOf, tmPercent, toTmx, underOf, type TmRow } from './tm';

const row = (src: string, tgt: string, more: Partial<TmRow> = {}): TmRow => ({
  id: src + tgt, project: '共用', src, tgt, verified: false, by: '', at: 1, fid: 'f', file: 'a', sheet: 's', eid: '', speaker: '', ...more,
});
const all = new Set(['共用', 'P']);

describe('翻譯記憶比對', () => {
  it('百分比：完全一樣 100，只差標點 99', () => {
    expect(tmPercent('你好嗎', '你好嗎')).toBe(100);
    expect(tmPercent('你好嗎？', '你好嗎')).toBe(99);
    expect(tmPercent('Hello', 'hello')).toBe(99);
    expect(tmPercent('今天天氣很好', '今天天氣不好')).toBe(83);
  });

  it('低於下限不顯示，排序：相似度、已驗證、新的', () => {
    const idx = new TmIndex([
      row('今天天氣很好', 'A', { at: 1 }), row('今天天氣很好', 'B', { at: 2, verified: true }), row('今天天氣很好', 'C', { at: 3 }),
      row('今天天氣不好', 'D'), row('完全不一樣的句子', 'E'),
    ]);
    const m = idx.query({ src: '今天天氣很好', min: 65, projects: all });
    expect(m.map((x) => x.row.tgt)).toEqual(['B', 'C', 'A', 'D']);
    expect(m[3].pct).toBe(83);
  });

  it('只查勾選的專案；自己這條不算', () => {
    const idx = new TmIndex([row('一二三四', 'x', { project: 'Q' }), row('一二三四', 'y', { eid: '5' })]);
    expect(idx.query({ src: '一二三四', min: 65, projects: all, at: { fid: 'f', file: 'a', sheet: 's', eid: '5', speaker: '' } })).toEqual([]);
  });

  it('同檔案、同 id、同發話者：排最前面，不像也列', () => {
    const idx = new TmIndex([row('今天天氣很好', 'A'), row('完全換掉了', 'B', { fid: 'g', file: 'A', eid: '7', speaker: '甲' })]);
    const m = idx.query({ src: '今天天氣很好', min: 65, projects: all, at: { fid: 'f2', file: 'a', sheet: 's', eid: '7', speaker: '甲' } });
    expect(m[0].row.tgt).toBe('B');
    expect(m[0].same).toBe(true);
  });

  it('句式：數字、標籤、字典詞換掉後一樣，套用時換掉', () => {
    const terms = (t: string) => {
      const out = [];
      for (const [w, en] of [['火球', 'Fireball'], ['冰箭', 'Ice Arrow']]) { const k = t.indexOf(w); if (k >= 0) out.push({ start: k, end: k + w.length, ens: [en] }); }
      return out;
    };
    const r = row('施放火球造成10點傷害{0}', 'Cast Fireball to deal 10 damage{0}');
    const idx = new TmIndex([r]);
    const m = idx.query({ src: '施放冰箭造成25點傷害{1}', min: 99, projects: all, terms });
    expect(m.length).toBe(1);
    expect(m[0].kind).toBe('pattern');
    expect(idx.applyPattern(r, '施放冰箭造成25點傷害{1}', terms)).toEqual({ text: 'Cast Ice Arrow to deal 25 damage{1}', misses: [] });
    // 譯文裡找不到的：留著，回報
    const r2 = row('獲得3個金幣', 'Got some coins');
    expect(new TmIndex([r2]).applyPattern(r2, '獲得5個金幣')).toEqual({ text: 'Got some coins', misses: ['5'] });
  });

  it('片段：開頭到標點一樣，出現兩次以上才列', () => {
    expect(headOf('你確定嗎？要離開了')).toEqual([0, 4]);
    expect(tailOf('好吧，我們走吧。')).toEqual([3, 7]);
    const one = new TmIndex([row('你確定嗎？要離開了', 'a'), row('天空很藍', 'b')]);
    expect(one.query({ src: '你確定嗎？今天不行', min: 90, projects: all })).toEqual([]);
    const two = new TmIndex([row('你確定嗎？要離開了', 'a'), row('你確定嗎？不再想想', 'b')]);
    const m = two.query({ src: '你確定嗎？今天不行', min: 90, projects: all });
    expect(m.map((x) => x.kind)).toEqual(['frag', 'frag']);
    expect(m[0].under).toEqual([[0, 4]]);
  });

  it('底線：記憶原文裡跟目前一樣的部分', () => {
    expect(underOf('今天天氣很好', '今天天氣不好')).toEqual([[0, 4], [5, 6]]);
  });

  it('一致性：同一個原文有不同譯文', () => {
    expect(inconsistent([row('甲', 'A'), row('甲', 'B'), row('乙', 'C'), row('乙', 'C')]).map((x) => x.src)).toEqual(['甲']);
  });

  it('TMX 匯出再讀回來', () => {
    const r = row('<你好> & "再見"', 'Hi & bye', { verified: true, by: '一加', at: Date.UTC(2026, 0, 2, 3, 4, 5), file: 'F', sheet: 'S', eid: '9', speaker: '甲' });
    const back = parseTmx(toTmx([r]));
    expect(back).toEqual([{ src: r.src, tgt: r.tgt, verified: true, by: '一加', at: r.at, fid: '', file: 'F', sheet: 'S', eid: '9', speaker: '甲' }]);
    const other = parseTmx('<tmx><header srclang="en-US"/><body><tu><tuv xml:lang="en-US"><seg>Hello <ph>{0}</ph></seg></tuv><tuv xml:lang="zh-TW"><seg>你好 {0}</seg></tuv></tu></body></tmx>');
    expect(other[0].src).toBe('你好 {0}');
    expect(other[0].tgt).toBe('Hello {0}');
  });
});
