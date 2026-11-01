// 翻譯記憶：比對、句式、片段、TMX（純邏輯，不碰畫面和存檔）
import { matchKey, ratio, srcDiff } from './srcUpdate';

/** 一條記憶 */
export interface TmRow {
  id: string;
  /** 屬於哪個專案的記憶（共用記憶是「共用」） */
  project: string;
  src: string;
  tgt: string;
  /** 已驗證；false 是未驗證 */
  verified: boolean;
  /** 譯者 */
  by: string;
  /** 時間（毫秒） */
  at: number;
  /** 來源檔案的 ID、名稱，頁簽名稱，條目 id，發話者 */
  fid: string;
  file: string;
  sheet: string;
  eid: string;
  speaker: string;
}

/** fuzzy：一般相似；pattern：句式（數字、標籤、字典詞換掉後一樣）；frag：片段（開頭或結尾一樣） */
export type MatchKind = 'fuzzy' | 'pattern' | 'frag';

export interface TmMatch {
  row: TmRow;
  /** 相似度（0～100）；句式、片段是換掉後或片段本身的比較，不一定是 100 */
  pct: number;
  kind: MatchKind;
  /** 同檔案、同 id、同發話者（同一份檔案的新版本）：排最前面 */
  same: boolean;
  /** 記憶的原文裡跟目前條目一樣的部分（畫底線） */
  under: [number, number][];
}

/** 比對時要知道的目前條目 */
export interface TmQuery {
  src: string;
  /** 最低顯示的相似度（0～100） */
  min: number;
  /** 查哪些專案的記憶 */
  projects: Set<string>;
  /** 目前條目所在的檔案、頁簽、id、發話者 */
  at?: { fid: string; file: string; sheet: string; eid: string; speaker: string };
  /** 找出一段文字裡的字典詞（句式比對用）：位置與譯名 */
  terms?: (text: string) => TermSpan[];
  /** 最多回傳幾條 */
  limit?: number;
}

export interface TermSpan { start: number; end: number; ens: string[] }

/**
 * 相似度百分比，跟「原文修正模式」同一套：無條件捨去；只有原文完全一樣（只忽略前後空白）才是 100，
 * 只差標點、空格、大小寫的最多 99
 */
export function tmPercent(a: string, b: string): number {
  if (a.trim() === b.trim()) return 100;
  return Math.min(99, Math.floor(ratio(matchKey(a), matchKey(b)) * 100));
}

/** 原文和譯文都一樣算同一條記憶 */
export const sameText = (a: { src: string; tgt: string }, b: { src: string; tgt: string }) => a.src === b.src && a.tgt === b.tgt;

// ---- 句式：數字、標籤、字典詞換成空格子 ----

const TAG = /\{[^{}]{0,40}\}|<[^<>]{1,40}>|\[\/?(?:color|b|i|u|size)[^\]]{0,40}\]|%(?:\d+\$)?[sd]/gi;
const NUM = /\d+(?:[.,]\d+)*/g;
/** 空格子：用很少見的字母，比對用字串才不會把它們當標點去掉 */
const HOLE = { tag: 'ʈ', num: 'ŋ', term: 'ʞ' } as const;

export interface Slot { start: number; end: number; kind: keyof typeof HOLE; raw: string; ens?: string[] }

/** 一段文字裡的格子（標籤優先，再來字典詞、數字；不重疊，照位置排） */
export function slotsOf(text: string, terms?: (text: string) => TermSpan[]): Slot[] {
  const taken = new Uint8Array(text.length);
  const out: Slot[] = [];
  const take = (start: number, end: number, kind: Slot['kind'], ens?: string[]) => {
    for (let k = start; k < end; k++) if (taken[k]) return;
    taken.fill(1, start, end);
    out.push({ start, end, kind, raw: text.slice(start, end), ...(ens ? { ens } : {}) });
  };
  for (const m of text.matchAll(TAG)) take(m.index!, m.index! + m[0].length, 'tag');
  for (const t of terms?.(text) ?? []) if (t.end > t.start) take(t.start, t.end, 'term', t.ens);
  for (const m of text.matchAll(NUM)) take(m.index!, m.index! + m[0].length, 'num');
  return out.sort((a, b) => a.start - b.start);
}

/** 格子換掉後的比對用字串 */
export function maskedKey(text: string, slots: Slot[]): string {
  let s = '', at = 0;
  for (const x of slots) { s += text.slice(at, x.start) + HOLE[x.kind]; at = x.end; }
  return matchKey(s + text.slice(at));
}

