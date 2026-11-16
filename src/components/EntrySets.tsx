// 條目欄裡的收起組按鈕、收起組標題列、略過列、條目串展開時的標題列（雲端模式）
import { useEffect, useRef, useState } from 'react';
import { tx } from '../i18n';
import { fz } from '../model/fonts';
import type { Chain, EntryGroup } from '../model/entrySets';
import type { Entry } from '../model/types';
import { IconChevD } from './icons';

/** 收起組、條目串的圖示：疊在一起的兩張卡片 */
export function IconStack({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="8" width="14" height="12" rx="2.5" /><path d="M7 4.5h11.5A2.5 2.5 0 0 1 21 7v9.5" />
    </svg>
  );
}

/** 條目串的圖示：串在一起的兩個環 */
export function IconLink({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" /><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />
    </svg>
  );
}

/** 組裡的狀態：未翻譯幾條、疑慮幾條 */
function Summary({ members }: { members: Entry[] }) {
  const untranslated = members.filter((e) => !e.tgt && e.src.trim() && e.mark !== 'ignore').length;
  const doubt = members.filter((e) => e.mark === 'doubt').length;
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: fz(11.5), color: 'var(--mute)' }}>
      {untranslated > 0 && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 7, height: 7, borderRadius: 4, background: 'var(--mute2)' }} />{untranslated}</span>}
      {doubt > 0 && <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--warntx)' }}><span style={{ width: 7, height: 7, borderRadius: 4, background: 'var(--warntx)' }} />{doubt}</span>}
    </span>
  );
}

interface GroupProps {
  g: EntryGroup;
  /** 顯示的名稱（空白時自動的名稱） */
  name: string;
  open: boolean;
  members: Entry[];
  /** 收起時有幾條單獨顯示出來（搜尋、篩選命中、原文更新） */
  shown: number;
  naming: boolean;
  picked: boolean;
  /** 剛展開或收起：跑一次彈性動畫 */
  bounce: boolean;
  onToggle(): void;
  onRename(name: string): void;
  onMenu(ev: React.MouseEvent): void;
  /** Ctrl、Shift 點：選這一組（合併用）；回傳 true 表示已經處理 */
  onPick(ev: React.MouseEvent): boolean;
}

/** 名稱輸入框：Enter 或點別處確定，Esc 取消（留空就用自動的名稱） */
function NameInput({ initial, placeholder, onDone }: { initial: string; placeholder: string; onDone(v: string | null): void }) {
  const [v, setV] = useState(initial);
  const done = useRef(false);
  const finish = (x: string | null) => { if (done.current) return; done.current = true; onDone(x); };
  return (
    <input className="field" autoFocus value={v} placeholder={placeholder} aria-label={tx('sets.groupName')}
      onChange={(e) => setV(e.target.value)} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') finish(v); if (e.key === 'Escape') finish(null); }}
      onBlur={() => finish(v)}
      style={{ height: 28, width: 'min(340px, 60%)', textAlign: 'center', fontSize: fz(13) }} />
  );
}

