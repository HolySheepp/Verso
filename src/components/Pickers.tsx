import { tx } from '../i18n';
import { useStore } from '../state/store';
import { Select } from './Select';
import { DICT_DIR, sameName } from '../model/names';

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
  return <Picker {...p} options={projects} newLabel={tx('picker.001')} placeholder={tx('picker.002')} />;
}

/** 字典下拉：只列出該專案的字典＋新字典 */
export function DictPicker(p: PickerProps & { project: string }) {
  const dicts = useStore((s) => s.project!.dicts);
  const options = dicts.filter((d) => d.project === p.project).map((d) => d.name);
  return <Picker {...p} options={options} newLabel={tx('picker.003')} placeholder={tx('picker.004')} />;
}

/** 某專案的第一個字典，沒有就是「新字典」 */
export function firstDict(project: string) {
  const d = useStore.getState().project!.dicts.find((x) => x.project === project);
  return d ? d.name : NEW;
}

/** 新專案、新字典名稱的檢查訊息；沒問題回傳空字串 */
export function nameError(kind: 'project' | 'dict' | 'file', sel: string, newName: string, existing: string[]) {
  if (sel !== NEW) return '';
  const label = kind === 'project' ? tx('picker.005') : kind === 'dict' ? tx('picker.006') : tx('picker.007');
  const n = newName.trim();
  if (!n) return '';
  if (/[\\/:*?"<>|]/.test(n)) return tx('picker.008', { label });
  // 「.」開頭的資料夾是軟體自己用的（例如暫存復原）；Windows 不允許結尾是「.」，也不能用保留名稱
  if (n.startsWith('.')) return tx('picker.009', { label });
  if (n.endsWith('.')) return tx('picker.010', { label });
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(n)) return tx('picker.011', { n });
  // 專案資料夾和字典資料夾放在一起，不能同名
  if (kind === 'project' && sameName(n, DICT_DIR)) return tx('picker.012', { DICT_DIR });
  // 大小寫不同、或存檔後會變成同一個檔名的，都算同名
  if (existing.some((x) => sameName(x, n))) return tx('picker.013', { label });
  return '';
}
