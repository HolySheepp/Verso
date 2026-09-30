// 介面用到的線條圖示，路徑取自設計檔
import type { ReactNode } from 'react';

interface P { size?: number; sw?: number; style?: React.CSSProperties; stroke?: string }

const make = (children: ReactNode) =>
  function Icon({ size = 14, sw = 2, style, stroke = 'currentColor' }: P) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={sw}
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>{children}</svg>
    );
  };

export const IconLogo = make(<><path d="M3 5h6l3 11 3-11h6" /><path d="M9 19h6" /></>);
export const IconPen = make(<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" />);
export const IconPenEdit = make(<><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></>);
export const IconShield = make(<><path d="M12 3l7 3v5c0 5-3.2 8.3-7 10-3.8-1.7-7-5-7-10V6z" /><path d="M8.8 12.2l2.2 2.2 4.2-4.4" /></>);
export const IconEye = make(<><path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></>);
export const IconSrcEdit = make(<><path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5" /><path d="M13 3l5 5" /><path d="M14 21v-2.5l5.5-5.5a1.8 1.8 0 0 1 2.5 2.5L16.5 21z" /></>);
export const IconSun = make(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>);
export const IconMoon = make(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />);
export const IconGear = make(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>);
export const IconChevL = make(<path d="M15 18l-6-6 6-6" />);
export const IconChevR = make(<path d="M9 18l6-6-6-6" />);
export const IconChevD = make(<path d="M6 9l6 6 6-6" />);
export const IconFile = make(<><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /></>);
export const IconFolder = make(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />);
export const IconArrowR = make(<path d="M4 12h15M13 6l6 6-6 6" />);
export const IconPlus = make(<path d="M12 5v14M5 12h14" />);
export const IconHideTop = make(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M4 5h16v4H4z" fill="currentColor" stroke="none" /><path d="M9 15l3-3 3 3" /></>);
export const IconHideRight = make(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 5h5v14h-5z" fill="currentColor" stroke="none" /><path d="M8 9l3 3-3 3" /></>);
export const IconNote = make(<path d="M4 5h16v11H9.5L4 20.5z" />);
export const IconLock = make(<><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>);
export const IconFeather = make(<><path d="M20 3C12 4 6.5 9 5 17l-1 4" /><path d="M20 3c.5 6-3.5 11.5-11 13" /><path d="M9.5 11.5L14 7" /></>);
export const IconUse = make(<><path d="M20 4v8a3 3 0 0 1-3 3H6" /><path d="M10 10.5L5.5 15l4.5 4.5" /></>);
export const IconCopy = make(<><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></>);
export const IconEraser = make(<><path d="M20 20H9L4 15a2 2 0 0 1 0-2.8L13.2 3a2 2 0 0 1 2.8 0L21 8a2 2 0 0 1 0 2.8L12 20" /><path d="M7.5 9.5l7 7" /></>);
export const IconUndo = make(<><path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>);
export const IconBraces = make(<><path d="M8 4c-2 0-3 1-3 3v2c0 1.5-1 3-2 3 1 0 2 1.5 2 3v2c0 2 1 3 3 3" /><path d="M16 4c2 0 3 1 3 3v2c0 1.5 1 3 2 3-1 0-2 1.5-2 3v2c0 2-1 3-3 3" /></>);
export const IconCheck = make(<path d="M5 12.5l4.5 4.5L19 7.5" />);
export const IconBook = make(<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z" /><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" /></>);
export const IconSearch = make(<><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>);
export const IconGlobe = make(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>);
export const IconBookmark = make(<path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />);
export const IconRefresh = make(<><path d="M21 12a9 9 0 1 1-2.6-6.4L21 8" /><path d="M21 3v5h-5" /></>);
export const IconTrash = make(<><path d="M4 7h16" /><path d="M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13" /><path d="M9 7V4h6v3" /></>);

// 視窗按鈕與對話框關閉鈕用 12x12 格線
const win = (children: ReactNode) =>
  function WinIcon({ size = 12, sw = 1.2 }: P) {
    return <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={sw} aria-hidden="true">{children}</svg>;
  };
export const IconWinMin = win(<path d="M1 6h10" />);
export const IconWinMax = win(<rect x="1.5" y="1.5" width="9" height="9" />);
export const IconWinClose = win(<path d="M1.5 1.5l9 9M10.5 1.5l-9 9" />);
