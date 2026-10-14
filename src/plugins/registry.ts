// 外掛插座：主程式只留插座（條目欄工具列、開發者選項、專案設定），外掛放在 src/plugins/<名稱>/index.ts。
// 打包時找得到的外掛才會放進來：刪掉某個外掛的資料夾重新打包，就是沒有那個功能的 Verso，其他程式碼不用改。
import type { ComponentType } from 'react';

export interface VersoPlugin {
  id: string;
  /** 條目欄上方工具列的按鈕 */
  ListToolbar?: ComponentType;
  /** 設定 > 開發者選項裡的開關 */
  DevOptions?: ComponentType;
  /** 管理專案 > 專案設定裡的一區（tag 是這個專案的標籤） */
  ProjectSettings?: ComponentType<{ tag: string }>;
}

const found = import.meta.glob<{ plugin: VersoPlugin }>('./*/index.{ts,tsx}', { eager: true });

/** 這次打包進來的外掛 */
export const plugins: VersoPlugin[] = Object.values(found).map((m) => m.plugin).filter(Boolean);

