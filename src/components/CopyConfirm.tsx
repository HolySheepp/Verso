import { fz } from '../model/fonts';
interface Props {
  untranslated: number;
  pending: number;
  onCancel(): void;
  onConfirm(): void;
}

/** 複製譯文欄前，還有未翻譯或待確認的條目時先確認 */
export function CopyConfirm({ untranslated, pending, onCancel, onConfirm }: Props) {
  const parts = [untranslated ? `未翻譯 ${untranslated} 條` : '', pending ? `待確認 ${pending} 條` : ''].filter(Boolean);
  return (
    <div className="scrim" style={{ zIndex: 45 }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="verso-copy-title" className="dialog"
        style={{ width: 380, boxShadow: '0 24px 64px rgba(0,0,0,0.45)' }}>
        <div style={{ padding: '20px 20px 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 id="verso-copy-title" style={{ margin: 0, fontSize: fz(15), fontWeight: 600 }}>還有條目沒完成</h2>
          <div style={{ fontSize: fz(13), color: 'var(--text2)' }}>{parts.join('、')}</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 20px 16px' }}>
          <button type="button" className="btn btn-ghost" onClick={onCancel}
            style={{ height: 36, padding: '0 16px', background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, fontSize: fz(13) }}>取消</button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} autoFocus
            style={{ height: 36, padding: '0 18px', background: 'var(--primary)', border: 0, borderRadius: 8, color: '#ffffff', fontSize: fz(13), fontWeight: 600 }}>仍要複製</button>
        </div>
      </div>
    </div>
  );
}
