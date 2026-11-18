'use strict';

const path = require('node:path');
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DISPOSABLE_PARENT = path.join(REPO_ROOT, '.test-tmp');
const protectedAudit = require('../../tools/test-audit/policy.cjs');

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function disposableRoot(env = process.env) {
  const configured = String(env.WINLEW_TEST_ROOT || '').trim();
  if (!configured) throw new Error('[isolation] WINLEW_TEST_ROOT is required');
  const resolved = path.resolve(configured);
  if (!isWithin(DISPOSABLE_PARENT, resolved) || resolved === DISPOSABLE_PARENT) {
    throw new Error(`[isolation] disposable root must be a child of ${DISPOSABLE_PARENT}`);
  }
  return resolved;
}

const PROTECTED_BASENAMES = new Set([
  '.env', 'claims_v3.json', 'wallet_bans.json', 'wallet_linkage.json',
  'user_bans.json', 'linked_wallets.json', 'wallet_links.json',
  'registrations.json', 'airdrops.json', 'db.json',
  'recent_questions.json', 'profile_prefs.json',
]);

// Resolve existing symlinks/junctions and the nearest existing ancestor for
// prospective paths. This avoids treating an alias under the disposable root
// as safe when it points into protected storage. Unexpected resolution errors
// return null so callers can fail closed.
function canonicalPath(candidate, realpathSync, realpathNative, lstatSync) {
  const resolveExisting = realpathNative || realpathSync;
  if (typeof resolveExisting !== 'function' || typeof lstatSync !== 'function') return null;
  let current = path.resolve(candidate);
  const missing = [];
  for (;;) {
    try {
      const real = resolveExisting(current);
      return path.resolve(real, ...missing.reverse());
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') return null;
      try {
        // A dangling symlink/junction can produce ENOENT even though it exists.
        // Never reconstruct its spelling beneath the disposable root.
        const entry = lstatSync(current);
        if (entry.isSymbolicLink()) return null;
        return null;
      } catch (statError) {
        if (statError.code !== 'ENOENT' && statError.code !== 'ENOTDIR') return null;
      }
      const parent = path.dirname(current);
      if (parent === current) return null;
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

function isProtectedLocation(candidate) {
  const absolute = path.resolve(candidate);
  return protectedAudit.files.some(file => path.resolve(REPO_ROOT, file) === absolute)
    || protectedAudit.trees.some(dir => isWithin(path.resolve(REPO_ROOT, dir), absolute));
}

function isProtectedRead(candidate, root, realpathSync, realpathNative, lstatSync) {
  const absolute = path.resolve(candidate);
  const canonical = canonicalPath(absolute, realpathSync, realpathNative, lstatSync);
  if (!canonical) return true;
  // Test both spellings: a dangling link into protected storage may not resolve
  // fully, while a valid link may make the canonical destination decisive.
  if (isProtectedLocation(absolute) || isProtectedLocation(canonical)) return true;
  // Reads wholly contained in the disposable root are allowed only after the
  // protected-location check, which also catches links back to production data.
  return false;
}

function isLocalHost(host) {
  const value = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  return value === 'localhost' || value === '127.0.0.1' || value === '::1';
}

function isApprovedChild(file, args, options) {
  if (path.resolve(String(file)) !== path.resolve(process.execPath)) return false;
  if (options?.env?.WINLEW_TEST_CHILD !== 'module-import-probe') return false;
  if (options?.shell || path.resolve(options?.cwd || '.') !== REPO_ROOT) return false;
  if (options?.env?.WINLEW_TEST_ISOLATED !== '1'
    || options.env.WINLEW_TEST_ROOT !== process.env.WINLEW_TEST_ROOT
    || options.env.NODE_OPTIONS !== process.env.NODE_OPTIONS
    || !options.env.NODE_OPTIONS?.includes('isolation-guard.cjs')) return false;
  const values = Array.isArray(args) ? args.map(String) : [];
  if (values.length !== 3 || values[0] !== '--input-type=module' || values[1] !== '-e') return false;
  return ['service', 'eligibility'].some(name => {
    const url = require('node:url').pathToFileURL(path.join(REPO_ROOT, `src/faucet/${name}.js`)).href;
    return values[2].replace(/\s+/g, ' ').trim() ===
      `import('${url}') .then(() => { console.log('SAFE'); }) .catch((e) => { console.log('UNSAFE:' + e.message); });`;
  });
}

module.exports = { REPO_ROOT, DISPOSABLE_PARENT, disposableRoot, isWithin, canonicalPath, isProtectedRead, isLocalHost, isApprovedChild };
