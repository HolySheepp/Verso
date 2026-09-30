# Verso

翻譯工作台桌面 App（Tauri 2 + React + TypeScript）。版本 0.10.0。

## 開發

```
npm install
npm run dev        # 瀏覽器預覽 http://localhost:1420
npm run tauri dev  # 桌面 App（需要 Rust 與 C++ 編譯工具），也可以直接雙擊「啟動Verso.bat」
npm test           # 標記與記錄槽位規則測試
```

## 結構

- `src/model/`：資料型別、標記規則（marks.ts）、記錄槽位規則（history.ts）
- `src/data/`：範例資料與讀寫接口（source.ts）。接真正的檔案時新增一個 ProjectSource 實作並替換 activeSource
- `src/state/store.ts`：介面狀態與操作
- `src/components/`：各區塊元件
- `src-tauri/`：桌面外殼設定

## 只有外觀、尚未實作

迷你瀏覽器、參照分頁、新增分頁、插入標籤、開啟其他檔案、自動儲存、設定中的「一般」「工作模式」「外觀」分類。
工作欄右側的清除譯文等按鈕為示範用暫代功能。
