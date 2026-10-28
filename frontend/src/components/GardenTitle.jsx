import { useState } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { UiIcon } from './UiIcon';
import { MAX_GARDEN_NAME_LENGTH as MAX_NAME_LENGTH } from '../domain/limits';
export function GardenTitle({ name, disabled }) {
    const [draft, setDraft] = useState(null);
    const [error, setError] = useState('');
    function commit() {
        if (draft === null)
            return;
        // 上限変更前に保存された長い名前は、変更しない限りそのまま残します。
        if (draft.trim() === name) {
            cancel();
            return;
        }
        if (!draft.trim() || draft.trim().length > MAX_NAME_LENGTH) {
            setError(`庭の名前は1〜${MAX_NAME_LENGTH}文字で入力してください。`);
            return;
        }
        if (!useEditorStore.getState().renameGarden(draft)) {
            setError('操作を完了してから庭の名前を変更してください。');
            return;
        }
        setDraft(null);
        setError('');
    }
    function cancel() {
        setDraft(null);
        setError('');
    }
    if (draft === null) {
        return <div className="document-title">
      <h1 title={name}>{name}</h1>
      <button type="button" className="icon-button rename-button" aria-label="庭の名前を変更" title="庭の名前を変更" disabled={disabled} onClick={() => setDraft(name)}><UiIcon name="edit" size={14}/></button>
    </div>;
    }
    return <form className="document-title document-rename" onSubmit={(event) => { event.preventDefault(); commit(); }}>
    <input data-dialog-autofocus autoFocus aria-label="庭の名前" value={draft} maxLength={MAX_NAME_LENGTH} aria-invalid={error ? true : undefined}
      onChange={(event) => { setDraft(event.target.value); setError(''); }}
      onKeyDown={(event) => { if (event.key === 'Escape') cancel(); }}/>
    <button type="submit" className="icon-button" aria-label="名前を確定" title="名前を確定" disabled={disabled}><UiIcon name="check" size={14}/></button>
    <button type="button" className="icon-button" aria-label="名前の変更を取り消す" title="取り消す" onClick={cancel}><UiIcon name="close" size={14}/></button>
    {error && <span className="notice notice-error rename-error" role="alert">{error}</span>}
  </form>;
}
