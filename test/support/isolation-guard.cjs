'use strict';

if (process.env.WINLEW_TEST_ISOLATED !== '1') throw new Error('[isolation] guard requires WINLEW_TEST_ISOLATED=1');

const fs = require('node:fs');
// Capture the trusted resolver functions before this guard replaces any fs API.
const originalRealpathSync = fs.realpathSync.bind(fs);
const originalRealpathNative = typeof fs.realpathSync.native === 'function'
  ? fs.realpathSync.native.bind(fs.realpathSync)
  : null;
const originalLstatSync = fs.lstatSync.bind(fs);
const path = require('node:path');
const net = require('node:net');
const tls = require('node:tls');
const dgram = require('node:dgram');
const childProcess = require('node:child_process');
const { syncBuiltinESMExports } = require('node:module');
const policy = require('./isolation-policy.cjs');
const root = policy.disposableRoot();
const rawWrite = fs.writeSync.bind(fs);
const rawExit = process.exit.bind(process);
const counters = { expected: 0, unexpected: 0, localhostConnections: 0, approvedChildren: 0 };
const selfCheck = process.env.WINLEW_TEST_SELF_CHECK === '1'
  && process.env.WINLEW_TEST_FILE === 'test/support/isolationGuard.test.cjs';
function event(kind, value) { rawWrite(2, `[isolation:${kind}] ${JSON.stringify(value)}\n`); }
process.on('exit', () => event('summary', { ...counters,
  mongoDisabled: process.env.MONGO_ENABLED === 'false' && !process.env.MONGO_URI }));

function violation(kind, detail) {
  const error = new Error(`[isolation] blocked ${kind}: ${detail}`);
  error.code = 'WINLEW_TEST_ISOLATION_VIOLATION';
  // Only the reviewed self-test can catch deliberate probes. Unexpected
  // violations terminate immediately even if application code catches errors.
  if (selfCheck && error.stack.includes('isolationGuard.test.cjs:')) {
    counters.expected++;
    event('expected', { kind, detail });
  } else {
    counters.unexpected++;
    event('unexpected', { kind, detail, stack: error.stack });
    rawExit(86);
  }
  throw error;
}
function toPath(value) {
  if (Buffer.isBuffer(value)) return path.resolve(value.toString());
  if (value instanceof URL) return value.protocol === 'file:' ? path.resolve(require('node:url').fileURLToPath(value)) : null;
  return typeof value === 'string' ? path.resolve(value) : null;
}
function checkRead(value) {
  const candidate = toPath(value);
  if (!candidate) return;
  if (policy.isProtectedRead(candidate, root, originalRealpathSync, originalRealpathNative, originalLstatSync)) {
    violation('protected read', candidate);
  }
}
function checkWrite(value) {
  if (typeof value === 'number') return;
  const candidate = toPath(value);
  const canonical = candidate && policy.canonicalPath(candidate, originalRealpathSync, originalRealpathNative, originalLstatSync);
  if (!candidate || !canonical || !policy.isWithin(root, candidate) || !policy.isWithin(root, canonical)) {
    violation('write outside disposable root', String(candidate || value));
  }
}
function wrap(target, name, check, index = 0) {
  const original = target[name];
  if (typeof original !== 'function') return;
  target[name] = function guarded(...args) { check(args[index]); return Reflect.apply(original, this, args); };
}

