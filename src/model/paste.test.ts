import { describe, expect, it } from 'vitest';
import { columnToClipboard, parseTsv } from './clipboard';
import { checkColumns, columnsToEntries, emptyColumns } from './paste';
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

describe('手動貼入', () => {
  it('行數不一致會擋下並列出各欄行數', () => {
    const c = { ...emptyColumns(), id: ['1', '2'], src: ['a', 'b', 'c'] };
    const r = checkColumns(c);
    expect(r.ok).toBe(false);
    expect(r.msg).toBe('各欄行數不一致：id 2、原文 3');
  });
  it('結尾多出的空白行不算', () => {
    const c = { ...emptyColumns(), id: ['1', '2', '', '', ''], src: ['a', 'b', '', ' '], tgt: ['A', '', '', ''] };
    expect(checkColumns(c).ok).toBe(true);
    const es = columnsToEntries(c);
    expect(es.map((e) => [e.id, e.src, e.tgt])).toEqual([['1', 'a', 'A'], ['2', 'b', '']]);
  });
  it('其他欄實際貼入的行數比原文少時擋下', () => {
    expect(checkColumns({ ...emptyColumns(), src: ['a', 'b', 'c'], tgt: ['A', 'B'] }).msg).toBe('各欄行數不一致：原文 3、譯文 2');
  });
  it('原文必填', () => {
    expect(checkColumns({ ...emptyColumns(), id: ['1'] }).ok).toBe(false);
  });
  it('發話者空白記為「無」，有譯文也先算未翻譯', () => {
    const [e1, e2] = columnsToEntries({ ...emptyColumns(), speaker: ['村長', ' '], src: ['a', 'b'], tgt: ['A', ''] });
    expect(e1.speaker).toBe('村長');
    expect(e2.speaker).toBe('無');
    expect(effectiveMark(e1)).toBe('untranslated');
    expect(isDone(e1)).toBe(false);
    expect(effectiveMark({ ...e1, pending: false })).toBe('translated');
  });
});
