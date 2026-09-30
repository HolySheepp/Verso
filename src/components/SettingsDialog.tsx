import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { BUILTIN_MARKS, MARK_COLORS, SYMBOLS, checkMarkText, markVisual, type MarkVisual } from '../model/marks';
import type { CustomMark, SymbolId } from '../model/types';
import { MarkIcon } from './MarkIcon';
import { IconPlus, IconTrash, IconWinClose } from './icons';
import { CHECKS } from '../model/checks';
import { ConfirmDialog } from './ConfirmDialog';
import { pickSaveRoot } from '../state/saver';
import { ColorPicker } from './ColorPicker';
import { useEffectiveTheme } from './useTheme';
import { ACCENTS, MAX_CUSTOM_ACCENTS } from '../model/color';
import { ACTION_LABELS, CONTEXTS, CONTEXT_ACTIONS, comboOf, createTabHold, type ActionId, type ShortcutContext } from '../model/shortcuts';

// 設定目前只有「標記」「檢查」分類有內容，其他分類只有外觀
const SECTIONS = ['一般', '工作模式', '標記', '檢查', '快捷鍵', '外觀'];
const READY = ['一般', '標記', '檢查', '快捷鍵', '外觀'];

const h3: React.CSSProperties = { margin: 0, fontSize: 12, fontWeight: 600, letterSpacing: 1, color: 'var(--text2)' };

