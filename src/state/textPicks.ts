// 工作欄裡選取的文字範圍：按住 Ctrl 可以在原文、譯文（或修改）框各選一段，
// 按「新增詞條」時原文那段填進字典原文、譯文那段填進字典譯文
import { create } from 'zustand';

export type PickBox = 'src' | 'tgt' | 'mod';
export interface TextPick { box: PickBox; start: number; end: number; text: string }

interface Picks {
  /** 選在哪一條（換條目就不算） */
  uid: string;
  src?: TextPick;
  /** 譯文框或修改框選的（後選的那個） */
  tgt?: TextPick;
}

export const usePicks = create<Picks>(() => ({ uid: '' }));

// 選取時有沒有按住 Ctrl（滑鼠、鍵盤選取都看最近一次的狀態）
let ctrl = false;
if (typeof window !== 'undefined') {
  const on = (ev: KeyboardEvent | MouseEvent) => { ctrl = ev.ctrlKey || ev.metaKey; };
  window.addEventListener('keydown', on, true);
  window.addEventListener('keyup', on, true);
  window.addEventListener('mousedown', on, true);
}

/** 某個框的選取範圍變了：有選到字就記下（沒按 Ctrl 時其他框的清掉）；只是點一下，沒按 Ctrl 時全部清掉 */
export function notePick(uid: string, box: PickBox, el: HTMLTextAreaElement) {
  const s = el.selectionStart, e = el.selectionEnd;
  const cur = usePicks.getState();
  const keep = ctrl && cur.uid === uid ? cur : { uid };
  const slot = box === 'src' ? 'src' : 'tgt';
  if (s === e) {
    if (!ctrl) { if (cur.src || cur.tgt) usePicks.setState({ uid, src: undefined, tgt: undefined }, true); return; }
    // 按住 Ctrl 點進另一個框（還沒拖選）：其他框的留著
    if (keep[slot]?.box === box) usePicks.setState({ ...keep, [slot]: undefined }, true);
    return;
  }
  const text = el.value.slice(s, e);
  const next: Picks = { ...keep, uid, [slot]: { box, start: s, end: e, text } };
  usePicks.setState(next, true);
}

/** 這個框現在還有效的選取（文字變了就不算） */
export function pickIn(p: Picks, uid: string, box: PickBox, text: string): TextPick | undefined {
  if (p.uid !== uid) return undefined;
  const x = box === 'src' ? p.src : p.tgt;
  return x && x.box === box && text.slice(x.start, x.end) === x.text ? x : undefined;
}

/** 新增詞條要帶入的原文、譯文（都沒選時是 null）；用完清掉 */
export function takePicks(uid: string): { src: string; tgt: string } | null {
  const p = usePicks.getState();
  if (p.uid !== uid || (!p.src && !p.tgt)) return null;
  usePicks.setState({ uid: '' }, true);
  return { src: p.src?.text.trim() ?? '', tgt: p.tgt?.text.trim() ?? '' };
}
