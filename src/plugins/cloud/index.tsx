// 雲端模式外掛（測試版）：開發者選項的開關與登入、檔案選單的「新增／管理 Google 表」、設定表的對話框、寫回衝突的詢問。
// 整個資料夾（加上桌面外殼的 src-tauri/src/plugins/cloud）刪掉重新打包，就是沒有雲端模式的 Verso。
import { Fragment, useEffect, useState } from 'react';
import { tx } from '../../i18n';
import { fz } from '../../model/fonts';
import { checkColumns, COLS, type ColKey } from '../../model/paste';
import { emptyFields, fieldsToColumns, isVersoHeader, type FieldMap } from '../../model/importSel';
import { SHARED } from '../../model/types';
import { currentOf, ensureUserName, showToast, useStore } from '../../state/store';
import { isDirty, saveNow } from '../../state/saver';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Select } from '../../components/Select';
import { Preview, type DraftSheet } from '../../components/ImportDialog';
import { useScrollTabs } from '../../components/ScrollTabs';
import { dragWindow } from '../../components/windowDrag';
import { IconFolder, IconList, IconPlus, IconRefresh, IconWinClose } from '../../components/icons';
import { flushDicts, removeDicts, watchDicts } from './dicts';
import { leaveProjects, writePresets } from './projects';
import { ProjectsDialog } from './ProjectsDialog';
import { SrcUpdateCloud, openSrcUpdate } from './SrcUpdateCloud';
import { beforeExit, rowHook, tabHook } from '../hooks';
import type { VersoPlugin } from '../registry';
import { builtinClient, errText, insertCol, login, loginStatus, logout, meta, readTabs, sidOf } from './api';
import { allSheets, loadConfig, setConfig, toFields, toFieldMap, useCloud, type CloudSheet, type CloudTab } from './config';
import { rememberPos, isVersoTab, convertVersoTab, removeRows, tabRemove, rowOp, tabRename, tabDelete, tabInsert, currentSid, enterCloud, flushAll, pickShown, putSheet, refreshAll, removeSheet, resolveConflict, watchStore } from './sync';

const btn: React.CSSProperties = { height: 32, padding: '0 14px', background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, fontSize: fz(12.5) };
const primary: React.CSSProperties = { height: 36, padding: '0 18px', background: 'var(--primary)', border: 0, borderRadius: 8, color: '#ffffff', fontSize: fz(13), fontWeight: 600 };
const menuItem: React.CSSProperties = {
  width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: 0, borderRadius: 6,
  background: 'transparent', color: 'var(--text2)', textAlign: 'left',
};

/** 打開或關掉雲端模式（打開前本地檔案有沒存的修改就先問）；step 是啟動畫面的進度 */
async function setCloud(on: boolean, step?: (p: number, text: string) => void) {
  // 問「離開這個檔案前要儲存嗎？」：存或不存之後再打開
  if (on && isDirty()) { useStore.setState({ askSave: { kind: 'leave', target: null, go: () => void setCloud(true) }, fileMenuOpen: false }); return; }
  setConfig({ on });
  if (on) {
    useStore.getState().set({ cloudMode: true });
    if (!useCloud.getState().cfg.userName?.trim()) void ensureUserName();
    await enterCloud(step);
  } else {
    await flushAll();
    await flushDicts();
    useStore.getState().set({ cloudMode: false });
    // 雲端字典、雲端才有的專案拿掉，常用標準換回這台電腦的
    removeDicts();
    leaveProjects();
    pickShown();
  }
}

