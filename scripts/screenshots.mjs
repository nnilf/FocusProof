// Regenerates the README screenshots from demo data, in light and dark.
//   npm run screenshots              all of them
//   npm run screenshots -- check     only the named ones (today, progress, report, settings, setup, session, check)
// The calibration check uses your real webcam: sit in front of it, facing your main screen. To use a
// recording instead, set FOCUSPROOF_FAKE_CAMERA to a .mjpeg or .y4m file (Chromium's fake camera).
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
const only = process.argv.slice(2);
const want = (name) => only.length === 0 || only.includes(name);

const build = spawnSync('npx electron-vite build', { cwd: root, stdio: 'inherit', shell: true });
if (build.status !== 0) process.exit(build.status ?? 1);

const profile = mkdtempSync(join(tmpdir(), 'focusproof-shots-'));
const electron = createRequire(import.meta.url)('electron');
const fakeCamera = process.env['FOCUSPROOF_FAKE_CAMERA'];
const cameraArgs = fakeCamera ? ['--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${fakeCamera}`] : [];
const app = spawn(electron, ['.', `--remote-debugging-port=${PORT}`, ...cameraArgs], {
  cwd: root,
  env: { ...process.env, FOCUSPROOF_USER_DATA: profile },
  stdio: 'ignore',
});

async function connect(page = 'index.html') {
  for (let i = 0; i < 40; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const target = targets.find((t) => t.type === 'page' && t.url.includes(page));
      if (target) return target.webSocketDebuggerUrl;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error(`The app did not open ${page}.`);
}

/** A Chrome DevTools Protocol connection to one window of the app. */
async function devtools(url) {
  const ws = new WebSocket(url);
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
  return { ws, send, run };
}

try {
  const { ws, send, run } = await devtools(await connect());
  const api = (channel, req = {}) => run(`window.focusproof.invoke(${JSON.stringify(channel)}, ${JSON.stringify(req)})`);

  await sleep(1500);
  await send('Emulation.setDeviceMetricsOverride', { ...VIEW, deviceScaleFactor: 1, mobile: false });
  await api('demo:seed');
  const report = (await api('sessions:list', { assignmentId: null, limit: 20 })).find((r) => r.metrics && r.metrics.durationMs > 3_600_000);

  const shoot = async (name, page = send) => {
    if (!want(name)) return;
    for (const scheme of ['light', 'dark']) {
      await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
      await sleep(400);
      const shot = await page('Page.captureScreenshot', { format: 'png' });
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
  await open('#/setup');
  await shoot('setup');

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
  if (want('session')) {
    const [assignment] = await api('assignments:list', { includeArchived: false });
    const monitoring = { activeWindow: true, inputActivity: false, screenAnalysis: false, documents: false, webcam: false };
    await api('sessions:start', { assignmentId: assignment.id, targets: [], monitoring });
    await send('Page.bringToFront');
    await sleep(40_000);
    const live = await api('sessions:live');
    console.log(`live session: ${live?.classification}, ${live?.lastReasons?.map((r) => r.text).join('; ')}`);
    await shoot('session');
    await api('sessions:end');
  }

  if (want('check')) {
    // A typical desk: the main screen behind the webcam, a notepad below it and a laptop to one side.
    await api('settings:update', {
      camera: {
        zones: [
          { kind: 'screen', displayId: 1, label: 'Main display', yawDeg: 0, pitchDeg: 6 },
          { kind: 'screen', displayId: null, label: 'Notepad', yawDeg: 2, pitchDeg: 42 },
          { kind: 'distraction', displayId: null, label: 'Laptop', yawDeg: 40, pitchDeg: 26 },
        ],
      },
    });
    await api('calibration:check');
    const check = await devtools(await connect('check.html'));
    // Taller than the other shots so the zone map fits below the camera.
    await check.send('Emulation.setDeviceMetricsOverride', { width: VIEW.width, height: 940, deviceScaleFactor: 1, mobile: false });
    await check.send('Page.bringToFront');
    console.log('Calibration check open: face your main screen and hold still…');
    await sleep(25_000);
    await shoot('check', check.send);
    check.ws.close();
  }
  ws.close();
} finally {
  app.kill();
  await sleep(1000);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
