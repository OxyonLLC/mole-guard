'use strict';
// Independent fingerprint supervisor only. Fixed reviewed policy, no path API.
if (process.env.WINLEW_TEST_ISOLATED === '1') throw new Error('Supervisor-only integrity reader');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { trees, files } = require('../test-audit/policy.cjs');
const repo = path.resolve(__dirname, '../..');
module.exports = function snapshot() {
  const result = {};
  function inspect(relative, recurse) {
    let current = repo;
    for (const name of relative.split('/')) {
      current = path.join(current, name);
      try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Protected link refused'); }
      catch (error) { if (error.code === 'ENOENT') break; throw error; }
    }
    const file = path.join(repo, relative); let stat;
    try { stat = fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') { result[relative] = { kind: 'missing' }; return; } throw error; }
    if (stat.isDirectory() && recurse) {
      result[relative] = { kind: 'directory' };
      for (const child of fs.readdirSync(file).sort()) inspect(relative + '/' + child, true);
    } else if (stat.isFile()) {
      const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      const end = fs.lstatSync(file);
      if (stat.size !== end.size || stat.mtimeMs !== end.mtimeMs || stat.ino !== end.ino) throw new Error('Protected file changed during fingerprint');
      result[relative] = { kind: 'file', size: stat.size, sha256, mtimeMs: stat.mtimeMs, mode: stat.mode };
    } else throw new Error('Unexpected protected entry');
  }
  for (const relative of trees) inspect(relative, true);
  for (const relative of files) inspect(relative, false);
  return result;
};
