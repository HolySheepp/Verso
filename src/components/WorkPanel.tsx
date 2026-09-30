import { useRef } from 'react';
import { currentOf, useStore, visibleIssues } from '../state/store';
import { findCustom, markName, markVisual } from '../model/marks';
import type { MarkId, Mode } from '../model/types';
import { MarkIcon } from './MarkIcon';
import { MarkMenu } from './MarkMenu';
import {
  IconWarn,
  IconBraces, IconCheck, IconChevL, IconChevR, IconCopy, IconEraser, IconEye, IconFeather, IconLock, IconPen, IconUndo, IconUse,
} from './icons';

const MODE_HINTS: Record<Mode, string> = {
  translate: '只能編輯譯文',
  verify: '可修正譯文',
  view: '唯讀',
  source: '只能編輯原文，原始版本會保留',
};

/** 「標記並下一條」在各模式下不能選的標記 */
const STAMP_EXCLUDE: Record<Mode, MarkId[]> = {
  translate: ['untranslated', 'translated'],
  verify: ['untranslated', 'translated', 'verified'],
  view: ['untranslated', 'translated'],
  source: ['untranslated', 'translated'],
};

const labelRow: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 18 };
const meta: React.CSSProperties = { display: 'flex', gap: 12, fontSize: 11.5, color: 'var(--mute)' };

