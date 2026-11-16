import { useScrollTabs } from './ScrollTabs';
import { tx } from '../i18n';
import { MAX_CELL_CHARS } from '../model/names';
import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { currentOf, shownSrc, currentProjectOf, dictEnabledIn, overrideKey, searchHit, useStore, useStorePick, type SideTab, currentFileStd, isShown, dictDefaultOn, ensureUserName } from '../state/store';
import { CommentsPanel } from './comments/CommentsPanel';
import { CompactCtx, compactCard, shrink } from './compact';
import { useContext } from 'react';
import { Splitter } from './Splitter';
import { SHARED, dictKey, type DictInfo, type FileDoc, type GlossaryTerm } from '../model/types';
import { fz } from '../model/fonts';
import { enabledIssues } from '../model/checks';
import { effectiveStd } from '../model/length';
import { findHits, foldText, useActiveTerms } from '../state/dictHits';
import { bestRank, sortByRank } from '../model/matchRank';
import { leaveFile } from '../state/saver';
import { ContextMenu } from './ContextMenu';
import { sideFieldKey } from './Shortcuts';
import {
  IconBook, IconBookmark, IconCheck, IconChevD, IconCopy, IconChevL, IconChevR, IconFile, IconGlobe, IconHideRight, IconList, IconPaste, IconPenEdit, IconPlus, IconRefresh, IconSearch, IconUse, IconWarn, IconSheet, IconCopyPair, IconArrowR,
} from './icons';
import { TmBlock, TmTab } from './TmPanel';
import { DEFAULT_GENERAL, type GeneralBlock } from '../state/store';

const TABS: { id: SideTab; label: string; Icon: typeof IconBook }[] = [
  { id: 'general', get label() { return tx('side.general'); }, Icon: IconSheet },
  { id: 'dict', get label() { return tx('side.001'); }, Icon: IconBook },
  { id: 'tm', get label() { return tx('side.tm'); }, Icon: IconCopyPair },
  { id: 'search', get label() { return tx('side.002'); }, Icon: IconSearch },
  { id: 'web', get label() { return tx('side.003'); }, Icon: IconGlobe },
  { id: 'ref', get label() { return tx('side.004'); }, Icon: IconBookmark },
];

/** 專案標籤 */
export function ProjTag({ name }: { name: string }) {
  return (
    <span style={{ flexShrink: 0, fontSize: fz(10.5), padding: '1px 7px', borderRadius: 10, whiteSpace: 'nowrap', color: 'var(--mute)', border: '1px solid var(--line3)' }}>{name}</span>
  );
}

function TermCard({ g, altKey }: { g: GlossaryTerm; altKey?: number }) {
  const c = useContext(CompactCtx);
  const lh = c ? 1.35 : 1.5;
  const set = useStore((s) => s.set);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(g.en).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); });
  };
  const proper = g.dict === '專有名詞';
  return (
    <div className="card" style={compactCard(c)}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: fz(c ? 13 : 15), fontWeight: 500 }}>{g.term}</span>
          {altKey && <span className="mono" title={tx('side.006', { altKey })} style={{ fontSize: fz(10.5), color: 'var(--mute)', padding: '1px 5px', border: '1px solid var(--line3)', borderRadius: 4 }}>Alt+{altKey}</span>}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <ProjTag name={g.proj} />
        <span style={{
          fontSize: fz(10.5), padding: '2px 7px', borderRadius: 10, whiteSpace: 'nowrap',
          color: proper ? 'var(--warntx)' : 'var(--accent3)', background: proper ? 'rgba(240,165,74,0.14)' : 'var(--acc-soft)',
        }}>{g.dict}</span>
        </span>
      </div>
      <div style={{ fontSize: fz(shrink(c, 14)), lineHeight: lh, color: 'var(--accent3)' }}>{g.en}</div>
      <div style={{ fontSize: fz(shrink(c, 12)), lineHeight: lh, color: 'var(--text2)', paddingRight: 56 }}>{g.note || '—'}</div>
      <button type="button" className="ib" aria-label={tx('side.007', { term: g.term })} title={tx('side.008')}
        onClick={() => set({ termDraft: { id: g.id, term: g.term, en: g.en, note: g.note, dict: g.dict, proj: g.proj } })}
        style={{ position: 'absolute', right: 34, bottom: 6, width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'transparent', border: 0, borderRadius: 6, color: 'var(--mute)' }}>
        <IconPenEdit size={13} sw={2.2} />
      </button>
      <button type="button" className="ib" aria-label={tx('side.009', { en: g.en })} title={copied ? tx('side.010') : tx('side.011')} onClick={copy}
        style={{ position: 'absolute', right: 6, bottom: 6, width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'transparent', border: 0, borderRadius: 6, color: copied ? 'var(--accent2)' : 'var(--mute)' }}>
        {copied ? <IconCheck size={13} sw={2.4} /> : <IconCopy size={13} />}
      </button>
    </div>
  );
}

const DICT_BATCH = 50;

