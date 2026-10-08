import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { currentOf, shownSrc, currentProjectOf, dictEnabledIn, overrideKey, searchHit, useStore, useStorePick, type SideTab } from '../state/store';
import { SHARED, dictKey, type DictInfo, type FileDoc, type GlossaryTerm } from '../model/types';
import { fz } from '../model/fonts';
import { enabledIssues } from '../model/checks';
import { effectiveStd } from '../model/length';
import { findHits } from '../state/dictHits';
import { leaveFile } from '../state/saver';
import { ContextMenu } from './ContextMenu';
import { sideFieldKey } from './Shortcuts';
import {
  IconBook, IconBookmark, IconCheck, IconChevD, IconCopy, IconChevL, IconChevR, IconFile, IconGlobe, IconHideRight, IconList, IconPaste, IconPenEdit, IconPlus, IconRefresh, IconSearch, IconUse, IconWarn,
} from './icons';

const TABS: { id: SideTab; label: string; Icon: typeof IconBook }[] = [
  { id: 'dict', label: '字典', Icon: IconBook },
  { id: 'search', label: '搜尋', Icon: IconSearch },
  { id: 'web', label: '瀏覽器', Icon: IconGlobe },
  { id: 'ref', label: '參照', Icon: IconBookmark },
];

/** 專案標籤 */
export function ProjTag({ name }: { name: string }) {
  return (
    <span style={{ flexShrink: 0, fontSize: fz(10.5), padding: '1px 7px', borderRadius: 10, whiteSpace: 'nowrap', color: 'var(--mute)', border: '1px solid var(--line3)' }}>{name}</span>
  );
}

