// 雲端字典：一個專案一份 Google 試算表（網址記在「Verso專案」），每個頁簽是一本字典，
// A、B、C 欄固定是原文、譯文、備註，第一列是標題。
// - 打開雲端模式只讀頁簽名稱；勾選（啟用）的字典才讀內容，同步時也只重讀勾選的
// - 新增、修改、刪除詞條寫回那個頁簽（用內容找到那一列）；新增字典建新頁簽、改名改頁簽名、刪除字典刪頁簽
import { tx } from '../../i18n';
import { dictKey, type DictInfo, type GlossaryTerm } from '../../model/types';
import { currentProjectOf, dictEnabledIn, showToast, useStore } from '../../state/store';
import { addTab, appendRows, deleteRows, deleteTab, errText, readTabs, renameTab, sidOf, tabGrids, writeRows } from './api';

const DICT_HEAD = ['原文', '譯文', '備註'];
type Content = { term: string; en: string; note: string };
/** 每本雲端字典最後一次跟 Google 對上的樣子（sid:gid → …）；terms 是 null 代表還沒讀內容 */
const known = new Map<string, { sid: string; gid: number; title: string; terms: Map<string, Content> | null }>();
const kOf = (sid: string, gid: number) => sid + ':' + gid;
const same = (a: Content, b: Content) => a.term === b.term && a.en === b.en && a.note === b.note;
let seq = 0;

/** 各專案字典檔裡有哪些頁簽：新的列出來（還沒讀內容），別人刪掉的拿掉，別人改名的跟著改 */
export async function listDicts() {
  const files = Object.entries(useStore.getState().cloudDictFile);
  const seen = new Set<string>();
  for (const [project, sid] of files) {
    let grids: { gid: number; title: string }[];
    try { grids = await tabGrids(sid); } catch (e) { showToast(tx('cloud.loadFailed', { name: project, reason: errText(e) }), { warn: true }); continue; }
    const p = useStore.getState().project!;
    let dicts = p.dicts;
    let glossary = p.glossary;
    for (const t of grids) {
      const k = kOf(sid, t.gid);
      seen.add(k);
      const cur = dicts.find((d) => d.cloud?.sid === sid && d.cloud.gid === t.gid);
      const kn = known.get(k);
      if (!cur) {
        // 同專案已經有同名的字典（例如本地字典）：不列，免得分不清
        if (dicts.some((d) => d.project === project && d.name === t.title)) continue;
        dicts = [...dicts, { project, name: t.title, cloud: { sid, gid: t.gid }, unloaded: true }];
        known.set(k, { sid, gid: t.gid, title: t.title, terms: null });
      } else if (kn && kn.title !== t.title && cur.name === kn.title) {
        // 別人改了頁簽名稱：跟著改（自己改名還沒寫回的不動）
        const old = cur.name;
        dicts = dicts.map((d) => (d === cur ? { ...d, name: t.title } : d));
        glossary = glossary.map((g) => (g.proj === cur.project && g.dict === old ? { ...g, dict: t.title } : g));
        kn.title = t.title;
      }
    }
    // 別人刪掉的頁簽：拿掉
    const gone = dicts.filter((d) => d.cloud?.sid === sid && d.cloud.gid >= 0 && !seen.has(kOf(sid, d.cloud.gid)));
    if (gone.length) {
      gone.forEach((d) => known.delete(kOf(sid, d.cloud!.gid)));
      const goneKeys = new Set(gone.map((d) => dictKey(d.project, d.name)));
      dicts = dicts.filter((d) => !gone.includes(d));
      glossary = glossary.filter((g) => !goneKeys.has(dictKey(g.proj, g.dict)));
    }
    if (dicts !== p.dicts || glossary !== p.glossary) useStore.setState({ project: { ...useStore.getState().project!, dicts, glossary } });
  }
  // 專案拿掉了字典檔：那些雲端字典也拿掉
  const sids = new Set(files.map(([, sid]) => sid));
  removeDicts((d) => !!d.cloud && !sids.has(d.cloud.sid));
}

