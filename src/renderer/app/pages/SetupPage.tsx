import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { AppRules } from '@shared/types';
import {
  PRESET_GROUPS,
  applyChoices,
  groupEntries,
  ruleKey,
  sideOf,
  type PresetGroup,
  type PresetSide,
  type RuleChoice,
  type RuleKind,
} from '@shared/settings/presets';
import { call } from '../lib/api';
import { useApi } from '../hooks/useApi';
import { CameraCalibration } from '../components/CameraCalibration';
import { ErrorText, Loading, Toggle } from '../components/ui';

const SIDE_COLOR: Record<PresetSide, string> = { study: 'var(--c-productive)', distracting: 'var(--c-distracted)' };
const normaliseProcess = (name: string): string => name.trim().toLowerCase().replace(/\.exe$/, '');
const KIND_TITLE: Record<RuleKind, string> = { app: 'App', domain: 'Website', keyword: 'Words in window titles' };

function Pick(props: { label: string; title: string; side: PresetSide | null; onClick: () => void }) {
  return (
    <button className={`pick ${props.side ? 'on' : ''}`} title={props.title} aria-pressed={props.side !== null} onClick={props.onClick}>
      <span className="dot" style={{ background: props.side ? SIDE_COLOR[props.side] : 'transparent' }} />
      {props.label}
    </button>
  );
}

function AppsStep(props: { apps: AppRules; recent: string[]; onDone: () => void; onSkip: () => void }) {
  const { apps } = props;
  // Only the entries the user changed; everything else in their lists is left alone.
  const [choices, setChoices] = useState<Map<string, RuleChoice>>(new Map());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sideNow = (kind: RuleKind, value: string): PresetSide | null => {
    const c = choices.get(ruleKey(kind, value));
    return c ? c.side : sideOf(apps, kind, value);
  };
  const choose = (next: Map<string, RuleChoice>, kind: RuleKind, value: string, side: PresetSide | null): void => {
    const key = ruleKey(kind, value);
    if (side === sideOf(apps, kind, value)) next.delete(key);
    else next.set(key, { kind, value, side });
  };
  const toggle = (g: PresetGroup, kind: RuleKind, value: string): void => {
    const next = new Map(choices);
    choose(next, kind, value, sideNow(kind, value) === g.side ? null : g.side);
    setChoices(next);
  };
  const toggleGroup = (g: PresetGroup, on: boolean): void => {
    const next = new Map(choices);
    for (const e of groupEntries(g)) {
      if (on) choose(next, e.kind, e.value, g.side);
      else if (sideNow(e.kind, e.value) === g.side) choose(next, e.kind, e.value, null);
    }
    setChoices(next);
  };
  const cycle = (value: string): void => {
    const order: (PresetSide | null)[] = [null, 'study', 'distracting'];
    const now = sideNow('app', value);
    const next = new Map(choices);
    choose(next, 'app', value, order[(order.indexOf(now) + 1) % order.length] ?? null);
    setChoices(next);
  };

  const listed = new Set(
    [...apps.productiveApps, ...apps.distractingApps, ...apps.excludedApps, ...PRESET_GROUPS.flatMap((g) => g.apps)].map(normaliseProcess),
  );
  const seen = [...new Set(props.recent.map(normaliseProcess))].filter((a) => a && !listed.has(a));

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      const patch = applyChoices(apps, [...choices.values()]);
      if (Object.keys(patch).length) await call('settings:update', { apps: patch });
      props.onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  const group = (g: PresetGroup) => {
    const entries = groupEntries(g);
    const on = entries.filter((e) => sideNow(e.kind, e.value) === g.side).length;
    return (
      <div key={g.id} style={{ display: 'grid', gap: 8 }}>
        <Toggle label={g.name} checked={on === entries.length} onChange={(v) => toggleGroup(g, v)} />
        <div className="chip-list">
          {entries.map((e) => {
            const side = sideNow(e.kind, e.value);
            return (
              <Pick
                key={ruleKey(e.kind, e.value)}
                label={e.kind === 'keyword' ? `"${e.value.trim()}"` : e.value}
                title={side && side !== g.side ? `${KIND_TITLE[e.kind]} · in ${side === 'study' ? 'Study' : 'Distracting'}` : KIND_TITLE[e.kind]}
                side={side === g.side ? side : null}
                onClick={() => toggle(g, e.kind, e.value)}
              />
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="grid cols-2" style={{ gap: 32, alignItems: 'start' }}>
        <div className="grid" style={{ gap: 22 }}>
          <h2>Study</h2>
          {PRESET_GROUPS.filter((g) => g.side === 'study').map(group)}
        </div>
        <div className="grid" style={{ gap: 22 }}>
          <h2>Distracting</h2>
          {PRESET_GROUPS.filter((g) => g.side === 'distracting').map(group)}
          {seen.length > 0 && (
            <div style={{ display: 'grid', gap: 8 }}>
              <h3>Seen on this PC</h3>
              <div className="chip-list">
                {seen.map((a) => {
                  const side = sideNow('app', a);
                  return (
                    <Pick
                      key={a}
                      label={a}
                      title={side === 'study' ? 'Study' : side === 'distracting' ? 'Distracting' : 'Not set'}
                      side={side}
                      onClick={() => cycle(a)}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
      <ErrorText error={error} />
      <div className="row">
        <button className="btn primary" disabled={saving} onClick={() => void save()}>
          {choices.size ? 'Save and continue' : 'Continue'}
        </button>
        <button className="btn ghost" onClick={props.onSkip}>
          Skip
        </button>
      </div>
    </>
  );
}

export function SetupPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const back = (location.state as { back?: string } | null)?.back ?? '/';
  const [step, setStep] = useState<'apps' | 'camera'>('apps');
  const settings = useApi(() => call('settings:get', {}), []);
  const recent = useApi(() => call('apps:recent', {}), []);

  if (!settings.data) return <div className="page">{settings.loading ? <Loading /> : <ErrorText error={settings.error} />}</div>;

  const finish = async (): Promise<void> => {
    await call('setup:complete', {});
    navigate(back);
  };
  const webcam = settings.data.monitoring.webcam;

  return (
    <div className="page">
      <div className="section-head">
        <h1>{step === 'apps' ? 'What counts as study' : 'Webcam'}</h1>
        <span className="small muted num">{step === 'apps' ? '1' : '2'}/2</span>
      </div>
      {step === 'apps' ? (
        <AppsStep apps={settings.data.apps} recent={recent.data ?? []} onDone={() => setStep('camera')} onSkip={() => setStep('camera')} />
      ) : (
        <>
          <Toggle
            label="Use the webcam"
            checked={webcam}
            onChange={(v) => void call('settings:update', { monitoring: { webcam: v } }).then(settings.reload)}
          />
          {webcam && (
            <CameraCalibration zones={settings.data.camera.zones} lookAwayDeg={settings.data.camera.lookAwayAngleDeg} onSaved={settings.reload} />
          )}
          <div className="row">
            <button className="btn primary" onClick={() => void finish()}>
              Done
            </button>
            <button className="btn ghost" onClick={() => setStep('apps')}>
              Back
            </button>
          </div>
        </>
      )}
    </div>
  );
}