export function SettingsDialog() {
  const open = useStore((s) => s.settingsOpen);
  const customs = useStore((s) => s.project!.customMarks);
  const askDeleteMark = useStore((s) => s.askDeleteMark);
  const { set, addCustomMark, deleteCustomMark } = useStore.getState();

  const [name, setName] = useState('');
  const [type, setType] = useState<'sym' | 'text'>('sym');
  const [sym, setSym] = useState<SymbolId>('star');
  const [text, setText] = useState('');
  const [color, setColor] = useState('#4fb3a9');
  const [section, setSection] = useState('標記');
  // 開色盤時設定視窗先收起來，讓使用者直接在主畫面上看顏色
  const [picking, setPicking] = useState(false);
  useEffect(() => { if (open) { setSection('標記'); setPicking(false); } }, [open]);

  if (!open) return null;
  if (picking) return <AccentPicker onDone={() => setPicking(false)} />;

  const tc = checkMarkText(text);
  const preview: MarkVisual | null = type === 'sym' ? { kind: 'sym', sym, color } : tc.ok ? { kind: 'text', text, color } : null;
  const addOff = !preview || !name;

  const add = () => {
    if (addOff) return;
    const id = 'u' + Date.now();
    const c: CustomMark = type === 'sym' ? { id, name, kind: 'sym', sym, color } : { id, name, kind: 'text', text, color };
    addCustomMark(c);
    setName('');
    setText('');
  };

  const seg = (on: boolean): React.CSSProperties => ({
    height: 28, padding: '0 12px', border: 0, borderRadius: 6, fontSize: 12.5,
    background: on ? 'var(--segon)' : 'transparent', color: on ? 'var(--text)' : 'var(--text2)',
  });

  return (
    <div className="scrim" style={{ zIndex: 40 }}>
      <div role="dialog" aria-modal="true" aria-labelledby="verso-settings-title" className="dialog"
        style={{ width: 820, height: 640, boxShadow: '0 24px 64px rgba(0,0,0,0.55)' }}>
        <div style={{ height: 56, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px 0 22px', borderBottom: '1px solid var(--line)' }}>
          <h2 id="verso-settings-title" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>設定</h2>
          <button type="button" className="ib" aria-label="關閉設定" onClick={() => set({ settingsOpen: false })}
            style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 0, borderRadius: 8, color: 'var(--text2)' }}>
            <IconWinClose size={14} sw={1.4} />
          </button>
        </div>
        <div style={{ flexGrow: 1, minHeight: 0, display: 'flex' }}>
          <nav aria-label="設定分類" style={{ width: 180, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2, padding: 12, borderRight: '1px solid var(--line)', background: 'var(--bar)' }}>
            {SECTIONS.map((sec) => {
              const on = sec === section;
              return (
                <button key={sec} type="button" className="dd" aria-current={on ? 'page' : undefined}
                  onClick={() => { if (READY.includes(sec)) setSection(sec); }}
                  style={{ height: 34, padding: '0 12px', border: 0, borderRadius: 7, textAlign: 'left', background: on ? 'var(--sel)' : 'transparent', color: on ? 'var(--text)' : 'var(--text2)', fontWeight: on ? 500 : 400 }}>
                  {sec}
                </button>
              );
            })}
          </nav>
          <div style={{ flexGrow: 1, minWidth: 0, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 22 }}>
            {section === '外觀' ? <AppearanceSection onPick={() => setPicking(true)} /> : section === '一般' ? <GeneralSection /> : section === '檢查' ? <ChecksSection /> : section === '快捷鍵' ? <ShortcutsSection /> : <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h3 style={h3}>內建標記</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                {BUILTIN_MARKS.map((b) => (
                  <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 8 }}>
                    <span style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><MarkIcon mark={{ kind: b.id }} size={18} menu /></span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{b.label}</span>
                      <span style={{ fontSize: 11.5, color: 'var(--mute)' }}>{b.desc}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h3 style={h3}>自訂標記</h3>
              {customs.map((c) => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, height: 44, padding: '0 8px 0 12px', background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 8 }}>
                  <span style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><MarkIcon mark={markVisual(customs, `c:${c.id}`)} size={18} /></span>
                  <span style={{ flexGrow: 1, fontSize: 13 }}>{c.name}</span>
                  <span style={{ fontSize: 11.5, color: 'var(--mute)', padding: '2px 8px', borderRadius: 9, background: 'var(--chip)' }}>{c.kind === 'sym' ? '符號' : '文字'}</span>
                  <button type="button" className="ib" aria-label={'刪除標記「' + c.name + '」'} title="刪除" onClick={() => {
                      // 有條目用到這個標記時，先問要不要一起清掉
                      const used = useStore.getState().project!.files.some((f) => f.sheets.some((sh) => sh.entries.some((e) => e.mark === 'c:' + c.id)));
                      if (used) set({ askDeleteMark: c.id }); else deleteCustomMark(c.id, true);
                    }}
                    style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 0, borderRadius: 6, color: 'var(--mute)' }}>
                    <IconTrash size={14} />
                  </button>
                </div>
              ))}
              {customs.length === 0 && <div className="empty" style={{ padding: 16 }}>還沒有自訂標記</div>}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 16, background: 'var(--bar)', border: '1px solid var(--line2)', borderRadius: 10 }}>
              <h3 style={h3}>新增自訂標記</h3>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label htmlFor="verso-mark-name" style={{ fontSize: 12, color: 'var(--text2)' }}>名稱</label>
                  <input id="verso-mark-name" type="text" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：需問企劃" />
                </div>
                <div role="group" aria-label="標記樣式" className="seg-group">
                  <button type="button" className="seg" aria-pressed={type === 'sym'} onClick={() => setType('sym')} style={seg(type === 'sym')}>符號庫</button>
                  <button type="button" className="seg" aria-pressed={type === 'text'} onClick={() => setType('text')} style={seg(type === 'text')}>自行輸入</button>
                </div>
              </div>

              {type === 'sym' && (
                <div role="radiogroup" aria-label="符號庫" style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: 6 }}>
                  {SYMBOLS.map((g) => {
                    const on = sym === g.id;
                    return (
                      <button key={g.id} type="button" role="radio" aria-checked={on} aria-label={g.label} title={g.label} className="dd" onClick={() => setSym(g.id)}
                        style={{ height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', background: on ? 'var(--sel)' : 'var(--card)', border: `1px solid ${on ? 'var(--accent)' : 'var(--line2)'}`, borderRadius: 8 }}>
                        <MarkIcon mark={{ kind: 'sym', sym: g.id, color }} size={18} />
                      </button>
                    );
                  })}
                </div>
              )}

              {type === 'text' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label htmlFor="verso-mark-text" style={{ fontSize: 12, color: 'var(--text2)' }}>標記文字</label>
                  <input id="verso-mark-text" type="text" className="field" value={text} onChange={(e) => setText(e.target.value.trim())} placeholder="例如 TM、長、?"
                    style={{ width: 200, fontSize: 14, borderColor: text && !tc.ok ? '#d9725e' : undefined }} />
                  {text && !tc.ok && <span role="alert" style={{ fontSize: 12, color: 'var(--errtx)' }}>{tc.msg}</span>}
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 12, color: 'var(--text2)' }}>顏色</span>
                <div role="radiogroup" aria-label="標記顏色" style={{ display: 'flex', gap: 8 }}>
                  {MARK_COLORS.map((w) => {
                    const on = color === w.hex;
                    return (
                      <button key={w.hex} type="button" role="radio" aria-checked={on} aria-label={w.label} onClick={() => setColor(w.hex)}
                        style={{ width: 26, height: 26, padding: 0, borderRadius: '50%', background: w.hex, border: `2px solid ${on ? 'var(--text)' : 'transparent'}`, boxShadow: '0 0 0 2px var(--bar) inset' }} />
                    );
                  })}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 12, color: 'var(--mute)' }}>預覽</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10, height: 34, padding: '0 12px', background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 8 }}>
                    {preview
                      ? <MarkIcon mark={preview} size={16} />
                      : <span style={{ width: 16, height: 16, boxSizing: 'border-box', border: '1px dashed var(--line6)', borderRadius: 4 }} />}
                    <span style={{ fontSize: 13 }}>{name || '未命名標記'}</span>
                  </span>
                </div>
                <button type="button" className="btn btn-primary" disabled={addOff} onClick={add}
                  style={{ height: 36, display: 'flex', alignItems: 'center', gap: 6, padding: '0 16px', background: 'var(--primary)', border: 0, borderRadius: 8, color: '#ffffff', fontSize: 13, fontWeight: 600 }}>
                  <IconPlus size={13} sw={2.6} />新增標記
                </button>
              </div>
            </div>
            </>}
          </div>
        </div>
      </div>
      {askDeleteMark && (
        <ConfirmDialog zIndex={55} title="要一起清掉條目上的這個標記嗎？"
          body="選「保留」的話，標記會留在檔案裡，但畫面上不會顯示。"
          choices={[
            { label: '取消', onClick: () => set({ askDeleteMark: null }) },
            { label: '保留', onClick: () => deleteCustomMark(askDeleteMark, false) },
            { label: '一起清掉', primary: true, onClick: () => deleteCustomMark(askDeleteMark, true) },
          ]} />
      )}
    </div>
  );
}

