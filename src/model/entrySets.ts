// 收起組與條目串（雲端模式）：資料型別與純邏輯（不含畫面）
//
// 收起組：使用者自己框選相鄰的條目收成一組，收起時只顯示一個長方形按鈕。
//   哪些條目在同一組寫進資料表共享；收起、展開存在自己的電腦（第一次打開預設收起）。
// 條目串（只在技能檔案）：原文拿掉標籤裡的數字後完全相同、又連在一起的條目，自動收成一串，
//   編輯串就是批量編輯裡面每一條（標籤照各條自己的數字填回去）。
//   使用者切割過的地方（cuts：切在哪一條的下方）保持分開，直到使用者自己合併。
import { TOKEN_SRC } from './checks';
import type { Entry } from './types';

export interface EntryGroup {
  id: string;
  /** 名稱；空白時顯示第一條和最後一條開頭的一部分 */
  name: string;
  /** 相鄰的條目（uid），照檔案順序 */
  uids: string[];
  /** 自動收納已驗證條目：下面連著的條目變成已驗證時，自動收進這一組 */
  auto?: boolean;
}

export const newGroupId = () => 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ---- 標籤 ----

/** 參數標籤：跟檢查用的標籤一樣，另外大括號後面緊接的 % 也算在標籤裡（例如 {123A}%） */
const TAG_SRC = TOKEN_SRC.replace(String.raw`\{[^{}\s]*\}`, String.raw`\{[^{}\s]*\}%?`);
const tagRe = () => new RegExp(TAG_SRC, 'g');
/** 標籤（{…}、<…>、%s 這類）裡的數字拿掉，字母和符號保留；標籤外面的字不動 */
export const stripTagDigits = (s: string) => s.replace(tagRe(), (t) => t.replace(/\d/g, ''));
/** 文字裡的標籤，照出現順序 */
export const tagsIn = (s: string) => (s.match(tagRe()) ?? []).filter((t) => t !== '%%');

/** 文字裡每個標籤的位置（加底線、點了插入用） */
export function tagSpans(s: string): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = [];
  for (const m of s.matchAll(tagRe())) if (m[0] !== '%%') out.push({ start: m.index!, end: m.index! + m[0].length, text: m[0] });
  return out;
}

/**
 * 把串的譯文套到某一條：譯文裡的標籤換成這一條原文裡同一種標籤（拿掉數字後一樣的）的實際內容，照出現順序一個一個填。
 * 例如串的譯文「ATK +{A%}」、原文「攻擊力+{124A%}」→「ATK +{124A%}」
 */
export function fillTemplate(tpl: string, src: string): string {
  const q = new Map<string, string[]>();
  for (const t of tagsIn(src)) { const k = stripTagDigits(t); if (!q.has(k)) q.set(k, []); q.get(k)!.push(t); }
  return tpl.replace(tagRe(), (t) => { const a = q.get(stripTagDigits(t)); return a?.length ? a.shift()! : t; });
}

/** 只換掉沒有數字的標籤（例如直接打了串上顯示的 {A%}）；本來就有數字的照舊（順序照樣對齊） */
export function fillBareTags(tgt: string, src: string): string {
  const q = new Map<string, string[]>();
  for (const t of tagsIn(src)) { const k = stripTagDigits(t); if (!q.has(k)) q.set(k, []); q.get(k)!.push(t); }
  return tgt.replace(tagRe(), (t) => { const a = q.get(stripTagDigits(t)); const v = a?.shift(); return v && !/\d/.test(t) ? v : t; });
}

// ---- 條目串 ----

export interface Chain {
  /** 第一條的 uid（展開、收起的狀態用它記） */
  id: string;
  uids: string[];
  /** 在頁簽裡的位置 */
  idx: number[];
  /** 拿掉標籤數字後的原文（串上顯示的） */
  src: string;
  /** 大多數條目的譯文格式（拿掉標籤數字）；都還沒翻是空白 */
  tpl: string;
  /** 譯文格式跟大多數不同的條目（疑慮）：不受串的編輯影響，改成一樣的格式才歸隊 */
  outliers: Set<string>;
  /** 代表這一串的條目（第一條格式相同的）：收起時點串就是選這一條 */
  rep: number;
}