const foldLower = (s: string) => s.toLowerCase();

/**
 * 句式套用：記憶的譯文裡，把記憶原文格子的內容換成目前條目的。
 * 數字、標籤找一樣的文字換；字典詞找記憶那個詞的譯名，換成目前這個詞的譯名。換不了的回傳在 misses。
 */
export function patternApply(row: TmRow, rowSlots: Slot[], curSlots: Slot[]): { text: string; misses: string[] } {
  let text = row.tgt;
  const misses: string[] = [];
  // 由後往前找位置不容易：每一格各自找，記住已經換過的範圍，免得同一段被換兩次
  const used: [number, number][] = [];
  const free = (a: number, b: number) => used.every(([x, y]) => b <= x || a >= y);
  const shift = (at: number, delta: number) => { for (const u of used) { if (u[0] >= at) { u[0] += delta; u[1] += delta; } } };
  rowSlots.forEach((m, i) => {
    const c = curSlots[i];
    if (!c) return;
    if (m.kind !== 'term' && m.raw === c.raw) return;
    const wants = m.kind === 'term' ? (m.ens ?? []).filter(Boolean) : [m.raw];
    const put = m.kind === 'term' ? (c.ens?.[0] ?? c.raw) : c.raw;
    if (m.kind === 'term' && m.raw === c.raw) return;
    const low = foldLower(text);
    let hit: [number, number] | null = null;
    for (const w of wants) {
      const lw = foldLower(w);
      for (let at = low.indexOf(lw); at >= 0; at = low.indexOf(lw, at + 1)) {
        if (free(at, at + w.length)) { hit = [at, at + w.length]; break; }
      }
      if (hit) break;
    }
    if (!hit) { misses.push(c.raw); return; }
    text = text.slice(0, hit[0]) + put + text.slice(hit[1]);
    shift(hit[1], put.length - (hit[1] - hit[0]));
    used.push([hit[0], hit[0] + put.length]);
  });
  return { text, misses };
}

// ---- 片段：開頭或結尾到標點為止 ----

const PUNCT = /[，。！？、；：,.!?;:…—「」『』（）()]/;

/** 開頭到第一個標點為止（不含標點）；整句沒有標點或太短就沒有 */
export function headOf(text: string): [number, number] | null {
  const t = text.trimEnd();
  const lead = t.length - t.trimStart().length;
  for (let k = lead; k < t.length; k++) {
    if (PUNCT.test(t[k])) {
      if (k === t.length - 1) return null;
      return matchKey(t.slice(lead, k)).length >= 2 ? [lead, k] : null;
    }
  }
  return null;
}

/** 最後一個標點之後到結尾（句尾的標點不算分隔） */
export function tailOf(text: string): [number, number] | null {
  let end = text.trimEnd().length;
  while (end > 0 && PUNCT.test(text[end - 1])) end--;
  for (let k = end - 1; k >= 0; k--) {
    if (PUNCT.test(text[k])) {
      let start = k + 1;
      while (start < end && /\s/.test(text[start])) start++;
      return matchKey(text.slice(start, end)).length >= 2 && start > 0 ? [start, end] : null;
    }
  }
  return null;
}

/** 片段至少要在記憶裡出現幾次才列出來 */
export const FRAG_MIN = 2;
/** 一種片段最多列幾條 */
const FRAG_SHOW = 3;

// ---- 索引與比對 ----

/** 相鄰兩字 */
function bigrams(k: string): number[] {
  const out = new Set<number>();
  for (let x = 0; x + 1 < k.length; x++) out.add(k.charCodeAt(x) * 65536 + k.charCodeAt(x + 1));
  return [...out];
}

/** 一次比對最多細算幾條候選 */
const MAX_CANDS = 400;

/** 記憶的索引：可以一條一條加、拿掉（拿掉的先標記，太多時整份重建比較快） */
export class TmIndex {
  readonly rows: TmRow[] = [];
  readonly keys: string[] = [];
  private dead: boolean[] = [];
  private deadCount = 0;
  private at = new Map<string, number>();
  private post = new Map<number, number[]>();
  private short = new Map<number, number[]>();
  private exact = new Map<string, number[]>();
  private heads = new Map<string, number[]>();
  private tails = new Map<string, number[]>();
  private headRange: ([number, number] | null)[] = [];
  private tailRange: ([number, number] | null)[] = [];
  private slotCache = new Map<number, { slots: Slot[]; key: string }>();
  private counts: number[] = [];
  private stamp: number[] = [];
  private round = 0;

