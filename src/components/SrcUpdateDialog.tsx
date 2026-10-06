import { useMemo, useState } from 'react';
import { currentOf, useStore } from '../state/store';
import { checkColumns, emptyColumns, pasteColumns, type ColKey, type Columns } from '../model/paste';
import { applyUpdate, arrowOf, autoAlign, sequentialRows, summarize, type AlignRow, type NewRow } from '../model/srcUpdate';
import { PasteBox, type BoxSel } from './PasteBox';
import { ConfirmDialog } from './ConfirmDialog';
import { IconWinClose } from './icons';
import { dragWindow } from './windowDrag';
import { fz } from '../model/fonts';

const KEYS: ColKey[] = ['id', 'speaker', 'src'];
const LABELS: Record<string, string> = { id: 'ID', speaker: '發話者', src: '原文' };

/** 頁簽右鍵「更新原文（實驗性功能）」 */
export function SrcUpdateDialog() {
  const sheet = useStore((s) => s.srcUpdate);
  return sheet === null ? null : <SrcUpdate sheetIdx={sheet} />;
}

const btn: React.CSSProperties = { height: 36, padding: '0 16px', background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, fontSize: fz(13) };
const primary: React.CSSProperties = { height: 36, padding: '0 18px', background: 'var(--primary)', border: 0, borderRadius: 8, color: '#ffffff', fontSize: fz(13), fontWeight: 600 };