/** 一串裡的譯文格式：拿掉標籤數字後，最多條用的那個（一樣多時取前面的）；格式不同的是疑慮 */
function templateOf(entries: Entry[], idx: number[]): { tpl: string; outliers: Set<string> } {
  const count = new Map<string, number>();
  const norm = idx.map((i) => (entries[i].tgt.trim() ? stripTagDigits(entries[i].tgt) : null));
  norm.forEach((n) => { if (n !== null) count.set(n, (count.get(n) ?? 0) + 1); });
  let tpl = '', best = 0;
  norm.forEach((n) => { if (n !== null && count.get(n)! > best) { best = count.get(n)!; tpl = n; } });
  const outliers = new Set<string>();
  norm.forEach((n, k) => { if (n !== null && n !== tpl) outliers.add(entries[idx[k]].uid); });
  return { tpl, outliers };
}

/**
 * 找出頁簽裡的條目串：拿掉標籤數字後原文一樣、又連在一起的兩條以上。
 * cuts：使用者切割過的地方（那一條的下方切開）；groupOf：條目在哪個收起組（串不會跨過收起組的邊界）
 */
export function findChains(entries: Entry[], cuts: ReadonlySet<string>, groupOf: (uid: string) => string | undefined = () => undefined): Chain[] {
  const out: Chain[] = [];
  let run: number[] = [];
  let key: string | null = null;
  const close = () => {
    if (run.length >= 2) {
      const { tpl, outliers } = templateOf(entries, run);
      const rep = run.find((i) => !outliers.has(entries[i].uid)) ?? run[0];
      out.push({ id: entries[run[0]].uid, uids: run.map((i) => entries[i].uid), idx: run, src: key!, tpl, outliers, rep });
    }
    run = [];
    key = null;
  };
  entries.forEach((e, i) => {
    // 技能檔案：拿掉標籤數字後一樣的就組成一串（沒有標籤、完全一樣的技能名稱也算）
    const k = e.src.trim() ? stripTagDigits(e.src) : null;
    const prev = run.length ? entries[run[run.length - 1]] : null;
    if (k !== null && prev && k === key && !cuts.has(prev.uid) && groupOf(prev.uid) === groupOf(e.uid)) { run.push(i); return; }
    close();
    if (k !== null) { run = [i]; key = k; }
  });
  close();
  return out;
}

/**
 * 編輯了串裡的一條（格式跟大多數一樣的那種）：其他格式一樣的條目照新的譯文更新（標籤換成各自的數字）。
 * field：要同步的欄位；回傳要改的條目（uid → 新的值）
 */
export function spreadEdit(entries: Entry[], c: Chain, fromUid: string, text: string, field: 'tgt' | 'src' | 'note'): Map<string, string> {
  const out = new Map<string, string>();
  const tpl = field === 'note' ? text : stripTagDigits(text);
  c.idx.forEach((i) => {
    const e = entries[i];
    if (e.uid === fromUid || c.outliers.has(e.uid)) return;
    const next = field === 'note' ? tpl : fillTemplate(tpl, e.src);
    if (next !== e[field]) out.set(e.uid, next);
  });
  return out;
}

// ---- 收起組 ----

/** 名稱空白時：第一條和最後一條原文開頭的一部分 */
export function autoName(entries: Entry[], g: EntryGroup): string {
  const by = new Map(entries.map((e) => [e.uid, e]));
  const head = (uid: string | undefined) => {
    const e = uid ? by.get(uid) : undefined;
    const t = (e?.src || e?.tgt || e?.id || '').replace(/\s+/g, ' ').trim();
    return t.length > 10 ? t.slice(0, 10) + '…' : t;
  };
  const a = head(g.uids[0]), b = head(g.uids[g.uids.length - 1]);
  return g.uids.length > 1 && b ? `${a} ～ ${b}` : a;
}

