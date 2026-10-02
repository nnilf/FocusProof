import { useMemo, useState } from 'react';
import type { ActivityInterval, ClassificationReason, TimelineBlock, WeightKey } from '@shared/types';
import { CLASS_LABEL, formatDuration, formatPct, formatScore, formatTime } from '../lib/format';
import { ClassChip } from './ui';

const WEIGHT_LABEL: Record<WeightKey, string> = {
  relevance: 'App / screen relevance',
  input: 'Keyboard & mouse',
  document: 'Document activity',
  camera: 'Webcam presence × focus',
  context: 'Sustained activity',
};

const MARK: Record<ClassificationReason['kind'], string> = { positive: '+', negative: '−', neutral: '·', override: '!' };

function mean(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function Reasons(props: { reasons: ClassificationReason[] }) {
  if (props.reasons.length === 0) return <p className="muted small">No specific reasons recorded.</p>;
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {props.reasons.map((r, i) => (
        <div key={`${r.code}-${i}`} className={`reason ${r.kind}`}>
          <span className="mark" aria-hidden>
            {MARK[r.kind]}
          </span>
          <span>{r.text}</span>
        </div>
      ))}
    </div>
  );
}

/** Shows how each signal contributed to an interval's score: the "why" behind a classification. */
export function SignalBreakdown(props: { interval: ActivityInterval }) {
  const i = props.interval;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {i.contributions.map((c) => (
        <div className="signal-bar" key={c.key} title={`Configured weight ${formatPct(c.configuredWeight)}`}>
          <span className="secondary">{WEIGHT_LABEL[c.key]}</span>
          <div className="track">
            <div className="fill" style={{ width: `${(c.value ?? 0) * 100}%`, opacity: c.value === null ? 0 : 1 }} />
          </div>
          <span className="num muted">
            {c.value === null ? 'unavailable' : `${formatScore(c.value)} × ${formatPct(c.effectiveWeight)}`}
          </span>
        </div>
      ))}
      <div className="small muted">
        Weighted score {formatScore(i.rawScore)}
        {Math.abs(i.rawScore - i.combinedScore) > 0.001 && ` → ${formatScore(i.combinedScore)} after rules`} ⇒{' '}
        {CLASS_LABEL[i.classification]}
      </div>
    </div>
  );
}

export function IntervalInspector(props: { block: TimelineBlock; intervals: ActivityInterval[] }) {
  const { block } = props;
  const items = useMemo(
    () => props.intervals.filter((i) => block.intervalIds.includes(i.id)),
    [props.intervals, block],
  );
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = items.find((i) => i.id === selectedId) ?? items[0] ?? null;

  const apps = new Map<string, number>();
  for (const i of items) {
    const key = i.processName ?? 'Unknown';
    apps.set(key, (apps.get(key) ?? 0) + (i.endTs - i.startTs));
  }
  const topApps = [...apps.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const reasonCounts = new Map<string, { reason: ClassificationReason; n: number }>();
  for (const i of items)
    for (const r of i.reasons) {
      const e = reasonCounts.get(r.code) ?? { reason: r, n: 0 };
      e.n++;
      reasonCounts.set(r.code, e);
    }
  const topReasons = [...reasonCounts.values()].sort((a, b) => b.n - a.n).slice(0, 6);

  return (
    <div className="grid cols-2" style={{ alignItems: 'start' }}>
      <div style={{ display: 'grid', gap: 14 }}>
        <div className="spread">
          <ClassChip classification={block.classification} />
          <span className="num secondary">
            {formatTime(block.startTs)}–{formatTime(block.endTs)} · {formatDuration(block.endTs - block.startTs)}
          </span>
        </div>
        <dl className="kv">
          <dt>Active application</dt>
          <dd>{topApps.map(([app, ms]) => `${app} (${formatDuration(ms)})`).join(', ') || '—'}</dd>
          <dt>Activity level</dt>
          <dd>
            {formatScore(mean(items.map((i) => i.signals.inputActivityScore)))} ·{' '}
            {items.reduce((n, i) => n + i.keyboardEvents + i.mouseEvents, 0)} input samples
          </dd>
          <dt>Document activity</dt>
          <dd>
            {items.reduce((n, i) => n + i.docChangeEvents, 0)} changes · +{items.reduce((n, i) => n + i.wordsAdded, 0)} / −
            {items.reduce((n, i) => n + i.wordsRemoved, 0)} words
          </dd>
          <dt>Focus score</dt>
          <dd>{formatScore(mean(items.map((i) => i.signals.focusScore)))}</dd>
          <dt>Average score</dt>
          <dd>{formatScore(mean(items.map((i) => i.combinedScore)))}</dd>
        </dl>
        <div style={{ display: 'grid', gap: 6 }}>
          <h3>Why this was classified as {CLASS_LABEL[block.classification].toLowerCase()}</h3>
          <Reasons reasons={topReasons.map((r) => ({ ...r.reason, text: r.n > 1 ? `${r.reason.text} (${r.n}×)` : r.reason.text }))} />
        </div>
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        <div className="spread">
          <h3>Interval detail</h3>
          <select
            className="select"
            style={{ width: 'auto' }}
            value={selected?.id ?? ''}
            onChange={(e) => setSelectedId(Number(e.target.value))}
            aria-label="Choose interval"
          >
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {formatTime(i.startTs)} · {formatDuration(i.endTs - i.startTs)} · {CLASS_LABEL[i.classification]}
              </option>
            ))}
          </select>
        </div>
        {selected && (
          <>
            {selected.windowTitle && <p className="small secondary truncate" title={selected.windowTitle}>{selected.windowTitle}</p>}
            <SignalBreakdown interval={selected} />
            <Reasons reasons={selected.reasons} />
          </>
        )}
      </div>
    </div>
  );
}
