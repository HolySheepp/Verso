import { describe, expect, it } from 'vitest';
import { locateIssues, runChecks } from './checks';

const ids = (src: string, tgt: string) => runChecks(src, tgt).map((i) => i.check);
const msgs = (src: string, tgt: string) => runChecks(src, tgt).map((i) => i.msg);

describe('標點檢測', () => {
  it('正常的譯文沒有問題', () => {
    expect(runChecks('使用後恢復 {0} 點生命值。', 'Restores {0} HP.')).toEqual([]);
    expect(runChecks('「走吧」', '"Let\'s go."')).toEqual([]);
    expect(runChecks('等等——', 'Wait—')).toEqual([]);
  });

  it('標籤與變數數量、內容要一致', () => {
    expect(msgs('擊敗 {0} 隻<color=red>石像鬼</color>', 'Defeat <color=red>Gargoyles</color>.')).toEqual(['缺少 {0}']);
    expect(msgs('第一行\\n第二行', 'Line one %s.')).toEqual(['缺少 \\n', '多出 %s']);
  });

  it('原文的數字譯文要有，多出不報', () => {
    expect(msgs('3 秒內傷害降低 20%。', 'Reduces damage by 20% for a few seconds.')).toEqual(['缺少數字 3']);
    expect(runChecks('冷卻 3 秒。', 'Cooldown: 3 seconds, 10 max.')).toEqual([]);
    expect(msgs('等級 1.5', 'Level 15.')).toEqual(['缺少數字 1.5']);
  });

  it('句尾必須是指定標點', () => {
    expect(ids('開始遊戲', 'Start Game')).toEqual(['ending']);
    expect(ids('', '"Hello?"')).toEqual([]);
    expect(ids('', 'Hello,')).toEqual(['ending']);
    for (const t of ['Hi~', '(Hi~)', '"Hi~"', 'Thanks♡', '"Thanks♡"', '(Thanks♡)']) expect(ids('', t)).toEqual([]);
  });

  it('全形符號與殘留中文', () => {
    expect(msgs('', 'Hello，world。')).toEqual(['句尾缺少標點', '有全形符號 ， 。']);
    expect(ids('', 'Hi 旅人.')).toEqual(['cjk']);
    expect(msgs('', 'Hi　there.')).toEqual(['有全形符號 全形空格']);
    expect(msgs('', 'Wait… go.')).toEqual(['有全形符號 …']);
  });

  it('成對符號', () => {
    expect(ids('', 'Call (him.')).toEqual(['pairs']);
    expect(ids('', '"Go.')).toEqual(['pairs']);
    expect(ids('', 'Go [now].')).toEqual([]);
  });

  it('空白與重複標點，句點不算', () => {
    expect(ids('', ' Go.')).toEqual(['edgeSpace']);
    expect(ids('', 'Go  now.')).toEqual(['doubleSpace']);
    expect(ids('', 'What?!')).toEqual([]);
    expect(ids('', 'What??')).toEqual([]);
    expect(ids('', 'No!!!')).toEqual([]);
    expect(ids('', 'What?!?')).toEqual([]);
    expect(ids('', 'Wait,, go.')).toEqual(['repeatPunct']);
    // 句點：有其他內容時只能 1 個或 3 個
    expect(ids('', 'Hello...')).toEqual([]);
    expect(ids('', 'Hello..')).toEqual(['repeatPunct']);
    expect(ids('', 'Hello....')).toEqual(['repeatPunct']);
    expect(ids('', 'Hello......')).toEqual(['repeatPunct']);
    expect(ids('', '......')).toEqual([]);
    expect(ids('', '"......"')).toEqual([]);
    expect(ids('', 'Wait—— Go.')).toEqual(['repeatPunct']);
    expect(ids('', 'Well... Go.')).toEqual([]);
  });

  it('以括號結尾可以通過', () => {
    expect(ids('', 'Go now (quietly.)')).toEqual([]);
    expect(ids('', 'Go now (quietly)')).toEqual(['ending']);
  });

  it('中文引號不能出現', () => {
    expect(msgs('', '“Go,” he said.')).toEqual(['有中文引號 “ ”']);
    expect(ids('', 'It’s fine.')).toEqual(['curlyQuotes']);
    expect(ids('', '"It\'s fine."')).toEqual([]);
  });

  it('句首、句尾標點和刪節號後要大寫，破折號後要小寫', () => {
    expect(msgs('', 'go now.')).toEqual(['句首要大寫']);
    expect(ids('', '"go now."')).toEqual(['capital']);
    expect(ids('', 'Stop. go now.')).toEqual(['capital']);
    expect(ids('', 'Are you... are you mad?')).toEqual([]);
    expect(ids('', 'Well...Go now.')).toEqual([]);
    expect(ids('', '...Hello?')).toEqual([]);
    expect(msgs('', '...hello?')).toEqual(['句首要大寫']);
    expect(ids('', '"...hello?"')).toEqual(['capital']);
    expect(ids('', 'Stop! go.')).toEqual(['capital']);
    expect(msgs('', 'Wait—Go now.')).toEqual(['破折號後要小寫']);
    expect(msgs('', '—Go now.')).toEqual([]);
    expect(msgs('', '"—Go now."')).toEqual([]);
    expect(msgs('<i>—什麼？！</i>', '<i>—What?!</i>')).toEqual([]);
    expect(msgs('<i>—走吧。</i>', '<i>—Go now.</i>')).toEqual([]);
    expect(msgs('<b>—什麼？！</b>', '<b>—What?!</b>')).toEqual([]);
    expect(msgs('你好。\\n—什麼？！', 'Hello.\\n—What?!')).toEqual([]);
    expect(msgs('', 'Stop. —Go now.')).toEqual([]);
    expect(ids('', 'Wait—go now.')).toEqual([]);
    expect(ids('', 'Wait—I know.')).toEqual([]);
    // 破折號後有空格：後面是新句子，要大寫；句首（前面只有符號）不用小寫
    expect(ids('', 'Wait— Go now.')).toEqual([]);
    expect(ids('', 'Wait — Go now.')).toEqual([]);
    expect(msgs('', 'Wait— go now.')).toEqual(['句首要大寫']);
    expect(msgs('', 'Wait — go now.')).toEqual(['句首要大寫']);
    expect(ids('', '("—What?!")')).toEqual([]);
    // 破折號在句首：後面要大寫、不能有空格
    expect(msgs('', '—go now.')).toEqual(['句首要大寫']);
    expect(msgs('', '"—go now."')).toEqual(['句首要大寫']);
    expect(msgs('', '— Go now.')).toEqual(['開頭或結尾有多餘空白']);
    expect(msgs('', '— go now.').sort()).toEqual(['句首要大寫', '開頭或結尾有多餘空白'].sort());
    expect(locateIssues('— go now.', new Set(['edgeSpace', 'capital']))).toEqual(expect.arrayContaining([{ start: 1, end: 2 }, { start: 2, end: 3 }]));
    expect(msgs('', 'He said—"Go."')).toEqual(['破折號後要小寫']);
  });

  it('只有刪節號時必須剛好 6 個句點', () => {
    expect(runChecks('……', '......')).toEqual([]);
    expect(runChecks('「……」', '"......"')).toEqual([]);
    expect(ids('……', '...')).toEqual(['ellipsis']);
    expect(ids('……', '"........"')).toEqual(['ellipsis']);
  });

  it('只有刪節號時，頭尾的標籤、變數、括號不算', () => {
    const dotIds = (t: string) => ids('', t).filter((c) => c === 'ellipsis' || c === 'repeatPunct');
    for (const t of ['<i>......</i>', '(......)', '（......）', '{0}......', '"<i>(......)</i>"']) expect(dotIds(t)).toEqual([]);
    expect(dotIds('<i>....</i>')).toEqual(['ellipsis']);
    expect(dotIds('(........)')).toEqual(['ellipsis']);
    expect(dotIds('Hi <i>......</i>')).toEqual(['repeatPunct']);
  });
});

describe('夜間檢查 2026-10-09', () => {
  it('第 19 項：句首小寫前面有標籤時，標色位置指向字母', async () => {
    const { locateIssues } = await import('./checks');
    const a = '<i>hello</i> there.';
    expect(locateIssues(a, new Set(['capital'] as never))[0].start).toBe(a.indexOf('h'));
    const b = '{name} hello.';
    expect(locateIssues(b, new Set(['capital'] as never))[0].start).toBe(b.indexOf('h'));
  });
  it('第 21 項：一長串空白或標籤不會卡住，結果不變', () => {
    const t0 = Date.now();
    runChecks('他說。', 'He said.' + ' '.repeat(30000));
    runChecks('他說。', 'He said.' + '<b>'.repeat(10000));
    expect(Date.now() - t0).toBeLessThan(500);
    expect(ids('他說。', 'He said.<br> ')).not.toContain('ending');
    expect(ids('他說。', 'He said <b> ')).toContain('ending');
  });
});
