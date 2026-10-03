import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { MonitoringToggles, OffScreenPolicy, Settings, SettingsPatch, WeightKey } from '@shared/types';
import { WEIGHT_KEYS } from '@shared/types';
import { normaliseDomain } from '@shared/domains';
import { call } from '../lib/api';
import { useApi } from '../hooks/useApi';
import { ErrorText, Field, Loading, Toggle } from '../components/ui';
import { ChipListEditor } from '../components/ChipListEditor';
import { CameraCalibration } from '../components/CameraCalibration';
import { FocusIndicatorSettings } from '../components/FocusIndicatorSettings';
import { formatPct } from '../lib/format';

interface Source {
  key: keyof MonitoringToggles;
  label: string;
  reads: string;
  stores: string;
  never: string;
}

const SOURCES: Source[] = [
  {
    key: 'activeWindow',
    label: 'Active window',
    reads: "The app in front and its window title, once a second. For browsers, the website's domain from the address bar.",
    stores: 'The main app, website domain and a shortened window title for each interval.',
    never: 'Window contents, or any web address beyond the domain.',
  },
  {
    key: 'inputActivity',
    label: 'Keyboard and mouse',
    reads: 'Whether you typed or moved the mouse, five times a second.',
    stores: 'How much input there was, and idle time.',
    never: 'Which keys you pressed, what you typed or where you clicked.',
  },
  {
    key: 'screenAnalysis',
    label: 'Screen changes',
    reads: 'A 160×90 thumbnail of your main screen each interval, kept in memory.',
    stores: 'A single number for how much the screen changed.',
    never: 'Screenshots. Nothing is written to disk or uploaded.',
  },
  {
    key: 'documents',
    label: 'Watched files',
    reads: 'Only the files you choose, when they change, to count words and lines.',
    stores: 'File path, size, and word and line counts.',
    never: 'The contents of your files.',
  },
  {
    key: 'webcam',
    label: 'Webcam',
    reads: 'Video, processed in memory by a local face-landmark model about twice a second.',
    stores: 'Whether you were present and a focus score from head direction.',
    never: 'Video or images, and no face recognition.',
  },
];

const WEIGHT_LABEL: Record<WeightKey, string> = {
  relevance: 'App and website relevance',
  input: 'Keyboard and mouse',
  document: 'File activity',
  camera: 'Webcam',
  context: 'Sustained activity',
};

const minutes = (v: number): string => `${Math.round(v / 6) / 10} min`;

function Slider(props: { label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <Field label={props.label}>
      <div className="slider-row">
        <input type="range" aria-label={props.label} min={props.min} max={props.max} step={props.step} value={props.value} onChange={(e) => props.onChange(Number(e.target.value))} />
        <span className="num secondary" style={{ textAlign: 'right' }}>
          {props.format(props.value)}
        </span>
      </div>
    </Field>
  );
}

function validate(s: Settings): string | null {
  if (s.engine.neutralThreshold >= s.engine.productiveThreshold) return 'The neutral threshold must be lower than the productive threshold.';
  if (s.engine.awayThresholdSec < s.engine.inactivityThresholdSec) return 'The away threshold must be at least the inactivity threshold.';
  return null;
}

