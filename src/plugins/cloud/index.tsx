// 雲端模式外掛（測試版）：開發者選項的開關與登入、檔案選單的「新增／管理 Google 表」、設定表的對話框、寫回衝突的詢問。
// 整個資料夾（加上桌面外殼的 src-tauri/src/plugins/cloud）刪掉重新打包，就是沒有雲端模式的 Verso。
import { useEffect, useState } from 'react';
import { tx } from '../../i18n';
import { fz } from '../../model/fonts';
import { checkColumns, COLS, type ColKey } from '../../model/paste';
import { emptyFields, fieldsToColumns, type FieldMap } from '../../model/importSel';
import { SHARED } from '../../model/types';
import { showToast, useStore } from '../../state/store';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Select } from '../../components/Select';
import { Preview, type DraftSheet } from '../../components/ImportDialog';
import { dragWindow } from '../../components/windowDrag';
import { IconList, IconPlus, IconRefresh, IconWinClose } from '../../components/icons';
import { beforeExit } from '../hooks';
import type { VersoPlugin } from '../registry';
import { errText, insertCol, login, loginStatus, logout, meta, readTabs, sidOf } from './api';
import { loadConfig, setConfig, toFields, toFieldMap, useCloud, type CloudSheet, type CloudTab } from './config';
import { enterCloud, flushAll, pickShown, putSheet, refreshAll, removeSheet, resolveConflict, watchStore } from './sync';

const btn: React.CSSProperties = { height: 32, padding: '0 14px', background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, fontSize: fz(12.5) };
const primary: React.CSSProperties = { height: 36, padding: '0 18px', background: 'var(--primary)', border: 0, borderRadius: 8, color: '#ffffff', fontSize: fz(13), fontWeight: 600 };
const menuItem: React.CSSProperties = {
  width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: 0, borderRadius: 6,
  background: 'transparent', color: 'var(--text2)', textAlign: 'left',
};

/** 打開或關掉雲端模式 */
async function setCloud(on: boolean) {
  setConfig({ on });
  if (on) {
    useStore.getState().set({ cloudMode: true });
    await enterCloud();
  } else {
    await flushAll();
    useStore.getState().set({ cloudMode: false });
    pickShown();
  }
}

/** 開發者選項：雲端模式開關、Google 用戶端 ID、登入 */
function CloudDevOption() {
  const cloudMode = useStore((s) => s.cloudMode);
  const cfg = useCloud((s) => s.cfg);
  const email = useCloud((s) => s.email);
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
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: fz(13), marginTop: 12 }}>
        <input type="checkbox" checked={cloudMode} onChange={(e) => void setCloud(e.target.checked)} />
        {tx('cloud.enabled')}
      </label>
      <div style={{ fontSize: fz(12), color: 'var(--mute)' }}>{tx('cloud.hint')}</div>
      {cloudMode && (
        <div style={{ display: 'grid', gridTemplateColumns: '120px minmax(0, 1fr)', alignItems: 'center', gap: '8px 12px', marginTop: 4 }}>
          <label htmlFor="verso-cloud-cid" style={label}>{tx('cloud.clientId')}</label>
          <input id="verso-cloud-cid" className="field" value={cfg.clientId} onChange={(e) => setConfig({ clientId: e.target.value })} />
          <label htmlFor="verso-cloud-secret" style={label}>{tx('cloud.clientSecret')}</label>
          <input id="verso-cloud-secret" className="field" type="password" value={cfg.clientSecret} onChange={(e) => setConfig({ clientSecret: e.target.value })} />
          <span style={label}>{tx('cloud.account')}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: fz(12.5) }}>
            {email ? tx('cloud.signedIn', { email }) : tx('cloud.signedOut')}
            {email
              ? <button type="button" className="btn btn-ghost" style={btn} onClick={() => { void logout(); useCloud.setState({ email: null }); }}>{tx('cloud.logout')}</button>
              : <button type="button" className="btn btn-ghost" style={btn} disabled={busy || !cfg.clientId.trim()} onClick={() => void doLogin()}>{busy ? tx('cloud.loggingIn') : tx('cloud.login')}</button>}
          </span>
          {err && <span role="alert" style={{ gridColumn: '1 / -1', fontSize: fz(12.5), color: 'var(--errtx)' }}>{err}</span>}
        </div>
      )}
    </>
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
      <button type="button" className="dd" style={menuItem} onClick={() => { close(); void refreshAll(false).then(() => showToast(tx('cloud.refreshed'))); }}>
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

/** 必選的欄位（可以是空的）；譯文不選就在原文右邊插入一欄 */
const REQUIRED: ColKey[] = ['id', 'speaker', 'src', 'note'];

interface Draft extends DraftSheet { gid: number }

/** 設定一份 Google 表：貼網址、選專案，再像匯入檔案一樣在預覽裡選各欄的範圍 */
function SetupDialog({ sid0 }: { sid0?: string }) {
  const close = () => useCloud.setState({ setup: null });
  const projects = useStore((s) => s.project?.projects ?? NONE);
  const old = useCloud.getState().cfg.sheets.find((x) => x.sid === sid0);
  const [url, setUrl] = useState(sid0 ? `https://docs.google.com/spreadsheets/d/${sid0}` : '');
  const [project, setProject] = useState(old?.project ?? (projects.includes(useStore.getState().project?.files[useStore.getState().file]?.project ?? '') ? useStore.getState().project!.files[useStore.getState().file].project : SHARED));
  const [title, setTitle] = useState('');
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [cur, setCur] = useState(0);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

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
        return { id: 'g' + t.gid, gid: t.gid, name: t.title, rows, width: Math.max(1, ...rows.map((r) => r.length)), fields: prev ? toFieldMap(prev.fields, rows.length - 1) : emptyFields() };
      }));
      setCur(0);
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
      const conf: CloudSheet = { sid, title, project, tabs };
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
        <div role="tablist" className="no-scrollbar" style={{ display: 'flex', gap: 6, overflowX: 'auto', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
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
  const sheets = useCloud((s) => s.cfg.sheets);
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
          <h2 id="verso-cloud-conflict" style={{ margin: 0, fontSize: fz(15), fontWeight: 600 }}>{tx('cloud.conflictTitle', { id: c.id || '?' })}</h2>
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

function Overlay() {
  const setup = useCloud((s) => s.setup);
  const manage = useCloud((s) => s.manage);
  return (
    <>
      {setup && <SetupDialog key={setup.sid ?? 'new'} sid0={setup.sid} />}
      {manage && <ManageDialog />}
      <ConflictAsk />
    </>
  );
}

/** 軟體開好後：讀設定、登入狀態；上次開著雲端模式就打開，之後每分鐘重新讀取 */
async function start() {
  const cfg = await loadConfig();
  watchStore();
  beforeExit.add(flushAll);
  try { useCloud.setState({ email: await loginStatus() }); } catch { /* 沒有桌面外殼（瀏覽器預覽） */ }
  if (cfg.on && useStore.getState().devMode) await setCloud(true);
  setInterval(() => { if (useStore.getState().cloudMode) void refreshAll(); }, 60_000);
  // 關掉開發者模式時雲端模式也關掉
  useStore.subscribe((s, prev) => { if (prev.cloudMode && !s.cloudMode && useCloud.getState().cfg.on) void setCloud(false); });
}

export const plugin: VersoPlugin = { id: 'cloud', DevOptions: CloudDevOption, FileMenu: CloudFileMenu, Overlay, start: () => void start() };
