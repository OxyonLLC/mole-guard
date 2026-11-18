# Phase 4F-S2R Hotfix: dependency data boundary

Date: 2026-10-11. The S2R canonical-path defect is fixed and the guarded
reconstructed Approval A suite passed. This does not recover the original
historical 38/38 run.

## Changes

- `test/support/isolation-guard.cjs`: capture the original bound
  `fs.realpathSync` and `fs.realpathSync.native` functions before any fs wrappers
  are installed; pass those saved functions to canonical path checks. Canonical
  resolution failure still denies access. Writes must resolve both lexically
  and canonically inside the disposable root. Symlink APIs now validate their
  destination argument, and later alias access is canonicalized. The original
  `lstatSync` is also retained so dangling symlink/junction paths fail closed.
- `test/support/isolation-policy.cjs`: remove global basename matching for
  `db.json`, `claims_v3.json`, profile/session and wallet-store names. Reads are
  protected by the fixed canonical data trees and explicit files from the audit
  policy. No `node_modules` exemption or generic `db.json` exception exists.
- `tools/test-audit/policy.cjs`: inventory the exact existing
  `src/faucet/.env.bak-20260801-221118` credential backup. The file was not
  opened by tests, changed or deleted.
- `test/support/isolationGuard.test.cjs`: exercise test module loading, the
  installed MIME database asset, protected quiz/faucet/profile/session/wallet
  stores, unrelated similarly named files, traversal and junction aliases
  (including writes to missing descendants under a protected junction),
  outside-root writes, external network and unapproved children.
- `test/mole/approvalAReconstructed.test.mjs`: use the application's explicit
  JSON-byte-array signature format for valid synthetic signatures and the
  malformed 32-byte fixture; application code was not changed.

No scoring, payout, eligibility, authentication, wallet ownership, session,
reconciliation, or production environment behavior changed.

## Verification

Commands were run from the repository root, through the independent supervisor:

```text
node tools/test-audit/run.cjs A
node tools/test-audit/run.cjs B
node tools/test-audit/run.cjs C
```

| Stage | Result | Tests | Guard / integrity |
| --- | --- | ---: | --- |
| A guard self-tests | PASS | 8/8 | 15 deliberate blocked probes; zero unexpected violations; clean audit |
| B storage and isolation | PASS | 166/166 | zero unexpected violations; zero network; two exact guard-inheriting service import children; clean audit |
| C reconstructed Approval A | PASS | 18/18 TAP (parent + 17 named behavior checks) | zero unexpected violations; 12 instrumented localhost socket connects; zero children; clean audit; Mongo disabled |

Intermediate attempts: the first A run stopped because path resolution read
`.native` from the wrapped `fs.realpathSync`, falsely classifying the test module
as protected. Saving both original realpath functions fixed that defect. The
next A run had 7 pass / 1 fail because the generic symlink wrapper checked the
target rather than the link destination; it was narrowed to validate the
destination. Final A then passed. C's first attempt failed during fixture setup
because base58 text was ambiguous to the application's signature decoder. Its
next attempt had 16 passing leaves and one failing leaf for the malformed
signature fixture. These fixture/wrapper issues were corrected without
application changes. Their supervisors completed post-audits. Final A/B/C
results above are the accepted verification results.

### Reconstructed Approval A behavior checks

All checks are in `test/mole/approvalAReconstructed.test.mjs`, run with
`node tools/test-audit/run.cjs C`. Each named check passed:

1. Synthetic Ed25519 login binds accounts A and B to their distinct sessions.
2. Replay of a consumed signed challenge is rejected.
3. Wrong signer is rejected; the valid challenge remains usable.
4. Altered signed message is rejected.
5. Malformed signature length is rejected.
6. A/B profile requests remain bound to the authenticated session despite forged selectors.
7. Missing and invalid sessions cannot fetch `/api/profile/me`.
8. Wallet owner gets the private projection; another account receives the public projection.
9. Private A/B histories remain separated despite forged account and guest selectors.
10. Guest histories remain separated by guest namespace and from member IDs.
11. Expired sessions are rejected by profile and history endpoints under a controlled clock.
12. HTTP logout revokes the session; repeat logout remains harmless.
13. Unauthenticated and invalid-guest reconciliation requests leave totals unchanged.
14. Authenticated reconciliation uses the session identity, applies the 4500 cap once, and returns exact totals on repeat.
15. A second guest's recorded row moves without a second migration credit.
16. B's below-cap gap credits exactly 7 once; totals and history agree.
17. Profile RPC calls use the reviewed loopback read-only fixture and Mongo stays disabled.

These findings establish the listed reconstructed behaviors under the guarded
test environment. The public wallet profile still exposes its existing bounded
game-history preview, and guest IDs remain namespace selectors rather than
independent credentials. No broader claim about public history secrecy is made.

## Hashes, network and child-process evidence

Each final stage supervisor directory contains `before.json`, `after.json` and
`report.json`. The inventory JSON contains each protected file's SHA-256, size,
mtime and mode, without file contents. The full 70-file hashes are in:

- Stage A: `.test-tmp/audit-A-Q5UmOX/before.json` and `after.json`.
- Stage B: `.test-tmp/audit-B-0c8B7O/before.json` and `after.json`.
- Stage C: `.test-tmp/audit-C-oVhxMJ/before.json` and `after.json`.

Every before/after inventory is byte-identical. Each inventory JSON SHA-256 is
`4befd7b9e57a46f5cf0ad4763fe5b9641893beb1ebefc3e8d06c1cc1da87f809`.
Each report records 70 protected files, 6 protected directory roots, 1 missing
path, zero differences, and `integrity: unchanged`. The exact faucet environment
backup is included with SHA-256
`ee538bae20b5650b92e65822c34ae3b5222512c862a60d36c9250caaac7f80f3`. The 16
historical `claims_v3.json.tmp-*` files are included and unchanged. Comparing
the inventory artifacts gives the per-file comparison; the digest above is not
a combined digest of protected file contents.

Stage C's disposable `approval-a-evidence.json` records 41 HTTP responses and
only these RPC methods: `getAccountInfo` 16, `getTokenAccountsByOwner` 18,
`getBalance` 2, `getSignaturesForAddress` 2. No unreviewed method was called.
All 12 instrumented socket connects in C used `127.0.0.1`; there were zero
external connections. B's two child processes were the existing exact service
import probes and inherited the guard. A blocked the expected external-network
and unapproved-child probes. Mongo was disabled in each stage.

No production request, production wallet/signature, payout, claim, transfer, or
production reconciliation occurred. No broader suite was run.

## Remaining limitations and conclusion

Canonical resolution fails closed, checks existing symlink/junction targets and
walks to the nearest existing ancestor for prospective paths. The auditor itself
also refuses symlinks in protected inventory paths. This JavaScript guard is a
regression barrier, not an OS sandbox; native bindings, workers, all descriptor
paths, unconnected UDP/DNS and force-killed-supervisor limits remain as in S1.
Network observations are instrumented, not an OS packet capture.

**Reconstructed Approval A — Verified (18 TAP tests, including the parent;
17 named behavior checks).** The historical 38/38 result remains historical and
was not recovered. GO for this narrowly defined reconstruction. No broader-suite
testing is authorized by this phase.
