const pad = (n: number): string => String(n).padStart(2, '0');

/** Local calendar date key, YYYY-MM-DD. */
export function dateKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Monday-based start of week. */
export function startOfWeek(ts: number): number {
  const d = new Date(startOfDay(ts));
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d.getTime();
}

export function addDays(ts: number, days: number): number {
  const d = new Date(ts);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** Consecutive local date keys ending today (inclusive). */
export function lastNDays(n: number, now = Date.now()): string[] {
  const today = startOfDay(now);
  return Array.from({ length: n }, (_, i) => dateKey(addDays(today, i - n + 1)));
}
