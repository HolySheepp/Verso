// AI 協助外掛：條目欄的 AI 按鈕、開發者選項的總開關、專案設定的 AI 一區。
// 整個資料夾（加上桌面外殼的 src-tauri/src/plugins/ai）刪掉重新打包，就是沒有 AI 的 Verso。
import { useState } from 'react';
import { tx } from '../../i18n';
import { IconFolder } from '../../components/icons';
import { fz } from '../../model/fonts';
import { useStore } from '../../state/store';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Select } from '../../components/Select';
import type { VersoPlugin } from '../registry';
import { projectTag } from '../../model/types';
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

/**
 * 開發者選項：AI 總開關（預設關閉）。
 * 雲端模式沒有專案設定可以開，打開 AI 時直接在下面列出各雲端專案的 AI 設定（存在這台電腦）
 */
function AiDevOption() {
  const enabled = useStore((s) => s.aiEnabled);
  const cloud = useStore((s) => s.cloudMode);
  // 雲端專案表裡的全部專案（cloudProjects 只有本機原本沒有的那些）
  const projects = useStore((s) => s.cloudProjectNames);
  const set = useStore((s) => s.set);
  return (
    <>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: fz(13), marginTop: 12 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => set({ aiEnabled: e.target.checked })} />
        {tx('settings.aiEnabled')}
      </label>
      <div style={{ fontSize: fz(12), color: 'var(--mute)' }}>{tx('settings.aiHint')}</div>
      {enabled && cloud && projects.map((name, n) => (
        <div key={name} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10, padding: '10px 12px', border: '1px solid var(--line3)', borderRadius: 8 }}>
          <h3 style={h3}>{name}</h3>
          <AiFields tag={projectTag(name)} idp={`verso-dev-ai${n}`} />
        </div>
      ))}
    </>
  );
}

const MODELS = ['opus', 'sonnet', 'haiku', 'fable'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
/** AI 用的模型和 effort 預設值 */
export const AI_DEFAULTS = { model: 'opus', effort: 'medium' };
const h3: React.CSSProperties = { margin: 0, fontSize: fz(12), fontWeight: 600, letterSpacing: 1, color: 'var(--text2)' };

/** 準則檔：可以直接貼路徑，或按右邊的按鈕選檔 */
function GuideField({ id, value, onChange }: { id: string; value: string; onChange(v: string): void }) {
  const pick = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const f = await open({ multiple: false, directory: false, filters: [{ name: 'Text', extensions: ['md', 'txt', 'markdown'] }, { name: '*', extensions: ['*'] }] });
      if (typeof f === 'string') onChange(f);
    } catch { /* 沒有桌面外殼 */ }
  };
  return (
    <span style={{ display: 'flex', gap: 6, minWidth: 0 }}>
      <input id={id} className="field" value={value} placeholder={tx('settings.aiGuidePh')} onChange={(e) => onChange(e.target.value)} style={{ flexGrow: 1, minWidth: 0 }} />
      <button type="button" className="ib" aria-label={tx('settings.aiGuidePh')} title={tx('settings.aiGuidePh')} onClick={() => void pick()}
        style={{ width: 34, height: 34, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, color: 'var(--text2)' }}>
        <IconFolder size={15} />
      </button>
    </span>
  );
}

/** 專案設定：翻譯和驗證的準則檔、模型、effort */
function AiProjectSettings({ tag }: { tag: string }) {
  const on = useStore((s) => s.devMode && s.aiEnabled);
  if (!on) return null;
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h3 style={h3}>{tx('projset.ai')}</h3>
      <AiFields tag={tag} idp="verso-ps" />
    </section>
  );
}

/** 一個專案的 AI 設定欄位（專案設定、雲端模式的開發者選項共用） */
function AiFields({ tag, idp }: { tag: string; idp: string }) {
  const ai = useStore((s) => s.project?.tagSettings?.[tag]?.ai) ?? {};
  const setAi = (patch: Record<string, string | undefined>) => {
    const next = { ...ai, ...patch } as Record<string, string | undefined>;
    for (const k of Object.keys(next)) if (!next[k]) delete next[k];
    useStore.getState().setTagSettings(tag, { ai: Object.keys(next).length ? next : undefined });
  };
  const label: React.CSSProperties = { fontSize: fz(12.5), color: 'var(--text2)' };
  return (
      <div style={{ display: 'grid', gridTemplateColumns: '120px minmax(0, 1fr)', alignItems: 'center', gap: '8px 12px' }}>
        <label htmlFor={`${idp}-skill-t`} style={label}>{tx('settings.aiSkillTranslate')}</label>
        <GuideField id={`${idp}-skill-t`} value={ai.guideTranslate ?? ''} onChange={(v) => setAi({ guideTranslate: v })} />
        <label htmlFor={`${idp}-skill-v`} style={label}>{tx('settings.aiSkillVerify')}</label>
        <GuideField id={`${idp}-skill-v`} value={ai.guideVerify ?? ''} onChange={(v) => setAi({ guideVerify: v })} />
        <label htmlFor={`${idp}-model`} style={label}>{tx('projset.model')}</label>
        {/* 模型名稱不翻 */}
        <Select id={`${idp}-model`} value={ai.model ?? AI_DEFAULTS.model} options={MODELS.map((m) => ({ value: m, label: m[0].toUpperCase() + m.slice(1) }))}
          onChange={(v) => setAi({ model: v === AI_DEFAULTS.model ? undefined : v })} style={{ width: 180 }} />
        <label htmlFor={`${idp}-effort`} style={label}>{tx('projset.effort')}</label>
        <Select id={`${idp}-effort`} value={ai.effort ?? AI_DEFAULTS.effort} options={EFFORTS.map((m) => ({ value: m, label: m }))}
          onChange={(v) => setAi({ effort: v === AI_DEFAULTS.effort ? undefined : v })} style={{ width: 180 }} />
      </div>
  );
}

export const plugin: VersoPlugin = { id: 'ai', ListToolbar: AiButton, DevOptions: AiDevOption, ProjectSettings: AiProjectSettings };