function DictTab() {
  // 只訂閱字典分頁用得到的值：打譯文時這些都不變，這一頁就不會重畫
  const { glossary, dicts, dq, overrides, current, uid, src } = useStore(useShallow((s) => ({
    glossary: s.project!.glossary,
    dicts: s.project!.dicts,
    dq: s.dictQuery,
    overrides: s.dictOverrides,
    current: currentProjectOf(s),
    uid: currentOf(s).entry?.uid ?? '',
    src: currentOf(s).entry ? shownSrc(currentOf(s).entry!) : '',
  })));
  const set = useStore((s) => s.set);
  // 雲端模式：字典標示是雲端還是本地
  const cloudMode = useStore((s) => s.cloudMode);
  const [pickOpen, setPickOpen] = useState(false);
  const [dictMenu, setDictMenu] = useState<{ d: DictInfo; x: number; y: number } | null>(null);
  const q = dq.trim(), ql = q.toLowerCase();
  const isOn = (d: DictInfo) => dictEnabledIn(current, overrides, d);
  // 只查啟用中的字典；字典內容或開關變了才重算
  const on = useMemo(() => new Set(dicts.filter(isOn).map((d) => dictKey(d.project, d.name))), [dicts, overrides, current]);
  const active = useMemo(() => glossary.filter((g) => on.has(dictKey(g.proj, g.dict))), [glossary, on]);
  // 命中：和工作欄共用同一份啟用中的詞條，字典整理和命中結果都只算一次
  const hitTerms = useActiveTerms();
  // 不分大小寫、全形半形（跟原文比對的規則一樣）
  // 每個詞條的 foldText 只在啟用中的詞條變了才算（10 萬條時每次搜尋都重算要 180ms）
  const folded = useMemo(() => active.map((g) => [foldText(g.term), foldText(g.en)] as const), [active]);
  const results = useMemo(() => {
    if (!ql) return [];
    const fq = foldText(q);
    // 最相符排序：完全相同 → 單字完全相同 → 單字開頭相同 → 在中間（同一級照原本順序）
    const idx = active.map((_, i) => i).filter((i) => folded[i][0].includes(fq) || folded[i][1].includes(fq));
    return sortByRank(idx, (i) => bestRank([folded[i][0], folded[i][1]], fq)).map((i) => active[i]);
  }, [active, folded, q]);
  // 搜尋結果先顯示 50 筆，捲到底再顯示下一批
  const [shown, setShown] = useState(DICT_BATCH);
  useEffect(() => { setShown(DICT_BATCH); }, [q]);
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = moreRef.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) setShown((n) => n + DICT_BATCH); });
    io.observe(el);
    return () => io.disconnect();
  }, [shown, results]);
  // 命中的詞條：換條目時馬上算；同一條的原文在改時，停下來一下才算
  const [srcNow, setSrcNow] = useState({ uid, src });
  useEffect(() => {
    if (uid !== srcNow.uid) { setSrcNow({ uid, src }); return; }
    if (src === srcNow.src) return;
    const t = setTimeout(() => setSrcNow({ uid, src }), 250);
    return () => clearTimeout(t);
  }, [uid, src]);
  const matchSrc = uid !== srcNow.uid ? src : srcNow.src;
  // 同一個原文在好幾本字典有不同譯名時，全部列出來
  const matches = useMemo(() => findHits(matchSrc, hitTerms, current).flatMap((h, k) => h.terms.map((g, j) => ({ g, alt: j === 0 && k < 9 ? k + 1 : undefined }))), [hitTerms, matchSrc, current]);
  // 目前專案的字典排最前面，再來是共用，其他照原本順序
  const rank = (d: DictInfo) => (d.project === current ? 0 : d.project === SHARED ? 1 : 2);
  const sorted = [...dicts].sort((a, b) => rank(a) - rank(b));
  const toggleDict = (d: DictInfo) => {
    const k = overrideKey(current, d);
    const auto = dictDefaultOn(current, d);
    const next = { ...overrides };
    // 跟預設一樣就不必記
    if (!isOn(d) === auto) delete next[k]; else next[k] = !isOn(d);
    set({ dictOverrides: next });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label htmlFor="verso-dict" className="sr-only">{tx('side.012')}</label>
      {/* 輸入框列固定在上方，捲動時不會被捲走 */}
      <div style={{ ...stickyTab, flexDirection: 'row', gap: 6 }}>
        <div style={{ position: 'relative', flexGrow: 1, minWidth: 0 }}>
          <IconSearch size={14} stroke="var(--mute)" style={{ position: 'absolute', left: 11, top: 11, pointerEvents: 'none' }} />
          <input id="verso-dict" type="search" className="field" value={dq} onChange={(ev) => set({ dictQuery: ev.target.value })}
            placeholder={tx('side.013')} style={{ width: '100%', padding: '0 12px 0 32px' }} />
        </div>
        <button type="button" className="ib" aria-label={tx('side.014')} title={tx('side.014')}
          onClick={() => set({ termDraft: { id: null, term: q && results.length === 0 ? q : '', en: '', note: '', dict: dicts.find((d) => d.project === current)?.name ?? '', proj: current } })}
          style={{ width: 36, height: 36, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, color: 'var(--text2)' }}>
          <IconPlus size={15} sw={2.2} />
        </button>
        <button type="button" className="ib" aria-label={tx('side.015')} title={tx('side.015')} onClick={() => set({ dictPasteOpen: true })}
          style={{ width: 36, height: 36, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, color: 'var(--text2)' }}>
          <IconPaste size={15} />
        </button>
        <button type="button" className="ib" aria-label={tx('side.016')} title={tx('side.016')} onClick={() => set({ manageDictsOpen: true })}
          style={{ width: 36, height: 36, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, color: 'var(--text2)' }}>
          <IconList size={15} />
        </button>
      </div>
      <div>
        <button type="button" className="ib" aria-expanded={pickOpen} onClick={() => setPickOpen(!pickOpen)}
          style={{ height: 26, display: 'flex', alignItems: 'center', gap: 6, padding: '0 6px 0 2px', background: 'transparent', border: 0, borderRadius: 6, color: 'var(--text2)', fontSize: fz(12) }}>
          <IconChevD size={12} sw={2.4} style={{ transform: `rotate(${pickOpen ? 0 : -90}deg)`, transition: 'transform 160ms' }} />
          {tx('side.017')}
          <span style={{ color: 'var(--mute)' }}>{on.size} / {dicts.length}</span>
        </button>
        {pickOpen && (
          <div role="group" aria-label={tx('side.017')} style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4, padding: 4, background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 8 }}>
            {sorted.map((d) => (
              <label key={dictKey(d.project, d.name)} className="dd"
                onContextMenu={(ev) => { ev.preventDefault(); setDictMenu({ d, x: ev.clientX, y: ev.clientY }); }} style={{ height: 30, display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px', borderRadius: 6, cursor: 'pointer', fontSize: fz(12.5) }}>
                <span style={{ flexGrow: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{d.name}</span>
                {cloudMode && <ProjTag name={d.cloud ? tx('dict.cloud') : tx('dict.local')} />}
                <ProjTag name={d.project} />
                <input type="checkbox" role="switch" className="switch" aria-label={d.project + ' ' + d.name}
                  checked={on.has(dictKey(d.project, d.name))} onChange={() => toggleDict(d)} />
              </label>
            ))}
          </div>
        )}
      </div>
      {dq && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: fz(11.5), color: 'var(--mute)' }}>{tx('side.018', { n: results.length })}</div>
          {results.slice(0, shown).map((g) => <TermCard key={g.id} g={g} />)}
          {results.length > shown && <div ref={moreRef} style={{ height: 1 }} />}
          {results.length === 0 && <div className="empty" style={{ padding: '20px 12px' }}>{tx('side.020', { q: dq })}</div>}
          <div style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />
        </div>
      )}
      <div style={{ fontSize: fz(11.5), color: 'var(--mute)' }}>{tx('side.021', { n: matches.length })}</div>
      {matches.map(({ g, alt }) => <TermCard key={g.id} g={g} altKey={alt} />)}
      {matches.length === 0 && <div className="empty" style={{ padding: '32px 12px' }}>{tx('side.023')}</div>}
      {dictMenu && (
        <ContextMenu x={dictMenu.x} y={dictMenu.y} label={tx('side.024', { name: dictMenu.d.name })} items={[{ key: 'move', label: tx('side.025') }]}
          onPick={() => { set({ moveTarget: { kind: 'dict', project: dictMenu.d.project, name: dictMenu.d.name } }); setDictMenu(null); }}
          onClose={() => setDictMenu(null)} />
      )}
    </div>
  );
}

