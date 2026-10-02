import { useState } from 'react';
import type { MonitoringToggles } from '@shared/types';
import { call } from '../lib/api';
import { useApi } from '../hooks/useApi';
import { Card, ErrorText, Loading, PageHeader, Toggle } from '../components/ui';

interface Source {
  key: keyof MonitoringToggles;
  title: string;
  collects: string[];
  stores: string[];
  never: string[];
}

const SOURCES: Source[] = [
  {
    key: 'webcam',
    title: 'Webcam (off by default)',
    collects: ['Video frames, processed in memory by a local MediaPipe face-landmark model at about 2 frames per second'],
    stores: ['Whether a face was present and an approximate focus score (head orientation) per interval'],
    never: ['Video or images are never saved or transmitted', 'No identity or face recognition is performed'],
  },
  {
    key: 'screenAnalysis',
    title: 'Screen analysis',
    collects: ['A 160×90 pixel thumbnail of the primary screen each interval, kept only in memory'],
    stores: ['A visual-change number (how much the screen changed)'],
    never: ['Screenshots are never written to disk or uploaded'],
  },
  {
    key: 'activeWindow',
    title: 'Active-window monitoring',
    collects: ['The foreground application name and window title once per second'],
    stores: ['The dominant application per interval and a truncated window title (can be disabled below)'],
    never: ['Window contents are not read'],
  },
  {
    key: 'inputActivity',
    title: 'Input activity',
    collects: ['Whether keyboard or mouse input happened, sampled five times per second'],
    stores: ['Counts of input samples and idle time'],
    never: ['Which keys were pressed, typed text and click positions are never captured'],
  },
  {
    key: 'documents',
    title: 'Document monitoring',
    collects: ['The contents of files you explicitly select, read locally when they change to compute differences'],
    stores: ['File path, size, word count, line count and words/lines added or removed'],
    never: ['File contents are never stored in the database'],
  },
];

export function PrivacyPage() {
  const { data, error, loading, reload } = useApi(() => call('settings:get', {}), []);
  const info = useApi(() => call('app:info', {}), []);
  const [deleting, setDeleting] = useState(false);

  if (!data) return <div className="page">{loading ? <Loading /> : <ErrorText error={error} />}</div>;

  const toggle = async (key: keyof MonitoringToggles, value: boolean): Promise<void> => {
    await call('settings:update', { monitoring: { [key]: value } });
    reload();
  };

  const deleteAll = async (): Promise<void> => {
    if (!window.confirm('Permanently delete all assignments, sessions and analytics? Settings are kept.')) return;
    setDeleting(true);
    try {
      await call('privacy:deleteAll', {});
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Privacy"
        sub="Everything is processed and stored on this computer. Nothing is uploaded."
      />
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        {SOURCES.map((s) => (
          <Card key={s.key}>
            <div className="privacy-section">
              <Toggle label={s.title} checked={data.monitoring[s.key]} onChange={(v) => void toggle(s.key, v)} />
              <h3>Reads</h3>
              <ul>{s.collects.map((x) => <li key={x}>{x}</li>)}</ul>
              <h3>Stores</h3>
              <ul>{s.stores.map((x) => <li key={x}>{x}</li>)}</ul>
              <h3>Never</h3>
              <ul>{s.never.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          </Card>
        ))}
        <Card title="Stored data">
          <div style={{ display: 'grid', gap: 12 }}>
            <Toggle
              label="Store window titles"
              checked={data.privacy.storeWindowTitles}
              onChange={(v) => void call('settings:update', { privacy: { storeWindowTitles: v } }).then(reload)}
            />
            <p className="small secondary">
              Database location: <span className="mono">{info.data?.dataPath ?? '…'}</span>
            </p>
            <div>
              <button className="btn danger" disabled={deleting} onClick={() => void deleteAll()}>
                Delete all my data
              </button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
