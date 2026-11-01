// 翻譯記憶跟團隊共用的 Google 表同步：一個專案一個分頁，新增、修改、刪除都是在最後加一列（不改別人的列）。
// 自己的變動幾秒內送上去；別人的變動每分鐘、打開雲端模式、切回 Verso 時下載（只讀上次之後多出來的列）。
// 「_verso」分頁記整理的次數（A1）和上次整理的時間（B1）：整理會重寫分頁，次數變了大家就從頭讀一次。
import { tx } from '../../i18n';
import { showToast, useStore } from '../../state/store';
import { ackOutbox, mergeRemote, setTmMeta, useTm, type TmOp } from '../../state/tm';
import { addTab, appendRows, clearTab, deleteTab, readFromMany, sidOf, tabGrids, trimGrid, writeRows } from './api';
import { useCloud } from './config';

const COLS = 7;
const HEADER = ['op', 'time', 'kind', 'id', 'data', '原文', '譯文'];
const META_TAB = '_verso';
const DAY = 86_400_000;
/** 退回紀錄留幾天（整理時比這更舊的作廢列才刪） */
const KEEP = 30 * DAY;
/** 多久整理一次 */
const COMPACT_EVERY = 30 * DAY;
/** 最後一列比這更舊才算沒人在寫 */
const IDLE = 10 * 60_000;

/** 一筆變動變成表上的一列 */
export function opToRow(op: TmOp): string[] {
  return op.k === 'put'
    ? [op.op, String(op.t), 'put', op.row.id, JSON.stringify(op.row), op.row.src, op.row.tgt]
    : [op.op, String(op.t), 'del', op.id, JSON.stringify({ id: op.id, project: op.project }), '', ''];
}

/** 表上的一列變回變動（看不懂的列不算） */
export function rowToOp(r: string[], project: string): TmOp | null {
  const [op, t, k, id, data] = r;
  const time = Number(t);
  if (!op || op === 'op' || !Number.isFinite(time)) return null;
  try {
    if (k === 'put') {
      const row = JSON.parse(data);
      if (!row || typeof row.src !== 'string' || typeof row.tgt !== 'string') return null;
      return { k: 'put', op, t: time, row: { ...row, id: row.id || id, project } };
    }
    if (k === 'del') return { k: 'del', op, t: time, id, project };
  } catch { /* 壞掉的列 */ }
  return null;
}

/** 整理：每條記憶只留最後一列；被取代、刪掉的舊列留 30 天 */
export function compactOps(ops: TmOp[], now: number): TmOp[] {
  const last = new Map<string, TmOp>();
  const idOf = (o: TmOp) => (o.k === 'put' ? o.row.id : o.id);
  for (const o of ops) { const p = last.get(idOf(o)); if (!p || p.t <= o.t) last.set(idOf(o), o); }
  return ops.filter((o) => {
    const keep = last.get(idOf(o)) === o;
    if (keep) return !(o.k === 'del' && now - o.t > KEEP);
    return now - o.t <= KEEP;
  });
}

interface SyncState { gen: number; n: Record<string, number> }
const stateKey = (sid: string) => 'sync:' + sid;
function stateOf(sid: string): SyncState {
  try { const s = JSON.parse(useTm.getState().meta[stateKey(sid)] ?? ''); if (s && typeof s.gen === 'number') return { gen: s.gen, n: s.n ?? {} }; } catch { /* 第一次 */ }
  return { gen: -1, n: {} };
}

/** 自己送出的變動（下載回來時不再套用一次） */
const mine = new Set<string>();
let busy: Promise<void> = Promise.resolve();
const serial = (fn: () => Promise<void>) => { busy = busy.then(fn, fn).catch(() => undefined); return busy; };
/** 這個試算表只有檢視權：不再上傳 */
let readOnly = '';
/** 開雲端模式時有還沒上傳的內容：使用者答應同步之前先不同步 */
let allowed = false;
let tabsCache: { sid: string; titles: Set<string> } | null = null;

const tmSid = () => (useStore.getState().cloudMode ? sidOf(useCloud.getState().cfg.tmUrl ?? '') : null);

type Grid = { gid: number; title: string; rows: number; cols: number };
let grids: Grid[] = [];
async function tabTitles(sid: string, fresh = false): Promise<Set<string>> {
  if (!fresh && tabsCache?.sid === sid) return tabsCache.titles;
  grids = await tabGrids(sid);
  tabsCache = { sid, titles: new Set(grids.map((t) => t.title)) };
  return tabsCache.titles;
}