interface SearchHit { f: number; sh: number; i: number; where: string; src: string; tgt: string; rank: number }

/** 搜尋範圍：當前頁簽 → 當前檔案 → 當前專案 → 所有專案 */
const SCOPES = ['sheet', 'file', 'project', 'all'] as const;
type Scope = (typeof SCOPES)[number];

/** 在範圍內找出所有符合的條目，照最相符排序（同一級照原本順序） */
function searchAll(files: FileDoc[], q: string, scope: Scope, at: { file: number; sheet: number; cloudMode: boolean }): SearchHit[] {
  const hits: SearchHit[] = [];
  const cur = files[at.file];
  files.forEach((file, f) => {
    // 這個模式看不到的檔案（雲端／本地）不搜
    if (!isShown({ cloudMode: at.cloudMode }, file)) return;
    if ((scope === 'sheet' || scope === 'file') && f !== at.file) return;
    if (scope === 'project' && file.project !== cur?.project) return;
    file.sheets.forEach((sheet, sh) => {
      if (scope === 'sheet' && sh !== at.sheet) return;
      sheet.entries.forEach((e, i) => {
        if (!searchHit(e, q)) return;
        const src = shownSrc(e);
        hits.push({ f, sh, i, where: `${file.project} · ${file.name} · ${sheet.name} · #${e.id || i + 1}`, src, tgt: e.tgt || tx('side.026'), rank: q.startsWith('#') ? bestRank([e.id], q.slice(1)) : bestRank([src, e.tgt, e.id], q) });
      });
    });
  });
  return sortByRank(hits, (h) => h.rank);
}

const SEARCH_BATCH = 20;

/** 依實際位置排：檔案、頁簽、列的順序 */
const byPos = (a: { f: number; sh: number; i: number }, b: { f: number; sh: number; i: number }) => a.f - b.f || a.sh - b.sh || a.i - b.i;

/** 綜合和搜尋分頁可能同時要同一份結果：同樣的條件只算一次 */
let lastSearch: { files: FileDoc[]; q: string; scope: Scope; file: number; sheet: number; cloudMode: boolean; out: SearchHit[] } | null = null;
function cachedSearch(files: FileDoc[], q: string, scope: Scope, at: { file: number; sheet: number; cloudMode: boolean }): SearchHit[] {
  if (!q) return [];
  const L = lastSearch;
  if (L && L.files === files && L.q === q && L.scope === scope && L.file === at.file && L.sheet === at.sheet && L.cloudMode === at.cloudMode) return L.out;
  const out = searchAll(files, q, scope, at);
  lastSearch = { files, q, scope, ...at, out };
  return out;
}

/** 搜尋字、範圍和結果（綜合、搜尋分頁共用；停止打字 0.3 秒後才搜） */
function useSearch() {
  const files = useStore((s) => s.project!.files);
  const q = useStore((s) => s.searchQuery);
  const scope = useStore((s) => s.searchScope);
  const at = useStore(useShallow((s) => ({ file: s.file, sheet: currentOf(s).sheetIdx, cloudMode: s.cloudMode })));
  const [dq, setDq] = useState(q.trim());
  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const deferredFiles = useDeferredValue(files);
  const results = useMemo(() => cachedSearch(deferredFiles, dq, scope, at), [dq, deferredFiles, scope, at]);
  return { files, q, dq, scope, results };
}

/**
 * 跳到上一筆／下一筆符合的條目：照目前條目的實際位置（檔案、頁簽、列順序）找前後最近的一筆，
 * 到頭了從另一頭接著找
 */
