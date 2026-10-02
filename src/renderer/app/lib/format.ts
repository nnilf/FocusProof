import type { Classification } from '@shared/types';

export function formatDuration(ms: number | null | undefined, opts: { seconds?: boolean } = {}): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (opts.seconds) return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  if (h > 0) return `${h}h ${pad(m)}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

const pad = (n: number): string => String(n).padStart(2, '0');

export const formatHours = (ms: number): string => `${(ms / 3_600_000).toFixed(1)}h`;

export function formatPct(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

export const formatScore = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : v.toFixed(2);

export const formatNumber = (n: number): string => n.toLocaleString();

export const formatSigned = (n: number): string => (n > 0 ? `+${n.toLocaleString()}` : n.toLocaleString());

export const formatTime = (ts: number): string =>
  new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

export const formatDate = (ts: number): string =>
  new Date(ts).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

export const formatDateLong = (ts: number): string =>
  new Date(ts).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/** "2026-10-02" -> "2 Oct" */
export function formatDayKey(key: string): string {
  const d = new Date(`${key}T12:00:00`);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export const CLASS_LABEL: Record<Classification, string> = {
  productive: 'Productive',
  neutral: 'Neutral',
  distracted: 'Distracted',
  away: 'Away',
};

export const CLASS_COLOR_VAR: Record<Classification, string> = {
  productive: 'var(--c-productive)',
  neutral: 'var(--c-neutral)',
  distracted: 'var(--c-distracted)',
  away: 'var(--c-away)',
};

/** Literal values for libraries (Recharts) that cannot resolve CSS variables in SVG attributes. */
export const CLASS_HEX: Record<Classification, string> = {
  productive: '#199e70',
  neutral: '#3987e5',
  distracted: '#d95926',
  away: '#5d5c58',
};

export const SERIES_HEX = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

export const basename = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
