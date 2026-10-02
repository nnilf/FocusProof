import type { Classification } from '@shared/types';
import { CLASSIFICATIONS } from '@shared/types';
import { CLASS_COLOR_VAR, CLASS_LABEL, formatDuration, formatPct } from '../lib/format';

/** Proportional stacked bar + labelled values for productive/neutral/distracted/away time. */
export function ClassBreakdown(props: { values: Record<Classification, number> }) {
  const total = CLASSIFICATIONS.reduce((n, c) => n + props.values[c], 0);
  if (total <= 0) return <p className="muted small">No monitored time yet.</p>;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="stacked-bar" role="img" aria-label="Time by classification">
        {CLASSIFICATIONS.filter((c) => props.values[c] > 0).map((c) => (
          <div
            key={c}
            title={`${CLASS_LABEL[c]}: ${formatDuration(props.values[c])}`}
            style={{ width: `${(props.values[c] / total) * 100}%`, background: CLASS_COLOR_VAR[c] }}
          />
        ))}
      </div>
      <div className="grid cols-4" style={{ gap: 8 }}>
        {CLASSIFICATIONS.map((c) => (
          <div key={c} style={{ display: 'grid', gap: 2 }}>
            <span className="small secondary row" style={{ gap: 6 }}>
              <i style={{ width: 8, height: 8, borderRadius: 2, background: CLASS_COLOR_VAR[c], display: 'inline-block' }} />
              {CLASS_LABEL[c]}
            </span>
            <span className="num" style={{ fontWeight: 600 }}>
              {formatDuration(props.values[c])}
            </span>
            <span className="small muted num">{formatPct(props.values[c] / total)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
