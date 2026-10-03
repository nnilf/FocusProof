// Regenerates the README screenshots from demo data, in light and dark.
//   npm run screenshots
// Runs the app on a throwaway profile (FOCUSPROOF_USER_DATA), so your own data is never touched,
// and drives it over the Chrome DevTools Protocol.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'docs', 'screenshots');
const PORT = 9333;
const VIEW = { width: 1280, height: 800 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const build = spawnSync('npx electron-vite build', { cwd: root, stdio: 'inherit', shell: true });
if (build.status !== 0) process.exit(build.status ?? 1);

const profile = mkdtempSync(join(tmpdir(), 'focusproof-shots-'));
const electron = createRequire(import.meta.url)('electron');
const app = spawn(electron, ['.', `--remote-debugging-port=${PORT}`], {
  cwd: root,
  env: { ...process.env, FOCUSPROOF_USER_DATA: profile },
  stdio: 'ignore',
});

async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = targets.find((t) => t.type === 'page' && t.url.includes('index.html'));
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error('The app did not start.');
}

try {
  const ws = new WebSocket(await connect());
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let nextId = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    pending.get(msg.id)?.(msg);
    pending.delete(msg.id);
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++nextId;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const run = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.exception?.description ?? expression);
    return res.result?.result?.value;
  };
  const api = (channel, req = {}) => run(`window.focusproof.invoke(${JSON.stringify(channel)}, ${JSON.stringify(req)})`);

  await sleep(1500);
  await send('Emulation.setDeviceMetricsOverride', { ...VIEW, deviceScaleFactor: 1, mobile: false });
  await api('demo:seed');
  const report = (await api('sessions:list', { assignmentId: null, limit: 20 })).find((r) => r.metrics && r.metrics.durationMs > 3_600_000);

  const shoot = async (name) => {
    for (const scheme of ['light', 'dark']) {
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      await sleep(400);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(outDir, `${name}-${scheme}.png`), Buffer.from(shot.result.data, 'base64'));
      console.log(`docs/screenshots/${name}-${scheme}.png`);
    }
  };
  const open = async (hash) => {
    await run(`location.hash = ${JSON.stringify(hash)}`);
    await sleep(1200);
  };

  mkdirSync(outDir, { recursive: true });
  await open('#/progress'); // leave Today first so it reloads with the seeded data
  await open('#/');
  await shoot('today');
  await open('#/progress');
  await shoot('progress');
  if (report) {
    await open(`#/report/${report.session.id}`);
    await shoot('report');
  }
  await open('#/settings');
  await shoot('settings');

  // The live view shows real monitoring of this machine. In the throwaway profile, count the
  // FocusProof window (which is in front) as a study app so the shot reads like a real session.
  const settings = await api('settings:get');
  await api('settings:update', {
    apps: {
      ...settings.apps,
      productiveApps: [...settings.apps.productiveApps, 'electron', 'focusproof'],
      excludedApps: settings.apps.excludedApps.filter((a) => a !== 'electron' && a !== 'focusproof'),
    },
  });
  const [assignment] = await api('assignments:list', { includeArchived: false });
  const monitoring = { activeWindow: true, inputActivity: false, screenAnalysis: false, documents: false, webcam: false };
  await api('sessions:start', { assignmentId: assignment.id, targets: [], monitoring });
  await send('Page.bringToFront');
  await sleep(40_000);
  const live = await api('sessions:live');
  console.log(`live session: ${live?.classification}, ${live?.lastReasons?.map((r) => r.text).join('; ')}`);
  await shoot('session');
  await api('sessions:end');
  ws.close();
} finally {
  app.kill();
  await sleep(1000);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
