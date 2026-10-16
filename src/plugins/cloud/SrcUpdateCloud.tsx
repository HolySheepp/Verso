// 雲端模式的「更新原文」：頁簽右鍵 → 先選「更新原文」或「R15」
// - 更新原文：每個頁簽用手動貼入，或從新連結選 ID、發話者、原文的範圍；套用到原本這份 Google 表
// - R15：只能用新連結；確認後新增一個檔案連到新連結，原本的檔案不動（譯文帶過去，改過的原文標「原文更新」）
// 範圍都選好後，先顯示對齊視窗（可以拖動、切換各頁簽），按確定才生效
import { useEffect, useMemo, useRef, useState } from 'react';
import { tx } from '../../i18n';
import { fz } from '../../model/fonts';
import { checkColumns, emptyColumns, pasteColumns, type ColKey, type Columns } from '../../model/paste';
import { emptyFields, fieldsToColumns, type FieldMap } from '../../model/importSel';
import { applyUpdate, autoAlign, rowInfos, seedCandidates, sequentialRows, summarize, type AlignRow, type NewRow } from '../../model/srcUpdate';
import { AlignCancelled, autoAlignAsync, cancelAlign } from '../../model/alignAsync';
import { entryFits } from '../../model/cellLimit';
import { currentOf, showToast, useStore } from '../../state/store';
import { PasteBox, type BoxSel } from '../../components/PasteBox';
import { Preview, type DraftSheet } from '../../components/ImportDialog';
import { AlignGrid } from '../../components/SrcUpdateDialog';
import { Select } from '../../components/Select';
import { dragWindow } from '../../components/windowDrag';
import { IconWinClose } from '../../components/icons';
import { errText, meta, readTabs, sidOf } from './api';
import { useCloud } from './config';
import { applyCloudUpdate, createR15 } from './sync';

const KEYS: ColKey[] = ['id', 'speaker', 'src'];
const btn: React.CSSProperties = { height: 34, padding: '0 14px', background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, fontSize: fz(12.5) };
const primary: React.CSSProperties = { height: 36, padding: '0 18px', background: 'var(--primary)', border: 0, borderRadius: 8, color: '#ffffff', fontSize: fz(13), fontWeight: 600 };

/** 一個頁簽的來源：手動貼入的欄，或新連結某個分頁選的範圍 */
interface Draft { kind: 'paste' | 'link'; cols: Columns; gid?: number; fields: FieldMap }
interface Align { rows: AlignRow[]; past: AlignRow[][]; future: AlignRow[][]; busy: boolean; cands: boolean }
const emptyDraft = (kind: 'paste' | 'link'): Draft => ({ kind, cols: emptyColumns(), fields: emptyFields() });