/** 開發者選項：雲端模式開關、Google 用戶端 ID、登入 */
function CloudDevOption() {
  const cloudMode = useStore((s) => s.cloudMode);
  const cfg = useCloud((s) => s.cfg);
  const email = useCloud((s) => s.email);
  const builtin = useCloud((s) => s.builtin);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const label: React.CSSProperties = { fontSize: fz(12.5), color: 'var(--text2)' };
  const doLogin = async () => {
    setBusy(true); setErr('');
    try { useCloud.setState({ email: await login(cfg.clientId, cfg.clientSecret) || '?' }); } catch (e) { setErr(errText(e)); }
    setBusy(false);
  };
  return (
    <>
      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 52, padding: '8px 12px', background: 'var(--card)', border: '1px solid var(--line2)', borderRadius: 8, cursor: 'pointer' }}>
        <span style={{ fontSize: fz(13.5), fontWeight: 600 }}>{tx('cloud.enabled')}</span>
        <input type="checkbox" role="switch" className="switch" checked={cloudMode} onChange={(e) => void setCloud(e.target.checked)} />
      </label>
      <div style={{ fontSize: fz(12), color: 'var(--mute)' }}>{tx('cloud.hint')}</div>
      {cloudMode && (
        <div style={{ display: 'grid', gridTemplateColumns: '120px minmax(0, 1fr)', alignItems: 'center', gap: '8px 12px', marginTop: 4 }}>
          {/* 打包時內建了用戶端（發布的版本）：不用填 */}
          {!builtin && <>
            <label htmlFor="verso-cloud-cid" style={label}>{tx('cloud.clientId')}</label>
            <input id="verso-cloud-cid" className="field" value={cfg.clientId} onChange={(e) => setConfig({ clientId: e.target.value })} />
            <label htmlFor="verso-cloud-secret" style={label}>{tx('cloud.clientSecret')}</label>
            <input id="verso-cloud-secret" className="field" type="password" value={cfg.clientSecret} onChange={(e) => setConfig({ clientSecret: e.target.value })} />
          </>}
          <label htmlFor="verso-cloud-user" style={label}>{tx('cloud.userName')}</label>
          <input id="verso-cloud-user" className="field" value={cfg.userName ?? ''} placeholder={tx('cloud.userNameHint')} onChange={(e) => setConfig({ userName: e.target.value })} />
          <label htmlFor="verso-cloud-data" style={label}>{tx('cloud.dataUrl')}</label>
          <input id="verso-cloud-data" className="field" value={cfg.dataUrl ?? ''} placeholder="https://docs.google.com/spreadsheets/d/…" onChange={(e) => setConfig({ dataUrl: e.target.value })} />
          <span style={{ gridColumn: '2', fontSize: fz(12), color: 'var(--mute)', marginTop: -4 }}>{tx('cloud.dataHint')}</span>
          <span style={label}>{tx('cloud.account')}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: fz(12.5) }}>
            {email ? tx('cloud.signedIn', { email }) : tx('cloud.signedOut')}
            {email
              ? <button type="button" className="btn btn-ghost" style={btn} onClick={() => { void logout(); useCloud.setState({ email: null }); }}>{tx('cloud.logout')}</button>
              : <button type="button" className="btn btn-ghost" style={btn} disabled={busy || (!builtin && !cfg.clientId.trim())} onClick={() => void doLogin()}>{busy ? tx('cloud.loggingIn') : tx('cloud.login')}</button>}
          </span>
          {err && <span role="alert" style={{ gridColumn: '1 / -1', fontSize: fz(12.5), color: 'var(--errtx)' }}>{err}</span>}
        </div>
      )}
    </>
  );
}

