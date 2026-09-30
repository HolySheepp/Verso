# Verso

翻譯工作台桌面 App（Tauri 2 + React + TypeScript）。版本 0.19.0。

## 開發

```
npm install
npm run dev        # 瀏覽器預覽 http://localhost:1420
npm run tauri dev  # 桌面 App（需要 Rust 與 C++ 編譯工具），也可以直接雙擊「啟動Verso.bat」
npm test           # 標記與記錄槽位規則測試
```

## 結構

- `src/model/`：資料型別、標記規則（marks.ts）、記錄槽位規則（history.ts）
- `src/data/`：存檔資料夾與 xlsx 的讀寫
- `src/state/store.ts`：介面狀態與操作
- `src/components/`：各區塊元件
- `src-tauri/`：桌面外殼設定

## 只有外觀、尚未實作

迷你瀏覽器、參照分頁、新增分頁、插入標籤、開啟其他檔案、設定中的「工作模式」分類。
工作欄右側的清除譯文等按鈕為示範用暫代功能。

## 存檔

預設存在「文件\Verso」，可在設定「一般」更改。每個專案一個子資料夾，每個檔案一個 xlsx（一個頁簽一個工作表），專案設定在 project.json；字典存在「字典」子資料夾。App 設定（存檔資料夾、快捷鍵等）存在系統的 App 設定資料夾。