function TermCard({ g, altKey }: { g: GlossaryTerm; altKey?: number }) {
  const set = useStore((s) => s.set);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(g.en).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); });
  };
  const proper = g.dict === '專有名詞';
  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: fz(15), fontWeight: 500 }}>{g.term}</span>
          {altKey && <span className="mono" title={`按 Alt+${altKey} 把譯名放進譯文框`} style={{ fontSize: fz(10.5), color: 'var(--mute)', padding: '1px 5px', border: '1px solid var(--line3)', borderRadius: 4 }}>Alt+{altKey}</span>}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <ProjTag name={g.proj} />
        <span style={{
          fontSize: fz(10.5), padding: '2px 7px', borderRadius: 10, whiteSpace: 'nowrap',
          color: proper ? 'var(--warntx)' : 'var(--accent3)', background: proper ? 'rgba(240,165,74,0.14)' : 'var(--acc-soft)',
        }}>{g.dict}</span>
        </span>
      </div>
      <div style={{ fontSize: fz(14), color: 'var(--accent3)' }}>{g.en}</div>
      <div style={{ fontSize: fz(12), lineHeight: 1.5, color: 'var(--text2)', paddingRight: 56 }}>{g.note || '—'}</div>
      <button type="button" className="ib" aria-label={'編輯詞條「' + g.term + '」'} title="編輯詞條"
        onClick={() => set({ termDraft: { id: g.id, term: g.term, en: g.en, note: g.note, dict: g.dict, proj: g.proj } })}
        style={{ position: 'absolute', right: 34, bottom: 6, width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'transparent', border: 0, borderRadius: 6, color: 'var(--mute)' }}>
        <IconPenEdit size={13} sw={2.2} />
      </button>
      <button type="button" className="ib" aria-label={'複製譯文「' + g.en + '」'} title={copied ? '已複製' : '複製譯文'} onClick={copy}
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
  const [pickOpen, setPickOpen] = useState(false);
  const [dictMenu, setDictMenu] = useState<{ d: DictInfo; x: number; y: number } | null>(null);
  const q = dq.trim(), ql = q.toLowerCase();
  const isOn = (d: DictInfo) => dictEnabledIn(current, overrides, d);
  // 只查啟用中的字典；字典內容或開關變了才重算
  const on = useMemo(() => new Set(dicts.filter(isOn).map((d) => dictKey(d.project, d.name))), [dicts, overrides, current]);
  const active = useMemo(() => glossary.filter((g) => on.has(dictKey(g.proj, g.dict))), [glossary, on]);
  const results = useMemo(() => (!ql ? [] : active.filter((g) => g.term.includes(q) || g.en.toLowerCase().includes(ql))), [active, q]);
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
  const matches = useMemo(() => findHits(matchSrc, active, current).flatMap((h) => h.terms), [active, matchSrc, current]);
  // 目前專案的字典排最前面，再來是共用，其他照原本順序
  const rank = (d: DictInfo) => (d.project === current ? 0 : d.project === SHARED ? 1 : 2);
  const sorted = [...dicts].sort((a, b) => rank(a) - rank(b));
  const toggleDict = (d: DictInfo) => {
    const k = overrideKey(current, d);
    const auto = d.project === current || d.project === SHARED;
    const next = { ...overrides };
    // 跟預設一樣就不必記
    if (!isOn(d) === auto) delete next[k]; else next[k] = !isOn(d);
    set({ dictOverrides: next });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label htmlFor="verso-dict" className="sr-only">搜尋詞條</label>
      <div style={{ display: 'flex', gap: 6 }}>
        <div style={{ position: 'relative', flexGrow: 1, minWidth: 0 }}>
          <IconSearch size={14} stroke="var(--mute)" style={{ position: 'absolute', left: 11, top: 11, pointerEvents: 'none' }} />
          <input id="verso-dict" type="search" className="field" value={dq} onChange={(ev) => set({ dictQuery: ev.target.value })}
            placeholder="搜尋專有名詞或譯名" style={{ width: '100%', padding: '0 12px 0 32px' }} />
        </div>
        <button type="button" className="ib" aria-label="新增詞條" title="新增詞條"
          onClick={() => set({ termDraft: { id: null, term: q && results.length === 0 ? q : '', en: '', note: '', dict: dicts.find((d) => d.project === current)?.name ?? '', proj: current } })}
          style={{ width: 36, height: 36, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, color: 'var(--text2)' }}>
          <IconPlus size={15} sw={2.2} />
        </button>
        <button type="button" className="ib" aria-label="貼入字典" title="貼入字典" onClick={() => set({ dictPasteOpen: true })}
          style={{ width: 36, height: 36, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, color: 'var(--text2)' }}>
          <IconPaste size={15} />
        </button>
        <button type="button" className="ib" aria-label="管理字典" title="管理字典" onClick={() => set({ manageDictsOpen: true })}
          style={{ width: 36, height: 36, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, color: 'var(--text2)' }}>
          <IconList size={15} />
        </button>
      </div>
      <div>
        <button type="button" className="ib" aria-expanded={pickOpen} onClick={() => setPickOpen(!pickOpen)}
          style={{ height: 26, display: 'flex', alignItems: 'center', gap: 6, padding: '0 6px 0 2px', background: 'transparent', border: 0, borderRadius: 6, color: 'var(--text2)', fontSize: fz(12) }}>
          <IconChevD size={12} sw={2.4} style={{ transform: `rotate(${pickOpen ? 0 : -90}deg)`, transition: 'transform 160ms' }} />
          啟用的字典
          <span style={{ color: 'var(--mute)' }}>{on.size} / {dicts.length}</span>
        </button>
        {pickOpen && (
          <div role="group" aria-label="啟用的字典" style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4, padding: 4, background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 8 }}>
            {sorted.map((d) => (
              <label key={dictKey(d.project, d.name)} className="dd"
                onContextMenu={(ev) => { ev.preventDefault(); setDictMenu({ d, x: ev.clientX, y: ev.clientY }); }} style={{ height: 30, display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px', borderRadius: 6, cursor: 'pointer', fontSize: fz(12.5) }}>
                <span style={{ flexGrow: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{d.name}</span>
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
          <div style={{ fontSize: fz(11.5), color: 'var(--mute)' }}>搜尋結果 {results.length} 筆</div>
          {results.slice(0, shown).map((g) => <TermCard key={g.id} g={g} />)}
          {results.length > shown && <div ref={moreRef} style={{ height: 1 }} />}
          {results.length === 0 && <div className="empty" style={{ padding: '20px 12px' }}>找不到「{dq}」</div>}
          <div style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />
        </div>
      )}
      <div style={{ fontSize: fz(11.5), color: 'var(--mute)' }}>這一條命中 {matches.length} 個詞條</div>
      {matches.map((g, i) => <TermCard key={g.id} g={g} altKey={i < 9 ? i + 1 : undefined} />)}
      {matches.length === 0 && <div className="empty" style={{ padding: '32px 12px' }}>這一條沒有符合的詞條</div>}
      {dictMenu && (
        <ContextMenu x={dictMenu.x} y={dictMenu.y} label={'字典「' + dictMenu.d.name + '」'} items={[{ key: 'move', label: '更改專案' }]}
          onPick={() => { set({ moveTarget: { kind: 'dict', project: dictMenu.d.project, name: dictMenu.d.name } }); setDictMenu(null); }}
          onClose={() => setDictMenu(null)} />
      )}
    </div>
  );
}

interface SearchHit { f: number; sh: number; i: number; where: string; src: string; tgt: string }
interface SearchState { q: string; hits: SearchHit[]; at: [number, number, number]; done: boolean }

/** 搜尋所有檔案：從 at 的位置往後找，找到 n 筆就停，回傳下次要接著找的位置 */
function scan(files: FileDoc[], q: string, at: [number, number, number], n: number): { hits: SearchHit[]; at: [number, number, number]; done: boolean } {
  const hits: SearchHit[] = [];
  let [f, sh, i] = at;
  for (; f < files.length; f++, sh = 0, i = 0) {
    const file = files[f];
    for (; sh < file.sheets.length; sh++, i = 0) {
      const sheet = file.sheets[sh];
      for (; i < sheet.entries.length; i++) {
        const e = sheet.entries[i];
        if (!searchHit(e, q)) continue;
        if (hits.length === n) return { hits, at: [f, sh, i], done: false };
        hits.push({ f, sh, i, where: `${file.project} · ${file.name} · ${sheet.name} · #${e.id || i + 1}`, src: shownSrc(e), tgt: e.tgt || '尚未翻譯' });
      }
    }
  }
  return { hits, at: [f, sh, i], done: true };
}

const SEARCH_BATCH = 20;

function SearchTab() {
  const files = useStore((s) => s.project!.files);
  const q = useStore((s) => s.searchQuery);
  const { set, select } = useStore.getState();
  // 停止打字 0.3 秒後才搜
  const [dq, setDq] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const [res, setRes] = useState<SearchState>({ q: '', hits: [], at: [0, 0, 0], done: true });
  // 搜尋字或檔案內容變了：從頭找，至少找回原本已載入的筆數
  const resRef = useRef(res);
  resRef.current = res;
  const deferredFiles = useDeferredValue(files);
  useEffect(() => {
    if (!dq) { setRes({ q: '', hits: [], at: [0, 0, 0], done: true }); return; }
    const n = resRef.current.q === dq ? Math.max(SEARCH_BATCH, resRef.current.hits.length) : SEARCH_BATCH;
    setRes({ q: dq, ...scan(deferredFiles, dq, [0, 0, 0], n) });
  }, [dq, deferredFiles]);
  // 捲到結果底部時，從上次停的位置往後再找一批
  const more = () => {
    const r = resRef.current;
    if (!r.q || r.done) return;
    const next = scan(deferredFiles, r.q, r.at, SEARCH_BATCH);
    setRes({ q: r.q, hits: [...r.hits, ...next.hits], at: next.at, done: next.done });
  };
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) more(); });
    io.observe(el);
    return () => io.disconnect();
  }, [res]);
  const results = res.hits;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label htmlFor="verso-search" className="sr-only">搜尋所有檔案</label>
      <input id="verso-search" type="search" className="field" value={q} onChange={(ev) => set({ searchQuery: ev.target.value })}
        placeholder="搜尋所有檔案" />
      {results.map((r) => (
        <button key={r.f + ':' + r.sh + ':' + r.i} type="button" className="sr" onClick={() => leaveFile(files[r.f] ?? null, (idx) => { if (idx >= 0) select(idx, r.sh, r.i); })}
          style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 12px', textAlign: 'left', background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 8 }}>
          <span className="mono" style={{ fontSize: fz(11), color: 'var(--mute)' }}>{r.where}</span>
          <span style={{ fontSize: fz(13), lineHeight: 1.5 }}>{r.src}</span>
          <span style={{ fontSize: fz(12.5), lineHeight: 1.5, color: 'var(--text2)' }}>{r.tgt}</span>
        </button>
      ))}
      {!res.done && <div ref={sentinel} style={{ height: 1 }} />}
      {res.q && res.q === dq && results.length === 0 && <div style={{ padding: '24px 8px', textAlign: 'center', color: 'var(--mute)' }}>找不到「{res.q}」</div>}
    </div>
  );
}

