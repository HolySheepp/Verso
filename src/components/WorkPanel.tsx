import { tx } from '../i18n';
import { MAX_CELL_CHARS } from '../model/names';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Splitter } from './Splitter';
import { FinishLine } from './FinishLine';
import { TextMarks, type MarkRange } from './TextMarks';
import { useCurrentHits } from '../state/dictHits';
import { locateIssues } from '../model/checks';
import { effectiveStd } from '../model/length';
import { STAMP_EXCLUDE, currentOf, currentStamp, useStore, useStorePick, visibleIssues } from '../state/store';
import { markName, markVisual } from '../model/marks';
import { keyOf, type ActionId } from '../model/shortcuts';
import type { Mode } from '../model/types';
import { MarkIcon } from './MarkIcon';
import { MarkMenu } from './MarkMenu';
import { ContextMenu } from './ContextMenu';
import { applyChange, applyOne, compose, editsOf, removeOne, spansOf, type VEdit } from '../model/verify';
import { verifySession } from '../state/verifySession';
import { shortcutsBlocked } from './Shortcuts';
import { srcDiff } from '../model/srcUpdate';
import { fz } from '../model/fonts';
import {
  IconWarn, IconCopyPair, IconRuler,
  IconBraces, IconCheck, IconChevL, IconChevR, IconCopy, IconEraser, IconEye, IconFeather, IconLock, IconPen, IconUse,
} from './icons';

const MODE_HINTS: Record<Mode, string> = {
  get translate() { return tx('work.001'); },
  get verify() { return tx('work.002'); },
  get view() { return tx('work.003'); },
  get source() { return tx('work.004'); },
};

const labelRow: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 18 };
const meta: React.CSSProperties = { display: 'flex', gap: 12, fontSize: fz(11.5), color: 'var(--mute)' };
const smallBtn: React.CSSProperties = { flexShrink: 0, height: 20, padding: '0 8px', background: 'transparent', border: '1px solid var(--line4)', borderRadius: 5, color: 'var(--text2)', fontSize: fz(11) };
const NO_EDITS: VEdit[] = [];

/** 找出滑鼠底下的標記（沒有寬度的小標記左右放寬一點） */
function markUnder(box: HTMLElement | null | undefined, selector: string, x: number, y: number): HTMLElement | null {
  let found: HTMLElement | null = null;
  box?.querySelectorAll<HTMLElement>(selector).forEach((m) => {
    if (found) return;
    const pad = m.classList.contains('tm-gap') ? 5 : 0;
    for (const r of Array.from(m.getClientRects())) {
      if (x >= r.left - pad && x <= r.right + pad && y >= r.top && y <= r.bottom) { found = m; break; }
    }
  });
  return found;
}

/** 工作欄最矮的高度 */
export const WORK_MIN = 220;

/**
 * 工作欄。height 是使用者拉的高度，當作最小高度；框放不下內容時工作欄會長高（最高到 maxH）。
 * 頁簽清空、沒有條目時，只留空白的框。
 */
export function WorkPanel({ height, maxH }: { height: number; maxH: number }) {
  const hasEntry = useStore((s) => !!currentOf(s).entry);
  const set = useStore((s) => s.set);
  if (!hasEntry) {
    return (
      <>
        <Splitter dir="h" label={tx('work.005')} value={height} min={WORK_MIN} max={maxH} onChange={(v) => set({ workH: v })} />
        <section aria-label={tx('work.006')} style={{ height, flexShrink: 0, boxSizing: 'border-box', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10 }} />
      </>
    );
  }
  return <WorkPanelInner height={height} maxH={maxH} />;
}

/** 每個框上次量到的高度，和量的時候的內容、寬度、字體 */
const measured = new WeakMap<HTMLTextAreaElement, { key: string; h: number }>();

