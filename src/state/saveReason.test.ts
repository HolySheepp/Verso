import { describe, expect, it } from 'vitest';
import { saveReason } from './saver';

describe('存檔失敗原因', () => {
  it('常見的 Windows 錯誤翻成看得懂的話', () => {
    expect(saveReason(new Error('failed to open file: The process cannot access the file because it is being used by another process. (os error 32)'))).toContain('Excel');
    expect(saveReason('Access is denied. (os error 5)')).toBe('沒有寫入權限');
    expect(saveReason('(os error 123)')).toBe('名稱不合法');
    expect(saveReason('(os error 52)')).toBe('(os error 52)');
  });
});
