import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicRequestPath } from '../../src/mole/publicFiles.js';
test('public file policy denies historical and credential aliases', () => {
  for (const input of ['/.tmp-audit/test.js', '/.tmp-audit.zip', '/%2etmp-audit/test.js', '/x/../.tmp-audit/test.js', '/.env', '/verify/api-proxy-secret.php', '/xl1/verify/api-proxy-upstream.php', '/log/test', '/file.before', '/%ZZ']) assert.equal(isPublicRequestPath(input), false, input);
});
test('public file policy preserves assets, product routes and machine metadata', () => {
  for (const input of ['/', '/mole-hub/?game=diglew', '/verify/api-proxy.php', '/assets/nav.js', '/xl1/latest.json', '/jdid93hf8dh/latest.json', '/community/']) assert.equal(isPublicRequestPath(input), true, input);
});
