// 字體設定：系統字（整個介面）、原文、譯文各自的字形與大小
import { isTauri, invoke } from '@tauri-apps/api/core';

export type FontSlot = 'ui' | 'src' | 'tgt';

export interface FontSetting {
  /** 字形名稱；空字串代表預設（IBM Plex Sans＋思源黑體） */
  family: string;
  /** 大小（pt） */
  size: number;
}

export type FontSettings = Record<FontSlot, FontSetting>;

export const FONT_SLOTS: { id: FontSlot; label: string }[] = [
  { id: 'ui', label: '系統字' },
  { id: 'src', label: '原文' },
  { id: 'tgt', label: '譯文' },
];

export const DEFAULT_FONTS: FontSettings = {
  ui: { family: '', size: 11 },
  src: { family: '', size: 12 },
  tgt: { family: '', size: 12 },
};

export const MIN_PT = 8;
export const MAX_PT = 36;
/** 近期用過的字形最多記幾個 */
export const MAX_RECENT = 5;

const BASE_STACK = '"IBM Plex Sans", "Noto Sans TC", system-ui, sans-serif';

/** 字形名稱轉成 CSS 的 font-family；選的字形缺字時退回預設字形 */
export const fontStack = (family: string) => (family ? `"${family.replace(/"/g, '')}", ${BASE_STACK}` : BASE_STACK);

/** pt 換成畫面上的 px */
export const ptToPx = (pt: number) => (pt * 4) / 3;

/** 介面原本的基準字級（px）；系統字大小用它換算整體縮放比例 */
const UI_BASE_PX = 13;

/** 套在根元素上的 CSS 變數 */
export function fontVars(f: FontSettings): Record<string, string> {
  return {
    '--font-ui': fontStack(f.ui.family),
    '--ui-scale': String(ptToPx(f.ui.size) / UI_BASE_PX),
    '--font-src': fontStack(f.src.family),
    '--fs-src': ptToPx(f.src.size) + 'px',
    '--font-tgt': fontStack(f.tgt.family),
    '--fs-tgt': ptToPx(f.tgt.size) + 'px',
  };
}

/** 介面上的文字大小：跟著系統字大小等比例縮放 */
export const fz = (px: number) => `calc(var(--ui-scale, 1) * ${px}px)`;

let cache: Promise<string[]> | null = null;

/** 電腦已安裝的字形；瀏覽器預覽時只列幾個常見的 */
export function listFonts(): Promise<string[]> {
  if (!cache) {
    cache = isTauri()
      ? invoke<string[]>('list_fonts').catch(() => [])
      : Promise.resolve(['Arial', 'Calibri', 'Consolas', 'Georgia', 'Microsoft JhengHei', 'PMingLiU', 'Segoe UI', 'Times New Roman', 'Verdana']);
  }
  return cache;
}

/** 把剛選的字形放到近期清單最前面 */
export const pushRecent = (recent: string[], family: string) =>
  family ? [family, ...recent.filter((f) => f !== family)].slice(0, MAX_RECENT) : recent;
