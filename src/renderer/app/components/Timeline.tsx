import type { TimelineBlock } from '@shared/types';
import { CLASS_COLOR_VAR, CLASS_LABEL, formatDuration, formatTime } from '../lib/format';

export function TimelineBar(props: {
  blocks: TimelineBlock[];
  selected: number | null;
  onSelect: (index: number) => void;
}) {
  const { blocks } = props;
  if (blocks.length === 0) return <p className="muted small">No intervals recorded.</p>;
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  return (
    <div>
      <div className="timeline" role="list" aria-label="Session timeline">
        {blocks.map((b, i) => (
          <button
            key={`${b.startTs}-${i}`}
            role="listitem"
            className={`timeline-block ${props.selected === i ? 'selected' : ''}`}
            style={{ flexGrow: Math.max(1, b.endTs - b.startTs), background: CLASS_COLOR_VAR[b.classification] }}
            title={`${formatTime(b.startTs)}–${formatTime(b.endTs)} ${CLASS_LABEL[b.classification]} (${formatDuration(b.endTs - b.startTs)})`}
            aria-label={`${formatTime(b.startTs)} to ${formatTime(b.endTs)}, ${CLASS_LABEL[b.classification]}`}
            onClick={() => props.onSelect(i)}
          />
        ))}
      </div>
      {first && last && (
        <div className="timeline-axis">
          <span>{formatTime(first.startTs)}</span>
          <span>{formatTime(last.endTs)}</span>
        </div>
      )}
    </div>
  );
}

export function TimelineList(props: { blocks: TimelineBlock[]; selected: number | null; onSelect: (i: number) => void }) {
  return (
    <div className="block-list">
      {props.blocks.map((b, i) => (
        <button
          key={`${b.startTs}-${i}`}
          className={`block-item ${props.selected === i ? 'selected' : ''}`}
          onClick={() => props.onSelect(i)}
        >
          <span className="num secondary">
            {formatTime(b.startTs)}–{formatTime(b.endTs)}
          </span>
          <span className="row" style={{ gap: 6 }}>
            <i style={{ width: 8, height: 8, borderRadius: 2, background: CLASS_COLOR_VAR[b.classification], display: 'inline-block' }} />
            {CLASS_LABEL[b.classification]}
          </span>
          <span />
          <span className="num muted">{formatDuration(b.endTs - b.startTs)}</span>
        </button>
      ))}
    </div>
  );
}