/**
 * 自動修剪（跟雲端字典一樣只用用得到的格數）：多出來的空白列、欄刪掉；
 * 完全空白的分頁（例如新建試算表時的預設分頁）在還有別的分頁時刪掉。
 * used：各分頁有內容的列數（剛讀到的）
 */
async function trimTabs(sid: string, used: Record<string, number>) {
  if (readOnly === sid) return;
  await tabTitles(sid, true);
  const list = grids;
  for (const g of list) {
    const isMeta = g.title === META_TAB;
    const n = isMeta ? 1 : used[g.title];
    if (n === undefined) continue;
    if (n === 0) {
      if (!isMeta && list.length > 1) { await deleteTab(sid, g.gid); tabsCache = null; }
      continue;
    }
    const cols = isMeta ? 2 : COLS;
    if (g.rows <= n && g.cols <= cols) continue;
    // 刪列前再確認一次後面真的是空的（剛好有人在加列就下次再修）
    if (g.rows > n) {
      const [more] = await readFromMany(sid, [{ title: g.title, from: n }], cols);
      if (more?.length) continue;
    }
    await trimGrid(sid, g.gid, g, { rows: n, cols });
  }
}

async function ensureTab(sid: string, title: string) {
  const titles = await tabTitles(sid);
  if (titles.has(title)) return;
  const fresh = await tabTitles(sid, true);
  if (fresh.has(title)) return;
  await addTab(sid, title, COLS);
  await writeRows(sid, title, [{ row: 0, values: HEADER }]);
  fresh.add(title);
}

/** 上傳還沒送出的變動 */
async function upload() {
  const sid = tmSid();
  if (!sid || !allowed || readOnly === sid) return;
  const box = useTm.getState().outbox;
  if (!box.length) return;
  const by = new Map<string, { seqs: number[]; rows: string[][] }>();
  for (const { seq, op } of box.slice(0, 500)) {
    const p = op.k === 'put' ? op.row.project : op.project;
    let g = by.get(p);
    if (!g) { g = { seqs: [], rows: [] }; by.set(p, g); }
    g.seqs.push(seq);
    g.rows.push(opToRow(op));
  }
  for (const [p, g] of by) {
    try {
      await ensureTab(sid, p);
      g.rows.forEach((r) => mine.add(r[0]));
      await appendRows(sid, p, g.rows);
      ackOutbox(g.seqs);
    } catch (e) {
      const m = String((e as { message?: string })?.message ?? e);
      if (/^403\b/.test(m)) { readOnly = sid; showToast(tx('tm.readOnly'), { warn: true }); return; }
      return;
    }
  }
}

/** 下載別人的新變動 */
async function download() {
  const sid = tmSid();
  if (!sid || !allowed || !useTm.getState().loaded) return;
  try {
    const titles = await tabTitles(sid, true);
    let gen = 0, lastCompact = 0;
    if (titles.has(META_TAB)) {
      const [m] = await readFromMany(sid, [{ title: META_TAB, from: 0 }], 2);
      gen = Number(m?.[0]?.[0]) || 0;
      lastCompact = Number(m?.[0]?.[1]) || 0;
    }
    const st = stateOf(sid);
    const n = st.gen === gen ? { ...st.n } : {};
    const list = [...titles].filter((t) => t !== META_TAB).map((title) => ({ title, from: n[title] ?? 0 }));
    const got = await readFromMany(sid, list, COLS);
    const ops: TmOp[] = [];
    let lastT = 0;
    got.forEach((rows, i) => {
      const { title, from } = list[i];
      n[title] = from + rows.length;
      for (const r of rows) { const op = rowToOp(r, title); if (op) { ops.push(op); lastT = Math.max(lastT, op.t); } }
    });
    if (ops.length) mergeRemote(ops, mine);
    setTmMeta(stateKey(sid), JSON.stringify({ gen, n }));
    await trimTabs(sid, n);
    // 每個月整理一次，只在一陣子沒人寫入時
    if (readOnly !== sid && Date.now() - lastCompact > COMPACT_EVERY && (!ops.length || Date.now() - lastT > IDLE)) await compact(sid, gen);
  } catch (e) {
    const m = String((e as { message?: string })?.message ?? e);
    if (/^404\b/.test(m)) showToast(tx('tm.sheetNotFound'), { warn: true });
  }
}

