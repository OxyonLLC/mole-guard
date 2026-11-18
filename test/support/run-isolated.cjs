'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
// Every run receives an integrity audit; no raw application-test entrypoint.
if (require.main !== module || process.env.WINLEW_TEST_ISOLATED === '1') throw new Error('Standalone runner only');
if (process.argv.length !== 3 || !['A', 'B', 'C'].includes(process.argv[2])) {
  throw new Error('Usage: npm run test:isolated -- A|B|C');
}
const result = spawnSync(process.execPath, [path.resolve(__dirname, '../../tools/test-audit/run.cjs'), process.argv[2]], {
  cwd: path.resolve(__dirname, '../..'), stdio: 'inherit', windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
