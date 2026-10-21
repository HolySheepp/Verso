// 外掛插座：主程式只留插座（條目欄工具列、開發者選項、專案設定），外掛放在 src/plugins/<名稱>/index.ts。
// 打包時找得到的外掛才會放進來：刪掉某個外掛的資料夾重新打包，就是沒有那個功能的 Verso，其他程式碼不用改。
import type { ComponentType } from 'react';

export interface VersoPlugin {
  id: string;
  /** 條目欄上方工具列的按鈕 */
  ListToolbar?: ComponentType;
  /** 設定 > 開發者選項裡的開關 */
  DevOptions?: ComponentType;
  /** 設定左邊多一個分類（例如「雲端」） */
  SettingsSection?: { id: string; label(): string; Component: ComponentType };
  /** 管理專案 > 專案設定裡的一區（tag 是這個專案的標籤） */
  ProjectSettings?: ComponentType<{ tag: string }>;
  /** 檔案選單底下的項目（雲端模式時取代「手動貼入、新增檔案、管理專案」）；close 關掉檔案選單 */
  FileMenu?: ComponentType<{ close(): void }>;
  /** 一直掛著的畫面（外掛自己的對話框） */
  Overlay?: ComponentType;
  /**
   * 存檔資料夾載入後執行一次，啟動畫面等它做完才進主畫面。
   * step 回報這一段的進度（0～1）和說明，進度條跟著走
   */
  start?: (step: (p: number, text: string) => void) => void | Promise<void>;
  /** 啟動時要不要花時間做事（例如雲端模式要先讀 Google 表）：要的話進度條留一段給它 */
  slowStart?: () => Promise<boolean>;
}

const found = import.meta.glob<{ plugin: VersoPlugin }>('./*/index.{ts,tsx}', { eager: true });

/** 這次打包進來的外掛 */
export const plugins: VersoPlugin[] = Object.values(found).map((m) => m.plugin).filter(Boolean);

