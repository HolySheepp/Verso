import { afterEach, describe, expect, it } from 'vitest';
import { cleanPack, tx, txSplit, useDictionary } from './index';
import { readPackData } from '../data/langpacks';
import { fileToXlsx } from '../data/xlsxio';

afterEach(() => useDictionary('zh'));

describe('介面語言', () => {
  it('中文帶入數字', () => {
    expect(tx('list.018', { n: 3 })).toBe('共 3 條');
    expect(tx('work.049', { n: 5, total: 120 })).toBe('第 5 / 120 條');
  });

  it('單複數寫法', () => {
    useDictionary({ 'list.018': '{n} {n|entry|entries}' });
    expect(tx('list.018', { n: 1 })).toBe('1 entry');
    expect(tx('list.018', { n: 2 })).toBe('2 entries');
    expect(tx('list.018', { n: 0 })).toBe('0 entries');
  });

  it('空字串不算缺字；語言包沒有的用英文補', () => {
    useDictionary({ 'app.032': '' });
    expect(tx('app.032')).toBe('');
    expect(tx('app.031')).toBe("Don't Save");
  });

  it('語言包：空白、少了 {名稱}、不認得的代號都不收', () => {
    const d = cleanPack([['app.031', "Don't save"], ['app.032', '  '], ['list.018', 'Total'], ['list.018x', 'x'], ['work.049', '{n} of {total}']]);
    expect(d).toEqual({ 'app.031': "Don't save", 'work.049': '{n} of {total}' });
  });

  it('單複數寫法也算保留了 {名稱}', () => {
    expect(cleanPack([['list.018', '{n|entry|entries}: {n}']])).toEqual({ 'list.018': '{n|entry|entries}: {n}' });
    expect(cleanPack([['list.018', '{n|entry|entries}']])).toEqual({ 'list.018': '{n|entry|entries}' });
  });

  it('輸入框夾在句子中間', () => {
    expect(txSplit('settings.048', { n: 5 })).toEqual(['每 ', ' 分鐘']);
    useDictionary({ 'settings.048': 'Every {input} {n|minute|minutes}' });
    expect(txSplit('settings.048', { n: 1 })).toEqual(['Every ', ' minute']);
  });

  it('讀 Verso 格式的語言包', () => {
    const data = fileToXlsx({ name: 'Deutsch', project: '', sheets: [{ name: '介面', entries: [
      { uid: 'a', id: 'app.031', speaker: '無', src: '不儲存', src0: '不儲存', tgt: 'Nicht speichern', tgt0: '', mark: '', pending: false, skipCheck: false, note: '', sugg: '' },
      { uid: 'b', id: 'app.032', speaker: '無', src: '儲存', src0: '儲存', tgt: '', tgt0: '', mark: '', pending: false, skipCheck: false, note: '', sugg: '' },
    ] }] } as never, []);
    const pairs = readPackData(data);
    expect(pairs).toEqual([['app.031', 'Nicht speichern'], ['app.032', '']]);
    useDictionary(cleanPack(pairs));
    expect(tx('app.031')).toBe('Nicht speichern');
    expect(tx('app.032')).toBe('Save');
  });
});

describe('fill 不吃原型上的屬性（第 5 項）', () => {
  it('{constructor} 原樣保留', async () => {
    const { fill } = await import('./index');
    expect(fill('{constructor}', {})).toBe('{constructor}');
  });
});

describe('cleanPack 不吃原型上的代號（第 15 項）', () => {
  it('toString、__proto__、constructor 被略過而不丟錯', async () => {
    const { cleanPack } = await import('./index');
    expect(cleanPack([['toString', 'x'], ['__proto__', 'x'], ['constructor', 'x']])).toEqual({});
  });
});
