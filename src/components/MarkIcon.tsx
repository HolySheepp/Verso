// 標記圖示，對應設計檔 MarkIcon.dc.html
import type { MarkVisual } from '../model/marks';

interface Props {
  mark: MarkVisual;
  size: number;
  /** 在選單裡才畫「已翻譯」「已驗證」；條目列表中這兩種不顯示 */
  menu?: boolean;
}

export function MarkIcon({ mark, size: sz, menu = false }: Props) {
  const color = 'color' in mark ? mark.color : '#a3a9b6';
  const svg = (children: React.ReactNode, extra: React.SVGProps<SVGSVGElement> = {}) => (
    <svg width={sz} height={sz} viewBox="0 0 24 24" aria-hidden="true" {...extra}>{children}</svg>
  );
  const filled = { fill: 'currentColor' };
  const stroked = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

  let body: React.ReactNode = null;
  switch (mark.kind) {
    case 'untranslated':
      body = svg(<circle cx="12" cy="12" r="3.4" fill="#7d8494" />);
      break;
    case 'translated':
      if (menu) body = svg(<path d="M5 12.5l4.5 4.5L19 7.5" />, { fill: 'none', stroke: '#8a90a0', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' });
      break;
    case 'verified':
      if (menu) body = svg(<><circle cx="12" cy="12" r="9" /><path d="M8 12.3l2.8 2.8 5.7-5.7" /></>, { fill: 'none', stroke: '#8a90a0', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' });
      break;
    case 'doubt':
      body = svg(<><circle cx="12" cy="12" r="9.5" fill="#e8b93a" /><path d="M12 6.8v6.4" stroke="#1c1e24" strokeWidth="2.6" strokeLinecap="round" /><circle cx="12" cy="16.8" r="1.5" fill="#1c1e24" /></>);
      break;
    case 'think':
      body = svg(<path d="M12 6l7 12H5z" fill="#5b72a0" stroke="#5b72a0" strokeWidth="1.5" strokeLinejoin="round" />);
      break;
    case 'ignore':
      body = svg(<path d="M7 12h10" stroke="#7d8494" strokeWidth="2.8" strokeLinecap="round" />);
      break;
    case 'sym':
      body = {
        star: svg(<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z" />, { fill: 'currentColor', stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round' }),
        heart: svg(<path d="M12 20.5s-8-4.8-8-10.6A4.4 4.4 0 0 1 12 7.3a4.4 4.4 0 0 1 8 2.6c0 5.8-8 10.6-8 10.6z" />, filled),
        diamond: svg(<path d="M12 3l8 9-8 9-8-9z" />, filled),
        square: svg(<rect x="5" y="5" width="14" height="14" rx="3" />, filled),
        bolt: svg(<path d="M13.5 2L5 13.5h6L10 22l8.5-11.5h-6z" />, filled),
        bookmark: svg(<path d="M6 3h12v18l-6-4.5L6 21z" />, filled),
        bell: svg(<><path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>, stroked),
        eye: svg(<><path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></>, stroked),
        chat: svg(<path d="M4 5h16v11H9.5L4 20.5z" />, filled),
        pin: svg(<><circle cx="12" cy="8.5" r="5" /><path d="M12 13.5V21" fill="none" /></>, { fill: 'currentColor', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round' }),
        hash: svg(<path d="M9.5 4L7.5 20M16.5 4l-2 16M4.5 9h15.5M4 15h15.5" />, stroked),
        question: svg(<><circle cx="12" cy="12" r="9.5" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 1-1 1.7v.3" /><circle cx="12" cy="17" r="0.6" fill="currentColor" /></>, stroked),
      }[mark.sym];
      break;
    case 'text': {
      const latin = /^[A-Za-z]+$/.test(mark.text);
      const n = Array.from(mark.text).length;
      body = (
        <span style={{
          minWidth: sz, height: sz, boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 1px', borderRadius: 4, color,
          background: /^#[0-9a-fA-F]{6}$/.test(color) ? color + '2e' : 'rgba(255,255,255,0.1)',
          fontSize: Math.max(7, Math.round(sz * (latin && n > 1 ? 0.5 : 0.7))), fontWeight: 700, letterSpacing: -0.2, whiteSpace: 'nowrap',
        }}>{latin ? mark.text.toUpperCase() : mark.text}</span>
      );
      break;
    }
  }

  return (
    <span style={{ width: sz, height: sz, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color, lineHeight: 1 }}>
      {body}
    </span>
  );
}
