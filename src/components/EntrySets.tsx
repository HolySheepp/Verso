// 條目欄裡的收起組、條目串（雲端模式）：
// 收起組的名稱列（收起時是一個按鈕，展開時是組的開頭，點了都會展開或收起）、略過列、條目串展開時的開頭列
import { useEffect, useRef, useState } from 'react';
import { tx } from '../i18n';
import { fz } from '../model/fonts';
import { markName, markVisual } from '../model/marks';
import type { Chain, EntryGroup } from '../model/entrySets';
import type { CustomMark, MarkId } from '../model/types';
import { MarkIcon } from './MarkIcon';

/** 收起組的圖示：疊在一起的兩張卡片 */
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

/** 組裡有哪些標記、各幾條（跟頁簽一樣用標記的圖示；數字緊貼在圖示旁邊） */
export function MarkCounts({ marks, customs }: { marks: { id: MarkId; n: number }[]; customs: CustomMark[] }) {
  if (!marks.length) return null;
  const tip = marks.map((k) => markName(customs, k.id) + ' ' + k.n).join(tx('common.sep'));
  return (
    <span title={tip} aria-label={tip} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: fz(11), color: 'var(--mute)' }}>
      {marks.map((k) => (
        <span key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <MarkIcon mark={markVisual(customs, k.id)} size={11} menu />{k.n}
        </span>
      ))}
    </span>
  );
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
      style={{ height: 26, width: 'min(340px, 60%)', textAlign: 'center', fontSize: fz(13) }} />
  );
}

interface GroupProps {
  g: EntryGroup;
  /** 顯示的名稱（空白時自動的名稱） */
  name: string;
  open: boolean;
  count: number;
  marks: { id: MarkId; n: number }[];
  customs: CustomMark[];
  /** 收起時有幾條單獨顯示出來（搜尋、篩選命中、原文更新）：按鈕下面接著那幾條 */
  shown: number;
  naming: boolean;
  picked: boolean;
  /** 剛展開或收起：跑一次彈性動畫 */
  bounce: boolean;
  onRename(name: string): void;
  onMenu(ev: React.MouseEvent): void;
  /** 按下、拖過、放開（點一下展開或收起；按住拖過好幾個組是選取，合併用） */
  onDown(ev: React.MouseEvent): void;
  onEnter(ev: React.MouseEvent): void;
  onClick(ev: React.MouseEvent): void;
}

/** 收起組的名稱列：收起時是一個長方形按鈕，展開時是組的開頭；點了展開或收起，名稱都在中間 */
export function GroupItem({ g, name, open, count, marks, customs, shown, naming, picked, bounce, onRename, onMenu, onDown, onEnter, onClick }: GroupProps) {
  const [renaming, setRenaming] = useState(false);
  useEffect(() => { if (naming) setRenaming(true); }, [naming]);
  const editing = renaming || naming;
  const square = open || shown > 0;
  return (
    <div className={'set-wrap' + (bounce ? ' set-bounce' : '')} style={{ padding: open ? '4px 8px 0 6px' : '3px 8px 3px 6px' }}>
      <div role="button" tabIndex={-1} className={'set-btn' + (picked ? ' set-btn-picked' : '')} aria-expanded={open}
        aria-label={tx('sets.group') + tx('common.colon') + name + tx('common.colon') + tx('sets.count', { n: count })} title={open ? tx('sets.fold') : tx('sets.expand')}
        onMouseDown={(e) => { if (!editing) onDown(e); }} onMouseEnter={onEnter} onClick={(e) => { if (!editing) onClick(e); }} onContextMenu={onMenu}
        style={{ position: 'relative', minHeight: 34, display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 10, padding: '0 12px', borderRadius: square ? '9px 9px 0 0' : 9, cursor: 'pointer', fontSize: fz(12.5), color: 'var(--text2)' }}>
        <span />
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ display: 'flex', color: 'var(--text2)' }}><IconStack size={14} /></span>
          {editing
            ? <NameInput initial={g.name} placeholder={name} onDone={(v) => { setRenaming(false); onRename(v ?? g.name); }} />
            : <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{name}</span>}
          <span style={{ flexShrink: 0, fontSize: fz(11.5), color: 'var(--mute)' }}>{tx('sets.count', { n: count })}</span>
        </span>
        <span style={{ display: 'flex', justifyContent: 'flex-end', minWidth: 0 }}><MarkCounts marks={marks} customs={customs} /></span>
      </div>
    </div>
  );
}

/** 收起的組裡沒顯示出來的連續幾條：點了展開整組 */
export function DotsItem({ n, onOpen }: { n: number; onOpen(): void }) {
  return (
    <div className="set-dots" role="button" tabIndex={-1} onClick={onOpen}
      style={{ margin: '0 8px 0 6px', height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: fz(11), color: 'var(--mute)', cursor: 'pointer', background: 'var(--setbg)', borderLeft: '1px solid var(--line2)', borderRight: '1px solid var(--line2)' }}>
      <span style={{ letterSpacing: 2 }}>···</span>{tx('sets.dots', { n })}
    </div>
  );
}

/** 條目串展開時的開頭列：串的原文（拿掉標籤數字）、條數；點了收起 */
export function ChainBar({ c, bounce, marks, customs, onToggle }: { c: Chain; depth: number; bounce: boolean; marks: { id: MarkId; n: number }[]; customs: CustomMark[]; onToggle(): void }) {
  return (
    <div className={'set-wrap' + (bounce ? ' set-bounce' : '')} style={{ padding: '2px 8px 0 6px' }}>
      <div role="button" tabIndex={-1} className="set-btn chain-btn" aria-expanded aria-label={tx('sets.chain') + tx('common.colon') + c.src} title={tx('sets.fold')} onClick={onToggle}
        style={{ minHeight: 30, display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 10, padding: '0 12px', borderRadius: '8px 8px 0 0', cursor: 'pointer', fontSize: fz(12), color: 'var(--text2)', borderColor: c.outliers.size ? 'var(--dbline)' : undefined }}>
        <span />
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ display: 'flex' }}><IconLink size={13} /></span>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-src)' }}>{c.src}</span>
          <span style={{ flexShrink: 0, fontSize: fz(11.5), color: 'var(--mute)' }}>{tx('sets.count', { n: c.uids.length })}</span>
        </span>
        <span style={{ display: 'flex', justifyContent: 'flex-end', minWidth: 0 }}><MarkCounts marks={marks} customs={customs} /></span>
      </div>
    </div>
  );
}
