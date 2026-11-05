import { describe, expect, it } from 'vitest';
import { wordEdits } from './wordDiff';
import { compose } from './verify';

const show = (a: string, b: string) => wordEdits(a, b).map((d) => [a.slice(d.s, d.e), d.t]);

describe('整句換成另一句時，以詞為單位算出修改', () => {
  it('只有真的改到的詞是修改，中間沒改的不算', () => {
    const a = "Facing away, the rookie guides Delacroy's tip against his tight rim—and the second it pushes in, searing heat flares through him, leaving his whole body trembling.";
    const b = "Facing away, the rookie guides Delacroy's tip against his own tight rim—and the second it pushes in, searing heat flares through him, leaving him trembling.";
    expect(show(a, b)).toEqual([['', 'own '], ['his whole body', 'him']]);
    expect(compose(a, wordEdits(a, b))).toBe(b);
  });

  it('頭尾都改了，中間不動的部分照樣不算修改', () => {
    const a = 'I am so happy today, my friend.';
    const b = 'We are so happy today, my dear friend!';
    const r = show(a, b);
    expect(r).toEqual([['I am', 'We are'], ['', 'dear '], ['.', '!']]);
    expect(compose(a, wordEdits(a, b))).toBe(b);
  });

  it('一樣的句子沒有修改；中文一個字一個詞', () => {
    expect(wordEdits('same', 'same')).toEqual([]);
    expect(show('我今天很開心', '我今天很難過')).toEqual([['開心', '難過']]);
  });
});
