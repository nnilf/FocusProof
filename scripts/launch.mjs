// One-step launcher: installs dependencies and rebuilds only when needed, then starts FocusProof.
//   node scripts/launch.mjs             start the app
//   node scripts/launch.mjs --rebuild   force a rebuild first
//   node scripts/launch.mjs --shortcut  create a desktop shortcut to FocusProof.cmd
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const log = (msg) => console.log(`[FocusProof] ${msg}`);

function run(command) {
  const res = spawnSync(command, { cwd: root, stdio: 'inherit', shell: true });
  if (res.status !== 0) {
    console.error(`[FocusProof] "${command}" failed.`);
    process.exit(res.status ?? 1);
  }
}

function newestMtime(path) {
  if (!existsSync(path)) return 0;
  const info = statSync(path);
  if (!info.isDirectory()) return info.mtimeMs;
  let newest = 0;
  for (const entry of readdirSync(path)) {
    if (entry === 'mediapipe' || entry === 'node_modules') continue;
    newest = Math.max(newest, newestMtime(join(path, entry)));
  }
  return newest;
}

function createShortcut() {
  const target = join(root, 'FocusProof.cmd');
  const icon = join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  const ps = [
    '$s = (New-Object -ComObject WScript.Shell).CreateShortcut([IO.Path]::Combine([Environment]::GetFolderPath("Desktop"), "FocusProof.lnk"))',
    `$s.TargetPath = "${target}"`,
    `$s.WorkingDirectory = "${root}"`,
    existsSync(icon) ? `$s.IconLocation = "${icon},0"` : '',
    '$s.WindowStyle = 7',
    '$s.Save()',
  ]
    .filter(Boolean)
    .join('; ');
  const res = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
  log(res.status === 0 ? 'Desktop shortcut created.' : 'Could not create the shortcut.');
}

if (!existsSync(join(root, 'node_modules', 'electron'))) {
  log('First run: installing dependencies (this takes a few minutes)...');
  run('npm install');
}

if (args.has('--shortcut')) {
  createShortcut();
  process.exit(0);
}

const builtAt = newestMtime(join(root, 'out', 'main', 'index.js'));
const sourceAt = Math.max(
  newestMtime(join(root, 'src')),
  newestMtime(join(root, 'package.json')),
  newestMtime(join(root, 'electron.vite.config.ts')),
);
if (args.has('--rebuild') || builtAt === 0 || sourceAt > builtAt) {
  log('Building...');
  run('npx electron-vite build');
}

const electronPath = createRequire(import.meta.url)('electron');
log('Starting.');
const child = spawn(electronPath, ['.'], { cwd: root, detached: true, stdio: 'ignore' });
child.unref();
