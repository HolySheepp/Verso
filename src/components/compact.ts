// 綜合分頁裡的卡片（字典詞、翻譯記憶、搜尋結果）用比較小的字和行距，三塊才放得下
import { createContext } from 'react';

export const CompactCtx = createContext(false);

/** 一般大小 → 綜合分頁裡的大小 */
export const shrink = (on: boolean, size: number) => (on ? Math.max(10.5, size - 1.5) : size);
/** 綜合分頁裡卡片的外框：內距、間距都小一點 */
export const compactCard = (on: boolean): React.CSSProperties => (on ? { padding: '7px 9px', gap: 2 } : {});