/** 整理共用表：重寫每個分頁，只留需要的列；整理次數加一 */
async function compact(sid: string, gen: number) {
  const titles = [...(await tabTitles(sid, true))].filter((t) => t !== META_TAB);
  const all = await readFromMany(sid, titles.map((title) => ({ title, from: 0 })), COLS);
  const now = Date.now();
  // 讀完之後有人又寫了：這次不整理
  for (let i = 0; i < titles.length; i++) {
    const ops = all[i].map((r) => rowToOp(r, titles[i])).filter((o): o is TmOp => !!o);
    if (ops.some((o) => now - o.t < IDLE)) return;
  }
  const n: Record<string, number> = {};
  for (let i = 0; i < titles.length; i++) {
    const ops = all[i].map((r) => rowToOp(r, titles[i])).filter((o): o is TmOp => !!o);
    const kept = compactOps(ops, now);
    // 沒有內容的分頁不寫標題列（修剪時刪掉）
    if (!ops.length && all[i][0]?.[0] !== 'op') { n[titles[i]] = all[i].length; continue; }
    if (kept.length === ops.length && all[i][0]?.[0] === 'op') { n[titles[i]] = all[i].length; continue; }
    const rows = [HEADER, ...kept.map(opToRow)];
    await clearTab(sid, titles[i]);
    // 清空後接在最後面加，就是從第一列開始寫
    for (let k = 0; k < rows.length; k += 2000) await appendRows(sid, titles[i], rows.slice(k, k + 2000));
    n[titles[i]] = rows.length;
  }
  if (!(await tabTitles(sid)).has(META_TAB)) await addTab(sid, META_TAB, 2);
  await writeRows(sid, META_TAB, [{ row: 0, values: [String(gen + 1), String(now)] }]);
  setTmMeta(stateKey(sid), JSON.stringify({ gen: gen + 1, n }));
  await trimTabs(sid, n);
}

/** 手動整理（設定 > 雲端的按鈕） */
export function compactNow(): Promise<void> {
  return serial(async () => {
    const sid = tmSid();
    if (!sid) return;
    await download();
    try {
      const titles = await tabTitles(sid, true);
      let gen = 0;
      if (titles.has(META_TAB)) { const [m] = await readFromMany(sid, [{ title: META_TAB, from: 0 }], 1); gen = Number(m?.[0]?.[0]) || 0; }
      await compact(sid, gen);
      showToast(tx('tm.compacted'));
    } catch (e) { showToast(tx('tm.compactFailed', { reason: String((e as { message?: string })?.message ?? e) }), { warn: true }); }
  });
}

/** 馬上同步：下載、上傳 */
export const syncTmNow = () => serial(async () => { await download(); await upload(); });

/** 打開雲端模式（或換了記憶表）時：本地有還沒上傳的內容就先問 */
function onEnter() {
  const sid = tmSid();
  if (!sid) return;
  const n = useTm.getState().outbox.length;
  if (!n) { allowed = true; void syncTmNow(); return; }
  allowed = false;
  const ask = () => {
    if (!tmSid()) return;
    if (useCloud.getState().confirm) { setTimeout(ask, 3000); return; }
    useCloud.setState({ confirm: { title: tx('tm.syncAsk'), body: tx('tm.syncAskBody', { n }), ok: tx('tm.syncOk'), run: async () => { allowed = true; await syncTmNow(); } } });
  };
  ask();
}

let started = false;
export function startTmSync() {
  if (started) return;
  started = true;
  useStore.subscribe((s, prev) => {
    if (s.cloudMode && !prev.cloudMode) onEnter();
    if (!s.cloudMode && prev.cloudMode) allowed = false;
  });
  useCloud.subscribe((c, prev) => { if (c.cfg.tmUrl !== prev.cfg.tmUrl) { tabsCache = null; readOnly = ''; if (useStore.getState().cloudMode) onEnter(); } });
  // 換存檔資料夾（記憶檔換了一份）：重新讀
  useTm.subscribe((t, prev) => { if (t.loaded && !prev.loaded && useStore.getState().cloudMode) onEnter(); });
  if (useStore.getState().cloudMode) onEnter();
  // 自己的新記憶：攢幾秒一起送
  let upTimer: ReturnType<typeof setTimeout> | undefined;
  useTm.subscribe((t, prev) => {
    if (t.outbox.length > prev.outbox.length && allowed) { clearTimeout(upTimer); upTimer = setTimeout(() => void serial(upload), 3000); }
  });
  setInterval(() => { if (allowed) void syncTmNow(); }, 60_000);
  let lastFocus = 0;
  window.addEventListener('focus', () => { if (allowed && Date.now() - lastFocus > 10_000) { lastFocus = Date.now(); void syncTmNow(); } });
}
