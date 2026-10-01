import { useStore } from '../state/store';
import { Select } from './Select';

/** 下拉選單裡「新增」那一項的值 */
export const NEW = '__new__';

/** 下拉選了「新增」就用輸入的名稱 */
export const picked = (sel: string, newName: string) => (sel === NEW ? newName.trim() : sel);

interface PickerProps {
  id: string;
  sel: string;
  newName: string;
  onSel: (v: string) => void;
  onNewName: (v: string) => void;
  /** 輸入框放在下拉右邊（預設）或下面 */
  stack?: boolean;
  width?: number;
  /** 選了新增時輸入框自動取得焦點 */
  focus?: boolean;
}

function Picker({ id, sel, newName, onSel, onNewName, stack, width, focus = true, options, newLabel, placeholder }:
  PickerProps & { options: string[]; newLabel: string; placeholder: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: stack ? 'column' : 'row', gap: stack ? 6 : 8, minWidth: 0, flexGrow: stack ? 0 : 1 }}>
      <Select id={id} value={sel} onChange={onSel} options={[...options.map((v) => ({ value: v, label: v })), { value: NEW, label: newLabel }]}
        style={{ width: stack ? '100%' : width ?? 160, flexShrink: 0 }} />
      {sel === NEW && (
        <input type="text" className="field" aria-label={placeholder} value={newName} onChange={(e) => onNewName(e.target.value)}
          placeholder={placeholder} autoFocus={focus} style={{ flexGrow: 1, minWidth: 0 }} />
      )}
    </div>
  );
}

/** 專案下拉：現有專案＋新增專案 */
export function ProjectPicker(p: PickerProps) {
  const projects = useStore((s) => s.project!.projects);
  return <Picker {...p} options={projects} newLabel="新增專案" placeholder="專案名稱" />;
}

/** 字典下拉：只列出該專案的字典＋新字典 */
export function DictPicker(p: PickerProps & { project: string }) {
  const dicts = useStore((s) => s.project!.dicts);
  const options = dicts.filter((d) => d.project === p.project).map((d) => d.name);
  return <Picker {...p} options={options} newLabel="新字典" placeholder="字典名稱" />;
}

/** 某專案的第一個字典，沒有就是「新字典」 */
export function firstDict(project: string) {
  const d = useStore.getState().project!.dicts.find((x) => x.project === project);
  return d ? d.name : NEW;
}

/** 新專案、新字典名稱的檢查訊息；沒問題回傳空字串 */
export function nameError(kind: '專案' | '字典', sel: string, newName: string, existing: string[]) {
  if (sel !== NEW) return '';
  const n = newName.trim();
  if (!n) return '';
  if (/[\\/:*?"<>|]/.test(n)) return kind + '名稱不能有 \\ / : * ? " < > |';
  if (existing.includes(n)) return '已有同名' + kind;
  return '';
}
