// 自動檢查更新：安裝版在啟動畫面檢查（最多等 2 秒），查到就問要不要更新；
// 沒查到結果就先進軟體，背景每 10 分鐘再試，查到時在標題列顯示小圖示。
// 攜帶版只顯示小圖示，按了打開下載頁；開發版不檢查。
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Update } from '@tauri-apps/plugin-updater';
import { useStore } from './store';

export const RELEASES_URL = 'https://github.com/HolySheepp/Verso/releases/latest';

const STARTUP_WAIT = 2000;
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

  useStore.setState({ loading: { p: 0.02, text: '檢查更新' } });
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

/** 下載並安裝：啟動畫面顯示下載進度，接著由安裝程式顯示安裝進度，裝好後自動重開 */
async function install(): Promise<boolean> {
  const u = pending;
  if (!u) return false;
  let total = 0, got = 0;
  const show = (p: number, text: string) => useStore.setState({ loading: { p, text } });
  show(0, '下載更新 0%');
  try {
    await u.downloadAndInstall((ev) => {
      if (ev.event === 'Started') total = ev.data.contentLength ?? 0;
      else if (ev.event === 'Progress') {
        got += ev.data.chunkLength;
        const p = total ? got / total : 0;
        show(p, total ? `下載更新 ${Math.floor(p * 100)}%` : '下載更新中');
      } else if (ev.event === 'Finished') show(1, '安裝中，完成後會自動重新開啟');
    });
    // Windows 上安裝程式會關掉並重開 Verso；萬一沒有，就自己重開
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
    return true;
  } catch (e) {
    show(1, '更新失敗：' + String((e as Error)?.message ?? e).slice(0, 60) + '，用目前的版本開啟');
    await new Promise((r) => setTimeout(r, 1800));
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
  // 更新前先存檔，畫面換成啟動畫面顯示進度
  const { saveNow } = await import('./saver');
  await saveNow();
  useStore.setState({ loading: { p: 0, text: '準備更新' } });
  const ok = await install();
  if (!ok) useStore.setState({ loading: null });
}
