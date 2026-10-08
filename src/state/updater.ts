// 自動檢查更新：安裝版在啟動畫面檢查（最多等 2 秒），查到就問要不要更新；
// 沒查到結果就先進軟體，背景每 10 分鐘再試，查到時在標題列顯示小圖示。
// 攜帶版只顯示小圖示，按了打開下載頁；開發版不檢查。
import { tx } from '../i18n';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Update } from '@tauri-apps/plugin-updater';
import { useStore } from './store';

export const RELEASES_URL = 'https://github.com/HolySheepp/Verso/releases/latest';

const STARTUP_WAIT = 2000;
/** 下載更新時超過這麼久沒有進度就放棄 */
const STALL_LIMIT = 60 * 1000;
const RETRY_EVERY = 10 * 60 * 1000;

let pending: Update | null = null;
let kind: 'installed' | 'portable' = 'installed';
let retry: ReturnType<typeof setInterval> | undefined;

const enabled = () => isTauri() && !import.meta.env.DEV;

async function checkOnce(): Promise<Update | null> {
  const { check } = await import('@tauri-apps/plugin-updater');
  return (await check({ timeout: 15000 })) ?? null;
}

/** 啟動時：查到新版本就問（安裝版）；回傳 true 表示正在更新，軟體會重開，不必繼續啟動 */
export async function checkAtStartup(): Promise<boolean> {
  if (!enabled()) return false;
  try { kind = (await invoke<string>('install_kind')) === 'portable' ? 'portable' : 'installed'; } catch { /* 當成安裝版 */ }
  if (kind === 'portable') { startBackgroundCheck(); return false; }

  useStore.setState({ loading: { p: 0.02, text: tx('update.001') } });
  const found = await Promise.race([
    checkOnce().catch(() => null),
    new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), STARTUP_WAIT)),
  ]);
  if (found === 'timeout' || !found) { startBackgroundCheck(); return false; }

  pending = found;
  // 在啟動畫面上問，等使用者選
  const yes = await new Promise<boolean>((resolve) => useStore.setState({ updatePrompt: { version: found.version, resolve } }));
  useStore.setState({ updatePrompt: null });
  if (!yes) { useStore.setState({ updateAvailable: found.version }); return false; }
  return install();
}

/** 下載並安裝：啟動畫面顯示下載進度（可以取消），接著由安裝程式顯示安裝進度，裝好後自動重開 */
async function install(): Promise<boolean> {
  const u = pending;
  if (!u) return false;
  let total = 0, got = 0;
  // 下載中可以按「取消」；60 秒沒有進度也自動放棄。放棄後就不安裝（下載中的內容直接丟掉）
  let stop: (why: string) => void = () => {};
  const stopped = new Promise<never>((_, reject) => { stop = (why) => reject(new Error(why)); });
  const cancel = () => stop('canceled');
  let stall = setTimeout(() => stop(tx('update.002')), STALL_LIMIT);
  const alive = () => { clearTimeout(stall); stall = setTimeout(() => stop(tx('update.002')), STALL_LIMIT); };
  const show = (p: number, text: string, canCancel = true) => useStore.setState({ loading: { p, text, cancel: canCancel ? cancel : undefined } });
  show(0, tx('update.003'));
  try {
    await Promise.race([stopped, u.download((ev) => {
      alive();
      if (ev.event === 'Started') total = ev.data.contentLength ?? 0;
      else if (ev.event === 'Progress') {
        got += ev.data.chunkLength;
        const p = total ? got / total : 0;
        show(p, total ? tx('update.004', { v1: Math.floor(p * 100) }) : tx('update.005'));
      }
    })]);
    clearTimeout(stall);
    // 開始安裝之後就不能取消了
    show(1, tx('update.006'), false);
    await u.install();
    // Windows 上安裝程式會關掉並重開 Verso；萬一沒有，就自己重開
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
    return true;
  } catch (e) {
    clearTimeout(stall);
    const msg = String((e as Error)?.message ?? e);
    if (msg === 'canceled') { useStore.setState({ updateAvailable: u.version }); return false; }
    show(1, tx('update.007', { v1: msg.slice(0, 60) }), false);
    await new Promise((r) => setTimeout(r, 1800));
    useStore.setState({ updateAvailable: u.version });
    startBackgroundCheck();
    return false;
  }
}

/** 背景檢查：每 10 分鐘一次，查到就在標題列顯示小圖示 */
function startBackgroundCheck() {
  if (retry) return;
  const run = async () => {
    try {
      const u = await checkOnce();
      if (!u) return;
      pending = u;
      useStore.setState({ updateAvailable: u.version });
      clearInterval(retry);
    } catch { /* 下次再試 */ }
  };
  retry = setInterval(() => { void run(); }, RETRY_EVERY);
  // 攜帶版、或啟動時沒等到結果：不等 10 分鐘，現在就先在背景試一次
  void run();
}

/** 按標題列的小圖示：安裝版問要不要更新（先存檔），攜帶版打開下載頁 */
export async function onUpdateIcon() {
  if (kind === 'portable') {
    try { await invoke('open_url', { url: RELEASES_URL }); } catch { /* 打不開就算了 */ }
    return;
  }
  const v = useStore.getState().updateAvailable;
  if (!v) return;
  const yes = await new Promise<boolean>((resolve) => useStore.setState({ updatePrompt: { version: v, resolve } }));
  useStore.setState({ updatePrompt: null });
  if (!yes) return;
  // 有未儲存的修改：先問要不要儲存，選好了才更新（取消就不更新）
  const { askSaveThen, dropRecovery, flushBeforeExit } = await import('./saver');
  askSaveThen(() => void (async () => {
    // 已經存好（或選了不儲存）：暫存復原用不到了，避免更新重開後又問要不要恢復
    await dropRecovery();
    // 跟關閉軟體一樣：字典、目前位置、設定先寫進去
    await flushBeforeExit();
    // 畫面換成啟動畫面顯示進度
    useStore.setState({ loading: { p: 0, text: tx('update.008') } });
    const ok = await install();
    if (!ok) useStore.setState({ loading: null });
  })());
}
