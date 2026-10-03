import { useEffect, type ReactNode } from 'react';
import type { Classification } from '@shared/types';
import { CLASS_COLOR_VAR, CLASS_LABEL } from '../lib/format';

export const ALT_DEFINITION =
  'Actual Learning Time: productive time plus a share of neutral time. Distracted and away time are not counted.';

export function Toggle(props: {
  label: string;
  description?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="toggle">
      <div>
        <div className="t-label">{props.label}</div>
        {props.description && <div className="t-desc">{props.description}</div>}
      </div>
      <span className="switch">
        <input
          type="checkbox"
          role="switch"
          checked={props.checked}
          disabled={props.disabled}
          onChange={(e) => props.onChange(e.target.checked)}
        />
        <span className="track" />
      </span>
    </label>
  );
}

/** `group` renders a div instead of a label, for fields holding buttons (a label forwards clicks to its first button). */
export function Field(props: { label: string; help?: ReactNode; group?: boolean; children: ReactNode }) {
  const body = (
    <>
      <span>{props.label}</span>
      {props.children}
      {props.help && <span className="help">{props.help}</span>}
    </>
  );
  return props.group ? (
    <div className="field" role="group" aria-label={props.label}>
      {body}
    </div>
  ) : (
    <label className="field">{body}</label>
  );
}

export function ProgressBar(props: { value: number | null; color?: string; label?: string }) {
  const v = Math.max(0, Math.min(1, props.value ?? 0));
  return (
    <div
      className="progress"
      role="progressbar"
      aria-label={props.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
    >
      <div style={{ width: `${v * 100}%`, background: props.color }} />
    </div>
  );
}

export function ClassChip(props: { classification: Classification | null }) {
  if (!props.classification) return <span className="chip">Analysing…</span>;
  return (
    <span className="chip">
      <span className="dot" style={{ background: CLASS_COLOR_VAR[props.classification] }} />
      {CLASS_LABEL[props.classification]}
    </span>
  );
}

export function Modal(props: { onClose: () => void; wide?: boolean; children: ReactNode; label: string }) {
  const { onClose } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${props.wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={props.label}>
        {props.children}
      </div>
    </div>
  );
}

export function ErrorText(props: { error: string | null }) {
  return props.error ? <p className="error-text">{props.error}</p> : null;
}

export function Loading() {
  return <p className="muted">Loading…</p>;
}
