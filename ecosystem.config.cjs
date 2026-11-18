// pm2 process list for the WinLEW stack. Runs each src/runner.js SERVICES
// entry (see src/runner.js) as its own pm2-supervised process instead of
// letting runner.js spawn them as unsupervised children — runner.js only
// logs a child's exit, it never respawns it, so a Discord bot command like
// !restart (which just calls process.exit(0)) previously killed the bot for
// good with nothing to bring it back. pm2's autorestart does that job.
//
// Usage:
//   pm2 start ecosystem.config.cjs      # start everything
//   pm2 save                            # persist this list for `pm2 resurrect`
//   pm2 startup                         # generate an OS boot hook (one-time, run its printed command)
//   pm2 logs winlew-faucet              # tail one service
//   pm2 restart winlew-faucet           # intentional restart of one service
//
// Env handling mirrors src/runner.js's spawnService(): root .env loaded
// first, then the service's own env file overrides only what it sets, and
// each app's cwd matches runner.js's cwd (dirname of the entry file) so the
// generic `dotenv/config` self-imports already in these entry files keep
// resolving the same local .env they always have.
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const ROOT = __dirname;
const LOG_DIR = path.join(ROOT, 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function loadEnvFile(relPath) {
  const abs = path.resolve(ROOT, relPath);
  if (!fs.existsSync(abs)) return {};
  return dotenv.parse(fs.readFileSync(abs));
}

const rootEnv = loadEnvFile('.env');

function mergedEnv(envFile) {
  return { ...rootEnv, ...loadEnvFile(envFile) };
}

// Same table as SERVICES in src/runner.js — kept in sync by hand since one
// is consumed by node's child_process and the other by pm2.
const SERVICES = [
  { name: 'winlew-mole', entry: 'src/index.js', envFile: '.env' },
  { name: 'winlew-faucet', entry: 'src/faucet/bot.js', envFile: 'src/faucet/.env' },
  { name: 'winlew-faucet-payouts', entry: 'src/faucet/payout-worker-main.js', envFile: 'src/faucet/.env' },
  { name: 'winlew-quiz', entry: 'src/quiz/index.js', envFile: 'src/quiz/.env' },
  { name: 'winlew-quiz-payouts', entry: 'src/quiz/payout-worker.js', envFile: 'src/quiz/.env' },
  { name: 'winlew-game-payouts', entry: 'src/games/payout-worker.js', envFile: '.env' },
  { name: 'winlew-watchdog', entry: 'src/watchdog/index.js', envFile: '.env' },
  { name: 'winlew-public', entry: 'src/public-server.js', envFile: '.env' },
];

function toApp(svc) {
  const absEntry = path.resolve(ROOT, svc.entry);
  return {
    name: svc.name,
    script: absEntry,
    cwd: path.dirname(absEntry),
    env: mergedEnv(svc.envFile),
    autorestart: true,
    max_restarts: 15,
    min_uptime: '10s',
    restart_delay: 3000,
    exp_backoff_restart_delay: 100,
    kill_timeout: 5000,
    out_file: path.join(LOG_DIR, `${svc.name}.out.log`),
    error_file: path.join(LOG_DIR, `${svc.name}.error.log`),
    time: true,
  };
}

const apps = SERVICES.map(toApp);

// ngrok, using the same launch settings as `runner.js all` and dev:all —
// src/shared/ngrokLaunch.cjs is the single source of truth, so pm2 cannot
// drift from the yarn scripts the way start:all previously drifted from
// dev:all. Supervised as its own app so a dropped tunnel comes back.
const { resolveNgrokLaunch } = require('./src/shared/ngrokLaunch.cjs');
const ngrok = resolveNgrokLaunch({ ...process.env, ...rootEnv });

if (ngrok.enabled) {
  apps.push({
    name: 'winlew-ngrok',
    script: ngrok.command,
    interpreter: 'none',
    args: ngrok.args,
    cwd: ROOT,
    autorestart: true,
    max_restarts: 15,
    min_uptime: '10s',
    restart_delay: 3000,
    out_file: path.join(LOG_DIR, 'winlew-ngrok.out.log'),
    error_file: path.join(LOG_DIR, 'winlew-ngrok.error.log'),
    time: true,
  });
}

module.exports = { apps };
