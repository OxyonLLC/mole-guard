import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, '.env');
// docker-compose.yml sets these to Docker-specific values (0.0.0.0 host
// binds, host.docker.internal proxy targets), but the mounted .env below
// still has the values meant for local (non-Docker) dev. Re-loading .env
// with override:true would clobber Docker's values with those, so snapshot
// them first and restore after the reload. Extend DOCKER_ENV_OVERRIDE_KEYS
// when docker-compose.yml gains another var that needs the same protection.
const DOCKER_ENV_OVERRIDE_KEYS = [
  'HOST', 'WEB_HOST', 'PUBLIC_HOST', 'WATCHDOG_HOST',
  'GEOHACKERS_API_LOCAL_URL', 'GEOHACKERS_VERIFY_LOCAL_URL',
];
const dockerEnvOverrides = process.env.RUNNING_IN_DOCKER === 'true'
  ? Object.fromEntries(DOCKER_ENV_OVERRIDE_KEYS.map((k) => [k, process.env[k]]))
  : null;
if (fs.existsSync(ENV_PATH)) dotenv.config({ path: ENV_PATH, override: true });
if (dockerEnvOverrides) Object.assign(process.env, dockerEnvOverrides);

function spawnLogged(cmd, args, label, extraEnv = {}) {
  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  const pipe = (stream, writer) => {
    stream.on('data', (buf) => {
      const text = buf.toString();
      for (const line of text.split(/\r?\n/)) {
        if (!line) continue;
        writer(`[${label}] ${line}\n`);
      }
    });
  };

  pipe(child.stdout, (s) => process.stdout.write(s));
  pipe(child.stderr, (s) => process.stderr.write(s));
  return child;
}

const children = [];
let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      try { child.kill('SIGTERM'); } catch {}
    }
  }
  setTimeout(() => process.exit(code), 250);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const startAll = spawnLogged(process.execPath, ['src/runner.js', 'all'], 'start:all');
children.push(startAll);

// ngrok is NOT started here any more. dev-all.js spawns `runner.js all`, and
// that now owns the tunnel — so `start:all` and `dev:all` bring up the same
// stack instead of differing by whether anything on winlew.co can reach the
// API. Starting one here too would race the other for the reserved domain,
// which the ngrok free tier refuses (one agent at a time).
// See src/shared/ngrokLaunch.cjs for the launch settings.

startAll.on('exit', (code) => {
  if (!shuttingDown) {
    console.error(`[dev:all] start:all exited with code ${code ?? 0}`);
    shutdown(code ?? 0);
  }
});
