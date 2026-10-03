import { useEffect, useState } from 'react';
import type { CheckUpdate } from '@shared/ipc/check';
import type { AppCategory, SignalFrame } from '@shared/types';
import { Reasons, SignalBreakdown } from '../app/components/IntervalInspector';
import { CLASS_COLOR_VAR, CLASS_LABEL, formatDuration, formatPct, formatScore } from '../app/lib/format';

const CATEGORY: Record<AppCategory, string> = {
  productive: 'study app',
  neutral: 'neutral',
  distracting: 'distracting',
  excluded: 'excluded',
  unknown: 'no rule',
};

/** 0–1 score with the neutral and productive thresholds marked. */
function ScoreMeter(props: { raw: number; score: number; neutral: number; productive: number }) {
  const changed = Math.abs(props.raw - props.score) > 0.001;
  return (
    <div className="meter" role="img" aria-label={`Score ${formatScore(props.score)}`}>
      <div className="meter-band" style={{ left: 0, width: `${props.neutral * 100}%`, background: 'var(--c-distracted)' }} />
      <div
        className="meter-band"
        style={{ left: `${props.neutral * 100}%`, width: `${(props.productive - props.neutral) * 100}%`, background: 'var(--c-neutral)' }}
      />
      <div className="meter-band" style={{ left: `${props.productive * 100}%`, right: 0, background: 'var(--c-productive)' }} />
      {changed && <div className="meter-mark raw" style={{ left: `${props.raw * 100}%` }} title={`Before rules ${formatScore(props.raw)}`} />}
      <div className="meter-mark" style={{ left: `${props.score * 100}%` }} />
    </div>
  );
}

/** Thin bar that fills until the next evaluation. */
function Countdown(props: { nextAt: number | null; intervalMs: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(t);
  }, []);
  if (props.nextAt === null || props.intervalMs <= 0) return <div className="countdown" />;
  const left = Math.max(0, props.nextAt - now);
  return (
    <div className="countdown" title={`Next update in ${Math.ceil(left / 1000)} s`}>
      <div style={{ width: `${(1 - left / props.intervalMs) * 100}%` }} />
    </div>
  );
}

function Observations(props: { frame: SignalFrame }) {
  const { window: win, screen, input, camera, documents } = props.frame;
  return (
    <dl className="kv small">
      <dt>Foreground</dt>
      <dd className="truncate">
        {win
          ? `${win.processName ?? 'Unknown'}${win.domain ? ` · ${win.domain}` : ''} · ${CATEGORY[win.category]}${
              win.relevance !== null ? ` ${formatScore(win.relevance)}` : ''
            }`
          : 'Off'}
      </dd>
      <dt>Screen</dt>
      <dd>{screen ? (screen.note ?? `Relevance ${formatScore(screen.relevance)}`) : 'Off'}</dd>
      <dt>Keyboard & mouse</dt>
      <dd>{input ? `${input.keyboardEvents + input.mouseEvents} events · idle ${formatDuration(input.idleMs)}` : 'Off'}</dd>
      <dt>Webcam</dt>
      <dd>
        {camera && camera.samples > 0
          ? `Present ${formatPct(camera.presence)} · focus ${formatPct(camera.focus)} · off-screen ${formatPct(camera.offScreenRatio)}${
              camera.distractionRatio > 0 ? ` · ${camera.distractionLabel ?? 'distraction'} ${formatPct(camera.distractionRatio)}` : ''
            }`
          : 'No samples'}
      </dd>
      {documents && (
        <>
          <dt>Files</dt>
          <dd>
            {documents.changeEvents} changes · +{documents.wordsAdded}/−{documents.wordsRemoved} words
          </dd>
        </>
      )}
    </dl>
  );
}

/** What the engine decided for the latest interval, and every input it weighed. */
export function DecisionPanel(props: { update: CheckUpdate | null }) {
  const u = props.update;
  const ev = u?.evaluation ?? null;
  return (
    <section className="decision">
      <div className="spread">
        <div className="verdict">
          <span className="verdict-dot" style={{ background: ev ? CLASS_COLOR_VAR[ev.classification] : 'var(--tint-2)' }} />
          {ev ? CLASS_LABEL[ev.classification] : 'Analysing…'}
        </div>
        {u && <span className="chip">{u.source === 'session' ? 'Live session' : 'Preview'}</span>}
      </div>
      {ev && u && (
        <ScoreMeter raw={ev.rawScore} score={ev.combinedScore} neutral={u.config.neutralThreshold} productive={u.config.productiveThreshold} />
      )}
      <Countdown nextAt={u?.nextAt ?? null} intervalMs={u?.intervalMs ?? 0} />

      {ev && u?.frame && (
        <>
          <div className="decision-block">
            <h3>Signals</h3>
            <SignalBreakdown interval={ev} />
          </div>
          <div className="decision-block">
            <h3>Observed</h3>
            <Observations frame={u.frame} />
          </div>
          <div className="decision-block">
            <h3>Why</h3>
            <Reasons reasons={ev.reasons} />
          </div>
        </>
      )}
    </section>
  );
}
