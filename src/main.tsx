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
import { useStore } from './state/store';

// 檔案拖進軟體視窗：打開匯入視窗讀這個檔案（不讓視窗直接打開檔案）
window.addEventListener('dragover', (ev) => ev.preventDefault());
window.addEventListener('drop', (ev) => {
  ev.preventDefault();
  const file = ev.dataTransfer?.files[0];
  const s = useStore.getState();
  if (!file || !s.project) return;
  // 其他對話框開著時不處理，避免蓋掉正在編輯的內容
  if (s.settingsOpen || s.termDraft || s.pasteOpen || s.dictPasteOpen || s.manageProjectsOpen || s.manageDictsOpen || s.moveTarget || s.lengthDialog || s.askSave) return;
  s.set({ importOpen: true, importFile: file, fileMenuOpen: false });
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