export function SettingsPage() {
  const location = useLocation();
  const remote = useApi(() => call('settings:get', {}), []);
  const demo = useApi(() => call('demo:status', {}), []);
  const info = useApi(() => call('app:info', {}), []);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<Settings | null>(null);

  // Take the stored settings once; after that the draft is the source of truth and saves itself.
  useEffect(() => {
    if (remote.data && !draft) setDraft(remote.data);
  }, [remote.data, draft]);

  useEffect(() => {
    if (!draft || !location.hash) return;
    document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }, [draft, location.hash]);

  const flush = (): void => {
    const next = pending.current;
    pending.current = null;
    window.clearTimeout(timer.current);
    if (!next) return;
    const { zones: _zones, ...camera } = next.camera;
    const patch: SettingsPatch = { ...next, camera };
    call('settings:update', patch)
      .then(() => setSaved(true))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;
  // Don't lose a change made just before leaving the page.
  useEffect(() => () => flushRef.current(), []);

  if (!draft) return <div className="page">{remote.loading ? <Loading /> : <ErrorText error={remote.error} />}</div>;

  const update = (next: Settings): void => {
    setDraft(next);
    setSaved(false);
    const problem = validate(next);
    setError(problem);
    window.clearTimeout(timer.current);
    pending.current = problem ? null : next;
    if (!problem) timer.current = window.setTimeout(flush, 400);
  };

  const e = draft.engine;
  const totalWeight = WEIGHT_KEYS.reduce((n, k) => n + e.weights[k], 0);
  const setEngine = (patch: Partial<Settings['engine']>): void => update({ ...draft, engine: { ...e, ...patch } });
  const setApps = (patch: Partial<Settings['apps']>): void => update({ ...draft, apps: { ...draft.apps, ...patch } });
  const setMonitoring = (key: keyof MonitoringToggles, v: boolean): void => update({ ...draft, monitoring: { ...draft.monitoring, [key]: v } });

  const reset = async (): Promise<void> => {
    if (!window.confirm('Reset all settings to their defaults? Your assignments and sessions are kept.')) return;
    setDraft(await call('settings:reset', {}));
    setError(null);
  };

  const demoAction = async (action: 'demo:seed' | 'demo:clear'): Promise<void> => {
    if (action === 'demo:clear' && !window.confirm('Remove all demo assignments and sessions? Your own data is not affected.')) return;
    await call(action, {});
    demo.reload();
  };

  const deleteAll = async (): Promise<void> => {
    if (!window.confirm('Permanently delete all assignments, sessions and analytics? Settings are kept.')) return;
    await call('privacy:deleteAll', {});
  };

  return (
    <div className="page">
      <div className="section-head">
        <h1>Settings</h1>
        <span className="small muted" aria-live="polite">
          {saved ? 'Saved' : ''}
        </span>
      </div>
      <ErrorText error={error} />

      <section className="settings-section">
        <div style={{ display: 'grid', gap: 4 }}>
          <h2>Monitoring</h2>
          <p className="secondary">Everything stays on this computer. Nothing is uploaded.</p>
        </div>
        <div>
          {SOURCES.map((s) => (
            <div className="source" key={s.key}>
              <Toggle label={s.label} checked={draft.monitoring[s.key]} onChange={(v) => setMonitoring(s.key, v)} />
              <details>
                <summary className="small">What's collected</summary>
                <div className="collected">
                  <p>Reads: {s.reads}</p>
                  <p>Keeps: {s.stores}</p>
                  <p>Never: {s.never}</p>
                </div>
              </details>
            </div>
          ))}
          <div className="source">
            <Toggle
              label="Keep window titles"
              checked={draft.privacy.storeWindowTitles}
              onChange={(v) => update({ ...draft, privacy: { ...draft.privacy, storeWindowTitles: v } })}
            />
            <Toggle
              label="Read website domains from browsers"
              checked={draft.privacy.readBrowserDomains}
              onChange={(v) => update({ ...draft, privacy: { ...draft.privacy, readBrowserDomains: v } })}
            />
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h2>Focus indicator</h2>
        <FocusIndicatorSettings value={draft.overlay} onChange={(overlay) => update({ ...draft, overlay })} />
      </section>

      <section className="settings-section" id="webcam">
        <h2>Webcam</h2>
        <CameraCalibration zones={remote.data?.camera.zones ?? []} onSaved={remote.reload} />
        <Field label="Looking away from every screen counts as">
          <select className="select" style={{ maxWidth: 280 }} value={e.offScreenPolicy} onChange={(ev) => setEngine({ offScreenPolicy: ev.target.value as OffScreenPolicy })}>
            <option value="ignore">Nothing (ignored)</option>
            <option value="neutral">Neutral at most</option>
            <option value="distracted">Distracted</option>
          </select>
        </Field>
      </section>

      <section className="settings-section">
        <h2>What counts as study</h2>
        <div className="grid cols-2" style={{ gap: 32, alignItems: 'start' }}>
          <div className="grid" style={{ gap: 18 }}>
            <h3>Study</h3>
            <Field label="Apps" group>
              <ChipListEditor values={draft.apps.productiveApps} onChange={(v) => setApps({ productiveApps: v })} placeholder="e.g. winword" />
            </Field>
            <Field label="Websites" group>
              <ChipListEditor values={draft.apps.productiveDomains} onChange={(v) => setApps({ productiveDomains: v })} placeholder="e.g. moodle.myuni.ac.uk" normalise={normaliseDomain} />
            </Field>
            <Field label="Words in window titles" group>
              <ChipListEditor values={draft.apps.productiveKeywords} onChange={(v) => setApps({ productiveKeywords: v })} placeholder="e.g. jstor" />
            </Field>
          </div>
          <div className="grid" style={{ gap: 18 }}>
            <h3>Distracting</h3>
            <Field label="Apps" group>
              <ChipListEditor values={draft.apps.distractingApps} onChange={(v) => setApps({ distractingApps: v })} placeholder="e.g. steam" />
            </Field>
            <Field label="Websites" group>
              <ChipListEditor values={draft.apps.distractingDomains} onChange={(v) => setApps({ distractingDomains: v })} placeholder="e.g. netflix.com" normalise={normaliseDomain} />
            </Field>
            <Field label="Words in window titles" group>
              <ChipListEditor values={draft.apps.distractingKeywords} onChange={(v) => setApps({ distractingKeywords: v })} placeholder="e.g. youtube" />
            </Field>
          </div>
        </div>
        <Field label="Ignored apps" group>
          <ChipListEditor values={draft.apps.excludedApps} onChange={(v) => setApps({ excludedApps: v })} placeholder="App name" />
        </Field>
      </section>

      <section className="settings-section">
        <details>
          <summary>
            <h2 style={{ display: 'inline' }}>Advanced</h2>
          </summary>
          <div className="grid cols-2" style={{ gap: '18px 32px', marginTop: 18, alignItems: 'start' }}>
            <div className="grid" style={{ gap: 14 }}>
              <h3>Classification</h3>
              <Slider label="Productive above" value={e.productiveThreshold} min={0.3} max={0.95} step={0.01} format={(v) => v.toFixed(2)} onChange={(v) => setEngine({ productiveThreshold: v })} />
              <Slider label="Neutral above" value={e.neutralThreshold} min={0.05} max={0.8} step={0.01} format={(v) => v.toFixed(2)} onChange={(v) => setEngine({ neutralThreshold: v })} />
              <Slider label="Neutral time counted as study" value={e.neutralContribution} min={0} max={1} step={0.05} format={(v) => formatPct(v)} onChange={(v) => setEngine({ neutralContribution: v })} />
              <Slider label="Inactive after" value={e.inactivityThresholdSec} min={30} max={900} step={15} format={minutes} onChange={(v) => setEngine({ inactivityThresholdSec: v })} />
              <Slider label="Away after" value={e.awayThresholdSec} min={60} max={1800} step={30} format={minutes} onChange={(v) => setEngine({ awayThresholdSec: v })} />
              <Slider label="Away after leaving the webcam" value={e.absenceThresholdSec} min={15} max={600} step={15} format={(v) => (v < 60 ? `${v} s` : minutes(v))} onChange={(v) => setEngine({ absenceThresholdSec: v })} />
              <Slider label="Check every" value={draft.analysisIntervalSec} min={2} max={30} step={1} format={(v) => `${v} s`} onChange={(v) => update({ ...draft, analysisIntervalSec: v })} />
            </div>
            <div className="grid" style={{ gap: 14 }}>
              <h3>Signal weights</h3>
              {WEIGHT_KEYS.map((k) => (
                <Slider
                  key={k}
                  label={WEIGHT_LABEL[k]}
                  value={e.weights[k]}
                  min={0}
                  max={1}
                  step={0.05}
                  format={(v) => (totalWeight > 0 ? formatPct(v / totalWeight) : '—')}
                  onChange={(v) => setEngine({ weights: { ...e.weights, [k]: v } })}
                />
              ))}
              <h3 style={{ marginTop: 8 }}>Webcam</h3>
              <Slider label="Look-away tolerance" value={draft.camera.lookAwayAngleDeg} min={10} max={60} step={1} format={(v) => `${v}°`} onChange={(v) => update({ ...draft, camera: { ...draft.camera, lookAwayAngleDeg: v } })} />
              <Slider label="Samples per second" value={draft.camera.samplesPerSecond} min={0.5} max={5} step={0.5} format={(v) => `${v}`} onChange={(v) => update({ ...draft, camera: { ...draft.camera, samplesPerSecond: v } })} />
            </div>
          </div>
          <div style={{ marginTop: 18 }}>
            <button className="btn" onClick={() => void reset()}>
              Reset all settings
            </button>
          </div>
        </details>
      </section>

      <section className="settings-section">
        <h2>Your data</h2>
        <p className="secondary small">
          Stored at <span style={{ wordBreak: 'break-all' }}>{info.data?.dataPath ?? '…'}</span>
        </p>
        <div className="row">
          {demo.data?.hasDemoData ? (
            <button className="btn" onClick={() => void demoAction('demo:clear')}>
              Remove demo data
            </button>
          ) : (
            <button className="btn" onClick={() => void demoAction('demo:seed')}>
              Load demo data
            </button>
          )}
          <button className="btn danger" onClick={() => void deleteAll()}>
            Delete all my data
          </button>
        </div>
      </section>
    </div>
  );
}