  constructor(rows: TmRow[] = []) { for (const r of rows) this.add(r); }

  /** 有效的記憶條數 */
  get size() { return this.rows.length - this.deadCount; }
  /** 拿掉的太多了：該整份重建 */
  get stale() { return this.deadCount > 1000 && this.deadCount > this.rows.length / 3; }

  /** 加一條（同一個 ID 已經有的話先拿掉舊的） */
  add(r: TmRow) {
    this.remove(r.id);
    const i = this.rows.length;
    const k = matchKey(r.src);
    this.rows.push(r); this.keys.push(k); this.dead.push(false); this.counts.push(0); this.stamp.push(0);
    this.at.set(r.id, i);
    const push = <K,>(m: Map<K, number[]>, key: K) => { const l = m.get(key); if (l) l.push(i); else m.set(key, [i]); };
    push(this.exact, k);
    if (k.length < 4) push(this.short, k.length);
    for (const b of bigrams(k)) push(this.post, b);
    const h = headOf(r.src), t = tailOf(r.src);
    this.headRange.push(h);
    this.tailRange.push(t);
    if (h) push(this.heads, matchKey(r.src.slice(h[0], h[1])));
    if (t) push(this.tails, matchKey(r.src.slice(t[0], t[1])));
  }

  remove(id: string) {
    const i = this.at.get(id);
    if (i === undefined) return;
    this.at.delete(id);
    this.dead[i] = true;
    this.deadCount++;
    this.slotCache.delete(i);
  }

  /** 可能夠像的記憶（之後還要真的算） */
  private candidates(key: string, allow: (i: number) => boolean): number[] {
    const out = new Set<number>(this.exact.get(key) ?? []);
    if (key.length < 3) {
      for (let L = 1; L < 4; L++) for (const i of this.short.get(L) ?? []) out.add(i);
    }
    const bs = bigrams(key);
    if (bs.length) {
      const r = ++this.round, seen: number[] = [];
      // 太常見的兩字（大部分記憶都有）不拿來找，除非只剩它
      const lists = bs.map((b) => this.post.get(b) ?? []).sort((a, b) => a.length - b.length);
      const cap = Math.max(2000, this.rows.length / 5);
      lists.forEach((l, k) => {
        if (l.length > cap && k > 0) return;
        for (const i of l) {
          if (this.stamp[i] !== r) { this.stamp[i] = r; this.counts[i] = 0; seen.push(i); }
          this.counts[i]++;
        }
      });
      // 共同的兩字越多越前面（跟長度比），只細算前面幾百條
      const score = (i: number) => this.counts[i] / Math.max(bs.length, this.keys[i].length - 1, 1);
      seen.filter(allow).sort((a, b) => score(b) - score(a)).slice(0, MAX_CANDS).forEach((i) => out.add(i));
    }
    return [...out].filter(allow);
  }

  private slotsAt(i: number, terms?: (t: string) => TermSpan[]) {
    let c = this.slotCache.get(i);
    if (!c) { const slots = slotsOf(this.rows[i].src, terms); c = { slots, key: maskedKey(this.rows[i].src, slots) }; this.slotCache.set(i, c); }
    return c;
  }

  /** 字典變了：句式比對的格子要重算 */
  clearTerms() { this.slotCache.clear(); }