/** 條目欄上方的同步按鈕（打開的是 Google 表時）：先寫回再重新讀取；轉圈代表同步中，紅框代表上次沒同步成功 */
function SyncButton() {
  const isCloud = useStore((s) => s.cloudMode && !!s.project?.files[s.file]?.cloud);
  const syncing = useCloud((s) => s.syncing);
  const last = useCloud((s) => s.lastSync);
  const error = useCloud((s) => s.syncError);
  if (!isCloud) return null;
  const title = error || (last ? tx('cloud.lastSync', { time: new Date(last).toLocaleTimeString() }) : tx('cloud.sync'));
  return (
    <button type="button" className="btn btn-ghost" title={title} aria-label={tx('cloud.sync')} disabled={syncing} onClick={() => void refreshAll(false)}
      style={{ height: 34, display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px', background: 'var(--btn)', border: '1px solid ' + (error ? 'var(--errtx)' : 'var(--line3)'), borderRadius: 8, fontSize: fz(12.5), color: error ? 'var(--errtx)' : 'var(--text2)' }}>
      <IconRefresh size={14} style={syncing ? { animation: 'verso-spin 0.9s linear infinite' } : undefined} />{syncing ? tx('cloud.syncing') : tx('cloud.sync')}
    </button>
  );
}

/** 檔案選單（雲端模式）：新增、管理 Google 表，重新讀取 */
function CloudFileMenu({ close }: { close(): void }) {
  return (
    <>
      <button type="button" className="dd" style={menuItem} onClick={() => { close(); useCloud.setState({ setup: {} }); }}>
        <IconPlus size={14} />{tx('cloud.addSheet')}
      </button>
      <button type="button" className="dd" style={menuItem} onClick={() => { close(); useCloud.setState({ manage: true }); }}>
        <IconList size={14} />{tx('cloud.manage')}
      </button>
      <button type="button" className="dd" style={menuItem} onClick={() => { close(); useCloud.setState({ projectsOpen: true }); }}>
        <IconFolder size={14} />{tx('cloud.projects')}
      </button>
      <button type="button" className="dd" style={menuItem} onClick={() => { close(); void refreshAll(false).then(() => { if (!useCloud.getState().syncError) showToast(tx('cloud.refreshed')); }); }}>
        <IconRefresh size={14} />{tx('cloud.refresh')}
      </button>
    </>
  );
}

function Shell({ title, width, height, onClose, children, footer }: { title: string; width: number; height?: number; onClose(): void; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="scrim" style={{ zIndex: 45 }} onMouseDown={dragWindow}>
      <div role="dialog" aria-modal="true" aria-labelledby="verso-cloud-title" className="dialog"
        style={{ width, height, maxWidth: 'calc(100% - 48px)', maxHeight: 'calc(100% - 48px)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>
        <div style={{ height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px 0 20px', borderBottom: '1px solid var(--line)' }}>
          <h2 id="verso-cloud-title" style={{ margin: 0, fontSize: fz(15), fontWeight: 600 }}>{title}</h2>
          <button type="button" className="ib" aria-label={tx('cloud.close')} onClick={onClose}
            style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 0, borderRadius: 8, color: 'var(--text2)' }}>
            <IconWinClose size={13} sw={1.4} />
          </button>
        </div>
        {children}
        {footer}
      </div>
    </div>
  );
}

const NONE: string[] = [];

/** Verso 存檔格式的分頁（第一列是 Verso 的欄位標題）：直接套用欄位範圍，不用自己選 */
function versoFields(rows: string[][]): FieldMap | null {
  const head = (rows[0] ?? []).map((x) => x.trim());
  if (!isVersoHeader(head) && !(head[0] === '#' && head[1] === '發話者' && head[2] === '原文' && head[3] === '譯文' && head.includes('備註'))) return null;
  const data = Array.from({ length: Math.max(0, rows.length - 1) }, (_, i) => i + 1);
  if (!data.length) return null;
  const at = (col: number) => (col >= 0 ? { col, rows: data } : null);
  return { id: at(0), speaker: at(1), src: at(2), tgt: at(3), note: at(head.indexOf('備註')) };
}

/** 必選的欄位（可以是空的）；譯文不選就在原文右邊插入一欄 */
const REQUIRED: ColKey[] = ['id', 'speaker', 'src', 'note'];

interface Draft extends DraftSheet { gid: number }

/** 設定一份 Google 表：貼網址、選專案，再像匯入檔案一樣在預覽裡選各欄的範圍 */
function SetupDialog({ sid0, gid0 }: { sid0?: string; gid0?: number }) {
  const close = () => useCloud.setState({ setup: null });
  const projects = useStore((s) => s.project?.projects ?? NONE);
  const old = allSheets().find((x) => x.sid === sid0);
  const [url, setUrl] = useState(sid0 ? `https://docs.google.com/spreadsheets/d/${sid0}` : '');
  const [project, setProject] = useState(old?.project ?? (projects.includes(useStore.getState().project?.files[useStore.getState().file]?.project ?? '') ? useStore.getState().project!.files[useStore.getState().file].project : SHARED));
  const [title, setTitle] = useState('');
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [cur, setCur] = useState(0);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // 頁簽列：滾輪左右捲動，放不下時兩邊淡出
  const tabsScroll = useScrollTabs();

  const read = async () => {
    const sid = sidOf(url);
    if (!sid) { setErr(tx('cloud.badUrl')); return; }
    setBusy(true); setErr('');
    try {
      const m = await meta(sid);
      const values = await readTabs(sid, m.tabs.map((t) => t.title));
      setTitle(m.title);
      setDrafts(m.tabs.map((t, i) => {
        const rows = values[i];
        const prev = old?.tabs.find((x) => x.gid === t.gid);
        return { id: 'g' + t.gid, gid: t.gid, name: t.title, rows, width: Math.max(1, ...rows.map((r) => r.length)), fields: prev ? toFieldMap(prev.fields, rows.length - 1) : versoFields(rows) ?? emptyFields() };
      }));
      // 從還沒設定的分頁點進來：直接停在那個分頁
      setCur(Math.max(0, m.tabs.findIndex((t) => t.gid === gid0)));
    } catch (e) { setErr(errText(e)); }
    setBusy(false);
  };
  useEffect(() => { if (sid0) void read(); }, []);

  const projectRow = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <label htmlFor="verso-cloud-url" style={{ fontSize: fz(12), color: 'var(--text2)', flexShrink: 0 }}>{tx('cloud.url')}</label>
      <input id="verso-cloud-url" className="field" value={url} disabled={!!drafts} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" style={{ flexGrow: 1, minWidth: 0 }} />
      <label htmlFor="verso-cloud-proj" style={{ fontSize: fz(12), color: 'var(--text2)', flexShrink: 0 }}>{tx('cloud.project')}</label>
      <Select id="verso-cloud-proj" value={project} options={projects.map((p) => ({ value: p, label: p }))} onChange={setProject} style={{ width: 160 }} />
      {!drafts && <button type="button" className="btn btn-ghost" style={btn} disabled={busy || !url.trim()} onClick={() => void read()}>{busy ? tx('cloud.reading') : tx('cloud.read')}</button>}
    </div>
  );

  if (!drafts) {
    return (
      <Shell title={tx('cloud.setupTitle')} width={720} onClose={close}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '16px 20px 20px' }}>
          {projectRow}
          <div style={{ fontSize: fz(12), color: 'var(--mute)' }}>{tx('cloud.setupHint')}</div>
          <div role="alert" style={{ minHeight: 18, fontSize: fz(12.5), color: 'var(--errtx)' }}>{err}</div>
        </div>
      </Shell>
    );
  }

  const sheet = drafts[Math.min(cur, drafts.length - 1)];
  const used = drafts.filter((d) => Object.values(d.fields).some(Boolean));
  const problem = (d: Draft): string => {
    const lack = REQUIRED.filter((k) => !d.fields[k]);
    if (lack.length) return tx('cloud.needFields', { name: d.name, fields: lack.map((k) => COLS.find((c) => c.key === k)!.label).join(tx('common.sep')) });
    const r = checkColumns(fieldsToColumns(d.rows, d.fields));
    return r.ok ? '' : tx('common.sheetError', { name: d.name, msg: r.msg });
  };
  const error = used.map(problem).find(Boolean) ?? (used.length ? '' : tx('cloud.noTabs'));
  const save = async () => {
    const sid = sidOf(url)!;
    setBusy(true); setErr('');
    try {
      const tabs: CloudTab[] = [];
      for (const d of used) {
        let fields: FieldMap = d.fields;
        // Verso 存檔格式：標記、修改等搬進 Verso 資料表，表上這些欄刪掉（轉成雲端檔）
        if (isVersoTab(d.rows) && sidOf(useCloud.getState().cfg.dataUrl ?? '')) fields = await convertVersoTab(sid, d.gid, d.name, d.rows);
        // 沒選譯文：在原文右邊插入一欄，右邊的欄位跟著往右移
        if (!fields.tgt) {
          const at = fields.src!.col + 1;
          await insertCol(sid, d.gid, at);
          const shift = { ...fields };
          (Object.keys(shift) as ColKey[]).forEach((k) => { const f = shift[k]; if (f && f.col >= at) shift[k] = { ...f, col: f.col + 1 }; });
          fields = { ...shift, tgt: { col: at, rows: fields.src!.rows } };
        }
        tabs.push({ gid: d.gid, title: d.name, fields: toFields(fields, d.rows.length - 1) });
      }
      // R15 檔照樣列出全部分頁
      const conf: CloudSheet = { sid, title, project, tabs, ...(old?.allTabs ? { allTabs: true } : {}) };
      close();
      await putSheet(conf);
    } catch (e) { setErr(errText(e)); setBusy(false); }
  };

  return (
    <Shell title={tx('cloud.setupTitle')} width={1040} height={700} onClose={close}
      footer={(
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 20px 16px', borderTop: '1px solid var(--line)' }}>
          <span role="alert" style={{ fontSize: fz(12.5), color: 'var(--errtx)', minWidth: 0 }}>{err || error}</span>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button type="button" className="btn btn-ghost" style={{ ...btn, height: 36 }} onClick={close}>{tx('cloud.cancel')}</button>
            <button type="button" className="btn btn-primary" style={primary} disabled={!!error || busy} onClick={() => void save()}>{busy ? tx('cloud.saving') : tx('cloud.save')}</button>
          </div>
        </div>
      )}>
      <div style={{ flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 20px' }}>
        {projectRow}
        <div style={{ fontSize: fz(12), color: 'var(--mute)' }}>{tx('cloud.pickHint', { title })}</div>
        {drafts.some((d) => isVersoTab(d.rows)) && <div style={{ fontSize: fz(12), color: 'var(--accent2)' }}>{sidOf(useCloud.getState().cfg.dataUrl ?? '') ? tx('cloud.versoConvert') : tx('cloud.versoNoData')}</div>}
        <div role="tablist" className="no-scrollbar" ref={tabsScroll.ref} style={{ display: 'flex', gap: 6, overflowX: 'auto', borderBottom: '1px solid var(--line)', flexShrink: 0, ...tabsScroll.style }}>
          {drafts.map((d, i) => {
            const on = i === cur;
            const set = Object.values(d.fields).some(Boolean);
            return (
              <button key={d.id} type="button" role="tab" className="stab" aria-selected={on} onClick={() => setCur(i)}
                style={{ height: 36, padding: '0 10px', background: 'transparent', border: 0, borderBottom: `2px solid ${on ? 'var(--accent)' : 'transparent'}`, fontSize: fz(13), fontWeight: 500, color: on ? 'var(--text)' : 'var(--mute)', whiteSpace: 'nowrap' }}>
                {d.name}{set ? ' ✓' : ''}
              </button>
            );
          })}
        </div>
        {sheet && <Preview key={sheet.id} sheet={sheet} onFields={(fields) => setDrafts((all) => all!.map((d, j) => (j === cur ? { ...d, fields } : d)))} />}
      </div>
    </Shell>
  );
}

/** 管理設定過的 Google 表：重新設定、不再使用（Google 上的不動） */
function ManageDialog() {
  // 資料表裡共用的和這台電腦自己設定的都列出來
  useCloud((s) => s.cfg);
  useCloud((s) => s.shared);
  const sheets = allSheets();
  const close = () => useCloud.setState({ manage: false });
  const [ask, setAsk] = useState<CloudSheet | null>(null);
  return (
    <Shell title={tx('cloud.manage')} width={620} onClose={close}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '14px 20px 20px', maxHeight: 460, overflowY: 'auto' }}>
        {!sheets.length && <div style={{ fontSize: fz(12.5), color: 'var(--mute)' }}>{tx('cloud.noSheets')}</div>}
        {sheets.map((x, i) => (
          <div key={x.sid} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 6, background: i % 2 ? 'transparent' : 'var(--ov1)' }}>
            <span style={{ flexGrow: 1, minWidth: 0, fontSize: fz(13), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.title || x.sid}</span>
            <span style={{ fontSize: fz(12), color: 'var(--mute)' }}>{x.project}</span>
            <span style={{ fontSize: fz(12), color: 'var(--mute)' }}>{tx('cloud.tabCount', { n: x.tabs.length })}</span>
            <button type="button" className="btn btn-ghost" style={btn} onClick={() => useCloud.setState({ manage: false, setup: { sid: x.sid } })}>{tx('cloud.resetup')}</button>
            <button type="button" className="btn btn-ghost" style={btn} onClick={() => setAsk(x)}>{tx('cloud.remove')}</button>
          </div>
        ))}
      </div>
      {ask && (
        <ConfirmDialog zIndex={60} title={tx('cloud.removeAsk', { name: ask.title || ask.sid })} body={tx('cloud.removeBody')}
          choices={[{ label: tx('cloud.cancel'), onClick: () => setAsk(null) }, { label: tx('cloud.remove'), primary: true, onClick: () => { const x = ask; setAsk(null); void removeSheet(x.sid); } }]} />
      )}
    </Shell>
  );
}

