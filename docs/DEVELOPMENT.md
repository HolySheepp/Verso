# Verso 開發交接

這是 Verso 0.120.7 的開發與 QA 基線。原始碼位於「翻譯界面本體」。工作區旁的設計稿可用來對照需求，建置暫存與安裝包是輸出，簽章與發布憑證由發布流程管理。

## 分工與交接

| 角色 | 負責範圍 | 交接內容 |
| --- | --- | --- |
| 主工程師 | 追查前端、桌面後端與資料格式，設計跨模組變更並整合修正 | 影響範圍、相容性、實作與驗證結果 |
| QA | 獨立閱讀相關程式，涵蓋本機與雲端資料路徑，驗證桌面行為與回歸 | 測試環境、重現步驟、實際與預期結果、尚待驗證的路徑 |
| 待辦整理 | 收錄需求、已重現缺陷與待查項目，依使用者影響和依賴排序 | 更新 [待辦清單](BACKLOG.md)，記錄負責角色、狀態、驗收條件與證據 |
| 小型修正工程師 | 處理已有重現方式、預期行為明確且修正範圍集中的問題 | 最小修改、修正前後的結果、相關自動測試或手動驗證 |

待辦整理收到問題後先登記期望行為與重現條件。需要釐清資料格式、跨模組行為或產品決策時，由主工程師追查。QA 依實際受影響的入口複驗，待辦整理再依結果更新狀態。

## 程式架構

| 路徑 | 主要責任 |
| --- | --- |
| [main.tsx](../src/main.tsx)、[App.tsx](../src/App.tsx) | 啟動 React、套用介面語言、註冊拖放匯入，並組合條目清單、工作欄與側欄 |
| [WorkPanel.tsx](../src/components/WorkPanel.tsx)、[store.ts](../src/state/store.ts) | 編輯一筆條目時協調輸入草稿、校對工作階段和 Zustand 狀態。條目修改、標記、檔案／頁簽選取及頁簽層級復原由 store 管理 |
| [model](../src/model) | 定義 `ProjectData → FileDoc → Sheet → Entry` 及標記、字典比對、翻譯記憶匹配、校對與原文對齊等規則 |
| [saver.ts](../src/state/saver.ts)、[persist.ts](../src/data/persist.ts)、[fsio.ts](../src/data/fsio.ts) | 載入設定和工作區，追蹤待存變更，串行保存，處理復原暫存、資料夾監看和外部變更。Tauri 使用檔案系統，瀏覽器預覽使用 `localStorage` |
| [importio.ts](../src/data/importio.ts)、[xlsxio.ts](../src/data/xlsxio.ts)、[xlsxAsync.ts](../src/data/xlsxAsync.ts) | 解析匯入資料、讀寫本機 XLSX 專案及字典，支援用 Worker 序列化 XLSX |
| [state/tm.ts](../src/state/tm.ts)、[tm.rs](../src-tauri/src/tm.rs) | 處理確認條目時的翻譯記憶寫入、匹配、歷史與待同步操作，桌面端透過 Rust 寫入 SQLite |
| [registry.ts](../src/plugins/registry.ts)、[hooks.ts](../src/plugins/hooks.ts)、[lib.rs](../src-tauri/src/lib.rs) | 使用 Vite 發現前端外掛，提供列／頁簽與離開程式的接點，並由 Rust 註冊 Tauri 指令和桌面外掛 |
| [cloud/sync.ts](../src/plugins/cloud/sync.ts)、[cloud/api.ts](../src/plugins/cloud/api.ts)、[Rust cloud](../src-tauri/src/plugins/cloud/mod.rs) | 載入 Google 試算表、維護本機快取、比較同步基準、寫回欄位並處理衝突。Rust 端處理 OAuth 與 API 呼叫 |
| [ai/ai.ts](../src/plugins/ai/ai.ts)、[Rust AI](../src-tauri/src/plugins/ai/mod.rs) | 建立 AI 任務並處理條目讀寫工具。桌面端提供本機 MCP 服務與 Claude Code 程序管理 |

## 主要驗證路徑

- **本機編輯與復原**。用測試工作區匯入多頁簽檔案，修改譯文、標記與備註，切換條目後分別驗證復原、手動儲存、自動保存和重開。比較 XLSX 與介面的內容，並以測試資料模擬未正常關閉與外部檔案替換。
- **字典、原文更新與翻譯記憶**。覆蓋共用和專案字典、技能串展開／收合時的命中，在有重複 ID 或原文變動的情況下檢查對齊，再確認翻譯記憶寫入、比對及重開後的結果。
- **雲端寫回**。以模擬 API 或獨立測試試算表覆蓋同一列在兩端同時修改、在途寫回失敗與重試、列／頁簽位移，以及備註欄位缺少時的行為。
- **桌面與外掛**。在 Windows 桌面版驗證視窗關閉、資料夾監看、SQLite 持久化及更新提示。AI 啟動、套用和停止使用獨立測試資料驗證。瀏覽器預覽可檢查介面流程，原生功能需要桌面環境。

## 自動檢查基線

在「翻譯界面本體」執行 `npm run typecheck`、`npm test` 和 `npm run build`。本次三項皆通過，Vitest 共 45 個檔案、242 項測試。Vite 提示部分動態匯入無法形成獨立分塊，主程式 JavaScript 分塊約 1.48 MB，gzip 約 458 kB。

桌面端在 `src-tauri` 執行 `cargo test --lib --offline --locked`，SQLite 翻譯記憶讀寫與匯出測試通過（1 項）。Windows 桌面實機、Google 試算表與 AI 的整合測試尚待執行。
