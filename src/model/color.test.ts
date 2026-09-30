import { describe, expect, it } from 'vitest';
import { hexToHsv, hsvToHex, normalizeHex } from './color';

describe('顏色換算', () => {
  it('hex 與 HSV 互換', () => {
    for (const hex of ['#4f8cff', '#000000', '#ffffff', '#f06b8e', '#1395ae']) {
      expect(hsvToHex(hexToHsv(hex)!)).toBe(hex);
    }
  });
  it('正規化與錯誤輸入', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('4F8CFF')).toBe('#4f8cff');
    expect(normalizeHex('xyz')).toBeNull();
  });
});