/** 把雲端字典（和它們的詞條）從軟體裡拿掉（關掉雲端模式、專案換了字典檔時） */
export function removeDicts(which: (d: DictInfo) => boolean = (d) => !!d.cloud) {
  const p = useStore.getState().project;
  if (!p) return;
  const out = p.dicts.filter(which);
  if (!out.length) return;
  out.forEach((d) => d.cloud && known.delete(kOf(d.cloud.sid, d.cloud.gid)));
  const keys = new Set(out.map((d) => dictKey(d.project, d.name)));
  useStore.setState({ project: { ...p, dicts: p.dicts.filter((d) => !out.includes(d)), glossary: p.glossary.filter((g) => !keys.has(dictKey(g.proj, g.dict))) } });
}

const loading = new Set<string>();
/** 讀一本雲端字典的內容 */
async function loadDict(d: DictInfo) {
  const c = d.cloud!;
  const k = kOf(c.sid, c.gid);
  if (loading.has(k)) return;
  loading.add(k);
  try {
    const [rows] = await readTabs(c.sid, [d.name]);
    const list: Content[] = rows.slice(1).map((r) => ({ term: (r[0] ?? '').trim(), en: (r[1] ?? '').trim(), note: (r[2] ?? '').trim() })).filter((x) => x.term || x.en);
    const p = useStore.getState().project!;
    const now = p.dicts.find((x) => x.cloud?.sid === c.sid && x.cloud.gid === c.gid);
    if (!now) return;
    // 讀取途中使用者又改了詞條：不要用讀回來的內容蓋掉，下次同步再讀
    if (pending(now)) return;
    const terms: GlossaryTerm[] = list.map((x) => ({ id: `c${c.gid}_${(seq++).toString(36)}`, ...x, dict: now.name, proj: now.project }));
    known.set(k, { sid: c.sid, gid: c.gid, title: now.name, terms: new Map(terms.map((t) => [t.id, { term: t.term, en: t.en, note: t.note }])) });
    const mine = (g: GlossaryTerm) => g.proj === now.project && g.dict === now.name;
    useStore.setState({ project: { ...p, dicts: p.dicts.map((x) => (x === now ? { ...x, unloaded: undefined } : x)), glossary: [...p.glossary.filter((g) => !mine(g)), ...terms] } });
  } catch (e) {
    showToast(tx('cloud.loadFailed', { name: d.name, reason: errText(e) }), { warn: true });
  } finally { loading.delete(k); }
}

/** 啟用中、還沒讀的雲端字典：讀進來 */
export function loadEnabled() {
  const s = useStore.getState();
  if (!s.project || !s.cloudMode) return;
  const cur = currentProjectOf(s);
  s.project.dicts.filter((d) => d.cloud && d.unloaded && d.cloud.gid >= 0 && dictEnabledIn(cur, s.dictOverrides, d)).forEach((d) => void loadDict(d));
}

/** 同步：沒有還沒寫回的修改的字典重新讀（只讀勾選的、已讀過的） */
export async function reloadDicts() {
  await listDicts();
  const p = useStore.getState().project!;
  for (const d of p.dicts.filter((x) => x.cloud && !x.unloaded && x.cloud.gid >= 0)) {
    if (!pending(d)) await loadDict(d);
  }
}

/** 這本字典有沒有還沒寫回的修改 */
function pending(d: DictInfo): boolean {
  const kn = known.get(kOf(d.cloud!.sid, d.cloud!.gid));
  if (!kn?.terms) return false;
  if (kn.title !== d.name) return true;
  const mine = useStore.getState().project!.glossary.filter((g) => g.proj === d.project && g.dict === d.name);
  return mine.length !== kn.terms.size || mine.some((g) => { const b = kn.terms!.get(g.id); return !b || !same(b, g); });
}

// ---- 寫回 ----
let chain: Promise<unknown> = Promise.resolve();
const serial = (fn: () => Promise<void>) => { const r = chain.then(fn, fn); chain = r.catch(() => undefined); return r; };

