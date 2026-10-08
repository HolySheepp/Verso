import { tx } from '../i18n';
// 顏色換算：HSV ↔ hex（自訂主題色的色盤用）

export interface Hsv { h: number; s: number; v: number } // h: 0–360，s／v: 0–1

export function hsvToRgb({ h, s, v }: Hsv): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0');

export function hsvToHex(hsv: Hsv): string {
  const [r, g, b] = hsvToRgb(hsv);
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

export function rgbToHsv(r: number, g: number, b: number): Hsv {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/** 解析 #rgb／#rrggbb；看不懂就回傳 null */
export function hexToHsv(hex: string): Hsv | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let s = m[1];
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  return rgbToHsv(parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16));
}

/** 統一成 #rrggbb 小寫；看不懂就回傳 null */
export function normalizeHex(hex: string): string | null {
  const hsv = hexToHsv(hex);
  return hsv ? hsvToHex(hsv) : null;
}

/** 內建主題色：名稱與畫色票用的顏色（實際色值在 theme.css，深淺主題各一組） */
export const ACCENTS: { id: string; label: string; dark: string; light: string }[] = [
  { id: 'blue', get label() { return tx('colors.001'); }, dark: '#4f8cff', light: '#2f6fe4' },
  { id: 'green', get label() { return tx('colors.002'); }, dark: '#4cc38a', light: '#1f9d62' },
  { id: 'purple', get label() { return tx('colors.003'); }, dark: '#ac86f9', light: '#7342d7' },
  { id: 'teal', get label() { return tx('colors.004'); }, dark: '#30c9e8', light: '#1395ae' },
  { id: 'amber', get label() { return tx('colors.005'); }, dark: '#f0a93b', light: '#b7720c' },
  { id: 'rose', get label() { return tx('colors.006'); }, dark: '#f06b8e', light: '#d23f68' },
];

/** 自訂主題色最多幾個 */
export const MAX_CUSTOM_ACCENTS = 5;
