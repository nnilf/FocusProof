import { useState } from 'react';
import { FileText, Folder, X } from 'lucide-react';
import type { Assignment, AssignmentInput, MonitoredTargetKind } from '@shared/types';
import { call } from '../lib/api';
import { ErrorText, Field, Modal } from '../components/ui';

const toDateInput = (ts: number | null): string => (ts ? new Date(ts).toISOString().slice(0, 10) : '');
const fromDateInput = (v: string): number | null => (v ? new Date(`${v}T23:59:00`).getTime() : null);
const toNumber = (v: string): number | null => (v.trim() === '' ? null : Number(v));

export function TargetList(props: {
  targets: { path: string; kind: MonitoredTargetKind }[];
  onChange: (t: { path: string; kind: MonitoredTargetKind }[]) => void;
}) {
  const pick = async (folders: boolean): Promise<void> => {
    const paths = await call('dialog:pickPaths', { folders });
    const kind: MonitoredTargetKind = folders ? 'folder' : 'file';
    const existing = new Set(props.targets.map((t) => t.path));
    props.onChange([...props.targets, ...paths.filter((p) => !existing.has(p)).map((path) => ({ path, kind }))]);
  };
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {props.targets.length === 0 && <p className="muted small">None</p>}
      {props.targets.map((t) => (
        <div key={t.path} className="row small" style={{ flexWrap: 'nowrap' }}>
          {t.kind === 'folder' ? <Folder size={14} aria-hidden /> : <FileText size={14} aria-hidden />}
          <span className="truncate mono" style={{ flex: 1 }} title={t.path}>
            {t.path}
          </span>
          <button
            className="btn ghost sm"
            aria-label={`Remove ${t.path}`}
            onClick={() => props.onChange(props.targets.filter((x) => x.path !== t.path))}
          >
            <X size={14} />
          </button>
        </div>
      ))}
      <div className="row">
        <button className="btn sm" onClick={() => void pick(false)}>
          Add files
        </button>
        <button className="btn sm" onClick={() => void pick(true)}>
          Add folder
        </button>
      </div>
    </div>
  );
}

export function AssignmentForm(props: { initial: Assignment | null; onClose: () => void; onSaved: (a: Assignment) => void }) {
  const i = props.initial;
  const [form, setForm] = useState({
    name: i?.name ?? '',
    module: i?.module ?? '',
    description: i?.description ?? '',
    deadline: toDateInput(i?.deadline ?? null),
    targetWordCount: i?.targetWordCount?.toString() ?? '',
    currentWordCount: (i?.currentWordCount ?? 0).toString(),
    estimatedHours: i?.estimatedHours?.toString() ?? '',
    notes: i?.notes ?? '',
  });
  const [targets, setTargets] = useState(i?.targets.map((t) => ({ path: t.path, kind: t.kind })) ?? []);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    const input: AssignmentInput = {
      name: form.name.trim(),
      module: form.module.trim(),
      description: form.description,
      deadline: fromDateInput(form.deadline),
      targetWordCount: toNumber(form.targetWordCount),
      currentWordCount: toNumber(form.currentWordCount) ?? 0,
      estimatedHours: toNumber(form.estimatedHours),
      notes: form.notes,
      targets,
    };
    try {
      const saved = i ? await call('assignments:update', { id: i.id, input }) : await call('assignments:create', input);
      props.onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal label={i ? 'Edit assignment' : 'New assignment'} onClose={props.onClose} wide>
      <h2>{i ? 'Edit assignment' : 'New assignment'}</h2>
      <div className="grid cols-2">
        <Field label="Name">
          <input className="input" value={form.name} onChange={set('name')} autoFocus />
        </Field>
        <Field label="Module">
          <input className="input" value={form.module} onChange={set('module')} />
        </Field>
        <div className="span-2">
          <Field label="Description">
            <textarea className="textarea" value={form.description} onChange={set('description')} />
          </Field>
        </div>
        <Field label="Deadline">
          <input className="input" type="date" value={form.deadline} onChange={set('deadline')} />
        </Field>
        <Field label="Estimated hours">
          <input className="input" type="number" min={0} step={0.5} value={form.estimatedHours} onChange={set('estimatedHours')} />
        </Field>
        <Field label="Target word count">
          <input className="input" type="number" min={0} value={form.targetWordCount} onChange={set('targetWordCount')} />
        </Field>
        <Field label="Current word count">
          <input className="input" type="number" min={0} value={form.currentWordCount} onChange={set('currentWordCount')} />
        </Field>
        <div className="span-2">
          <Field label="Monitored files (.txt, .md, .docx, code)">
            <TargetList targets={targets} onChange={setTargets} />
          </Field>
        </div>
        <div className="span-2">
          <Field label="Notes">
            <textarea className="textarea" value={form.notes} onChange={set('notes')} />
          </Field>
        </div>
      </div>
      <ErrorText error={error} />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={props.onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={saving || !form.name.trim()} onClick={() => void save()}>
          {i ? 'Save changes' : 'Create assignment'}
        </button>
      </div>
    </Modal>
  );
}
