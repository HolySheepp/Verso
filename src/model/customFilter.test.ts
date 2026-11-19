import { describe, expect, it } from 'vitest';
import { matchFilter, type CustomFilter } from './customFilter';
import type { Entry } from './types';

const E = (p: Partial<Entry>): Entry => ({ uid: 'u', id: '', speaker: '', src: '', src0: '', tgt: '', tgt0: '', mark: '', pending: false, skipCheck: false, note: '', sugg: '', ...p });
const F = (col: string, op: CustomFilter['op'], value = ''): CustomFilter => ({ id: 'x', name: 'x', col, op, value });

describe('自訂篩選條件', () => {
  it('包含、單詞包含', () => {
    const es = ['brace', 'ace', 'Face it', 'an ace!'].map((t) => E({ tgt: t }));
    expect(es.map((e) => matchFilter(e, F('tgt', 'contains', 'ace')))).toEqual([true, true, true, true]);
    expect(es.map((e) => matchFilter(e, F('tgt', 'word', 'ace')))).toEqual([false, true, false, true]);
    // 中文沒有單詞：跟包含一樣
    expect(matchFilter(E({ src: '你好嗎' }), F('src', 'word', '好'))).toBe(true);
  });
  it('空白、開頭、結尾、完全符合', () => {
    expect(matchFilter(E({ note: '  ' }), F('note', 'blank'))).toBe(true);
    expect(matchFilter(E({ tgt: 'Hello world' }), F('tgt', 'starts', 'hello'))).toBe(true);
    expect(matchFilter(E({ tgt: 'Hello world' }), F('tgt', 'ends', 'WORLD'))).toBe(true);
    expect(matchFilter(E({ tgt: 'Hello' }), F('tgt', 'exact', 'hello'))).toBe(true);
    expect(matchFilter(E({ tgt: 'Hello!' }), F('tgt', 'exact', 'hello'))).toBe(false);
  });
  it('大於、等於（數字）；備註可以找某人的留言；另外抓的欄', () => {
    expect(matchFilter(E({ id: '1,200' }), F('id', 'gt', '1000'))).toBe(true);
    expect(matchFilter(E({ id: '12' }), F('id', 'eq', '12.0'))).toBe(true);
    expect(matchFilter(E({ note: '[小明] 這裡要改' }), F('note', 'contains', '[小明]'))).toBe(true);
    // 雲端：已解決的留言也算
    const resolved = E({ note: '', noteBase: '', comments: [{ id: 'c', author: '阿華', time: '', text: '改好了', resolved: true, replies: [] }] });
    expect(matchFilter(resolved, F('note', 'contains', '[阿華]'))).toBe(true);
    expect(matchFilter(E({ extraNotes: [{ name: '說明', text: '技能' }] }), F('x:說明', 'contains', '技能'))).toBe(true);
  });
});
