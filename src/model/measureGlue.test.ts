import { describe, expect, it } from 'vitest';
import { glueBreaks } from './measure';

describe('量行數時連字號、破折號、斜線跟前後的字黏在一起（跟 Google Sheets 一樣整個字換行）', () => {
  it('符號前後加上不斷行字元，其他字不動', () => {
    expect(glueBreaks('well-known and/or a—b c–d')).toBe('well\u2060-\u2060known and\u2060/\u2060or a\u2060—\u2060b c\u2060–\u2060d');
    expect(glueBreaks('沒有符號')).toBe('沒有符號');
  });
});