  query(q: TmQuery): TmMatch[] {
    const { src, min, projects, at } = q;
    if (!src.trim() || !this.size) return [];
    const key = matchKey(src);
    const own = (r: TmRow) => !!at && !!r.eid && r.fid === at.fid && r.sheet === at.sheet && r.eid === at.eid;
    const allow = (i: number) => !this.dead[i] && projects.has(this.rows[i].project) && !own(this.rows[i]);
    const isSame = (r: TmRow) => !!at && !!r.eid && r.eid === at.eid && r.speaker === at.speaker && r.file.toLowerCase() === at.file.toLowerCase();
    const out = new Map<number, TmMatch>();
    const L = key.length;
    for (const i of this.candidates(key, allow)) {
      const k = this.keys[i], sum = k.length + L;
      if (sum && (2 * Math.min(k.length, L)) / sum * 100 < min && !isSame(this.rows[i])) continue;
      const pct = tmPercent(src, this.rows[i].src);
      const r = this.rows[i];
      if (pct < min && !isSame(r)) continue;
      out.set(i, { row: r, pct, kind: 'fuzzy', same: isSame(r), under: underOf(src, r.src) });
    }
    // 同一份檔案的新版本：就算不像也列出來
    if (at?.eid) {
      this.rows.forEach((r, i) => {
        if (!out.has(i) && allow(i) && isSame(r)) out.set(i, { row: r, pct: tmPercent(src, r.src), kind: 'fuzzy', same: true, under: underOf(src, r.src) });
      });
    }
    // 句式：換掉格子後一模一樣，但原文本身不一樣
    const curSlots = slotsOf(src, q.terms);
    if (curSlots.length) {
      const mk = maskedKey(src, curSlots);
      for (const i of this.candidates(mk, allow).concat(this.candidates(key, allow))) {
        const hit = out.get(i);
        if (hit?.pct === 100) continue;
        const c = this.slotsAt(i, q.terms);
        if (c.slots.length !== curSlots.length || c.key !== mk || c.slots.some((x, j) => x.kind !== curSlots[j].kind)) continue;
        out.set(i, { row: this.rows[i], pct: hit?.pct ?? tmPercent(src, this.rows[i].src), kind: 'pattern', same: hit?.same ?? isSame(this.rows[i]), under: underOf(src, this.rows[i].src) });
      }
    }
    // 片段：開頭或結尾一樣，而且記憶裡出現好幾次
    const frag = (range: [number, number] | null, map: Map<string, number[]>, which: 'head' | 'tail') => {
      if (!range) return;
      const list = (map.get(matchKey(src.slice(range[0], range[1]))) ?? []).filter(allow);
      if (list.length < FRAG_MIN) return;
      list.filter((i) => !out.has(i)).sort((a, b) => rankRow(this.rows[b]) - rankRow(this.rows[a])).slice(0, FRAG_SHOW).forEach((i) => {
        const rr = which === 'head' ? this.headRange[i] : this.tailRange[i];
        out.set(i, { row: this.rows[i], pct: tmPercent(src, this.rows[i].src), kind: 'frag', same: false, under: rr ? [rr] : [] });
      });
    };
    frag(headOf(src), this.heads, 'head');
    frag(tailOf(src), this.tails, 'tail');
    return sortMatches([...out.values()]).slice(0, q.limit ?? 30);
  }

  /** 句式套用（記憶這條、目前原文） */
  applyPattern(row: TmRow, src: string, terms?: (t: string) => TermSpan[]) {
    const i = this.at.get(row.id);
    const rs = i !== undefined && this.rows[i] === row ? this.slotsAt(i, terms).slots : slotsOf(row.src, terms);
    return patternApply(row, rs, slotsOf(src, terms));
  }
}

/** 已驗證的、比較新的排前面 */
const rankRow = (r: TmRow) => (r.verified ? 1e15 : 0) + r.at;

const KIND_ORDER: Record<MatchKind, number> = { fuzzy: 0, pattern: 1, frag: 2 };

/** 排序：同檔案同 id 的最前面；相似度高的在前；同分時已驗證在前，再來是比較新的；片段放最後 */
export function sortMatches(list: TmMatch[]): TmMatch[] {
  return list.sort((a, b) => Number(b.same) - Number(a.same)
    || (a.kind === 'frag' || b.kind === 'frag' ? KIND_ORDER[a.kind] - KIND_ORDER[b.kind] : 0)
    || b.pct - a.pct
    || Number(b.row.verified) - Number(a.row.verified)
    || b.row.at - a.row.at);
}

/** 記憶的原文裡，跟目前原文一樣的部分 */
export function underOf(cur: string, mem: string): [number, number][] {
  if (!cur || !mem) return [];
  if (cur === mem) return [[0, mem.length]];
  if (cur.length * mem.length > 400_000) return [];
  const changed = srcDiff(cur, mem).filter((r) => r.end > r.start);
  const out: [number, number][] = [];
  let at = 0;
  for (const r of changed) { if (r.start > at) out.push([at, r.start]); at = Math.max(at, r.end); }
  if (at < mem.length) out.push([at, mem.length]);
  // 只剩空白、標點的小段不畫
  return out.filter(([a, b]) => /[\p{L}\p{N}]/u.test(mem.slice(a, b)));
}

// ---- 一致性：同一個原文有不同譯文 ----

export function inconsistent(rows: TmRow[]): { src: string; rows: TmRow[] }[] {
  const by = new Map<string, TmRow[]>();
  for (const r of rows) {
    const k = r.src.trim();
    if (!k) continue;
    const l = by.get(k);
    if (l) l.push(r); else by.set(k, [r]);
  }
  return [...by].filter(([, l]) => new Set(l.map((r) => r.tgt.trim())).size > 1)
    .map(([src, l]) => ({ src, rows: l.sort((a, b) => b.at - a.at) }))
    .sort((a, b) => b.rows.length - a.rows.length || a.src.localeCompare(b.src));
}

