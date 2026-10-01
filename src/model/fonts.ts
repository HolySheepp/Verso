// 字體設定：系統字（整個介面）、id 與發話者（系統字的子項）、原文、譯文各自的字形與大小
import { isTauri, invoke } from '@tauri-apps/api/core';

export type FontSlot = 'ui' | 'id' | 'speaker' | 'src' | 'tgt';

/** 條目欄裡文字超出格子時：刪節號省略、自動換行、縮小字級塞進格子 */
export type Overflow = 'ellipsis' | 'wrap' | 'shrink';

export interface FontSetting {
  /** 字形名稱；空字串代表預設（IBM Plex Sans＋思源黑體） */
  family: string;
  /** 大小（pt） */
  size: number;
  /** 系統字的子項（id、發話者）：跟隨系統字時不用自己的字形與大小 */
  inherit?: boolean;
  /** 系統字沒有這個選項 */
  overflow?: Overflow;
}

export type FontSettings = Record<FontSlot, FontSetting>;

export const FONT_SLOTS: { id: FontSlot; label: string; sub?: boolean }[] = [
  { id: 'ui', label: '系統字' },
  { id: 'id', label: 'id', sub: true },
  { id: 'speaker', label: '發話者', sub: true },
  { id: 'src', label: '原文' },
  { id: 'tgt', label: '譯文' },
];

export const OVERFLOWS: { id: Overflow; label: string }[] = [
  { id: 'ellipsis', label: '省略' },
  { id: 'wrap', label: '自動換行' },
  { id: 'shrink', label: '自動縮放' },
];

export const DEFAULT_FONTS: FontSettings = {
  ui: { family: '', size: 11 },
  id: { family: '', size: 8, inherit: true, overflow: 'shrink' },
  speaker: { family: '', size: 9, inherit: true, overflow: 'shrink' },
  src: { family: '', size: 12, overflow: 'wrap' },
  tgt: { family: '', size: 12, overflow: 'wrap' },
};

/** 舊設定檔沒有的欄位用預設補上 */
export function withFontDefaults(f: Partial<FontSettings> | undefined): FontSettings {
  const out = { ...DEFAULT_FONTS };
  if (f) (Object.keys(DEFAULT_FONTS) as FontSlot[]).forEach((k) => { if (f[k]) out[k] = { ...DEFAULT_FONTS[k], ...f[k] }; });
  return out;
}

export const overflowOf = (f: FontSettings, slot: FontSlot): Overflow => f[slot].overflow ?? DEFAULT_FONTS[slot].overflow ?? 'ellipsis';

/** 跟預設一樣（還原預設鈕用） */
export const isDefaultFont = (f: FontSetting, slot: FontSlot) => {
  const d = DEFAULT_FONTS[slot];
  return f.family === d.family && f.size === d.size && !!f.inherit === !!d.inherit && (f.overflow ?? d.overflow) === d.overflow;
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
    // id、發話者跟隨系統字時：字形同系統字，大小照原本的比例跟著系統字縮放
    '--font-id': f.id.inherit ? 'var(--font-ui)' : fontStack(f.id.family),
    '--fs-id': f.id.inherit ? 'calc(var(--ui-scale) * 10px)' : ptToPx(f.id.size) + 'px',
    '--font-spk': f.speaker.inherit ? 'var(--font-ui)' : fontStack(f.speaker.family),
    '--fs-spk': f.speaker.inherit ? 'calc(var(--ui-scale) * 12px)' : ptToPx(f.speaker.size) + 'px',
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