/** 條目增刪、移動後整理：每組只留第一段相鄰的部分，已經在別組的不重複算；空的組拿掉 */
export function normalizeGroups(entries: Entry[], groups: EntryGroup[]): EntryGroup[] {
  const pos = new Map(entries.map((e, i) => [e.uid, i]));
  const taken = new Set<string>();
  let changed = false;
  const out: EntryGroup[] = [];
  for (const g of groups) {
    const idx = g.uids.map((u) => pos.get(u)).filter((i): i is number => i !== undefined && !taken.has(entries[i].uid)).sort((a, b) => a - b);
    const run: number[] = [];
    for (const i of idx) { if (run.length && i !== run[run.length - 1] + 1) break; run.push(i); }
    const uids = run.map((i) => entries[i].uid);
    uids.forEach((u) => taken.add(u));
    const same = uids.length === g.uids.length && uids.every((u, k) => u === g.uids[k]);
    if (!same) changed = true;
    if (uids.length) out.push(same ? g : { ...g, uids });
  }
  return changed ? out : groups;
}

/** 選到的條目收成新的一組：要相鄰、不能有已經在別組的；回傳新的清單，不能收時是 null */
export function createGroup(entries: Entry[], groups: EntryGroup[], indices: number[], name: string, id = newGroupId()): EntryGroup[] | null {
  const idx = [...new Set(indices)].filter((i) => entries[i]).sort((a, b) => a - b);
  if (!idx.length || idx.some((i, k) => k > 0 && i !== idx[k - 1] + 1)) return null;
  const inGroup = new Set(groups.flatMap((g) => g.uids));
  if (idx.some((i) => inGroup.has(entries[i].uid))) return null;
  return [...groups, { id, name: name.trim(), uids: idx.map((i) => entries[i].uid) }];
}

/** 從某一條的下方切開：上半沿用這一組，下半是新的一組（名稱空白，自動顯示） */
export function splitGroup(groups: EntryGroup[], afterUid: string, id = newGroupId()): EntryGroup[] {
  return groups.flatMap((g) => {
    const k = g.uids.indexOf(afterUid);
    if (k < 0 || k === g.uids.length - 1) return [g];
    return [{ ...g, uids: g.uids.slice(0, k + 1) }, { id, name: '', uids: g.uids.slice(k + 1), ...(g.auto ? { auto: true } : {}) }];
  });
}

/** 合併幾個收起組：從第一組的開頭到最後一組的結尾全部收成一組（中間的條目、別的組也收進來），名稱用第一組的 */
export function mergeGroups(entries: Entry[], groups: EntryGroup[], ids: string[]): EntryGroup[] {
  const pos = new Map(entries.map((e, i) => [e.uid, i]));
  const pick = groups.filter((g) => ids.includes(g.id) && g.uids.length);
  if (pick.length < 2) return groups;
  const span = (g: EntryGroup) => g.uids.map((u) => pos.get(u) ?? -1).filter((i) => i >= 0);
  const all = pick.flatMap(span);
  const a = Math.min(...all), b = Math.max(...all);
  const first = [...pick].sort((x, y) => Math.min(...span(x)) - Math.min(...span(y)))[0];
  const inside = (g: EntryGroup) => span(g).every((i) => i >= a && i <= b);
  const merged: EntryGroup = { ...first, uids: entries.slice(a, b + 1).map((e) => e.uid), ...(pick.some((g) => g.auto) ? { auto: true } : {}) };
  return groups.flatMap((g) => (g.id === first.id ? [merged] : inside(g) ? [] : [g]));
}