/** 刪除 Google 上的列或分頁之前：列出內容，確認後才刪 */
function DeletePreview({ ask }: { ask: NonNullable<ReturnType<typeof useCloud.getState>['askDelete']> }) {
  const [busy, setBusy] = useState(false);
  const close = () => useCloud.setState({ askDelete: null });
  return (
    <div className="scrim" style={{ zIndex: 70 }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="verso-cloud-del" className="dialog" style={{ width: 560, maxHeight: 'calc(100% - 48px)', boxShadow: '0 24px 64px rgba(0,0,0,0.45)' }}>
        <div style={{ padding: '20px 20px 8px', display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
          <h2 id="verso-cloud-del" style={{ margin: 0, fontSize: fz(15), fontWeight: 600 }}>{ask.title}</h2>
          <div style={{ fontSize: fz(12.5), color: 'var(--text2)' }}>{tx('cloud.deleteHint')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', maxHeight: 360 }}>
            {ask.rows.map((r) => (
              <div key={r.row} style={{ padding: '8px 10px', background: 'var(--ov1)', borderRadius: 6, display: 'grid', gridTemplateColumns: '110px minmax(0, 1fr)', gap: '4px 10px', fontSize: fz(12.5) }}>
                <span style={{ gridColumn: '1 / -1', color: 'var(--mute)', fontSize: fz(11.5) }}>{tx('cloud.rowNo', { n: r.row + 1 })}</span>
                {r.cells.length ? r.cells.map(([k, v], i) => <Fragment key={i}><span style={{ color: 'var(--mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k}</span><span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{v}</span></Fragment>) : <span style={{ gridColumn: '1 / -1', color: 'var(--mute)' }}>{tx('cloud.empty')}</span>}
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 20px 16px' }}>
          <button type="button" className="btn btn-ghost" style={{ ...btn, height: 36 }} onClick={close} disabled={busy}>{tx('cloud.cancel')}</button>
          <button type="button" className="btn btn-primary" style={primary} disabled={busy} onClick={() => { setBusy(true); void ask.run().finally(close); }}>{tx('cloud.deleteConfirm')}</button>
        </div>
      </div>
    </div>
  );
}

/** 寫回時發現別人改過：一次問一條 */
function ConflictAsk() {
  const c = useCloud((s) => s.conflicts[0]);
  if (!c) return null;
  const row = (label: string, text: string) => (
    <div style={{ display: 'grid', gridTemplateColumns: '64px minmax(0, 1fr)', gap: 8, fontSize: fz(13), lineHeight: 1.5 }}>
      <span style={{ color: 'var(--mute)' }}>{label}</span>
      <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 120, overflowY: 'auto' }}>{text || tx('cloud.empty')}</span>
    </div>
  );
  return (
    <div className="scrim" style={{ zIndex: 70 }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="verso-cloud-conflict" className="dialog" style={{ width: 520, boxShadow: '0 24px 64px rgba(0,0,0,0.45)' }}>
        <div style={{ padding: '20px 20px 8px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 id="verso-cloud-conflict" style={{ margin: 0, fontSize: fz(15), fontWeight: 600 }}>{tx(c.field === 'note' ? 'cloud.conflictNote' : c.field === 'speaker' ? 'cloud.conflictSpeaker' : c.field === 'src' ? 'cloud.conflictSrcText' : 'cloud.conflictTitle', { id: c.id || '?' })}</h2>
          {row(tx('cloud.conflictSrc'), c.src)}
          {row(tx('cloud.conflictMine'), c.mine)}
          {row(tx('cloud.conflictTheirs'), c.theirs)}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 20px 16px' }}>
          <button type="button" className="btn btn-ghost" style={{ ...btn, height: 36 }} onClick={() => void resolveConflict(c, false)}>{tx('cloud.useTheirs')}</button>
          <button type="button" className="btn btn-primary" style={primary} autoFocus onClick={() => void resolveConflict(c, true)}>{tx('cloud.useMine')}</button>
        </div>
      </div>
    </div>
  );
}

/** 請使用者輸入用戶名（留言時顯示的名字） */
function UserNameDialog() {
  const ask = useStore((s) => s.userNameAsk);
  const [name, setName] = useState(useCloud.getState().cfg.userName ?? '');
  if (!ask) return null;
  const done = (v: string | null) => {
    useStore.setState({ userNameAsk: null });
    if (v?.trim()) setConfig({ userName: v.trim() });
    ask.resolve(v?.trim() || null);
  };
  return (
    <div className="scrim" style={{ zIndex: 80 }}>
      <div role="dialog" aria-modal="true" aria-labelledby="verso-user-title" className="dialog" style={{ width: 400, boxShadow: '0 24px 64px rgba(0,0,0,0.45)' }}>
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) done(name); }} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 id="verso-user-title" style={{ margin: 0, fontSize: fz(15), fontWeight: 600 }}>{tx('cloud.userNameTitle')}</h2>
          <div style={{ fontSize: fz(13), color: 'var(--text2)', lineHeight: 1.5 }}>{tx('cloud.userNameBody')}</div>
          <label htmlFor="verso-user-input" className="sr-only">{tx('cloud.userName')}</label>
          <input id="verso-user-input" className="field" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
            <button type="button" className="btn btn-ghost" style={{ ...btn, height: 36 }} onClick={() => done(null)}>{tx('cloud.cancel')}</button>
            <button type="submit" className="btn btn-primary" style={primary} disabled={!name.trim()}>{tx('cloud.userNameOk')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Overlay() {
  const setup = useCloud((s) => s.setup);
  const manage = useCloud((s) => s.manage);
  const projectsOpen = useCloud((s) => s.projectsOpen);
  const askDelete = useCloud((s) => s.askDelete);
  const srcUpd = useCloud((s) => s.srcUpd);
  const confirm = useCloud((s) => s.confirm);
  return (
    <>
      <UserNameDialog />
      {setup && <SetupDialog key={setup.sid ?? 'new'} sid0={setup.sid} gid0={setup.gid} />}
      {manage && <ManageDialog />}
      {projectsOpen && <ProjectsDialog />}
      {askDelete && <DeletePreview ask={askDelete} />}
      {confirm && (
        <ConfirmDialog zIndex={70} title={confirm.title} body={confirm.body}
          choices={[{ label: tx('cloud.cancel'), onClick: () => useCloud.setState({ confirm: null }) }, { label: confirm.ok, primary: true, onClick: () => { const c = confirm; useCloud.setState({ confirm: null }); void c.run(); } }]} />
      )}
      {srcUpd && <SrcUpdateCloud key={srcUpd.sid + ':' + srcUpd.sheet} sid={srcUpd.sid} start={srcUpd.sheet} />}
      <ConflictAsk />
    </>
  );
}

/** 軟體開好後：讀設定、登入狀態；上次開著雲端模式就打開，之後每分鐘重新讀取 */
async function start(step: (p: number, text: string) => void) {
  const cfg = await loadConfig();
  useStore.setState({ userName: cfg.userName ?? '' });
  useCloud.subscribe((c, prev) => { if (c.cfg.userName !== prev.cfg.userName) useStore.setState({ userName: c.cfg.userName ?? '' }); });
  watchStore();
  watchDicts();
  rowHook.fn = (kind, rows, count) => (kind === 'remove' ? removeRows(rows) : rowOp(kind, rows, count));
  tabHook.remove = tabRemove;
  tabHook.rename = tabRename;
  tabHook.delete = tabDelete;
  tabHook.insert = tabInsert;
  tabHook.srcUpdate = openSrcUpdate;
  beforeExit.add(rememberPos);
  beforeExit.add(flushAll);
  // 換條目、頁簽、檔案後稍等一下記下位置（當機也不會差太遠）
  let posTimer: ReturnType<typeof setTimeout> | undefined;
  useStore.subscribe((s, prev) => {
    if (!s.cloudMode || (s.file === prev.file && s.sheetBy === prev.sheetBy && s.selBy === prev.selBy)) return;
    clearTimeout(posTimer);
    posTimer = setTimeout(() => void rememberPos(), 3000);
  });
  beforeExit.add(flushDicts);
  // 點開還沒設定欄位的分頁（R15 表的其他分頁）：跳出設定視窗、停在那個分頁
  useStore.subscribe((s, prev) => {
    if (!s.cloudMode || (s.file === prev.file && s.sheetBy === prev.sheetBy && s.project?.files[s.file] === prev.project?.files[prev.file])) return;
    const { fileDoc, sheet } = currentOf(s);
    const was = prev.project ? currentOf(prev) : null;
    if (!sheet?.setup || !fileDoc.cloud || (was?.sheet.gid === sheet.gid && was?.fileDoc.cloud?.sid === fileDoc.cloud.sid)) return;
    if (!useCloud.getState().setup) useCloud.setState({ setup: { sid: fileDoc.cloud.sid, gid: sheet.gid } });
  });
  // 雲端模式改了常用標準：寫進資料表
  useStore.subscribe((s, prev) => { if (s.cloudMode && prev.cloudMode && s.lengthPresets !== prev.lengthPresets) void writePresets(s.lengthPresets); });
  try { useCloud.setState({ email: await loginStatus(), builtin: await builtinClient() }); } catch { /* 沒有桌面外殼（瀏覽器預覽） */ }
  if (cfg.on && navigator.onLine === false) {
    // 沒有網路：不讀 Google 表，直接進主畫面，問要不要關掉雲端模式；連上網路後自動讀取
    useStore.getState().set({ cloudMode: true });
    useCloud.setState({ confirm: { title: tx('cloud.offlineTitle'), body: tx('cloud.offlineBody'), ok: tx('cloud.offlineOff'), run: () => setCloud(false) } });
    window.addEventListener('online', () => {
      if (!useStore.getState().cloudMode) return;
      if (useCloud.getState().confirm?.title === tx('cloud.offlineTitle')) useCloud.setState({ confirm: null });
      void enterCloud();
    }, { once: true });
  } else if (cfg.on) await setCloud(true, step);
  // 自動同步：打開的那份每 20 秒，其他的每 2 分鐘；從別的視窗（例如瀏覽器）回到 Verso 時馬上同步打開的那份
  let tick = 0;
  setInterval(() => {
    if (!useStore.getState().cloudMode) return;
    tick++;
    if (tick % 6 === 0) void refreshAll();
    else { const sid = currentSid(); if (sid) void refreshAll(true, sid); }
  }, 20_000);
  window.addEventListener('focus', () => { const sid = currentSid(); if (sid) void refreshAll(true, sid); });
  // 雲端模式時本地只剩自訂標記、專案設定這類改動：自動存（沒有儲存鍵）
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  useStore.subscribe((s) => {
    if (!s.cloudMode || s.saveStatus !== 'dirty') return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { if (useStore.getState().cloudMode && isDirty()) void saveNow(false); }, 2000);
  });
  // 雲端模式被別的地方關掉時，照正常流程收尾（寫回、拿掉雲端字典等）
  useStore.subscribe((s, prev) => { if (prev.cloudMode && !s.cloudMode && useCloud.getState().cfg.on) void setCloud(false); });
}

export const plugin: VersoPlugin = { id: 'cloud', ListToolbar: SyncButton, SettingsSection: { id: 'cloud', label: () => tx('cloud.section'), Component: CloudDevOption }, FileMenu: CloudFileMenu, Overlay, start, slowStart: async () => (await loadConfig()).on && navigator.onLine !== false };
