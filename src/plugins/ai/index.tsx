// AI 協助外掛：條目欄的 AI 按鈕、開發者選項的總開關、專案設定的 AI 一區。
// 整個資料夾（加上桌面外殼的 src-tauri/src/plugins/ai）刪掉重新打包，就是沒有 AI 的 Verso。
import { useState } from 'react';
import { tx } from '../../i18n';
import { fz } from '../../model/fonts';
import { useStore } from '../../state/store';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Select } from '../../components/Select';
import type { VersoPlugin } from '../registry';
import { aiTarget, runAi } from './ai';

/** 條目欄上方的 AI 按鈕：處理中變成「停止」；一次超過 50 條先問 */
function AiButton() {
  const on = useStore((s) => s.devMode && s.aiEnabled);
  const busy = useStore((s) => s.aiBusy);
  const [ask, setAsk] = useState<number | null>(null);
  if (!on) return null;
  return (
    <>
      <button type="button" className="btn btn-ghost" onClick={() => void runAi().then((r) => { if (r === 'ask') setAsk(aiTarget().indices.length); })} title={busy ? tx('list.aiStop') : tx('list.aiButton')}
        style={{ height: 34, padding: '0 12px', background: 'var(--btn)', border: `1px solid ${busy ? 'var(--accent)' : 'var(--line3)'}`, borderRadius: 8, fontSize: fz(12.5), color: busy ? 'var(--accent2)' : 'var(--text2)' }}>
        {busy ? tx('list.aiStop') : 'AI'}
      </button>
      {ask !== null && (
        <ConfirmDialog zIndex={60} title={tx('ai.askMany', { n: ask })}
          choices={[{ label: tx('ai.askNo'), onClick: () => setAsk(null) }, { label: tx('ai.askYes'), primary: true, onClick: () => { setAsk(null); void runAi(true); } }]} />
      )}
    </>
  );
}

/** 開發者選項：AI 總開關（預設關閉） */
function AiDevOption() {
  const enabled = useStore((s) => s.aiEnabled);
  const set = useStore((s) => s.set);
  return (
    <>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: fz(13), marginTop: 12 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => set({ aiEnabled: e.target.checked })} />
        {tx('settings.aiEnabled')}
      </label>
      <div style={{ fontSize: fz(12), color: 'var(--mute)' }}>{tx('settings.aiHint')}</div>
    </>
  );
}

const MODELS = ['opus', 'sonnet', 'haiku', 'fable'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
/** AI 用的模型和 effort 預設值 */
export const AI_DEFAULTS = { model: 'opus', effort: 'medium' };
const h3: React.CSSProperties = { margin: 0, fontSize: fz(12), fontWeight: 600, letterSpacing: 1, color: 'var(--text2)' };

/** 專案設定：翻譯和驗證的 skill、模型、effort */
function AiProjectSettings({ tag }: { tag: string }) {
  const on = useStore((s) => s.devMode && s.aiEnabled);
  const ai = useStore((s) => s.project?.tagSettings?.[tag]?.ai) ?? {};
  if (!on) return null;
  const setAi = (patch: Record<string, string | undefined>) => {
    const next = { ...ai, ...patch } as Record<string, string | undefined>;
    for (const k of Object.keys(next)) if (!next[k]) delete next[k];
    useStore.getState().setTagSettings(tag, { ai: Object.keys(next).length ? next : undefined });
  };
  const label: React.CSSProperties = { fontSize: fz(12.5), color: 'var(--text2)' };
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h3 style={h3}>{tx('projset.ai')}</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '120px minmax(0, 1fr)', alignItems: 'center', gap: '8px 12px' }}>
        <label htmlFor="verso-ps-skill-t" style={label}>{tx('settings.aiSkillTranslate')}</label>
        <input id="verso-ps-skill-t" className="field" value={ai.skillTranslate ?? ''} placeholder={tx('settings.aiSkillNone')} onChange={(e) => setAi({ skillTranslate: e.target.value })} />
        <label htmlFor="verso-ps-skill-v" style={label}>{tx('settings.aiSkillVerify')}</label>
        <input id="verso-ps-skill-v" className="field" value={ai.skillVerify ?? ''} placeholder={tx('settings.aiSkillNone')} onChange={(e) => setAi({ skillVerify: e.target.value })} />
        <label htmlFor="verso-ps-model" style={label}>{tx('projset.model')}</label>
        {/* 模型名稱不翻 */}
        <Select id="verso-ps-model" value={ai.model ?? AI_DEFAULTS.model} options={MODELS.map((m) => ({ value: m, label: m[0].toUpperCase() + m.slice(1) }))}
          onChange={(v) => setAi({ model: v === AI_DEFAULTS.model ? undefined : v })} style={{ width: 180 }} />
        <label htmlFor="verso-ps-effort" style={label}>{tx('projset.effort')}</label>
        <Select id="verso-ps-effort" value={ai.effort ?? AI_DEFAULTS.effort} options={EFFORTS.map((m) => ({ value: m, label: m }))}
          onChange={(v) => setAi({ effort: v === AI_DEFAULTS.effort ? undefined : v })} style={{ width: 180 }} />
      </div>
    </section>
  );
}

export const plugin: VersoPlugin = { id: 'ai', ListToolbar: AiButton, DevOptions: AiDevOption, ProjectSettings: AiProjectSettings };
