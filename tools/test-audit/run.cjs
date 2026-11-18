'use strict';

// Standalone supervisor only. Importing this from a guarded test grants nothing.
if (require.main !== module || process.env.WINLEW_TEST_ISOLATED === '1') {
  throw new Error('Integrity auditor is a standalone supervisor, not a test API');
}
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { trees, files, stages: establishedStages } = require('./policy.cjs');
const stages = Object.freeze({ ...establishedStages, ...require('./deployment-policy.cjs') });
const compare = require('./compare.cjs');
const repo = path.resolve(__dirname, '../..');
const stage = process.argv[2];
if (process.argv.length !== 3 || !Object.hasOwn(stages, stage)) {
  throw new Error('Usage: node tools/test-audit/run.cjs A|B|C|E|P5|UI|U5|I|L|F|GICE|GPAC|GBLAST|J|R|DEP|audit-failure|audit-exit (fixed reviewed stages only)');
}

function noLinks(target) {
  const relative = path.relative(repo, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Path outside repository');
  let current = repo;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Link refused: ${path.relative(repo, current)}`);
    } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  }
}

function snapshot() {
  const inventory = {};
  function inspect(relative, recurse) {
    const target = path.join(repo, relative);
    noLinks(target);
    let stat;
    try { stat = fs.lstatSync(target); }
    catch (error) {
      if (error.code === 'ENOENT') { inventory[relative] = { kind: 'missing' }; return; }
      throw error;
    }
    if (stat.isDirectory() && recurse) {
      inventory[relative] = { kind: 'directory' };
      for (const entry of fs.readdirSync(target).sort()) inspect(`${relative}/${entry}`, true);
    } else if (stat.isFile()) {
      // Bytes exist only in this scope and are never logged, returned, or passed
      // to the child. Refuse a file that changes while it is being fingerprinted.
      const sha256 = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
      const end = fs.lstatSync(target);
      if (stat.size !== end.size || stat.mtimeMs !== end.mtimeMs || stat.ino !== end.ino) {
        throw new Error(`Unstable protected file: ${relative}`);
      }
      inventory[relative] = { kind: 'file', size: stat.size, sha256, mtimeMs: stat.mtimeMs, mode: stat.mode };
    } else throw new Error(`Unexpected protected entry type: ${relative}`);
  }
  for (const relative of trees) inspect(relative, true);
  for (const relative of files) inspect(relative, false);
  return inventory;
}

const parent = path.join(repo, '.test-tmp');
noLinks(parent);
fs.mkdirSync(parent, { recursive: true });
const reportDir = fs.mkdtempSync(path.join(parent, `audit-${stage}-`));
const save = (name, value) => fs.writeFileSync(path.join(reportDir, name), JSON.stringify(value, null, 2));
let active = null;
let browserTools = null;
let interrupted = null;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => { interrupted = signal; active?.kill(); });
}

function childEnvironment(root, testFile) {
  // Allow only OS plumbing through; credentials, proxy settings and Node
  // injection flags from the invoking shell do not cross this boundary.
  const env = {};
  for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATH', 'PATHEXT']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  Object.assign(env, {
    NODE_ENV: 'test', WINLEW_TEST_ISOLATED: '1', WINLEW_TEST_ROOT: root,
    WINLEW_TEST_SELF_CHECK: stage === 'A' ? '1' : '0',
    WINLEW_TEST_FILE: testFile,
    MONGO_ENABLED: 'false', MONGO_URI: '',
    DATA_DIR: path.join(root, 'mole'), MOLE_DATA_DIR: path.join(root, 'mole'),
    FAUCET_DATA_DIR: path.join(root, 'faucet'), QUIZ_DATA_DIR: path.join(root, 'quiz'),
    LINKED_WALLETS_DIRS: [path.join(root, 'linked-src'), path.join(root, 'linked-root')].join(path.delimiter),
    TEMP: path.join(root, 'tmp'), TMP: path.join(root, 'tmp'), TMPDIR: path.join(root, 'tmp'),
    DISCORD_TOKEN: 'isolated-placeholder', DISCORD_CLIENT_ID: 'isolated-placeholder',
    DISCORD_CLIENT_SECRET: 'isolated-placeholder', DISCORD_REDIRECT_URI: 'http://127.0.0.1/callback',
    WINLEW_MINT: 'So11111111111111111111111111111111111111112',
    SOLANA_RPC: 'http://127.0.0.1:1', RPC_URL: 'http://127.0.0.1:1',
    FAUCET_PAYOUTS_DRY_RUN: 'true',
    NODE_OPTIONS: `--require="${path.join(repo, 'test/support/isolation-guard.cjs').replaceAll('\\', '/')}"`,
  });
  fs.mkdirSync(env.TEMP, { recursive: true });
  if (stage === 'UI' || stage === 'U5' || stage === 'L' || stage === 'F' || stage === 'GICE' || stage === 'GPAC' || stage === 'GBLAST' || stage === 'J') env.WINLEW_TEST_BROWSERS = JSON.stringify(browserTools.entries);
  return env;
}

async function runFile(testFile, index) {
  const root = path.join(reportDir, `test-${index}`);
  fs.mkdirSync(root);
  const logFile = path.join(reportDir, `test-${index}.tap`);
  const log = fs.openSync(logFile, 'wx');
  let output = '', timeout = false, unexpected = false;
  let spawnError = null;
  const result = await new Promise(resolve => {
    // node:test also runs in a directly executed file. Avoid a second test-runner
    // process so killing this child actually stops the application under test.
    active = spawn(process.execPath, ['--test-reporter=tap', testFile], {
      cwd: repo, env: childEnvironment(root, testFile), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    // Long real-game simulations remain bounded; fs/network/process rules
    // and immediate unexpected-violation termination are unchanged.
    const timer = setTimeout(() => { timeout = true; active?.kill(); }, ['GPAC', 'GBLAST'].includes(stage) ? 600_000 : 240_000);
    function receive(chunk) {
      fs.writeSync(log, chunk);
      output += chunk.toString();
      if (!unexpected && output.includes('[isolation:unexpected]')) {
        unexpected = true;
        active?.kill();
      }
    }
    active.stdout.on('data', receive);
    active.stderr.on('data', receive);
    active.on('error', error => { spawnError = error.code || error.name; });
    active.on('close', (code, signal) => { clearTimeout(timer); active = null; resolve({ code, signal }); });
  });
  fs.closeSync(log);
  const number = label => Number(output.match(new RegExp(`^# ${label} (\\d+)$`, 'm'))?.[1] || 0);
  const summaries = [...output.matchAll(/\[isolation:summary\] (\{[^\r\n]+\})/g)].map(match => JSON.parse(match[1]));
  const guardVerified = summaries.length > 0 && summaries.every(summary =>
    summary.mongoDisabled === true && summary.unexpected === 0 && (stage === 'A' || summary.expected === 0));
  return { file: testFile, ...result, timeout, spawnError, unexpected,
    guardVerified,
    pass: number('pass'), fail: number('fail'), skipped: number('skipped'),
    auditEvents: output.split(/\r?\n/).filter(line => line.includes('[isolation:')),
  };
}

async function main() {
  const report = { stage, startedAt: new Date().toISOString(), tests: [], integrity: 'not-completed' };
  let before;
  try {
    before = snapshot();
    save('before.json', before);
    if (stage === 'UI' || stage === 'U5' || stage === 'L' || stage === 'F' || stage === 'GICE' || stage === 'GPAC' || stage === 'GBLAST' || stage === 'J') {
      browserTools = await require('./browsers.cjs')(reportDir);
      report.browserProcesses = browserTools.entries.map(({ name, unavailable }) => ({ name, launched: !unavailable, supervisorOwned: true }));
    }
    for (const [index, testFile] of stages[stage].entries()) {
      if (interrupted) break;
      const result = await runFile(testFile, index);
      report.tests.push(result);
      console.log(`${testFile}: pass=${result.pass} fail=${result.fail} skip=${result.skipped} exit=${result.code}`);
      if (result.unexpected || result.code !== 0 || result.timeout || result.spawnError || !result.guardVerified) break;
    }
  } catch (error) {
    // Error text may include file content in other contexts; only report type/code.
    report.error = error.code || error.name;
  } finally {
    if (browserTools) {
      try { await browserTools.close(); } catch { report.error = 'BrowserCleanupFailed'; }
    }
    try {
      const after = snapshot();
      save('after.json', after);
      report.differences = before ? compare(before, after) : null;
      report.integrity = before && report.differences.length === 0 ? 'unchanged' : 'failed';
      report.protectedFiles = Object.values(after).filter(entry => entry.kind === 'file').length;
      report.missingPaths = Object.values(after).filter(entry => entry.kind === 'missing').length;
    } catch (error) { report.integrity = 'failed'; report.auditError = error.code || error.name; }
    report.interrupted = interrupted;
    report.finishedAt = new Date().toISOString();
    report.complete = report.tests.length === stages[stage].length;
    report.ok = report.complete && !report.error && !interrupted && report.integrity === 'unchanged'
      && report.tests.every(result => result.code === 0 && result.guardVerified && !result.unexpected && !result.timeout && !result.spawnError);
    save('report.json', report);
    console.log(`Stage ${stage}: ${report.ok ? 'PASS' : 'STOP'}; integrity=${report.integrity}; report=${path.relative(repo, reportDir)}/report.json`);
    for (const result of report.tests.filter(item => item.unexpected)) {
      for (const event of result.auditEvents) console.log(event);
    }
    process.exitCode = report.ok ? 0 : 1;
  }
}
main().catch(() => { console.error('Audit supervisor failed; inspect preserved reports.'); process.exitCode = 1; });
