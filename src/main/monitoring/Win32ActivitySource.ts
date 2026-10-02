import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { z } from 'zod';

const sampleSchema = z.object({
  t: z.number(),
  proc: z.string().nullable(),
  title: z.string(),
  idle: z.number(),
  kb: z.number(),
  ms: z.number(),
  active: z.boolean(),
});

export type ActivitySample = z.infer<typeof sampleSchema>;

/**
 * Runs the PowerShell helper (Win32 GetForegroundWindow/GetLastInputInfo) and streams one
 * sample per second. Using PowerShell avoids compiling native modules on the user's machine.
 */
export class Win32ActivitySource {
  private child: ChildProcessWithoutNullStreams | null = null;
  private listeners = new Set<(s: ActivitySample) => void>();
  private restarts = 0;
  private stopping = false;
  private lastSampleAt = 0;
  lastError: string | null = null;

  constructor(private readonly scriptPath: string) {}

  static isSupported(scriptPath: string): boolean {
    return process.platform === 'win32' && existsSync(scriptPath);
  }

  get healthy(): boolean {
    return this.child !== null && Date.now() - this.lastSampleAt < 5_000;
  }

  onSample(listener: (s: ActivitySample) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.child) return;
    this.stopping = false;
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath, '-ParentPid', String(process.pid)],
      { windowsHide: true },
    );
    this.child = child;
    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line) => this.handleLine(line));
    child.stderr.on('data', (d: Buffer) => {
      this.lastError = d.toString().slice(0, 500);
    });
    child.on('exit', () => {
      rl.close();
      this.child = null;
      if (!this.stopping && this.restarts < 5) {
        this.restarts++;
        setTimeout(() => this.start(), 1_000 * this.restarts);
      }
    });
    child.on('error', (err) => {
      this.lastError = err.message;
    });
  }

  stop(): void {
    this.stopping = true;
    this.child?.kill();
    this.child = null;
  }

  private handleLine(line: string): void {
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      return;
    }
    const parsed = sampleSchema.safeParse(json);
    if (!parsed.success) return;
    this.lastSampleAt = Date.now();
    this.restarts = 0;
    for (const l of this.listeners) l(parsed.data);
  }
}
