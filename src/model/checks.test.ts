import { describe, expect, it } from 'vitest';
import { runChecks } from './checks';

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
  });

  it('全形符號與殘留中文', () => {
    expect(msgs('', 'Hello，world。')).toEqual(['句尾缺少標點', '有全形符號 ， 。']);
    expect(ids('', 'Hi 旅人.')).toEqual(['cjk']);
    expect(msgs('', 'Hi　there.')).toEqual(['有全形符號 全形空格']);
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
    expect(ids('', 'What??')).toEqual(['repeatPunct']);
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
    expect(ids('', 'Wait—go now.')).toEqual([]);
    expect(ids('', 'Wait—I know.')).toEqual([]);
  });

  it('只有刪節號時必須剛好 6 個句點', () => {
    expect(runChecks('……', '......')).toEqual([]);
    expect(runChecks('「……」', '"......"')).toEqual([]);
    expect(ids('……', '...')).toEqual(['ellipsis']);
    expect(ids('……', '"........"')).toEqual(['ellipsis']);
  });
});