function jumpSearch(dir: 1 | -1) {
  const s = useStore.getState();
  const q = s.searchQuery.trim();
  if (!q || !s.project) return;
  const c = currentOf(s);
  const at = { file: s.file, sheet: c.sheetIdx, cloudMode: s.cloudMode };
  const hits = [...cachedSearch(s.project.files, q, s.searchScope, at)].sort(byPos);
  if (!hits.length) return;
  const here = { f: s.file, sh: c.sheetIdx, i: c.sel };
  const h = dir > 0
    ? hits.find((x) => byPos(x, here) > 0) ?? hits[0]
    : [...hits].reverse().find((x) => byPos(x, here) < 0) ?? hits[hits.length - 1];
  leaveFile(s.project.files[h.f] ?? null, (idx) => {
    if (idx < 0) return;
    useStore.getState().select(idx, h.sh, h.i);
    // 搜尋結果清單也捲到這一筆
    window.dispatchEvent(new CustomEvent(SEARCH_JUMP, { detail: { f: idx, sh: h.sh, i: h.i } }));
  });
}

/** 跳到上一筆／下一筆之後通知搜尋結果清單捲到那一筆 */
const SEARCH_JUMP = 'verso-search-jump';

/** 搜尋框按 Enter 跳下一筆，Shift＋Enter 跳上一筆 */
const searchKey = (ev: React.KeyboardEvent) => {
  if (ev.key !== 'Enter' || ev.nativeEvent.isComposing) return;
  ev.preventDefault();
  ev.stopPropagation();
  jumpSearch(ev.shiftKey ? -1 : 1);
};

/** 上一筆（∧）、下一筆（∨）的圖示 */
function NavChevron({ up }: { up?: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d={up ? 'M2.5 7.75 6 4.25l3.5 3.5' : 'M2.5 4.25 6 7.75l3.5-3.5'} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 筆數（目前條目在結果裡時是「第幾筆/共幾筆」）和上一筆、下一筆按鈕 */
function SearchNav({ results, dq }: { results: SearchHit[]; dq: string }) {
  const here = useStore(useShallow((s) => { const c = currentOf(s); return { f: s.file, sh: c.sheetIdx, i: c.sel }; }));
  const sorted = useMemo(() => [...results].sort(byPos), [results]);
  if (!dq) return null;
  const k = sorted.findIndex((h) => byPos(h, here) === 0);
  const n = sorted.length;
  const btn: React.CSSProperties = { width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'transparent', border: 0, borderRadius: 5, color: 'var(--text2)' };
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
      <span role="status" className="mono" style={{ fontSize: fz(11.5), color: 'var(--mute)', marginRight: 4 }}>{k >= 0 ? `${k + 1}/${n}` : n}</span>
      <button type="button" className="ib" aria-label={tx('side.searchPrev')} title={tx('side.searchPrev') + ' (Shift+Enter)'} disabled={!n} onClick={() => jumpSearch(-1)} style={btn}><NavChevron up /></button>
      <button type="button" className="ib" aria-label={tx('side.searchNext')} title={tx('side.searchNext') + ' (Enter)'} disabled={!n} onClick={() => jumpSearch(1)} style={btn}><NavChevron /></button>
    </span>
  );
}

/** 綜合分頁搜尋區塊的標題列右邊：筆數和上一筆、下一筆 */
function SearchBlockNav() {
  const { dq, results } = useSearch();
  return <SearchNav results={results} dq={dq} />;
}

/** 搜尋範圍的圖標：由小到大重疊的四個矩形，目前的範圍是實心 */
function ScopeIcon({ scope }: { scope: Scope }) {
  const k = SCOPES.indexOf(scope);
  // 從大畫到小，小的疊在上面看得到
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      {[3, 2, 1, 0].map((i) => {
        const s = 6 + i * 3.5;
        return <rect key={i} x={1.5} y={16.5 - s} width={s} height={s} rx={1.2} fill={i === k ? 'currentColor' : 'var(--card)'} fillOpacity={i === k ? 0.85 : 1} stroke="currentColor" strokeWidth={1.3} />;
      })}
    </svg>
  );
}

/** 搜尋範圍按鈕：點一下換下一個範圍（綜合、搜尋分頁共用同一個範圍） */
function ScopeButton({ size }: { size: number }) {
  const scope = useStore((s) => s.searchScope);
  const scopeName = tx(('side.scope.' + scope) as 'side.scope.sheet');
  return (
    <button type="button" className="ib" aria-label={tx('side.scope', { scope: scopeName })} title={scopeName}
      onClick={() => useStore.getState().set({ searchScope: SCOPES[(SCOPES.indexOf(scope) + 1) % SCOPES.length] })}
      style={{ width: size, height: size, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, color: 'var(--text2)' }}>
      <ScopeIcon scope={scope} />
    </button>
  );
}

