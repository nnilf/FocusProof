import { useNavigate } from 'react-router-dom';
import type { DaySession } from '@shared/types';
import { CLASS_COLOR_VAR, CLASS_LABEL, formatDuration, formatTime } from '../lib/format';

const HOUR = 3_600_000;

/** Today as one strip: each session drawn at its real clock time, coloured by classification. */
export function DayRibbon(props: { sessions: DaySession[]; now: number }) {
  const navigate = useNavigate();
  const midnight = new Date(props.now).setHours(0, 0, 0, 0);
  const starts = props.sessions.flatMap((s) => s.blocks.map((b) => b.startTs));
  const ends = props.sessions.flatMap((s) => s.blocks.map((b) => b.endTs));
  // 07:00–23:00 by default, widened to whole hours around anything outside it.
  const from = Math.min(midnight + 7 * HOUR, ...starts.map((t) => Math.floor((t - midnight) / HOUR) * HOUR + midnight));
  const to = Math.max(midnight + 23 * HOUR, ...ends.map((t) => Math.ceil((t - midnight) / HOUR) * HOUR + midnight));
  const pct = (t: number): number => ((Math.min(Math.max(t, from), to) - from) / (to - from)) * 100;
  const hours = Math.round((to - from) / HOUR);
  const step = hours > 18 ? 3 : 2;
  const ticks = Array.from({ length: Math.floor(hours / step) + 1 }, (_, i) => from + i * step * HOUR);

  return (
    <div>
      <div className="ribbon" role="list" aria-label="Today's sessions">
        {props.sessions.map((s) => {
          const first = s.blocks[0];
          const last = s.blocks[s.blocks.length - 1];
          if (!first || !last) return null;
          const span = last.endTs - first.startTs;
          return (
            <button
              key={s.sessionId}
              role="listitem"
              className="ribbon-session"
              style={{ left: `${pct(first.startTs)}%`, width: `max(3px, ${pct(last.endTs) - pct(first.startTs)}%)` }}
              title={`${s.assignmentName ?? 'No assignment'}, ${formatTime(first.startTs)}–${formatTime(last.endTs)}`}
              aria-label={`${s.assignmentName ?? 'No assignment'}, ${formatTime(first.startTs)} to ${formatTime(last.endTs)}. Open report`}
              onClick={() => navigate(`/report/${s.sessionId}`)}
            >
              {s.blocks.map((b, i) => (
                <i
                  key={i}
                  title={`${CLASS_LABEL[b.classification]}, ${formatDuration(b.endTs - b.startTs)}`}
                  style={{ width: `${span > 0 ? ((b.endTs - b.startTs) / span) * 100 : 100}%`, background: CLASS_COLOR_VAR[b.classification] }}
                />
              ))}
            </button>
          );
        })}
        {props.now > from && props.now < to && <span className="ribbon-now" style={{ left: `${pct(props.now)}%` }} aria-hidden />}
      </div>
      <div className="ribbon-axis" aria-hidden>
        {ticks.map((t) => (
          <span key={t} style={{ left: `${pct(t)}%` }}>
            {new Date(t).getHours().toString().padStart(2, '0')}
          </span>
        ))}
      </div>
    </div>
  );
}
