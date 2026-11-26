import { describe, expect, it } from 'vitest';
import { fillBareTags, absorbVerified, autoName, buildDisplay, createGroup, fillTemplate, findChains, mergeGroups, normalizeGroups, splitGroup, spreadEdit, stripTagDigits, type DisplayOpts } from './entrySets';
import type { Entry } from './types';

const E = (uid: string, src: string, tgt = '', p: Partial<Entry> = {}): Entry => ({ uid, id: uid, speaker: '', src, src0: '', tgt, tgt0: '', mark: '', pending: false, skipCheck: false, note: '', sugg: '', ...p });
const opts = (p: Partial<DisplayOpts> = {}): DisplayOpts => ({ filtering: false, pass: () => true, reveal: () => false, revealInChain: () => false, groupOpen: () => false, chainOpen: () => false, ...p });

describe('條目串', () => {
  it('標籤裡的數字拿掉、字母和符號保留', () => {
    expect(stripTagDigits('攻擊力+{123A%}')).toBe('攻擊力+{A%}');
    expect(stripTagDigits('Lv 3 <color=#ff0000>x</color>')).toBe('Lv 3 <color=#ff>x</color>');
  });

  it('連在一起、只差標籤數字的條目組成一串；切割過的地方分開', () => {
    const es = [E('a', '攻擊力+{123A%}'), E('b', '攻擊力+{124A%}'), E('c', '攻擊力+{125A%}'), E('d', '防禦+{1}'), E('e', '攻擊力+{126A%}')];
    expect(findChains(es, new Set()).map((c) => c.uids)).toEqual([['a', 'b', 'c']]);
    expect(findChains(es, new Set(['a'])).map((c) => c.uids)).toEqual([['b', 'c']]);
    // 沒有標籤、完全一樣的（技能名稱）也組成一串
    expect(findChains([E('x', '火球'), E('y', '火球'), E('z', '冰箭')], new Set()).map((c) => c.uids)).toEqual([['x', 'y']]);
    // 大括號後面的 % 算在標籤裡
    expect(stripTagDigits('+{12}% 傷害')).toBe('+{}% 傷害');
    expect(fillTemplate('+{}% dmg', '+{12}% 傷害')).toBe('+{12}% dmg');
  });

  it('串的譯文套到每一條：標籤換成各自的數字', () => {
    expect(fillTemplate('ATK +{A%}', '攻擊力+{124A%}')).toBe('ATK +{124A%}');
    expect(fillTemplate('{x} and {x}', '{1x}{2x}')).toBe('{1x} and {2x}');
    expect(fillBareTags('{1x} and {x} {9y}', '{1x}{2x}{3y}')).toBe('{1x} and {2x} {9y}');
  });

  it('格式跟大多數不同的是疑慮，不受串的編輯影響', () => {
    const es = [E('a', '攻+{1A}', 'ATK +{1A}'), E('b', '攻+{2A}', 'ATK +{2A}'), E('c', '攻+{3A}', 'Attack {3A}'), E('d', '攻+{4A}')];
    const [c] = findChains(es, new Set());
    expect(c.tpl).toBe('ATK +{A}');
    expect([...c.outliers]).toEqual(['c']);
    const m = spreadEdit(es, c, 'a', 'Power +{1A}', 'tgt');
    expect(Object.fromEntries(m)).toEqual({ b: 'Power +{2A}', d: 'Power +{4A}' });
  });
});

describe('收起組', () => {
  const es = ['a', 'b', 'c', 'd', 'e', 'f'].map((u) => E(u, '原文' + u));
  it('只能收相鄰、還沒在別組的條目', () => {
    expect(createGroup(es, [], [1, 3], 'x')).toBeNull();
    const g = createGroup(es, [], [1, 2], ' 名稱 ', 'g1')!;
    expect(g).toEqual([{ id: 'g1', name: '名稱', uids: ['b', 'c'] }]);
    expect(createGroup(es, g, [2, 3], '')).toBeNull();
  });

  it('切割、合併', () => {
    const g = [{ id: 'g1', name: 'A', uids: ['a', 'b', 'c'] }, { id: 'g2', name: 'B', uids: ['e', 'f'] }];
    expect(splitGroup(g, 'a', 'n').map((x) => x.uids)).toEqual([['a'], ['b', 'c'], ['e', 'f']]);
    const m = mergeGroups(es, g, ['g1', 'g2']);
    expect(m).toEqual([{ id: 'g1', name: 'A', uids: ['a', 'b', 'c', 'd', 'e', 'f'] }]);
  });

  it('條目刪掉、移走後只留第一段相鄰的；自動收納下面連著的已驗證條目', () => {
    expect(normalizeGroups(es.filter((e) => e.uid !== 'b'), [{ id: 'g', name: '', uids: ['a', 'b', 'c'] }])).toEqual([{ id: 'g', name: '', uids: ['a', 'c'] }]);
    const moved = [es[0], es[3], es[1]];
    expect(normalizeGroups(moved, [{ id: 'g', name: '', uids: ['a', 'b'] }])[0].uids).toEqual(['a']);
    const v = es.map((e, i) => (i === 2 || i === 3 ? { ...e, mark: 'verified' as const } : e));
    expect(absorbVerified(v, [{ id: 'g', name: '', uids: ['a', 'b'], auto: true }], (e) => e.mark === 'verified')[0].uids).toEqual(['a', 'b', 'c', 'd']);
  });

  it('名稱空白時用第一條和最後一條的開頭', () => {
    expect(autoName(es, { id: 'g', name: '', uids: ['a', 'b', 'c'] })).toBe('原文a ～ 原文c');
  });
});

describe('顯示清單', () => {
  const es = [E('a', 'x'), E('b', 'y'), E('c', 'z'), E('d', '攻+{1A}'), E('e', '攻+{2A}'), E('f', 'w')];
  const groups = [{ id: 'g', name: '', uids: ['b', 'c'] }];
  const chains = findChains(es, new Set());
  it('收起的組是一個按鈕、收起的串是一列；藏起來的條目指向它的組或串', () => {
    const d = buildDisplay(es, groups, chains, opts());
    expect(d.items.map((x) => x.t)).toEqual(['row', 'group', 'chain', 'row']);
    expect(d.rows).toEqual([0, 3, 5]);
    expect(d.posOf.get(2)).toBe(1);
    expect(d.posOf.get(4)).toBe(2);
  });
  it('搜尋命中收起組裡的條目：按鈕下面只顯示那一條，其他用「…」表示；篩選不會讓收起的組展開', () => {
    const d = buildDisplay(es, groups, chains, opts({ filtering: true, pass: () => false, reveal: (i) => i === 2 }));
    expect(d.items.map((x) => x.t)).toEqual(['group', 'dots', 'row']);
    const f = buildDisplay(es, groups, chains, opts({ filtering: true, pass: (i) => i === 2 }));
    expect(f.items.map((x) => x.t)).toEqual(['group']);
  });
  it('展開的組、串顯示全部', () => {
    const d = buildDisplay(es, groups, chains, opts({ groupOpen: () => true, chainOpen: () => true }));
    expect(d.items.map((x) => x.t)).toEqual(['row', 'group', 'row', 'row', 'chain', 'row', 'row', 'row']);
    expect(d.rows).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
