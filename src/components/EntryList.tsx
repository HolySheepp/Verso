import { useEffect, useRef, useState } from 'react';
import { currentOf, useStore, visibleIssues, type Filter } from '../state/store';
import { effectiveMark, markName, markVisual } from '../model/marks';
import { writeColumn } from '../model/clipboard';
import { MarkIcon } from './MarkIcon';
import { rowMenuPos } from './rowMenu';
import { CopyConfirm } from './CopyConfirm';
import { IconCheck, IconCopy, IconScan, IconWarn } from './icons';

/** 標記欄、# 欄（對話 id）、發話者欄、原文、譯文 */
const HEAD_COLS = '40px 36px 64px minmax(0, 1fr) minmax(0, 1fr)';
const ROW_COLS = '36px 64px minmax(0, 1fr) minmax(0, 1fr)';

/** 往下／往上移動時，前方保留幾條看得到 */
const KEEP_VISIBLE = 3;

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'untranslated', label: '未翻譯' },
  { id: 'doubt', label: '疑慮' },
  { id: 'think', label: '待思考' },
  { id: 'issues', label: '有問題' },
];

export function EntryList() {
  const s = useStore();
  const project = s.project!;
  const { sheet, sheetIdx, sel } = currentOf(s);
  const filter = s.filter;
  const { set, select } = s;
  const customs = project.customMarks;
  const listRef = useRef<HTMLDivElement>(null);
  const [confirm, setConfirm] = useState<{ untranslated: number; pending: number } | null>(null);
  const [copied, setCopied] = useState(false);

  // 換條目時讓目前這條保持在可見範圍。
  // 用下一條或快捷鍵往下（上）移動時，下方（上方）至少保留 3 條看得到；滑鼠點選只確保這條看得到。
  const handledMove = useRef(s.moveSeq);
  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector('[aria-current="true"]')?.closest('.rw') as HTMLElement | null;
    if (!list || !row) return;
    const keyboard = handledMove.current !== s.moveSeq;
    handledMove.current = s.moveSeq;
    row.scrollIntoView({ block: 'nearest' });
    if (!keyboard) return;
    const rowsEls = Array.from(list.querySelectorAll<HTMLElement>('.rw'));
    const k = rowsEls.indexOf(row);
    const box = list.getBoundingClientRect();
    if (s.moveDir > 0) {
      const edge = rowsEls[Math.min(k + KEEP_VISIBLE, rowsEls.length - 1)].getBoundingClientRect();
      if (edge.bottom > box.bottom) list.scrollTop += edge.bottom - box.bottom;
    } else {
      const edge = rowsEls[Math.max(k - KEEP_VISIBLE, 0)].getBoundingClientRect();
      if (edge.top < box.top) list.scrollTop -= box.top - edge.top;
    }
  }, [s.file, sheetIdx, sel, s.moveSeq]);

  // 複製譯文欄：未翻譯的留空，待確認的照原本譯文輸出
  const doCopy = async () => {
    setConfirm(null);
    await writeColumn(sheet.entries.map((e) => e.tgt));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const askCopy = () => {
    const open = sheet.entries.filter((e) => e.mark !== 'ignore');
    const untranslated = open.filter((e) => !e.tgt).length;
    const pending = open.filter((e) => e.tgt && e.pending).length;
    if (untranslated || pending) setConfirm({ untranslated, pending });
    else void doCopy();
  };

  const issuesOf = (e: (typeof sheet.entries)[number]) => visibleIssues(e, s.reported, s.checkSettings);
  const cnt: Record<string, number> = { untranslated: 0, doubt: 0, think: 0, issues: 0 };
  sheet.entries.forEach((e) => {
    const m = effectiveMark(e);
    if (m in cnt) cnt[m]++;
    if (issuesOf(e).length) cnt.issues++;
  });

  const openMark = (ev: React.MouseEvent<HTMLButtonElement>, i: number) => {
    set({ rowMenu: { index: i, ...rowMenuPos(ev.currentTarget, customs.length) }, stampOpen: false, fileMenuOpen: false });
  };

  const rows = sheet.entries
    .map((e, i) => ({ e, i, m: effectiveMark(e), issues: issuesOf(e) }))
    .filter(({ m, issues }) => filter === 'all' || (filter === 'issues' ? issues.length > 0 : m === filter));

  return (
    <section aria-label="文本條目" style={{
      flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--panel)',
      border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden',
    }}>
      <div style={{ height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px 0 16px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span className="sec-label">文本條目</span>
          <span style={{ fontSize: 12, color: 'var(--mute)' }}>共 {sheet.entries.length} 條</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" className="ib" aria-label="全部檢查" title="全部檢查" onClick={() => s.checkAll()}
          style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'var(--btn)', border: '1px solid var(--line3)', borderRadius: 8, color: 'var(--text2)' }}>
          <IconScan size={15} />
        </button>
        <button type="button" className="ib" aria-label="複製譯文欄" title="複製譯文欄" onClick={askCopy}
          style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'var(--btn)', border: '1px solid var(--line3)', borderRadius: 8, color: copied ? 'var(--accent2)' : 'var(--text2)' }}>
          {copied ? <IconCheck size={14} sw={2.4} /> : <IconCopy size={14} />}
        </button>
        <div role="group" aria-label="篩選條目" className="seg-group">
          {FILTERS.map((f) => {
            const on = filter === f.id;
            return (
              <button key={f.id} type="button" className="seg" aria-pressed={on} onClick={() => set({ filter: f.id })}
                style={{
                  height: 26, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', border: 0, borderRadius: 6, fontSize: 12,
                  background: on ? 'var(--segon)' : 'transparent', color: on ? 'var(--text)' : 'var(--text2)',
                }}>
                {f.id === 'issues' ? <IconWarn size={12} sw={2.2} stroke="var(--warntx)" />
                  : f.id !== 'all' && <MarkIcon mark={{ kind: f.id }} size={12} menu />}
                {f.label}
                <span style={{ fontSize: 11, color: 'var(--mute)' }}>{f.id === 'all' ? sheet.entries.length : cnt[f.id]}</span>
              </button>
            );
          })}
        </div>
        </div>
      </div>
      <div style={{
        height: 32, flexShrink: 0, display: 'grid', gridTemplateColumns: HEAD_COLS, alignItems: 'center',
        padding: '0 12px 0 4px', fontSize: 11, fontWeight: 600, letterSpacing: 0.8, color: 'var(--mute)',
        borderBottom: '1px solid var(--line0)', background: 'var(--bar2)',
      }}>
        <span />
        <span style={{ textAlign: 'right', paddingRight: 2 }}>#</span>
        <span style={{ padding: '0 8px 0 4px' }}>發話者</span>
        <span style={{ padding: '0 16px 0 0' }}>原文</span>
        <span style={{ padding: '0 16px', borderLeft: '1px solid var(--line)' }}>譯文</span>
      </div>
      <div ref={listRef} style={{ flexGrow: 1, overflowY: 'auto', padding: '4px 0' }}>
        {rows.map(({ e, i, m, issues }) => {
          const on = i === sel, doubt = m === 'doubt', ver = m === 'verified', ign = m === 'ignore';
          const label = '標記：' + markName(customs, m) + '，點擊變更';
          return (
            <div key={e.uid} className="rw" style={{
              display: 'grid', gridTemplateColumns: '24px 16px minmax(0, 1fr)', padding: '0 12px 0 4px',
              borderTop: `1px solid ${on ? 'rgba(79,140,255,0.55)' : doubt ? 'var(--dbline)' : 'transparent'}`,
              borderBottom: `1px solid ${on ? 'rgba(79,140,255,0.55)' : doubt ? 'var(--dbline)' : 'transparent'}`,
              background: doubt ? (on ? 'var(--dbon)' : 'var(--db)') : on ? 'rgba(79,140,255,0.14)' : 'transparent',
            }}>
              <button type="button" className="mk" aria-haspopup="menu" aria-label={label} title={label} onClick={(ev) => openMark(ev, i)}
                style={{ width: 24, minHeight: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, background: 'transparent', border: 0, borderRadius: 4 }}>
                <MarkIcon mark={markVisual(customs, m)} size={14} />
              </button>
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start' }}>
                {e.note && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2.2" strokeLinejoin="round" role="img" aria-label="有備註">
                    <title>有備註</title><path d="M4 5h16v11H9.5L4 20.5z" />
                  </svg>
                )}
              </span>
              <button type="button" className="row" aria-current={on ? 'true' : undefined} onClick={() => select(s.file, sheetIdx, i)}
                style={{
                  minWidth: 0, minHeight: 38, display: 'grid', gridTemplateColumns: ROW_COLS, alignItems: 'center',
                  padding: 0, background: 'transparent', border: 0, textAlign: 'left', fontSize: 13,
                }}>
                <span className="mono" title={e.id} style={{ textAlign: 'right', paddingRight: 2, fontSize: 10, letterSpacing: -0.5, color: ver ? 'var(--mute3)' : 'var(--mute)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{e.id}</span>
                <span title={e.speaker} style={{ padding: '0 8px 0 4px', fontSize: 12, color: ver ? 'var(--mute3)' : 'var(--text2)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{e.speaker}</span>
                <span style={{ padding: '9px 16px 9px 0', lineHeight: 1.45, color: ver ? 'var(--mute2)' : 'var(--text)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{e.src}</span>
                <span style={{
                  padding: '9px 16px', lineHeight: 1.45, borderLeft: '1px solid var(--line0)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                  color: ver ? 'var(--mute2)' : e.tgt ? 'var(--textsoft)' : 'var(--mute2)', fontStyle: e.tgt ? 'normal' : 'italic',
                }}>
                  {issues.length > 0 && (
                    <span role="img" aria-label={issues.map((x) => x.msg).join('、')} title={issues.map((x) => x.msg).join('、')}
                      style={{ display: 'inline-flex', verticalAlign: '-2px', marginRight: 6, color: 'var(--warntx)', fontStyle: 'normal' }}>
                      <IconWarn size={13} sw={2.2} />
                    </span>
                  )}
                  {e.tgt || (ign ? '不需翻譯' : '尚未翻譯')}
                </span>
              </button>
            </div>
          );
        })}
        {rows.length === 0 && <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--mute)' }}>這個篩選條件下沒有條目</div>}
      </div>
      {confirm && <CopyConfirm {...confirm} onCancel={() => setConfirm(null)} onConfirm={() => void doCopy()} />}
    </section>
  );
}
