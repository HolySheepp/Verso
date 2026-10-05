import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri 開發時固定使用 1420 埠
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  // 打包出來的前端檔案放在專案外的「建置暫存」，不放進本體資料夾
  build: { target: 'es2022', sourcemap: false, outDir: '../建置暫存/dist', emptyOutDir: true },
});
