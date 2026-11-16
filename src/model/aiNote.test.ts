import { describe, expect, it } from 'vitest';
import { aiNoteLine, tidyOnLeave } from './aiNote';
import type { Entry } from './types';
import type { CommentThread } from './comments';

const E = (p: Partial<Entry>): Entry => ({ uid: 'u', id: '', speaker: '', src: '', src0: '', tgt: '', tgt0: '', mark: '', pending: false, skipCheck: false, note: '', sugg: '', ...p });
const drop = (e: Entry) => ({ ...e, sugg: '' });
const th = (author: string, text: string, resolved = false): CommentThread => ({ id: author + text, author, time: '', text, resolved, replies: [] });

describe('離開條目時整理 AI 留下的東西（R7）', () => {
  it('輸入框跟建議翻譯一樣：刪掉建議翻譯，再刪掉本機備註裡 AI 那一行，其他行留著', () => {
    const e = E({ tgt: 'Go.', sugg: 'Go.', note: '我的備註\nAI：太長了\n第二行' });
    expect(tidyOnLeave(e, drop)).toMatchObject({ sugg: '', note: '我的備註\n第二行' });
  });

  it('還有建議翻譯或修改時不動備註；什麼都不用改時回傳同一個物件', () => {
    const e = E({ tgt: 'Go.', sugg: 'Run.', note: 'AI：改成 Run' });
    expect(tidyOnLeave(e, drop)).toBe(e);
    const v = E({ tgt: 'Go now.', ver: { base: 'Go now.', edits: [{ s: 0, e: 2, t: 'Run', id: 'x' }] }, note: 'AI：x' });
    expect(tidyOnLeave(v, drop)).toBe(v);
  });

  it('修改後的句子跟建議翻譯一樣也算一樣', () => {
    const v = E({ tgt: 'Go now.', sugg: 'Run now.', ver: { base: 'Go now.', edits: [{ s: 0, e: 2, t: 'Run', id: 'x' }] } });
    expect(tidyOnLeave(v, drop).sugg).toBe('');
  });

  it('雲端：只把作者是 AI 的留言標成已解決（使用者編輯過、作者改成別人的不算）', () => {
    const e = E({ tgt: 'Go.', comments: [th('AI', '太長'), th('小明', '改過了')] });
    const r = tidyOnLeave(e, drop);
    expect(r.comments!.map((t) => !!t.resolved)).toEqual([true, false]);
    expect(r.note).not.toContain('太長');
  });

  it('AI 寫進本機備註的內容換行改成空格', () => {
    expect(aiNoteLine('第一行\n第二行\r\n第三行')).toBe('AI：第一行 第二行 第三行');
  });
});