/** 收起組：收起時是一個長方形按鈕，展開時是標題列（右邊的鍵可以再收起） */
export function GroupItem({ g, name, open, members, shown, naming, picked, bounce, onToggle, onRename, onMenu, onPick }: GroupProps) {
  const [renaming, setRenaming] = useState(false);
  useEffect(() => { if (naming) setRenaming(true); }, [naming]);
  const editing = renaming || naming;
  const nameEl = editing
    ? <NameInput initial={g.name} placeholder={name} onDone={(v) => { setRenaming(false); onRename(v ?? g.name); }} />
    : <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{name}</span>;
  const click = (ev: React.MouseEvent) => { if (ev.button !== 0 || editing) return; if (onPick(ev)) return; onToggle(); };
  if (open) {
    return (
      <div className={'rw set-head' + (bounce ? ' set-bounce' : '')} data-key={'g:' + g.id} role="group" aria-label={tx('sets.group') + tx('common.colon') + name}
        onContextMenu={onMenu} onMouseDown={(e) => { if (e.button === 0 && (e.ctrlKey || e.metaKey || e.shiftKey)) { e.preventDefault(); onPick(e); } }}
        onDoubleClick={() => setRenaming(true)}
        style={{ margin: '4px 8px 0 6px', minHeight: 34, display: 'flex', alignItems: 'center', gap: 8, padding: '0 6px 0 12px', borderRadius: '9px 9px 0 0', background: 'var(--bar2)', border: `1px solid ${picked ? 'var(--accent)' : 'var(--line2)'}`, borderBottom: 0, fontSize: fz(12.5), color: 'var(--text2)' }}>
        <span style={{ display: 'flex', color: 'var(--accent2)' }}><IconStack size={14} /></span>
        {nameEl}
        <span style={{ flexShrink: 0, fontSize: fz(11.5), color: 'var(--mute)' }}>{tx('sets.count', { n: members.length })}</span>
        <span style={{ flexGrow: 1 }} />
        <Summary members={members} />
        <button type="button" className="ib" aria-label={tx('sets.fold')} title={tx('sets.fold')} onClick={onToggle}
          style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'var(--btn)', border: '1px solid var(--line3)', borderRadius: 7, color: 'var(--text2)' }}>
          <IconChevD size={13} sw={2.4} style={{ transform: 'rotate(180deg)' }} />
        </button>
      </div>
    );
  }
  return (
    <div className={'set-wrap' + (bounce ? ' set-bounce' : '')} data-key={'g:' + g.id} style={{ padding: '3px 8px 3px 6px' }}>
      <div role="button" tabIndex={-1} className={'set-btn' + (picked ? ' set-btn-picked' : '')} aria-expanded={false} aria-label={tx('sets.group') + tx('common.colon') + name + tx('common.colon') + tx('sets.count', { n: members.length })}
        onClick={click} onMouseDown={(e) => { if (e.button === 0 && (e.ctrlKey || e.metaKey || e.shiftKey)) e.preventDefault(); }} onContextMenu={onMenu}
        style={{ position: 'relative', minHeight: 36, display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 10, padding: '0 12px', borderRadius: shown ? '9px 9px 0 0' : 9, cursor: 'pointer', fontSize: fz(12.5), color: 'var(--text2)' }}>
        <span />
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ display: 'flex', color: 'var(--accent2)' }}><IconStack size={14} /></span>
          {nameEl}
          <span style={{ flexShrink: 0, fontSize: fz(11.5), color: 'var(--mute)' }}>{tx('sets.count', { n: members.length })}</span>
        </span>
        <span style={{ display: 'flex', justifyContent: 'flex-end' }}><Summary members={members} /></span>
      </div>
    </div>
  );
}

/** 收起的組裡沒顯示出來的連續幾條：點了展開整組 */
export function DotsItem({ k, n, onOpen }: { k: string; n: number; onOpen(): void }) {
  return (
    <div className="set-dots" data-key={k} role="button" tabIndex={-1} onClick={onOpen}
      style={{ margin: '0 8px 0 6px', height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: fz(11), color: 'var(--mute)', cursor: 'pointer', background: 'var(--bar2)', borderLeft: '1px solid var(--line2)', borderRight: '1px solid var(--line2)' }}>
      <span style={{ letterSpacing: 2 }}>···</span>{tx('sets.dots', { n })}
    </div>
  );
}

/** 條目串展開時的標題列：串的原文（拿掉標籤數字）、條數、收起的鍵 */
export function ChainBar({ c, depth, bounce, onToggle, onMenu }: { c: Chain; depth: number; bounce: boolean; onToggle(): void; onMenu(ev: React.MouseEvent): void }) {
  return (
    <div className={'rw chain-bar' + (bounce ? ' set-bounce' : '')} data-key={'c:' + c.id} role="group" aria-label={tx('sets.chain') + tx('common.colon') + c.src}
      onContextMenu={onMenu}
      style={{ margin: `2px 8px 0 ${6 + depth * 10}px`, minHeight: 30, display: 'flex', alignItems: 'center', gap: 8, padding: '0 6px 0 10px', borderRadius: '8px 8px 0 0', background: 'color-mix(in srgb, var(--accent) 7%, var(--panel))', border: `1px solid ${c.outliers.size ? 'var(--dbline)' : 'color-mix(in srgb, var(--accent) 30%, transparent)'}`, borderBottom: 0, fontSize: fz(12), color: 'var(--text2)' }}>
      <span style={{ display: 'flex', color: 'var(--accent2)' }}><IconLink size={13} /></span>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-src)' }}>{c.src}</span>
      <span style={{ flexShrink: 0, fontSize: fz(11.5), color: 'var(--mute)' }}>{tx('sets.count', { n: c.uids.length })}</span>
      <span style={{ flexGrow: 1 }} />
      <button type="button" className="ib" aria-label={tx('sets.fold')} title={tx('sets.fold')} onClick={onToggle}
        style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'var(--btn)', border: '1px solid var(--line3)', borderRadius: 6, color: 'var(--text2)' }}>
        <IconChevD size={12} sw={2.4} style={{ transform: 'rotate(180deg)' }} />
      </button>
    </div>
  );
}