function ChecksSection() {
  const settings = useStore((s) => s.checkSettings);
  const setCheck = useStore((s) => s.setCheck);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h3 style={h3}>標點與機器驗證</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
        {CHECKS.map((c) => {
          const on = settings[c.id];
          return (
            <label key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, height: 44, padding: '0 12px', background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 8, cursor: 'pointer' }}>
              <span style={{ fontSize: 13 }}>{c.label}</span>
              <input type="checkbox" role="switch" className="switch" checked={on} onChange={(e) => setCheck(c.id, e.target.checked)} />
            </label>
          );
        })}
      </div>
    </div>
  );
}

function ShortcutsSection() {
  const bindings = useStore((s) => s.shortcuts);
  const setBinding = useStore((s) => s.setBinding);
  const [ctx, setCtx] = useState<ShortcutContext>('input');
  const [recording, setRecording] = useState<ActionId | null>(null);
  // 衝突提示顯示在那一項下面
  const [error, setError] = useState<{ action: ActionId; msg: string } | null>(null);

  // 錄製中：下一個組合鍵就是新的快捷鍵；Backspace 清空；點別處取消
  useEffect(() => {
    if (!recording) return;
    const tab = createTabHold();
    const finish = (combo: string) => {
      const taken = CONTEXT_ACTIONS[ctx].find((a) => a !== recording && bindings[ctx][a]?.includes(combo));
      if (taken) {
        setError({ action: recording, msg: `「${combo}」已被「${ACTION_LABELS[taken]}」使用` });
        return;
      }
      setBinding(ctx, recording, [combo]);
      setRecording(null);
      setError(null);
    };
    const onKey = (ev: KeyboardEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.key === 'Backspace' && !ev.ctrlKey && !ev.altKey && !ev.shiftKey && !ev.metaKey && !tab.held()) {
        setBinding(ctx, recording, []);
        setRecording(null);
        setError(null);
        return;
      }
      if (tab.down(ev)) return;
      const combo = comboOf(ev, tab.held());
      if (!combo) return;
      if (tab.held()) tab.markUsed();
      finish(combo);
    };
    const onUp = (ev: KeyboardEvent) => {
      const combo = tab.up(ev);
      if (combo) finish(combo);
    };
    const onDown = (ev: MouseEvent) => {
      if (!(ev.target as HTMLElement).closest('[data-recording]')) { setRecording(null); setError(null); }
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onUp, true);
    window.addEventListener('mousedown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onUp, true);
      window.removeEventListener('mousedown', onDown, true);
    };
  }, [recording, ctx, bindings, setBinding]);

  const chip: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', height: 24, padding: '0 8px', borderRadius: 6,
    background: 'var(--chip)', border: '1px solid var(--line4)', fontSize: 12, color: 'var(--text)',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <label htmlFor="verso-sc-ctx" style={{ fontSize: 12, color: 'var(--text2)' }}>情境</label>
        <select id="verso-sc-ctx" className="field" value={ctx} style={{ width: 200, padding: '0 10px' }}
          onChange={(e) => { setCtx(e.target.value as ShortcutContext); setRecording(null); setError(null); }}>
          {CONTEXTS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {CONTEXT_ACTIONS[ctx].map((a) => {
          const rec = recording === a;
          const combos = bindings[ctx][a] ?? [];
          return (
            <div key={a} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <button type="button" className="dd" data-recording={rec ? '1' : undefined}
              onClick={() => { setRecording(rec ? null : a); setError(null); }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, height: 44, padding: '0 12px',
                background: rec ? 'var(--sel)' : 'var(--card)', border: `1px solid ${rec ? 'var(--accent)' : 'var(--line2)'}`, borderRadius: 8, textAlign: 'left',
              }}>
              <span style={{ fontSize: 13 }}>{ACTION_LABELS[a]}</span>
              <span style={{ display: 'flex', gap: 6 }}>
                {rec ? <span style={{ ...chip, background: 'transparent', borderStyle: 'dashed', color: 'var(--mute)' }}>按下新的組合鍵</span>
                  : combos.length ? combos.map((c) => <span key={c} className="mono" style={chip}>{c}</span>)
                  : <span style={{ fontSize: 12, color: 'var(--mute3)' }}>—</span>}
              </span>
            </button>
            {error?.action === a && <span role="alert" style={{ fontSize: 12, color: 'var(--errtx)', padding: '0 12px' }}>{error.msg}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GeneralSection() {
  const saveRoot = useStore((s) => s.saveRoot);
  const autosaveMin = useStore((s) => s.autosaveMin);
  const set = useStore((s) => s.set);
  const [min, setMin] = useState(String(autosaveMin));
  const commitMin = () => {
    const n = Math.round(Number(min));
    const v = Number.isFinite(n) ? Math.min(60, Math.max(1, n)) : autosaveMin;
    setMin(String(v));
    set({ autosaveMin: v });
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h3 style={h3}>存檔資料夾</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="mono" title={saveRoot} style={{
            flexGrow: 1, minWidth: 0, height: 36, display: 'flex', alignItems: 'center', padding: '0 12px', boxSizing: 'border-box',
            background: 'var(--bg0)', border: '1px solid var(--line4)', borderRadius: 8, fontSize: 12, color: 'var(--textsoft)',
            overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
          }}>{saveRoot}</span>
          <button type="button" className="btn btn-ghost" onClick={() => void pickSaveRoot()}
            style={{ height: 36, padding: '0 16px', background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, fontSize: 13, flexShrink: 0 }}>更改…</button>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h3 style={h3}>自動存檔</h3>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          每
          <input type="number" min={1} max={60} className="field" value={min} aria-label="自動存檔間隔（分鐘）"
            onChange={(e) => setMin(e.target.value)} onBlur={commitMin} onKeyDown={(e) => { if (e.key === 'Enter') commitMin(); }}
            style={{ width: 72, textAlign: 'center' }} />
          分鐘
        </label>
      </div>
    </div>
  );
}

/** 目前實際使用的主題色（色票顯示、色盤起始色用） */
function currentAccentHex(accent: string, theme: 'dark' | 'light') {
  if (accent.startsWith('#')) return accent;
  const a = ACCENTS.find((x) => x.id === accent) ?? ACCENTS[0];
  return theme === 'light' ? a.light : a.dark;
}

function AccentPicker({ onDone }: { onDone(): void }) {
  const accent = useStore((s) => s.accent);
  const customs = useStore((s) => s.customAccents);
  const set = useStore((s) => s.set);
  const theme = useEffectiveTheme();
  return (
    <ColorPicker initial={currentAccentHex(accent, theme)}
      onPreview={(hex) => set({ accentPreview: hex })}
      onCancel={() => { set({ accentPreview: null }); onDone(); }}
      onSave={(hex) => {
        // 自訂色最多 5 個；滿了就只換顏色，不再加進清單
        const next = customs.includes(hex) || customs.length >= MAX_CUSTOM_ACCENTS ? customs : [...customs, hex];
        set({ accent: hex, customAccents: next, accentPreview: null });
        onDone();
      }} />
  );
}

function AppearanceSection({ onPick }: { onPick(): void }) {
  const themeMode = useStore((s) => s.theme);
  const accent = useStore((s) => s.accent);
  const customs = useStore((s) => s.customAccents);
  const set = useStore((s) => s.set);
  const theme = useEffectiveTheme();
  const seg = (on: boolean): React.CSSProperties => ({
    height: 28, padding: '0 14px', border: 0, borderRadius: 6, fontSize: 12.5,
    background: on ? 'var(--segon)' : 'transparent', color: on ? 'var(--text)' : 'var(--text2)',
  });
  const swatch = (on: boolean, color: string): React.CSSProperties => ({
    width: 28, height: 28, padding: 0, borderRadius: '50%', background: color, cursor: 'pointer',
    border: `2px solid ${on ? 'var(--text)' : 'transparent'}`, boxShadow: '0 0 0 2px var(--panel) inset',
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h3 style={h3}>主題</h3>
        <div role="group" aria-label="主題" className="seg-group" style={{ alignSelf: 'flex-start' }}>
          {([['dark', '深色'], ['light', '淺色'], ['system', '跟隨系統']] as const).map(([id, label]) => (
            <button key={id} type="button" className="seg" aria-pressed={themeMode === id} onClick={() => set({ theme: id })} style={seg(themeMode === id)}>{label}</button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h3 style={h3}>主題色</h3>
        <div role="radiogroup" aria-label="主題色" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
          {ACCENTS.map((a) => (
            <button key={a.id} type="button" role="radio" aria-checked={accent === a.id} aria-label={a.label} title={a.label}
              onClick={() => set({ accent: a.id })} style={swatch(accent === a.id, theme === 'light' ? a.light : a.dark)} />
          ))}
          {customs.length > 0 && <span style={{ width: 1, height: 22, background: 'var(--line3)' }} />}
          {customs.map((hex) => (
            <button key={hex} type="button" role="radio" aria-checked={accent === hex} aria-label={hex} title={hex}
              onClick={() => set({ accent: hex })}
              onContextMenu={(e) => {
                // 右鍵刪除自訂色；刪的是正在用的顏色就退回預設藍
                e.preventDefault();
                set({ customAccents: customs.filter((c) => c !== hex), ...(accent === hex ? { accent: 'blue' } : {}) });
              }}
              style={swatch(accent === hex, hex)} />
          ))}
          <button type="button" className="ib" aria-label="自訂主題色" title="自訂主題色" onClick={onPick}
            style={{ width: 28, height: 28, padding: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: '1px dashed var(--line6)', color: 'var(--text2)' }}>
            <IconPlus size={13} sw={2.4} />
          </button>
        </div>
      </div>
    </div>
  );
}
