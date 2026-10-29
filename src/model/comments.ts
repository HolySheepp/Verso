// 雲端模式的備註留言：兩層（備註 → 回覆；回覆中的回覆用引用 quoteId）。
// 完整資料存在 Verso 資料表；Google 表的備註格只寫沒解決的留言：原有內容（原備註）下面接
// 「[名字] 內容」，回覆接在它下面寫成「-[名字] 內容」，不寫時間。

export interface CommentReply {
  id: string;
  author: string;
  /** ISO 時間；從 Google 表直接抓到、資料表裡沒有的留言是空的（沒有日期） */
  time: string;
  text: string;
  edited?: boolean;
  resolved?: boolean;
  /** 引用同一串裡的另一則 */
  quoteId?: string;
}

export interface CommentThread extends Omit<CommentReply, 'quoteId'> {
  replies: CommentReply[];
}

const LINE = /^(-?)\[([^\]\n]+)\] ?(.*)$/;
/** 使用者名稱：去掉 [ ] 和換行（備註格裡的留言行靠 [名稱] 辨認，名稱裡有這些字就讀不回來） */
export const cleanName = (n: string) => n.replace(/[[\]\r\n]+/g, '');

/** 寫進 Google 的一行：換行換成空格（一則留言只佔一行，讀回來才認得） */
const flat = (t: string) => t.replace(/\s*\n\s*/g, ' ').trim();
export const commentLine = (author: string, text: string, reply = false) => `${reply ? '-' : ''}[${author}] ${flat(text)}`;

/** Google 備註格要寫的內容：原備註，下面接沒解決的留言 */
export function composeNote(base: string, threads: CommentThread[]): string {
  const lines: string[] = [];
  for (const t of threads) {
    if (t.resolved) continue;
    lines.push(commentLine(t.author, t.text));
    for (const r of t.replies) if (!r.resolved) lines.push(commentLine(r.author, r.text, true));
  }
  const b = base.replace(/\s+$/, '');
  return [b, ...lines].filter((x, i) => i > 0 || x).join('\n');
}

/** 從 Google 直接抓到、資料表裡沒有的留言：同樣的內容在每台電腦算出同樣的 id */
function lineId(reply: boolean, author: string, text: string, n: number) {
  let h = 0;
  for (const c of `${reply ? '-' : ''}${author}\u0000${text}\u0000${n}`) h = (h * 31 + c.charCodeAt(0)) | 0;
  return 'g' + (h >>> 0).toString(36);
}

/**
 * 讀 Google 備註格：資料表記的留言（known）對得上的行是留言；符合「[名字] 內容」但對不上的也當成留言（沒有日期）；
 * 其他行是原備註。資料表記著、沒解決、但格子裡已經沒有的留言，是被人在 Google 上刪掉了，一起拿掉（已解決的本來就不在格子裡，留著）。
 */
