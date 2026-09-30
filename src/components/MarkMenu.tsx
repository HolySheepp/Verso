import { useStore } from '../state/store';
import { BUILTIN_MARKS, markVisual } from '../model/marks';
import type { MarkId } from '../model/types';
import { MarkIcon } from './MarkIcon';
import { IconCheck, IconPlus } from './icons';

interface Props {
  title: string;
  ariaLabel: string;
  current: MarkId;
  exclude?: MarkId[];
  onPick(id: MarkId): void;
  style: React.CSSProperties;
}

/** 標記選單：條目的「變更標記」和「標記並下一條」共用 */
export function MarkMenu({ title, ariaLabel, current, exclude = [], onPick, style }: Props) {
  const customs = useStore((s) => s.project!.customMarks);
  const set = useStore((s) => s.set);

  const item = (id: MarkId, label: string) => {
    const on = current === id;
    return (
      <button key={id} type="button" className="dd pop-item" role="menuitemradio" aria-checked={on} onClick={() => onPick(id)}
        style={{ background: on ? 'var(--sel)' : 'transparent' }}>
        <span style={{ width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <MarkIcon mark={markVisual(customs, id)} size={16} menu />
        </span>
        <span style={{ flexGrow: 1 }}>{label}</span>
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
      <button type="button" className="dd pop-item" style={{ background: 'transparent', color: 'var(--text2)', fontSize: 12.5 }}
        onClick={() => set({ settingsOpen: true, rowMenu: null, stampOpen: false, fileMenuOpen: false })}>
        <IconPlus size={14} />管理自訂標記…
      </button>
    </div>
  );
}