/** 把雲端字典的修改寫回 Google */
export function flushDicts(): Promise<void> {
  return serial(async () => {
    const p0 = useStore.getState().project;
    if (!p0) return;
    // 新字典：在字典檔裡建一個新頁簽
    for (const d of p0.dicts.filter((x) => x.cloud && x.cloud.gid < 0)) {
      try {
        const gid = await addTab(d.cloud!.sid, d.name, DICT_HEAD.length);
        await writeRows(d.cloud!.sid, d.name, [{ row: 0, values: DICT_HEAD }]);
        known.set(kOf(d.cloud!.sid, gid), { sid: d.cloud!.sid, gid, title: d.name, terms: new Map() });
        const p = useStore.getState().project!;
        useStore.setState({ project: { ...p, dicts: p.dicts.map((x) => (x.project === d.project && x.name === d.name && x.cloud?.gid === -1 ? { ...x, cloud: { sid: d.cloud!.sid, gid } } : x)) } });
      } catch (e) { showToast(tx('cloud.writeFailed', { name: d.name, reason: errText(e) }), { warn: true }); }
    }
    const p = useStore.getState().project!;
    // 刪掉的字典：刪掉頁簽
    const live = new Set(p.dicts.filter((d) => d.cloud).map((d) => kOf(d.cloud!.sid, d.cloud!.gid)));
    const files = new Set(Object.values(useStore.getState().cloudDictFile));
    for (const [k, kn] of [...known]) {
      if (live.has(k) || !files.has(kn.sid)) continue;
      try { await deleteTab(kn.sid, kn.gid); known.delete(k); } catch (e) { showToast(tx('cloud.writeFailed', { name: kn.title, reason: errText(e) }), { warn: true }); known.delete(k); }
    }
    for (const d of p.dicts.filter((x) => x.cloud && x.cloud.gid >= 0)) {
      const kn = known.get(kOf(d.cloud!.sid, d.cloud!.gid));
      if (!kn) continue;
      const { sid, gid } = d.cloud!;
      try {
        // 改名：改頁簽名稱
        if (kn.title !== d.name) { await renameTab(sid, gid, d.name); kn.title = d.name; }
        if (!kn.terms) continue;
        const mine = p.glossary.filter((g) => g.proj === d.project && g.dict === d.name);
        const changed = mine.filter((g) => kn.terms!.has(g.id) && !same(kn.terms!.get(g.id)!, g));
        const added = mine.filter((g) => !kn.terms!.has(g.id));
        const ids = new Set(mine.map((g) => g.id));
        const removed = [...kn.terms].filter(([id]) => !ids.has(id)).map(([, c]) => c);
        if (!changed.length && !added.length && !removed.length) continue;
        // 用內容找列（別人可能插入或刪除了列）
        const [rows] = await readTabs(sid, [d.name]);
        const used = new Set<number>();
        const find = (c: Content) => {
          for (let r = 1; r < rows.length; r++) {
            if (used.has(r)) continue;
            const v = rows[r];
            if ((v[0] ?? '').trim() === c.term && (v[1] ?? '').trim() === c.en && (v[2] ?? '').trim() === c.note) { used.add(r); return r; }
          }
          return -1;
        };
        const updates: { row: number; values: string[] }[] = [];
        const appends: string[][] = [];
        for (const g of changed) {
          const r = find(kn.terms.get(g.id)!);
          if (r >= 0) updates.push({ row: r, values: [g.term, g.en, g.note] }); else appends.push([g.term, g.en, g.note]);
        }
        const dels = removed.map(find).filter((r) => r >= 0);
        added.forEach((g) => appends.push([g.term, g.en, g.note]));
        await writeRows(sid, d.name, updates);
        await deleteRows(sid, gid, dels);
        if (appends.length) await appendRows(sid, d.name, appends);
        kn.terms = new Map(mine.map((g) => [g.id, { term: g.term, en: g.en, note: g.note }]));
      } catch (e) { showToast(tx('cloud.writeFailed', { name: d.name, reason: errText(e) }), { warn: true }); }
    }
  });
}

/** 雲端字典有變動：稍後寫回；勾選了還沒讀的字典：讀進來 */
export function watchDicts() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  useStore.subscribe((s, prev) => {
    if (!s.cloudMode || !s.project || !prev.project) return;
    if (s.project.dicts !== prev.project.dicts || s.project.glossary !== prev.project.glossary) {
      if (s.project.dicts.some((d) => d.cloud)) { clearTimeout(timer); timer = setTimeout(() => void flushDicts(), 800); }
    }
    if (s.project.dicts !== prev.project.dicts || s.dictOverrides !== prev.dictOverrides || s.file !== prev.file) loadEnabled();
  });
}

/** 字典檔網址（給專案管理顯示用） */
export const dictSidOf = (url: string) => sidOf(url) ?? '';
