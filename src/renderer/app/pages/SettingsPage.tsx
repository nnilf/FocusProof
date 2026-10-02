import { useEffect, useState } from 'react';
import type { OffScreenPolicy, Settings, SettingsPatch, WeightKey } from '@shared/types';
import { WEIGHT_KEYS } from '@shared/types';
import { call } from '../lib/api';
import { useApi } from '../hooks/useApi';
import { Card, ErrorText, Field, Loading, PageHeader, Toggle } from '../components/ui';
import { ChipListEditor } from '../components/ChipListEditor';
import { CameraCalibration } from '../components/CameraCalibration';
import { FocusIndicatorSettings } from '../components/FocusIndicatorSettings';
import { formatPct } from '../lib/format';

const WEIGHT_LABEL: Record<WeightKey, string> = {
  relevance: 'Screen / application relevance',
  input: 'Keyboard & mouse activity',
  document: 'Document activity',
  camera: 'Webcam focus & presence',
  context: 'Sustained activity / context',
};

function Slider(props: { value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void; label: string }) {
  return (
    <div className="slider-row">
      <input type="range" aria-label={props.label} min={props.min} max={props.max} step={props.step} value={props.value} onChange={(e) => props.onChange(Number(e.target.value))} />
      <span className="num secondary" style={{ textAlign: 'right' }}>{props.format(props.value)}</span>
    </div>
  );
}