for (const name of ['readFileSync', 'createReadStream', 'statSync', 'lstatSync', 'accessSync', 'existsSync', 'readdirSync', 'readlinkSync', 'realpathSync']) wrap(fs, name, checkRead);
for (const name of ['writeFileSync', 'appendFileSync', 'truncateSync', 'createWriteStream', 'mkdirSync', 'mkdtempSync', 'rmSync', 'rmdirSync', 'unlinkSync', 'chmodSync', 'chownSync', 'utimesSync']) wrap(fs, name, checkWrite);
for (const name of ['renameSync', 'copyFileSync', 'linkSync']) { wrap(fs, name, checkWrite, 0); wrap(fs, name, checkWrite, 1); }
for (const name of ['readFile', 'stat', 'lstat', 'access', 'readdir', 'readlink', 'realpath']) wrap(fs, name, checkRead);
for (const name of ['writeFile', 'appendFile', 'truncate', 'createWriteStream', 'mkdir', 'mkdtemp', 'rm', 'rmdir', 'unlink', 'chmod', 'chown', 'utimes']) wrap(fs, name, checkWrite);
for (const name of ['rename', 'copyFile', 'link']) { wrap(fs, name, checkWrite, 0); wrap(fs, name, checkWrite, 1); }
if (fs.promises) {
  for (const name of ['readFile', 'stat', 'lstat', 'access', 'readdir', 'readlink', 'realpath']) wrap(fs.promises, name, checkRead);
  for (const name of ['writeFile', 'appendFile', 'truncate', 'mkdir', 'mkdtemp', 'rm', 'rmdir', 'unlink', 'chmod', 'chown', 'utimes']) wrap(fs.promises, name, checkWrite);
  for (const name of ['rename', 'copyFile', 'link']) { wrap(fs.promises, name, checkWrite, 0); wrap(fs.promises, name, checkWrite, 1); }
}

// symlink(target, path) creates an entry at argument 1; argument 0 is only a
// reference. Guard the disposable destination, then canonicalize every later
// access to the alias before allowing reads or writes through it.
for (const [target, name] of [[fs, 'symlinkSync'], [fs, 'symlink'], [fs.promises, 'symlink']]) {
  if (!target || typeof target[name] !== 'function') continue;
  const original = target[name];
  target[name] = function isolatedSymlink(_linkTarget, linkPath, ...args) {
    checkWrite(linkPath);
    return Reflect.apply(original, this, [_linkTarget, linkPath, ...args]);
  };
}

function checkOpen(file, flags) {
  const text = String(flags ?? 'r');
  if (/[wax+]/.test(text) || (typeof flags === 'number' && flags !== fs.constants.O_RDONLY)) checkWrite(file);
  else checkRead(file);
}
for (const target of [fs, fs.promises]) {
  if (!target) continue;
  for (const name of ['open', 'openSync']) {
    const original = target[name];
    if (typeof original !== 'function') continue;
    target[name] = function isolatedOpen(file, flags, ...args) {
      checkOpen(file, flags);
      return Reflect.apply(original, this, [file, flags, ...args]);
    };
  }
}

function destination(args) {
  if (Array.isArray(args[0])) return destination(args[0]);
  const first = args[0];
  if (first && typeof first === 'object') return { host: first.hostname || first.host, port: first.port };
  if (typeof first === 'number') return { host: args[1] || 'localhost', port: first };
  return { host: first, port: undefined };
}
function guardConnect(original) {
  return function isolatedConnect(...args) {
    const { host, port } = destination(args);
    if (!policy.isLocalHost(host)) violation('non-local network connection', `${host || '<unknown>'}:${port || ''}`);
    counters.localhostConnections++;
    event('localhost', { host, port });
    return Reflect.apply(original, this, args);
  };
}
net.Socket.prototype.connect = guardConnect(net.Socket.prototype.connect);
net.connect = guardConnect(net.connect);
net.createConnection = guardConnect(net.createConnection);
tls.connect = guardConnect(tls.connect);
const originalDgramConnect = dgram.Socket.prototype.connect;
dgram.Socket.prototype.connect = function isolatedDgramConnect(...args) {
  const host = typeof args[1] === 'string' ? args[1] : args[0]?.address;
  if (!policy.isLocalHost(host)) violation('non-local datagram connection', String(host || '<unknown>'));
  return Reflect.apply(originalDgramConnect, this, args);
};

for (const name of ['exec', 'execSync', 'fork', 'spawn', 'spawnSync', 'execFile', 'execFileSync']) {
  const original = childProcess[name];
  childProcess[name] = function isolatedChild(file, args, options, ...rest) {
    const normalizedArgs = Array.isArray(args) ? args : [];
    const normalizedOptions = Array.isArray(args) ? options : args;
    if (!policy.isApprovedChild(file, normalizedArgs, normalizedOptions)) violation('unapproved child process', `${name} ${String(file)}`);
    counters.approvedChildren++;
    event('child', { name, probe: 'module-import-probe', guardInherited: true });
    return Reflect.apply(original, this, [file, args, options, ...rest]);
  };
}
syncBuiltinESMExports();
