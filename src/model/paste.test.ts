import { describe, expect, it } from 'vitest';
import { columnToClipboard, parseTsv } from './clipboard';
import { checkColumns, columnsToEntries, emptyColumns, spreadColumns, toCol, type ColKey } from './paste';
import { effectiveMark, isDone } from './marks';

describe('純文字表格解析', () => {
  it('一般多行', () => {
    expect(parseTsv('a\nb\nc')).toEqual([['a'], ['b'], ['c']]);
  });
  it('結尾換行不算多一列，但中間空白格保留', () => {
    expect(parseTsv('a\n\nc\n')).toEqual([['a'], [''], ['c']]);
  });
  it('引號格可包含換行與引號', () => {
    expect(parseTsv('"line1\nline2"\n"say ""hi"""\nplain "x"')).toEqual([['line1\nline2'], ['say "hi"'], ['plain "x"']]);
  });
  it('多欄', () => {
    expect(parseTsv('1\ta\n2\tb')).toEqual([['1', 'a'], ['2', 'b']]);
  });
});

describe('複製譯文欄', () => {
  it('純文字與解析互相對得上', () => {
    const vals = ['a', '', 'x\ny', '"q" start', 'mid "q"'];
    expect(parseTsv(columnToClipboard(vals).text).map((r) => r[0])).toEqual(vals);
  });
  it('表格格式保留換行與跳脫', () => {
    expect(columnToClipboard(['a<b\nc']).html).toContain('<td>a&lt;b<br>c</td>');
  });
});

/** 模擬貼上：每欄都經過 toCol（去掉結尾空白行） */
const cols = (c: Partial<Record<ColKey, string[]>>) => {
  const out = emptyColumns();
  (Object.keys(c) as ColKey[]).forEach((k) => { out[k] = toCol(c[k]!); });
  return out;
};

describe('手動貼入', () => {
  it('行數不一致會擋下並列出各欄行數', () => {
    const r = checkColumns(cols({ id: ['1', '2'], src: ['a', 'b', 'c'] }));
    expect(r.ok).toBe(false);
    expect(r.msg).toBe('各欄行數不一致：id 2、原文 3');
  });
  it('結尾多出的空白行不算', () => {
    const c = cols({ id: ['1', '2', '', '', ''], src: ['a', 'b', '', ' '], tgt: ['A', '', '', ''] });
    expect(checkColumns(c).ok).toBe(true);
    const es = columnsToEntries(c);
    expect(es.map((e) => [e.id, e.src, e.tgt])).toEqual([['1', 'a', 'A'], ['2', 'b', '']]);
  });
  it('其他欄實際貼入的行數比原文少時擋下', () => {
    expect(checkColumns(cols({ src: ['a', 'b', 'c'], tgt: ['A', 'B'] })).msg).toBe('各欄行數不一致：原文 3、譯文 2');
  });
  it('原文必填', () => {
    expect(checkColumns(cols({ id: ['1'] })).ok).toBe(false);
  });
  it('發話者空白記為「無」，有譯文也先算未翻譯', () => {
    const [e1, e2] = columnsToEntries(cols({ speaker: ['村長', ' '], src: ['a', 'b'], tgt: ['A', 'B'] }));
    expect(e1.speaker).toBe('村長');
    expect(e2.speaker).toBe('無');
    expect(effectiveMark(e1)).toBe('untranslated');
    expect(isDone(e1)).toBe(false);
    expect(effectiveMark({ ...e1, pending: false })).toBe('translated');
  });
});

describe('多欄貼入', () => {
  const keys: ColKey[] = ['id', 'speaker', 'src', 'tgt'];
  it('從貼上的那一欄往右填', () => {
    const out = spreadColumns(keys, 'speaker', [['村長'], ['你好'], ['Hi.']]);
    expect(Object.keys(out)).toEqual(['speaker', 'src', 'tgt']);
    expect(out.src!.rows).toEqual(['你好']);
  });
  it('超出譯文的欄忽略', () => {
    const out = spreadColumns(keys, 'src', [['a'], ['A'], ['x'], ['y']]);
    expect(Object.keys(out)).toEqual(['src', 'tgt']);
  });
  it('字典：兩欄貼到原文會填上原文和譯文', () => {
    const out = spreadColumns(['src', 'tgt'], 'src', [['旅人'], ['Traveler']]);
    expect(out.tgt!.rows).toEqual(['Traveler']);
  });
});

describe('備註欄', () => {
  it('比條目少可以，比條目多報錯', async () => {
    const { appendNote } = await import('./paste');
    expect(checkColumns(cols({ src: ['a', 'b', 'c'], note: ['n1'] })).ok).toBe(true);
    expect(checkColumns(cols({ src: ['a'], note: ['n1', 'n2'] })).ok).toBe(false);
    expect(columnsToEntries(cols({ src: ['a', 'b'], note: ['n1'] })).map((e) => e.note)).toEqual(['n1', '']);
    expect(appendNote('舊', '新')).toBe('舊\n新');
    expect(appendNote('舊', ' ')).toBe('舊');
    expect(appendNote('', '新')).toBe('新');
  });
});

describe('字典重複詞條', () => {
  it('原文、譯文、備註、專案都一樣才算重複，留第一筆', async () => {
    const { dedupeGlossary } = await import('../state/store');
    const t = (id: string, term: string, en: string, note = '', proj = 'A', dict = 'd') => ({ id, term, en, note, proj, dict });
    const g = [t('1', '蘋果', 'apple'), t('2', '蘋果', 'apple '), t('3', '蘋果', 'apple', '水果'), t('4', '蘋果', 'apple', '', 'B'), t('5', '蘋果', 'apple', '', 'A', 'e')];
    // 不同專案、不同字典的不算重複
    expect(dedupeGlossary(g).map((x) => x.id)).toEqual(['1', '3', '4', '5']);
  });
});
