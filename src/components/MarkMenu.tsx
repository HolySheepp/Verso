import { useStore } from '../state/store';
import { BUILTIN_MARKS, markVisual } from '../model/marks';
import type { CustomMark, MarkId } from '../model/types';
import { MarkIcon } from './MarkIcon';
import { IconCheck, IconPlus } from './icons';
import { fz } from '../model/fonts';

interface Props {
  title: string;
  ariaLabel: string;
  current: MarkId;
  exclude?: MarkId[];
  onPick(id: MarkId): void;
  style: React.CSSProperties;
  /** 用快捷鍵打開時，每項前面顯示數字，按數字就能選 */
  numbered?: boolean;
  /** 用上下鍵移動到的那一項（按 Enter 會選它） */
  active?: number;
}

/** 選單裡各標記的順序（按數字選取時用同一個順序） */
export function markMenuIds(customs: CustomMark[], exclude: MarkId[] = []): MarkId[] {
  return [
    ...BUILTIN_MARKS.filter((b) => !exclude.includes(b.id)).map((b) => b.id as MarkId),
    ...customs.map((c) => `c:${c.id}` as MarkId),
  ];
}

/** 標記選單：條目的「變更標記」和「標記並下一條」共用 */
export function MarkMenu({ title, ariaLabel, current, exclude = [], onPick, style, numbered = false, active }: Props) {
  const customs = useStore((s) => s.project!.customMarks);
  const set = useStore((s) => s.set);

  const order = markMenuIds(customs, exclude);
  const item = (id: MarkId, label: string) => {
    const on = current === id;
    const n = order.indexOf(id) + 1;
    return (
      <button key={id} type="button" className="dd pop-item" role="menuitemradio" aria-checked={on} onClick={() => onPick(id)}
        style={{
          background: n - 1 === active ? 'var(--hv3)' : on ? 'var(--sel)' : 'transparent',
          boxShadow: n - 1 === active ? 'inset 0 0 0 1px var(--accent)' : undefined,
        }}>
        <span style={{ width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <MarkIcon mark={markVisual(customs, id)} size={16} menu />
        </span>
        <span style={{ flexGrow: 1 }}>{label}</span>
        {numbered && n <= 9 && <span className="mono" style={{ fontSize: fz(11), color: 'var(--mute)' }}>{n}</span>}
        {on && <IconCheck size={13} sw={2.6} stroke="var(--accent2)" />}
      </button>
    );
  };

  return (
    <div role="menu" aria-label={ariaLabel} className="pop" style={{ width: 224, zIndex: 30, ...style }}>
      <div className="pop-title">{title}</div>
      {BUILTIN_MARKS.filter((b) => !exclude.includes(b.id)).map((b) => item(b.id, b.label))}
      {customs.length > 0 && <div className="pop-sep" />}
      {customs.map((c) => item(`c:${c.id}`, c.name))}
      <div className="pop-sep" />
      <button type="button" className="dd pop-item" style={{ background: 'transparent', color: 'var(--text2)', fontSize: fz(12.5) }}
        onClick={() => set({ settingsOpen: true, rowMenu: null, stampOpen: false, fileMenuOpen: false })}>
        <IconPlus size={14} />管理自訂標記…
      </button>
    </div>
  );
}
