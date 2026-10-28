import { describe, expect, it } from 'vitest';
import { composeNote, mergeComments, parseNote, type CommentThread } from './comments';

const th = (id: string, author: string, text: string, replies: CommentThread['replies'] = [], resolved = false): CommentThread => ({ id, author, time: '2026-10-28T09:00:00Z', text, replies, resolved });
const re = (id: string, author: string, text: string, resolved = false) => ({ id, author, time: '2026-10-28T09:00:00Z', text, resolved });

describe('雲端備註：Google 備註格的寫法與讀法', () => {
  it('原備註下面接沒解決的留言，回覆前面加 -；已解決的不寫', () => {
    const list = [th('a', 'Francis', 'Why is it like that?', [re('r1', 'Alice', 'Because it is'), re('r2', 'Bob', 'ok', true)]), th('b', 'Bob', 'done', [], true)];
    expect(composeNote('原本的備註', list)).toBe('原本的備註\n[Francis] Why is it like that?\n-[Alice] Because it is');
    expect(composeNote('', list)).toBe('[Francis] Why is it like that?\n-[Alice] Because it is');
    expect(composeNote('只有原備註', [])).toBe('只有原備註');
  });

  it('讀回來：資料表的留言對得上就是留言，其他是原備註；不會把自己寫的當成原備註', () => {
    const known = [th('a', 'Francis', 'Why?', [re('r1', 'Alice', 'Because')])];
    const r = parseNote('原本的備註\n[Francis] Why?\n-[Alice] Because', known);
    expect(r.base).toBe('原本的備註');
    expect(r.threads).toEqual(known);
  });

  it('已解決的留言不在格子裡也還在；沒解決又不在格子裡的是被人在 Google 刪掉了', () => {
    const known = [th('a', 'Francis', 'Why?', [], true), th('b', 'Bob', 'Hmm'), th('c', 'Cat', 'stay', [re('r1', 'Dan', 'gone'), re('r2', 'Eve', 'kept', true)])];
    const r = parseNote('[Cat] stay', known);
    expect(r.threads.map((t) => t.id)).toEqual(['a', 'c']);
    expect(r.threads[1].replies.map((x) => x.id)).toEqual(['r2']);
  });

  it('Google 上直接打的 [名字] 內容 當成留言（沒有日期），每台電腦算出一樣的 id', () => {
    const r1 = parseNote('備註\n[Zoe] hello\n-[Yan] hi', []);
    const r2 = parseNote('備註\n[Zoe] hello\n-[Yan] hi', []);
    expect(r1.base).toBe('備註');
    expect(r1.threads).toHaveLength(1);
    expect(r1.threads[0]).toMatchObject({ author: 'Zoe', text: 'hello', time: '' });
    expect(r1.threads[0].replies[0]).toMatchObject({ author: 'Yan', text: 'hi' });
    expect(r1.threads[0].id).toBe(r2.threads[0].id);
  });

  it('兩人同時各留一則都留著；一邊刪掉就刪；同一則都改了用自己的', () => {
    const base = [th('a', 'F', 'one')];
    const mine = [th('a', 'F', 'one (mine)'), th('m', 'F', 'mine new')];
    const theirs = [th('a', 'F', 'one (theirs)'), th('t', 'A', 'their new')];
    expect(mergeComments(base, mine, theirs).map((t) => [t.id, t.text])).toEqual([['a', 'one (mine)'], ['m', 'mine new'], ['t', 'their new']]);
    expect(mergeComments(base, [], theirs).map((t) => t.id)).toEqual(['t']);
    expect(mergeComments(base, [th('a', 'F', 'one', [re('x', 'F', 'r')])], [th('a', 'F', 'one', [re('y', 'A', 's')])])[0].replies.map((r) => r.id)).toEqual(['x', 'y']);
  });
});
