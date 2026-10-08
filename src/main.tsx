import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/noto-sans-tc/400.css';
import '@fontsource/noto-sans-tc/500.css';
import '@fontsource/noto-sans-tc/700.css';
import './theme.css';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useStore } from './state/store';
import { startApp } from './state/saver';
import { applyLang } from './i18n/lang';

// 介面語言：一開始就套用上次的語言（啟動畫面的字也要對）
applyLang(useStore.getState().uiLang);

/** 換語言時整個畫面重畫一次，每個地方的文字都換成新語言 */
function Root() {
  const lang = useStore((s) => s.uiLang);
  // 語言包內容改了（例如重新掃描讀到新版）也整個重畫
  const stamp = useStore((s) => s.langStamp);
  return <App key={lang + ':' + stamp} />;
}

// 檔案拖進軟體視窗：打開匯入視窗讀這個檔案（不讓視窗直接打開檔案）
window.addEventListener('dragover', (ev) => ev.preventDefault());
window.addEventListener('drop', (ev) => {
  ev.preventDefault();
  const file = ev.dataTransfer?.files[0];
  const s = useStore.getState();
  if (!file || !s.project) return;
  // 其他對話框開著時不處理，避免蓋掉正在編輯的內容
  if (s.settingsOpen || s.termDraft || s.pasteOpen || s.srcUpdate !== null || s.dictPasteOpen || s.manageProjectsOpen || s.manageDictsOpen || s.moveTarget || s.lengthDialog || s.askSave) return;
  s.set({ importOpen: true, importFile: file, fileMenuOpen: false });
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
);

// 啟動：讀設定、載入存檔資料夾（只跑一次，換語言重畫畫面時不會重來）
void startApp();
