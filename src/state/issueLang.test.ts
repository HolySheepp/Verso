import { describe, it, expect } from 'vitest';
import { visibleIssues } from './store';
import { defaultCheckSettings, runChecks } from '../model/checks';
import { useDictionary } from '../i18n';

const e = { uid: 'u', id: '1', speaker: '', src: '你好', src0: '你好', tgt: 'Hello，', tgt0: 'Hello，', mark: '' as const, pending: false, skipCheck: false, note: '', sugg: '' };

describe('換介面語言後問題說明重算（第 26 項）', () => {
  it('visibleIssues 回傳新語言的說明', () => {
    const settings = defaultCheckSettings();
    useDictionary('zh');
    const keys = runChecks(e.src, e.tgt).map((i) => i.key);
    const reported = { u: keys };
    const zh = visibleIssues(e, reported, settings).map((i) => i.msg);
    useDictionary({ 'check.019': 'Has full-width {v1}' });
    const en = visibleIssues(e, reported, settings).map((i) => i.msg);
    useDictionary('zh');
    expect(zh.length).toBeGreaterThan(0);
    expect(en).not.toEqual(zh);
  });
});
