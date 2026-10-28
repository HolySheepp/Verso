// 雲端模式的備註留言面板（設計檔：各設計檔/verso-comments）。
// 面板用 position:absolute 填滿外層容器，外層容器的高度由版面決定（不會被訊息撐高）。

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as RKeyboardEvent, MouseEvent as RMouseEvent, CSSProperties, ReactNode } from 'react';
import { formatTime, newCommentId, type CommentReply, type CommentThread } from '../../model/comments';
import { tx } from '../../i18n';
import './comments.css';

export interface CommentsPanelProps {
  entryKey: string;
  /** 唯讀的虛線區塊：原備註、設定 Google 表時另外抓的欄 */
  srcNotes?: { name: string; text: string }[];
  notes: CommentThread[];
  me: string;
  onChange: (next: CommentThread[]) => void;
  /** 還沒有用戶名：送出前先問；回傳 false 就不送 */
  ensureName?: () => Promise<string | null>;
  /** 唯讀（唯讀模式）：不能留言、改留言 */
  readOnly?: boolean;
}

type Layer = 'main' | 'thread';
type Msg = CommentThread | CommentReply;
interface Rect { x: number; y: number; w: number; h: number }
interface Overlay { id: string; phase: 'from' | 'open' | 'closing'; rect: Rect; settled: boolean }

// ---- 動畫參數（與設計稿一致）----
const T = {
  widenIn: '300ms cubic-bezier(0.3, 1.5, 0.45, 1)',       // 短訊息撐開（帶回彈）
  widenOut: '240ms cubic-bezier(0.3, 1.3, 0.5, 1)',       // 短訊息縮回（帶回彈）
  widenOutDelay: 150,                                      // 等按鈕收回後再縮短
  toolIn: '320ms cubic-bezier(0.3, 1.4, 0.5, 1)',         // 按鈕氣泡長出（帶回彈）
  toolInDelayWhenWiden: 110,                               // 需要撐開時，先撐開再長按鈕
  toolOut: '190ms cubic-bezier(0.5, 0, 0.8, 0.4)',        // 按鈕氣泡收回
  leaveHold: 420,                                          // 收回期間保留描邊與疊放順序
  ov: 340,                                                 // 討論串放大／縮回
  hl: 1200,                                                // 引用跳轉的高亮時間
};
const TOOL_BTN = 24;
const MSG_TOOL_PAD = 8;

let gooSeq = 0;
const nowIso = () => new Date().toISOString();
const newId = newCommentId;

// ---- 純資料操作（不可變更新）----
function findMsg(notes: CommentThread[], id: string): { msg: Msg; parent: CommentThread | null } | null {
  for (const n of notes) {
    if (n.id === id) return { msg: n, parent: null };
    for (const r of n.replies || []) if (r.id === id) return { msg: r, parent: n };
  }
  return null;
}
function patchMsg(notes: CommentThread[], id: string, patch: Partial<CommentReply>): CommentThread[] {
  return notes.map((n) => {
    if (n.id === id) return { ...n, ...patch } as CommentThread;
    if (!(n.replies || []).some((r) => r.id === id)) return n;
    return { ...n, replies: n.replies.map((r) => (r.id === id ? { ...r, ...patch } : r)) };
  });
}
function removeMsg(notes: CommentThread[], id: string): CommentThread[] {
  if (notes.some((n) => n.id === id)) return notes.filter((n) => n.id !== id);
  return notes.map((n) => ((n.replies || []).some((r) => r.id === id) ? { ...n, replies: n.replies.filter((r) => r.id !== id) } : n));
}