/** 自動收納：打開了的組，下面連著的條目是已驗證、又不在別組，就收進來 */
export function absorbVerified(entries: Entry[], groups: EntryGroup[], verified: (e: Entry) => boolean): EntryGroup[] {
  if (!groups.some((g) => g.auto)) return groups;
  const pos = new Map(entries.map((e, i) => [e.uid, i]));
  const taken = new Set(groups.flatMap((g) => g.uids));
  let changed = false;
  const out = groups.map((g) => {
    if (!g.auto || !g.uids.length) return g;
    let last = pos.get(g.uids[g.uids.length - 1]);
    if (last === undefined) return g;
    const add: string[] = [];
    while (entries[last + 1] && !taken.has(entries[last + 1].uid) && verified(entries[last + 1])) { add.push(entries[last + 1].uid); taken.add(entries[last + 1].uid); last++; }
    if (!add.length) return g;
    changed = true;
    return { ...g, uids: [...g.uids, ...add] };
  });
  return changed ? out : groups;
}

// ---- 顯示清單 ----

export type Item =
  /** 一般的條目（depth：在展開的組或串裡面；g、c：所在的展開的組、串，gEnd、cEnd：是那一組、串的最後一列） */
  | { t: 'row'; key: string; i: number; depth: number; inChain?: boolean; outlier?: boolean; g?: string; gEnd?: boolean; c?: string; cEnd?: boolean }
  /** 收起組的按鈕（收起時）或標題列（展開時） */
  | { t: 'group'; key: string; g: EntryGroup; open: boolean; members: number[]; shown: number }
  /** 收起的組裡沒顯示出來的連續幾條 */
  | { t: 'dots'; key: string; n: number; gid: string }
  /** 條目串（收起時代表整串；展開時是標題） */
  | { t: 'chain'; key: string; c: Chain; i: number; open: boolean; depth: number; g?: string; gEnd?: boolean };

export interface DisplayOpts {
  /** 有篩選或搜尋條件 */
  filtering: boolean;
  /** 符合篩選或搜尋 */
  pass(i: number): boolean;
  /** 收起時也要顯示出來的條目（搜尋命中、原文更新） */
  reveal(i: number): boolean;
  /** 串收起時也要單獨顯示的條目（原文更新） */
  revealInChain(i: number): boolean;
  groupOpen(id: string): boolean;
  chainOpen(id: string): boolean;
}

