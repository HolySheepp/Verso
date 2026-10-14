// 專案設定（管理專案裡點專案名稱打開）：自動啟用的字典、預設長度標準、AI 設定。
// 設定掛在專案標籤上（ProjectData.tagSettings），以後多標籤時可以掛在別種標籤。
import { tx } from '../i18n';
import { dictEnabledIn, overrideKey, useStore } from '../state/store';
import { projectTag, type TagSettings } from '../model/types';
import { stdLabel, type StdValue } from '../model/length';
import { fz } from '../model/fonts';
import { Select } from './Select';

const h3: React.CSSProperties = { margin: 0, fontSize: fz(12), fontWeight: 600, letterSpacing: 1, color: 'var(--text2)' };
const row: React.CSSProperties = { display: 'grid', gridTemplateColumns: '120px minmax(0, 1fr)', alignItems: 'center', gap: '8px 12px' };

/** AI 用的模型和 effort（預設 Opus、medium） */
const MODELS = ['opus', 'sonnet', 'haiku', 'fable'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const AI_DEFAULTS = { model: 'opus', effort: 'medium' };

export function ProjectSettings({ name }: { name: string }) {
  const tag = projectTag(name);
  const project = useStore((s) => s.project)!;
  const overrides = useStore((s) => s.dictOverrides);
  const presets = useStore((s) => s.lengthPresets);
  const aiOn = useStore((s) => s.devMode && s.aiEnabled);
  const { set, setTagSettings } = useStore.getState();
  const ts: TagSettings = project.tagSettings?.[tag] ?? {};
  const ai = ts.ai ?? {};
  const setAi = (patch: NonNullable<TagSettings['ai']>) => {
    const next = { ...ai, ...patch } as Record<string, string | undefined>;
    for (const k of Object.keys(next)) if (!next[k]) delete next[k];
    setTagSettings(tag, { ai: Object.keys(next).length ? next : undefined });
  };

  // 預設長度標準：從常用標準選，或無上限、不設定
  const stdKey = ts.lengthStd === undefined ? '' : ts.lengthStd === 'none' ? 'none' : presets.find((x) => JSON.stringify(x.std) === JSON.stringify(ts.lengthStd))?.name ?? '__cur__';
  const stdOptions = [
    { value: '', label: tx('projset.stdUnset') },
    { value: 'none', label: tx('projset.stdNone') },
    ...presets.map((x) => ({ value: x.name, label: x.name })),
    ...(stdKey === '__cur__' ? [{ value: '__cur__', label: stdLabel(ts.lengthStd) }] : []),
  ];
  const pickStd = (v: string) => {
    const std: StdValue | undefined = v === '' ? undefined : v === 'none' ? 'none' : v === '__cur__' ? ts.lengthStd : presets.find((x) => x.name === v)?.std;
    setTagSettings(tag, { lengthStd: std });
  };

  return (
    <div style={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 22 }}>
      <h2 style={{ margin: 0, fontSize: fz(15), fontWeight: 600 }}>{tx('projset.title', { name })}</h2>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h3 style={h3}>{tx('projset.dicts')}</h3>
        <div style={{ fontSize: fz(12), color: 'var(--mute)' }}>{tx('projset.dictsHint')}</div>
        {project.dicts.length === 0 && <div style={{ fontSize: fz(12.5), color: 'var(--mute)' }}>{tx('projset.noDicts')}</div>}
        {project.dicts.map((d) => {
          const on = dictEnabledIn(name, overrides, d);
          return (
            <label key={d.project + '/' + d.name} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: fz(13) }}>
              <input type="checkbox" checked={on} onChange={(e) => set({ dictOverrides: { ...overrides, [overrideKey(name, d)]: e.target.checked } })} />
              <span>{d.name}</span>
              <span style={{ fontSize: fz(11.5), color: 'var(--mute)' }}>{d.project}</span>
            </label>
          );
        })}
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h3 style={h3}>{tx('projset.std')}</h3>
        <div style={{ fontSize: fz(12), color: 'var(--mute)' }}>{tx('projset.stdHint')}</div>
        <Select id="verso-projset-std" value={stdKey} options={stdOptions} onChange={pickStd} style={{ width: 260 }} />
      </section>

      {aiOn && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h3 style={h3}>{tx('projset.ai')}</h3>
          <div style={row}>
            <label htmlFor="verso-ps-skill-t" style={{ fontSize: fz(12.5), color: 'var(--text2)' }}>{tx('settings.aiSkillTranslate')}</label>
            <input id="verso-ps-skill-t" className="field" value={ai.skillTranslate ?? ''} placeholder={tx('settings.aiSkillNone')} onChange={(e) => setAi({ skillTranslate: e.target.value })} />
            <label htmlFor="verso-ps-skill-v" style={{ fontSize: fz(12.5), color: 'var(--text2)' }}>{tx('settings.aiSkillVerify')}</label>
            <input id="verso-ps-skill-v" className="field" value={ai.skillVerify ?? ''} placeholder={tx('settings.aiSkillNone')} onChange={(e) => setAi({ skillVerify: e.target.value })} />
            <label htmlFor="verso-ps-model" style={{ fontSize: fz(12.5), color: 'var(--text2)' }}>{tx('projset.model')}</label>
            {/* 模型名稱不翻 */}
            <Select id="verso-ps-model" value={ai.model ?? AI_DEFAULTS.model} options={MODELS.map((m) => ({ value: m, label: m[0].toUpperCase() + m.slice(1) }))}
              onChange={(v) => setAi({ model: v === AI_DEFAULTS.model ? undefined : v })} style={{ width: 180 }} />
            <label htmlFor="verso-ps-effort" style={{ fontSize: fz(12.5), color: 'var(--text2)' }}>{tx('projset.effort')}</label>
            <Select id="verso-ps-effort" value={ai.effort ?? AI_DEFAULTS.effort} options={EFFORTS.map((m) => ({ value: m, label: m }))}
              onChange={(v) => setAi({ effort: v === AI_DEFAULTS.effort ? undefined : v })} style={{ width: 180 }} />
          </div>
        </section>
      )}
    </div>
  );
}
