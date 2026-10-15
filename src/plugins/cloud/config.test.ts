import { describe, expect, it } from 'vitest';
import { emptyFields } from '../../model/importSel';
import { toFieldMap, toFields } from './config';

describe('雲端模式：記下欄位範圍', () => {
  it('選到最後一列的算「到底」，之後表變長時跟著延伸', () => {
    const f = toFields({ ...emptyFields(), src: { col: 2, rows: [1, 2, 3, 4] } }, 4);
    expect(f.src).toEqual({ col: 2, runs: [[1, 4]], open: true });
    expect(toFieldMap(f, 6).src!.rows).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('沒選到最後一列的照原本的範圍，跳著選的也記得', () => {
    const f = toFields({ ...emptyFields(), id: { col: 0, rows: [1, 2, 5] } }, 8);
    expect(f.id).toEqual({ col: 0, runs: [[1, 2], [5, 5]], open: false });
    expect(toFieldMap(f, 10).id!.rows).toEqual([1, 2, 5]);
    expect(toFieldMap(f, 10).tgt).toBeNull();
  });
});
