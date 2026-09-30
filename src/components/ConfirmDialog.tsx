interface Choice {
  label: string;
  onClick(): void;
  primary?: boolean;
  danger?: boolean;
}

interface Props {
  title: string;
  body?: string;
  choices: Choice[];
  zIndex?: number;
}

/** 需要使用者選擇的小對話框（例如有未存的修改時） */
export function ConfirmDialog({ title, body, choices, zIndex = 50 }: Props) {
  return (
    <div className="scrim" style={{ zIndex }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="verso-confirm-title" className="dialog"
        style={{ width: 400, boxShadow: '0 24px 64px rgba(0,0,0,0.45)' }}>
        <div style={{ padding: '20px 20px 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 id="verso-confirm-title" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{title}</h2>
          {body && <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>{body}</div>}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 20px 16px' }}>
          {choices.map((c) => (
            <button key={c.label} type="button" className={'btn ' + (c.primary ? 'btn-primary' : 'btn-ghost')} onClick={c.onClick} autoFocus={c.primary}
              style={c.primary
                ? { height: 36, padding: '0 18px', background: '#2f6fe4', border: 0, borderRadius: 8, color: '#ffffff', fontSize: 13, fontWeight: 600 }
                : { height: 36, padding: '0 16px', background: 'var(--btn)', border: '1px solid var(--line4)', borderRadius: 8, fontSize: 13, color: c.danger ? 'var(--errtx)' : undefined }}>
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