/** 搜尋結果：先顯示一批，捲到底再顯示下一批 */
function SearchResults({ results, files, dq, q, compact }: { results: SearchHit[]; files: FileDoc[]; dq: string; q: string; compact?: boolean }) {
  const scope = useStore((s) => s.searchScope);
  const select = useStore((s) => s.select);
  const [shown, setShown] = useState(SEARCH_BATCH);
  useEffect(() => { setShown(SEARCH_BATCH); }, [dq, scope]);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) setShown((n) => n + SEARCH_BATCH); });
    io.observe(el);
    return () => io.disconnect();
  }, [shown, results]);
  // 用上一筆、下一筆跳過去：那一筆還沒顯示就先多顯示到那裡，再捲過去（避開上方固定的輸入框）
  const listRef = useRef<HTMLSpanElement>(null);
  const [jumpTo, setJumpTo] = useState<string | null>(null);
  useEffect(() => {
    const on = (ev: Event) => {
      const d = (ev as CustomEvent<{ f: number; sh: number; i: number }>).detail;
      const k = results.findIndex((r) => r.f === d.f && r.sh === d.sh && r.i === d.i);
      if (k < 0) return;
      setShown((n) => Math.max(n, k + 1));
      setJumpTo(d.f + ':' + d.sh + ':' + d.i);
    };
    window.addEventListener(SEARCH_JUMP, on);
    return () => window.removeEventListener(SEARCH_JUMP, on);
  }, [results]);
  useEffect(() => {
    if (!jumpTo) return;
    const el = listRef.current?.parentElement?.querySelector(`[data-hit="${jumpTo}"]`);
    el?.scrollIntoView({ block: 'nearest' });
    setJumpTo(null);
  }, [jumpTo, shown]);
  const here = useStore(useShallow((s) => { const c = currentOf(s); return { f: s.file, sh: c.sheetIdx, i: c.sel }; }));
  return (
    <>
      <span ref={listRef} hidden />
      {results.slice(0, shown).map((r) => {
        const on = r.f === here.f && r.sh === here.sh && r.i === here.i;
        return (
        <button key={r.f + ':' + r.sh + ':' + r.i} data-hit={r.f + ':' + r.sh + ':' + r.i} aria-current={on || undefined} type="button" className="sr" onClick={() => leaveFile(files[r.f] ?? null, (idx) => { if (idx >= 0) select(idx, r.sh, r.i); })}
          style={{ display: 'flex', flexDirection: 'column', gap: compact ? 2 : 4, padding: compact ? '6px 9px' : '10px 12px', textAlign: 'left', background: 'var(--card)', border: `1px solid ${on ? 'var(--accent)' : 'var(--line2)'}`, borderRadius: 8, scrollMarginTop: compact ? 44 : 92, scrollMarginBottom: 8 }}>
          <span className="mono" style={{ fontSize: fz(compact ? 10.5 : 11), color: 'var(--mute)' }}>{r.where}</span>
          <span style={{ fontSize: fz(compact ? 11.5 : 13), lineHeight: compact ? 1.35 : 1.5 }}>{r.src}</span>
          <span style={{ fontSize: fz(compact ? 11 : 12.5), lineHeight: compact ? 1.35 : 1.5, color: 'var(--text2)' }}>{r.tgt}</span>
        </button>
        );
      })}
      {results.length > shown && <div ref={sentinel} style={{ height: 1 }} />}
      {dq && dq === q.trim() && results.length === 0 && <div className="empty" style={{ padding: compact ? '20px 12px' : '24px 8px', textAlign: 'center', color: 'var(--mute)' }}>{tx('side.020', { q: dq })}</div>}
    </>
  );
}

/** 分頁裡固定在上方的輸入框列（分頁內容區有 14px 內距） */
const stickyTab: React.CSSProperties = { position: 'sticky', top: -14, zIndex: 2, margin: '-14px -14px 0', padding: '14px 14px 4px', background: 'var(--bar)', display: 'flex', flexDirection: 'column', gap: 8 };
/** 綜合分頁區塊裡固定在上方的輸入框列（區塊內容有 2px 上內距、10px 左右內距） */
const stickyBlock: React.CSSProperties = { position: 'sticky', top: -2, zIndex: 2, margin: '-2px -10px 0', padding: '2px 10px 4px', background: 'var(--bar)', display: 'flex', gap: 6 };

function SearchTab() {
  const { files, q, dq, results } = useSearch();
  const set = useStore((s) => s.set);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={stickyTab}>
        <label htmlFor="verso-search" className="sr-only">{tx('side.027')}</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input id="verso-search" type="search" className="field" value={q} onChange={(ev) => set({ searchQuery: ev.target.value })} onKeyDown={searchKey}
            placeholder={tx('side.027')} style={{ flexGrow: 1, minWidth: 0 }} />
          <ScopeButton size={36} />
        </div>
        {dq && <div style={{ display: 'flex' }}><SearchNav results={results} dq={dq} /></div>}
      </div>
      <SearchResults results={results} files={files} dq={dq} q={q} />
    </div>
  );
}

/** 綜合分頁的字典區塊：小搜尋框、目前條目命中的詞 */
function DictBlock() {
  const terms = useActiveTerms();
  const current = useStore((s) => currentProjectOf(s));
  const src = useStore((s) => { const e = currentOf(s).entry; return e ? shownSrc(e) : ''; });
  const [q, setQ] = useState('');
  const dq = useDeferredValue(q.trim());
  const matches = useMemo(() => findHits(src, terms, current).flatMap((h, k) => h.terms.map((g, j) => ({ g, alt: j === 0 && k < 9 ? k + 1 : undefined }))), [terms, src, current]);
  const results = useMemo(() => {
    if (!dq) return [];
    const fq = foldText(dq);
    const idx = terms.map((_, i) => i).filter((i) => foldText(terms[i].term).includes(fq) || foldText(terms[i].en).includes(fq));
    return sortByRank(idx, (i) => bestRank([foldText(terms[i].term), foldText(terms[i].en)], fq)).slice(0, 50).map((i) => terms[i]);
  }, [terms, dq]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={stickyBlock}>
        <input type="search" className="field" aria-label={tx('side.012')} value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx('side.013')} style={{ height: 30, flexGrow: 1, minWidth: 0 }} />
      </div>
      {dq ? results.map((g) => <TermCard key={g.id} g={g} />) : matches.map(({ g, alt }) => <TermCard key={g.id} g={g} altKey={alt} />)}
      {(dq ? results.length === 0 : matches.length === 0) && <div className="empty" style={{ padding: '20px 12px' }}>{dq ? tx('side.020', { q: dq }) : tx('side.023')}</div>}
    </div>
  );
}

/** 綜合分頁的搜尋區塊：跟搜尋分頁共用搜尋字和範圍（條目欄的高亮兩邊都有） */
function SearchBlock() {
  const { files, q, dq, results } = useSearch();
  const set = useStore((s) => s.set);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={stickyBlock}>
        <input type="search" className="field" aria-label={tx('side.027')} value={q} onChange={(e) => set({ searchQuery: e.target.value })} onKeyDown={searchKey}
          placeholder={tx('side.027')} style={{ height: 30, flexGrow: 1, minWidth: 0 }} />
        <ScopeButton size={30} />
      </div>
      <SearchResults results={results} files={files} dq={dq} q={q} compact />
    </div>
  );
}

