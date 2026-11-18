'use strict';

// Reviewed, repository-relative integrity boundary. No CLI/env path overrides.
// Directory trees include additions/removals, lock files and historical temps.
const trees = Object.freeze([
  'data', 'src/data', 'src/faucet/data', 'src/quiz/data',
  'src/games/data', 'data-watchdog',
]);
const files = Object.freeze([
  '.env', '.env-Before-GAMEHUB', '.env.bak-20260814-193058',
  '.env.bak-rpc-1785530699', '.env.moleguard.watchdog',
  'src/faucet/.env', 'src/faucet/.env.bak-20260801-221118',
  'src/quiz/.env', 'src/faucet/_legacy/env',
  ...['airdrops', 'bot-keypair', 'faucet_claims', 'ip_bans', 'lastTweet',
    'registrations', 'subscriptions', 'twitterUserId', 'wallet_bans',
    'wallet_linkage', 'wallet_links', 'user_bans'].map(name => `src/faucet/${name}.json`),
]);
const stages = Object.freeze({
  // Supervisor fault probes, separate from application verification counts.
  'audit-failure': Object.freeze(['tools/test-audit/fixtures/failure.cjs']),
  'audit-exit': Object.freeze(['tools/test-audit/fixtures/exit.cjs']),
  A: Object.freeze(['test/support/isolationGuard.test.cjs']),
  B: Object.freeze([
    'test/mole/profilePrefsIsolation.test.mjs',
    'test/quiz/quizStorageIsolation.test.mjs',
    'test/quiz/db-platform-stats.test.cjs',
    'test/shared/managedWriteDurability.test.mjs',
    'test/faucet/storageBanWipe.test.mjs',
    'test/faucet/claimStore.test.mjs',
    'test/faucet/service.test.mjs',
    'test/faucet/userBans.test.mjs',
    'test/faucet/walletBans.test.mjs',
  ]),
  // S2 reconstruction, NOT the unrecovered historical 38-test manifest.
  C: Object.freeze(['test/mole/approvalAReconstructed.test.mjs']),
  E: Object.freeze(['test/mole/publicFiles.test.mjs', 'test/mole/homepageSummary.test.mjs', 'test/ui/homepageData.test.mjs', 'test/ui/androidCompatibility.test.mjs', 'test/mole/completionSecurity.test.mjs']),
  UI: Object.freeze(['test/ui/matrix/chrome.test.mjs', 'test/ui/matrix/edge.test.mjs', 'test/ui/matrix/firefox.test.mjs', 'test/ui/matrix/webkit.test.mjs']),
  P5: Object.freeze(['test/ui/profileCacheBoundary.test.mjs', 'test/ui/audioCompatibility.test.mjs', 'test/mole/phase5Release.test.mjs', 'test/mole/runtimeAssembly.test.mjs']),
  U5: Object.freeze(['test/ui/phase5Acceptance.test.mjs']),
  I: Object.freeze(['test/mole/syntheticRewardIntegration.test.mjs', 'test/mole/stagingConfiguration.test.mjs']),
  L: Object.freeze(['test/ui/practiceLifecycle.test.mjs']),
  F: Object.freeze(['test/ui/practiceFailureRecovery.test.mjs']),
  GICE: Object.freeze(['test/ui/moleIceWinning.test.mjs']),
  GPAC: Object.freeze(['test/ui/pacMoleWinning.test.mjs']),
  GBLAST: Object.freeze(['test/ui/blasterWinning.test.mjs']),
  J: Object.freeze(['test/ui/stagingAccountJourney.test.mjs']),
  R: Object.freeze(['test/mole/runtimeAssembly.test.mjs']),
  // D deliberately has no manifest: the broader suite is not yet reviewed.
});
module.exports = Object.freeze({ trees, files, stages });