function WorkPanelInner({ height, maxH }: { height: number; maxH: number }) {
  // 只訂閱這個區塊用到的資料（包含 currentOf 等輔助函式間接用到的）
  const s = useStorePick('project', 'file', 'sheetBy', 'selBy', 'mode', 'finishLine', 'beginEdit', 'endEdit', 'stampOpen', 'stamps', 'viewOn', 'peek', 'history', 'shortcuts', 'reported', 'checkSettings', 'set', 'updateEntry', 'record', 'useShownSlot', 'stampNext', 'skipCheck', 'prev', 'pickSlot', 'next', 'mainNext', 'setVerify', 'applyNewSource');
  const project = s.project!;
  const { sheet, sel, entry } = currentOf(s);
  const cur = entry!;
  const [tgtEl, setTgtEl] = useState<HTMLTextAreaElement | null>(null);
  const [srcEl, setSrcEl] = useState<HTMLTextAreaElement | null>(null);
  // 目前這一條原文命中的字典詞（只算這一條）
  const hits = useCurrentHits();
  // 滑鼠停在原文框的哪個命中詞上：只有那一段畫底色，並在滑鼠旁顯示譯名
  const [hover, setHover] = useState<{ hit: number; span: number; x: number; y: number } | null>(null);
  const hitRanges = useMemo<MarkRange[]>(() => hits.flatMap((h, i) => h.spans.map((sp, j) => ({
    ...sp, kind: 'hit' as const, ref: i * 1000 + j, on: hover?.hit === i && hover.span === j,
  }))), [hits, hover?.hit, hover?.span]);
  const total = sheet.entries.length;
  const mode = s.mode;
  const customs = project.customMarks;
  const issues = visibleIssues(cur, s.reported, s.checkSettings, currentOf(s).fileDoc.lengthStd);
  const issueText = issues.map((i) => i.msg).join(tx('common.sep'));

  const hist = s.history.byEntry[cur.uid];
  const texts = hist?.texts ?? [];
  const slot = hist ? hist.slot : -1;
  const viewOn = s.viewOn && texts.length > 0;
  const showHist = (viewOn || s.peek) && texts.length > 0;

  const srcEditable = mode === 'source';
  const verify = mode === 'verify';
  // 驗證模式不直接改譯文框，在下面的修改框改
  const tgtEditable = mode === 'translate';
  // 能不能放進字典詞：翻譯模式放進譯文框，驗證模式放進修改框
  const canInsert = (verify || tgtEditable) && !showHist;
  // 記錄與查看修改：翻譯模式在譯文框，驗證模式在修改框
  const tgtHist = showHist && !verify;
  const modHist = showHist && verify;

  // 驗證修改：每組修改在譯文框和修改框的位置。翻譯模式打開驗證過的條目時也顯示，讓譯者處理
  const edits = verify || mode === 'translate' ? editsOf(cur) : NO_EDITS;
  const showEdits = verify || edits.length > 0;
  const spans = useMemo(() => spansOf(edits), [edits]);
  const modText = useMemo(() => compose(cur.tgt, edits), [cur.tgt, edits]);
  const [modEl, setModEl] = useState<HTMLTextAreaElement | null>(null);
  // 滑鼠停在哪一組上、正在編輯哪一組（用這組在譯文的起點認）
  const [vHover, setVHover] = useState<number | null>(null);
  const [vActive, setVActive] = useState<string | null>(null);
  const [vMenu, setVMenu] = useState<{ x: number; y: number; i: number } | null>(null);
  const dirty = useRef(false);

  // 原文更新：平常顯示新原文（改過的地方畫底線），按住按鈕或快捷鍵（預設 Ctrl+Shift+D）才看舊原文；按「套用新原文」才真的換掉
  const newSrc = cur.upd?.src;
  const [btnPeek, setSrcPeek] = useState(false);
  const keyPeek = useStore((st) => st.srcPeek);
  const srcPeek = btnPeek || keyPeek;
  useEffect(() => { setSrcPeek(false); }, [cur.uid]);
  const showNewSrc = newSrc !== undefined && !srcPeek;
  const srcDiffRanges = useMemo<MarkRange[]>(
    () => (showNewSrc ? srcDiff(cur.src, newSrc!).map((r) => ({ ...r, kind: 'edit' as const })) : []),
    [showNewSrc, cur.src, newSrc],
  );

  // 框的高度跟內容走：量出每個框放下全部內容要多高
  const sectionRef = useRef<HTMLElement>(null);
  const [boxH, setBoxH] = useState({ src: 42, tgt: 42, mod: 42 });
  const [actualH, setActualH] = useState(height);
  const [widthVer, bump] = useState(0);
  const fonts = useStore((st) => st.fonts);
  useLayoutEffect(() => {
    // 只量內容、寬度或字體有變的框：每次都量會強制整頁重新排版，打字會卡
    const layoutKey = widthVer + '|' + JSON.stringify(fonts) + '|';
    const m = (ta: HTMLTextAreaElement | null) => {
      if (!ta) return 42;
      const key = layoutKey + ta.value;
      const known = measured.get(ta);
      if (known && known.key === key) return known.h;
      const prev = ta.style.height;
      ta.style.height = '0px';
      const cs = getComputedStyle(ta);
      const h = ta.scrollHeight + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
      ta.style.height = prev;
      measured.set(ta, { key, h: Math.ceil(h) });
      return Math.ceil(h);
    };
    const next = { src: m(srcEl), tgt: m(tgtEl), mod: m(modEl) };
    setBoxH((o) => (o.src === next.src && o.tgt === next.tgt && o.mod === next.mod ? o : next));
    const h = sectionRef.current?.offsetHeight;
    if (h && h !== actualH) setActualH(h);
  });
  // 寬度變了（換行跟著變）就重新量
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    let w = el.clientWidth;
    const ro = new ResizeObserver(() => { if (el.clientWidth !== w) { w = el.clientWidth; bump((n) => n + 1); } });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // 內容少時多出來的空間給哪個框：驗證模式給修改框，原文修正模式給原文框，其他給譯文框
  const growKey: keyof typeof boxH = mode === 'verify' ? 'mod' : mode === 'source' ? 'src' : 'tgt';
  // 原文框右邊有原文更新的兩個按鈕時，框至少要放得下它們
  const srcButtons = (cur.upd?.src !== undefined ? 1 : 0) + (cur.upd?.removed || cur.upd?.src !== undefined ? (mode === 'view' ? 0 : 1) : 0);
  const srcToolH = srcButtons ? 14 + srcButtons * 26 : 0;
  const boxStyle = (k: keyof typeof boxH): React.CSSProperties => {
    const h = k === 'src' ? Math.max(boxH.src, srcToolH) : boxH[k];
    return { position: 'relative', display: 'flex', flex: `${growKey === k ? 1 : 0} 1 ${h}px`, minHeight: Math.min(h, k === 'src' && srcToolH ? srcToolH : 42) };
  };
  // 修改框出現時加在上面，工作欄跟著變高；離開有修改的條目就回到使用者拉的高度。
  // 翻譯模式在有修改的條目上拉的高度只是暫時的。
  const modBlock = showEdits ? 36 + boxH.mod : 0;
  const [tempH, setTempH] = useState<number | null>(null);
  useEffect(() => { if (!showEdits) setTempH(null); }, [showEdits]);
  const minH = Math.min(maxH, tempH ?? height + modBlock);
  const onDrag = (v: number) => {
    if (mode === 'translate' && showEdits) setTempH(v);
    else if (verify) { setTempH(null); s.set({ workH: Math.max(WORK_MIN, v - modBlock) }); }
    else s.set({ workH: v });
  };

  // 標記並下一條：各模式分別記住選的標記
  const exclude = STAMP_EXCLUDE[mode];
  const stamp = currentStamp(s);
  // 懸停提示：只顯示快捷鍵本身
  const keyTip = (a: ActionId, ctx: 'input' | 'list' = 'input') => keyOf(s.shortcuts, ctx, a) || undefined;
  const stampLabel = tx('work.007', { v1: markName(customs, stamp) });

  const press = useRef<{ t: number } | null>(null);

  // 復原：輸入框裡逐字撤回；離開輸入框時，這段編輯在條目欄算一步
  const editFocus = () => s.beginEdit();
  const editBlur = (ev: React.FocusEvent<HTMLTextAreaElement>) => {
    s.endEdit();
    // 清掉輸入框自己的撤回紀錄：離開再回來後，Ctrl+Z 不會撤回上一段編輯
    const ta = ev.currentTarget, v = ta.value;
    ta.value = '';
    ta.value = v;
  };
  // 在輸入框裡換到別條（例如 Alt+↓）：前一條的編輯先結束，新的一條重新開始
  const editUid = useRef(cur.uid);
  useEffect(() => {
    if (editUid.current === cur.uid) return;
    editUid.current = cur.uid;
    const a = document.activeElement;
    if (a && (a.id === 'verso-target' || a.id === 'verso-source' || a.id === 'verso-edit')) { s.endEdit(); s.beginEdit(); }
    dirty.current = false; verifySession.dirty = false; verifySession.undoToSheet = false;
    setVActive(null); setVHover(null); setVMenu(null);
  }, [cur.uid]);

  /** 確定修改框裡這次的修改：高亮消失，Ctrl+Z 改成撤回整次修改 */
  const commitEdit = () => {
    if (!dirty.current) return;
    dirty.current = false; verifySession.dirty = false;
    setVActive(null);
    s.endEdit();
    const ta = modEl;
    if (ta && document.activeElement === ta) {
      s.beginEdit();
      // 清掉輸入框自己的撤回紀錄
      const v = ta.value, a = ta.selectionStart, b = ta.selectionEnd;
      ta.value = ''; ta.value = v; ta.setSelectionRange(a, b);
    }
  };
  verifySession.commit = commitEdit;
  const modBlur = (ev: React.FocusEvent<HTMLTextAreaElement>) => {
    dirty.current = false; verifySession.dirty = false;
    setVActive(null);
    editBlur(ev);
  };
  useEffect(() => () => { verifySession.dirty = false; verifySession.commit = () => {}; }, []);

  /** 修改框的內容變了：算出改到哪一組 */
  const onModValue = (value: string, caret: number) => {
    const e = currentOf(useStore.getState()).entry;
    if (!e) return;
    const ed = editsOf(e);
    const r = applyChange(e.tgt, ed, compose(e.tgt, ed), value, caret);
    dirty.current = true; verifySession.dirty = true;
    setVActive(r.active || null);
    s.setVerify(r.edits);
  };

  /** 重新編輯某一組：游標放進修改框，選取這組修改後的內容 */
  const editGroup = (i: number) => {
    const sp = spans[i];
    if (!sp || !modEl) return;
    modEl.focus();
    modEl.setSelectionRange(sp.ms, sp.me);
    setVActive(sp.id);
  };
  /**
   * 套用、忽略、全部套用這類一次完成的動作：自己算一步，不併進正在輸入的那段編輯。
   * 之後在譯文框按 Ctrl+Z 會撤回這一步（直到再打字為止）。
   */
  const asStep = (fn: () => void) => {
    commitEdit();
    const a = document.activeElement as HTMLTextAreaElement | null;
    const inWork = !!a && (a.id === 'verso-target' || a.id === 'verso-edit');
    s.endEdit();
    fn();
    if (inWork) {
      s.beginEdit();
      const v = a.value; a.value = ''; a.value = v;
    }
    verifySession.undoToSheet = true;
  };
  const applyGroup = (i: number) => {
    const sp = spans[i];
    if (!sp) return;
    asStep(() => { const r = applyOne(cur.tgt, edits, sp.id); s.setVerify(r.edits, r.tgt); });
  };
  /** 驗證模式「使用此內容」：把記錄的內容當成修改套進修改框 */
  const useSlotAsEdit = () => {
    const t = texts[slot];
    if (t === undefined) return;
    asStep(() => { const r = applyChange(cur.tgt, edits, modText, t); s.setVerify(r.edits); });
    s.set({ viewOn: false, peek: false });
  };
  const removeGroup = (i: number) => { const sp = spans[i]; if (sp) asStep(() => s.setVerify(removeOne(edits, sp.id))); };

  // 滑鼠移到任一框的修改上：兩邊對應的部分一起高亮
  const vFrame = useRef(0);
  const onVMove = (ev: React.MouseEvent<HTMLTextAreaElement>) => {
    if (!spans.length) return;
    const { clientX, clientY } = ev;
    const box = ev.currentTarget.parentElement;
    if (vFrame.current) return;
    vFrame.current = requestAnimationFrame(() => {
      vFrame.current = 0;
      const m = markUnder(box, 'mark.tm-edit, mark.tm-gap', clientX, clientY);
      const i = m ? Number(m.dataset.ref) : null;
      setVHover((h) => (h === i ? h : i));
    });
  };
  const onVLeave = () => { cancelAnimationFrame(vFrame.current); vFrame.current = 0; setVHover(null); };
  // 驗證模式：點譯文框裡的修改到修改框重新編輯；點修改框裡的修改，游標照常放，這組高亮
  // 翻譯模式：點任一框的修改就套用
  const onTgtDown = (ev: React.MouseEvent) => {
    if (!showEdits || ev.button !== 0 || vHover === null) return;
    ev.preventDefault();
    if (verify) editGroup(vHover);
    else { applyGroup(vHover); setVHover(null); }
  };
  const onModDown = (ev: React.MouseEvent) => {
    // 點修改框的別處：先確定剛才的修改（高亮消失，只留底線）
    if (ev.button === 0 && verify) commitEdit();
    if (ev.button !== 0 || vHover === null || !spans[vHover]) return;
    if (!verify) { ev.preventDefault(); applyGroup(vHover); setVHover(null); return; }
    setVActive(spans[vHover].id);
  };
  const onVMenu = (ev: React.MouseEvent) => {
    if (!showEdits || vHover === null) return;
    ev.preventDefault();
    commitEdit();
    setVMenu({ x: ev.clientX, y: ev.clientY, i: vHover });
  };
  const isOn = (i: number) => vHover === i || (vActive !== null && spans[i].id === vActive);
  const tgtEditRanges: MarkRange[] = spans.map((sp, i) => ({ start: sp.s, end: sp.e, kind: 'edit', ref: i, on: isOn(i) }));
  const modRanges: MarkRange[] = spans.map((sp, i) => ({ start: sp.ms, end: sp.me, kind: 'edit', ref: i, on: isOn(i) }));

  const onTarget = (v: string) => {
    if (!tgtEditable || showHist) return;
    // 改到修改的部分：那組修改算處理過了（顯示時自動移除，在輸入框 Ctrl+Z 改回來就又出現）
    verifySession.undoToSheet = false;
    s.updateEntry({ tgt: v });
  };

  // 問題的位置：只標畫面上正在顯示的問題
  const issueRanges = useMemo<MarkRange[]>(
    // 有修改框時檢查的是修改框的內容，問題也標在修改框
    () => (issues.length ? locateIssues(showEdits ? modText : cur.tgt, new Set(issues.map((x) => x.check))).map((r) => ({ ...r, kind: 'issue' as const })) : []),
    [issues, cur.tgt, modText, showEdits],
  );

  /**
   * 把譯名放進譯文框的游標位置；有框選文字就取代。
   * 用瀏覽器的插入文字指令，輸入框裡按 Ctrl+Z 可以撤回。
   */
  const insertTerm = (en: string) => {
    const { tgtEl: ta, onTarget: put, ok } = altRef.current;
    if (!ta || !ok) return;
    const a = ta.selectionStart, b = ta.selectionEnd;
    ta.focus();
    ta.setSelectionRange(a, b);
    if (document.execCommand('insertText', false, en)) return;
    put(ta.value.slice(0, a) + en + ta.value.slice(b), a + en.length);
    requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = a + en.length; });
  };

  // 滑鼠在原文框上移動：找出底下是哪個命中詞
  const moveFrame = useRef(0);
  const onSrcMove = (ev: React.MouseEvent) => {
    if (!hits.length) return;
    const { clientX, clientY } = ev;
    if (moveFrame.current) return;
    moveFrame.current = requestAnimationFrame(() => {
      moveFrame.current = 0;
      findHover(clientX, clientY);
    });
  };
  const findHover = (clientX: number, clientY: number) => {
    const ev = { clientX, clientY };
    const box = srcEl?.parentElement;
    let found: { hit: number; span: number } | null = null;
    box?.querySelectorAll<HTMLElement>('mark.tm-hit').forEach((m) => {
      if (found) return;
      for (const r of Array.from(m.getClientRects())) {
        if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) {
          const ref = Number(m.dataset.ref);
          found = { hit: Math.floor(ref / 1000), span: ref % 1000 };
          break;
        }
      }
    });
    const f = found as { hit: number; span: number } | null;
    // 同一個詞上移動：只更新提示框位置；離開命中詞時才清掉
    setHover((h) => (!f ? (h ? null : h) : { ...f, x: ev.clientX, y: ev.clientY }));
  };
  // 點命中詞：和快捷鍵一樣插入譯名（譯文框不能編輯時照一般的點擊）
  const onSrcDown = (ev: React.MouseEvent) => {
    if (ev.button !== 0 || !hover || !altRef.current.ok) return;
    const hit = hits[hover.hit];
    if (!hit) return;
    ev.preventDefault();
    insertTerm(hit.term.en);
  };
  useEffect(() => { setHover(null); }, [cur.uid]);

  // Alt+1、Alt+2…：把原文第幾個命中詞的譯名放進譯文框；有框選文字就取代
  const putText = (v: string, caret: number) => (verify ? onModValue(v, caret) : onTarget(v));
  const altRef = useRef({ hits, tgtEl: verify ? modEl : tgtEl, onTarget: putText, ok: canInsert });
  altRef.current = { hits, tgtEl: verify ? modEl : tgtEl, onTarget: putText, ok: canInsert };
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (!ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey || !/^Digit[1-9]$/.test(ev.code)) return;
      if (shortcutsBlocked()) return;
      const hit = altRef.current.hits[Number(ev.code.slice(5)) - 1];
      ev.preventDefault();
      if (hit) insertTerm(hit.term.en);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 整段貼上（貼上的內容取代全部譯文）時，先記下貼上前的譯文
  const onPaste = (ev: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!tgtEditable || showHist) return;
    const ta = ev.currentTarget;
    const txt = ev.clipboardData.getData('text');
    const whole = ta.selectionStart === 0 && ta.selectionEnd === ta.value.length;
    if (whole && txt && cur.tgt && txt !== cur.tgt) s.record(cur.tgt);
  };

  const issueNote = issues.length > 0 && (
    <span role="status" style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, fontSize: fz(11.5), color: 'var(--warntx)' }}>
      <IconWarn size={12} sw={2.2} style={{ flexShrink: 0 }} />
      <span title={issueText} style={{ minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{issueText}</span>
      <button type="button" className="ib" onClick={() => s.skipCheck()} style={smallBtn}>{tx('work.008')}</button>
    </span>
  );

  const viewTip = viewOn ? tx('work.009') : texts.length ? tx('work.010') : tx('work.011');

  /** 記錄、查看修改的按鈕與記錄槽位：翻譯模式放在譯文框，驗證模式放在修改框 */
  const histUI = (
    <>
            <div role="toolbar" aria-label={tx('work.012')} aria-orientation="vertical" style={{ position: 'absolute', right: 6, top: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <button type="button" className="hb tip" data-tip={[tx('work.013'), keyTip('record')].filter(Boolean).join('  ')} aria-label={tx('work.013')} disabled={!(tgtEditable || verify) || showHist}
                onClick={() => s.record(verify ? modText : undefined)}>
                <IconFeather size={14} />
              </button>
              <button type="button" className="hb tip" data-tip={viewTip} aria-label={tx('work.014')} aria-pressed={viewOn} disabled={!texts.length}
                style={{ color: viewOn ? 'var(--accent2)' : 'var(--mute)', background: viewOn ? 'var(--acc-soft)' : 'transparent' }}
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
              {viewOn && (tgtEditable || verify) && (
                <button type="button" className="hb tip" data-tip={tx('work.015')} aria-label={tx('work.015')} style={{ color: 'var(--accent2)' }}
                  onClick={() => (verify ? useSlotAsEdit() : s.useShownSlot())}>
                  <IconUse size={14} sw={2.2} />
                </button>
              )}
            </div>

            {showHist && (
              <div style={{ position: 'absolute', left: 8, bottom: 7, display: 'flex', alignItems: 'center', gap: 6, padding: '3px 4px 3px 8px', background: 'var(--pop)', border: '1px solid var(--line4)', borderRadius: 7 }}>
                <span style={{ fontSize: fz(11), color: 'var(--text2)' }}>{tx('work.013')}</span>
                <div role="radiogroup" aria-label={tx('work.016')} style={{ display: 'flex', gap: 3 }}>
                  {texts.map((_, i) => {
                    const on = i === slot;
                    return (
                      <button key={i} type="button" className="slot mono" role="radio" aria-checked={on} aria-label={tx('work.017', { v1: i + 1 })}
                        onClick={() => s.pickSlot(i)}
                        style={{
                          width: 22, height: 22, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 5,
                          fontSize: fz(11), fontWeight: 500, background: on ? 'var(--primary)' : 'var(--chip)', color: on ? '#ffffff' : 'var(--text2)',
                          border: `1px solid ${on ? 'var(--primary)' : 'var(--line4)'}`,
                        }}>{i + 1}</button>
                    );
                  })}
                </div>
              </div>
            )}
    </>
  );

  return (
    <>
    <Splitter dir="h" label={tx('work.005')} value={actualH} min={WORK_MIN} max={maxH} onChange={onDrag} />
    <section ref={sectionRef} aria-label={tx('work.006')} style={{
      minHeight: minH, maxHeight: maxH, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px', boxSizing: 'border-box',
      background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10,
    }}>
      <div style={{ flexGrow: 1, minHeight: 0, display: 'flex', gap: 12 }}>
        <div style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={labelRow}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label htmlFor="verso-source" className="sec-label">{tx('work.018')}</label>
              {srcEditable && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: fz(11), color: 'var(--warntx)', padding: '1px 7px', borderRadius: 9, background: 'rgba(240,165,74,0.12)' }}>
                  <IconPen size={10} sw={2.6} />{tx('work.019')}
                </span>
              )}
              {cur.upd && (
                <span style={{ fontSize: fz(11), color: 'var(--accent2)', padding: '1px 7px', borderRadius: 9, background: 'var(--acc-soft)' }}>
                  {cur.upd.removed ? tx('work.020') : cur.upd.applied ? tx('work.021') : showNewSrc ? tx('work.022') : tx('work.023')}
                </span>
              )}
            </span>
            <span style={meta}>{cur.id && <span className="mono">#{cur.id}</span>}<span>{cur.speaker}</span><span>{tx('work.024', { n: (showNewSrc ? newSrc! : cur.src).length })}</span></span>
          </div>
          <div style={boxStyle('src')}>
          <textarea maxLength={MAX_CELL_CHARS} id="verso-source" ref={setSrcEl} value={showNewSrc ? newSrc : cur.src} readOnly={!srcEditable || showNewSrc} onFocus={editFocus} onBlur={editBlur}
            onMouseMove={onSrcMove} onMouseLeave={() => { cancelAnimationFrame(moveFrame.current); moveFrame.current = 0; setHover(null); }} onMouseDown={onSrcDown}
            onChange={(ev) => srcEditable && s.updateEntry({ src: ev.target.value })}
            style={{
              flexGrow: 1, minHeight: 0, resize: 'none', boxSizing: 'border-box', padding: srcButtons > 0 ? '10px 44px 10px 12px' : '10px 12px',
              cursor: hover && canInsert ? 'pointer' : undefined,
              background: srcEditable ? 'var(--bg0)' : 'var(--bgdeep)',
              border: `1px ${showNewSrc ? 'dashed' : 'solid'} ${showNewSrc ? 'var(--accent)' : srcEditable ? 'rgba(240,165,74,0.55)' : 'var(--line)'}`,
              borderRadius: 8, fontSize: 'var(--fs-src)', fontFamily: 'var(--font-src)', lineHeight: 1.6, color: 'var(--text)',
            }} />
            {/* 命中字典的詞標色 */}
            <TextMarks target={srcEl} text={showNewSrc ? newSrc! : cur.src} ranges={showNewSrc ? srcDiffRanges : newSrc !== undefined ? [] : hitRanges} />
            {srcButtons > 0 && (
              <div role="toolbar" aria-label={tx('work.025')} aria-orientation="vertical" style={{ position: 'absolute', right: 6, top: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {newSrc !== undefined && <button type="button" className="hb tip" data-tip={tx('work.026')} aria-label={tx('work.026')} aria-pressed={srcPeek}
                  style={{ color: srcPeek ? 'var(--accent2)' : 'var(--mute)', background: srcPeek ? 'var(--acc-soft)' : 'transparent' }}
                  onPointerDown={(ev) => {
                    try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch { /* 無法捕捉時照常運作 */ }
                    setSrcPeek(true);
                  }}
                  onPointerUp={() => setSrcPeek(false)}
                  onPointerCancel={() => setSrcPeek(false)}>
                  <IconEye size={14} sw={2.2} />
                </button>}
                {mode !== 'view' && (
                  <button type="button" className="hb tip" data-tip={cur.upd?.removed ? tx('work.027') : tx('work.028')} aria-label={tx('work.028')} style={{ color: 'var(--accent2)' }}
                    onClick={() => { s.applyNewSource(); setSrcPeek(false); }}>
                    <IconUse size={14} sw={2.2} />
                  </button>
                )}
              </div>
            )}
            {hover && hits[hover.hit] && (
              <div className="hit-tip" style={{ left: hover.x, top: hover.y - 2 }}>{[...new Set(hits[hover.hit].terms.map((t) => t.en))].join(' / ')}</div>
            )}
          </div>

          <div style={{ ...labelRow, marginTop: 6, gap: 12 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <label htmlFor="verso-target" className="sec-label">{tx('work.029')}</label>
              {!tgtEditable && !verify && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: fz(11), color: 'var(--text2)', padding: '1px 7px', borderRadius: 9, background: 'var(--chip)' }}>
                  <IconLock size={10} sw={2.6} />{tx('work.003')}
                </span>
              )}
              {!showEdits && issueNote}
            </span>
            <span style={{ ...meta, flexShrink: 0 }}>
              <span>{!verify && texts.length ? tx('work.030', { length: texts.length }) : ''}</span>
              <span>{tx('work.031', { n: cur.tgt.length })}</span>
            </span>
          </div>
          <div style={boxStyle('tgt')}>
            <textarea maxLength={MAX_CELL_CHARS} id="verso-target" ref={setTgtEl} onFocus={editFocus} onBlur={editBlur} data-hist={tgtHist ? '1' : '0'} value={tgtHist ? texts[slot] : cur.tgt}
              readOnly={!tgtEditable || tgtHist}
              onChange={(ev) => onTarget(ev.target.value)} onPaste={onPaste}
              onMouseMove={showEdits ? onVMove : undefined} onMouseLeave={showEdits ? onVLeave : undefined} onMouseDown={onTgtDown} onContextMenu={onVMenu}
              style={{
                cursor: showEdits && vHover !== null ? 'pointer' : undefined,
                flexGrow: 1, minHeight: 0, resize: 'none', boxSizing: 'border-box', padding: verify ? '10px 12px' : '10px 44px 10px 12px',
                background: tgtEditable ? 'var(--bg0)' : 'var(--bgdeep)',
                border: `1px ${tgtHist ? 'dashed' : 'solid'} ${tgtHist ? 'var(--accent)' : tgtEditable ? 'var(--line4)' : 'var(--line)'}`,
                borderRadius: 8, color: tgtEditable ? 'var(--texthi)' : 'var(--textsoft)', fontSize: 'var(--fs-tgt)', fontFamily: 'var(--font-tgt)', lineHeight: 1.6,
              }} />
            {/* QA 問題的位置標色 */}
            {!tgtHist && <TextMarks target={tgtEl} text={cur.tgt} ranges={showEdits ? tgtEditRanges : issueRanges} />}
            {s.finishLine && !tgtHist && <FinishLine target={tgtEl} text={cur.tgt} std={effectiveStd(cur.lengthStd, currentOf(s).fileDoc.lengthStd)} />}
            {!verify && histUI}
          </div>

          {showEdits && (
            <>
              <div style={{ ...labelRow, marginTop: 6, gap: 12 }}>
                {/* 有修改框時檢查的是修改框，問題提示也放在這裡 */}
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <label htmlFor="verso-edit" className="sec-label">{tx('work.032')}</label>
                  {issueNote}
                </span>
                <span style={{ ...meta, flexShrink: 0, alignItems: 'center' }}>
                  <button type="button" className="ib" disabled={!edits.length} onClick={() => asStep(() => s.setVerify([], modText))} title={tx('work.033')}
                    style={{ ...smallBtn, opacity: edits.length ? 1 : 0.5 }}>{tx('work.034')}</button>
                  {verify && texts.length > 0 && <span>{tx('work.035', { n: texts.length })}</span>}
                  <span>{tx('work.031', { n: modText.length })}</span>
                </span>
              </div>
              <div style={boxStyle('mod')}>
                {/* 翻譯模式：修改框只給譯者看，不能改 */}
                <textarea maxLength={MAX_CELL_CHARS} id="verso-edit" ref={setModEl} value={modHist ? texts[slot] : modText} readOnly={!verify || modHist} onFocus={verify ? editFocus : undefined} onBlur={verify ? modBlur : undefined}
                  onChange={(ev) => verify && onModValue(ev.target.value, ev.target.selectionEnd)}
                  onMouseMove={onVMove} onMouseLeave={onVLeave} onMouseDown={onModDown} onContextMenu={onVMenu}
                  style={{
                    flexGrow: 1, minHeight: 0, resize: 'none', boxSizing: 'border-box', padding: verify ? '10px 44px 10px 12px' : '10px 12px',
                    cursor: !verify && vHover !== null ? 'pointer' : undefined,
                    background: verify ? 'var(--bg0)' : 'var(--bgdeep)', border: `1px ${modHist ? 'dashed' : 'solid'} ${modHist ? 'var(--accent)' : verify ? 'var(--line4)' : 'var(--line)'}`, borderRadius: 8,
                    color: verify ? 'var(--texthi)' : 'var(--textsoft)',
                    fontSize: 'var(--fs-tgt)', fontFamily: 'var(--font-tgt)', lineHeight: 1.6,
                  }} />
                {!modHist && <TextMarks target={modEl} text={modText} ranges={[...modRanges, ...issueRanges]} />}
                {s.finishLine && !modHist && <FinishLine target={modEl} text={modText} std={effectiveStd(cur.lengthStd, currentOf(s).fileDoc.lengthStd)} />}
                {verify && histUI}
              </div>
              {vMenu && spans[vMenu.i] && (
                <ContextMenu x={vMenu.x} y={vMenu.y} label={tx('work.032')} onClose={() => setVMenu(null)}
                  items={verify
                    ? [{ key: 'edit', label: tx('work.036') }, { key: 'del', label: tx('work.037') }, { key: 'apply', label: tx('work.038') }]
                    : [{ key: 'apply', label: tx('work.038') }, { key: 'del', label: tx('work.039') }]}
                  onPick={(k) => {
                    const i = vMenu.i;
                    setVMenu(null);
                    if (k === 'edit') requestAnimationFrame(() => editGroup(i));
                    else if (k === 'del') removeGroup(i);
                    else applyGroup(i);
                  }} />
              )}
            </>
          )}
        </div>

        {/* 右側按鈕目前是示範用的暫代功能，之後再決定 */}
        <div role="toolbar" aria-label={tx('work.040')} aria-orientation="vertical" style={{ width: 36, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 24 }}>
          <button type="button" className="ib btn-side" aria-label={tx('work.041')} title={tx('work.041')}
            onClick={() => { void navigator.clipboard?.writeText((cur.upd?.src ?? cur.src) + '\n' + cur.tgt); }}>
            <IconCopyPair size={15} />
          </button>
          {mode === 'translate' && (
            <button type="button" className="ib btn-side" aria-label={tx('work.042')} title={tx('work.042')} onClick={() => s.updateEntry({ tgt: '' })}>
              <IconEraser size={15} />
            </button>
          )}
          {verify && (
            <button type="button" className="ib btn-side" aria-label={tx('work.043')} title={tx('work.044')} disabled={!edits.length} onClick={() => asStep(() => s.setVerify([]))}
              style={{ opacity: edits.length ? 1 : 0.5 }}>
              <IconEraser size={15} />
            </button>
          )}
          {mode !== 'view' && (
            // 插入標籤：只有外觀，尚未實作
            <button type="button" className="ib btn-side" aria-label={tx('work.045')} title={tx('work.046')}>
              <IconBraces size={15} />
            </button>
          )}
          {mode === 'view' && (
            <button type="button" className="ib btn-side" aria-label={tx('work.047')} title={tx('work.048')}
              onClick={() => { void navigator.clipboard?.writeText(cur.tgt); }}>
              <IconCopy size={15} />
            </button>
          )}
        </div>
      </div>

      <div style={{ height: 40, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', gap: 14, fontSize: fz(12), color: 'var(--mute)' }}>
          <span>{tx('work.049', { n: sel + 1, total })}</span><span>{MODE_HINTS[mode]}</span>
          <button type="button" className="ib" aria-label={tx('work.051')} title={tx('work.052')} onClick={() => s.set({ lengthDialog: 'entry' })}
            style={{ height: 24, display: 'flex', alignItems: 'center', gap: 5, padding: '0 6px', margin: '-4px 0', background: 'transparent', border: 0, borderRadius: 6, color: cur.lengthStd !== undefined ? 'var(--accent2)' : 'var(--mute)', fontSize: fz(12) }}>
            <IconRuler size={14} />{cur.lengthStd !== undefined && tx('work.053')}
          </button>
        </span>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {mode === 'view' && (
            <button type="button" className="btn btn-ghost btn-std" onClick={() => s.prev()} title={keyTip('prevEntry', 'list')} style={{ gap: 6, padding: '0 16px' }}>
              <IconChevL size={14} sw={2.2} />{tx('work.054')}
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
                onClick={() => s.stampNext()} title={keyTip('stampNext')}
                style={{ padding: '0 16px', borderLeft: 0, borderRadius: '0 8px 8px 0' }}>{tx('work.055')}</button>
              {s.stampOpen && (
                <MarkMenu title={tx('work.056')} ariaLabel={tx('work.057')} current={stamp} exclude={exclude}
                  style={{ position: 'absolute', bottom: 46, left: 0 }}
                  onPick={(id) => s.set({ stamps: { ...s.stamps, [mode]: id }, stampOpen: false })} />
              )}
            </div>
          )}
          {mode === 'verify' && (
            <button type="button" className="btn btn-primary btn-main" onClick={() => s.mainNext()} title={keyTip('main')}>
              {edits.length || cur.sugg.trim() ? <><IconWarn size={14} sw={2.4} />{tx('work.058')}</> : <><IconCheck size={14} sw={2.6} />{tx('work.059')}</>}
            </button>
          )}
          {mode !== 'verify' && (
            <button type="button" className="btn btn-primary btn-main" onClick={() => s.next()} title={keyTip('main')}>
              {tx('work.060')}<IconChevR size={14} sw={2.2} />
            </button>
          )}
        </div>
      </div>
    </section>
    </>
  );
}