// 迷你瀏覽器：只有外觀，尚未實作
function WebTab() {
  const nav: React.CSSProperties = { width: 30, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 0, borderRadius: 6, color: 'var(--mute)' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%' }}>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <button type="button" className="ib" aria-label="上一頁" style={nav}><IconChevL sw={2.2} /></button>
        <button type="button" className="ib" aria-label="下一頁" style={nav}><IconChevR sw={2.2} /></button>
        <button type="button" className="ib" aria-label="重新整理" style={nav}><IconRefresh /></button>
        <label htmlFor="verso-url" className="sr-only">網址</label>
        <input id="verso-url" type="text" placeholder="輸入網址或關鍵字" style={{ flexGrow: 1, minWidth: 0, height: 32, boxSizing: 'border-box', padding: '0 10px', background: 'var(--bg0)', border: '1px solid var(--line4)', borderRadius: 16, color: 'var(--text)', fontSize: fz(12.5) }} />
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
      <div style={{ fontSize: fz(11.5), color: 'var(--mute)' }}>專案參照文件</div>
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
  const s = useStorePick('project', 'file', 'sheetBy', 'selBy', 'mode', 'suggClosed', 'noteClosed', 'set', 'updateEntry', 'applySuggestion', 'checkSettings', 'beginEdit', 'endEdit');
  const cur = currentOf(s).entry!;
  const fileStd = currentOf(s).fileDoc.lengthStd;
  // 建議翻譯也檢查（跟譯文一樣的規則）；打字中不提示，離開輸入框才顯示
  const [suggFocus, setSuggFocus] = useState(false);
  const suggIssues = useMemo(
    () => (cur.sugg && !cur.skipSugg && !suggFocus ? enabledIssues(cur.upd?.src ?? cur.src, cur.sugg, s.checkSettings, effectiveStd(cur.lengthStd, fileStd)) : []),
    [cur.sugg, cur.skipSugg, cur.src, cur.upd?.src, cur.lengthStd, fileStd, s.checkSettings, suggFocus],
  );
  const suggIssueText = suggIssues.map((i) => i.msg).join('、');
  const mode = s.mode;
  const suggVisible = mode === 'verify' || !!cur.sugg;
  const suggOpen = !s.suggClosed, noteOpen = !s.noteClosed;
  const verify = mode === 'verify';

  return (
    <section aria-label="備註" style={{
      height: (suggVisible && suggOpen) || noteOpen ? 300 : 'auto', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8,
      padding: '12px 14px 14px', boxSizing: 'border-box', borderTop: '1px solid var(--line)', background: 'var(--panel)',
    }}>
      {suggVisible && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, height: 26, flexShrink: 0 }}>
            <button type="button" className="ib" aria-expanded={suggOpen} aria-controls="verso-sugg" style={toggleBtn}
              onClick={() => s.set({ suggClosed: suggOpen })}>
              <IconChevD size={12} sw={2.4} style={{ transform: `rotate(${suggOpen ? 0 : -90}deg)`, transition: 'transform 160ms' }} />
              建議翻譯
            </button>
            {suggIssues.length > 0 && (
              <span role="status" style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flexGrow: 1, fontSize: fz(11.5), color: 'var(--warntx)' }}>
                <IconWarn size={12} sw={2.2} style={{ flexShrink: 0 }} />
                <span title={suggIssueText} style={{ minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{suggIssueText}</span>
                <button type="button" className="ib" onClick={() => s.updateEntry({ skipSugg: true })}
                  style={{ flexShrink: 0, height: 20, padding: '0 8px', background: 'transparent', border: '1px solid var(--line4)', borderRadius: 5, color: 'var(--text2)', fontSize: fz(11) }}>略過</button>
              </span>
            )}
            {cur.sugg && <span style={{ flexShrink: 0, flexGrow: suggIssues.length ? 0 : 1, textAlign: 'right', fontSize: fz(11.5), color: 'var(--mute)' }}>{cur.sugg.length} 字元</span>}
            {mode === 'translate' && cur.sugg && (
              <span style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="btn btn-ghost" title="刪除建議翻譯" onClick={() => s.updateEntry({ sugg: '' })}
                  style={{ height: 26, display: 'flex', alignItems: 'center', padding: '0 10px', background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 6, fontSize: fz(12), fontWeight: 500, color: 'var(--text)' }}>
                  刪除
                </button>
                <button type="button" className="btn btn-ghost" title="記錄目前譯文，並把建議翻譯套用到譯文框" onClick={() => s.applySuggestion()}
                  style={{ height: 26, display: 'flex', alignItems: 'center', gap: 5, padding: '0 10px', background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 6, fontSize: fz(12), fontWeight: 500, color: 'var(--text)' }}>
                  <IconUse size={12} sw={2.4} />套用
                </button>
              </span>
            )}
          </div>
          {suggOpen && (
            <>
              <label htmlFor="verso-sugg" className="sr-only">建議翻譯</label>
              <textarea id="verso-sugg" value={cur.sugg} readOnly={!verify} onKeyDown={(ev) => sideFieldKey(ev, mode)}
                // 整段輸入在條目欄的復原算一步
                onFocus={() => { setSuggFocus(true); s.beginEdit(); }} onBlur={() => { setSuggFocus(false); s.endEdit(); }}
                onChange={(ev) => verify && s.updateEntry({ sugg: ev.target.value })}
                style={{
                  ...area, flex: noteOpen ? '0 0 84px' : '1 1 auto',
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
          我的備註
        </button>
      </div>
      {noteOpen && (
        <>
          <label htmlFor="verso-note" className="sr-only">我的備註</label>
          <textarea id="verso-note" value={cur.note} readOnly={mode === 'view'} onKeyDown={(ev) => sideFieldKey(ev, mode)}
            onFocus={() => s.beginEdit()} onBlur={() => s.endEdit()}
            onChange={(ev) => mode !== 'view' && s.updateEntry({ note: ev.target.value })}
            style={{ ...area, flex: '1 1 auto', background: 'var(--bg0)', border: '1px solid var(--line4)' }} />
        </>
      )}
    </section>
  );
}

export function SidePanel({ width }: { width: number }) {
  const side = useStore((s) => s.side);
  const set = useStore((s) => s.set);
  return (
    <aside aria-label="其他功能" style={{ width, flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'var(--bar)', borderLeft: '1px solid var(--line)' }}>
      <div style={{ height: 68, flexShrink: 0, display: 'flex', alignItems: 'flex-end', padding: '0 10px', borderBottom: '1px solid var(--line)', boxSizing: 'border-box' }}>
        {/* 設計檔在預設寬度下分頁文字會斷行，這裡改為不斷行，太窄時可橫向捲動 */}
        <div role="tablist" aria-label="功能分頁" className="no-scrollbar" style={{ minWidth: 0, display: 'flex', overflowX: 'auto' }}>
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
        <button type="button" className="ib side-hb" aria-label="新增分頁" title="新增分頁" style={{ margin: '0 0 8px auto' }}>
          <IconPlus size={14} />
        </button>
        <button type="button" className="ib side-hb" aria-label="隱藏右側欄" title="隱藏右側欄" style={{ margin: '0 0 8px 2px' }}
          onClick={() => set({ hideSide: true })}>
          <IconHideRight size={15} />
        </button>
      </div>
      <div role="tabpanel" style={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', padding: 14 }}>
        {side === 'dict' && <DictTab />}
        {side === 'search' && <SearchTab />}
        {side === 'web' && <WebTab />}
        {side === 'ref' && <RefTab />}
      </div>
      <NotesSection />
    </aside>
  );
}