/** 把頁簽的條目變成要顯示的清單；rows 是畫面上算一列的條目位置（含收起的串的代表條目），posOf 是條目 → 第幾項（藏起來的條目指向它的組或串） */
export function buildDisplay(entries: Entry[], groups: EntryGroup[], chains: Chain[], o: DisplayOpts): { items: Item[]; rows: number[]; posOf: Map<number, number> } {
  const items: Item[] = [];
  const posOf = new Map<number, number>();
  const pos = new Map(entries.map((e, i) => [e.uid, i]));
  const gOf = new Map<string, EntryGroup>();
  groups.forEach((g) => g.uids.forEach((u) => gOf.set(u, g)));
  const cOf = new Map<number, Chain>();
  chains.forEach((c) => c.idx.forEach((i) => cOf.set(i, c)));
  const doneG = new Set<string>();
  const doneC = new Set<string>();
  const push = (it: Item, covers: number[]) => { const k = items.length; items.push(it); covers.forEach((i) => posOf.set(i, k)); };

  // 一段一般的條目（組外、或展開的組裡）：遇到條目串就照串的樣子顯示
  const segment = (idx: number[], depth: number) => {
    for (const i of idx) {
      const c = cOf.get(i);
      if (!c) {
        if (!o.filtering || o.pass(i)) push({ t: 'row', key: entries[i].uid, i, depth }, [i]);
        continue;
      }
      if (doneC.has(c.id)) continue;
      doneC.add(c.id);
      const hits = o.filtering ? c.idx.filter((m) => o.pass(m)) : c.idx;
      if (o.filtering && !hits.length) continue;
      const open = o.chainOpen(c.id);
      if (open) {
        push({ t: 'chain', key: 'c:' + c.id, c, i: c.rep, open: true, depth }, []);
        for (const m of hits) push({ t: 'row', key: entries[m].uid, i: m, depth: depth + 1, inChain: true, outlier: c.outliers.has(entries[m].uid) }, [m]);
      } else {
        const shown = c.idx.filter((m) => m !== c.rep && o.revealInChain(m));
        push({ t: 'chain', key: 'c:' + c.id, c, i: c.rep, open: false, depth }, c.idx.filter((m) => !shown.includes(m)));
        for (const m of shown) push({ t: 'row', key: entries[m].uid, i: m, depth: depth + 1, inChain: true, outlier: c.outliers.has(entries[m].uid) }, [m]);
      }
    }
  };

  let free: number[] = [];
  const flush = () => { if (free.length) segment(free, 0); free = []; };
  entries.forEach((e, i) => {
    const g = gOf.get(e.uid);
    if (!g) { free.push(i); return; }
    if (doneG.has(g.id)) return;
    flush();
    doneG.add(g.id);
    const members = g.uids.map((u) => pos.get(u)).filter((x): x is number => x !== undefined);
    if (o.groupOpen(g.id)) {
      if (o.filtering && !members.some((m) => o.pass(m))) return;
      push({ t: 'group', key: 'g:' + g.id, g, open: true, members, shown: members.length }, []);
      segment(members, 1);
      return;
    }
    // 打開了「自動收納已驗證條目」的組：收起時不參與篩選（照樣顯示成按鈕，不單獨顯示裡面的條目）
    const filtering = o.filtering && !g.auto;
    // 整組都符合（例如篩選「收起組」）：只顯示按鈕，不把每一條都列出來
    const allPass = filtering && members.every((m) => o.pass(m));
    const shown = members.filter((m) => (filtering && !allPass && o.pass(m)) || o.reveal(m));
    if (filtering && !members.some((m) => o.pass(m))) return;
    push({ t: 'group', key: 'g:' + g.id, g, open: false, members, shown: shown.length }, members.filter((m) => !shown.includes(m)));
    // 收起時顯示出來的條目：中間略過的用一列「…」表示
    let prev = -1;
    shown.forEach((m) => {
      const p = members.indexOf(m);
      if (p - prev > 1) push({ t: 'dots', key: `d:${g.id}:${p}`, n: p - prev - 1, gid: g.id }, []);
      push({ t: 'row', key: entries[m].uid, i: m, depth: 1 }, [m]);
      prev = p;
    });
    if (shown.length && members.length - 1 - prev > 0) push({ t: 'dots', key: `d:${g.id}:end`, n: members.length - 1 - prev, gid: g.id }, []);
  });
  flush();
  // 展開的組、串裡的每一列記下屬於哪一組、哪一串（左邊的導軌用），最後一列標出來（導軌末端往內折）
  items.forEach((h, k) => {
    if (h.t === 'group' && h.open) {
      let last = -1;
      for (let q = k + 1; q < items.length; q++) {
        const it = items[q];
        if ((it.t !== 'row' && it.t !== 'chain') || it.depth < 1) break;
        it.g = h.g.id;
        last = q;
      }
      if (last >= 0) (items[last] as { gEnd?: boolean }).gEnd = true;
    }
    if (h.t === 'chain' && h.open) {
      let last = -1;
      for (let q = k + 1; q < items.length; q++) {
        const it = items[q];
        if (it.t !== 'row' || !it.inChain || it.depth <= h.depth) break;
        it.c = h.c.id;
        last = q;
      }
      if (last >= 0) (items[last] as { cEnd?: boolean }).cEnd = true;
    }
  });
  const rows = items.flatMap((it) => (it.t === 'row' || (it.t === 'chain' && !it.open) ? [it.i] : []));
  return { items, rows, posOf };
}