export function WorkPanel({ height }: { height: number }) {
  const s = useStore();
  const project = s.project!;
  const { sheet, sel, entry } = currentOf(s);
  const cur = entry!;
  const total = sheet.entries.length;
  const mode = s.mode;
  const customs = project.customMarks;
  const issues = visibleIssues(cur, s.reported, s.checkSettings);
  const issueText = issues.map((i) => i.msg).join('、');

  const hist = s.history.byEntry[cur.uid];
  const texts = hist?.texts ?? [];
  const slot = hist ? hist.slot : -1;
  const viewOn = s.viewOn && texts.length > 0;
  const showHist = (viewOn || s.peek) && texts.length > 0;

  const srcEditable = mode === 'source';
  const tgtEditable = mode === 'translate' || mode === 'verify';

  // 標記並下一條：各模式分別記住選的標記
  const exclude = STAMP_EXCLUDE[mode];
  const fallback: MarkId = mode === 'verify' ? 'doubt' : 'think';
  let stamp: MarkId = s.stamps[mode] ?? fallback;
  if (exclude.includes(stamp) || (stamp.startsWith('c:') && !findCustom(customs, stamp))) stamp = fallback;
  const stampLabel = '選擇標記，目前：' + markName(customs, stamp);

  const press = useRef<{ t: number } | null>(null);

  const onTarget = (v: string) => {
    if (!tgtEditable || showHist) return;
    s.updateEntry({ tgt: v });
  };

  // 整段貼上（貼上的內容取代全部譯文）時，先記下貼上前的譯文
  const onPaste = (ev: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!tgtEditable || showHist) return;
    const ta = ev.currentTarget;
    const txt = ev.clipboardData.getData('text');
    const whole = ta.selectionStart === 0 && ta.selectionEnd === ta.value.length;
    if (whole && txt && cur.tgt && txt !== cur.tgt) s.record(cur.tgt);
  };

  const viewTip = viewOn ? '返回目前譯文' : texts.length ? '查看修改（按住預覽）' : '查看修改（尚無記錄）';

  return (
    <section aria-label="工作欄" style={{
      height, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px', boxSizing: 'border-box',
      background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10,
    }}>
      <div style={{ flexGrow: 1, minHeight: 0, display: 'flex', gap: 12 }}>
        <div style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={labelRow}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label htmlFor="verso-source" className="sec-label">原文</label>
              {srcEditable && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--warntx)', padding: '1px 7px', borderRadius: 9, background: 'rgba(240,165,74,0.12)' }}>
                  <IconPen size={10} sw={2.6} />可編輯
                </span>
              )}
              {cur.src !== cur.src0 && <span style={{ fontSize: 11, color: 'var(--text2)' }}>已修改，原始版本會保留</span>}
            </span>
            <span style={meta}><span>{cur.speaker}</span><span>{cur.src.length} 字</span></span>
          </div>
          <textarea id="verso-source" value={cur.src} readOnly={!srcEditable}
            onChange={(ev) => srcEditable && s.updateEntry({ src: ev.target.value })}
            style={{
              height: 66, flexShrink: 0, resize: 'none', boxSizing: 'border-box', padding: '10px 12px',
              background: srcEditable ? 'var(--bg0)' : 'var(--bgdeep)', border: `1px solid ${srcEditable ? 'rgba(240,165,74,0.55)' : 'var(--line)'}`,
              borderRadius: 8, fontSize: 15, lineHeight: 1.6, color: 'var(--text)',
            }} />

          <div style={{ ...labelRow, marginTop: 6, gap: 12 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <label htmlFor="verso-target" className="sec-label">譯文</label>
              {!tgtEditable && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text2)', padding: '1px 7px', borderRadius: 9, background: 'var(--chip)' }}>
                  <IconLock size={10} sw={2.6} />唯讀
                </span>
              )}
              {issues.length > 0 && (
                <span role="status" style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, fontSize: 11.5, color: 'var(--warntx)' }}>
                  <IconWarn size={12} sw={2.2} style={{ flexShrink: 0 }} />
                  <span title={issueText} style={{ minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{issueText}</span>
                  <button type="button" className="ib" onClick={() => s.skipCheck()}
                    style={{ flexShrink: 0, height: 20, padding: '0 8px', background: 'transparent', border: '1px solid var(--line4)', borderRadius: 5, color: 'var(--text2)', fontSize: 11 }}>略過</button>
                </span>
              )}
            </span>
            <span style={{ ...meta, flexShrink: 0 }}>
              <span>{texts.length ? `已記錄 ${texts.length} / 3` : ''}</span>
              <span>{cur.tgt.length} 字元</span>
            </span>
          </div>
          <div style={{ flexGrow: 1, minHeight: 0, position: 'relative', display: 'flex' }}>
            <textarea id="verso-target" data-hist={showHist ? '1' : '0'} value={showHist ? texts[slot] : cur.tgt}
              readOnly={!tgtEditable || showHist}
              onChange={(ev) => onTarget(ev.target.value)} onPaste={onPaste}
              style={{
                flexGrow: 1, minHeight: 0, resize: 'none', boxSizing: 'border-box', padding: '10px 44px 10px 12px',
                background: tgtEditable ? 'var(--bg0)' : 'var(--bgdeep)',
                border: `1px ${showHist ? 'dashed' : 'solid'} ${showHist ? 'var(--accent)' : tgtEditable ? 'var(--line4)' : 'var(--line)'}`,
                borderRadius: 8, color: tgtEditable ? 'var(--texthi)' : 'var(--textsoft)', fontSize: 15, lineHeight: 1.6,
              }} />

            <div role="toolbar" aria-label="譯文記錄" aria-orientation="vertical" style={{ position: 'absolute', right: 6, top: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <button type="button" className="hb tip" data-tip="記錄" aria-label="記錄" disabled={!tgtEditable || showHist}
                onClick={() => s.record()}>
                <IconFeather size={14} />
              </button>
              <button type="button" className="hb tip" data-tip={viewTip} aria-label="查看修改" aria-pressed={viewOn} disabled={!texts.length}
                style={{ color: viewOn ? 'var(--accent2)' : 'var(--mute)', background: viewOn ? 'rgba(79,140,255,0.16)' : 'transparent' }}
                onPointerDown={(ev) => {
                  if (!texts.length) return;
                  try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch { /* 無法捕捉時照常運作 */ }
                  press.current = { t: Date.now() };
                  s.set({ peek: true });
                }}
                onPointerUp={() => {
                  if (!press.current) return;
                  const long = Date.now() - press.current.t >= 300;
                  press.current = null;
                  // 短按切換查看狀態，長按放開就回到目前譯文
                  s.set(long ? { peek: false } : { peek: false, viewOn: !viewOn });
                }}
                onPointerLeave={() => { if (press.current) { press.current = null; s.set({ peek: false }); } }}
                onClick={(ev) => { if (ev.detail === 0 && texts.length) s.set({ viewOn: !viewOn }); }}>
                <IconEye size={14} sw={2.2} />
              </button>
              {viewOn && tgtEditable && (
                <button type="button" className="hb tip" data-tip="使用此內容" aria-label="使用此內容" style={{ color: 'var(--accent2)' }}
                  onClick={() => s.useShownSlot()}>
                  <IconUse size={14} sw={2.2} />
                </button>
              )}
            </div>

            {showHist && (
              <div style={{ position: 'absolute', left: 8, bottom: 7, display: 'flex', alignItems: 'center', gap: 6, padding: '3px 4px 3px 8px', background: 'var(--pop)', border: '1px solid var(--line4)', borderRadius: 7 }}>
                <span style={{ fontSize: 11, color: 'var(--text2)' }}>記錄</span>
                <div role="radiogroup" aria-label="選擇記錄槽位" style={{ display: 'flex', gap: 3 }}>
                  {texts.map((_, i) => {
                    const on = i === slot;
                    return (
                      <button key={i} type="button" className="slot mono" role="radio" aria-checked={on} aria-label={'記錄 ' + (i + 1)}
                        onClick={() => s.pickSlot(i)}
                        style={{
                          width: 22, height: 22, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 5,
                          fontSize: 11, fontWeight: 500, background: on ? '#2f6fe4' : 'var(--chip)', color: on ? '#ffffff' : 'var(--text2)',
                          border: `1px solid ${on ? '#2f6fe4' : 'var(--line4)'}`,
                        }}>{i + 1}</button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 右側按鈕目前是示範用的暫代功能，之後再決定 */}
        <div role="toolbar" aria-label="條目功能" aria-orientation="vertical" style={{ width: 36, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 24 }}>
          {mode === 'translate' && (
            <>
              <button type="button" className="ib btn-side" aria-label="複製原文到譯文" title="複製原文到譯文" onClick={() => s.updateEntry({ tgt: cur.src })}>
                <IconCopy size={15} />
              </button>
              <button type="button" className="ib btn-side" aria-label="清除譯文" title="清除譯文" onClick={() => s.updateEntry({ tgt: '' })}>
                <IconEraser size={15} />
              </button>
            </>
          )}
          {mode === 'verify' && (
            <button type="button" className="ib btn-side" aria-label="還原譯文" title="還原為驗證前的譯文" onClick={() => s.updateEntry({ tgt: cur.tgt0 })}>
              <IconUndo size={15} />
            </button>
          )}
          {mode === 'source' && (
            <button type="button" className="ib btn-side" aria-label="還原原文" title="還原為原始原文" onClick={() => s.updateEntry({ src: cur.src0 })}>
              <IconUndo size={15} />
            </button>
          )}
          {mode !== 'view' && (
            // 插入標籤：只有外觀，尚未實作
            <button type="button" className="ib btn-side" aria-label="插入標籤" title="插入標籤，例如 {0}">
              <IconBraces size={15} />
            </button>
          )}
          {mode === 'view' && (
            <button type="button" className="ib btn-side" aria-label="複製譯文" title="複製譯文到剪貼簿"
              onClick={() => { void navigator.clipboard?.writeText(cur.tgt); }}>
              <IconCopy size={15} />
            </button>
          )}
        </div>
      </div>

      <div style={{ height: 40, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--mute)' }}>
          <span>第 {sel + 1} / {total} 條</span><span>{MODE_HINTS[mode]}</span>
        </span>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {mode === 'view' && (
            <button type="button" className="btn btn-ghost btn-std" onClick={() => s.prev()} style={{ gap: 6, padding: '0 16px' }}>
              <IconChevL size={14} sw={2.2} />上一條
            </button>
          )}
          {mode !== 'view' && (
            <div style={{ position: 'relative', display: 'flex' }}>
              <button type="button" className="btn btn-ghost btn-std" aria-haspopup="menu" aria-expanded={s.stampOpen} aria-label={stampLabel} title={stampLabel}
                onClick={() => s.set({ stampOpen: !s.stampOpen, rowMenu: null, fileMenuOpen: false })}
                style={{ width: 38, justifyContent: 'center', padding: 0, borderRadius: '8px 0 0 8px' }}>
                <MarkIcon mark={markVisual(customs, stamp)} size={16} menu />
              </button>
              <button type="button" className="btn btn-ghost btn-std"
                onClick={() => { s.setEntryMark(sel, stamp); s.next(); }}
                style={{ padding: '0 16px', borderLeft: 0, borderRadius: '0 8px 8px 0' }}>標記並下一條</button>
              {s.stampOpen && (
                <MarkMenu title="按下後留下的標記" ariaLabel="選擇按鈕要留下的標記" current={stamp} exclude={exclude}
                  style={{ position: 'absolute', bottom: 46, left: 0 }}
                  onPick={(id) => s.set({ stamps: { ...s.stamps, [mode]: id }, stampOpen: false })} />
              )}
            </div>
          )}
          {mode === 'verify' && (
            <button type="button" className="btn btn-primary btn-main" onClick={() => { s.setEntryMark(sel, 'verified'); s.next(); }}>
              <IconCheck size={14} sw={2.6} />驗證並下一條
            </button>
          )}
          {mode !== 'verify' && (
            <button type="button" className="btn btn-primary btn-main" onClick={() => s.next()}>
              下一條<IconChevR size={14} sw={2.2} />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