export function parseNote(note: string, known: CommentThread[]): { base: string; threads: CommentThread[] } {
  const baseLines: string[] = [];
  const seen = new Set<string>();
  const adopted: CommentThread[] = [];
  /** 每則留言對應到的行：resolved 的不用找 */
  const want = new Map<string, string[]>();
  for (const t of known) {
    if (!t.resolved) want.set(commentLine(t.author, t.text), [...(want.get(commentLine(t.author, t.text)) ?? []), t.id]);
    for (const r of t.replies) if (!r.resolved) want.set(commentLine(r.author, r.text, true), [...(want.get(commentLine(r.author, r.text, true)) ?? []), r.id]);
  }
  const counts = new Map<string, number>();
  /** 回覆接在最近的那串下面（資料表的或剛抓到的） */
  let last: { id: string; adopted?: CommentThread } | null = null;
  for (const raw of note.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    const m = line.match(LINE);
    if (!m) { if (!adopted.length && !seen.size) baseLines.push(raw); else if (line) baseLines.push(raw); continue; }
    const ids = want.get(line);
    if (ids?.length) {
      const id = ids.shift()!;
      seen.add(id);
      const t = known.find((x) => x.id === id);
      if (t) last = { id };
      continue;
    }
    const reply = m[1] === '-';
    // 上面沒有任何留言的「-[名字] 內容」：當原備註文字保留，寫回時才不會少了「-」
    if (reply && !last) { baseLines.push(raw); continue; }
    const n = counts.get(line) ?? 0;
    counts.set(line, n + 1);
    const c = { id: lineId(reply, m[2], m[3], n), author: m[2], time: '', text: m[3] };
    if (reply && last) {
      if (last.adopted) last.adopted.replies.push(c);
      else adopted.push({ ...c, id: '>' + last.id + ':' + c.id, replies: [] });
    } else {
      const t: CommentThread = { ...c, replies: [] };
      adopted.push(t);
      last = { id: t.id, adopted: t };
    }
  }
  // 資料表的留言：沒解決又不在格子裡的拿掉；接在資料表留言下面、剛抓到的回覆放回那串
  const threads = known.flatMap((t): CommentThread[] => {
    if (!t.resolved && !seen.has(t.id)) return [];
    const extra = adopted.filter((a) => a.id.startsWith('>' + t.id + ':')).map((a) => ({ ...a, id: a.id.slice(a.id.lastIndexOf(':') + 1) }));
    const replies = [...t.replies.filter((r) => r.resolved || t.resolved || seen.has(r.id)), ...extra.map(({ replies: _r, ...r }) => r)];
    return [replies.length === t.replies.length && !extra.length && replies.every((r, i) => r === t.replies[i]) ? t : { ...t, replies }];
  });
  return { base: baseLines.join('\n').replace(/\s+$/, ''), threads: [...threads, ...adopted.filter((a) => !a.id.startsWith('>'))] };
}

type Msg = CommentReply;
const msgs = (list: CommentThread[]) => {
  const m = new Map<string, { m: Msg; parent?: string }>();
  for (const t of list) {
    m.set(t.id, { m: t });
    for (const r of t.replies) m.set(r.id, { m: r, parent: t.id });
  }
  return m;
};
const sameMsg = (a: Msg, b: Msg) => a.text === b.text && !!a.resolved === !!b.resolved && !!a.edited === !!b.edited && a.author === b.author && a.quoteId === b.quoteId;

/**
 * 三方合併：base 是上次跟資料表對上的，mine 是軟體裡的，theirs 是資料表現在的。
 * 兩邊各自新增的都留著；一邊刪掉就刪；同一則兩邊都改了，用自己的
 */
export function mergeComments(base: CommentThread[], mine: CommentThread[], theirs: CommentThread[]): CommentThread[] {
  const B = msgs(base), M = msgs(mine), T = msgs(theirs);
  const pick = (id: string): Msg | null => {
    const b = B.get(id)?.m, m = M.get(id)?.m, t = T.get(id)?.m;
    if (b) {
      if (!m || !t) return null;
      return sameMsg(m, b) ? t : m;
    }
    return m ?? t ?? null;
  };
  const order: string[] = [];
  for (const list of [mine, theirs]) for (const t of list) if (!order.includes(t.id)) order.push(t.id);
  const out: CommentThread[] = [];
  for (const id of order) {
    const top = pick(id) as CommentThread | null;
    if (!top) continue;
    const rIds: string[] = [];
    for (const list of [M.get(id)?.m, T.get(id)?.m]) for (const r of (list as CommentThread | undefined)?.replies ?? []) if (!rIds.includes(r.id)) rIds.push(r.id);
    const replies = rIds.map(pick).filter((r): r is Msg => !!r);
    out.push({ ...top, replies });
  }
  return out;
}

/** 有沒解決的留言 */
export const hasOpenComments = (list: CommentThread[] | undefined) => !!list?.some((t) => !t.resolved);

/** 資料表存的文字 */
export const commentsToText = (list: CommentThread[] | undefined) => (list?.length ? JSON.stringify(list) : '');
export function textToComments(t: string | undefined): CommentThread[] {
  if (!t) return [];
  try {
    const x = JSON.parse(t);
    return Array.isArray(x) ? x.filter((c) => c && typeof c.id === 'string').map((c) => ({ ...c, replies: Array.isArray(c.replies) ? c.replies : [] })) : [];
  } catch { return []; }
}

/** 顯示用時間：月/日 時:分（沒有日期的留言是空的） */
export function formatTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => (n < 10 ? '0' : '') + n;
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

let seq = 0;
export const newCommentId = () => 'c' + Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 5);
