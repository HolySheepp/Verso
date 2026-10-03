import { describe, expect, it } from 'vitest';
import { colName, fieldLabel, fieldsToColumns, emptyFields, isVersoHeader, rectOf, rectsToField } from './importSel';
import { checkColumns, columnsToEntries } from './paste';

const rows = [
  ['編號', '原文', '譯文'],
  ['1', '你好', 'Hello'],
  ['2', '再見', ''],
  ['', '（略過）', ''],
  ['3', '謝謝', 'Thanks'],
];

describe('importSel', () => {
  it('欄名', () => {
    expect([0, 1, 25, 26, 27, 51, 52].map(colName)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA']);
  });

  it('跳著選的列會依序接起來', () => {
    const f = rectsToField([rectOf({ c: 1, r: 1 }, { c: 1, r: 2 }), rectOf({ c: 1, r: 4 }, { c: 1, r: 4 })], rows.length);
    expect(f).toEqual({ col: 1, rows: [1, 2, 4] });
    expect(fieldLabel(f as never)).toBe('B2:B3、B5');
  });

  it('跨欄不行', () => {
    expect(rectsToField([rectOf({ c: 0, r: 1 }, { c: 1, r: 2 })], rows.length)).toBe('一個欄位只能選一欄');
    expect(rectsToField([], rows.length)).toBe('還沒選範圍');
  });

  it('整欄超出資料的列不算', () => {
    expect(rectsToField([{ c0: 2, c1: 2, r0: 0, r1: 999 }], rows.length)).toEqual({ col: 2, rows: [0, 1, 2, 3, 4] });
  });

  it('轉成條目', () => {
    const pick = [1, 2, 4];
    const fields = { ...emptyFields(), id: { col: 0, rows: pick }, src: { col: 1, rows: pick }, tgt: { col: 2, rows: pick } };
    const cols = fieldsToColumns(rows, fields);
    expect(checkColumns(cols).ok).toBe(true);
    const es = columnsToEntries(cols);
    expect(es.map((e) => [e.id, e.src, e.tgt, e.speaker])).toEqual([['1', '你好', 'Hello', '無'], ['2', '再見', '', '無'], ['3', '謝謝', 'Thanks', '無']]);
  });

  it('認得 Verso 的檔案', () => {
    expect(isVersoHeader(['#', '發話者', '原文', '譯文', '標記', '備註', '建議翻譯', '匯入時的原文', '匯入時的譯文', '待確認', '略過檢查', '標記編號'])).toBe(true);
    expect(isVersoHeader(['#', '發話者', '原文', '譯文'])).toBe(false);
  });
});