const BLOCKS: Record<GeneralBlock, { label(): string; tab: SideTab; Body(): React.ReactElement; Extra?(): React.ReactElement | null }> = {
  dict: { label: () => tx('side.001'), tab: 'dict', Body: DictBlock },
  tm: { label: () => tx('side.tm'), tab: 'tm', Body: TmBlock },
  search: { label: () => tx('side.002'), tab: 'search', Body: SearchBlock, Extra: SearchBlockNav },
};
const BLOCK_H = 240;

/** 綜合分頁：字典、記憶、搜尋三個區塊，可以拖動排序、拖下緣改高度、收起 */
function GeneralTab() {
  const layout = useStore((s) => s.general);
  const set = useStore((s) => s.set);
  const refs = useRef<Partial<Record<GeneralBlock, HTMLElement | null>>>({});
  const [drag, setDrag] = useState<{ id: GeneralBlock; dy: number } | null>(null);
  const put = (g: Partial<typeof layout>) => set({ general: { ...DEFAULT_GENERAL, ...useStore.getState().general, ...g } });
  // 拖標題列：超過相鄰區塊的一半就交換（跟拖頁簽一樣）
  const startDrag = (id: GeneralBlock, ev: React.PointerEvent) => {
    if (ev.button !== 0 || (ev.target as HTMLElement).closest('button')) return;
    ev.preventDefault();
    let y0 = ev.clientY;
    const move = (e: PointerEvent) => {
      const order = useStore.getState().general.order;
      const k = order.indexOf(id);
      const dy = e.clientY - y0;
      const nb = dy > 0 ? order[k + 1] : order[k - 1];
      const el = nb && refs.current[nb];
      if (el) {
        const r = el.getBoundingClientRect();
        const need = Math.min(r.height / 2, 80);
        if (Math.abs(dy) > need) {
          const next = [...order];
          next[k] = nb!;
          next[dy > 0 ? k + 1 : k - 1] = id;
          put({ order: next });
          y0 += dy > 0 ? r.height : -r.height;
        }
      }
      setDrag({ id, dy: e.clientY - y0 });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setDrag(null); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  // 拖下緣：改這個區塊的高度
  const startResize = (id: GeneralBlock, ev: React.PointerEvent) => {
    ev.preventDefault();
    const y0 = ev.clientY, h0 = useStore.getState().general.h[id] ?? BLOCK_H;
    const move = (e: PointerEvent) => put({ h: { ...useStore.getState().general.h, [id]: Math.max(80, Math.min(900, h0 + e.clientY - y0)) } });
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {layout.order.map((id) => {
        const b = BLOCKS[id];
        const closed = layout.closed.includes(id);
        const dragging = drag?.id === id;
        return (
          <section key={id} ref={(el) => { refs.current[id] = el; }} aria-label={b.label()}
            style={{ position: 'relative', zIndex: dragging ? 2 : 0, transform: dragging ? `translateY(${drag.dy}px)` : undefined, background: 'var(--bar)', border: '1px solid var(--line2)', borderRadius: 10, boxShadow: dragging ? '0 8px 24px rgba(0,0,0,0.35)' : undefined }}>
            <div onPointerDown={(ev) => startDrag(id, ev)} style={{ height: 32, display: 'flex', alignItems: 'center', gap: 4, padding: '0 4px 0 6px', cursor: dragging ? 'grabbing' : 'grab', userSelect: 'none' }}>
              <button type="button" className="ib" aria-expanded={!closed} aria-label={b.label()} onClick={() => put({ closed: closed ? layout.closed.filter((x) => x !== id) : [...layout.closed, id] })}
                style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'transparent', border: 0, borderRadius: 5, color: 'var(--text2)' }}>
                <IconChevD size={12} sw={2.4} style={{ transform: `rotate(${closed ? -90 : 0}deg)`, transition: 'transform 160ms' }} />
              </button>
              <span style={{ flexGrow: 1, fontSize: fz(12.5), fontWeight: 500, color: 'var(--text2)' }}>{b.label()}</span>
              {b.Extra && <b.Extra />}
              <button type="button" className="ib" aria-label={tx('side.openTab', { name: b.label() })} title={tx('side.openTab', { name: b.label() })} onClick={() => set({ side: b.tab })}
                style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'transparent', border: 0, borderRadius: 5, color: 'var(--mute)' }}>
                <IconArrowR size={12} />
              </button>
            </div>
            {!closed && (
              <>
                <div style={{ height: layout.h[id] ?? BLOCK_H, overflowY: 'auto', padding: '2px 10px 10px' }}><CompactCtx.Provider value><b.Body /></CompactCtx.Provider></div>
                <div role="separator" aria-orientation="horizontal" aria-label={tx('side.blockResize')} onPointerDown={(ev) => startResize(id, ev)}
                  style={{ position: 'absolute', left: 0, right: 0, bottom: -5, height: 10, cursor: 'row-resize' }} />
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}

// 迷你瀏覽器：只有外觀，尚未實作
function WebTab() {
  const nav: React.CSSProperties = { width: 30, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 0, borderRadius: 6, color: 'var(--mute)' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%' }}>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <button type="button" className="ib" aria-label={tx('side.028')} style={nav}><IconChevL sw={2.2} /></button>
        <button type="button" className="ib" aria-label={tx('side.029')} style={nav}><IconChevR sw={2.2} /></button>
        <button type="button" className="ib" aria-label={tx('side.030')} style={nav}><IconRefresh /></button>
        <label htmlFor="verso-url" className="sr-only">{tx('side.031')}</label>
        <input id="verso-url" type="text" placeholder={tx('side.032')} style={{ flexGrow: 1, minWidth: 0, height: 32, boxSizing: 'border-box', padding: '0 10px', background: 'var(--bg0)', border: '1px solid var(--line4)', borderRadius: 16, color: 'var(--text)', fontSize: fz(12.5) }} />
      </div>
      <div style={{ flexGrow: 1, minHeight: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bgdeep)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--mute)' }}>
        <IconGlobe size={28} sw={1.5} />
      </div>
    </div>
  );
}

// 參照：只有外觀，尚未實作
function RefTab() {
  const refs = useStore((s) => s.project!.refs);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: fz(11.5), color: 'var(--mute)' }}>{tx('side.033')}</div>
      {refs.map((rf) => (
        <button key={rf.name} type="button" className="sr" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', textAlign: 'left', background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 8 }}>
          <IconFile size={16} stroke="var(--mute)" style={{ flexShrink: 0 }} />
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: fz(13) }}>{rf.name}</span>
            <span style={{ fontSize: fz(11.5), color: 'var(--mute)' }}>{rf.desc}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

const toggleBtn: React.CSSProperties = {
  height: 26, display: 'flex', alignItems: 'center', gap: 6, padding: '0 6px 0 2px', background: 'transparent', border: 0, borderRadius: 6,
  color: 'var(--text2)', fontSize: fz(11.5), fontWeight: 600, letterSpacing: 0.6,
};
const area: React.CSSProperties = {
  minHeight: 0, resize: 'none', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8, color: 'var(--text)', fontSize: fz(13), lineHeight: 1.5,
};

function NotesSection() {
  const hasEntry = useStore((s) => !!currentOf(s).entry);
  return hasEntry ? <NotesSectionInner /> : null;
}

function NotesSectionInner() {
  // 只訂閱這個區塊用到的資料（包含 currentOf 等輔助函式間接用到的）
  const s = useStorePick('project', 'file', 'sheetBy', 'selBy', 'mode', 'suggClosed', 'noteClosed', 'set', 'updateEntry', 'applySuggestion', 'checkSettings', 'beginEdit', 'endEdit', 'notesH', 'userName', 'setComments');
  const { entry, fileDoc } = currentOf(s);
  const cur = entry!;
  // 雲端檔案的備註是留言對話框
  const cloud = !!fileDoc.cloud;
  // 建議翻譯框跟著內容變高（只有一行就只佔一行高）
  const suggRef = useRef<HTMLTextAreaElement>(null);
  const [suggH, setSuggH] = useState(40);
  useLayoutEffect(() => {
    const ta = suggRef.current;
    if (!ta) return;
    const prev = ta.style.height;
    ta.style.height = '0px';
    const h = ta.scrollHeight + 2;
    ta.style.height = prev;
    if (h !== suggH) setSuggH(h);
  });
  const fileStd = currentFileStd(s);
  // 建議翻譯也檢查（跟譯文一樣的規則）；打字中不提示，離開輸入框才顯示
  const [suggFocus, setSuggFocus] = useState(false);
  const suggIssues = useMemo(
    () => (cur.sugg && !cur.skipSugg && !suggFocus ? enabledIssues(cur.upd?.src ?? cur.src, cur.sugg, s.checkSettings, effectiveStd(cur.lengthStd, fileStd)) : []),
    [cur.sugg, cur.skipSugg, cur.src, cur.upd?.src, cur.lengthStd, fileStd, s.checkSettings, suggFocus],
  );
  const suggIssueText = suggIssues.map((i) => i.msg).join(tx('common.sep'));
  const mode = s.mode;
  const suggVisible = mode === 'verify' || !!cur.sugg;
  const suggOpen = !s.suggClosed, noteOpen = !s.noteClosed;
  const verify = mode === 'verify';

  const open = (suggVisible && suggOpen) || noteOpen;
  const notesH = Math.max(noteOpen ? 170 : 120, s.notesH);
  return (
    <>
    {open && <Splitter dir="h" label={tx('side.notesResize')} value={notesH} min={noteOpen ? 170 : 120} max={Math.max(200, window.innerHeight - 260)} onChange={(v) => s.set({ notesH: v })} />}
    <section aria-label={tx('side.034')} style={{
      height: open ? notesH : 'auto', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8, overflow: 'hidden',
      padding: '12px 14px 14px', boxSizing: 'border-box', borderTop: '1px solid var(--line)', background: 'var(--panel)',
    }}>
      {suggVisible && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, height: 26, flexShrink: 0 }}>
            <button type="button" className="ib" aria-expanded={suggOpen} aria-controls="verso-sugg" style={toggleBtn}
              onClick={() => s.set({ suggClosed: suggOpen })}>
              <IconChevD size={12} sw={2.4} style={{ transform: `rotate(${suggOpen ? 0 : -90}deg)`, transition: 'transform 160ms' }} />
              {tx('side.035')}
            </button>
            {suggIssues.length > 0 && (
              <span role="status" style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flexGrow: 1, fontSize: fz(11.5), color: 'var(--warntx)' }}>
                <IconWarn size={12} sw={2.2} style={{ flexShrink: 0 }} />
                <span title={suggIssueText} style={{ minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{suggIssueText}</span>
                <button type="button" className="ib" onClick={() => s.updateEntry({ skipSugg: true })}
                  style={{ flexShrink: 0, height: 20, padding: '0 8px', background: 'transparent', border: '1px solid var(--line4)', borderRadius: 5, color: 'var(--text2)', fontSize: fz(11) }}>{tx('side.036')}</button>
              </span>
            )}
            {cur.sugg && <span style={{ flexShrink: 0, flexGrow: suggIssues.length ? 0 : 1, textAlign: 'right', fontSize: fz(11.5), color: 'var(--mute)' }}>{tx('side.037', { n: cur.sugg.length })}</span>}
            {(mode === 'translate' || mode === 'verify') && cur.sugg && (
              <span style={{ display: 'flex', gap: 6 }}>
                {/* 驗證模式只有套用：建議翻譯寫成修改，不直接蓋掉譯文 */}
                {mode === 'translate' && <button type="button" className="btn btn-ghost" title={tx('side.038')} onClick={() => s.updateEntry({ sugg: '' })}
                  style={{ height: 26, display: 'flex', alignItems: 'center', padding: '0 10px', background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 6, fontSize: fz(12), fontWeight: 500, color: 'var(--text)' }}>
                  {tx('side.039')}
                </button>}
                <button type="button" className="btn btn-ghost" title={tx('side.040')} onClick={() => s.applySuggestion()}
                  style={{ height: 26, display: 'flex', alignItems: 'center', gap: 5, padding: '0 10px', background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 6, fontSize: fz(12), fontWeight: 500, color: 'var(--text)' }}>
                  <IconUse size={12} sw={2.4} />{tx('side.041')}
                </button>
              </span>
            )}
          </div>
          {suggOpen && (
            <>
              <label htmlFor="verso-sugg" className="sr-only">{tx('side.035')}</label>
              <textarea ref={suggRef} rows={1} maxLength={MAX_CELL_CHARS} id="verso-sugg" value={cur.sugg} readOnly={!verify} onKeyDown={(ev) => sideFieldKey(ev, mode)}
                // 整段輸入在條目欄的復原算一步
                onFocus={() => { setSuggFocus(true); s.beginEdit(); }} onBlur={() => { setSuggFocus(false); s.endEdit(); }}
                onChange={(ev) => verify && s.updateEntry({ sugg: ev.target.value })}
                style={{
                  ...area, flex: noteOpen ? `0 1 ${suggH}px` : '1 1 auto', minHeight: 36,
                  // 跟譯文一樣用使用者設定的譯文字體
                  fontFamily: 'var(--font-tgt)', fontSize: 'var(--fs-tgt)',
                  background: verify ? 'var(--bg0)' : 'var(--bar)', border: `1px solid ${verify ? 'var(--line4)' : 'var(--line)'}`,
                }} />
            </>
          )}
        </>
      )}
      <div style={{ display: 'flex', alignItems: 'center', height: 26, flexShrink: 0 }}>
        <button type="button" className="ib" aria-expanded={noteOpen} aria-controls="verso-note" style={toggleBtn}
          onClick={() => s.set({ noteClosed: noteOpen })}>
          <IconChevD size={12} sw={2.4} style={{ transform: `rotate(${noteOpen ? 0 : -90}deg)`, transition: 'transform 160ms' }} />
          {tx('side.042')}
        </button>
      </div>
      {noteOpen && cloud && (
        <div style={{ position: 'relative', flex: '1 1 0', minHeight: 100 }}>
          <CommentsPanel key={cur.uid} entryKey={cur.uid} notes={cur.comments ?? []} me={s.userName.trim()}
            srcNotes={[{ name: tx('cm.srcNote'), text: cur.noteBase ?? '' }, ...(cur.extraNotes ?? [])]}
            readOnly={mode === 'view'} ensureName={ensureUserName} onChange={(update) => s.setComments(cur.uid, update)} />
        </div>
      )}
      {noteOpen && !cloud && (
        <>
          <label htmlFor="verso-note" className="sr-only">{tx('side.042')}</label>
          <textarea maxLength={MAX_CELL_CHARS} id="verso-note" value={cur.note} readOnly={mode === 'view'} onKeyDown={(ev) => sideFieldKey(ev, mode)}
            onFocus={() => s.beginEdit()} onBlur={() => s.endEdit()}
            onChange={(ev) => mode !== 'view' && s.updateEntry({ note: ev.target.value })}
            style={{ ...area, flex: '1 1 auto', background: 'var(--bg0)', border: '1px solid var(--line4)' }} />
        </>
      )}
    </section>
    </>
  );
}

export function SidePanel({ width }: { width: number }) {
  // 分頁列放不下時：滾輪或 Shift＋滾輪左右捲動
  const tabsScroll = useScrollTabs();
  const side = useStore((s) => s.side);
  const set = useStore((s) => s.set);
  return (
    <aside aria-label={tx('side.043')} style={{ width, flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'var(--bar)', borderLeft: '1px solid var(--line)' }}>
      <div style={{ height: 68, flexShrink: 0, display: 'flex', alignItems: 'flex-end', padding: '0 10px', borderBottom: '1px solid var(--line)', boxSizing: 'border-box' }}>
        {/* 設計檔在預設寬度下分頁文字會斷行，這裡改為不斷行，太窄時可橫向捲動 */}
        <div ref={tabsScroll.ref} role="tablist" aria-label={tx('side.044')} className="no-scrollbar" style={{ minWidth: 0, display: 'flex', overflowX: 'auto', ...tabsScroll.style }}>
          {TABS.map(({ id, label, Icon }) => {
            const on = side === id;
            return (
              <button key={id} type="button" role="tab" className="stab" aria-selected={on} onClick={() => set({ side: id })}
                style={{
                  height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '0 7px', background: 'transparent', border: 0,
                  borderBottom: `2px solid ${on ? 'var(--accent)' : 'transparent'}`, color: on ? 'var(--text)' : 'var(--mute)', fontSize: fz(13), fontWeight: 500,
                  whiteSpace: 'nowrap',
                }}>
                <Icon size={14} />{label}
              </button>
            );
          })}
        </div>
        {/* 新增分頁：只有外觀 */}
        <button type="button" className="ib side-hb" aria-label={tx('side.045')} title={tx('side.045')} style={{ margin: '0 0 8px auto' }}>
          <IconPlus size={14} />
        </button>
        <button type="button" className="ib side-hb" aria-label={tx('side.046')} title={tx('side.046')} style={{ margin: '0 0 8px 2px' }}
          onClick={() => set({ hideSide: true })}>
          <IconHideRight size={15} />
        </button>
      </div>
      <div role="tabpanel" style={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', padding: 14 }}>
        {side === 'general' && <GeneralTab />}
        {side === 'tm' && <TmTab />}
        {side === 'dict' && <DictTab />}
        {side === 'search' && <SearchTab />}
        {side === 'web' && <WebTab />}
        {side === 'ref' && <RefTab />}
      </div>
      <NotesSection />
    </aside>
  );
}
