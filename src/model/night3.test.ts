// 夜間檢查第三批的回歸測試
import { describe, expect, it } from 'vitest';
import { runChecks } from './checks';
import { diffRange } from './verify';

const ids = (tgt: string, src = '') => runChecks(src, tgt).map((i) => i.check);

describe('句尾、句首：前後的標籤和引號不算', () => {
  it('結尾的標籤、字面 \n 拿掉再看標點', () => {
    expect(ids('Hello.<br>')).not.toContain('ending');
    expect(ids('Hello.\n')).not.toContain('ending');
    expect(ids('"Hello."')).not.toContain('ending');
    expect(ids('Hello<br>')).toContain('ending');
  });
  it('開頭的標籤拿掉再看大寫', () => {
    expect(ids('<b>hello.</b>')).toContain('capital');
    expect(ids('{name} Hello.', '{name}')).not.toContain('capital');
  });
});

describe('標籤與格式字串', () => {
  it('%% 是百分號本身，不算變數；50% faster 不算', () => {
    expect(ids('100%% done.', '100%% done')).not.toContain('tags');
    expect(ids('50% faster.')).not.toContain('tags');
    expect(ids('Hi %5.2f.', '%5.2f')).not.toContain('tags');
    expect(ids('Hi.', '%5.2f')).toContain('tags');
  });
  it('標籤名稱後面直接接中文或空白的不算標籤', () => {
    expect(ids('a < 3 and <這> ok.')).not.toContain('tags');
  });
});

describe('代理對', () => {
  it('改動的邊界不會停在 emoji 中間', () => {
    const { p } = diffRange('a😀b', 'a😃b');
    expect(p).toBe(1);
  });
});
