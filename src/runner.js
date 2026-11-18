import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveNgrokLaunch } = require('./shared/ngrokLaunch.cjs');

const SERVICES = {
  mole: { label: 'mole', entry: 'src/index.js', envFile: '.env' },
  faucet: { label: 'faucet', entry: 'src/faucet/bot.js', envFile: 'src/faucet/.env' },
  faucetpayouts: { label: 'faucet-payouts', entry: 'src/faucet/payout-worker-main.js', envFile: 'src/faucet/.env' },
  quiz: { label: 'quiz', entry: 'src/quiz/index.js', envFile: 'src/quiz/.env' },
  quizpayouts: { label: 'quiz-payouts', entry: 'src/quiz/payout-worker.js', envFile: 'src/quiz/.env' },
  gamepayouts: { label: 'game-payouts', entry: 'src/games/payout-worker.js', envFile: '.env' },
  watchdog: { label: 'watchdog', entry: 'src/watchdog/index.js', envFile: '.env' },
  public: { label: 'public', entry: 'src/public-server.js', envFile: '.env' },
};
function loadEnvFile(absPath) {
  if (!absPath) return {};
  if (!fs.existsSync(absPath)) return {};
  const txt = fs.readFileSync(absPath, 'utf-8');
  return dotenv.parse(txt);
}

function spawnService(key) {
  const svc = SERVICES[key];
  if (!svc) throw new Error(`Unknown service: ${key}`);

  const projectRoot = process.cwd();
  const absEntry = path.resolve(projectRoot, svc.entry);
  const cwd = path.dirname(absEntry);
  const relEntry = path.basename(absEntry);

  // Load root .env first so shared values like WINLEW_MINT and SOLANA_RPC
  // are available to all services, then let the service-specific env file
  // override only what it needs (usually bot token / ids).
  const rootEnv = loadEnvFile(path.resolve(projectRoot, '.env'));
  const absEnvFile = svc.envFile ? path.resolve(projectRoot, svc.envFile) : null;
  const fileEnv = loadEnvFile(absEnvFile);
  const childEnv = { ...process.env, ...rootEnv, ...fileEnv };
  // rootEnv/fileEnv come straight off disk, so on Docker they carry the
  // values meant for local (non-Docker) dev and just clobbered whatever
  // docker-compose.yml's environment: block set for this same key. Put
  // those back. Keep this list in sync with dev-all.js's
  // DOCKER_ENV_OVERRIDE_KEYS -- same problem, two places it happens.
  if (process.env.RUNNING_IN_DOCKER === 'true') {
    const dockerEnvOverrideKeys = [
      'HOST', 'WEB_HOST', 'PUBLIC_HOST', 'WATCHDOG_HOST',
      'GEOHACKERS_API_LOCAL_URL', 'GEOHACKERS_VERIFY_LOCAL_URL',
    ];
    for (const key of dockerEnvOverrideKeys) {
      if (process.env[key] !== undefined) childEnv[key] = process.env[key];
    }
  }

  const child = spawn(process.execPath, [relEntry], {
    cwd,
    stdio: 'inherit',
    env: childEnv,
  });

  child.on('exit', (code, signal) => {
    const sig = signal ? ` (signal ${signal})` : '';
    console.warn(`[runner] ${svc.label} exited with code ${code}${sig}`);
  });

  child.on('error', (err) => {
    console.error(`[runner] ${svc.label} error:`, err);
  });

  return child;
}

/**
 * Starts the public tunnel alongside `all`.
 *
 * This used to live only in src/scripts/dev-all.js, so `dev:all` came up with a
 * tunnel and `start:all` came up without one — same services, but nothing on
 * winlew.co could reach the API, which looks like the backend being down rather
 * than a missing tunnel. Now `all` owns it and dev-all.js simply inherits it.
 *
 * Never started for a single service: `node src/runner.js faucet` is for
 * running one bot beside an already-running stack, and a second ngrok agent
 * would fight the first for the reserved domain (the free tier allows one).
 */
function spawnNgrok(rootEnv) {
  const { enabled, command, port, desiredUrl, args } = resolveNgrokLaunch({ ...process.env, ...rootEnv });

  if (!enabled) {
    console.log('[runner] ngrok disabled by NGROK_ENABLED=false.');
    return null;
  }

  // Brief delay so the local port is listening before the tunnel attaches —
  // otherwise the first requests through it 502 for no useful reason.
  setTimeout(() => {
    const child = spawn(command, args, { cwd: process.cwd(), stdio: 'inherit', env: process.env });

    child.on('error', (err) => {
      console.error(`[runner] failed to start ngrok: ${err.message}`);
      console.error('[runner] install ngrok or add it to PATH, then retry, or set NGROK_ENABLED=false.');
      console.error('[runner] the WinLEW services are still running; only public tunnel access is unavailable.');
    });

    child.on('exit', (code) => {
      if (code && code !== 0) {
        console.error(`[runner] ngrok exited with code ${code}`);
        console.error('[runner] services remain online. Note the free tier allows ONE agent — check for a leftover ngrok before restarting.');
      }
    });

    if (desiredUrl) console.log(`[runner] ngrok reserved URL target: ${desiredUrl}`);
    else {
      console.log(`[runner] ngrok will request a random public URL for local port ${port}`);
      console.log('[runner] PUBLIC_BASE_URL is not an ngrok domain, so the winlew.co proxy and Discord redirect URLs will need updating by hand.');
    }
  }, 1500);

  return true;
}

function usage() {
  console.log(`Usage:
  node src/runner.js all
  node src/runner.js mole
  node src/runner.js faucet
  node src/runner.js faucetpayouts
  node src/runner.js quiz
  node src/runner.js quizpayouts
  node src/runner.js watchdog
  node src/runner.js public
`);
}

const arg = process.argv[2];
if (!arg) {
  usage();
  process.exit(1);
}

if (arg === 'all') {
  for (const key of Object.keys(SERVICES)) spawnService(key);
  spawnNgrok(loadEnvFile(path.resolve(process.cwd(), '.env')));
} else if (SERVICES[arg]) {
  spawnService(arg);
} else {
  usage();
  process.exit(1);
}
