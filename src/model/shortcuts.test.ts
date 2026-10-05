import { describe, expect, it } from 'vitest';
import { actionFor, comboOf, defaultBindings } from './shortcuts';

const ev = (key: string, code: string, mods: Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }> = {}) =>
  ({ key, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

describe('快捷鍵', () => {
  it('組合鍵字串', () => {
    expect(comboOf(ev('Enter', 'Enter'))).toBe('Enter');
    expect(comboOf(ev('Enter', 'Enter', { ctrlKey: true }))).toBe('Ctrl+Enter');
    expect(comboOf(ev('ArrowUp', 'ArrowUp', { altKey: true }))).toBe('Alt+↑');
    expect(comboOf(ev('m', 'KeyM', { ctrlKey: true }))).toBe('Ctrl+M');
    expect(comboOf(ev('Tab', 'Tab', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+Tab');
    expect(comboOf(ev('Control', 'ControlLeft', { ctrlKey: true }))).toBeNull();
    expect(comboOf(ev('ArrowRight', 'ArrowRight', { ctrlKey: true }), true)).toBe('Ctrl+Tab+→');
  });
  it('兩種情境的預設快捷鍵', () => {
    const b = defaultBindings();
    expect(actionFor(b, 'input', 'Enter')).toBe('main');
    expect(actionFor(b, 'list', 'Enter')).toBe('editEntry');
    expect(actionFor(b, 'list', 'Backspace')).toBe('clearTgt');
    expect(actionFor(b, 'input', 'Backspace')).toBeNull();
    expect(actionFor(b, 'input', 'Esc')).toBe('leaveInput');
    expect(actionFor(b, 'list', 'Alt+↓')).toBe('nextEntry');
    expect(actionFor(b, 'list', 'Ctrl+R')).toBe('record');
    expect(actionFor(b, 'input', 'Alt+←')).toBe('prevSheet');
  });
});

describe('舊的切換頁簽快捷鍵', () => {
  it('沒改過的換成 Alt+←/→，改過的保留', async () => {
    const { migrateSheets } = await import('./shortcuts');
    expect(migrateSheets({ prevSheet: ['Ctrl+Tab+←'], nextSheet: ['Ctrl+Tab+→'] })).toEqual({ prevSheet: ['Alt+←'], nextSheet: ['Alt+→'] });
    expect(migrateSheets({ prevSheet: ['Ctrl+PageUp'] })).toEqual({ prevSheet: ['Ctrl+PageUp'] });
  });
});