function SrcUpdate({ sheetIdx }: { sheetIdx: number }) {
  const { set, applySrcUpdate } = useStore.getState();
  const sheet = useStore((s) => currentOf(s).fileDoc.sheets[sheetIdx]);
  const close = () => set({ srcUpdate: null });
  const [cols, setCols] = useState<Columns>(emptyColumns);
  const [sel, setSel] = useState<{ key: string; sel: BoxSel } | null>(null);
  const [step, setStep] = useState<'paste' | 'align'>('paste');
  const [rows, setRows] = useState<AlignRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const check = checkColumns(cols);
  const next: NewRow[] = useMemo(() => (cols.src?.rows ?? []).map((src, i) => ({ id: cols.id?.rows[i] ?? '', speaker: cols.speaker?.rows[i] ?? '', src })), [cols]);
  const entries = sheet?.entries ?? [];
  const arrows = useMemo(() => rows.map((r) => arrowOf(r.old === null ? null : entries[r.old].src, r.new === null ? null : next[r.new].src)), [rows, entries, next]);
  const summary = useMemo(() => summarize(entries, next, rows), [entries, next, rows]);

  if (!sheet) return null;

  const toAlign = () => { setRows(sequentialRows(entries.length, next.length)); setStep('align'); };
  const analyse = () => {
    setBusy(true);
    // 先讓畫面顯示「解析中」，再開始算
    setTimeout(() => {
      setRows(autoAlign(entries.map((e) => ({ id: e.id, src: e.src })), next));
      setBusy(false);
    }, 30);
  };
  const apply = () => {
    applySrcUpdate(sheetIdx, applyUpdate(entries, next, rows, { id: !!cols.id, speaker: !!cols.speaker }));
  };

  const cell = (text: string | null, id: string): React.ReactNode => (
    <div style={{ minWidth: 0, padding: '6px 10px', borderRadius: 6, background: text === null ? 'transparent' : 'var(--bg0)', border: `1px ${text === null ? 'dashed' : 'solid'} var(--line)`, fontSize: fz(12.5), lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: text === null ? 'var(--mute3)' : 'var(--text)' }}>
      {text === null ? '（空格）' : <>{id && <span className="mono" style={{ marginRight: 8, fontSize: fz(11), color: 'var(--mute)' }}>{id}</span>}{text}</>}
    </div>
  );

  return (
    <div className="scrim" style={{ zIndex: 45 }}>
      <div role="dialog" aria-modal="true" aria-labelledby="verso-upd-title" className="dialog"
        style={{ width: 960, height: 640, maxWidth: 'calc(100% - 48px)', maxHeight: 'calc(100% - 48px)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>
        <div onMouseDown={dragWindow} style={{ height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px 0 20px', borderBottom: '1px solid var(--line)' }}>
          <h2 id="verso-upd-title" style={{ margin: 0, fontSize: fz(15), fontWeight: 600 }}>
            更新原文：{sheet.name}<span style={{ marginLeft: 10, fontSize: fz(12), fontWeight: 400, color: 'var(--mute)' }}>實驗性功能</span>
          </h2>
          <button type="button" className="ib" aria-label="關閉" onClick={close}
            style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 0, borderRadius: 8, color: 'var(--text2)' }}>
            <IconWinClose size={13} sw={1.4} />
          </button>
        </div>

        {step === 'paste' ? (
          <div style={{ flexGrow: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '120px 145px minmax(0, 1fr)', gap: 12, padding: '16px 20px' }}>
            {KEYS.map((k) => (
              <PasteBox key={k} label={LABELS[k]} col={cols[k]} required={k === 'src'} fontSlot={k === 'id' || k === 'speaker' ? k : undefined}
                onPaste={(values, start) => setCols((c) => ({ ...c, ...pasteColumns(KEYS, k, values, c, start) }))}
                onChange={(col) => setCols((c) => ({ ...c, [k]: col }))}
                selected={sel?.key === k ? sel.sel : null}
                onSelect={(s) => setSel(s === null ? null : { key: k, sel: s })} />
            ))}
          </div>
        ) : (
          <div style={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '12px 20px 0' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 36px minmax(0, 1fr)', gap: 8, padding: '0 4px 8px', fontSize: fz(12), color: 'var(--text2)' }}>
              <span>目前的原文</span><span /><span>新版原文</span>
            </div>
            <div style={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 36px minmax(0, 1fr)', gap: '6px 8px', alignContent: 'start', padding: '0 4px 12px' }}>
              {rows.map((r, k) => {
                const a = arrows[k];
                const o = r.old === null ? null : entries[r.old];
                const n = r.new === null ? null : next[r.new];
                return [
                  <div key={k + 'o'}>{cell(o ? o.src : null, o?.id ?? '')}</div>,
                  <div key={k + 'a'} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {a !== 'same' && (
                      <svg width="22" height="14" viewBox="0 0 22 14" aria-label={a === 'yellow' ? '有改' : '差很多或對面是空格'}>
                        <path d="M2 7h16M13 2l5 5-5 5" fill="none" stroke={a === 'yellow' ? '#e8b93a' : 'var(--errtx)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>,
                  <div key={k + 'n'}>{cell(n ? n.src : null, n?.id ?? '')}</div>,
                ];
              })}
            </div>
          </div>
        )}

        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 20px 16px', borderTop: '1px solid var(--line)' }}>
          <span role="alert" style={{ fontSize: fz(12.5), color: step === 'paste' && cols.src && !check.ok ? 'var(--errtx)' : 'var(--mute)' }}>
            {step === 'paste'
              ? (cols.src && !check.ok ? check.msg : `新版 ${next.length} 條，目前 ${entries.length} 條`)
              : `沒變 ${summary.same}、改了 ${summary.changed}、新增 ${summary.added}、移除 ${summary.removed}`}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {step === 'paste' ? (
              <>
                <button type="button" className="btn btn-ghost" onClick={close} style={btn}>取消</button>
                <button type="button" className="btn btn-primary" disabled={!check.ok} onClick={toAlign} style={{ ...primary, opacity: check.ok ? 1 : 0.5 }}>下一步</button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn-ghost" onClick={() => setStep('paste')} style={btn}>上一步</button>
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={analyse} style={btn}>{busy ? '解析中…' : '解析差異'}</button>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => setConfirm(true)} style={primary}>確定</button>
              </>
            )}
          </div>
        </div>
      </div>
      {confirm && (
        <ConfirmDialog zIndex={60} title="套用新版原文？"
          body={`沒變 ${summary.same}、改了 ${summary.changed}、新增 ${summary.added}、移除 ${summary.removed}。套用後可以在條目欄按 Ctrl+Z 退回。`}
          choices={[{ label: '取消', onClick: () => setConfirm(false) }, { label: '套用', primary: true, onClick: () => { setConfirm(false); apply(); } }]} />
      )}
    </div>
  );
}
