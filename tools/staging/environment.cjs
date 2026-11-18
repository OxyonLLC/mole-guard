'use strict';
// No shell credentials, dotenv, proxy settings or injected Node flags inherit.
module.exports = function environment(repo, root) {
  const path = require('node:path'), env = {};
  for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATH', 'PATHEXT']) if (process.env[key]) env[key] = process.env[key];
  return Object.assign(env, { NODE_ENV: 'test', WINLEW_TEST_ISOLATED: '1', WINLEW_TEST_ROOT: root,
    WINLEW_TEST_SELF_CHECK: '0', WINLEW_TEST_FILE: 'tools/staging/server.mjs', MONGO_ENABLED: 'false', MONGO_URI: '',
    DATA_DIR: path.join(root, 'mole'), MOLE_DATA_DIR: path.join(root, 'mole'), FAUCET_DATA_DIR: path.join(root, 'faucet'), QUIZ_DATA_DIR: path.join(root, 'quiz'),
    LINKED_WALLETS_DIRS: [path.join(root, 'linked-src'), path.join(root, 'linked-root')].join(path.delimiter),
    TEMP: path.join(root, 'tmp'), TMP: path.join(root, 'tmp'), TMPDIR: path.join(root, 'tmp'),
    DISCORD_TOKEN: 'isolated-placeholder', DISCORD_CLIENT_ID: 'isolated-placeholder', DISCORD_CLIENT_SECRET: 'isolated-placeholder',
    DISCORD_REDIRECT_URI: 'http://127.0.0.1/callback', WINLEW_MINT: 'So11111111111111111111111111111111111111112',
    SOLANA_RPC: 'http://127.0.0.1:1', RPC_URL: 'http://127.0.0.1:1', FAUCET_PAYOUTS_DRY_RUN: 'true',
    NODE_OPTIONS: `--require="${path.join(repo, 'test/support/isolation-guard.cjs').replaceAll('\\', '/')}"` });
};