export function SrcUpdateCloud({ sid, start }: { sid: string; start: number }) {
  const close = () => useCloud.setState({ srcUpd: null });
  const doc = useStore((s) => s.project?.files.find((f) => f.fid === 'g:' + sid));
  const [mode, setMode] = useState<'update' | 'r15' | null>(null);
  const [step, setStep] = useState<'mode' | 'pick' | 'align'>('mode');
  const [cur, setCur] = useState(start);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [url, setUrl] = useState('');
  const [link, setLink] = useState<{ sid: string; title: string; tabs: { gid: number; title: string; rows: string[][] }[] } | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<{ key: string; sel: BoxSel } | null>(null);
  const [aligns, setAligns] = useState<Record<number, Align>>({});
  const run = useRef(0);
  useEffect(() => () => { run.current++; cancelAlign(); }, []);
  if (!doc) return null;
  const sheets = doc.sheets;

  // 每個頁簽的新版句子
  const nextOf = (k: number): { next: NewRow[]; has: { id: boolean; speaker: boolean }; ok: boolean; msg: string } => {
    const d = drafts[k];
    if (!d) return { next: [], has: { id: false, speaker: false }, ok: false, msg: '' };
    let cols: Columns = d.cols;
    if (d.kind === 'link') {
      const t = link?.tabs.find((x) => x.gid === d.gid);
      if (!t) return { next: [], has: { id: false, speaker: false }, ok: false, msg: tx('cloud.updPickTab') };
      const f: FieldMap = { ...emptyFields(), id: d.fields.id, speaker: d.fields.speaker, src: d.fields.src };
      cols = fieldsToColumns(t.rows, f);
    }
    const c = checkColumns(cols);
    const next = (cols.src?.rows ?? []).map((src, i) => ({ id: cols.id?.rows[i] ?? '', speaker: cols.speaker?.rows[i] ?? '', src }));
    return { next, has: { id: !!cols.id, speaker: !!cols.speaker }, ok: c.ok, msg: c.msg };
  };
  const configured = Object.keys(drafts).map(Number).filter((k) => nextOf(k).ok).sort((a, b) => a - b);

  const readLink = async () => {
    const s2 = sidOf(url);
    if (!s2) { setErr(tx('cloud.badUrl')); return; }
    setBusy(true); setErr('');
    try {
      const m = await meta(s2);
      const values = await readTabs(s2, m.tabs.map((t) => t.title));
      setLink({ sid: s2, title: m.title, tabs: m.tabs.map((t, i) => ({ ...t, rows: values[i] })) });
    } catch (e) { setErr(errText(e)); }
    setBusy(false);
  };

  // 下一步：每個選好的頁簽先照順序對應，再在背景自動比對
  const toAlign = () => {
    const r = ++run.current;
    const init: Record<number, Align> = {};
    configured.forEach((k) => { init[k] = { rows: sequentialRows(sheets[k].entries.length, nextOf(k).next.length), past: [], future: [], busy: true, cands: false }; });
    setAligns(init);
    setStep('align');
    if (!configured.includes(cur)) setCur(configured[0]);
    void (async () => {
      for (const k of configured) {
        if (r !== run.current) return;
        const old = sheets[k].entries.map((e) => ({ id: e.id, src: e.src }));
        const { next } = nextOf(k);
        const onCands = (c: [number, [number, number][]][] | null) => {
          if (r !== run.current) return;
          if (c) seedCandidates(old.map((x) => x.src), next.map((x) => x.src), c);
          setAligns((a) => ({ ...a, [k]: { ...a[k], cands: true } }));
        };
        let rows: AlignRow[] | null = null;
        try { rows = await autoAlignAsync(old, next, onCands); } catch (e) {
          if (e instanceof AlignCancelled || r !== run.current) return;
          try { rows = autoAlign(old, next); } catch { showToast(tx('srcupd.alignFailed'), { warn: true }); }
        }
        if (r !== run.current) return;
        setAligns((a) => ({ ...a, [k]: { ...a[k], rows: rows ?? a[k].rows, past: rows ? [...a[k].past, a[k].rows] : a[k].past, busy: false, cands: true } }));
      }
    })();
  };

  const confirm = async () => {
    setBusy(true);
    try {
      if (mode === 'update') {
        for (const k of configured) {
          const { next, has } = nextOf(k);
          const out = applyUpdate(sheets[k].entries, next, aligns[k].rows, has);
          const bad = out.findIndex((e) => !entryFits(e));
          if (bad >= 0) { showToast(tx('srcupd.tooLong', { n: bad + 1 })); setBusy(false); return; }
          await applyCloudUpdate(sid, k, out);
        }
      } else if (link) {
        await createR15(sid, link.sid, link.title, configured.map((k) => {
          const d = drafts[k];
          const t = link.tabs.find((x) => x.gid === d.gid)!;
          return { sheetIdx: k, gid: t.gid, title: t.title, rows: t.rows, fields: { ...emptyFields(), id: d.fields.id, speaker: d.fields.speaker, src: d.fields.src }, align: aligns[k].rows, next: nextOf(k).next };
        }));
      }
      close();
    } catch (e) { showToast(tx('cloud.writeFailed', { name: doc.name, reason: errText(e) }), { warn: true }); setBusy(false); }
  };

  const title = mode === 'r15' ? tx('cloud.r15') : tx('cloud.updSrc');
  const shell = (body: React.ReactNode, footer: React.ReactNode) => (
    <div className="scrim" style={{ zIndex: 45 }}>
      <div role="dialog" aria-modal="true" aria-labelledby="verso-cupd-title" className="dialog" tabIndex={-1}
        onKeyDown={(ev) => {
          if (step !== 'align' || !(ev.ctrlKey || ev.metaKey)) return;
          const key = ev.key.toLowerCase();
          const a = aligns[cur];
          if (!a) return;
          if (key === 'z' && !ev.shiftKey && a.past.length) { ev.preventDefault(); setAligns((x) => ({ ...x, [cur]: { ...a, rows: a.past[a.past.length - 1], past: a.past.slice(0, -1), future: [a.rows, ...a.future] } })); }
          else if ((key === 'y' || (key === 'z' && ev.shiftKey)) && a.future.length) { ev.preventDefault(); setAligns((x) => ({ ...x, [cur]: { ...a, rows: a.future[0], past: [...a.past, a.rows], future: a.future.slice(1) } })); }
        }}
        style={{ width: 1040, height: 680, maxWidth: 'calc(100% - 48px)', maxHeight: 'calc(100% - 48px)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)', outline: 'none' }}>
        <div onMouseDown={dragWindow} style={{ height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px 0 20px', borderBottom: '1px solid var(--line)' }}>
          <h2 id="verso-cupd-title" style={{ margin: 0, fontSize: fz(15), fontWeight: 600 }}>{title}{mode ? '：' + doc.name : ''}</h2>
          <button type="button" className="ib" aria-label={tx('cloud.close')} onClick={close}
            style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 0, borderRadius: 8, color: 'var(--text2)' }}>
            <IconWinClose size={13} sw={1.4} />
          </button>
        </div>
        {body}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 20px 16px', borderTop: '1px solid var(--line)' }}>{footer}</div>
      </div>
    </div>
  );

  // 第一步：更新原文或 R15
  if (step === 'mode') {
    const choice = (m: 'update' | 'r15', label: string, hint: string) => (
      <button type="button" className="btn btn-ghost" onClick={() => { setMode(m); setStep('pick'); if (m === 'r15') setDrafts({}); }}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6, padding: 16, background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 10, textAlign: 'left' }}>
        <span style={{ fontSize: fz(14), fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: fz(12.5), color: 'var(--text2)', lineHeight: 1.5 }}>{hint}</span>
      </button>
    );
    return shell(
      <div style={{ display: 'flex', gap: 14, padding: 20 }}>
        {choice('update', tx('cloud.updSrc'), tx('cloud.updSrcHint'))}
        {choice('r15', tx('cloud.r15'), tx('cloud.r15Hint'))}
      </div>,
      <><span /><button type="button" className="btn btn-ghost" style={btn} onClick={close}>{tx('cloud.cancel')}</button></>,
    );
  }

  const d = drafts[cur];
  const setDraft = (p: Partial<Draft>) => setDrafts((x) => ({ ...x, [cur]: { ...(x[cur] ?? emptyDraft(mode === 'r15' ? 'link' : 'paste')), ...p } }));
  const tabList = (
    <div style={{ width: 200, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4, padding: '12px 10px', borderRight: '1px solid var(--line)', overflowY: 'auto' }}>
      {(step === 'align' ? configured : sheets.map((_, k) => k)).map((k) => {
        const info = nextOf(k);
        const a = aligns[k];
        const s = a && step === 'align' ? summarize(sheets[k].entries, info.next, a.rows) : null;
        return (
          <button key={k} type="button" className="dd" onClick={() => setCur(k)}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '8px 10px', border: 0, borderRadius: 6, textAlign: 'left', background: k === cur ? 'var(--sel)' : 'transparent', color: 'var(--text)' }}>
            <span style={{ fontSize: fz(13) }}>{sheets[k].name}</span>
            <span style={{ fontSize: fz(11.5), color: info.ok ? 'var(--accent2)' : 'var(--mute)' }}>
              {s ? (a.busy ? tx('srcupd.007') : tx('srcupd.008', { ...s })) : info.ok ? tx('cloud.updReady', { n: info.next.length }) : mode === 'r15' ? tx('cloud.r15Carry') : tx('cloud.updNone')}
            </span>
          </button>
        );
      })}
    </div>
  );

  // 第二步：每個頁簽選來源
  if (step === 'pick') {
    const info = nextOf(cur);
    const linkTab = link?.tabs.find((t) => t.gid === d?.gid);
    const draft: DraftSheet | null = linkTab ? { id: 'l' + linkTab.gid, name: linkTab.title, rows: linkTab.rows, width: Math.max(1, ...linkTab.rows.map((r) => r.length)), fields: d!.fields } : null;
    return shell(
      <div style={{ flexGrow: 1, minHeight: 0, display: 'flex' }}>
        {tabList}
        <div style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 16px' }}>
          {mode === 'update' && (
            <div role="radiogroup" style={{ display: 'flex', gap: 14, fontSize: fz(13) }}>
              {(['paste', 'link'] as const).map((k) => (
                <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="radio" checked={(d?.kind ?? 'paste') === k} onChange={() => setDraft({ kind: k })} />{k === 'paste' ? tx('cloud.updPaste') : tx('cloud.updLink')}
                </label>
              ))}
            </div>
          )}
          {(d?.kind ?? (mode === 'r15' ? 'link' : 'paste')) === 'paste' ? (
            <div style={{ flexGrow: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '120px 145px minmax(0, 1fr)', gap: 12 }}>
              {KEYS.map((k) => (
                <PasteBox key={k} label={k === 'id' ? 'ID' : k === 'speaker' ? tx('srcupd.001') : tx('srcupd.002')} col={d?.cols[k] ?? null} required={k === 'src'} fontSlot={k === 'id' || k === 'speaker' ? k : undefined}
                  onPaste={(values, st) => setDraft({ kind: 'paste', cols: { ...(d?.cols ?? emptyColumns()), ...pasteColumns(KEYS, k, values, d?.cols ?? emptyColumns(), st) } })}
                  onChange={(col) => setDraft({ kind: 'paste', cols: { ...(d?.cols ?? emptyColumns()), [k]: col } })}
                  selected={sel?.key === k ? sel.sel : null}
                  onSelect={(s) => setSel(s === null ? null : { key: k, sel: s })} />
              ))}
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input className="field" value={url} disabled={!!link} placeholder="https://docs.google.com/spreadsheets/d/…" onChange={(e) => setUrl(e.target.value)} style={{ flexGrow: 1, minWidth: 0 }} />
                {!link
                  ? <button type="button" className="btn btn-ghost" style={btn} disabled={busy || !url.trim()} onClick={() => void readLink()}>{busy ? tx('cloud.reading') : tx('cloud.read')}</button>
                  : <Select value={d?.gid !== undefined ? String(d.gid) : ''} style={{ width: 200 }} ariaLabel={tx('cloud.updLinkTab')}
                      options={[{ value: '', label: tx('cloud.updPickTab') }, ...link.tabs.map((t) => ({ value: String(t.gid), label: t.title }))]}
                      onChange={(v) => setDraft({ kind: 'link', gid: v === '' ? undefined : Number(v), fields: emptyFields() })} />}
              </div>
              <div style={{ fontSize: fz(12), color: 'var(--mute)' }}>{mode === 'r15' ? tx('cloud.r15PickHint') : tx('cloud.updPickHint')}</div>
              {draft && <Preview key={draft.id + ':' + cur} sheet={draft} onFields={(fields) => setDraft({ kind: 'link', fields })} />}
            </>
          )}
        </div>
      </div>,
      <>
        <span role="alert" style={{ fontSize: fz(12.5), color: err || (d && !info.ok && info.msg) ? 'var(--errtx)' : 'var(--mute)' }}>
          {err || (d && !info.ok ? info.msg : info.ok ? tx('srcupd.006', { length: info.next.length, v1: sheets[cur].entries.length }) : '')}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-ghost" style={btn} onClick={() => setStep('mode')}>{tx('srcupd.011')}</button>
          <button type="button" className="btn btn-primary" style={{ ...primary, opacity: configured.length ? 1 : 0.5 }} disabled={!configured.length || (mode === 'r15' && !link)} onClick={toAlign}>{tx('srcupd.010')}</button>
        </div>
      </>,
    );
  }

  // 第三步：對齊（可以切換各頁簽的比對）
  const a = aligns[cur];
  const info = nextOf(cur);
  const entries = sheets[cur]?.entries ?? [];
  return shell(
    <div style={{ flexGrow: 1, minHeight: 0, display: 'flex' }}>
      {tabList}
      <div style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {a && <AlignView key={cur} rows={a.rows} entries={entries} next={info.next} cands={a.cands && !a.busy}
          onChange={(rows) => { if (!a.busy) setAligns((x) => ({ ...x, [cur]: { ...a, rows, past: [...a.past.slice(-99), a.rows], future: [] } })); }} />}
      </div>
    </div>,
    <>
      <span style={{ fontSize: fz(12.5), color: 'var(--mute)' }}>{mode === 'r15' ? tx('cloud.r15Confirm') : tx('cloud.updConfirm')}</span>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn btn-ghost" style={btn} disabled={busy} onClick={() => { run.current++; cancelAlign(); setStep('pick'); }}>{tx('srcupd.011')}</button>
        <button type="button" className="btn btn-primary" style={primary} disabled={busy || configured.some((k) => aligns[k]?.busy)} onClick={() => void confirm()}>{busy ? tx('cloud.saving') : tx('srcupd.012')}</button>
      </div>
    </>,
  );
}