// ---- 圖示（沿用 Verso icons 風格：24 格線、線寬 2、圓角端點）----
const Svg = ({ children, size = 14, sw = 2 }: { children: ReactNode; size?: number; sw?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const ICheck = () => <Svg><path d="M5 12.5l4.5 4.5L19 7.5" /></Svg>;
const IUndo = () => <Svg><path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></Svg>;
const IReply = () => <Svg><path d="M20 5v6a4 4 0 0 1-4 4H5" /><path d="M9 11l-4 4 4 4" /></Svg>;
const IPenEdit = () => <Svg><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></Svg>;
const ITrash = () => <Svg><path d="M4 7h16" /><path d="M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13" /><path d="M9 7V4h6v3" /></Svg>;
const IChevL = () => <Svg size={15}><path d="M15 18l-6-6 6-6" /></Svg>;
const IArrowR = () => <Svg size={15} sw={2.2}><path d="M4 12h15M13 6l6 6-6 6" /></Svg>;
const IFile = () => <Svg size={13}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /></Svg>;
const IClose = () => (
  <svg width={11} height={11} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.4} aria-hidden="true"><path d="M1.5 1.5l9 9M10.5 1.5l-9 9" /></svg>
);
const IDots = () => (
  <svg width={13} height={13} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="18.5" cy="12" r="2" /></svg>
);

export function CommentsPanel({ entryKey, srcNotes = [], notes, me, onChange, ensureName, readOnly = false }: CommentsPanelProps) {
  const formatNow = nowIso;
  const gooId = useMemo(() => 'vgoo' + ++gooSeq, []);
  const rootRef = useRef<HTMLDivElement>(null);
  const mList = useRef<HTMLDivElement>(null);
  const tList = useRef<HTMLDivElement>(null);
  const mArea = useRef<HTMLDivElement>(null);
  const tArea = useRef<HTMLDivElement>(null);
  const mInput = useRef<HTMLTextAreaElement>(null);
  const tInput = useRef<HTMLTextAreaElement>(null);

  const [ov, setOv] = useState<Overlay | null>(null);
  const [hover, setHover] = useState<string | null>(null);   // 'main:id' | 'thread:id'
  const [leaving, setLeaving] = useState<string | null>(null);
  const [natW, setNatW] = useState<Record<string, number>>({});
  const [tabHot, setTabHot] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [confirmPos, setConfirmPos] = useState<{ x: number; y: number } | null>(null);
  const [hl, setHl] = useState<string | null>(null);
  const [fade, setFade] = useState<string | null>(null);
  const [openResolved, setOpenResolved] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<Record<Layer, string>>({ main: '', thread: '' });
  const [quote, setQuote] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ layer: Layer; id: string } | null>(null);

  const pending = useRef<{ focus?: Layer; scrollTo?: string; mainBottom?: boolean; threadBottom?: boolean }>({});
  const timers = useRef<number[]>([]);
  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // 切換條目時重置（父層也建議用 key={entryKey}）
  useEffect(() => {
    setOv(null); setHover(null); setLeaving(null); setArmed(null); setHl(null); setFade(null);
    setOpenResolved({}); setDraft({ main: '', thread: '' }); setQuote(null); setEdit(null);
  }, [entryKey]);

  const thread = ov ? notes.find((n) => n.id === ov.id) || null : null;
  useEffect(() => { if (ov && !thread) setOv(null); }, [ov, thread]);

  // ---- 座標換算（考慮外層縮放）----
  const relRect = useCallback((el: Element): Rect => {
    const root = rootRef.current!;
    const rr = root.getBoundingClientRect();
    const sc = rr.width / root.offsetWidth || 1;
    const r = el.getBoundingClientRect();
    return { x: (r.left - rr.left) / sc - 1, y: (r.top - rr.top) / sc - 1, w: r.width / sc, h: r.height / sc };
  }, []);

  // ---- 輸入框自動高度、列表底部留白（輸入框浮在列表上層）----
  useLayoutEffect(() => {
    ([[mInput.current, mArea.current, mList.current], [tInput.current, tArea.current, tList.current]] as const).forEach(([el, area, list]) => {
      if (el) { el.style.height = '32px'; el.style.height = Math.max(32, Math.min(110, el.scrollHeight + 2)) + 'px'; }
      if (area && list) {
        const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 6;
        const pb = area.offsetHeight + 8 + 'px';
        if (list.style.paddingBottom !== pb) { list.style.paddingBottom = pb; if (atBottom) list.scrollTop = list.scrollHeight; }
      }
    });
    const p = pending.current;
    if (p.focus) { (p.focus === 'thread' ? tInput.current : mInput.current)?.focus(); p.focus = undefined; }
    if (p.scrollTo) {
      rootRef.current?.querySelector('#vt-' + CSS.escape(p.scrollTo))?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      p.scrollTo = undefined;
    }
    if (p.mainBottom && mList.current) { mList.current.scrollTop = mList.current.scrollHeight; p.mainBottom = false; }
    if (p.threadBottom && tList.current) { tList.current.scrollTop = tList.current.scrollHeight; p.threadBottom = false; }
  });

  // ---- 討論串放大／縮回 ----
  const openThread = (id: string, fromEl: Element | null, focusInput = false) => {
    if (!rootRef.current) return;
    const rect = fromEl ? relRect(fromEl) : { x: 0, y: 0, w: rootRef.current.clientWidth, h: 40 };
    setHover(null); setArmed(null); setQuote(null);
    setEdit((e) => (e && e.layer === 'thread' ? null : e));
    setDraft((d) => ({ ...d, thread: '' }));
    setOv({ id, phase: 'from', rect, settled: false });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      setOv((o) => (o && o.id === id ? { ...o, phase: 'open' } : o));
      pending.current.threadBottom = true;
      if (focusInput) pending.current.focus = 'thread';
      later(() => setOv((o) => (o && o.id === id && o.phase === 'open' ? { ...o, settled: true } : o)), T.ov + 40);
    }));
  };
  const closeThread = () => {
    if (!ov) return;
    const target = rootRef.current?.querySelector(`[data-bub="vm-${CSS.escape(ov.id)}"]`);
    const rect = target ? relRect(target) : { x: 8, y: 8, w: 40, h: 20 };
    setQuote(null); setHover(null); setArmed(null);
    setEdit((e) => (e && e.layer === 'thread' ? null : e));
    setOv({ ...ov, phase: 'closing', rect, settled: false });
    later(() => setOv((o) => (o && o.phase === 'closing' ? null : o)), T.ov + 20);
  };

  // ---- 引用跳轉 ----
  const jump = (id: string) => {
    const f = findMsg(notes, id);
    if (!f) return;
    if (f.msg.resolved) setOpenResolved((o) => ({ ...o, [id]: true }));
    setHl(id);
    pending.current.scrollTo = id;
    later(() => { setHl((h) => (h === id ? null : h)); setFade(id); later(() => setFade((x) => (x === id ? null : x)), 700); }, T.hl);
  };

  // ---- 單則訊息 ----
  const renderBubble = (m: Msg, o: { layer: Layer; tab?: boolean; noDelete?: boolean; dim?: boolean; first?: boolean; onReply: (el: Element | null) => void }) => {
    const key = o.layer + ':' + m.id;
    const mine = m.author === me;
    const resolved = !!m.resolved;
    const dim = resolved || !!o.dim;
    const show = hover === key;
    const isLeaving = !show && leaving === key;
    const isArmed = armed === key;
    const q = 'quoteId' in m && m.quoteId ? findMsg(notes, m.quoteId) : null;
    const replies = 'replies' in m ? m.replies || [] : [];
    const hasTab = !!o.tab && replies.length > 0;
    const canEdit = mine;                 // 只能編輯自己的訊息
    const canDelete = !o.noDelete;        // 任何人的訊息都能刪（討論串最上層那則除外）
    const toolW = (2 + (canEdit ? 1 : 0) + (canDelete ? 1 : 0)) * TOOL_BTN + MSG_TOOL_PAD;
    const need = natW[key] ? Math.max(0, toolW + 12 - natW[key]) : 0;  // 短訊息需要撐開的寬度
    const ext = show ? need : 0;
    const wTr = show ? T.widenIn : `${T.widenOut} ${need ? T.widenOutDelay : 0}ms`;
    const tDelay = show && need ? T.toolInDelayWhenWiden : 0;
    const bg = hl === m.id && o.layer === 'thread' ? 'var(--bubhl)' : dim ? 'var(--bubd)' : 'var(--bubo)';
    const radius = hasTab ? (mine ? '12px 12px 0 12px' : '12px 12px 12px 0') : mine ? '12px 12px 4px 12px' : '12px 12px 12px 4px';
    const shapeTr = `left ${wTr}, right ${wTr}` + (hl === m.id || fade === m.id ? ', background-color 600ms ease-out' : '');
    const toolTf = show ? 'translateY(0) scale(1)' : 'translateY(18px) scale(0.35)';
    const domId = (o.layer === 'main' ? 'vm-' : 'vt-') + m.id;

    const hoverIn = (e: { currentTarget: HTMLElement }) => {
      if (hover === key) return;
      const w = e.currentTarget.offsetWidth;
      setNatW((n) => (n[key] === w ? n : { ...n, [key]: w }));
      setHover(key); setArmed(null);
    };
    const hoverOut = () => {
      if (hover !== key) return;
      setHover(null); setArmed(null); setLeaving(key);
      later(() => setLeaving((l) => (l === key ? null : l)), T.leaveHold);
    };
    const onDelete = (e: RMouseEvent) => {
      if (!isArmed) {
        setArmed(key);
        const root = rootRef.current;
        if (root) {
          const rr = root.getBoundingClientRect();
          const sc = rr.width / root.offsetWidth || 1;
          const x = (e.clientX - rr.left) / sc + 12, y = (e.clientY - rr.top) / sc - 34;
          setConfirmPos({ x: Math.round(Math.max(4, Math.min(root.offsetWidth - 104, x))), y: Math.round(Math.max(4, y)) });
        }
        return;
      }
      if (edit && edit.id === m.id) { setDraft((d) => ({ ...d, [edit.layer]: '' })); setEdit(null); }
      if (quote === m.id) setQuote(null);
      setArmed(null); setHover(null);
      onChange(removeMsg(notes, m.id));
    };

    return (
      <div key={domId} className="vc-row" style={{ zIndex: show || isLeaving ? 5 : 1, justifyContent: mine ? 'flex-end' : 'flex-start', marginTop: o.first ? 22 : 0 }}>
        <div id={domId} data-bub={domId} className="vc-bub" onPointerEnter={hoverIn} onPointerLeave={hoverOut} onFocus={hoverIn}
          style={{ minWidth: hasTab ? 72 : 0, paddingBottom: hasTab ? 20 : 0 }}>
          {/* 黏土效果層：本體、刪節號延伸、按鈕氣泡三個形狀經過 goo 濾鏡融成一體 */}
          <div className="vc-goo" aria-hidden="true" style={{ filter: `url(#${gooId}${show || isLeaving ? 'H' : ''})` }}>
            <div className="vc-shape" style={{ left: 14 - (mine ? ext : 0), right: 14 - (mine ? 0 : ext), top: 40, bottom: hasTab ? 34 : 14, borderRadius: radius, background: bg, transition: shapeTr }} />
            {hasTab && (
              <div className="vc-shape" style={{ bottom: 14, [mine ? 'right' : 'left']: 14, width: 46, height: 26, borderRadius: mine ? '0 0 4px 10px' : '0 0 10px 4px', background: bg }} />
            )}
            <div className="vc-shape" style={{ top: 14, [mine ? 'right' : 'left']: 20, width: toolW, height: 28, borderRadius: 14, background: bg, transform: toolTf, transformOrigin: '50% 100%',
              transition: show ? `transform ${T.toolIn} ${tDelay}ms` : `transform ${T.toolOut}` }} />
          </div>
          {/* 撐開後的整塊判定區（避免文字滑走後留下空隙導致反覆進出） */}
          <span aria-hidden="true" className="vc-hit" style={{ bottom: hasTab ? 20 : 0, left: mine ? -ext : 0, right: mine ? 0 : -ext }} />

          <div className="vc-body" style={{ transform: `translateX(${mine ? -ext : ext}px)`, transition: `transform ${wTr}` }}>
            <span className="vc-meta">{[mine ? '' : m.author, formatTime(m.time), m.edited ? tx('cm.edited') : '', resolved ? tx('cm.resolved') : ''].filter(Boolean).join(' · ')}</span>
            {'quoteId' in m && m.quoteId && (
              <button type="button" className="vc-quote" onClick={() => q && jump(m.quoteId!)} aria-label={q ? tx('cm.jumpQuote', { name: q.msg.author }) : tx('cm.quoteGone')}>
                <span className="vc-quote-a">{q ? q.msg.author : tx('cm.quoteLabel')}</span>
                <span className="vc-quote-t">{q ? q.msg.text : tx('cm.quoteGone')}</span>
              </button>
            )}
            <span className="vc-text" style={{ color: dim ? 'var(--mute2)' : 'var(--text)' }}>{m.text}</span>
          </div>

          {hasTab && (
            <button type="button" className="vc-tab" title={tx('cm.openThread')} aria-label={tx('cm.openThreadN', { n: replies.length })}
              style={{ [mine ? 'right' : 'left']: 0, color: tabHot === key ? 'var(--text)' : 'var(--text2)' }}
              onPointerEnter={() => setTabHot(key)} onPointerLeave={() => setTabHot((t) => (t === key ? null : t))}
              onFocus={() => setTabHot(key)} onBlur={() => setTabHot((t) => (t === key ? null : t))}
              onClick={(e) => openThread(m.id, e.currentTarget.closest('[data-bub]'))}>
              <IDots /><span className="vc-count">{replies.length}</span>
            </button>
          )}

          <div role="toolbar" aria-label={tx('cm.tools')} className="vc-tools"
            style={{ [mine ? 'right' : 'left']: 6, width: toolW, opacity: show ? 1 : 0, visibility: show ? 'visible' : 'hidden', transform: toolTf,
              transition: show ? `transform ${T.toolIn} ${tDelay}ms, opacity 160ms ease ${tDelay + 60}ms, visibility 0s` : `transform ${T.toolOut}, opacity 130ms ease, visibility 0s linear 190ms` }}>
            <button type="button" className="vc-ib" title={resolved ? tx('cm.unresolve') : tx('cm.resolve')} aria-label={resolved ? tx('cm.unresolve') : tx('cm.resolve')}
              onClick={() => { if (resolved) setOpenResolved((x) => { const n = { ...x }; delete n[m.id]; return n; }); setHover(null); onChange(patchMsg(notes, m.id, { resolved: !resolved })); }}>
              {resolved ? <IUndo /> : <ICheck />}
            </button>
            <button type="button" className="vc-ib" title={tx('cm.reply')} aria-label={tx('cm.reply')} onClick={(e) => o.onReply(e.currentTarget.closest('[data-bub]'))}><IReply /></button>
            {canEdit && (
              <button type="button" className="vc-ib" title={tx('cm.edit')} aria-label={tx('cm.edit')}
                onClick={() => { setEdit({ layer: o.layer, id: m.id }); if (o.layer === 'thread') setQuote(null); setDraft((d) => ({ ...d, [o.layer]: m.text })); pending.current.focus = o.layer; }}>
                <IPenEdit />
              </button>
            )}
            {canDelete && (
              <button type="button" className={'vc-ib' + (isArmed ? ' armed' : '')} title={isArmed ? tx('cm.deleteAgain') : tx('cm.delete')} aria-label={isArmed ? tx('cm.deleteAgain') : tx('cm.delete')} onClick={onDelete}><ITrash /></button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderCollapsed = (m: Msg, layer: Layer) => {
    const n = 'replies' in m ? (m.replies || []).length : 0;
    const domId = (layer === 'main' ? 'vm-' : 'vt-') + m.id;
    return (
      <button key={domId} type="button" id={domId} data-bub={domId} className="vc-collapsed" aria-label={tx('cm.collapsedOpen', { name: m.author, text: m.text })}
        onClick={() => setOpenResolved((o) => ({ ...o, [m.id]: true }))}>
        <ICheck />
        <span className="vc-collapsed-t">{m.author}：{m.text}</span>
        {n > 0 && <span className="vc-count">{n}</span>}
      </button>
    );
  };

  // ---- 輸入框 ----
  const renderInput = (layer: Layer) => {
    const ed = edit && edit.layer === layer ? findMsg(notes, edit.id) : null;
    const qm = layer === 'thread' && quote ? findMsg(notes, quote) : null;
    const value = draft[layer];
    const send = async () => {
      const text = value.trim();
      if (!text || readOnly) return;
      if (!ed && !me && ensureName && !(await ensureName())) return;
      if (ed) {
        if (ed.msg.text !== text) onChange(patchMsg(notes, ed.msg.id, { text, edited: true }));
        setEdit(null);
      } else if (layer === 'thread' && thread) {
        const r: CommentReply = { id: newId(), author: me || (await ensureName?.()) || '?', time: formatNow(), text };
        if (quote && findMsg(notes, quote)) r.quoteId = quote;
        onChange(notes.map((n) => (n.id === thread.id ? { ...n, replies: [...(n.replies || []), r] } : n)));
        pending.current.threadBottom = true;
      } else if (layer === 'main') {
        onChange([...notes, { id: newId(), author: me || (await ensureName?.()) || '?', time: formatNow(), text, resolved: false, replies: [] }]);
        pending.current.mainBottom = true;
      }
      setDraft((d) => ({ ...d, [layer]: '' }));
      if (layer === 'thread') setQuote(null);
    };
    const cancel = () => {
      if (ed) setDraft((d) => ({ ...d, [layer]: '' }));
      setEdit((e) => (e && e.layer === layer ? null : e));
      if (layer === 'thread') setQuote(null);
    };
    const onKey = (e: RKeyboardEvent<HTMLTextAreaElement>) => {
      // 中文輸入法選字時的 Enter 不送出
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); void send(); }
      else if (e.key === 'Escape' && (ed || qm)) { e.preventDefault(); cancel(); }
    };
    const placeholder = ed ? tx('cm.phEdit') : layer === 'thread' ? tx('cm.phReply') : tx('cm.phNew');
    const id = 'vc-input-' + layer;
    return (
      <div ref={layer === 'thread' ? tArea : mArea} className="vc-input">
        {(ed || qm) && (
          <div className="vc-banner">
            <span className="vc-banner-body">
              <span className="vc-banner-title">{ed ? tx('cm.editing') : tx('cm.replyTo', { name: qm!.msg.author })}</span>
              <span className="vc-banner-text">{ed ? ed.msg.text : qm!.msg.text}</span>
            </span>
            <button type="button" className="vc-ib" onClick={cancel} aria-label={tx('cm.cancel')}><IClose /></button>
          </div>
        )}
        <div className="vc-input-row">
          <label htmlFor={id} className="vc-sr">{placeholder}</label>
          <textarea id={id} ref={layer === 'thread' ? tInput : mInput} rows={1} value={value} placeholder={placeholder} readOnly={readOnly}
            onChange={(e) => setDraft((d) => ({ ...d, [layer]: e.target.value }))} onKeyDown={onKey} />
          <button type="button" className="vc-send" onClick={() => void send()} disabled={!value.trim() || readOnly} aria-label={ed ? tx('cm.saveEdit') : tx('cm.send')} title={(ed ? tx('cm.saveEdit') : tx('cm.send')) + ' (Enter)'}>
            {ed ? <ICheck /> : <IArrowR />}
          </button>
        </div>
      </div>
    );
  };

  // ---- 主列表 ----
  const ordered = [...notes.filter((n) => !n.resolved), ...notes.filter((n) => n.resolved)];
  let firstDone = false;
  const mainItems = ordered.map((n) => {
    if (n.resolved && !openResolved[n.id]) return renderCollapsed(n, 'main');
    const first = !firstDone; firstDone = true;
    return renderBubble(n, { layer: 'main', tab: true, first, onReply: (el) => openThread(n.id, el, true) });
  });

  // ---- 討論串 ----
  let threadItems: ReactNode[] = [];
  if (thread) {
    threadItems.push(renderBubble(thread, { layer: 'thread', noDelete: true, first: true, onReply: () => {
      setQuote(null); setEdit((e) => (e && e.layer === 'thread' ? null : e)); pending.current.focus = 'thread';
    } }));
    if (thread.replies.length) {
      threadItems.push(
        <div key="divider" className="vc-divider"><span /><span className="vc-count">{thread.replies.length}</span><span /></div>
      );
    }
    thread.replies.forEach((r) => {
      if (r.resolved && !openResolved[r.id] && hl !== r.id) { threadItems.push(renderCollapsed(r, 'thread')); return; }
      threadItems.push(renderBubble(r, { layer: 'thread', dim: thread.resolved, onReply: () => {
        setQuote(r.id); setEdit((e) => (e && e.layer === 'thread' ? null : e)); pending.current.focus = 'thread';
      } }));
    });
  }

  // ---- 疊層幾何 ----
  const fw = rootRef.current ? rootRef.current.clientWidth : 0;
  const fh = rootRef.current ? rootRef.current.clientHeight : 0;
  const ovAnim = `left ${T.ov}ms cubic-bezier(0.2, 0.8, 0.2, 1), top ${T.ov}ms cubic-bezier(0.2, 0.8, 0.2, 1), width ${T.ov}ms cubic-bezier(0.2, 0.8, 0.2, 1), height ${T.ov}ms cubic-bezier(0.2, 0.8, 0.2, 1), border-radius ${T.ov}ms ease, background-color ${T.ov}ms ease, box-shadow ${T.ov}ms ease`;
  let ovStyle: CSSProperties = {};
  let ovContent: CSSProperties = {};
  if (ov) {
    const atRect = ov.phase !== 'open';
    ovStyle = atRect
      ? { left: ov.rect.x, top: ov.rect.y, width: ov.rect.w, height: ov.rect.h, borderRadius: '12px 12px 12px 4px', background: 'var(--bubo)', boxShadow: '0 4px 14px rgba(0,0,0,0.25)', transition: ovAnim }
      : { left: 0, top: 0, width: fw, height: fh, borderRadius: 7, background: 'var(--bg0)', boxShadow: 'none', transition: ov.settled ? 'none' : ovAnim };
    ovContent = { width: fw, height: fh, opacity: atRect ? 0 : 1, transition: atRect ? (ov.phase === 'closing' ? 'opacity 110ms ease' : 'none') : ov.settled ? 'none' : 'opacity 160ms ease 180ms' };
  }

  return (
    <div ref={rootRef} className="vc-root">
      <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }}>
        <defs>
          {/* 黏土／油滴效果：模糊後把透明度門檻拉高，相近的形狀會融合成平滑的一團 */}
          <filter id={gooId} x="-30%" y="-30%" width="160%" height="160%" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation="4.5" result="blur" />
            <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9" result="goo" />
          </filter>
          {/* 懸停時：同上，外加一圈與底色相同的描邊，蓋到上一則訊息時仍看得出邊界 */}
          <filter id={gooId + 'H'} x="-30%" y="-30%" width="160%" height="160%" colorInterpolationFilters="sRGB">
            <feGaussianBlur in="SourceGraphic" stdDeviation="4.5" result="blur" />
            <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9" result="goo" />
            <feMorphology in="goo" operator="dilate" radius="2.5" result="dil" />
            <feFlood style={{ floodColor: 'var(--bg0)' }} result="fl" />
            <feComposite in="fl" in2="dil" operator="in" result="ring" />
            <feMerge><feMergeNode in="ring" /><feMergeNode in="goo" /></feMerge>
          </filter>
        </defs>
      </svg>

      <div ref={mList} className="vc-list">
        {srcNotes.filter((x) => x.text.trim()).map((x) => (
          <div key={x.name} className="vc-src"><IFile /><span><span className="vc-src-l">{x.name}</span><span className="vc-src-t">{x.text}</span></span></div>
        ))}
        {notes.length === 0 && <div className="vc-empty">{tx('cm.empty')}</div>}
        {mainItems}
      </div>
      {renderInput('main')}

      {ov && (
        <div className="vc-ov" style={ovStyle}>
          <div className="vc-ov-in" style={ovContent}>
            <div className="vc-ov-head">
              <button type="button" className="vc-ib vc-back" onClick={closeThread} aria-label={tx('cm.backList')} title={tx('cm.back')}><IChevL />{tx('cm.thread')}</button>
              <button type="button" className="vc-ib" onClick={() => thread && onChange(patchMsg(notes, thread.id, { resolved: !thread.resolved }))}
                aria-label={thread?.resolved ? tx('cm.unresolve') : tx('cm.resolve')} title={thread?.resolved ? tx('cm.unresolve') : tx('cm.resolve')}>
                {thread?.resolved ? <IUndo /> : <ICheck />}
              </button>
            </div>
            <div ref={tList} className="vc-list">{threadItems}</div>
            {renderInput('thread')}
          </div>
        </div>
      )}

      {armed && confirmPos && (
        <div role="status" className="vc-confirm" style={{ left: confirmPos.x, top: confirmPos.y }}>{tx('cm.clickAgain')}</div>
      )}
    </div>
  );
}