export function SettingsPage() {
  const remote = useApi(() => call('settings:get', {}), []);
  const demo = useApi(() => call('demo:status', {}), []);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (remote.data) setDraft(remote.data);
  }, [remote.data]);

  if (!draft) return <div className="page">{remote.loading ? <Loading /> : <ErrorText error={remote.error} />}</div>;
  const e = draft.engine;
  const totalWeight = WEIGHT_KEYS.reduce((n, k) => n + e.weights[k], 0);
  const dirty = JSON.stringify(draft) !== JSON.stringify(remote.data);

  const setEngine = (patch: Partial<Settings['engine']>): void => setDraft({ ...draft, engine: { ...e, ...patch } });
  const setApps = (patch: Partial<Settings['apps']>): void => setDraft({ ...draft, apps: { ...draft.apps, ...patch } });

  const save = async (): Promise<void> => {
    setError(null);
    if (e.neutralThreshold >= e.productiveThreshold) {
      setError('The neutral threshold must be lower than the productive threshold.');
      return;
    }
    if (e.awayThresholdSec < e.inactivityThresholdSec) {
      setError('The away threshold should be at least the inactivity threshold.');
      return;
    }
    try {
      const { zones: _zones, ...camera } = draft.camera;
      const patch: SettingsPatch = { ...draft, camera };
      setDraft(await call('settings:update', patch));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const demoAction = async (action: 'demo:seed' | 'demo:clear'): Promise<void> => {
    if (action === 'demo:clear' && !window.confirm('Remove all demo assignments and sessions? Your own data is not affected.')) return;
    await call(action, {});
    demo.reload();
  };

  return (
    <div className="page">
      <PageHeader
        title="Settings"
        actions={
          <>
            {saved && <span className="small secondary">Saved</span>}
            <button className="btn" onClick={() => void call('settings:reset', {}).then(setDraft)}>
              Reset
            </button>
            <button className="btn primary" disabled={!dirty} onClick={() => void save()}>
              Save
            </button>
          </>
        }
      />
      <ErrorText error={error} />

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <Card title="Classification">
          <div style={{ display: 'grid', gap: 14 }}>
            <Field label="Productive threshold">
              <Slider label="Productive threshold" value={e.productiveThreshold} min={0.3} max={0.95} step={0.01} format={(v) => v.toFixed(2)} onChange={(v) => setEngine({ productiveThreshold: v })} />
            </Field>
            <Field label="Neutral threshold">
              <Slider label="Neutral threshold" value={e.neutralThreshold} min={0.05} max={0.8} step={0.01} format={(v) => v.toFixed(2)} onChange={(v) => setEngine({ neutralThreshold: v })} />
            </Field>
            <Field label="Neutral time counted as ALT">
              <Slider label="Neutral contribution" value={e.neutralContribution} min={0} max={1} step={0.05} format={(v) => formatPct(v)} onChange={(v) => setEngine({ neutralContribution: v })} />
            </Field>
            <Field label="Inactivity threshold">
              <Slider label="Inactivity threshold" value={e.inactivityThresholdSec} min={30} max={900} step={15} format={(v) => `${Math.round(v / 6) / 10} min`} onChange={(v) => setEngine({ inactivityThresholdSec: v })} />
            </Field>
            <Field label="Away threshold">
              <Slider label="Away threshold" value={e.awayThresholdSec} min={60} max={1800} step={30} format={(v) => `${Math.round(v / 6) / 10} min`} onChange={(v) => setEngine({ awayThresholdSec: v })} />
            </Field>
            <Field label="Absent on webcam → away after">
              <Slider label="Webcam absence threshold" value={e.absenceThresholdSec} min={15} max={600} step={15} format={(v) => (v < 60 ? `${v} s` : `${Math.round(v / 6) / 10} min`)} onChange={(v) => setEngine({ absenceThresholdSec: v })} />
            </Field>
            <Field label="Analysis interval">
              <Slider label="Analysis interval" value={draft.analysisIntervalSec} min={2} max={30} step={1} format={(v) => `${v} s`} onChange={(v) => setDraft({ ...draft, analysisIntervalSec: v })} />
            </Field>
          </div>
        </Card>

        <Card title="Signal weights">
          <div style={{ display: 'grid', gap: 14 }}>
            {WEIGHT_KEYS.map((k) => (
              <Field key={k} label={WEIGHT_LABEL[k]}>
                <Slider
                  label={WEIGHT_LABEL[k]}
                  value={e.weights[k]}
                  min={0}
                  max={1}
                  step={0.05}
                  format={(v) => (totalWeight > 0 ? formatPct(v / totalWeight) : '—')}
                  onChange={(v) => setEngine({ weights: { ...e.weights, [k]: v } })}
                />
              </Field>
            ))}
          </div>
        </Card>

        <Card title="Focus indicator">
          <FocusIndicatorSettings value={draft.overlay} onChange={(overlay) => setDraft({ ...draft, overlay })} />
        </Card>

        <Card title="Monitoring defaults">
          <Toggle label="Webcam monitoring" checked={draft.monitoring.webcam} onChange={(v) => setDraft({ ...draft, monitoring: { ...draft.monitoring, webcam: v } })} />
          <Toggle label="Screen analysis" checked={draft.monitoring.screenAnalysis} onChange={(v) => setDraft({ ...draft, monitoring: { ...draft.monitoring, screenAnalysis: v } })} />
          <Toggle label="Active-window monitoring" checked={draft.monitoring.activeWindow} onChange={(v) => setDraft({ ...draft, monitoring: { ...draft.monitoring, activeWindow: v } })} />
          <Toggle label="Input activity" checked={draft.monitoring.inputActivity} onChange={(v) => setDraft({ ...draft, monitoring: { ...draft.monitoring, inputActivity: v } })} />
          <Toggle label="Document monitoring" checked={draft.monitoring.documents} onChange={(v) => setDraft({ ...draft, monitoring: { ...draft.monitoring, documents: v } })} />
        </Card>

        <Card title="Webcam calibration" className="span-2">
          <div id="calibration" className="grid cols-2" style={{ alignItems: 'start' }}>
            <CameraCalibration zones={remote.data?.camera.zones ?? []} onSaved={remote.reload} />
            <div style={{ display: 'grid', gap: 14 }}>
              <Field label="Looking away from all screens">
                <select
                  className="select"
                  value={e.offScreenPolicy}
                  onChange={(ev) => setEngine({ offScreenPolicy: ev.target.value as OffScreenPolicy })}
                >
                  <option value="ignore">Ignore</option>
                  <option value="neutral">Neutral at most</option>
                  <option value="distracted">Distracted</option>
                </select>
              </Field>
              <Field label="Look-away tolerance">
                <Slider
                  label="Look-away tolerance"
                  value={draft.camera.lookAwayAngleDeg}
                  min={10}
                  max={60}
                  step={1}
                  format={(v) => `${v}°`}
                  onChange={(v) => setDraft({ ...draft, camera: { ...draft.camera, lookAwayAngleDeg: v } })}
                />
              </Field>
              <Field label="Webcam samples per second">
                <Slider
                  label="Samples per second"
                  value={draft.camera.samplesPerSecond}
                  min={0.5}
                  max={5}
                  step={0.5}
                  format={(v) => `${v}/s`}
                  onChange={(v) => setDraft({ ...draft, camera: { ...draft.camera, samplesPerSecond: v } })}
                />
              </Field>
            </div>
          </div>
        </Card>

        <Card title="Demo data">
          <div style={{ display: 'grid', gap: 10 }}>
            <div className="row">
              {demo.data?.hasDemoData ? (
                <button className="btn danger" onClick={() => void demoAction('demo:clear')}>
                  Clear demo data
                </button>
              ) : (
                <button className="btn" onClick={() => void demoAction('demo:seed')}>
                  Load demo data
                </button>
              )}
            </div>
          </div>
        </Card>

        <Card title="Productive apps" className="span-2">
          <ChipListEditor values={draft.apps.productiveApps} onChange={(v) => setApps({ productiveApps: v })} placeholder="Process name, e.g. winword" />
        </Card>
        <Card title="Distracting apps">
          <ChipListEditor values={draft.apps.distractingApps} onChange={(v) => setApps({ distractingApps: v })} placeholder="Process name, e.g. steam" />
        </Card>
        <Card title="Ignored apps">
          <ChipListEditor values={draft.apps.excludedApps} onChange={(v) => setApps({ excludedApps: v })} placeholder="Process name" />
        </Card>
        <Card title="Productive title keywords">
          <ChipListEditor values={draft.apps.productiveKeywords} onChange={(v) => setApps({ productiveKeywords: v })} placeholder="e.g. jstor" />
        </Card>
        <Card title="Distracting title keywords">
          <ChipListEditor values={draft.apps.distractingKeywords} onChange={(v) => setApps({ distractingKeywords: v })} placeholder="e.g. youtube" />
        </Card>
      </div>
    </div>
  );
}