// ---- TMX ----

const unesc = (s: string) => s.replace(/&(lt|gt|amp|quot|apos|#(\d+)|#x([0-9a-f]+));/gi, (m, n: string, d?: string, h?: string) => {
  if (d) return String.fromCodePoint(Number(d));
  if (h) return String.fromCodePoint(parseInt(h, 16));
  return ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" } as Record<string, string>)[n.toLowerCase()] ?? m;
});
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** seg 的文字：行內標籤（ph、bpt 等）只留裡面的原始文字 */
const segText = (x: string) => unesc(x.replace(/<\/?(?:ph|bpt|ept|it|hi|ut|sub)\b[^>]*>/gi, '').replace(/<[^>]+>/g, ''));
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'))?.[1] ?? tag.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i'))?.[1];

/** 讀 TMX：每個翻譯單位一條（原文找中文，譯文找英文；找不到就照順序第一、第二個） */
export function parseTmx(xml: string): Omit<TmRow, 'id' | 'project'>[] {
  const head = xml.match(/<header\b[^>]*>/i)?.[0] ?? '';
  const srcLang = (attr(head, 'srclang') ?? '').toLowerCase();
  const out: Omit<TmRow, 'id' | 'project'>[] = [];
  for (const tu of xml.matchAll(/<tu\b([^>]*)>([\s\S]*?)<\/tu>/gi)) {
    const tuvs = [...tu[2].matchAll(/<tuv\b([^>]*)>([\s\S]*?)<\/tuv>/gi)].map((m) => ({
      lang: (attr(m[1], 'xml:lang') ?? attr(m[1], 'lang') ?? '').toLowerCase(),
      text: segText(m[2].match(/<seg\b[^>]*>([\s\S]*?)<\/seg>/i)?.[1] ?? ''),
    }));
    if (tuvs.length < 2) continue;
    const src = tuvs.find((t) => t.lang.startsWith('zh')) ?? (srcLang && srcLang !== '*all*' ? tuvs.find((t) => t.lang === srcLang) : undefined) ?? tuvs[0];
    const tgt = tuvs.find((t) => t !== src && t.lang.startsWith('en')) ?? tuvs.find((t) => t !== src)!;
    if (!src.text.trim() || !tgt.text.trim()) continue;
    const props = new Map([...tu[2].matchAll(/<prop\b([^>]*)>([\s\S]*?)<\/prop>/gi)].map((m) => [attr(m[1], 'type') ?? '', unesc(m[2])]));
    const date = attr(tu[1], 'changedate') ?? attr(tu[1], 'creationdate') ?? '';
    const dm = date.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    out.push({
      src: src.text, tgt: tgt.text, verified: props.get('x-verified') === '1',
      by: attr(tu[1], 'changeid') ?? attr(tu[1], 'creationid') ?? '',
      at: dm ? Date.UTC(+dm[1], +dm[2] - 1, +dm[3], +dm[4], +dm[5], +dm[6]) : Date.now(),
      fid: '', file: props.get('x-file') ?? '', sheet: props.get('x-sheet') ?? '', eid: props.get('x-id') ?? '', speaker: props.get('x-speaker') ?? '',
    });
  }
  return out;
}

const tmxDate = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

/** 寫成 TMX 1.4 */
export function toTmx(rows: TmRow[]): string {
  const prop = (type: string, v: string) => (v ? `\n      <prop type="${type}">${esc(v)}</prop>` : '');
  const tus = rows.map((r) => `    <tu${r.by ? ` creationid="${esc(r.by)}" changeid="${esc(r.by)}"` : ''} changedate="${tmxDate(r.at)}">`
    + prop('x-project', r.project) + prop('x-file', r.file) + prop('x-sheet', r.sheet) + prop('x-id', r.eid) + prop('x-speaker', r.speaker) + prop('x-verified', r.verified ? '1' : '0')
    + `\n      <tuv xml:lang="zh-TW"><seg>${esc(r.src)}</seg></tuv>\n      <tuv xml:lang="en"><seg>${esc(r.tgt)}</seg></tuv>\n    </tu>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<tmx version="1.4">\n  <header creationtool="Verso" creationtoolversion="1" segtype="sentence" o-tmf="Verso" adminlang="en" srclang="zh-TW" datatype="plaintext"/>\n  <body>\n${tus.join('\n')}\n  </body>\n</tmx>\n`;
}
