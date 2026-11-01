import { describe, expect, it } from 'vitest';
import { compactOps, opToRow, rowToOp } from './tmSync';
import type { TmOp } from '../../state/tm';
import type { TmRow } from '../../model/tm';

const row: TmRow = { id: 'm1', project: 'P', src: '你好', tgt: 'Hi', verified: true, by: '一加', at: 5, fid: 'f', file: 'A', sheet: 'S', eid: '1', speaker: '甲' };
const DAY = 86_400_000;

describe('翻譯記憶表的列', () => {
  it('變動寫成一列再讀回來', () => {
    const put: TmOp = { k: 'put', op: 'o1', t: 5, row };
    expect(rowToOp(opToRow(put), 'P')).toEqual(put);
    const del: TmOp = { k: 'del', op: 'o2', t: 6, id: 'm1', project: 'P' };
    expect(rowToOp(opToRow(del), 'P')).toEqual(del);
    expect(rowToOp(['op', 'time', 'kind', 'id', 'data', '原文', '譯文'], 'P')).toBeNull();
    expect(rowToOp(['x', '1', 'put', 'm', '{壞掉', '', ''], 'P')).toBeNull();
  });

  it('整理：只留最後一列；舊的作廢列超過 30 天才刪', () => {
    const now = 100 * DAY;
    const p = (op: string, t: number, tgt: string): TmOp => ({ k: 'put', op, t, row: { ...row, tgt, at: t } });
    const old1 = p('a', now - 40 * DAY, 'A');
    const new1 = p('b', now - 35 * DAY, 'B');
    const recent = p('c', now - 5 * DAY, 'C');
    const delOld: TmOp = { k: 'del', op: 'd', t: now - 31 * DAY, id: 'm2', project: 'P' };
    const putM2: TmOp = { k: 'put', op: 'e', t: now - 50 * DAY, row: { ...row, id: 'm2' } };
    expect(compactOps([old1, new1, recent, putM2, delOld], now).map((o) => o.op)).toEqual(['c']);
    expect(compactOps([old1, recent], now).map((o) => o.op)).toEqual(['c']);
    expect(compactOps([p('x', now - 2 * DAY, 'X'), recent], now).map((o) => o.op)).toEqual(['x', 'c']);
  });
});
