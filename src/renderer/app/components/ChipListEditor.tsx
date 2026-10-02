import { useState } from 'react';
import { X } from 'lucide-react';

export function ChipListEditor(props: { values: string[]; onChange: (values: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState('');
  const add = (): void => {
    const v = draft.trim();
    if (v && !props.values.some((x) => x.toLowerCase() === v.toLowerCase())) props.onChange([...props.values, v]);
    setDraft('');
  };
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div className="chip-list">
        {props.values.map((v) => (
          <span className="chip" key={v}>
            {v}
            <button aria-label={`Remove ${v}`} onClick={() => props.onChange(props.values.filter((x) => x !== v))}>
              <X size={12} />
            </button>
          </span>
        ))}
        {props.values.length === 0 && <span className="muted small">None</span>}
      </div>
      <div className="row">
        <input
          className="input"
          style={{ flex: 1 }}
          value={draft}
          placeholder={props.placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button className="btn" onClick={add} disabled={!draft.trim()}>
          Add
        </button>
      </div>
    </div>
  );
}
