import { describe, expect, it } from 'vitest';
import { dictToXlsx, fileToXlsx, xlsxToDict, xlsxToFile } from './xlsxio';
import type { CustomMark, Entry, FileDoc } from '../model/types';

const entry = (p: Partial<Entry>): Entry => ({
  uid: 'x', id: '', speaker: '無', src: '', src0: '', tgt: '', tgt0: '', mark: '', pending: false, skipCheck: false, note: '', sugg: '', ...p,
});

const customs: CustomMark[] = [{ id: '1', name: '需問企劃', kind: 'sym', sym: 'star', color: '#b48cf2' }];

describe('xlsx 存檔', () => {
  it('寫出再讀回來，內容一樣', () => {
    const file: FileDoc = { name: '第一章', project: 'p', sheets: [
      { name: '對話', entries: [
        entry({ id: '007', speaker: '村長', src: '你好\n旅人', src0: '你好', tgt: '"Hi," he said.', tgt0: '', mark: 'doubt', pending: true, note: '備註', sugg: 'Hello' }),
        entry({ id: '8', src: 'a', src0: 'a', mark: 'c:1', skipCheck: true }),
      ] },
      { name: '道具/UI', entries: [entry({ src: 'b', src0: 'b' })] },
    ] };
    const back = xlsxToFile('第一章', 'p', fileToXlsx(file, customs), customs);
    expect(back.sheets.map((s) => s.name)).toEqual(['對話', '道具_UI']);
    const [e1, e2] = back.sheets[0].entries;
    expect({ ...e1, uid: 'x' }).toEqual({ ...file.sheets[0].entries[0], uid: 'x', keptMark: undefined });
    expect(e1.id).toBe('007');
    expect(e2.mark).toBe('c:1');
    expect(e2.skipCheck).toBe(true);
  });

  it('認不得的自訂標記：畫面當作沒標記，但存檔時照樣寫回', () => {
    const file: FileDoc = { name: 'f', project: 'p', sheets: [{ name: 's', entries: [entry({ src: 'a', mark: 'c:9' })] }] };
    const back = xlsxToFile('f', 'p', fileToXlsx(file, []), []);
    expect(back.sheets[0].entries[0].mark).toBe('');
    expect(back.sheets[0].entries[0].keptMark).toBe('c:9');
    const again = xlsxToFile('f', 'p', fileToXlsx(back, []), customs.concat({ id: '9', name: 'x', kind: 'text', text: 'X', color: '#fff' }));
    expect(again.sheets[0].entries[0].mark).toBe('c:9');
  });

  it('字典寫出再讀回', () => {
    const terms = [{ id: 'a', term: '旅人', en: 'Traveler', note: '首字大寫', proj: '我的專案', dict: '專有名詞' }];
    const back = xlsxToDict('我的專案', '專有名詞', dictToXlsx(terms));
    expect(back.map(({ term, en, note, proj, dict }) => ({ term, en, note, proj, dict }))).toEqual(
      terms.map(({ term, en, note, proj, dict }) => ({ term, en, note, proj, dict })));
  });
});