/** 一個頁簽的對齊表格（跟本地版「更新原文」同一個） */
function AlignView({ rows, entries, next, cands, onChange }: { rows: AlignRow[]; entries: import('../../model/types').Entry[]; next: NewRow[]; cands: boolean; onChange(rows: AlignRow[]): void }) {
  const safe = useMemo(() => rows.map((r) => ({ old: r.old !== null && r.old < entries.length ? r.old : null, new: r.new !== null && r.new < next.length ? r.new : null })), [rows, entries.length, next.length]);
  const oldSrc = useMemo(() => entries.map((e) => e.src), [entries]);
  const newSrc = useMemo(() => next.map((n) => n.src), [next]);
  const infos = useMemo(() => rowInfos(oldSrc, newSrc, safe, cands), [oldSrc, newSrc, safe, cands]);
  return <AlignGrid rows={safe} entries={entries} next={next} infos={infos} onChange={onChange} />;
}

/** 從右鍵打開（目前的檔案、頁簽） */
export function openSrcUpdate(i: number): boolean {
  const s = useStore.getState();
  const sid = currentOf(s).fileDoc.cloud?.sid;
  if (!sid || currentOf(s).fileDoc.cloud?.stub) return false;
  useCloud.setState({ srcUpd: { sid, sheet: i } });
  return true;
}
