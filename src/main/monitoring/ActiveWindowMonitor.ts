import type { ActivitySample } from './Win32ActivitySource';

export interface ForegroundSummary {
  processName: string | null;
  title: string | null;
  domain: string | null;
  /** Number of distinct foreground apps seen in the interval (context switching). */
  switches: number;
}

interface Entry {
  n: number;
  proc: string | null;
  title: string;
  domain: string | null;
}

/** Aggregates per-second foreground samples into the dominant window for an interval. */
export class ActiveWindowMonitor {
  private counts = new Map<string, Entry>();
  private last: Omit<Entry, 'n'> | null = null;

  record(sample: ActivitySample): void {
    const domain = sample.domain ?? null;
    const key = `${sample.proc ?? ''}\u0000${sample.title}\u0000${domain ?? ''}`;
    const entry = this.counts.get(key) ?? { n: 0, proc: sample.proc, title: sample.title, domain };
    entry.n++;
    this.counts.set(key, entry);
    this.last = { proc: sample.proc, title: sample.title, domain };
  }

  current(): { processName: string | null; title: string | null } {
    return { processName: this.last?.proc ?? null, title: this.last?.title ?? null };
  }

  drain(): ForegroundSummary | null {
    if (this.counts.size === 0) {
      return this.last ? { processName: this.last.proc, title: this.last.title, domain: this.last.domain, switches: 0 } : null;
    }
    let best: Entry | null = null;
    for (const e of this.counts.values()) if (!best || e.n > best.n) best = e;
    const procs = new Set([...this.counts.values()].map((e) => e.proc));
    this.counts.clear();
    return best
      ? { processName: best.proc, title: best.title, domain: best.domain, switches: Math.max(0, procs.size - 1) }
      : null;
  }
}
