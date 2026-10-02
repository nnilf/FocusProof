import type { OverlayCorner, OverlaySettings } from '@shared/types';
import { call } from '../lib/api';
import { useApi } from '../hooks/useApi';
import { Field, Toggle } from './ui';

const CORNERS: { value: OverlayCorner; label: string }[] = [
  { value: 'top-left', label: 'Top left' },
  { value: 'top-right', label: 'Top right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-right', label: 'Bottom right' },
];

const DETAILS: { key: keyof OverlaySettings['details']; label: string }[] = [
  { key: 'label', label: 'Status text' },
  { key: 'focusScore', label: 'Focus score' },
  { key: 'alt', label: 'Learning time' },
  { key: 'camera', label: 'Camera icon' },
];

export function FocusIndicatorSettings(props: { value: OverlaySettings; onChange: (v: OverlaySettings) => void }) {
  const v = props.value;
  const displays = useApi(() => call('displays:list', {}), []);
  const set = (patch: Partial<OverlaySettings>): void => props.onChange({ ...v, ...patch });

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Toggle label="Show during sessions" checked={v.enabled} onChange={(enabled) => set({ enabled })} />
      <div className="grid cols-3" style={{ gap: 10 }}>
        <Field label="Corner">
          <select className="select" value={v.corner} onChange={(e) => set({ corner: e.target.value as OverlayCorner })}>
            {CORNERS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Display">
          <select
            className="select"
            value={v.displayId ?? ''}
            onChange={(e) => set({ displayId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">Main display</option>
            {displays.data
              ?.filter((d) => !d.primary)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Size">
          <select className="select" value={v.size} onChange={(e) => set({ size: e.target.value as OverlaySettings['size'] })}>
            <option value="small">Small</option>
            <option value="medium">Medium</option>
          </select>
        </Field>
      </div>
      <Field label="Extra details">
        <div className="row" style={{ gap: 16 }}>
          {DETAILS.map((d) => (
            <label key={d.key} className="row small secondary" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={v.details[d.key]}
                onChange={(e) => set({ details: { ...v.details, [d.key]: e.target.checked } })}
              />
              {d.label}
            </label>
          ))}
        </div>
      </Field>
    </div>
  );
}
